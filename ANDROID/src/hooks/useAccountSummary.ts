/**
 * TradeQuip Android - Account Summary Hook
 * Aligned with webapp use-account-summary.tsx
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { accountApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuth } from './useAuth';

export interface AccountSummary {
    balance: number;
    equity: number;
    freeMargin: number;
    usedMargin: number;
    unrealizedPnl: number;
    realizedPnlToday: number;
    leverage: number;
    marginLevel?: number;
    openPositions: number;
    pendingOrders: number;
}

export function useAccountSummary() {
    const queryClient = useQueryClient();
    const { isAuthenticated, user } = useAuth();

    // Listen for account updates via WebSocket
    useEffect(() => {
        if (!isAuthenticated) return;

        const unsubMessage = wsService.onMessage((message) => {
            if (!message || typeof message !== 'object') return;

            if (
                message.type === 'account:updated' ||
                message.type === 'trades:updated' ||
                message.type === 'trades:update'
            ) {
                // Invalidate account summary to trigger refetch
                queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
            }
        });

        return () => {
            unsubMessage();
        };
    }, [isAuthenticated, queryClient]);

    const {
        data: summary,
        isLoading,
        error,
        refetch,
    } = useQuery<AccountSummary>({
        queryKey: ['account', 'summary'],
        queryFn: accountApi.getSummary,
        enabled: isAuthenticated,
        staleTime: 2000,
        refetchInterval: wsService.isConnected() ? false : 5000,
    });

    // Computed values
    const portfolioValue = summary?.equity || 0;
    const buyingPower = summary?.freeMargin || 0;
    const totalPnl = summary?.unrealizedPnl || 0;
    const todayPnl = summary?.realizedPnlToday || 0;
    const marginUsage = summary?.usedMargin || 0;

    // Calculate margin level percentage
    const marginLevel = summary?.marginLevel ||
        (summary?.usedMargin && summary?.equity
            ? (summary.equity / summary.usedMargin) * 100
            : undefined);

    // Calculate P&L percentage change
    const pnlPercentage = summary?.balance && summary.balance > 0
        ? ((summary.equity - summary.balance) / summary.balance) * 100
        : 0;

    return {
        summary,
        isLoading,
        error,
        refetch,

        // Computed values for easy access
        portfolioValue,
        buyingPower,
        totalPnl,
        todayPnl,
        marginUsage,
        marginLevel,
        pnlPercentage,

        // Raw values
        balance: summary?.balance || 0,
        equity: summary?.equity || 0,
        freeMargin: summary?.freeMargin || 0,
        usedMargin: summary?.usedMargin || 0,
        leverage: summary?.leverage || 1,
        openPositions: summary?.openPositions || 0,
        pendingOrders: summary?.pendingOrders || 0,
    };
}

export default useAccountSummary;
