import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";
import { useAuth } from "@/hooks/use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { recommendedPollIntervalMs } from "@/lib/perfHints";

type UsePendingOrdersOptions = {
  enabled?: boolean;
};

export const usePendingOrders = (options: UsePendingOrdersOptions = {}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enabled = options.enabled ?? true;
  const { isConnected: isWsConnected, subscribe } = useLiveUpdates();

  useEffect(() => {
    if (!user) return;
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type !== "trades:updated" && message.type !== "trades:update") return;
      const messageUserId = (message as any).userId;
      if (messageUserId && user.id && messageUserId !== user.id) return;
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
    });
  }, [queryClient, subscribe, user]);

  const {
    data: pendingOrders,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/trades/pending"],
    enabled: enabled && !!user,
    refetchInterval: isWsConnected ? false : recommendedPollIntervalMs(10_000),
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
