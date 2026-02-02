import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { getTradeErrorToast } from "@/lib/tradeErrorMessages";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { recommendedPollIntervalMs } from "@/lib/perfHints";

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
        queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
        queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
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
    refetchInterval: isTradeWsConnected ? false : recommendedPollIntervalMs(7000),
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
    refetchInterval: isTradeWsConnected ? false : recommendedPollIntervalMs(7000),
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
      if (!isTradeWsConnected) {
        queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }
    },
    onError: (error: Error) => {
      const { title, description } = getTradeErrorToast(error);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });

  // Close a trade (server determines close price from authoritative quotes)
  const closeTrade = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await apiRequest("POST", `/api/trades/${id}/close`, {});
      return res.json();
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
    onSuccess: (closedTrade: any, _vars, context) => {
      toast({
        title: "Trade Closed",
        description: "Your trade was successfully closed",
      });
      // Update cached trade history immediately so History tab reflects the close instantly.
      if (closedTrade?.id) {
        const previousOpenTrades = Array.isArray(context?.previousOpenTrades)
          ? context?.previousOpenTrades
          : [];
        const previousTrade = previousOpenTrades.find((trade: any) => trade?.id === closedTrade.id);
        const mergedTrade = previousTrade
          ? { ...previousTrade, ...closedTrade, symbol: previousTrade.symbol ?? closedTrade.symbol }
          : closedTrade;

        queryClient.setQueryData(["/api/trades"], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return old;
          let found = false;
          const next = old.map((trade) => {
            if (trade?.id !== closedTrade.id) return trade;
            found = true;
            return { ...trade, ...mergedTrade, symbol: trade.symbol ?? mergedTrade.symbol };
          });
          if (!found) {
            return [{ ...mergedTrade }, ...next];
          }
          return next;
        });

        queryClient.setQueryData(["/api/trades/history"], (old: any[] | undefined) => {
          if (!Array.isArray(old)) return [{ ...mergedTrade }];
          let found = false;
          const next = old.map((trade) => {
            if (trade?.id !== closedTrade.id) return trade;
            found = true;
            return { ...trade, ...mergedTrade, symbol: trade.symbol ?? mergedTrade.symbol };
          });
          if (!found) {
            return [{ ...mergedTrade }, ...next];
          }
          return next;
        });
      }

      // Mark queries stale so active views refetch and background tabs stay ready.
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      if (!isTradeWsConnected) {
        queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }
    },
    onError: (error: Error, _variables, context) => {
      // Rollback to the previous value on error
      if (context?.previousOpenTrades) {
        queryClient.setQueryData(["/api/trades/open"], context.previousOpenTrades);
      }
      const { title, description } = getTradeErrorToast(error);
      toast({
        title,
        description,
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
