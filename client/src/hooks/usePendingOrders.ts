import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";
import { useAuth } from "@/hooks/use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { tierPollIntervalMs, usePerfHints } from "@/lib/perfHints";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";
import { WS_MSG_TRADES_UPDATE, WS_MSG_TRADES_UPDATED } from "@shared/ws/protocol";

type UsePendingOrdersOptions = {
  enabled?: boolean;
};

export const usePendingOrders = (options: UsePendingOrdersOptions = {}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const enabled = options.enabled ?? true;
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const pendingOrdersPollMs = tierPollIntervalMs(
    performanceSettings.restFallbackPollMs,
    perfHints,
    performanceSettings,
  );
  const { isConnected: isWsConnected, subscribe } = useLiveUpdates();
  const wsFallbackRefetchMode = isWsConnected ? false : ("always" as const);

  useEffect(() => {
    if (!userId) return;
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== WS_MSG_TRADES_UPDATED && message.type !== WS_MSG_TRADES_UPDATE) return;
      const messageUserId = (message as any).userId;
      if (messageUserId && messageUserId !== userId) return;
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
    });
  }, [queryClient, subscribe, userId]);

  const {
    data: pendingOrders,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/trades/pending"],
    enabled: enabled && !!userId,
    refetchInterval: isWsConnected ? false : pendingOrdersPollMs,
    staleTime: isWsConnected ? Infinity : 15_000,
    refetchOnWindowFocus: wsFallbackRefetchMode,
    refetchOnReconnect: wsFallbackRefetchMode,
  });

  const cancelOrder = useMutation({
    mutationFn: async (tradeId: number) => {
      const response = await fetchWithIdentity(`/api/trades/${tradeId}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Pending order canceled successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel order",
        variant: "destructive",
      });
    },
  });

  return {
    pendingOrders: pendingOrders || [],
    isLoading,
    error,
    refetch,
    cancelOrder,
  };
};
