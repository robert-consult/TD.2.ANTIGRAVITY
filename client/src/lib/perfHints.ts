import { useSyncExternalStore } from "react";
import { PREFETCH_ROUTE_KEYS } from "@/lib/prefetchCatalog";

export type NetEffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";
export type PerformanceTier = "INSTANT" | "FAST" | "MODERATE" | "CONSTRAINED" | "MINIMAL";
export type PrefetchStrategy = "all" | "critical" | "none";

export type PerformanceSettings = {
  restFallbackPollMs: number;
  wsPushFrequencyMs: number;
  quoteFlushIntervalMs: number;
  maxWsReconnectAttempts: number;
  wsReconnectBaseDelayMs: number;
  prefetchStrategy: PrefetchStrategy;
  prefetchMaxConcurrency: number;
  prefetchStartDelayMs: number;
  prefetchFastConcurrencyCap: number;
  prefetchModerateConcurrencyCap: number;
  prefetchConstrainedConcurrencyCap: number;
  prefetchNetworkFastStartDelayMs: number;
  prefetchNetworkModerateStartDelayMs: number;
  prefetchNetworkConstrainedStartDelayMs: number;
  prefetchDeviceModerateStartDelayMs: number;
  prefetchDeviceConstrainedStartDelayMs: number;
  prefetchDeviceMinimalStartDelayMs: number;
  pollInstantMs: number;
  pollFastMs: number;
  pollModerateMs: number;
  pollConstrainedMs: number;
  pollMinimalMs: number;
  flushInstantMs: number;
  flushFastMs: number;
  flushModerateMs: number;
  flushConstrainedMs: number;
  flushMinimalMs: number;
};

export type PerfHints = {
  effectiveType: NetEffectiveType;
  saveData: boolean;
  rttMs: number | null;
  downlinkMbps: number | null;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
  isNetworkConstrained: boolean;
  isDeviceConstrained: boolean;
  isConstrained: boolean;
  networkTier: PerformanceTier;
  deviceTier: PerformanceTier;
  tier: PerformanceTier;
};

export type PrefetchPlan = {
  count: number;
  mode: "parallel" | "sequential" | "none";
  startDelayMs: number;
  maxConcurrency: number;
};

type NavigatorLike = {
  connection?: NetworkInfoLike;
  mozConnection?: NetworkInfoLike;
  webkitConnection?: NetworkInfoLike;
  deviceMemory?: number;
  hardwareConcurrency?: number;
};

type NetworkInfoLike = {
  effectiveType?: string;
  saveData?: boolean;
  rtt?: number;
  downlink?: number;
  addEventListener?: (event: "change", listener: () => void) => void;
  removeEventListener?: (event: "change", listener: () => void) => void;
};

export const PERFORMANCE_TIERS: readonly PerformanceTier[] = [
  "INSTANT",
  "FAST",
  "MODERATE",
  "CONSTRAINED",
  "MINIMAL",
] as const;

const TIER_RANK: Record<PerformanceTier, number> = {
  INSTANT: 0,
  FAST: 1,
  MODERATE: 2,
  CONSTRAINED: 3,
  MINIMAL: 4,
};

const NETWORK_CHANGE_EVENT = "change";
export const MAX_PREFETCH_CONCURRENCY = 12;

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  restFallbackPollMs: 500,
  wsPushFrequencyMs: 0,
  quoteFlushIntervalMs: 50,
  maxWsReconnectAttempts: 30,
  wsReconnectBaseDelayMs: 1500,
  prefetchStrategy: "all",
  prefetchMaxConcurrency: 4,
  prefetchStartDelayMs: 0,
  prefetchFastConcurrencyCap: 3,
  prefetchModerateConcurrencyCap: 2,
  prefetchConstrainedConcurrencyCap: 1,
  prefetchNetworkFastStartDelayMs: 75,
  prefetchNetworkModerateStartDelayMs: 200,
  prefetchNetworkConstrainedStartDelayMs: 450,
  prefetchDeviceModerateStartDelayMs: 50,
  prefetchDeviceConstrainedStartDelayMs: 150,
  prefetchDeviceMinimalStartDelayMs: 300,
  pollInstantMs: 200,
  pollFastMs: 500,
  pollModerateMs: 1500,
  pollConstrainedMs: 4000,
  pollMinimalMs: 6000,
  flushInstantMs: 50,
  flushFastMs: 150,
  flushModerateMs: 300,
  flushConstrainedMs: 500,
  flushMinimalMs: 1000,
};

function getNavigatorLike(): NavigatorLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator as NavigatorLike;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeTier(tier: string | null | undefined): PerformanceTier {
  const normalized = String(tier || "").trim().toUpperCase();
  if (normalized === "INSTANT") return "INSTANT";
  if (normalized === "FAST") return "FAST";
  if (normalized === "MODERATE") return "MODERATE";
  if (normalized === "CONSTRAINED") return "CONSTRAINED";
  if (normalized === "MINIMAL") return "MINIMAL";
  return "MODERATE";
}

function classifyNetworkTier(values: {
  effectiveType: NetEffectiveType;
  saveData: boolean;
  rttMs: number | null;
  downlinkMbps: number | null;
}): PerformanceTier {
  if (values.saveData) return "MINIMAL";
  if (values.effectiveType === "slow-2g" || values.effectiveType === "2g") {
    return "MINIMAL";
  }
  if (values.effectiveType === "3g") return "CONSTRAINED";

  const rtt = values.rttMs;
  const downlink = values.downlinkMbps;

  if (rtt != null && downlink != null && rtt < 50 && downlink >= 10) return "INSTANT";
  if (rtt != null && downlink != null && rtt <= 150 && downlink >= 5) return "FAST";
  if ((rtt != null && rtt > 350) || (downlink != null && downlink < 1.5)) return "CONSTRAINED";
  if ((rtt != null && rtt > 150) || (downlink != null && downlink < 5)) return "MODERATE";

  if (values.effectiveType === "4g") return "FAST";
  return "MODERATE";
}

function classifyDeviceTier(values: {
  deviceMemoryGB: number | null;
  hardwareConcurrency: number | null;
}): PerformanceTier {
  const memory = values.deviceMemoryGB;
  const cores = values.hardwareConcurrency;

  if (memory == null && cores == null) return "FAST";
  if ((memory != null && memory < 2) || (cores != null && cores < 2)) return "MINIMAL";
  if ((memory == null || memory >= 8) && (cores == null || cores >= 8)) return "INSTANT";
  if ((memory == null || memory >= 4) && (cores == null || cores >= 4)) return "FAST";
  if ((memory != null && memory >= 3) || (cores != null && cores >= 4)) return "MODERATE";
  return "CONSTRAINED";
}

function combineTier(networkTier: PerformanceTier, deviceTier: PerformanceTier): PerformanceTier {
  const networkRank = TIER_RANK[networkTier];
  const deviceRank = TIER_RANK[deviceTier];

  // Avoid over-throttling fast-network clients solely due to low-end hardware.
  // Polling and transport decisions are network-bound; for extreme mismatch, keep a MODERATE composite tier.
  if (networkRank <= TIER_RANK.FAST && deviceRank >= TIER_RANK.CONSTRAINED) {
    return "MODERATE";
  }

  return TIER_RANK[networkTier] >= TIER_RANK[deviceTier] ? networkTier : deviceTier;
}

function createPerfHints(): PerfHints {
  const nav = getNavigatorLike();
  const conn = nav?.connection || nav?.mozConnection || nav?.webkitConnection;

  const effectiveTypeRaw = String(conn?.effectiveType || "").trim().toLowerCase();
  const effectiveType: NetEffectiveType =
    effectiveTypeRaw === "slow-2g" ||
    effectiveTypeRaw === "2g" ||
    effectiveTypeRaw === "3g" ||
    effectiveTypeRaw === "4g"
      ? effectiveTypeRaw
      : "unknown";

  const saveData = Boolean(conn?.saveData);
  const rttMs = numOrNull(conn?.rtt);
  const downlinkMbps = numOrNull(conn?.downlink);
  const deviceMemoryGB = numOrNull(nav?.deviceMemory);
  const hardwareConcurrency = numOrNull(nav?.hardwareConcurrency);

  const networkTier = classifyNetworkTier({ effectiveType, saveData, rttMs, downlinkMbps });
  const deviceTier = classifyDeviceTier({ deviceMemoryGB, hardwareConcurrency });
  const tier = combineTier(networkTier, deviceTier);

  const isNetworkConstrained = TIER_RANK[networkTier] >= TIER_RANK.CONSTRAINED;
  const isDeviceConstrained = TIER_RANK[deviceTier] >= TIER_RANK.CONSTRAINED;

  return {
    effectiveType,
    saveData,
    rttMs,
    downlinkMbps,
    deviceMemoryGB,
    hardwareConcurrency,
    isNetworkConstrained,
    isDeviceConstrained,
    isConstrained: isNetworkConstrained || isDeviceConstrained,
    networkTier,
    deviceTier,
    tier,
  };
}

function hintsAreEqual(a: PerfHints, b: PerfHints): boolean {
  return (
    a.effectiveType === b.effectiveType &&
    a.saveData === b.saveData &&
    a.rttMs === b.rttMs &&
    a.downlinkMbps === b.downlinkMbps &&
    a.deviceMemoryGB === b.deviceMemoryGB &&
    a.hardwareConcurrency === b.hardwareConcurrency &&
    a.isNetworkConstrained === b.isNetworkConstrained &&
    a.isDeviceConstrained === b.isDeviceConstrained &&
    a.networkTier === b.networkTier &&
    a.deviceTier === b.deviceTier &&
    a.tier === b.tier
  );
}

let perfHintsSnapshot: PerfHints = createPerfHints();
const perfHintListeners = new Set<() => void>();
let detachNativeListeners: (() => void) | null = null;

function ensureNativeListeners() {
  if (detachNativeListeners || typeof window === "undefined") return;

  const nav = getNavigatorLike();
  const conn = nav?.connection || nav?.mozConnection || nav?.webkitConnection;
  const onChange = () => {
    refreshPerfHints();
  };

  conn?.addEventListener?.(NETWORK_CHANGE_EVENT, onChange);
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);

  detachNativeListeners = () => {
    conn?.removeEventListener?.(NETWORK_CHANGE_EVENT, onChange);
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    detachNativeListeners = null;
  };
}

function notifyPerfHintListeners() {
  for (const listener of perfHintListeners) listener();
}

export function refreshPerfHints(): PerfHints {
  const next = createPerfHints();
  if (!hintsAreEqual(next, perfHintsSnapshot)) {
    perfHintsSnapshot = next;
    notifyPerfHintListeners();
  }
  return perfHintsSnapshot;
}

export function subscribeHints(listener: () => void): () => void {
  ensureNativeListeners();
  perfHintListeners.add(listener);
  return () => {
    perfHintListeners.delete(listener);
    if (!perfHintListeners.size) {
      detachNativeListeners?.();
    }
  };
}

export function getHintsSnapshot(): PerfHints {
  return perfHintsSnapshot;
}

export function getPerfHints(): PerfHints {
  return refreshPerfHints();
}

export function usePerfHints(): PerfHints {
  return useSyncExternalStore(subscribeHints, getHintsSnapshot, getHintsSnapshot);
}

export function getPerformanceTier(hints: PerfHints = getPerfHints()): PerformanceTier {
  return hints.tier;
}

export function usePerformanceTier(): PerformanceTier {
  return usePerfHints().tier;
}

export function resolvePerformanceSettings(input: unknown): PerformanceSettings {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const prefetchRaw = String(candidate.prefetchStrategy ?? DEFAULT_PERFORMANCE_SETTINGS.prefetchStrategy)
    .trim()
    .toLowerCase();
  const prefetchStrategy: PrefetchStrategy =
    prefetchRaw === "none" || prefetchRaw === "critical" || prefetchRaw === "all"
      ? prefetchRaw
      : DEFAULT_PERFORMANCE_SETTINGS.prefetchStrategy;

  const restFallbackPollMs = clamp(
    Math.round(numOrNull(candidate.restFallbackPollMs) ?? DEFAULT_PERFORMANCE_SETTINGS.restFallbackPollMs),
    100,
    60_000,
  );
  const quoteFlushIntervalMs = clamp(
    Math.round(numOrNull(candidate.quoteFlushIntervalMs) ?? DEFAULT_PERFORMANCE_SETTINGS.quoteFlushIntervalMs),
    20,
    5_000,
  );

  const defaultPollInstantMs = Math.min(restFallbackPollMs, 200);
  const defaultPollFastMs = Math.min(restFallbackPollMs, 500);
  const defaultPollModerateMs = clamp(Math.max(restFallbackPollMs, 1_500), 1_500, 6_000);
  const defaultPollConstrainedMs = Math.max(Math.round(restFallbackPollMs * 2), 4_000);
  const defaultPollMinimalMs = Math.max(Math.round(restFallbackPollMs * 3), 6_000);
  const defaultFlushInstantMs = Math.min(quoteFlushIntervalMs, 50);
  const defaultFlushFastMs = clamp(Math.round(quoteFlushIntervalMs * 3), 60, 5_000);
  const defaultFlushModerateMs = clamp(Math.round(quoteFlushIntervalMs * 6), 120, 5_000);
  const defaultFlushConstrainedMs = clamp(Math.round(quoteFlushIntervalMs * 10), 200, 5_000);
  const defaultFlushMinimalMs = clamp(Math.round(quoteFlushIntervalMs * 20), 400, 5_000);

  return {
    restFallbackPollMs,
    wsPushFrequencyMs: clamp(
      Math.round(numOrNull(candidate.wsPushFrequencyMs) ?? DEFAULT_PERFORMANCE_SETTINGS.wsPushFrequencyMs),
      0,
      1_000,
    ),
    quoteFlushIntervalMs,
    maxWsReconnectAttempts: clamp(
      Math.round(
        numOrNull(candidate.maxWsReconnectAttempts) ??
          DEFAULT_PERFORMANCE_SETTINGS.maxWsReconnectAttempts,
      ),
      1,
      30,
    ),
    wsReconnectBaseDelayMs: clamp(
      Math.round(
        numOrNull(candidate.wsReconnectBaseDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.wsReconnectBaseDelayMs,
      ),
      100,
      30_000,
    ),
    prefetchStrategy,
    prefetchMaxConcurrency: clamp(
      Math.round(
        numOrNull(candidate.prefetchMaxConcurrency) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchMaxConcurrency,
      ),
      1,
      MAX_PREFETCH_CONCURRENCY,
    ),
    prefetchStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchFastConcurrencyCap: clamp(
      Math.round(
        numOrNull(candidate.prefetchFastConcurrencyCap) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchFastConcurrencyCap,
      ),
      1,
      MAX_PREFETCH_CONCURRENCY,
    ),
    prefetchModerateConcurrencyCap: clamp(
      Math.round(
        numOrNull(candidate.prefetchModerateConcurrencyCap) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchModerateConcurrencyCap,
      ),
      1,
      MAX_PREFETCH_CONCURRENCY,
    ),
    prefetchConstrainedConcurrencyCap: clamp(
      Math.round(
        numOrNull(candidate.prefetchConstrainedConcurrencyCap) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchConstrainedConcurrencyCap,
      ),
      1,
      MAX_PREFETCH_CONCURRENCY,
    ),
    prefetchNetworkFastStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchNetworkFastStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchNetworkFastStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchNetworkModerateStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchNetworkModerateStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchNetworkModerateStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchNetworkConstrainedStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchNetworkConstrainedStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchNetworkConstrainedStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchDeviceModerateStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchDeviceModerateStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchDeviceModerateStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchDeviceConstrainedStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchDeviceConstrainedStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchDeviceConstrainedStartDelayMs,
      ),
      0,
      15_000,
    ),
    prefetchDeviceMinimalStartDelayMs: clamp(
      Math.round(
        numOrNull(candidate.prefetchDeviceMinimalStartDelayMs) ??
          DEFAULT_PERFORMANCE_SETTINGS.prefetchDeviceMinimalStartDelayMs,
      ),
      0,
      15_000,
    ),
    pollInstantMs: clamp(Math.round(numOrNull(candidate.pollInstantMs) ?? defaultPollInstantMs), 100, 60_000),
    pollFastMs: clamp(Math.round(numOrNull(candidate.pollFastMs) ?? defaultPollFastMs), 100, 60_000),
    pollModerateMs: clamp(Math.round(numOrNull(candidate.pollModerateMs) ?? defaultPollModerateMs), 100, 60_000),
    pollConstrainedMs: clamp(
      Math.round(numOrNull(candidate.pollConstrainedMs) ?? defaultPollConstrainedMs),
      100,
      60_000,
    ),
    pollMinimalMs: clamp(Math.round(numOrNull(candidate.pollMinimalMs) ?? defaultPollMinimalMs), 100, 60_000),
    flushInstantMs: clamp(Math.round(numOrNull(candidate.flushInstantMs) ?? defaultFlushInstantMs), 20, 5_000),
    flushFastMs: clamp(Math.round(numOrNull(candidate.flushFastMs) ?? defaultFlushFastMs), 20, 5_000),
    flushModerateMs: clamp(
      Math.round(numOrNull(candidate.flushModerateMs) ?? defaultFlushModerateMs),
      20,
      5_000,
    ),
    flushConstrainedMs: clamp(
      Math.round(numOrNull(candidate.flushConstrainedMs) ?? defaultFlushConstrainedMs),
      20,
      5_000,
    ),
    flushMinimalMs: clamp(Math.round(numOrNull(candidate.flushMinimalMs) ?? defaultFlushMinimalMs), 20, 5_000),
  };
}

function pollIntervalForTierInternal(
  normalizedTier: PerformanceTier,
  base: number,
  settings: PerformanceSettings,
  useOverrides: boolean,
): number {
  if (useOverrides) {
    switch (normalizedTier) {
      case "INSTANT":
        return settings.pollInstantMs;
      case "FAST":
        return settings.pollFastMs;
      case "MODERATE":
        return settings.pollModerateMs;
      case "CONSTRAINED":
        return settings.pollConstrainedMs;
      case "MINIMAL":
        return settings.pollMinimalMs;
    }
  }

  switch (normalizedTier) {
    case "INSTANT":
      return Math.min(base, 200);
    case "FAST":
      return Math.min(base, 500);
    case "MODERATE":
      return clamp(Math.max(base, 1_500), 1_500, 6_000);
    case "CONSTRAINED":
      return Math.max(Math.round(base * 2), 4_000);
    case "MINIMAL":
      return Math.max(Math.round(base * 3), 6_000);
  }
}

function flushIntervalForTierInternal(
  normalizedTier: PerformanceTier,
  base: number,
  settings: PerformanceSettings,
  useOverrides: boolean,
): number {
  if (useOverrides) {
    switch (normalizedTier) {
      case "INSTANT":
        return settings.flushInstantMs;
      case "FAST":
        return settings.flushFastMs;
      case "MODERATE":
        return settings.flushModerateMs;
      case "CONSTRAINED":
        return settings.flushConstrainedMs;
      case "MINIMAL":
        return settings.flushMinimalMs;
    }
  }

  switch (normalizedTier) {
    case "INSTANT":
      return Math.min(base, 50);
    case "FAST":
      return clamp(Math.round(base * 3), 60, 5_000);
    case "MODERATE":
      return clamp(Math.round(base * 6), 120, 5_000);
    case "CONSTRAINED":
      return clamp(Math.round(base * 10), 200, 5_000);
    case "MINIMAL":
      return clamp(Math.round(base * 20), 400, 5_000);
  }
}

export function pollIntervalForTier(tier: PerformanceTier, baseMs: number, settingsInput?: unknown): number {
  const normalizedTier = normalizeTier(tier);
  const base = clamp(Math.round(baseMs), 100, 60_000);
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput
    ? resolvePerformanceSettings(settingsInput)
    : DEFAULT_PERFORMANCE_SETTINGS;
  return pollIntervalForTierInternal(normalizedTier, base, settings, hasSettingsInput);
}

export function flushIntervalForTier(tier: PerformanceTier, baseMs: number, settingsInput?: unknown): number {
  const normalizedTier = normalizeTier(tier);
  const base = clamp(Math.round(baseMs), 20, 5_000);
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput
    ? resolvePerformanceSettings(settingsInput)
    : DEFAULT_PERFORMANCE_SETTINGS;
  return flushIntervalForTierInternal(normalizedTier, base, settings, hasSettingsInput);
}

export function tierPollIntervalMs(
  baseMs: number = DEFAULT_PERFORMANCE_SETTINGS.restFallbackPollMs,
  hints: PerfHints = getPerfHints(),
  settingsInput?: unknown,
): number {
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput
    ? resolvePerformanceSettings(settingsInput)
    : DEFAULT_PERFORMANCE_SETTINGS;
  const configuredBase = clamp(Math.round(baseMs || settings.restFallbackPollMs), 100, 60_000);
  return pollIntervalForTierInternal(
    normalizeTier(hints.networkTier),
    configuredBase,
    settings,
    hasSettingsInput,
  );
}

export function tierFlushIntervalMs(
  hints: PerfHints = getPerfHints(),
  settingsInput?: unknown,
): number {
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput
    ? resolvePerformanceSettings(settingsInput)
    : DEFAULT_PERFORMANCE_SETTINGS;
  return flushIntervalForTierInternal(
    normalizeTier(hints.deviceTier),
    settings.quoteFlushIntervalMs,
    settings,
    hasSettingsInput,
  );
}

export function tierPrefetchPlan(
  hints: PerfHints = getPerfHints(),
  settingsInput?: unknown,
): PrefetchPlan {
  const settings = resolvePerformanceSettings(settingsInput);
  if (settings.prefetchStrategy === "none" || hints.saveData || hints.networkTier === "MINIMAL") {
    return { count: 0, mode: "none", startDelayMs: 0, maxConcurrency: 1 };
  }

  const resolveMaxConcurrency = () => {
    let cap = clamp(settings.prefetchMaxConcurrency, 1, MAX_PREFETCH_CONCURRENCY);

    // Keep startup prefetch aggressive on strong links, but reserve connection headroom for
    // initial API + WS setup on weaker tiers.
    if (hints.networkTier === "FAST") cap = Math.min(cap, settings.prefetchFastConcurrencyCap);
    if (hints.networkTier === "MODERATE") cap = Math.min(cap, settings.prefetchModerateConcurrencyCap);
    if (hints.networkTier === "CONSTRAINED") cap = Math.min(cap, settings.prefetchConstrainedConcurrencyCap);

    if (hints.deviceTier === "MINIMAL") cap = 1;
    else if (hints.deviceTier === "CONSTRAINED") cap = Math.min(cap, 2);

    const rttMs = hints.rttMs ?? Number.POSITIVE_INFINITY;
    const downlinkMbps = hints.downlinkMbps ?? 0;
    const networkHealthy =
      TIER_RANK[hints.networkTier] <= TIER_RANK.FAST && Number.isFinite(rttMs) && rttMs <= 150;
    const deviceHealthy = TIER_RANK[hints.deviceTier] <= TIER_RANK.MODERATE;

    let throughputFloor = 1;
    if (networkHealthy && deviceHealthy) {
      if (downlinkMbps >= 100) throughputFloor = 12;
      else if (downlinkMbps >= 80) throughputFloor = 10;
      else if (downlinkMbps >= 50) throughputFloor = 8;
    }

    return clamp(Math.max(cap, throughputFloor), 1, MAX_PREFETCH_CONCURRENCY);
  };

  const resolveStartDelayMs = () => {
    const networkDelayMs = (() => {
      switch (hints.networkTier) {
        case "INSTANT":
          return 0;
        case "FAST":
          return settings.prefetchNetworkFastStartDelayMs;
        case "MODERATE":
          return settings.prefetchNetworkModerateStartDelayMs;
        case "CONSTRAINED":
          return settings.prefetchNetworkConstrainedStartDelayMs;
        case "MINIMAL":
          return 0;
      }
    })();

    const deviceDelayMs = (() => {
      switch (hints.deviceTier) {
        case "INSTANT":
        case "FAST":
          return 0;
        case "MODERATE":
          return settings.prefetchDeviceModerateStartDelayMs;
        case "CONSTRAINED":
          return settings.prefetchDeviceConstrainedStartDelayMs;
        case "MINIMAL":
          return settings.prefetchDeviceMinimalStartDelayMs;
      }
    })();

    return clamp(
      Math.max(settings.prefetchStartDelayMs, networkDelayMs, deviceDelayMs),
      0,
      15_000,
    );
  };

  const maxConcurrency = resolveMaxConcurrency();
  const mode = maxConcurrency > 1 ? "parallel" : "sequential";
  const startDelayMs = resolveStartDelayMs();

  if (settings.prefetchStrategy === "critical") {
    if (hints.networkTier === "CONSTRAINED" || hints.deviceTier === "MINIMAL") {
      return { count: 2, mode, startDelayMs, maxConcurrency };
    }
    if (hints.networkTier === "MODERATE" || hints.deviceTier === "CONSTRAINED") {
      return { count: 3, mode, startDelayMs, maxConcurrency };
    }
    return { count: 4, mode, startDelayMs, maxConcurrency };
  }

  const totalPrefetchTargets: number = PREFETCH_ROUTE_KEYS.length;
  let count = totalPrefetchTargets;
  if (hints.networkTier === "MODERATE") count = Math.max(1, totalPrefetchTargets - 1);
  if (hints.networkTier === "CONSTRAINED") count = Math.max(1, totalPrefetchTargets - 3);

  if (hints.deviceTier === "MINIMAL") count = Math.min(count, 3);
  if (hints.deviceTier === "CONSTRAINED") {
    count = Math.min(count, Math.max(4, totalPrefetchTargets - 4));
  }

  if (count <= 0) {
    return { count: 0, mode: "none", startDelayMs: 0, maxConcurrency: 1 };
  }

  return { count, mode, startDelayMs, maxConcurrency };
}

export function tierRetryCount(
  hints: PerfHints = getPerfHints(),
): number {
  switch (hints.networkTier) {
    case "INSTANT":
    case "FAST":
      return 1;
    case "MODERATE":
      return 2;
    case "CONSTRAINED":
    case "MINIMAL":
      return 3;
  }
}

export function tierHydrationTimeoutMs(hints: PerfHints = getPerfHints()): number {
  switch (hints.deviceTier) {
    case "INSTANT":
    case "FAST":
      return 100;
    case "MODERATE":
      return 300;
    case "CONSTRAINED":
      return 500;
    case "MINIMAL":
      return 800;
  }
}

export function wsReconnectAttempts(settingsInput?: unknown): number {
  return resolvePerformanceSettings(settingsInput).maxWsReconnectAttempts;
}

export function wsReconnectBaseDelayMs(
  hints: PerfHints = getPerfHints(),
  settingsInput?: unknown,
): number {
  const base = resolvePerformanceSettings(settingsInput).wsReconnectBaseDelayMs;
  switch (hints.networkTier) {
    case "INSTANT":
      return clamp(Math.round(base * 0.34), 250, 1_500);
    case "FAST":
      return clamp(Math.round(base * 0.67), 500, 2_000);
    case "MODERATE":
      return clamp(base, 750, 3_000);
    case "CONSTRAINED":
    case "MINIMAL":
      return clamp(Math.round(base * 2), 1_500, 6_000);
  }
}

export function computeWsReconnectDelayMs(
  attempt: number,
  baseMs: number,
  hints: PerfHints = getPerfHints(),
): number {
  const base = clamp(Math.round(baseMs), 250, 10_000);
  const exp = clamp(Math.trunc(attempt), 0, 6);

  let maxDelay = 20_000;
  if (hints.networkTier === "INSTANT") maxDelay = 10_000;
  if (hints.networkTier === "FAST") maxDelay = 15_000;
  if (hints.networkTier === "CONSTRAINED" || hints.networkTier === "MINIMAL") maxDelay = 30_000;

  const raw = clamp(Math.round(base * Math.pow(2, exp)), base, maxDelay);
  const jitter = Math.round(raw * 0.2 * (Math.random() * 2 - 1));
  return clamp(raw + jitter, base, maxDelay);
}

export function recommendedPollIntervalMs(
  baseMs: number,
  hints: PerfHints = getPerfHints(),
): number {
  return tierPollIntervalMs(baseMs, hints);
}

export function recommendedQuoteFlushIntervalMs(hints: PerfHints = getPerfHints()): number {
  return tierFlushIntervalMs(hints);
}
