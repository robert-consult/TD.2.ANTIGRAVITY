// @ts-nocheck
import "dotenv/config";
import axios from "axios";
import pThrottle from "p-throttle";
import { instruments } from "../../data/instruments";
import { db, dbClient } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { recalcAccount } from "../recalcAccount";
import { onQuotesUpdated } from "../engine/orderEngine";
import { computeSessionDayForQuote, ensureMarketDailyCloseTable } from "../utils/marketDailyClose";
import { publishLiveEvent } from "../services/liveBus";

const API_KEY = process.env.FORGE_KEY;

const REST_LIMIT_PER_DAY = 100000;
const MAX_PER_REQ = 100;
const DEFAULT_POLL_MS = 870;
const DEFAULT_STALE_MS = 30000;

let dynamicConfig = {
  pollIntervalMs: DEFAULT_POLL_MS,
  staleThresholdMs: DEFAULT_STALE_MS,
  rolloverTz: "America/New_York",
  rolloverTime: "17:00",
};

let pollTimerId: ReturnType<typeof setTimeout> | null = null;

// In-memory cache for quote snapshots with timestamps
interface QuoteSnapshot {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  lastUpdated: number;
  isStale: boolean;
  consecutiveFailures: number;
}

const quoteSnapshotCache = new Map<string, QuoteSnapshot>();
let lastSuccessfulApiCall = 0;
let consecutiveApiFailures = 0;

export function getQuoteSnapshotCache(): Map<string, QuoteSnapshot> {
  return quoteSnapshotCache;
}

export function getCacheStats() {
  return {
    cacheSize: quoteSnapshotCache.size,
    lastSuccessfulApiCall,
    consecutiveApiFailures,
    staleCount: [...quoteSnapshotCache.values()].filter((q) => q.isStale).length,
  };
}

async function loadFeedConfig() {
  try {
    const row = await db.query.systemConfig.findFirst({
      where: eq(systemConfig.id, 1),
    });
    return {
      pollIntervalMs: Number((row as any)?.feedPollMs ?? DEFAULT_POLL_MS),
      staleThresholdMs: Number((row as any)?.staleThresholdMs ?? DEFAULT_STALE_MS),
      rolloverTz: String((row as any)?.fxRolloverTz ?? "America/New_York"),
      rolloverTime: String((row as any)?.fxRolloverTime ?? "17:00"),
    };
  } catch {
    return {
      pollIntervalMs: DEFAULT_POLL_MS,
      staleThresholdMs: DEFAULT_STALE_MS,
      rolloverTz: "America/New_York",
      rolloverTime: "17:00",
    };
  }
}

export async function reloadFeedConfig() {
  const newConfig = await loadFeedConfig();
  const oldPoll = dynamicConfig.pollIntervalMs;
  dynamicConfig = newConfig;
  console.log(`[FeedConfig] Reloaded: poll=${dynamicConfig.pollIntervalMs}ms, stale=${dynamicConfig.staleThresholdMs}ms`);
  if (oldPoll !== dynamicConfig.pollIntervalMs) {
    console.log(`[FeedConfig] Poll interval changed from ${oldPoll}ms to ${dynamicConfig.pollIntervalMs}ms`);
  }
}

function updateSnapshotCache(quotes: any[]) {
  const now = Date.now();
  for (const quote of quotes) {
    if (!quote?.symbol) continue;
    const updatedAt = typeof quote.lastUpdated === "number" ? quote.lastUpdated : now;
    quoteSnapshotCache.set(quote.symbol, {
      symbol: quote.symbol,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      lastUpdated: updatedAt,
      isStale: Boolean(quote.isStale),
      consecutiveFailures: 0,
    });
  }
  lastSuccessfulApiCall = now;
  consecutiveApiFailures = 0;
}

async function getActiveInstruments(): Promise<string[]> {
  try {
    const rows = await dbClient.query("SELECT symbol FROM symbol_configs WHERE enabled = true");
    return rows.rows.map((r: any) => String(r.symbol));
  } catch (error) {
    console.error("[Feed] Error getting active instruments:", error);
    return ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY"];
  }
}

function formatSymbolsForForgeAPI(symbols: string[]): string {
  const formattedSymbols = symbols
    .map((symbol) => {
      if (symbol.includes("/")) return symbol;
      if (symbol.length === 6 && !symbol.includes("JPY")) {
        return `${symbol.substring(0, 3)}/${symbol.substring(3, 6)}`;
      }
      if (symbol.includes("JPY")) {
        if (symbol.startsWith("JPY")) {
          return `JPY/${symbol.substring(3, 6)}`;
        }
        return `${symbol.substring(0, 3)}/JPY`;
      }
      if (symbol === "XAUUSD") return "XAU/USD";
      if (symbol === "XAGUSD") return "XAG/USD";
      if (symbol === "US30") return "USA30";
      if (symbol === "NGAS") return "NATGAS";
      if (symbol === "WTI") return "USOIL";
      return symbol;
    })
    .filter((s) => s.includes("/"));

  const requiredPairs = ["EUR/USD", "GBP/USD", "USD/JPY", "GBP/JPY", "EUR/JPY"];
  const allPairs = [...new Set([...formattedSymbols, ...requiredPairs])];
  return allPairs.join(",");
}

const ALL = instruments.map((i) => i.symbol);
let dynamicSet = new Set<string>();
const throttle = pThrottle({ limit: REST_LIMIT_PER_DAY, interval: 86_400_000 });

function generateSimulatedQuotes(symbols: string[]) {
  const basePrices: Record<string, number> = {
    EURUSD: 1.09421,
    USDJPY: 144.87,
    GBPUSD: 1.27152,
    AUDUSD: 0.65321,
    USDCAD: 1.35982,
    NZDUSD: 0.61024,
    USDCHF: 0.89758,
    EURGBP: 0.85982,
    EURJPY: 158.524,
    GBPJPY: 184.213,
  };

  return symbols.map((symbol) => {
    const basePrice = basePrices[symbol] || Math.random() * 100;
    const priceChange = basePrice * (Math.random() * 0.001 - 0.0005);
    const price = basePrice + priceChange;
    const spread = symbol.includes("JPY") ? 0.02 : 0.0002;
    const halfSpread = spread / 2;

    return {
      symbol,
      price,
      bid: price - halfSpread,
      ask: price + halfSpread,
      timestamp: Math.floor(Date.now() / 1000),
      lastUpdated: Date.now(),
      isStale: false,
    };
  });
}

async function refreshDynamicSet() {
  const symbols = await getActiveInstruments();
  dynamicSet = new Set(symbols.length ? symbols : ALL.slice(0, MAX_PER_REQ));
}

async function persistQuotes(rows: any[], isStale: boolean) {
  if (!rows.length) return;
  const client = await dbClient.connect();
  const affectedSymbols: string[] = [];
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  try {
    await client.query("BEGIN");

    await ensureMarketDailyCloseTable();

    for (const q of rows) {
      if (!q?.symbol) continue;
      const lastUpdatedMs = typeof q.lastUpdated === "number" ? q.lastUpdated : nowMs;
      const lastApiUpdateMs = Math.trunc(lastUpdatedMs);

      await client.query(
        `
        INSERT INTO quotes (symbol, price, bid, ask, updated_at, is_stale, last_api_update)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (symbol) DO UPDATE SET
          price = EXCLUDED.price,
          bid = EXCLUDED.bid,
          ask = EXCLUDED.ask,
          updated_at = EXCLUDED.updated_at,
          is_stale = EXCLUDED.is_stale,
          last_api_update = EXCLUDED.last_api_update
        `,
        [
          q.symbol,
          q.price || 0,
          q.bid ?? null,
          q.ask ?? null,
          nowSec,
          isStale,
          lastApiUpdateMs,
        ],
      );

      try {
        const bid = typeof q.bid === "number" ? q.bid : null;
        const ask = typeof q.ask === "number" ? q.ask : null;
        const mid = bid != null && ask != null ? (bid + ask) / 2 : typeof q.price === "number" ? q.price : null;
        if (Number.isFinite(mid) && mid > 0) {
          const sessionDay = computeSessionDayForQuote(lastUpdatedMs, {
            rolloverTz: dynamicConfig.rolloverTz,
            rolloverTime: dynamicConfig.rolloverTime,
          });
          await client.query(
            `
            INSERT INTO market_daily_close (symbol, session_day, close, close_ts_ms, updated_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (symbol, session_day) DO NOTHING
            `,
            [q.symbol, sessionDay, mid, lastUpdatedMs, nowSec],
          );
        }
      } catch (e) {
        console.warn("[market_daily_close] upsert failed:", e);
      }

      if (!affectedSymbols.includes(q.symbol)) {
        affectedSymbols.push(q.symbol);
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[Feed] Error persisting quotes:", error);
  } finally {
    client.release();
  }

  try {
    if (affectedSymbols.length > 0) {
      const userIdsRes = await dbClient.query(
        `
        SELECT DISTINCT t.user_id AS "userId"
        FROM trades t
        JOIN symbol_configs sc ON t.symbol_id = sc.id
        WHERE t.status = 'OPEN' AND sc.symbol = ANY($1::text[])
        `,
        [affectedSymbols],
      );
      const userIds = userIdsRes.rows.map((r: any) => Number(r.userId)).filter((n: number) => Number.isFinite(n));
      for (const userId of userIds) {
        try {
          void recalcAccount(userId, { emit: true, reason: "QUOTE_TICK" });
        } catch (err) {
          console.error(`Error recalculating account ${userId}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("[Feed] Error processing account updates:", error);
  }

  publishLiveEvent({ type: "quotes:updated" });
}

async function pullBatch() {
  await refreshDynamicSet();
  const wanted = [...new Set([...dynamicSet, ...ALL.slice(0, MAX_PER_REQ)])];
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += MAX_PER_REQ) {
    chunks.push(wanted.slice(i, i + MAX_PER_REQ));
  }

  for (const slice of chunks) {
    if (!API_KEY) {
      const simulated = generateSimulatedQuotes(slice);
      updateSnapshotCache(simulated);
      await persistQuotes(simulated, false);
      await onQuotesUpdated(
        simulated.map((q: any) => ({
          symbol: q.symbol,
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          isStale: false,
          lastUpdated: q.lastUpdated,
        })),
      );
      return;
    }

    try {
      const formattedSymbols = formatSymbolsForForgeAPI(slice);
      const response = await axios.get(`https://api.1forge.com/quotes?pairs=${formattedSymbols}&api_key=${API_KEY}`);
      let quotesData = response.data;
      if (quotesData && typeof quotesData === "object" && !Array.isArray(quotesData)) {
        if (quotesData.error || quotesData.message) {
          console.error("[1Forge] API Error:", quotesData.error || quotesData.message);
          continue;
        }
        if (quotesData.quotes) quotesData = quotesData.quotes;
      }

      if (!Array.isArray(quotesData) || quotesData.length === 0) {
        throw new Error("Empty 1Forge response");
      }

      const transformedData = quotesData
        .map((quote: any) => {
          const formattedSymbol = quote.s ? quote.s.replace("/", "") : quote.symbol ? quote.symbol.replace("/", "") : null;
          const price = quote.p ?? quote.price ?? quote.mid ?? 0;
          const bid = quote.b ?? quote.bid ?? price * 0.9999;
          const ask = quote.a ?? quote.ask ?? price * 1.0001;
          const apiTimestamp = typeof quote.t === "number" ? quote.t : typeof quote.timestamp === "number" ? quote.timestamp : null;
          const lastUpdated = apiTimestamp != null ? (apiTimestamp > 1e12 ? apiTimestamp : apiTimestamp * 1000) : Date.now();
          return {
            symbol: formattedSymbol,
            price,
            bid,
            ask,
            timestamp: Math.floor(lastUpdated / 1000),
            lastUpdated,
            isStale: false,
          };
        })
        .filter((q: any) => q.symbol && q.price);

      updateSnapshotCache(transformedData);
      await persistQuotes(transformedData, false);
      await onQuotesUpdated(
        transformedData.map((q: any) => ({
          symbol: q.symbol,
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          isStale: false,
          lastUpdated: q.lastUpdated,
        })),
      );
    } catch (e: any) {
      consecutiveApiFailures++;
      console.error("[1Forge] API failure:", e?.message || e);
      const simulated = generateSimulatedQuotes(slice);
      updateSnapshotCache(simulated.map((q) => ({ ...q, isStale: true })));
      await persistQuotes(simulated, true);
      await onQuotesUpdated(
        simulated.map((q: any) => ({
          symbol: q.symbol,
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          isStale: true,
          lastUpdated: q.lastUpdated,
        })),
      );
    }
  }
}

function schedulePoll() {
  pollTimerId = setTimeout(async () => {
    await throttle(pullBatch)();
    schedulePoll();
  }, dynamicConfig.pollIntervalMs);
}

async function startQuoteFeed() {
  dynamicConfig = await loadFeedConfig();
  console.log(`[FeedConfig] Initial: poll=${dynamicConfig.pollIntervalMs}ms, stale=${dynamicConfig.staleThresholdMs}ms`);
  await ensureMarketDailyCloseTable();
  await refreshDynamicSet();
  void pullBatch();
  schedulePoll();
}

void startQuoteFeed();

export default { pullBatch };
