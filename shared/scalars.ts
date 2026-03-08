export type IntRoundingMode = "round" | "trunc";

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function toFiniteNumberOr(value: unknown, fallback = 0): number {
  return toFiniteNumber(value) ?? fallback;
}

export function clampInt(
  value: unknown,
  min: number,
  max: number,
  mode: IntRoundingMode = "trunc",
): number | null {
  const n = toFiniteNumber(value);
  if (n == null) return null;
  const normalized = mode === "round" ? Math.round(n) : Math.trunc(n);
  return Math.max(min, Math.min(max, normalized));
}

export function clampIntOr(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  mode: IntRoundingMode = "trunc",
): number {
  return clampInt(value, min, max, mode) ?? fallback;
}
