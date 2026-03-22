export type PerformanceTier = "INSTANT" | "FAST" | "MODERATE" | "CONSTRAINED" | "MINIMAL";
export type PrefetchStrategy = "all" | "critical" | "none";

export type ResolvedPerformanceSettings = {
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

export const PERFORMANCE_TIERS: readonly PerformanceTier[] = [
  "INSTANT",
  "FAST",
  "MODERATE",
  "CONSTRAINED",
  "MINIMAL",
] as const;

export const PERFORMANCE_SETTING_KEYS = [
  "restFallbackPollMs",
  "wsPushFrequencyMs",
  "quoteFlushIntervalMs",
  "maxWsReconnectAttempts",
  "wsReconnectBaseDelayMs",
  "prefetchStrategy",
  "prefetchMaxConcurrency",
  "prefetchStartDelayMs",
  "prefetchFastConcurrencyCap",
  "prefetchModerateConcurrencyCap",
  "prefetchConstrainedConcurrencyCap",
  "prefetchNetworkFastStartDelayMs",
  "prefetchNetworkModerateStartDelayMs",
  "prefetchNetworkConstrainedStartDelayMs",
  "prefetchDeviceModerateStartDelayMs",
  "prefetchDeviceConstrainedStartDelayMs",
  "prefetchDeviceMinimalStartDelayMs",
  "pollInstantMs",
  "pollFastMs",
  "pollModerateMs",
  "pollConstrainedMs",
  "pollMinimalMs",
  "flushInstantMs",
  "flushFastMs",
  "flushModerateMs",
  "flushConstrainedMs",
  "flushMinimalMs",
] as const;

export type PerformanceSettingKey = (typeof PERFORMANCE_SETTING_KEYS)[number];

const PERFORMANCE_SETTING_KEY_SET = new Set<string>(PERFORMANCE_SETTING_KEYS);
const MAX_PREFETCH_SETTING_CONCURRENCY = 6;
const DEFAULT_PREFETCH_STRATEGY: PrefetchStrategy = "all";

export const DEFAULT_RESOLVED_PERFORMANCE_SETTINGS: ResolvedPerformanceSettings = {
  restFallbackPollMs: 500,
  wsPushFrequencyMs: 0,
  quoteFlushIntervalMs: 50,
  maxWsReconnectAttempts: 30,
  wsReconnectBaseDelayMs: 1500,
  prefetchStrategy: DEFAULT_PREFETCH_STRATEGY,
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

function toRoundedNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const rounded = toRoundedNumber(value);
  if (rounded === null) return fallback;
  return Math.max(min, Math.min(max, rounded));
}

function clampIntFromNullable(value: number | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback;
  return Math.max(min, Math.min(max, value));
}

function normalizePrefetchStrategy(value: unknown): PrefetchStrategy {
  const normalized = String(value ?? DEFAULT_PREFETCH_STRATEGY).trim().toLowerCase();
  if (normalized === "critical" || normalized === "none") return normalized;
  return "all";
}

function normalizeTier(tier: string | null | undefined): PerformanceTier {
  const normalized = String(tier ?? "").trim().toUpperCase();
  if (normalized === "INSTANT") return "INSTANT";
  if (normalized === "FAST") return "FAST";
  if (normalized === "CONSTRAINED") return "CONSTRAINED";
  if (normalized === "MINIMAL") return "MINIMAL";
  return "MODERATE";
}

export function sanitizePerformanceSettingsPatch(
  perf: Record<string, unknown>,
): Partial<Record<PerformanceSettingKey, unknown>> {
  const sanitized: Partial<Record<PerformanceSettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(perf)) {
    if (!PERFORMANCE_SETTING_KEY_SET.has(key)) continue;
    sanitized[key as PerformanceSettingKey] = value;
  }
  return sanitized;
}

export function resolvePerformanceSettingsSource(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const row = payload as Record<string, unknown>;
  const nestedPerformance =
    row.performanceSettings && typeof row.performanceSettings === "object" && !Array.isArray(row.performanceSettings)
      ? sanitizePerformanceSettingsPatch(row.performanceSettings as Record<string, unknown>)
      : null;

  if (!nestedPerformance || Object.keys(nestedPerformance).length === 0) {
    return row;
  }

  return {
    ...row,
    ...nestedPerformance,
  };
}

function deriveTierDefaults(source: {
  restFallbackPollMs: number;
  quoteFlushIntervalMs: number;
}) {
  return {
    pollInstantMs: Math.min(source.restFallbackPollMs, 200),
    pollFastMs: Math.min(source.restFallbackPollMs, 500),
    pollModerateMs: clampIntFromNullable(
      Math.max(source.restFallbackPollMs, 1500),
      1500,
      6000,
      1500,
    ),
    pollConstrainedMs: Math.max(Math.round(source.restFallbackPollMs * 2), 4000),
    pollMinimalMs: Math.max(Math.round(source.restFallbackPollMs * 3), 6000),
    flushInstantMs: Math.min(source.quoteFlushIntervalMs, 50),
    flushFastMs: clampIntFromNullable(Math.round(source.quoteFlushIntervalMs * 3), 60, 5000, 150),
    flushModerateMs: clampIntFromNullable(Math.round(source.quoteFlushIntervalMs * 6), 120, 5000, 300),
    flushConstrainedMs: clampIntFromNullable(Math.round(source.quoteFlushIntervalMs * 10), 200, 5000, 500),
    flushMinimalMs: clampIntFromNullable(Math.round(source.quoteFlushIntervalMs * 20), 400, 5000, 1000),
  };
}

export function resolvePerformanceSettings(input: unknown): ResolvedPerformanceSettings {
  const candidate = resolvePerformanceSettingsSource(input);

  const restFallbackPollMs = clampInt(
    candidate.restFallbackPollMs,
    100,
    60_000,
    DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.restFallbackPollMs,
  );
  const quoteFlushIntervalMs = clampInt(
    candidate.quoteFlushIntervalMs,
    20,
    5_000,
    DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.quoteFlushIntervalMs,
  );
  const tierDefaults = deriveTierDefaults({
    restFallbackPollMs,
    quoteFlushIntervalMs,
  });

  return {
    restFallbackPollMs,
    wsPushFrequencyMs: clampInt(
      candidate.wsPushFrequencyMs,
      0,
      1_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.wsPushFrequencyMs,
    ),
    quoteFlushIntervalMs,
    maxWsReconnectAttempts: clampInt(
      candidate.maxWsReconnectAttempts,
      1,
      30,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.maxWsReconnectAttempts,
    ),
    wsReconnectBaseDelayMs: clampInt(
      candidate.wsReconnectBaseDelayMs,
      100,
      30_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.wsReconnectBaseDelayMs,
    ),
    prefetchStrategy: normalizePrefetchStrategy(candidate.prefetchStrategy),
    prefetchMaxConcurrency: clampInt(
      candidate.prefetchMaxConcurrency,
      1,
      MAX_PREFETCH_SETTING_CONCURRENCY,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchMaxConcurrency,
    ),
    prefetchStartDelayMs: clampInt(
      candidate.prefetchStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchStartDelayMs,
    ),
    prefetchFastConcurrencyCap: clampInt(
      candidate.prefetchFastConcurrencyCap,
      1,
      MAX_PREFETCH_SETTING_CONCURRENCY,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchFastConcurrencyCap,
    ),
    prefetchModerateConcurrencyCap: clampInt(
      candidate.prefetchModerateConcurrencyCap,
      1,
      MAX_PREFETCH_SETTING_CONCURRENCY,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchModerateConcurrencyCap,
    ),
    prefetchConstrainedConcurrencyCap: clampInt(
      candidate.prefetchConstrainedConcurrencyCap,
      1,
      MAX_PREFETCH_SETTING_CONCURRENCY,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchConstrainedConcurrencyCap,
    ),
    prefetchNetworkFastStartDelayMs: clampInt(
      candidate.prefetchNetworkFastStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchNetworkFastStartDelayMs,
    ),
    prefetchNetworkModerateStartDelayMs: clampInt(
      candidate.prefetchNetworkModerateStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchNetworkModerateStartDelayMs,
    ),
    prefetchNetworkConstrainedStartDelayMs: clampInt(
      candidate.prefetchNetworkConstrainedStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchNetworkConstrainedStartDelayMs,
    ),
    prefetchDeviceModerateStartDelayMs: clampInt(
      candidate.prefetchDeviceModerateStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchDeviceModerateStartDelayMs,
    ),
    prefetchDeviceConstrainedStartDelayMs: clampInt(
      candidate.prefetchDeviceConstrainedStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchDeviceConstrainedStartDelayMs,
    ),
    prefetchDeviceMinimalStartDelayMs: clampInt(
      candidate.prefetchDeviceMinimalStartDelayMs,
      0,
      15_000,
      DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.prefetchDeviceMinimalStartDelayMs,
    ),
    pollInstantMs: clampInt(candidate.pollInstantMs, 100, 60_000, tierDefaults.pollInstantMs),
    pollFastMs: clampInt(candidate.pollFastMs, 100, 60_000, tierDefaults.pollFastMs),
    pollModerateMs: clampInt(candidate.pollModerateMs, 100, 60_000, tierDefaults.pollModerateMs),
    pollConstrainedMs: clampInt(candidate.pollConstrainedMs, 100, 60_000, tierDefaults.pollConstrainedMs),
    pollMinimalMs: clampInt(candidate.pollMinimalMs, 100, 60_000, tierDefaults.pollMinimalMs),
    flushInstantMs: clampInt(candidate.flushInstantMs, 20, 5_000, tierDefaults.flushInstantMs),
    flushFastMs: clampInt(candidate.flushFastMs, 20, 5_000, tierDefaults.flushFastMs),
    flushModerateMs: clampInt(candidate.flushModerateMs, 20, 5_000, tierDefaults.flushModerateMs),
    flushConstrainedMs: clampInt(candidate.flushConstrainedMs, 20, 5_000, tierDefaults.flushConstrainedMs),
    flushMinimalMs: clampInt(candidate.flushMinimalMs, 20, 5_000, tierDefaults.flushMinimalMs),
  };
}

function pollIntervalForTierInternal(
  normalizedTier: PerformanceTier,
  base: number,
  settings: ResolvedPerformanceSettings,
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
      return clampIntFromNullable(Math.max(base, 1500), 1500, 6000, 1500);
    case "CONSTRAINED":
      return Math.max(Math.round(base * 2), 4000);
    case "MINIMAL":
      return Math.max(Math.round(base * 3), 6000);
  }
}

function flushIntervalForTierInternal(
  normalizedTier: PerformanceTier,
  base: number,
  settings: ResolvedPerformanceSettings,
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
      return clampIntFromNullable(Math.round(base * 3), 60, 5000, 150);
    case "MODERATE":
      return clampIntFromNullable(Math.round(base * 6), 120, 5000, 300);
    case "CONSTRAINED":
      return clampIntFromNullable(Math.round(base * 10), 200, 5000, 500);
    case "MINIMAL":
      return clampIntFromNullable(Math.round(base * 20), 400, 5000, 1000);
  }
}

export function pollIntervalForTier(tier: string, baseMs: number, settingsInput?: unknown): number {
  const normalizedTier = normalizeTier(tier);
  const base = clampInt(baseMs, 100, 60_000, DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.restFallbackPollMs);
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput ? resolvePerformanceSettings(settingsInput) : DEFAULT_RESOLVED_PERFORMANCE_SETTINGS;
  return pollIntervalForTierInternal(normalizedTier, base, settings, hasSettingsInput);
}

export function flushIntervalForTier(tier: string, baseMs: number, settingsInput?: unknown): number {
  const normalizedTier = normalizeTier(tier);
  const base = clampInt(baseMs, 20, 5_000, DEFAULT_RESOLVED_PERFORMANCE_SETTINGS.quoteFlushIntervalMs);
  const hasSettingsInput = Boolean(settingsInput && typeof settingsInput === "object");
  const settings = hasSettingsInput ? resolvePerformanceSettings(settingsInput) : DEFAULT_RESOLVED_PERFORMANCE_SETTINGS;
  return flushIntervalForTierInternal(normalizedTier, base, settings, hasSettingsInput);
}
