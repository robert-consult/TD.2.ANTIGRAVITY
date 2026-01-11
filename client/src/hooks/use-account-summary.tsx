import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { useWebSocket } from "./use-websocket";

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

  const wsUrl =
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws";

  const { isConnected: isWsConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== "account:updated") return;

      const messageUserId = message.userId;
      const currentUserId = user?.id;
      if (!messageUserId || !currentUserId || messageUserId === currentUserId) {
        // Use refetchQueries for instant UI updates
        queryClient.refetchQueries({ queryKey: ["/api/account/summary"], type: "active" });
      }
    },
  });

  useEffect(() => {
    if (user && sendMessage) {
      sendMessage({ type: "auth", userId: user.id });
    }
  }, [user, sendMessage]);
  
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
