import {
  resolvePerformanceSettingsSource,
  sanitizePerformanceSettingsPatch,
} from "@shared/performanceSettings";

function sanitizePerformancePatch(perf: Record<string, unknown>): Record<string, unknown> {
  return sanitizePerformanceSettingsPatch(perf) as Record<string, unknown>;
}

export function resolveGlobalPerformanceSettingsPayload(payload: unknown): Record<string, unknown> {
  return resolvePerformanceSettingsSource(payload);
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
