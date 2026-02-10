export type AllocationStatus = "ACTIVE" | "STOPPED" | "CLOSED";

function toFiniteNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCapitalUsd(raw: unknown): number | null {
  const n = toFiniteNumber(raw);
  if (n == null || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function normalizeShadowStopPct(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = toFiniteNumber(raw);
  if (n == null) return null;

  // Accept either fractional form (0.03) or percent form (3 => 3%).
  const normalized = n > 1 ? n / 100 : n;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 1) return null;
  return Number(normalized.toFixed(6));
}

export function normalizeAllocationStatus(raw: unknown): AllocationStatus | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "ACTIVE" || normalized === "STOPPED" || normalized === "CLOSED") {
    return normalized;
  }
  return null;
}

export function normalizePaging(input: {
  limit?: unknown;
  offset?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}): { limit: number; offset: number } {
  const defaultLimit = Math.max(1, Math.trunc(Number(input.defaultLimit ?? 25)));
  const maxLimit = Math.max(defaultLimit, Math.trunc(Number(input.maxLimit ?? 100)));

  const limitRaw = Number(input.limit);
  const offsetRaw = Number(input.offset);

  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(maxLimit, Math.trunc(limitRaw)))
    : defaultLimit;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;

  return { limit, offset };
}
