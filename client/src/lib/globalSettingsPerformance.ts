const ALLOWED_PERFORMANCE_SETTING_KEYS = new Set<string>([
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
]);

function sanitizePerformancePatch(perf: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(perf)) {
    if (!ALLOWED_PERFORMANCE_SETTING_KEYS.has(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function resolveGlobalPerformanceSettingsPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const row = payload as Record<string, unknown>;
  const nestedPerformance =
    row.performanceSettings && typeof row.performanceSettings === "object"
      ? sanitizePerformancePatch(row.performanceSettings as Record<string, unknown>)
      : null;

  if (!nestedPerformance) return row;
  return {
    ...row,
    ...nestedPerformance,
  };
}

export function mergeGlobalSettingsPerformance(
  prev: unknown,
  perf: Record<string, unknown>,
  updatedAtRaw: unknown,
): Record<string, unknown> {
  const safePerf = sanitizePerformancePatch(perf);
  const updatedAt = typeof updatedAtRaw === "number" ? updatedAtRaw : null;
  if (!prev || typeof prev !== "object") {
    return {
      performanceSettings: { ...safePerf },
      updatedAt,
    };
  }
  const base = prev as Record<string, unknown>;
  const existingPerformanceSettings =
    base.performanceSettings && typeof base.performanceSettings === "object"
      ? (base.performanceSettings as Record<string, unknown>)
      : {};

  return {
    ...base,
    performanceSettings: {
      ...existingPerformanceSettings,
      ...safePerf,
    },
    updatedAt: updatedAt ?? (base.updatedAt ?? null),
  };
}
