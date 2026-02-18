export function mergeGlobalSettingsPerformance(
  prev: unknown,
  perf: Record<string, unknown>,
  updatedAtRaw: unknown,
): Record<string, unknown> {
  const updatedAt = typeof updatedAtRaw === "number" ? updatedAtRaw : null;
  if (!prev || typeof prev !== "object") {
    return {
      performanceSettings: { ...perf },
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
      ...perf,
    },
    updatedAt: updatedAt ?? (base.updatedAt ?? null),
  };
}
