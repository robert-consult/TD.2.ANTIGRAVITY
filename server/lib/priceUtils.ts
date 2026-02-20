import { getI18nConfig } from "../i18n/config";

/**
 * Precision-aware price comparison utilities for forex trading.
 * Converts prices to integer ticks to avoid floating-point precision issues.
 * Handles truncated decimals (e.g., 0.67 = 0.6700) correctly.
 */
export function getPrecision(symbol: string): number {
  // Deprecated: prefer passing a precision derived from symbol_config.quoteDecimals.
  return symbol.includes("JPY") ? 2 : 4;
}

export function toTicks(price: number, precision: number): number {
  // Convert to integer ticks for precise comparison
  // e.g., 0.6700 with precision 4 -> 6700, 0.6698 -> 6698
  const multiplier = Math.pow(10, precision);
  return Math.round(price * multiplier);
}

export function ticksToPrice(ticks: number, precision: number): number {
  return ticks / Math.pow(10, precision);
}

// Precision-aware comparison: returns true if priceA < priceB
export function priceLessThan(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) < toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA > priceB
export function priceGreaterThan(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) > toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA <= priceB
export function priceLessThanOrEqual(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) <= toTicks(priceB, precision);
}

// Precision-aware comparison: returns true if priceA >= priceB
export function priceGreaterThanOrEqual(priceA: number, priceB: number, precision: number): boolean {
  return toTicks(priceA, precision) >= toTicks(priceB, precision);
}

export function normalizeLanguagePreference(value: string | undefined): { normalized: string; matched: boolean } {
  const cfg = getI18nConfig();
  const defaultLocale = String(cfg.defaultLocale || "en");
  const supported = cfg.supportedLocales?.length ? cfg.supportedLocales : [defaultLocale];
  const raw = String(value || "").trim();

  if (!raw) return { normalized: defaultLocale, matched: false };

  const exact = supported.find((locale) => locale.toLowerCase() === raw.toLowerCase());
  if (exact) return { normalized: exact, matched: true };

  const base = raw.split("-")[0].toLowerCase();
  const baseMatch = supported.find((locale) => locale.toLowerCase() === base);
  if (baseMatch) return { normalized: baseMatch, matched: true };

  return { normalized: defaultLocale, matched: false };
}

export function toUnixMs(value: unknown, fallbackMs = Date.now()): number {
  if (value == null || value === "") return fallbackMs;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (value instanceof Date) return value.getTime();

  const num = Number(value);
  if (!Number.isFinite(num)) return fallbackMs;
  return num < 1e12 ? num * 1000 : num;
}
