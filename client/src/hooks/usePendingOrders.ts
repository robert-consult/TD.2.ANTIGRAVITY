import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fetchWithIdentity } from "@/lib/fetchWithIdentity";

export const usePendingOrders = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: pendingOrders,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["/api/trades/pending"],
    refetchInterval: 10000, // Refetch every 10 seconds
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
