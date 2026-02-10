type Side = "BUY" | "SELL";

type TradeExcursionState = {
  openPrice: number;
  high: number;
  low: number;
  updatedAtMs: number;
};

const inMemoryExcursions = new Map<number, TradeExcursionState>();

function toFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeOpenPrice(openPrice: unknown): number | null {
  const n = toFinite(openPrice);
  if (n == null || n <= 0) return null;
  return n;
}

function toRounded(value: number): number {
  return Number(value.toFixed(6));
}

function normalizeBounds(openPrice: number, values: Array<number | null>): { high: number; low: number } {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!finite.length) return { high: openPrice, low: openPrice };
  const high = Math.max(...finite, openPrice);
  const low = Math.min(...finite, openPrice);
  return { high, low };
}

export function initTradeExcursion(tradeId: number, openPriceRaw: unknown): { intradayHigh: number; intradayLow: number } | null {
  const openPrice = sanitizeOpenPrice(openPriceRaw);
  if (!openPrice || !Number.isInteger(tradeId) || tradeId <= 0) return null;

  const snapshot: TradeExcursionState = {
    openPrice,
    high: openPrice,
    low: openPrice,
    updatedAtMs: Date.now(),
  };
  inMemoryExcursions.set(tradeId, snapshot);
  return { intradayHigh: openPrice, intradayLow: openPrice };
}

export function trackTradeExcursion(params: {
  tradeId: number;
  openPrice: unknown;
  markPrice: unknown;
  intradayHigh?: unknown;
  intradayLow?: unknown;
}): { intradayHigh: number; intradayLow: number } | null {
  const openPrice = sanitizeOpenPrice(params.openPrice);
  const markPrice = toFinite(params.markPrice);
  if (!openPrice || markPrice == null || !Number.isInteger(params.tradeId) || params.tradeId <= 0) return null;

  const current = inMemoryExcursions.get(params.tradeId);
  const bounds = normalizeBounds(openPrice, [
    current?.high ?? null,
    current?.low ?? null,
    toFinite(params.intradayHigh),
    toFinite(params.intradayLow),
    markPrice,
  ]);

  inMemoryExcursions.set(params.tradeId, {
    openPrice,
    high: bounds.high,
    low: bounds.low,
    updatedAtMs: Date.now(),
  });

  return {
    intradayHigh: bounds.high,
    intradayLow: bounds.low,
  };
}

export function resolveTradeExcursionForClose(params: {
  tradeId: number;
  side: Side;
  openPrice: unknown;
  closePrice: unknown;
  intradayHigh?: unknown;
  intradayLow?: unknown;
}): { intradayHigh: number | null; intradayLow: number | null; mae: number | null; mfe: number | null } {
  const openPrice = sanitizeOpenPrice(params.openPrice);
  const closePrice = toFinite(params.closePrice);

  if (!openPrice || closePrice == null || closePrice <= 0) {
    return {
      intradayHigh: toFinite(params.intradayHigh),
      intradayLow: toFinite(params.intradayLow),
      mae: null,
      mfe: null,
    };
  }

  const tracked = inMemoryExcursions.get(params.tradeId);
  const bounds = normalizeBounds(openPrice, [
    closePrice,
    tracked?.high ?? null,
    tracked?.low ?? null,
    toFinite(params.intradayHigh),
    toFinite(params.intradayLow),
  ]);

  let maeRaw = 0;
  let mfeRaw = 0;

  if (params.side === "BUY") {
    maeRaw = (openPrice - bounds.low) / openPrice;
    mfeRaw = (bounds.high - openPrice) / openPrice;
  } else {
    maeRaw = (bounds.high - openPrice) / openPrice;
    mfeRaw = (openPrice - bounds.low) / openPrice;
  }

  const mae = Number.isFinite(maeRaw) ? toRounded(Math.max(0, maeRaw)) : null;
  const mfe = Number.isFinite(mfeRaw) ? toRounded(Math.max(0, mfeRaw)) : null;

  return {
    intradayHigh: toRounded(bounds.high),
    intradayLow: toRounded(bounds.low),
    mae,
    mfe,
  };
}

export function clearTradeExcursion(tradeId: number): void {
  inMemoryExcursions.delete(tradeId);
}
