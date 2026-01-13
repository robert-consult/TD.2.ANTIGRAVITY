import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";

export function useTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { isConnected: isTradeWsConnected, sendMessage, subscribe } = useLiveUpdates();

  useEffect(() => {
    if (!user || !isTradeWsConnected) return;
    sendMessage({ type: "trades:subscribe" });
    return () => {
      sendMessage({ type: "trades:unsubscribe" });
    };
  }, [user?.id, isTradeWsConnected, sendMessage]);

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== "trades:updated" && message.type !== "trades:update") return;

      const messageUserId = message.userId;
      const currentUserId = user?.id;
      if (!messageUserId || !currentUserId || messageUserId === currentUserId) {
        queryClient.refetchQueries({ queryKey: ["/api/trades"], type: "active" });
        queryClient.refetchQueries({ queryKey: ["/api/trades/open"], type: "active" });
        queryClient.refetchQueries({ queryKey: ["/api/trades/pending"], type: "active" });
        queryClient.refetchQueries({ queryKey: ["/api/auth/current-user"], type: "active" });
        queryClient.refetchQueries({ queryKey: ["/api/account/summary"], type: "active" });
      }
    });
  }, [queryClient, subscribe, user?.id]);

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
