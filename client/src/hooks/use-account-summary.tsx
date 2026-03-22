import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { usePerfHints } from "@/lib/perfHints";
import { resolveRuntimeIntervals } from "@/lib/runtimeIntervals";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";
import {
  WS_MSG_ACCOUNT_SNAPSHOT,
  WS_MSG_ACCOUNT_SUBSCRIBE,
  WS_MSG_ACCOUNT_UNSUBSCRIBE,
  WS_MSG_ACCOUNT_UPDATE,
  WS_MSG_ACCOUNT_UPDATED,
} from "@shared/ws/protocol";

export interface AccountSummary {
  startingBalance?: number;
  balance: number;
  equity: number;
  floatingPnl: number;
  usedMargin: number;
  freeMargin: number;
  marginLevel: number | null;
  openPositions: number;
  pricingStale: boolean;
  staleSymbols: string[];
  asOf: string;
}

type UseAccountSummaryOptions = {
  enabled?: boolean;
};

export function useAccountSummary(options: UseAccountSummaryOptions = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enabled = options.enabled ?? true;
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const runtimeIntervals = resolveRuntimeIntervals(perfHints, performanceSettings);
  const accountPollIntervalMs = runtimeIntervals.accountSummary.restFallbackPollMs;

  const { isConnected: isWsConnected, sendMessage, subscribe } = useLiveUpdates();
  const wsFallbackRefetchMode = isWsConnected ? false : ("always" as const);

  useEffect(() => {
    if (!user || !isWsConnected) return;
    sendMessage({ type: WS_MSG_ACCOUNT_SUBSCRIBE });
    return () => {
      sendMessage({ type: WS_MSG_ACCOUNT_UNSUBSCRIBE });
    };
  }, [user?.id, isWsConnected, sendMessage]);

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (
        message.type !== WS_MSG_ACCOUNT_UPDATED &&
        message.type !== WS_MSG_ACCOUNT_UPDATE &&
        message.type !== WS_MSG_ACCOUNT_SNAPSHOT
      ) return;

      const messageUserId = message.userId;
      const currentUserId = user?.id;
      if (messageUserId && currentUserId && messageUserId !== currentUserId) return;

      const summary = (message as any)?.payload?.summary;
      if (summary && typeof summary === "object") {
        queryClient.setQueryData(["/api/account/summary"], summary);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }
    });
  }, [queryClient, subscribe, user?.id]);

  const query = useQuery<AccountSummary>({
    queryKey: ["/api/account/summary"],
    enabled: enabled && !!user,
    refetchInterval: isWsConnected ? false : accountPollIntervalMs,
    staleTime: isWsConnected ? Infinity : 15_000,
    refetchOnWindowFocus: wsFallbackRefetchMode,
    refetchOnReconnect: wsFallbackRefetchMode,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
  };

  return {
    ...query,
    summary: query.data,
    invalidate,
  };
}
