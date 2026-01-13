// @ts-nocheck
import "dotenv/config";
import axios from "axios";
import pThrottle from "p-throttle";
import { db, dbClient } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { recalcAccount } from "../recalcAccount";
import { onQuotesUpdated } from "../engine/orderEngine";
import { computeSessionDayForQuote, ensureMarketDailyCloseTable } from "../utils/marketDailyClose";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import { getValkey } from "../services/valkey";

const API_KEY = process.env.FORGE_KEY;

const REST_LIMIT_PER_DAY = 100000;
const MAX_PER_REQ = 100;
const DEFAULT_POLL_MS = 870;
const DEFAULT_STALE_MS = 30000;
const QUOTE_SNAPSHOT_KEY = process.env.QUOTE_SNAPSHOT_KEY ?? "quotes:latest:v1";
const QUOTE_SNAPSHOT_TTL_SEC = Number(process.env.QUOTE_SNAPSHOT_TTL_SEC ?? 30);
const QUOTE_SYMBOL_TTL_SEC = Number(process.env.QUOTE_SYMBOL_TTL_SEC ?? 60);
const DEFAULT_SYMBOL_REFRESH_MS = 30000;
const SYMBOL_REFRESH_MS = Number(process.env.QUOTE_SYMBOL_REFRESH_MS ?? DEFAULT_SYMBOL_REFRESH_MS);
const SYMBOL_REFRESH_INTERVAL_MS =
  Number.isFinite(SYMBOL_REFRESH_MS) && SYMBOL_REFRESH_MS > 0 ? SYMBOL_REFRESH_MS : DEFAULT_SYMBOL_REFRESH_MS;
const QUOTE_DB_WRITE_MODE = String(process.env.QUOTE_DB_WRITE_MODE ?? "off").toLowerCase();
const QUOTE_DB_WRITE_INTERVAL_MS = Number(process.env.QUOTE_DB_WRITE_INTERVAL_MS ?? 60_000);
const DAILY_CLOSE_WRITE_INTERVAL_MS = Number(process.env.DAILY_CLOSE_WRITE_INTERVAL_MS ?? 60_000);
const ACCOUNT_RECALC_THROTTLE_MS = Number(process.env.ACCOUNT_RECALC_THROTTLE_MS ?? 3000);
const ACCOUNT_RECALC_BATCH_INTERVAL_MS = Number(process.env.ACCOUNT_RECALC_BATCH_INTERVAL_MS ?? 1000);

let dynamicConfig = {
  pollIntervalMs: DEFAULT_POLL_MS,
  staleThresholdMs: DEFAULT_STALE_MS,
  rolloverTz: "America/New_York",
  rolloverTime: "17:00",
};

let pollTimerId: ReturnType<typeof setTimeout> | null = null;
let lastDynamicSetRefresh = 0;
let quotesSeq = 0;
let lastQuoteDbWriteMs = 0;
let lastDailyCloseWriteMs = 0;
let lastAccountBatchMs = 0;
const lastAccountRecalcByUser = new Map<number, number>();

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

function updateSnapshotCache(quotes: any[], options: { markSuccess?: boolean } = {}) {
  const now = Date.now();
  for (const quote of quotes) {
    if (!quote?.symbol) continue;
    const updatedAt = typeof quote.lastUpdated === "number" ? quote.lastUpdated : now;
    const consecutiveFailures = typeof quote.consecutiveFailures === "number" ? quote.consecutiveFailures : 0;
    quoteSnapshotCache.set(quote.symbol, {
      symbol: quote.symbol,
      price: quote.price,
      bid: quote.bid,
      ask: quote.ask,
      lastUpdated: updatedAt,
      isStale: Boolean(quote.isStale),
      consecutiveFailures,
    });
  }
  if (options.markSuccess !== false) {
    lastSuccessfulApiCall = now;
    consecutiveApiFailures = 0;
  }
}

async function getActiveInstruments(): Promise<string[]> {
  try {
    const rows = await dbClient.query("SELECT symbol FROM symbol_configs WHERE enabled = true");
    return rows.rows.map((r: any) => String(r.symbol));
  } catch (error) {
    console.error("[Feed] Error getting active instruments:", error);
    return [];
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

  return [...new Set(formattedSymbols)].join(",");
}

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

function buildFallbackQuotes(symbols: string[]) {
  const now = Date.now();
  const cached: any[] = [];
  const missing: string[] = [];

  for (const symbol of symbols) {
    const cachedQuote = quoteSnapshotCache.get(symbol);
    if (!cachedQuote) {
      missing.push(symbol);
      continue;
    }

    const lastUpdated = typeof cachedQuote.lastUpdated === "number" ? cachedQuote.lastUpdated : now;
    cached.push({
      symbol,
      price: cachedQuote.price,
      bid: cachedQuote.bid,
      ask: cachedQuote.ask,
      timestamp: Math.floor(lastUpdated / 1000),
      lastUpdated,
      isStale: true,
      consecutiveFailures: consecutiveApiFailures,
    });
  }

  const simulated = missing.length
    ? generateSimulatedQuotes(missing).map((quote) => ({
        ...quote,
        isStale: true,
        consecutiveFailures: consecutiveApiFailures,
      }))
    : [];

  return [...cached, ...simulated];
}

type LiveQuoteRow = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  lastApiUpdate: number;
  isStale: boolean;
};

function toLiveQuoteRows(rows: any[], asOf: number, isStaleDefault: boolean): LiveQuoteRow[] {
  return rows
    .map((q) => {
      if (!q?.symbol) return null;
      const bid = typeof q.bid === "number" ? q.bid : null;
      const ask = typeof q.ask === "number" ? q.ask : null;
      const price =
        typeof q.price === "number"
          ? q.price
          : bid != null && ask != null
          ? (bid + ask) / 2
          : null;
      const lastApiUpdateRaw = typeof q.lastUpdated === "number" ? q.lastUpdated : typeof q.lastApiUpdate === "number" ? q.lastApiUpdate : asOf;
      const lastApiUpdate = lastApiUpdateRaw < 1e12 ? lastApiUpdateRaw * 1000 : lastApiUpdateRaw;
      return {
        symbol: String(q.symbol),
        bid,
        ask,
        price,
        lastApiUpdate,
        isStale: Boolean(q.isStale ?? isStaleDefault),
      };
    })
    .filter((row): row is LiveQuoteRow => Boolean(row && row.symbol));
}

async function persistSnapshotToValkey(rows: LiveQuoteRow[], meta: { seq: number; asOf: number; source: string }) {
  const v = getValkey();
  if (!v) return;
  const snapshotTtl = Number.isFinite(QUOTE_SNAPSHOT_TTL_SEC) && QUOTE_SNAPSHOT_TTL_SEC > 0 ? QUOTE_SNAPSHOT_TTL_SEC : 30;
  const symbolTtl = Number.isFinite(QUOTE_SYMBOL_TTL_SEC) && QUOTE_SYMBOL_TTL_SEC > 0 ? QUOTE_SYMBOL_TTL_SEC : 60;
  const payload = {
    seq: meta.seq,
    asOf: meta.asOf,
    source: meta.source,
    rows,
  };
  try {
    const pipeline = v.pipeline();
    pipeline.set(QUOTE_SNAPSHOT_KEY, JSON.stringify(payload), "EX", snapshotTtl);
    for (const row of rows) {
      pipeline.set(`q:v1:${row.symbol}`, JSON.stringify(row), "EX", symbolTtl);
    }
    await pipeline.exec();
  } catch {
    // ignore cache write failures
  }
}

async function publishQuoteUpdate(rows: any[], source: string, isStaleDefault: boolean) {
  const asOf = Date.now();
  const seq = ++quotesSeq;
  const liveRows = toLiveQuoteRows(rows, asOf, isStaleDefault);
  if (!liveRows.length) return;
  publishLiveEvent({
    type: "quotes:update",
    payload: { seq, asOf, source, rows: liveRows },
  });
  await persistSnapshotToValkey(liveRows, { seq, asOf, source });
}

async function refreshDynamicSet(force = false) {
  const now = Date.now();
  if (!force && now - lastDynamicSetRefresh < SYMBOL_REFRESH_INTERVAL_MS) return;
  const symbols = await getActiveInstruments();
  if (symbols.length) {
    dynamicSet = new Set(symbols);
  } else {
    dynamicSet = new Set();
    console.warn("[Feed] No enabled symbols found in symbol_configs; quote fetch paused.");
  }
  lastDynamicSetRefresh = now;
}

let symbolsRefreshInFlight: Promise<void> | null = null;

async function refreshSymbolsAndPull(reason: string) {
  if (symbolsRefreshInFlight) return symbolsRefreshInFlight;
  symbolsRefreshInFlight = (async () => {
    await refreshDynamicSet(true);
    if (dynamicSet.size === 0) return;
    console.log(`[Feed] symbols:updated (${reason}) -> refreshed ${dynamicSet.size} symbols`);
    await throttle(pullBatch)();
  })().finally(() => {
    symbolsRefreshInFlight = null;
  });
  return symbolsRefreshInFlight;
}

function uniqueSymbols(rows: any[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (!row?.symbol) continue;
    set.add(String(row.symbol));
  }
  return [...set];
}

async function persistQuotes(rows: any[], isStale: boolean) {
  if (!rows.length) return;
  const client = await dbClient.connect();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  try {
    await client.query("BEGIN");
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
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[Feed] Error persisting quotes:", error);
  } finally {
    client.release();
  }
}

async function persistDailyClose(rows: any[]) {
  if (!rows.length) return;
  const client = await dbClient.connect();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  try {
    await client.query("BEGIN");
    for (const q of rows) {
      if (!q?.symbol) continue;
      const lastUpdatedMs = typeof q.lastUpdated === "number" ? q.lastUpdated : nowMs;
      const bid = typeof q.bid === "number" ? q.bid : null;
      const ask = typeof q.ask === "number" ? q.ask : null;
      const mid = bid != null && ask != null ? (bid + ask) / 2 : typeof q.price === "number" ? q.price : null;
      if (!Number.isFinite(mid) || (mid as number) <= 0) continue;
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.warn("[market_daily_close] upsert failed:", error);
  } finally {
    client.release();
  }
}

async function maybePersistDailyClose(rows: any[]) {
  if (!rows.length) return;
  if (!Number.isFinite(DAILY_CLOSE_WRITE_INTERVAL_MS) || DAILY_CLOSE_WRITE_INTERVAL_MS <= 0) return;
  const now = Date.now();
  if (now - lastDailyCloseWriteMs < DAILY_CLOSE_WRITE_INTERVAL_MS) return;
  lastDailyCloseWriteMs = now;
  await persistDailyClose(rows);
}

async function maybePersistQuotes(rows: any[], isStale: boolean) {
  if (!rows.length) return;
  const mode = QUOTE_DB_WRITE_MODE;
  if (mode === "off" || mode === "false" || mode === "0") return;
  const now = Date.now();
  if (mode === "interval") {
    if (!Number.isFinite(QUOTE_DB_WRITE_INTERVAL_MS) || QUOTE_DB_WRITE_INTERVAL_MS <= 0) return;
    if (now - lastQuoteDbWriteMs < QUOTE_DB_WRITE_INTERVAL_MS) return;
  }
  lastQuoteDbWriteMs = now;
  await persistQuotes(rows, isStale);
}

async function notifyAccountsForSymbols(rows: any[], reason: string) {
  const affectedSymbols = uniqueSymbols(rows);
  if (!affectedSymbols.length) return;
  const now = Date.now();
  if (Number.isFinite(ACCOUNT_RECALC_BATCH_INTERVAL_MS) && ACCOUNT_RECALC_BATCH_INTERVAL_MS > 0) {
    if (now - lastAccountBatchMs < ACCOUNT_RECALC_BATCH_INTERVAL_MS) return;
  }
  lastAccountBatchMs = now;

  try {
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
      const last = lastAccountRecalcByUser.get(userId) ?? 0;
      if (Number.isFinite(ACCOUNT_RECALC_THROTTLE_MS) && ACCOUNT_RECALC_THROTTLE_MS > 0) {
        if (now - last < ACCOUNT_RECALC_THROTTLE_MS) continue;
      }
      lastAccountRecalcByUser.set(userId, now);
      try {
        void recalcAccount(userId, { emit: true, reason });
      } catch (err) {
        console.error(`Error recalculating account ${userId}:`, err);
      }
    }
  } catch (error) {
    console.error("[Feed] Error processing account updates:", error);
  }
}

async function pullBatch() {
  await refreshDynamicSet();
  const wanted = [...new Set([...dynamicSet])];
  if (wanted.length === 0) return;
  const chunks: string[][] = [];
  for (let i = 0; i < wanted.length; i += MAX_PER_REQ) {
    chunks.push(wanted.slice(i, i + MAX_PER_REQ));
  }

  for (const slice of chunks) {
    if (!API_KEY) {
      const simulated = generateSimulatedQuotes(slice);
      updateSnapshotCache(simulated);
      await maybePersistDailyClose(simulated);
      await maybePersistQuotes(simulated, false);
      await publishQuoteUpdate(simulated, "simulated", false);
      await notifyAccountsForSymbols(simulated, "QUOTE_TICK");
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
      await maybePersistDailyClose(transformedData);
      await maybePersistQuotes(transformedData, false);
      await publishQuoteUpdate(transformedData, "1forge", false);
      await notifyAccountsForSymbols(transformedData, "QUOTE_TICK");
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
      const fallbackQuotes = buildFallbackQuotes(slice);
      if (!fallbackQuotes.length) {
        console.warn("[1Forge] No fallback cache available; skipping quote persistence.");
        continue;
      }
      updateSnapshotCache(fallbackQuotes, { markSuccess: false });
      await maybePersistDailyClose(fallbackQuotes);
      await maybePersistQuotes(fallbackQuotes, true);
      await publishQuoteUpdate(fallbackQuotes, "fallback_cache", true);
      await notifyAccountsForSymbols(fallbackQuotes, "QUOTE_STALE");
      await onQuotesUpdated(
        fallbackQuotes.map((q: any) => ({
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
  await refreshDynamicSet(true);
  void pullBatch();
  schedulePoll();
}

onLiveEvent((event) => {
  if (event?.type !== "symbols:updated") return;
  void refreshSymbolsAndPull(String(event?.payload?.action ?? "updated"));
});

void startQuoteFeed();

export default { pullBatch };
