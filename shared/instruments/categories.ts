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

export const LEGACY_INSTRUMENT_ASSET_CLASSES = [
  "FOREX",
  "METAL",
  "INDEX",
  "ENERGY",
  "CRYPTO",
] as const;

export type LegacyInstrumentAssetClass = (typeof LEGACY_INSTRUMENT_ASSET_CLASSES)[number];

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
  physical_currency: "forex",

  stock: "stocks",
  stocks: "stocks",
  common_stock: "stocks",
  preferred_stock: "stocks",
  american_depositary_receipt: "stocks",
  depositary_receipt: "stocks",
  global_depositary_receipt: "stocks",
  reit: "stocks",
  right: "stocks",
  warrant: "stocks",
  limited_partnership: "stocks",
  structured_product: "stocks",

  etf: "etf",
  etfs: "etf",
  exchange_traded_note: "etf",
  exchange_traded_fund: "etf",

  crypto: "crypto",
  cryptocurrency: "crypto",
  cryptocurrencies: "crypto",
  digital_currency: "crypto",
  crypto_pair: "crypto",
  crypto_pairs: "crypto",

  commodity: "commodities",
  commodities: "commodities",
  agricultural_product: "commodities",
  energy: "commodities",
  energies: "commodities",
  energy_resource: "commodities",
  livestock: "commodities",
  metal: "commodities",
  metals: "commodities",
  precious_metal: "commodities",
  precious_metals: "commodities",
  industrial_metal: "commodities",
  industrial_metals: "commodities",
  gold: "commodities",
  silver: "commodities",
  platinum: "commodities",
  palladium: "commodities",
  oil: "commodities",
  gas: "commodities",
  natural_gas: "commodities",
  crude_oil: "commodities",

  bond: "bonds",
  bonds: "bonds",

  fund: "funds",
  funds: "funds",
  bond_fund: "funds",
  closed_end_fund: "funds",
  trust: "funds",
  unit: "funds",

  mutual_fund: "mutual_funds",
  mutual_funds: "mutual_funds",

  index: "indices",
  indices: "indices",

  unknown: "unknown",
};

const LEGACY_ASSET_CLASS_TO_CATEGORY: Record<LegacyInstrumentAssetClass, InstrumentCategoryTag> = {
  FOREX: "forex",
  METAL: "commodities",
  INDEX: "indices",
  ENERGY: "commodities",
  CRYPTO: "crypto",
};

const ENERGY_SYMBOL_HINTS = new Set([
  "WTI",
  "BRENT",
  "NGAS",
  "USOIL",
  "UKOIL",
  "NATGAS",
  "CL",
  "BRN",
  "NG",
  "XTIUSD",
  "XBRUSD",
]);

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

export function normalizeLegacyInstrumentAssetClass(
  raw: unknown,
  fallback: LegacyInstrumentAssetClass = "FOREX",
): LegacyInstrumentAssetClass {
  const upper = String(raw ?? "").trim().toUpperCase();
  return (LEGACY_INSTRUMENT_ASSET_CLASSES as readonly string[]).includes(upper)
    ? (upper as LegacyInstrumentAssetClass)
    : fallback;
}

export function legacyAssetClassToCategory(
  raw: unknown,
  fallback: InstrumentCategoryTag = "unknown",
): InstrumentCategoryTag {
  const upper = String(raw ?? "").trim().toUpperCase();
  if (!(LEGACY_INSTRUMENT_ASSET_CLASSES as readonly string[]).includes(upper)) return fallback;
  return LEGACY_ASSET_CLASS_TO_CATEGORY[upper as LegacyInstrumentAssetClass] ?? fallback;
}

export function categoryToLegacyAssetClass(
  rawCategory: unknown,
  opts?: { symbol?: unknown },
): LegacyInstrumentAssetClass {
  const category = normalizeInstrumentCategory(rawCategory, "unknown");
  if (category === "crypto") return "CRYPTO";
  if (category === "indices") return "INDEX";
  if (category === "commodities") {
    const symbol = String(opts?.symbol ?? "").trim().toUpperCase();
    return ENERGY_SYMBOL_HINTS.has(symbol) ? "ENERGY" : "METAL";
  }
  return "FOREX";
}
