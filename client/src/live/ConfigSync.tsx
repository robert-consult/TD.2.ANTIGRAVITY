import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useAuth } from "@/hooks/use-auth";

export function ConfigSync() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { subscribe } = useLiveUpdates();

  const invalidateByPrefix = useCallback((prefix: string) => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey?.[0];
        return typeof key === "string" && key.startsWith(prefix);
      },
    });
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated) return;

    return subscribe((message) => {
      if (!message || typeof message !== "object") return;

      if (message.type === "symbols:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/config/symbols"] });
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
        invalidateByPrefix("/api/quote-subscriptions/available-symbols");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/symbols"] });
        return;
      }

      if (message.type === "global-settings:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/global-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/global-settings"] });
        return;
      }

      if (message.type === "system-config:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
      }

      if (message.type === "market-data:providers-updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
        return;
      }

      if (message.type === "quote-subscriptions:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me"] });
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me/subscriptions"] });
        invalidateByPrefix("/api/quote-subscriptions/available-symbols");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/config"] });
        return;
      }
    });
  }, [invalidateByPrefix, isAuthenticated, queryClient, subscribe]);

  return null;
}
