import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useAuth } from "@/hooks/use-auth";
import { mergeGlobalSettingsPerformance } from "@/lib/globalSettingsPerformance";
import { WS_MSG_LEGAL_DOC1_UPDATED, WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED } from "@shared/ws/protocol";

export function ConfigSync() {
  const { isAuthenticated, checkAuth } = useAuth();
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
        const payload = (message as { payload?: unknown }).payload;
        if (payload && typeof payload === "object") {
          const payloadRecord = payload as Record<string, unknown>;
          const perf = payloadRecord.performanceSettings;
          if (perf && typeof perf === "object") {
            const mergePerformance = (prev: unknown) => {
              if (!prev || typeof prev !== "object") return prev;
              return mergeGlobalSettingsPerformance(
                prev,
                perf as Record<string, unknown>,
                payloadRecord.updatedAt,
              );
            };
            queryClient.setQueryData(["/api/global-settings"], mergePerformance);
            queryClient.setQueryData(["/api/admin/global-settings"], mergePerformance);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["/api/global-settings"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/global-settings"] });
        return;
      }

      if (message.type === "system-config:updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/config"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trader/leaderboard-mode"] });
        return;
      }

      if (message.type === "market-data:providers-updated") {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/market-data/providers"] });
        return;
      }

      if (message.type === WS_MSG_QUOTE_SUBSCRIPTIONS_UPDATED) {
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/allowed-symbols"] });
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me"] });
        queryClient.invalidateQueries({ queryKey: ["/api/quote-subscriptions/me/subscriptions"] });
        invalidateByPrefix("/api/quote-subscriptions/available-symbols");
        queryClient.invalidateQueries({ queryKey: ["/api/admin/quote-subscriptions/config"] });
        return;
      }

      if (message.type === WS_MSG_LEGAL_DOC1_UPDATED) {
        void checkAuth();
        queryClient.invalidateQueries({ queryKey: ["/api/legal/doc1/reaccept"] });
        window.dispatchEvent(new Event("legal:reaccept-required"));
        return;
      }

      if (message.type === "challenges:updated") {
        invalidateByPrefix("/api/admin/challenges");
        invalidateByPrefix("/api/trader/challenges");
        queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
        queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }
    });
  }, [checkAuth, invalidateByPrefix, isAuthenticated, queryClient, subscribe]);

  return null;
}
