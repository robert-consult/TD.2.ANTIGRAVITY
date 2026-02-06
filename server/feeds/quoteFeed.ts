// @ts-nocheck
import "dotenv/config";
import pThrottle from "p-throttle";
import { db, dbClient } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { recalcAccount } from "../recalcAccount";
import { onQuotesUpdated } from "../engine/orderEngine";
import { computeSessionDayForQuote, ensureMarketDailyCloseTable } from "../utils/marketDailyClose";
import { onLiveEvent, publishLiveEvent } from "../services/liveBus";
import { getValkey, valkeyGetJson, writeToRollingBuffer, cachePrevClose, getCachedPrevClose } from "../services/valkey";
import { isMarketOpenForSymbol } from "../services/marketHours";
import { normalizeSymbol } from "./forgeUtils";
import { getActiveProviderSelection, invalidateActiveProviderCache } from "../marketdata/providerManager";
import type { ProviderSymbolInput } from "../marketdata/providerTypes";

const REST_LIMIT_PER_DAY = 100000;
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
let started = false;
let startPromise: Promise<void> | null = null;
let unsubscribeLiveBus: (() => void) | null = null;

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
let lastPublishedSource: string | null = null;
let lastPublishedAtMs = 0;
let lastProviderSuccessAtMs = 0;
let lastProviderSuccessKey: string | null = null;
let lastNoProviderLogAtMs = 0;
let lastNoProviderFallbackPublishAtMs = 0;
const NO_PROVIDER_THROTTLE_MS = 30_000;

export function getQuoteSnapshotCache(): Map<string, QuoteSnapshot> {
  return quoteSnapshotCache;
}

export function getCacheStats() {
  return {
    cacheSize: quoteSnapshotCache.size,
    lastSuccessfulApiCall,
    consecutiveApiFailures,
    staleCount: [...quoteSnapshotCache.values()].filter((q) => q.isStale).length,
    lastPublishedSource,
    lastPublishedAtMs,
    lastProviderSuccessAtMs,
    lastProviderSuccessKey,
  };
}

type PersistedValkeyQuoteRow = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  lastApiUpdate: number;
  isStale: boolean;
};

type PersistedValkeyQuoteSnapshot = {
  seq?: number;
  asOf?: number;
  source?: string;
  rows: PersistedValkeyQuoteRow[];
};

function normalizeEpochMs(value: unknown, fallbackMs: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallbackMs;
  return n < 1e12 ? n * 1000 : n;
}

async function loadPersistedValkeyQuoteRows(symbols: string[]): Promise<PersistedValkeyQuoteRow[]> {
  if (!symbols.length) return [];
  const v = getValkey();
  if (!v) return [];

  const keys = symbols.map((s) => `q:v1:${normalizeSymbol(s)}`);
  try {
    const values = await v.mget(...keys);
    const rows: PersistedValkeyQuoteRow[] = [];
    for (const raw of values) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed?.symbol) continue;
        rows.push({
          symbol: normalizeSymbol(parsed.symbol),
          bid: typeof parsed.bid === "number" ? parsed.bid : parsed.bid == null ? null : Number(parsed.bid),
          ask: typeof parsed.ask === "number" ? parsed.ask : parsed.ask == null ? null : Number(parsed.ask),
          price: typeof parsed.price === "number" ? parsed.price : parsed.price == null ? null : Number(parsed.price),
          lastApiUpdate: normalizeEpochMs(parsed.lastApiUpdate, Date.now()),
          isStale: Boolean(parsed.isStale),
        });
      } catch {
        // ignore malformed entries
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function loadPersistedDbQuoteRows(symbols: string[]) {
  if (!symbols.length) return [];
  try {
    const res = await dbClient.query(
      `
      SELECT symbol, price, bid, ask, last_api_update AS "lastApiUpdate", updated_at AS "updatedAt", is_stale AS "isStale"
      FROM quotes
      WHERE symbol = ANY($1::text[])
      `,
      [symbols.map((s) => normalizeSymbol(s))],
    );
    const nowMs = Date.now();
    return res.rows
      .map((row: any) => {
        if (!row?.symbol) return null;
        const symbol = normalizeSymbol(String(row.symbol));
        const lastUpdated = normalizeEpochMs(row.lastApiUpdate ?? row.updatedAt, nowMs);
        return {
          symbol,
          price: typeof row.price === "number" ? row.price : row.price == null ? null : Number(row.price),
          bid: typeof row.bid === "number" ? row.bid : row.bid == null ? null : Number(row.bid),
          ask: typeof row.ask === "number" ? row.ask : row.ask == null ? null : Number(row.ask),
          lastUpdated,
          isStale: Boolean(row.isStale),
          consecutiveFailures: 0,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function bootstrapQuoteSnapshotCacheFromPersistence(symbols: string[]) {
  if (!symbols.length) return;
  const wanted = new Set(symbols.map((s) => normalizeSymbol(s)));
  const nowMs = Date.now();

  // 1) Fast-path: Valkey snapshot payload
  const snapshot = await valkeyGetJson<PersistedValkeyQuoteSnapshot>(QUOTE_SNAPSHOT_KEY);
  if (snapshot?.rows?.length) {
    const rows = snapshot.rows
      .map((r) => {
        if (!r?.symbol) return null;
        const symbol = normalizeSymbol(String(r.symbol));
        if (!wanted.has(symbol)) return null;
        return {
          symbol,
          price: r.price,
          bid: r.bid,
          ask: r.ask,
          lastUpdated: normalizeEpochMs(r.lastApiUpdate, nowMs),
          isStale: Boolean(r.isStale),
          consecutiveFailures: 0,
        };
      })
      .filter(Boolean);

    if (rows.length) {
      updateSnapshotCache(rows, { markSuccess: false });
      console.log(`[Feed] Bootstrapped quoteSnapshotCache from Valkey snapshot (${rows.length} symbols)`);
      return;
    }
  }

  // 2) Fallback: Valkey per-symbol keys
  const valkeyRows = await loadPersistedValkeyQuoteRows(symbols);
  if (valkeyRows.length) {
    updateSnapshotCache(
      valkeyRows.map((r) => ({
        symbol: r.symbol,
        price: r.price,
        bid: r.bid,
        ask: r.ask,
        lastUpdated: normalizeEpochMs(r.lastApiUpdate, nowMs),
        isStale: Boolean(r.isStale),
        consecutiveFailures: 0,
      })),
      { markSuccess: false },
    );
    console.log(`[Feed] Bootstrapped quoteSnapshotCache from Valkey keys (${valkeyRows.length} symbols)`);
    return;
  }

  // 3) Last resort: DB quotes table
  const dbRows = await loadPersistedDbQuoteRows(symbols);
  if (dbRows.length) {
    updateSnapshotCache(dbRows, { markSuccess: false });
    console.log(`[Feed] Bootstrapped quoteSnapshotCache from DB (${dbRows.length} symbols)`);
  }
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
  try {
    invalidateActiveProviderCache();
    void refreshDynamicSet(true);
  } catch {
    // ignore provider cache invalidation failures
  }
}

function updateSnapshotCache(quotes: any[], options: { markSuccess?: boolean } = {}) {
  const now = Date.now();
  for (const quote of quotes) {
    if (!quote?.symbol) continue;
    const symbol = normalizeSymbol(String(quote.symbol));
    const updatedAt = normalizeEpochMs(quote.lastUpdated, now);
    const consecutiveFailures = typeof quote.consecutiveFailures === "number" ? quote.consecutiveFailures : 0;
    quoteSnapshotCache.set(symbol, {
      symbol,
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

type ActiveInstrumentRow = { symbol: string; providerSymbolMapJson: string | null };

async function getActiveInstruments(): Promise<ActiveInstrumentRow[]> {
  try {
    const rows = await dbClient.query("SELECT symbol, provider_symbol_map_json FROM symbol_configs WHERE enabled = true");
    return rows.rows.map((r: any) => ({
      symbol: String(r.symbol),
      providerSymbolMapJson: r.provider_symbol_map_json != null ? String(r.provider_symbol_map_json) : null,
    }));
  } catch (error) {
    console.error("[Feed] Error getting active instruments:", error);
    return [];
  }
}

let dynamicSet = new Set<string>();
let dynamicProviderKey: string | null = null;
let dynamicProviderSymbols: ProviderSymbolInput[] = [];
const throttle = pThrottle({ limit: REST_LIMIT_PER_DAY, interval: 86_400_000 });

function safeJsonParseObject(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as any;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

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

async function buildFallbackQuotes(symbols: string[]) {
  const now = Date.now();
  const cached: any[] = [];
  const missing: string[] = [];

  for (const symbol of symbols) {
    const sym = normalizeSymbol(symbol);
    if (!sym) continue;
    const cachedQuote = quoteSnapshotCache.get(sym);
    if (!cachedQuote) {
      missing.push(sym);
      continue;
    }

    const lastUpdated = typeof cachedQuote.lastUpdated === "number" ? cachedQuote.lastUpdated : now;
    cached.push({
      symbol: sym,
      price: cachedQuote.price,
      bid: cachedQuote.bid,
      ask: cachedQuote.ask,
      timestamp: Math.floor(lastUpdated / 1000),
      lastUpdated,
      isStale: true,
      consecutiveFailures: consecutiveApiFailures,
    });
  }

  if (!missing.length) return cached;

  const recoveredForCache: any[] = [];
  const recoveredForPublish: any[] = [];

  // Prefer Valkey's per-symbol keys (fast + survives process restarts).
  const valkeyRows = await loadPersistedValkeyQuoteRows(missing);
  const valkeyFound = new Set<string>();
  for (const row of valkeyRows) {
    if (!row?.symbol) continue;
    valkeyFound.add(row.symbol);
    const lastUpdated = normalizeEpochMs(row.lastApiUpdate, now);
    recoveredForCache.push({
      symbol: row.symbol,
      price: row.price,
      bid: row.bid,
      ask: row.ask,
      lastUpdated,
      isStale: Boolean(row.isStale),
      consecutiveFailures: 0,
    });
    recoveredForPublish.push({
      symbol: row.symbol,
      price: row.price,
      bid: row.bid,
      ask: row.ask,
      timestamp: Math.floor(lastUpdated / 1000),
      lastUpdated,
      isStale: true,
      consecutiveFailures: consecutiveApiFailures,
    });
  }

  const stillMissing = missing.filter((sym) => !valkeyFound.has(sym));
  if (stillMissing.length) {
    const dbRows = await loadPersistedDbQuoteRows(stillMissing);
    if (dbRows.length) {
      recoveredForCache.push(...dbRows);
      for (const row of dbRows) {
        const lastUpdated = normalizeEpochMs(row.lastUpdated, now);
        recoveredForPublish.push({
          symbol: row.symbol,
          price: row.price,
          bid: row.bid,
          ask: row.ask,
          timestamp: Math.floor(lastUpdated / 1000),
          lastUpdated,
          isStale: true,
          consecutiveFailures: consecutiveApiFailures,
        });
      }
    }
  }

  if (recoveredForCache.length) {
    updateSnapshotCache(recoveredForCache, { markSuccess: false });
  }

  // Never synthesize random prices on API failures; if we cannot recover anything, skip the batch.
  const recovered = recoveredForPublish.filter((q) => {
    if (!q?.symbol) return false;
    return typeof q.price === "number" || typeof q.bid === "number" || typeof q.ask === "number";
  });

  return [...cached, ...recovered];
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
      const symbol = normalizeSymbol(String(q.symbol));
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
        symbol,
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
  lastPublishedSource = source;
  lastPublishedAtMs = asOf;
  publishLiveEvent({
    type: "quotes:update",
    payload: { seq, asOf, source, rows: liveRows },
  });
  await persistSnapshotToValkey(liveRows, { seq, asOf, source });
}

async function handleQuoteBatch(
  rows: any[],
  source: string,
  isStaleDefault: boolean,
  options: { markSuccess?: boolean; reason?: string } = {},
) {
  if (!rows.length) return;
  updateSnapshotCache(rows, { markSuccess: options.markSuccess });

  // Write to rolling buffer for recovery
  await writeToRollingBufferBatch(rows);

  await maybePersistDailyClose(rows);
  await maybePersistQuotes(rows, isStaleDefault);
  await publishQuoteUpdate(rows, source, isStaleDefault);
  await notifyAccountsForSymbols(rows, options.reason ?? (isStaleDefault ? "QUOTE_STALE" : "QUOTE_TICK"));
  await onQuotesUpdated(
    rows.map((q: any) => ({
      symbol: q.symbol,
      price: q.price,
      bid: q.bid,
      ask: q.ask,
      isStale: Boolean(q.isStale ?? isStaleDefault),
      lastUpdated: q.lastUpdated,
    })),
  );
}

/**
 * Write a batch of quotes to rolling buffers.
 */
async function writeToRollingBufferBatch(rows: any[]) {
  const promises = rows.map((q) => {
    if (!q?.symbol) return Promise.resolve(false);
    return writeToRollingBuffer(q.symbol, {
      bid: typeof q.bid === "number" ? q.bid : null,
      ask: typeof q.ask === "number" ? q.ask : null,
      price: typeof q.price === "number" ? q.price : null,
      lastApiUpdate: typeof q.lastUpdated === "number" ? q.lastUpdated : Date.now(),
    });
  });
  await Promise.all(promises);
}

async function refreshDynamicSet(force = false) {
  const now = Date.now();
  if (!force && now - lastDynamicSetRefresh < SYMBOL_REFRESH_INTERVAL_MS) return;
  const selection = await getActiveProviderSelection();
  const providerKey = selection?.providerKey ?? null;
  const provider = selection?.provider ?? null;

  const rows = await getActiveInstruments();
  if (!rows.length) {
    dynamicSet = new Set();
    dynamicProviderKey = providerKey;
    dynamicProviderSymbols = [];
    console.warn("[Feed] No enabled symbols found in symbol_configs; quote fetch paused.");
    lastDynamicSetRefresh = now;
    return;
  }

  const nextSet = new Set<string>();
  const nextMapped: ProviderSymbolInput[] = [];

  for (const r of rows) {
    const canonical = normalizeSymbol(r.symbol);
    if (!canonical) continue;
    nextSet.add(canonical);

    if (!providerKey || !provider) continue;
    const map = safeJsonParseObject(r.providerSymbolMapJson);
    const override = map && typeof map[providerKey] === "string" ? String(map[providerKey]).trim() : "";
    const providerSymbol =
      override ||
      (typeof (provider as any).mapSymbol === "function" ? (provider as any).mapSymbol(canonical) : canonical);
    if (!providerSymbol) continue;
    nextMapped.push({ canonicalSymbol: canonical, providerSymbol: String(providerSymbol) });
  }

  dynamicSet = nextSet;
  dynamicProviderKey = providerKey;
  dynamicProviderSymbols = nextMapped;
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
      const result = await client.query(
        `
        INSERT INTO market_daily_close (symbol, session_day, close, close_ts_ms, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (symbol, session_day) DO NOTHING
        RETURNING symbol
        `,
        [q.symbol, sessionDay, mid, lastUpdatedMs, nowSec],
      );
      // If a new session close was inserted, cache it as prevClose for next session
      if (result.rowCount && result.rowCount > 0) {
        await cachePrevClose(q.symbol, mid as number);
      }
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

  const selection = await getActiveProviderSelection();
  if (!selection) {
    const quoteSource = String(process.env.QUOTE_SOURCE ?? "").toLowerCase();
    const allowSimulated =
      process.env.NODE_ENV !== "production" ||
      process.env.ALLOW_SIMULATED_QUOTES === "true" ||
      quoteSource === "simulated";
    if (!allowSimulated) {
      const now = Date.now();
      if (now - lastNoProviderFallbackPublishAtMs < NO_PROVIDER_THROTTLE_MS) return;
      lastNoProviderFallbackPublishAtMs = now;
      const fallbackQuotes = await buildFallbackQuotes(wanted);
      if (!fallbackQuotes.length) {
        if (now - lastNoProviderLogAtMs >= NO_PROVIDER_THROTTLE_MS) {
          lastNoProviderLogAtMs = now;
          console.error(
            "[Feed] No active quote provider configured; simulated quotes disabled in production and no fallback cache is available.",
          );
        }
        return;
      }
      await handleQuoteBatch(fallbackQuotes, "fallback_cache", true, { markSuccess: false, reason: "NO_PROVIDER" });
      return;
    }

    const simulated = generateSimulatedQuotes(wanted);
    await handleQuoteBatch(simulated, "simulated", false);
    return;
  }

  if (dynamicProviderKey !== selection.providerKey) {
    await refreshDynamicSet(true);
  }

  const providerKey = selection.providerKey;
  const provider = selection.provider;

  function toFeedRows(providerQuotes: any[]) {
    const nowMs = Date.now();
    const staleThresholdMs =
      Number.isFinite(dynamicConfig.staleThresholdMs) && dynamicConfig.staleThresholdMs > 0
        ? dynamicConfig.staleThresholdMs
        : DEFAULT_STALE_MS;

    return (providerQuotes || [])
      .map((q: any) => {
        const symbol = normalizeSymbol(q?.canonicalSymbol ?? q?.symbol);
        if (!symbol) return null;
        const bid = typeof q?.bid === "number" ? q.bid : q?.bid == null ? null : Number(q.bid);
        const ask = typeof q?.ask === "number" ? q.ask : q?.ask == null ? null : Number(q.ask);
        const price =
          typeof q?.price === "number"
            ? q.price
            : q?.price == null
              ? bid != null && ask != null
                ? (bid + ask) / 2
                : null
              : Number(q.price);

        if (price == null || !Number.isFinite(price)) return null;
        const lastUpdated = typeof q?.tsMs === "number" ? q.tsMs : typeof q?.lastUpdated === "number" ? q.lastUpdated : nowMs;
        const ageMs = nowMs - lastUpdated;
        const marketOpen = isMarketOpenForSymbol(symbol, new Date(nowMs));
        return {
          symbol,
          price,
          bid: bid != null && Number.isFinite(bid) ? bid : null,
          ask: ask != null && Number.isFinite(ask) ? ask : null,
          timestamp: Math.floor(lastUpdated / 1000),
          lastUpdated,
          isStale: marketOpen && ageMs > staleThresholdMs,
        };
      })
      .filter(Boolean);
  }

  const mapped = dynamicProviderKey === providerKey ? dynamicProviderSymbols : [];
  if (!mapped.length) {
    const fallbackQuotes = await buildFallbackQuotes(wanted);
    if (!fallbackQuotes.length) {
      console.warn(`[Feed] Active provider ${providerKey} has no supported symbols and no fallback cache available.`);
      return;
    }
    await handleQuoteBatch(fallbackQuotes, "fallback_cache", true, { markSuccess: false, reason: "QUOTE_UNSUPPORTED" });
    return;
  }

  const mappedCanonical = new Set(mapped.map((m) => m.canonicalSymbol));
  const missingForProvider = wanted.filter((sym) => !mappedCanonical.has(sym));

  const maxPerReq = Math.max(1, Number((provider as any).maxBatchSymbols ?? 50) || 50);
  const chunks: ProviderSymbolInput[][] = [];
  for (let i = 0; i < mapped.length; i += maxPerReq) {
    chunks.push(mapped.slice(i, i + maxPerReq));
  }

  for (const chunk of chunks) {
    try {
      const result = await provider.fetchQuotes({ symbols: chunk });
      const rows = toFeedRows(result?.quotes ?? []);
      if (!rows.length) throw new Error("EMPTY_PROVIDER_RESPONSE");
      await handleQuoteBatch(rows, providerKey, false);
      lastProviderSuccessAtMs = Date.now();
      lastProviderSuccessKey = providerKey;
    } catch (e: any) {
      consecutiveApiFailures++;
      console.error(`[Feed] Provider ${providerKey} failure:`, e?.message || e);
      const fallbackQuotes = await buildFallbackQuotes(chunk.map((s) => s.canonicalSymbol));
      if (!fallbackQuotes.length) {
        console.warn(`[Feed] No fallback cache available for provider ${providerKey} failure.`);
        continue;
      }
      await handleQuoteBatch(fallbackQuotes, "fallback_cache", true, { markSuccess: false, reason: "QUOTE_STALE" });
    }
  }

  if (missingForProvider.length) {
    const fallbackQuotes = await buildFallbackQuotes(missingForProvider);
    if (fallbackQuotes.length) {
      await handleQuoteBatch(fallbackQuotes, "fallback_cache", true, { markSuccess: false, reason: "QUOTE_UNSUPPORTED" });
    }
  }
}

function schedulePoll() {
  pollTimerId = setTimeout(async () => {
    await throttle(pullBatch)();
    schedulePoll();
  }, dynamicConfig.pollIntervalMs);
}

export async function startQuoteFeed(): Promise<void> {
  if (started) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    dynamicConfig = await loadFeedConfig();
    console.log(
      `[FeedConfig] Initial: poll=${dynamicConfig.pollIntervalMs}ms, stale=${dynamicConfig.staleThresholdMs}ms`,
    );

    await ensureMarketDailyCloseTable();
    await refreshDynamicSet(true);
    await bootstrapQuoteSnapshotCacheFromPersistence([...dynamicSet]);

    if (!unsubscribeLiveBus) {
      unsubscribeLiveBus = onLiveEvent((event) => {
        if (!event || typeof event !== "object") return;
        if (event.type === "symbols:updated") {
          void refreshSymbolsAndPull(String(event?.payload?.action ?? "updated"));
          return;
        }
        if (event.type === "feed:config-updated") {
          void (async () => {
            await reloadFeedConfig();
            await refreshSymbolsAndPull("feed:config-updated");
          })();
          return;
        }
        if (event.type === "market-data:providers-updated") {
          void refreshSymbolsAndPull("market-data:providers-updated");
          return;
        }
      });
    }

    void pullBatch();
    schedulePoll();
    started = true;
  })().catch((err) => {
    startPromise = null;
    started = false;
    throw err;
  });

  return startPromise;
}

export default { pullBatch };
