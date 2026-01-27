/**
 * TradeQuip Native - Pending Orders Hook
 * Fetches and manages pending limit orders
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

interface PendingOrder {
    id: number;
    userId: number;
    symbol: string | { symbol: string };
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'STOP';
    lots: number;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
    status: string;
    createdAt: number | string | Date;
    expiresAt?: number | string | Date;
}

interface UsePendingOrdersOptions {
    enabled?: boolean;
    refetchInterval?: number;
}

export const usePendingOrders = (options: UsePendingOrdersOptions = {}) => {
    const { enabled = true, refetchInterval = 30000 } = options;
    const queryClient = useQueryClient();

    // Fetch pending orders
    const {
        data: pendingOrders = [],
        isLoading,
        isError,
        error,
        refetch,
        isRefetching,
    } = useQuery<PendingOrder[]>({
        queryKey: ['pending-orders'],
        queryFn: async () => {
            const response = await api.get('/api/trades/pending');
            return response.data;
        },
        enabled,
        refetchInterval,
        staleTime: 5000,
    });

    // Cancel order mutation
    const cancelMutation = useMutation({
        mutationFn: async (orderId: number) => {
            const response = await api.post(`/api/trades/${orderId}/cancel`);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
            queryClient.invalidateQueries({ queryKey: ['trades'] });
        },
    });

    // Modify order mutation
    const modifyMutation = useMutation({
        mutationFn: async ({
            orderId,
            updates,
        }: {
            orderId: number;
            updates: {
                price?: number;
                stopLoss?: number;
                takeProfit?: number;
                lots?: number;
            };
        }) => {
            const response = await api.put(`/api/trades/${orderId}`, updates);
            return response.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['pending-orders'] });
        },
    });

    // Helper to get symbol string
    const getSymbol = (order: PendingOrder): string => {
        return typeof order.symbol === 'object' ? order.symbol.symbol : order.symbol;
    };

    // Calculate total pending value
    const totalPendingValue = pendingOrders.reduce((sum, order) => {
        return sum + order.lots * order.price;
    }, 0);

    // Group by symbol
    const ordersBySymbol = pendingOrders.reduce((acc, order) => {
        const symbol = getSymbol(order);
        if (!acc[symbol]) {
            acc[symbol] = [];
        }
        acc[symbol].push(order);
        return acc;
    }, {} as Record<string, PendingOrder[]>);

    return {
        pendingOrders,
        isLoading,
        isError,
        error,
        refetch,
        isRefetching,
        cancelOrder: cancelMutation.mutate,
        cancelOrderAsync: cancelMutation.mutateAsync,
        isCancelling: cancelMutation.isPending,
        modifyOrder: modifyMutation.mutate,
        modifyOrderAsync: modifyMutation.mutateAsync,
        isModifying: modifyMutation.isPending,
        totalPendingValue,
        ordersBySymbol,
        pendingCount: pendingOrders.length,
        getSymbol,
    };
};

export default usePendingOrders;
