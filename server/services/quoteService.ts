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

// Get a fresh database connection for each query to avoid locking issues
// Fallback chain: Hub → Valkey Snapshot → Rolling Buffer → DB → prevClose
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
    };
  }

  // 4. Try database
  const row = await db.query.quotes.findFirst({
    where: eq(quotes.symbol, sym),
  });
  if (row) return row;

  // 5. Last resort: use prevClose as price (better than nothing)
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
    };
  }

  return null;
}

export async function getExecutionQuote(symbol: string, side: "BUY" | "SELL", action: "OPEN" | "CLOSE"): Promise<ExecutionQuote> {
  const sym = normalizeSymbol(symbol);
  const row = await getLatestQuoteRow(sym);
  if (!row) throw new Error(`QUOTE_NOT_FOUND:${sym}`);

  const bid = toNum(row.bid);
  const ask = toNum(row.ask);
  const px = toNum(row.price);

  const usableBid = bid ?? px;
  const usableAsk = ask ?? px;
  if (usableBid === null || usableAsk === null) throw new Error(`QUOTE_INVALID:${sym}`);

  const mid = (usableBid + usableAsk) / 2;
  const spread = usableAsk - usableBid;

  // Handle both timestamp formats (seconds or milliseconds)
  const lastApiRaw = toNum((row as any).lastApiUpdate ?? (row as any).last_api_update) ?? toNum((row as any).updatedAt ?? (row as any).updated_at);
  const lastApiMs =
    lastApiRaw === null ? null : (lastApiRaw < 1e12 ? lastApiRaw * 1000 : lastApiRaw);

  const now = Date.now();
  const isStale =
    Boolean((row as any).isStale ?? (row as any).is_stale) ||
    lastApiMs === null ||
    (now - lastApiMs) > STALE_AFTER_MS;

  const marketOpen = await isMarketOpenForExecution(sym, new Date());

  // Institutional: BUY opens at ask, closes at bid. SELL opens at bid, closes at ask.
  const execPrice =
    action === "OPEN"
      ? (side === "BUY" ? usableAsk : usableBid)
      : (side === "BUY" ? usableBid : usableAsk);

  const quoteTs = new Date(lastApiMs ?? now);

  return {
    symbol: sym,
    bid: usableBid,
    ask: usableAsk,
    mid,
    spread,
    quoteTs,
    source: process.env.QUOTE_SOURCE ?? (process.env.FORGE_KEY ? "1forge" : "quotes_db"),
    isStale,
    marketOpen,
    execPrice,
  };
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
