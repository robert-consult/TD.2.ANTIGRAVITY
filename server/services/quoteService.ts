/**
 * Quote Service - Server-authoritative quote retrieval for trade execution
 * Replaces client-supplied prices with server-side quotes
 */

import { db } from "@db";
import { quotes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { isMarketOpenForSymbol } from "./marketHours";
import { getQuote, getValkeyQuoteRows } from "./quoteHub";

// Quote freshness: 5 minutes default to accommodate 1Forge refresh intervals
const STALE_AFTER_MS = Number(process.env.QUOTE_STALE_AFTER_MS ?? 300_000);

function normalizeSymbol(s: string): string {
  return s.replace("/", "").trim().toUpperCase();
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
export async function getLatestQuoteRow(symbol: string): Promise<any | null> {
  const sym = normalizeSymbol(symbol);
  const hubQuote = getQuote(sym);
  if (hubQuote) {
    return {
      symbol: sym,
      bid: hubQuote.bid,
      ask: hubQuote.ask,
      price: hubQuote.price,
      lastApiUpdate: hubQuote.lastApiUpdate,
      isStale: hubQuote.isStale,
    };
  }
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
  const row = await db.query.quotes.findFirst({
    where: eq(quotes.symbol, sym),
  });
  return row || null;
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

  const marketOpen = isMarketOpenForSymbol(sym, new Date());

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
