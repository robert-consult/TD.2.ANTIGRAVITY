/**
 * TradeQuip Android - Trades Hook
 * Aligned with webapp use-trades.tsx
 */

import { useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tradingApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuth } from './useAuth';

// Trade interface matching webapp
export interface Trade {
    id: number;
    userId: number;
    symbolId: number;
    symbol?: {
        id: number;
        name: string;
        symbol?: string;
    };
    type: 'BUY' | 'SELL';
    orderType?: string;
    status: 'OPEN' | 'CLOSED' | 'PENDING' | 'CANCELED';
    size?: number;
    lots?: number;
    openPrice: number;
    closePrice?: number | null;
    takeProfit?: number;
    stopLoss?: number;
    limitPrice?: number | null;
    stopPrice?: number | null;
    profit?: string | number | null;
    grossProfitUsd?: number | null;
    netProfitUsd?: number | null;
    notionalUsd?: number | null;
    totalCostsUsd?: number | null;
    openCommissionUsd?: number | null;
    closeCommissionUsd?: number | null;
    openOtherFeesUsd?: number | null;
    closeOtherFeesUsd?: number | null;
    financingAccruedUsd?: number | null;
    swapAccruedUsd?: number | null;
    overnightDays?: number | null;
    categorySnapshot?: string | null;
    costModelVersion?: string | null;
    openedAt: number | string;
    closedAt?: number | string | null;
}

export function useTrades() {
    const queryClient = useQueryClient();
    const { user, isAuthenticated } = useAuth();
    const userId = user?.id;

    // Subscribe to trade updates via WebSocket
    useEffect(() => {
        if (!isAuthenticated || !userId) return;

        // Subscribe when connected
        const unsubConnect = wsService.onConnect(() => {
            wsService.subscribeTrades();
        });

        // Handle trade update messages
        const unsubMessage = wsService.onMessage((message) => {
            if (!message || typeof message !== 'object') return;

            if (message.type === 'trades:updated' || message.type === 'trades:update') {
                const messageUserId = message.userId;
                if (!messageUserId || messageUserId === userId) {
                    // Invalidate trade queries to trigger refetch
                    queryClient.invalidateQueries({ queryKey: ['trades'] });
                    queryClient.invalidateQueries({ queryKey: ['trades', 'open'] });
                    queryClient.invalidateQueries({ queryKey: ['trades', 'pending'] });
                }
            }
        });

        // If already connected, subscribe immediately
        if (wsService.isConnected()) {
            wsService.subscribeTrades();
        }

        return () => {
            wsService.unsubscribeTrades();
            unsubConnect();
            unsubMessage();
        };
    }, [isAuthenticated, userId, queryClient]);

    // Get all trades (history)
    const {
        data: trades = [],
        isLoading: isLoadingTrades,
        error: tradesError,
        refetch: refetchTrades,
    } = useQuery<Trade[]>({
        queryKey: ['trades'],
        queryFn: tradingApi.getTrades,
        enabled: isAuthenticated,
        staleTime: 5000,
        refetchInterval: wsService.isConnected() ? false : 7000,
    });

    // Get open trades (positions)
    const {
        data: openTrades = [],
        isLoading: isLoadingOpenTrades,
        error: openTradesError,
        refetch: refetchOpenTrades,
    } = useQuery<Trade[]>({
        queryKey: ['trades', 'open'],
        queryFn: tradingApi.getOpenTrades,
        enabled: isAuthenticated,
        staleTime: 2000,
        refetchInterval: wsService.isConnected() ? false : 5000,
    });

    // Get pending orders
    const {
        data: pendingOrders = [],
        isLoading: isLoadingPending,
        error: pendingError,
        refetch: refetchPending,
    } = useQuery<Trade[]>({
        queryKey: ['trades', 'pending'],
        queryFn: tradingApi.getPendingOrders,
        enabled: isAuthenticated,
        staleTime: 5000,
        refetchInterval: wsService.isConnected() ? false : 7000,
    });

    // Create trade mutation
    const createTradeMutation = useMutation({
        mutationFn: tradingApi.createTrade,
        onSuccess: () => {
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['trades', 'open'] });
            queryClient.invalidateQueries({ queryKey: ['trades', 'pending'] });
            queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
        },
    });

    // Close trade mutation with optimistic update
    const closeTradeMutation = useMutation({
        mutationFn: tradingApi.closeTrade,
        onMutate: async (tradeId: number) => {
            // Cancel outgoing refetches
            await queryClient.cancelQueries({ queryKey: ['trades', 'open'] });

            // Snapshot previous value
            const previousOpenTrades = queryClient.getQueryData(['trades', 'open']);

            // Optimistically remove from open trades
            queryClient.setQueryData(['trades', 'open'], (old: Trade[] | undefined) => {
                if (!old) return old;
                return old.filter((trade) => trade.id !== tradeId);
            });

            return { previousOpenTrades };
        },
        onSuccess: (closedTrade, _tradeId, _context) => {
            // Add closed trade to history
            if (closedTrade?.id) {
                queryClient.setQueryData(['trades'], (old: Trade[] | undefined) => {
                    if (!Array.isArray(old)) return [closedTrade];
                    const exists = old.some((t) => t.id === closedTrade.id);
                    if (exists) {
                        return old.map((t) => (t.id === closedTrade.id ? closedTrade : t));
                    }
                    return [closedTrade, ...old];
                });
            }

            // Invalidate to ensure fresh data
            queryClient.invalidateQueries({ queryKey: ['trades'] });
            queryClient.invalidateQueries({ queryKey: ['trades', 'open'] });
            queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
        },
        onError: (_error, _tradeId, context) => {
            // Rollback on error
            if (context?.previousOpenTrades) {
                queryClient.setQueryData(['trades', 'open'], context.previousOpenTrades);
            }
        },
    });

    // Cancel pending order mutation
    const cancelOrderMutation = useMutation({
        mutationFn: tradingApi.cancelOrder,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['trades', 'pending'] });
        },
    });

    // Helper functions
    const createTrade = useCallback(
        async (data: Parameters<typeof tradingApi.createTrade>[0]) => {
            return createTradeMutation.mutateAsync(data);
        },
        [createTradeMutation]
    );

    const closeTrade = useCallback(
        async (tradeId: number) => {
            return closeTradeMutation.mutateAsync(tradeId);
        },
        [closeTradeMutation]
    );

    const cancelOrder = useCallback(
        async (orderId: number) => {
            return cancelOrderMutation.mutateAsync(orderId);
        },
        [cancelOrderMutation]
    );

    return {
        // Data
        trades,
        openTrades,
        pendingOrders,

        // Loading states
        isLoadingTrades,
        isLoadingOpenTrades,
        isLoadingPending,

        // Errors
        tradesError,
        openTradesError,
        pendingError,

        // Refetch functions
        refetchTrades,
        refetchOpenTrades,
        refetchPending,

        // Mutations
        createTrade,
        closeTrade,
        cancelOrder,

        // Mutation states
        isCreatingTrade: createTradeMutation.isPending,
        isClosingTrade: closeTradeMutation.isPending,
        isCancellingOrder: cancelOrderMutation.isPending,
        createTradeError: createTradeMutation.error,
        closeTradeError: closeTradeMutation.error,
    };
}

export default useTrades;
