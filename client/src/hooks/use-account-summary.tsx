import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { recommendedPollIntervalMs } from "@/lib/perfHints";

export interface AccountSummary {
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

  const { isConnected: isWsConnected, sendMessage, subscribe } = useLiveUpdates();

  useEffect(() => {
    if (!user || !isWsConnected) return;
    sendMessage({ type: "account:subscribe" });
    return () => {
      sendMessage({ type: "account:unsubscribe" });
    };
  }, [user?.id, isWsConnected, sendMessage]);

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== "account:updated" && message.type !== "account:update" && message.type !== "account:snapshot") return;

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
    refetchInterval: isWsConnected ? false : recommendedPollIntervalMs(7000),
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
