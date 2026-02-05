export type PipConfigLike = {
  symbol?: string | null;
  category?: string | null;
  quoteCurrency?: string | null;
  pipDecimals?: number | null;
  quoteDecimals?: number | null;
};

function toNonNegativeInt(raw: unknown, opts?: { max?: number }): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (typeof raw === "boolean") return null;

  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const asInt = Math.trunc(n);
  if (asInt < 0) return null;
  if (typeof opts?.max === "number" && asInt > opts.max) return null;
  return asInt;
}

function normSymbol(raw: unknown): string {
  return String(raw ?? "")
    .replace("/", "")
    .trim()
    .toUpperCase();
}

function isLikelyFxPairSymbol(symbol: string): boolean {
  // Matches common internal FX canonical symbols like EURUSD, USDJPY, XAUUSD, BTCUSD, etc.
  return /^[A-Z0-9]{6}$/.test(symbol);
}

export function getPipDecimals(cfg: PipConfigLike): number {
  const direct = toNonNegativeInt(cfg.pipDecimals, { max: 12 });
  if (direct !== null) return direct;

  const category = String(cfg.category ?? "").trim().toLowerCase();
  const symbol = normSymbol(cfg.symbol);
  const quoteCurrency = String(cfg.quoteCurrency ?? "").trim().toUpperCase();

  if (category === "indices") return 0;
  if (category === "stocks" || category === "etf" || category === "funds" || category === "mutual_funds" || category === "bonds") return 2;
  if (category === "commodities") return 2;
  if (category === "crypto") return 2;

  // Forex default (legacy behavior): JPY pairs 2, others 4.
  if (category === "forex") {
    const isJpy = quoteCurrency === "JPY" || (isLikelyFxPairSymbol(symbol) && symbol.endsWith("JPY"));
    return isJpy ? 2 : 4;
  }

  // Unknown category fallback: preserve legacy FX heuristic for 6-char symbols.
  if (isLikelyFxPairSymbol(symbol)) return symbol.endsWith("JPY") ? 2 : 4;

  return 2;
}

export function getPipSize(cfg: PipConfigLike): number {
  const decimals = getPipDecimals(cfg);
  return Math.pow(10, -decimals);
}

export function getQuoteDecimals(cfg: PipConfigLike): number {
  const direct = toNonNegativeInt(cfg.quoteDecimals, { max: 12 });
  if (direct !== null) return direct;

  const pipDecimals = getPipDecimals(cfg);
  const category = String(cfg.category ?? "").trim().toLowerCase();

  // Forex quotes are typically 1 extra decimal beyond pip size (e.g., 0.00001 fractional pips).
  if (category === "forex") return Math.min(12, pipDecimals + 1);

  // Otherwise, default quote formatting to pip decimals.
  return pipDecimals;
}

export function pointsToPips(points: number, cfg: PipConfigLike): number {
  const pipSize = getPipSize(cfg);
  if (!Number.isFinite(points) || pipSize <= 0) return 0;
  return points / pipSize;
}
