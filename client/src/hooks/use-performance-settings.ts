import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  resolvePerformanceSettings,
  type PerformanceSettings,
} from "@/lib/perfHints";

export function usePerformanceSettings(): PerformanceSettings {
  const query = useQuery({
    queryKey: ["/api/global-settings"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!query.data) return DEFAULT_PERFORMANCE_SETTINGS;
    const payload =
      query.data && typeof query.data === "object"
        ? ((query.data as Record<string, unknown>).performanceSettings ?? query.data)
        : query.data;
    return resolvePerformanceSettings(payload);
  }, [query.data]);
}
