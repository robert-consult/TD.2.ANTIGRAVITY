import { toUnixSeconds, type InstantInput } from "../time/instant";

export const TIME_IN_FORCE_VALUES = ["GTC", "DAY", "IOC", "FOK", "GTD"] as const;
export type TimeInForce = (typeof TIME_IN_FORCE_VALUES)[number];

export const MARKET_TIME_IN_FORCE_VALUES = ["GTC", "IOC", "FOK"] as const satisfies readonly TimeInForce[];
export const PENDING_TIME_IN_FORCE_VALUES = ["GTC", "DAY", "GTD"] as const satisfies readonly TimeInForce[];

const TIME_IN_FORCE_SET = new Set<string>(TIME_IN_FORCE_VALUES);
const MARKET_TIME_IN_FORCE_SET = new Set<string>(MARKET_TIME_IN_FORCE_VALUES);
const PENDING_TIME_IN_FORCE_SET = new Set<string>(PENDING_TIME_IN_FORCE_VALUES);

export function parseTimeInForce(value: unknown): TimeInForce | null {
  const candidate = typeof value === "string" ? value.trim().toUpperCase() : "";
  return TIME_IN_FORCE_SET.has(candidate) ? (candidate as TimeInForce) : null;
}

export function normalizeTimeInForce(value: unknown, fallback: TimeInForce = "GTC"): TimeInForce {
  return parseTimeInForce(value) ?? fallback;
}

export function isMarketTimeInForce(value: unknown): boolean {
  return MARKET_TIME_IN_FORCE_SET.has(normalizeTimeInForce(value));
}

export function isPendingTimeInForce(value: unknown): boolean {
  return PENDING_TIME_IN_FORCE_SET.has(normalizeTimeInForce(value));
}

export function requiresExplicitExpiry(value: unknown): boolean {
  return normalizeTimeInForce(value) === "GTD";
}

export function computeDayExpirySec(nowMs = Date.now()): number {
  const date = new Date(nowMs);
  date.setUTCHours(23, 59, 59, 999);
  return Math.trunc(date.getTime() / 1000);
}

export function resolvePendingOrderExpirySec(params: {
  timeInForce: TimeInForce;
  expiresAt?: InstantInput;
  nowMs?: number;
}): number | null {
  if (params.timeInForce === "DAY") {
    return computeDayExpirySec(params.nowMs);
  }
  if (params.timeInForce === "GTD") {
    return toUnixSeconds(params.expiresAt);
  }
  return null;
}
