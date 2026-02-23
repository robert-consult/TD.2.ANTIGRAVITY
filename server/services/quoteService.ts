/**
 * Quote Service - Server-authoritative quote retrieval for trade execution
 * Replaces client-supplied prices with server-side quotes
 */

import { db } from "@db";
import { globalSettings, quotes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isMarketOpenForSymbol } from "./marketHours";
import { getQuote, getValkeyQuoteRows } from "./quoteHub";
import { getFromRollingBuffer, getCachedPrevClose } from "./valkey";

// Quote freshness: 5 minutes default to accommodate 1Forge refresh intervals
const STALE_AFTER_MS = Number(process.env.QUOTE_STALE_AFTER_MS ?? 300_000);
const MARKET_HOURS_CACHE_TTL_MS = Number(process.env.MARKET_HOURS_CACHE_TTL_MS ?? 15_000);
const QUOTE_EXEC_ALLOW_DB_FALLBACK = ["1", "true", "yes", "on"].includes(
  String(process.env.QUOTE_EXEC_ALLOW_DB_FALLBACK ?? "0").trim().toLowerCase(),
);
const QUOTE_REVALIDATE_MAX_AGE_MS = Number(process.env.QUOTE_REVALIDATE_MAX_AGE_MS ?? STALE_AFTER_MS);
const QUOTE_REVALIDATE_TS_REGRESSION_GRACE_MS = Number(process.env.QUOTE_REVALIDATE_TS_REGRESSION_GRACE_MS ?? 1_000);
const QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS = Number(process.env.QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS ?? 150);
const QUOTE_REVALIDATE_ALLOW_EXPECTED_QUOTE_FALLBACK = !["0", "false", "off", "no"].includes(
  String(process.env.QUOTE_REVALIDATE_ALLOW_EXPECTED_QUOTE_FALLBACK ?? "1").trim().toLowerCase(),
);
const QUOTE_REVALIDATE_MIN_AGE_MS = 250;
const QUOTE_REVALIDATE_MAX_AGE_MS_CAP = 1_800_000;
const QUOTE_REVALIDATE_MAX_DRIFT_BPS_CAP = 10_000;

type MarketHoursConfig = {
  allowWeekendTrading: boolean;
  openMins: number | null;
  closeMins: number | null;
};

let cachedMarketHours: { fetchedAtMs: number; value: MarketHoursConfig } | null = null;
let marketHoursInflight: Promise<MarketHoursConfig | null> | null = null;

function normalizeSymbol(s: string): string {
  return s.replace("/", "").trim().toUpperCase();
}

function normalizeSource(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  return value || fallback;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTimeToMinutes(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function isMarketOpenByConfig(cfg: MarketHoursConfig, at: Date): boolean {
  const dayOfWeek = at.getUTCDay(); // 0=Sun ... 6=Sat
  if (!cfg.allowWeekendTrading && (dayOfWeek === 0 || dayOfWeek === 6)) return false;

  const openMins = cfg.openMins;
  const closeMins = cfg.closeMins;
  if (openMins === null || closeMins === null) return false;

  const currentMins = at.getUTCHours() * 60 + at.getUTCMinutes();

  // Overnight market: close < open means next day
  if (closeMins < openMins) {
    return currentMins >= openMins || currentMins < closeMins;
  }

  return currentMins >= openMins && currentMins < closeMins;
}

async function getMarketHoursConfig(): Promise<MarketHoursConfig | null> {
  const now = Date.now();
  if (cachedMarketHours && now - cachedMarketHours.fetchedAtMs < MARKET_HOURS_CACHE_TTL_MS) {
    return cachedMarketHours.value;
  }

  if (marketHoursInflight) return marketHoursInflight;

  marketHoursInflight = (async () => {
    try {
      const row = await db.query.globalSettings.findFirst({ where: eq(globalSettings.id, 1) });
      if (!row) return cachedMarketHours?.value ?? null;

      const marketOpenTime = String(row.marketOpenTime ?? "00:00");
      const marketCloseTime = String(row.marketCloseTime ?? "23:59");
      const value: MarketHoursConfig = {
        allowWeekendTrading: Boolean(row.allowWeekendTrading),
        openMins: parseTimeToMinutes(marketOpenTime),
        closeMins: parseTimeToMinutes(marketCloseTime),
      };
      cachedMarketHours = { fetchedAtMs: Date.now(), value };
      return value;
    } catch {
      return cachedMarketHours?.value ?? null;
    } finally {
      marketHoursInflight = null;
    }
  })();

  return marketHoursInflight;
}

async function isMarketOpenForExecution(symbol: string, at: Date): Promise<boolean> {
  const cfg = await getMarketHoursConfig();
  if (cfg) return isMarketOpenByConfig(cfg, at);
  return isMarketOpenForSymbol(symbol, at);
}

export type ExecutionQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteTs: Date;
  source: string;
  isStale: boolean;
  marketOpen: boolean;
  execPrice: number;
};

type ExecutionSide = "BUY" | "SELL";
type ExecutionAction = "OPEN" | "CLOSE";

type NormalizedExecutionQuote = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  quoteTsMs: number;
  isStale: boolean;
};

function clampRevalidateAgeMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.max(
      QUOTE_REVALIDATE_MIN_AGE_MS,
      Math.min(QUOTE_REVALIDATE_MAX_AGE_MS_CAP, Math.max(1, STALE_AFTER_MS)),
    );
  }
  return Math.max(QUOTE_REVALIDATE_MIN_AGE_MS, Math.min(QUOTE_REVALIDATE_MAX_AGE_MS_CAP, Math.trunc(n)));
}

function clampRevalidateDriftBps(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(QUOTE_REVALIDATE_MAX_DRIFT_BPS_CAP, n));
}

function quoteTsMsFromRow(row: any, nowMs: number): number {
  const lastApiRaw =
    toNum((row as any).lastApiUpdate ?? (row as any).last_api_update) ??
    toNum((row as any).updatedAt ?? (row as any).updated_at);
  if (lastApiRaw == null) return nowMs;
  return lastApiRaw < 1e12 ? lastApiRaw * 1000 : lastApiRaw;
}

function normalizeQuoteForExecution(symbol: string, row: any, nowMs: number): NormalizedExecutionQuote | null {
  const bid = toNum(row?.bid);
  const ask = toNum(row?.ask);
  const px = toNum(row?.price);
  const usableBid = bid ?? px;
  const usableAsk = ask ?? px;
  if (usableBid == null || usableAsk == null) return null;

  const quoteTsMs = quoteTsMsFromRow(row, nowMs);
  const ageMs = Math.max(0, nowMs - quoteTsMs);
  const isStale =
    Boolean((row as any).isStale ?? (row as any).is_stale) ||
    quoteTsMs <= 0 ||
    ageMs > STALE_AFTER_MS;

  return {
    symbol: normalizeSymbol(symbol),
    bid: usableBid,
    ask: usableAsk,
    mid: (usableBid + usableAsk) / 2,
    spread: usableAsk - usableBid,
    quoteTsMs,
    isStale,
  };
}

function computeExecutionPrice(
  quote: Pick<NormalizedExecutionQuote, "bid" | "ask">,
  side: ExecutionSide,
  action: ExecutionAction,
): number {
  return action === "OPEN"
    ? (side === "BUY" ? quote.ask : quote.bid)
    : (side === "BUY" ? quote.bid : quote.ask);
}

// Fallback chain: Hub → Valkey Snapshot → Rolling Buffer → prevClose → (optional) DB
export async function getLatestQuoteRow(symbol: string): Promise<any | null> {
  const sym = normalizeSymbol(symbol);

  // 1. Try in-memory hub (fastest)
  const hubQuote = getQuote(sym);
  if (hubQuote) {
    return {
      symbol: sym,
      bid: hubQuote.bid,
      ask: hubQuote.ask,
      price: hubQuote.price,
      lastApiUpdate: hubQuote.lastApiUpdate,
      isStale: hubQuote.isStale,
      prevClose: hubQuote.prevClose,
      source: normalizeSource((hubQuote as any).source, "quote_hub"),
    };
  }

  // 2. Try Valkey snapshot
  const valkeyRows = await getValkeyQuoteRows([sym]);
  if (valkeyRows.length) {
    const cached = valkeyRows[0];
    return {
      symbol: sym,
      bid: cached.bid,
      ask: cached.ask,
      price: cached.price,
      lastApiUpdate: cached.lastApiUpdate,
      isStale: cached.isStale,
      source: normalizeSource((cached as any).source, "valkey_cache"),
    };
  }

  // 3. Try rolling buffer (30-second history)
  const rollingQuote = await getFromRollingBuffer(sym);
  if (rollingQuote && rollingQuote.price != null) {
    return {
      symbol: sym,
      bid: rollingQuote.bid,
      ask: rollingQuote.ask,
      price: rollingQuote.price,
      lastApiUpdate: rollingQuote.lastApiUpdate,
      isStale: true, // Mark as stale since we're falling back
      source: normalizeSource((rollingQuote as any).source, "rolling_buffer"),
    };
  }

  // 4. Use prevClose as price (better than nothing for risk-aware execution paths)
  const prevClose = await getCachedPrevClose(sym);
  if (prevClose != null) {
    return {
      symbol: sym,
      bid: prevClose,
      ask: prevClose,
      price: prevClose,
      lastApiUpdate: Date.now(),
      isStale: true,
      isPrevCloseFallback: true,
      source: "prev_close_cache",
    };
  }

  // 5. Optional last-resort database fallback (off by default to protect hot-path latency)
  if (QUOTE_EXEC_ALLOW_DB_FALLBACK) {
    const row = await db.query.quotes.findFirst({
      where: eq(quotes.symbol, sym),
    });
    if (row) {
      return {
        ...row,
        source: normalizeSource((row as any).source, "quotes_db"),
      };
    }
  }

  return null;
}

export async function getExecutionQuote(symbol: string, side: ExecutionSide, action: ExecutionAction): Promise<ExecutionQuote> {
  const sym = normalizeSymbol(symbol);
  const row = await getLatestQuoteRow(sym);
  if (!row) throw new Error(`QUOTE_NOT_FOUND:${sym}`);
  const now = Date.now();
  const normalized = normalizeQuoteForExecution(sym, row, now);
  if (!normalized) throw new Error(`QUOTE_INVALID:${sym}`);

  const marketOpen = await isMarketOpenForExecution(sym, new Date());
  const execPrice = computeExecutionPrice(normalized, side, action);

  return {
    symbol: sym,
    bid: normalized.bid,
    ask: normalized.ask,
    mid: normalized.mid,
    spread: normalized.spread,
    quoteTs: new Date(normalized.quoteTsMs),
    source: normalizeSource((row as any).source, process.env.QUOTE_SOURCE ?? "quote_feed"),
    isStale: normalized.isStale,
    marketOpen,
    execPrice,
  };
}

export type ExecutionQuoteCommitValidation = {
  ok: boolean;
  code:
    | "OK"
    | "QUOTE_NOT_FOUND_AT_COMMIT"
    | "QUOTE_INVALID_AT_COMMIT"
    | "QUOTE_STALE_AT_COMMIT"
    | "QUOTE_TS_REGRESSED"
    | "QUOTE_PRICE_DRIFT";
  symbol: string;
  checkedAtMs: number;
  expectedQuoteTsMs: number;
  latestQuoteTsMs: number | null;
  ageMs: number | null;
  expectedExecPrice: number;
  latestExecPrice: number | null;
  driftAbs: number | null;
  driftBps: number | null;
  latestIsStale: boolean;
  usedExpectedQuoteFallback: boolean;
};

export async function validateExecutionQuoteAtCommit(params: {
  symbol: string;
  side: ExecutionSide;
  action: ExecutionAction;
  expectedQuoteTs: Date;
  expectedExecPrice: number;
  maxAgeMs?: number;
  maxExecPriceDriftBps?: number;
}): Promise<ExecutionQuoteCommitValidation> {
  const sym = normalizeSymbol(params.symbol);
  const checkedAtMs = Date.now();
  const expectedQuoteTsRaw = params.expectedQuoteTs?.getTime?.();
  const expectedQuoteTsMs = Number.isFinite(expectedQuoteTsRaw) ? Number(expectedQuoteTsRaw) : checkedAtMs;
  const expectedAgeMs = Math.max(0, checkedAtMs - expectedQuoteTsMs);
  const maxAgeMs = clampRevalidateAgeMs(
    Number.isFinite(Number(params.maxAgeMs)) ? params.maxAgeMs : QUOTE_REVALIDATE_MAX_AGE_MS,
  );
  const maxExecPriceDriftBps = clampRevalidateDriftBps(
    Number.isFinite(Number(params.maxExecPriceDriftBps))
      ? params.maxExecPriceDriftBps
      : QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS,
  );
  const expectedExecPrice = Number(params.expectedExecPrice);

  const buildResult = (
    partial: Omit<ExecutionQuoteCommitValidation, "symbol" | "checkedAtMs" | "expectedQuoteTsMs" | "expectedExecPrice">,
  ): ExecutionQuoteCommitValidation => ({
    symbol: sym,
    checkedAtMs,
    expectedQuoteTsMs,
    expectedExecPrice,
    ...partial,
  });

  if (!Number.isFinite(expectedExecPrice) || expectedExecPrice <= 0) {
    return buildResult({
      ok: false,
      code: "QUOTE_INVALID_AT_COMMIT",
      latestQuoteTsMs: null,
      ageMs: null,
      latestExecPrice: null,
      driftAbs: null,
      driftBps: null,
      latestIsStale: true,
      usedExpectedQuoteFallback: false,
    });
  }

  const row = await getLatestQuoteRow(sym);
  if (!row) {
    if (QUOTE_REVALIDATE_ALLOW_EXPECTED_QUOTE_FALLBACK && expectedAgeMs <= maxAgeMs) {
      return buildResult({
        ok: true,
        code: "OK",
        latestQuoteTsMs: expectedQuoteTsMs,
        ageMs: expectedAgeMs,
        latestExecPrice: expectedExecPrice,
        driftAbs: 0,
        driftBps: 0,
        latestIsStale: false,
        usedExpectedQuoteFallback: true,
      });
    }
    return buildResult({
      ok: false,
      code: "QUOTE_NOT_FOUND_AT_COMMIT",
      latestQuoteTsMs: null,
      ageMs: null,
      latestExecPrice: null,
      driftAbs: null,
      driftBps: null,
      latestIsStale: true,
      usedExpectedQuoteFallback: false,
    });
  }

  const normalized = normalizeQuoteForExecution(sym, row, checkedAtMs);
  if (!normalized) {
    if (QUOTE_REVALIDATE_ALLOW_EXPECTED_QUOTE_FALLBACK && expectedAgeMs <= maxAgeMs) {
      return buildResult({
        ok: true,
        code: "OK",
        latestQuoteTsMs: expectedQuoteTsMs,
        ageMs: expectedAgeMs,
        latestExecPrice: expectedExecPrice,
        driftAbs: 0,
        driftBps: 0,
        latestIsStale: false,
        usedExpectedQuoteFallback: true,
      });
    }
    return buildResult({
      ok: false,
      code: "QUOTE_INVALID_AT_COMMIT",
      latestQuoteTsMs: null,
      ageMs: null,
      latestExecPrice: null,
      driftAbs: null,
      driftBps: null,
      latestIsStale: true,
      usedExpectedQuoteFallback: false,
    });
  }

  const ageMs = Math.max(0, checkedAtMs - normalized.quoteTsMs);
  const latestExecPrice = computeExecutionPrice(normalized, params.side, params.action);
  const driftAbsRaw = Math.abs(latestExecPrice - expectedExecPrice);
  const driftAbs = Number.isFinite(driftAbsRaw) ? driftAbsRaw : null;
  const driftBps =
    Number.isFinite(expectedExecPrice) && expectedExecPrice > 0 && driftAbs != null
      ? (driftAbs / expectedExecPrice) * 10_000
      : null;

  if (normalized.isStale || ageMs > maxAgeMs) {
    return buildResult({
      ok: false,
      code: "QUOTE_STALE_AT_COMMIT",
      latestQuoteTsMs: normalized.quoteTsMs,
      ageMs,
      latestExecPrice,
      driftAbs,
      driftBps,
      latestIsStale: normalized.isStale,
      usedExpectedQuoteFallback: false,
    });
  }

  if (normalized.quoteTsMs + QUOTE_REVALIDATE_TS_REGRESSION_GRACE_MS < expectedQuoteTsMs) {
    return buildResult({
      ok: false,
      code: "QUOTE_TS_REGRESSED",
      latestQuoteTsMs: normalized.quoteTsMs,
      ageMs,
      latestExecPrice,
      driftAbs,
      driftBps,
      latestIsStale: normalized.isStale,
      usedExpectedQuoteFallback: false,
    });
  }

  const quoteAdvancedAtCommit = normalized.quoteTsMs > expectedQuoteTsMs + QUOTE_REVALIDATE_TS_REGRESSION_GRACE_MS;
  if (
    quoteAdvancedAtCommit &&
    maxExecPriceDriftBps > 0 &&
    driftBps != null &&
    Number.isFinite(driftBps) &&
    driftBps > maxExecPriceDriftBps
  ) {
    return buildResult({
      ok: false,
      code: "QUOTE_PRICE_DRIFT",
      latestQuoteTsMs: normalized.quoteTsMs,
      ageMs,
      latestExecPrice,
      driftAbs,
      driftBps,
      latestIsStale: normalized.isStale,
      usedExpectedQuoteFallback: false,
    });
  }

  return buildResult({
    ok: true,
    code: "OK",
    latestQuoteTsMs: normalized.quoteTsMs,
    ageMs,
    latestExecPrice,
    driftAbs,
    driftBps,
    latestIsStale: normalized.isStale,
    usedExpectedQuoteFallback: false,
  });
}

// FX conversion (quoteCurrency -> USD) using available pairs in quotes table
export async function getConversionRate(fromCcy: string, toCcy: string): Promise<number> {
  const from = fromCcy.toUpperCase();
  const to = toCcy.toUpperCase();
  if (from === to) return 1;

  const direct = await getLatestQuoteRow(from + to);
  if (direct) {
    const b = toNum(direct.bid) ?? toNum(direct.price);
    const a = toNum(direct.ask) ?? toNum(direct.price);
    if (b !== null && a !== null) return (a + b) / 2;
  }

  const inverse = await getLatestQuoteRow(to + from);
  if (inverse) {
    const b = toNum(inverse.bid) ?? toNum(inverse.price);
    const a = toNum(inverse.ask) ?? toNum(inverse.price);
    if (b !== null && a !== null) return 1 / ((a + b) / 2);
  }

  // Bridge via USD
  if (from !== "USD" && to !== "USD") {
    return (await getConversionRate(from, "USD")) * (await getConversionRate("USD", to));
  }

  // Fallback rates for common currencies if quote not found
  const fallbackRates: Record<string, number> = {
    'JPY': 0.0067,  // 1 JPY = ~0.0067 USD
    'EUR': 1.09,    // 1 EUR = ~1.09 USD
    'GBP': 1.27,    // 1 GBP = ~1.27 USD
    'AUD': 0.65,    // 1 AUD = ~0.65 USD
    'USD': 1.0,
  };

  if (to === "USD" && fallbackRates[from]) {
    return fallbackRates[from];
  }
  if (from === "USD" && fallbackRates[to]) {
    return 1 / fallbackRates[to];
  }

  throw new Error(`FX_CONVERSION_MISSING:${from}->${to}`);
}
