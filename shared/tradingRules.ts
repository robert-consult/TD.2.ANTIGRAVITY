// Trading invariants shared across server + clients.
//
// IMPORTANT: Treat these as contract-level constants. If you change them, update:
// - Server validation (trade open/modify)
// - Client autosuggest + UI validation
// - Mobile/native equivalents where applicable

// Platform rule: minimum distance for pending entry placement and TP/SL placement.
// Interpretation: pips (0.0001 for non-JPY FX pairs, 0.01 for JPY pairs).
export const MIN_PRICE_DISTANCE_PIPS = 20 as const;

export function sanitizeMinPriceDistancePips(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return MIN_PRICE_DISTANCE_PIPS;
  const asInt = Math.trunc(n);
  if (asInt < 1) return MIN_PRICE_DISTANCE_PIPS;
  return Math.min(10_000, asInt);
}
