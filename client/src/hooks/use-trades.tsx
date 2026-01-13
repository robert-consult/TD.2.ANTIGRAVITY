import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";
import { useWebSocket } from "./use-websocket";

export function useTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  // Build WebSocket URL
  const wsUrl =
    (window.location.protocol === "https:" ? "wss://" : "ws://") +
    window.location.host +
    "/ws";

  // Connect to WebSocket for live trade updates
  // Server filters by userId but also sends to unauthenticated clients for new tabs
  const { isConnected: isTradeWsConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (!message || typeof message !== "object") return;

      if (message.type === "trades:updated") {
        // Check if this message is for our user (or if no userId filter is present)
        // This handles: 1) matching userId, 2) no userId in message, 3) user not yet loaded
        const messageUserId = message.userId;
        const currentUserId = user?.id;
        
        // Refetch immediately if: no filter in message, or we don't know our userId yet, or it matches
        if (!messageUserId || !currentUserId || messageUserId === currentUserId) {
          // Use refetchQueries for instant UI updates on trade close/open
          queryClient.refetchQueries({ queryKey: ["/api/trades"], type: "active" });
          queryClient.refetchQueries({ queryKey: ["/api/trades/open"], type: "active" });
          queryClient.refetchQueries({ queryKey: ["/api/trades/pending"], type: "active" });
          queryClient.refetchQueries({ queryKey: ["/api/auth/current-user"], type: "active" });
          queryClient.refetchQueries({ queryKey: ["/api/account/summary"], type: "active" });
        }
      }
    },
  });

  // Send auth info to server so it can filter by userId
  useEffect(() => {
    if (user && sendMessage) {
      sendMessage({ type: "auth", userId: user.id });
    }
  }, [user, sendMessage]);

  // Get all trades
  const { 
    data: trades = [],
    isLoading: isLoadingTrades,
    error: tradesError,
    refetch: refetchTrades 
  } = useQuery({
    queryKey: ["/api/trades"],
    enabled: !!user,
    refetchInterval: isTradeWsConnected ? false : 5000,
  });

  // Get open trades
  const { 
    data: openTrades = [],
    isLoading: isLoadingOpenTrades,
    error: openTradesError,
    refetch: refetchOpenTrades
  } = useQuery({
    queryKey: ["/api/trades/open"],
    enabled: !!user,
    refetchInterval: isTradeWsConnected ? false : 5000,
  });

  // Create a new trade
  const createTrade = useMutation({
    mutationFn: async (data: {
      symbolId: number;
      type: "BUY" | "SELL";
      size: number;
      openPrice: number;
      takeProfit?: number;
      stopLoss?: number;
    }) => {
      return apiRequest("POST", "/api/trades", data);
    },
    onSuccess: () => {
      toast({
        title: "Trade Created",
        description: "Your trade was successfully placed",
      });
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/current-user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to place trade",
        variant: "destructive",
      });
    },
  });

  // Close a trade (server determines close price from authoritative quotes)
  const closeTrade = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      return apiRequest("POST", `/api/trades/${id}/close`, {});
    },
    onMutate: async ({ id }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/trades/open"] });
      
      // Snapshot the previous value
      const previousOpenTrades = queryClient.getQueryData(["/api/trades/open"]);
      
      // Optimistically remove the trade from open trades immediately
      queryClient.setQueryData(["/api/trades/open"], (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter((trade: any) => trade.id !== id);
      });
      
      return { previousOpenTrades };
    },
    onSuccess: () => {
      toast({
        title: "Trade Closed",
        description: "Your trade was successfully closed",
      });
      // Force immediate refetch to get updated data from server
      queryClient.refetchQueries({ queryKey: ["/api/trades"], type: "active" });
      queryClient.refetchQueries({ queryKey: ["/api/trades/open"], type: "active" });
      queryClient.refetchQueries({ queryKey: ["/api/trades/pending"], type: "active" });
      queryClient.refetchQueries({ queryKey: ["/api/auth/current-user"], type: "active" });
      queryClient.refetchQueries({ queryKey: ["/api/account/summary"], type: "active" });
    },
    onError: (error: Error, _variables, context) => {
      // Rollback to the previous value on error
      if (context?.previousOpenTrades) {
        queryClient.setQueryData(["/api/trades/open"], context.previousOpenTrades);
      }
      toast({
        title: "Error",
        description: error.message || "Failed to close trade",
        variant: "destructive",
      });
    },
  });

  return {
    trades,
    openTrades,
    isLoadingTrades,
    isLoadingOpenTrades,
    tradesError,
    openTradesError,
    refetchTrades,
    refetchOpenTrades,
    createTrade,
    closeTrade,
  };
}
