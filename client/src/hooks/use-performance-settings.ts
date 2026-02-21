import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  resolvePerformanceSettings,
  type PerformanceSettings,
} from "@/lib/perfHints";
import { resolveGlobalPerformanceSettingsPayload } from "@/lib/globalSettingsPerformance";

export function usePerformanceSettings(): PerformanceSettings {
  const query = useQuery({
    queryKey: ["/api/global-settings"],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    if (!query.data) return DEFAULT_PERFORMANCE_SETTINGS;
    const payload = resolveGlobalPerformanceSettingsPayload(query.data);
    return resolvePerformanceSettings(payload);
  }, [query.data]);
}
