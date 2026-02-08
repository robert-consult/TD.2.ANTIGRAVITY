export const INSTRUMENT_CATEGORY_TAGS = [
  "forex",
  "stocks",
  "etf",
  "crypto",
  "commodities",
  "bonds",
  "funds",
  "mutual_funds",
  "indices",
  "unknown",
] as const;

export type InstrumentCategoryTag = (typeof INSTRUMENT_CATEGORY_TAGS)[number];

export const INSTRUMENT_CATALOG_CATEGORY_TAGS: readonly Exclude<InstrumentCategoryTag, "unknown">[] = [
  "forex",
  "stocks",
  "etf",
  "crypto",
  "commodities",
  "bonds",
  "funds",
  "mutual_funds",
  "indices",
] as const;

export const INSTRUMENT_CATEGORY_LABELS: Record<InstrumentCategoryTag, string> = {
  forex: "Forex",
  stocks: "Stocks",
  etf: "ETFs",
  crypto: "Crypto",
  commodities: "Commodities",
  bonds: "Bonds",
  funds: "Funds",
  mutual_funds: "Mutual Funds",
  indices: "Indices",
  unknown: "Unknown",
};

const INSTRUMENT_CATEGORY_ALIASES: Record<string, InstrumentCategoryTag> = {
  forex: "forex",
  fx: "forex",
  forex_pair: "forex",
  forex_pairs: "forex",

  stock: "stocks",
  stocks: "stocks",

  etf: "etf",
  etfs: "etf",

  crypto: "crypto",
  cryptocurrency: "crypto",
  cryptocurrencies: "crypto",

  commodity: "commodities",
  commodities: "commodities",

  bond: "bonds",
  bonds: "bonds",

  fund: "funds",
  funds: "funds",

  mutual_fund: "mutual_funds",
  mutual_funds: "mutual_funds",

  index: "indices",
  indices: "indices",

  unknown: "unknown",
};

function normalizeAliasToken(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function canonicalizeInstrumentCategory(raw: unknown): InstrumentCategoryTag | null {
  const token = normalizeAliasToken(raw);
  if (!token) return null;
  return INSTRUMENT_CATEGORY_ALIASES[token] ?? null;
}

export function normalizeInstrumentCategory(
  raw: unknown,
  fallback: InstrumentCategoryTag = "unknown",
): InstrumentCategoryTag {
  return canonicalizeInstrumentCategory(raw) ?? fallback;
}

export function isInstrumentCategoryTag(raw: unknown): raw is InstrumentCategoryTag {
  const token = normalizeAliasToken(raw);
  return Object.prototype.hasOwnProperty.call(INSTRUMENT_CATEGORY_ALIASES, token);
}
