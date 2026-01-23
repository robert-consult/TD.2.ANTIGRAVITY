export type NetEffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";

export type PerfHints = {
  effectiveType: NetEffectiveType;
  saveData: boolean;
  rttMs: number | null;
  downlinkMbps: number | null;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
  isConstrained: boolean;
};

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function getPerfHints(): PerfHints {
  const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
  const conn: any = nav?.connection || nav?.mozConnection || nav?.webkitConnection;

  const effectiveType: NetEffectiveType = (conn?.effectiveType as NetEffectiveType) || "unknown";
  const saveData = Boolean(conn?.saveData);
  const rttMs = numOrNull(conn?.rtt);
  const downlinkMbps = numOrNull(conn?.downlink);
  const deviceMemoryGB = numOrNull(nav?.deviceMemory);
  const hardwareConcurrency = numOrNull(nav?.hardwareConcurrency);

  const networkConstrained =
    saveData ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    effectiveType === "3g" ||
    (effectiveType === "4g" &&
      ((rttMs != null && rttMs > 350) || (downlinkMbps != null && downlinkMbps < 1.6)));

  const deviceConstrained =
    (deviceMemoryGB != null && deviceMemoryGB <= 4) ||
    (hardwareConcurrency != null && hardwareConcurrency <= 4);

  return {
    effectiveType,
    saveData,
    rttMs,
    downlinkMbps,
    deviceMemoryGB,
    hardwareConcurrency,
    isConstrained: networkConstrained || deviceConstrained,
  };
}

export function recommendedPollIntervalMs(baseMs: number, hints: PerfHints = getPerfHints()): number {
  const base = Math.max(4000, Math.round(baseMs));
  if (!hints.isConstrained) return base;
  const multiplier = hints.effectiveType === "4g" ? 2 : 3;
  return clamp(Math.round(base * multiplier), base, 60_000);
}

export function recommendedQuoteFlushIntervalMs(hints: PerfHints = getPerfHints()): number {
  return hints.isConstrained ? 500 : 250;
}

export function computeWsReconnectDelayMs(
  attempt: number,
  baseMs: number,
  hints: PerfHints = getPerfHints(),
): number {
  const base = Math.max(500, Math.round(baseMs));
  const exp = Math.min(attempt, 6);
  const max = hints.isConstrained ? 30_000 : 20_000;
  const scaledBase = hints.isConstrained ? clamp(base * 2, 500, 10_000) : base;
  const raw = clamp(Math.round(scaledBase * Math.pow(2, exp)), scaledBase, max);
  const jitter = 0.2;
  const withJitter = raw + Math.round(raw * jitter * (Math.random() - 0.5) * 2);
  return clamp(withJitter, scaledBase, max);
}

