import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";

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

export function useAccountSummary() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

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
      if (message.type !== "account:updated" && message.type !== "account:update") return;

      const messageUserId = message.userId;
      const currentUserId = user?.id;
      if (!messageUserId || !currentUserId || messageUserId === currentUserId) {
        queryClient.refetchQueries({ queryKey: ["/api/account/summary"], type: "active" });
      }
    });
  }, [queryClient, subscribe, user?.id]);
  
  const query = useQuery<AccountSummary>({
    queryKey: ["/api/account/summary"],
    refetchInterval: isWsConnected ? false : 2000, // Refresh every 2 seconds when WS is unavailable
    staleTime: 1000, // Consider data stale after 1 second
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
