import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { getTradeErrorToast } from "@/lib/tradeErrorMessages";
import { useAuth } from "./use-auth";
import { useToast } from "./use-toast";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { usePerfHints } from "@/lib/perfHints";
import { resolveRuntimeIntervals } from "@/lib/runtimeIntervals";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";
import {
  WS_MSG_TRADES_SUBSCRIBE,
  WS_MSG_TRADES_UNSUBSCRIBE,
  WS_MSG_TRADES_UPDATE,
  WS_MSG_TRADES_UPDATED,
} from "@shared/ws/protocol";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useTrades() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const runtimeIntervals = resolveRuntimeIntervals(perfHints, performanceSettings);
  const tradesPollIntervalMs = runtimeIntervals.trades.restFallbackPollMs;

  const { isConnected: isTradeWsConnected, sendMessage, subscribe } = useLiveUpdates();
  const wsFallbackRefetchMode = isTradeWsConnected ? false : ("always" as const);

  useEffect(() => {
    if (!user || !isTradeWsConnected) return;
    sendMessage({ type: WS_MSG_TRADES_SUBSCRIBE });
    return () => {
      sendMessage({ type: WS_MSG_TRADES_UNSUBSCRIBE });
    };
  }, [user?.id, isTradeWsConnected, sendMessage]);

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== WS_MSG_TRADES_UPDATED && message.type !== WS_MSG_TRADES_UPDATE) return;

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
    refetchInterval: isTradeWsConnected ? false : tradesPollIntervalMs,
    staleTime: isTradeWsConnected ? Infinity : 15_000,
    refetchOnWindowFocus: wsFallbackRefetchMode,
    refetchOnReconnect: wsFallbackRefetchMode,
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
    refetchInterval: isTradeWsConnected ? false : tradesPollIntervalMs,
    staleTime: isTradeWsConnected ? Infinity : 15_000,
    refetchOnWindowFocus: wsFallbackRefetchMode,
    refetchOnReconnect: wsFallbackRefetchMode,
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
      const startedAt = Date.now();
      let backoffMs = 1000;
      const maxWaitMs = 15_000;

      while (true) {
        try {
          const res = await apiRequest("POST", `/api/trades/${id}/close`, {});
          return res.json();
        } catch (err) {
          if (err instanceof ApiError && err.code === "QUOTE_STALE_CLOSE") {
            if (Date.now() - startedAt >= maxWaitMs) throw err;
            await sleep(backoffMs);
            backoffMs = Math.min(2000, Math.round(backoffMs * 1.5));
            continue;
          }
          throw err;
        }
      }
    },
    onSuccess: (closedTrade: any) => {
      toast({
        title: "Trade Closed",
        description: "Your trade was successfully closed",
      });
      // Update cached trade history immediately so History tab reflects the close instantly.
      if (closedTrade?.id) {
        const previousOpenTrades = queryClient.getQueryData(["/api/trades/open"]);
        const openTradesArr = Array.isArray(previousOpenTrades) ? previousOpenTrades : [];
        const previousTrade = openTradesArr.find((trade: any) => trade?.id === closedTrade.id);
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
    onError: (error: Error) => {
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
