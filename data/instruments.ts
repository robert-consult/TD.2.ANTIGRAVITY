// data/instruments.ts
import {
  legacyAssetClassToCategory,
  type InstrumentCategoryTag,
  type LegacyInstrumentAssetClass,
} from "@shared/instruments/categories";

export interface Instrument {
  symbol: string;
  displayName: string;
  base: string;
  quote: string;
  assetClass: LegacyInstrumentAssetClass;
  category: InstrumentCategoryTag;
}

const legacyInstruments: Array<Omit<Instrument, "category">> = [
  /* ────────────── FX – 7 majors ────────────── */
  { symbol: "EURUSD", displayName: "Euro / US Dollar",            base: "EUR", quote: "USD", assetClass: "FOREX" },
  { symbol: "USDJPY", displayName: "US Dollar / Japanese Yen",    base: "USD", quote: "JPY", assetClass: "FOREX" },
  { symbol: "GBPUSD", displayName: "British Pound / US Dollar",   base: "GBP", quote: "USD", assetClass: "FOREX" },
  { symbol: "USDCHF", displayName: "US Dollar / Swiss Franc",     base: "USD", quote: "CHF", assetClass: "FOREX" },
  { symbol: "USDCAD", displayName: "US Dollar / Canadian Dollar", base: "USD", quote: "CAD", assetClass: "FOREX" },
  { symbol: "AUDUSD", displayName: "Australian Dollar / US Dollar",base: "AUD", quote: "USD", assetClass: "FOREX" },
  { symbol: "NZDUSD", displayName: "New Zealand Dollar / US Dollar",base: "NZD", quote: "USD", assetClass: "FOREX" },

  /* ────────────── FX – euro crosses ────────────── */
  { symbol: "EURJPY", displayName: "Euro / Japanese Yen",         base: "EUR", quote: "JPY", assetClass: "FOREX" },
  { symbol: "EURGBP", displayName: "Euro / British Pound",        base: "EUR", quote: "GBP", assetClass: "FOREX" },
  { symbol: "EURCHF", displayName: "Euro / Swiss Franc",          base: "EUR", quote: "CHF", assetClass: "FOREX" },
  { symbol: "EURCAD", displayName: "Euro / Canadian Dollar",      base: "EUR", quote: "CAD", assetClass: "FOREX" },
  { symbol: "EURAUD", displayName: "Euro / Australian Dollar",    base: "EUR", quote: "AUD", assetClass: "FOREX" },
  { symbol: "EURNZD", displayName: "Euro / New Zealand Dollar",   base: "EUR", quote: "NZD", assetClass: "FOREX" },
  { symbol: "EURSEK", displayName: "Euro / Swedish Krona",        base: "EUR", quote: "SEK", assetClass: "FOREX" },
  { symbol: "EURNOK", displayName: "Euro / Norwegian Krone",      base: "EUR", quote: "NOK", assetClass: "FOREX" },
  { symbol: "EURDKK", displayName: "Euro / Danish Krone",         base: "EUR", quote: "DKK", assetClass: "FOREX" },

  /* ────────────── FX – pound crosses ────────────── */
  { symbol: "GBPJPY", displayName: "British Pound / Japanese Yen",base: "GBP", quote: "JPY", assetClass: "FOREX" },
  { symbol: "GBPCHF", displayName: "British Pound / Swiss Franc", base: "GBP", quote: "CHF", assetClass: "FOREX" },
  { symbol: "GBPCAD", displayName: "British Pound / Canadian Dollar",base: "GBP", quote: "CAD", assetClass: "FOREX" },
  { symbol: "GBPAUD", displayName: "British Pound / Australian Dollar",base: "GBP", quote: "AUD", assetClass: "FOREX" },
  { symbol: "GBPNZD", displayName: "British Pound / New Zealand Dollar",base: "GBP", quote: "NZD", assetClass: "FOREX" },

  /* ────────────── FX – AUD / CAD / CHF / NZD crosses ────────────── */
  { symbol: "AUDJPY", displayName: "Australian Dollar / Japanese Yen",  base: "AUD", quote: "JPY", assetClass: "FOREX" },
  { symbol: "AUDNZD", displayName: "Australian Dollar / New Zealand Dollar",base: "AUD", quote: "NZD", assetClass: "FOREX" },
  { symbol: "AUDCAD", displayName: "Australian Dollar / Canadian Dollar",base: "AUD", quote: "CAD", assetClass: "FOREX" },
  { symbol: "AUDCHF", displayName: "Australian Dollar / Swiss Franc",   base: "AUD", quote: "CHF", assetClass: "FOREX" },
  { symbol: "CADJPY", displayName: "Canadian Dollar / Japanese Yen",    base: "CAD", quote: "JPY", assetClass: "FOREX" },
  { symbol: "CADCHF", displayName: "Canadian Dollar / Swiss Franc",     base: "CAD", quote: "CHF", assetClass: "FOREX" },
  { symbol: "CHFJPY", displayName: "Swiss Franc / Japanese Yen",        base: "CHF", quote: "JPY", assetClass: "FOREX" },
  { symbol: "NZDJPY", displayName: "New Zealand Dollar / Japanese Yen", base: "NZD", quote: "JPY", assetClass: "FOREX" },
  { symbol: "NZDCAD", displayName: "New Zealand Dollar / Canadian Dollar",base: "NZD", quote: "CAD", assetClass: "FOREX" },
  { symbol: "NZDCHF", displayName: "New Zealand Dollar / Swiss Franc",  base: "NZD", quote: "CHF", assetClass: "FOREX" },

  /* ────────────── FX – USD exotics (keep liquidity high) ────────────── */
  { symbol: "USDSEK", displayName: "US Dollar / Swedish Krona",   base: "USD", quote: "SEK", assetClass: "FOREX" },
  { symbol: "USDNOK", displayName: "US Dollar / Norwegian Krone", base: "USD", quote: "NOK", assetClass: "FOREX" },
  { symbol: "USDHKD", displayName: "US Dollar / Hong-Kong Dollar",base: "USD", quote: "HKD", assetClass: "FOREX" },
  { symbol: "USDSGD", displayName: "US Dollar / Singapore Dollar",base: "USD", quote: "SGD", assetClass: "FOREX" },
  { symbol: "USDMXN", displayName: "US Dollar / Mexican Peso",    base: "USD", quote: "MXN", assetClass: "FOREX" },
  { symbol: "USDZAR", displayName: "US Dollar / South African Rand",base: "USD", quote: "ZAR", assetClass: "FOREX" },
  { symbol: "USDTRY", displayName: "US Dollar / Turkish Lira",    base: "USD", quote: "TRY", assetClass: "FOREX" },
  { symbol: "USDPLN", displayName: "US Dollar / Polish Zloty",    base: "USD", quote: "PLN", assetClass: "FOREX" },
  { symbol: "USDTHB", displayName: "US Dollar / Thai Baht",       base: "USD", quote: "THB", assetClass: "FOREX" },

  /* ────────────── Metals ────────────── */
  { symbol: "XAUUSD", displayName: "Gold / US Dollar",            base: "XAU", quote: "USD", assetClass: "METAL" },
  { symbol: "XAGUSD", displayName: "Silver / US Dollar",          base: "XAG", quote: "USD", assetClass: "METAL" },

  /* ────────────── Indices (CFD codes) ────────────── */
  { symbol: "US30",   displayName: "Dow Jones Industrial Average",base: "DJI", quote: "USD", assetClass: "INDEX" },
  { symbol: "SPX500", displayName: "S&P 500",                     base: "SPX", quote: "USD", assetClass: "INDEX" },
  { symbol: "NAS100", displayName: "Nasdaq 100",                  base: "NDX", quote: "USD", assetClass: "INDEX" },
  { symbol: "GER40",  displayName: "DAX 40",                      base: "DAX", quote: "EUR", assetClass: "INDEX" },
  { symbol: "UK100",  displayName: "FTSE 100",                    base: "UKX", quote: "GBP", assetClass: "INDEX" },
  { symbol: "JP225",  displayName: "Nikkei 225",                  base: "N225",quote: "JPY", assetClass: "INDEX" },

  /* ────────────── Energy ────────────── */
  { symbol: "WTI",    displayName: "West Texas Intermediate Crude",base: "CL",  quote: "USD", assetClass: "ENERGY" },
  { symbol: "BRENT",  displayName: "Brent Crude Oil",             base: "BRN", quote: "USD", assetClass: "ENERGY" },
  { symbol: "NGAS",   displayName: "US Natural Gas",              base: "NG",  quote: "USD", assetClass: "ENERGY" },

  /* ────────────── Crypto CFDs (optional) ────────────── */
  { symbol: "BTCUSD", displayName: "Bitcoin / US Dollar",         base: "BTC", quote: "USD", assetClass: "CRYPTO" },
  { symbol: "ETHUSD", displayName: "Ethereum / US Dollar",        base: "ETH", quote: "USD", assetClass: "CRYPTO" },
];

export const instruments: Instrument[] = legacyInstruments.map((row) => ({
  ...row,
  category: legacyAssetClassToCategory(row.assetClass, "unknown"),
}));
