/**
 * TradeQuip Android - Account Summary Hook
 * Aligned with webapp use-account-summary.tsx
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
    WS_MSG_ACCOUNT_SNAPSHOT,
    WS_MSG_ACCOUNT_UPDATE,
    WS_MSG_ACCOUNT_UPDATED,
    WS_MSG_TRADES_UPDATE,
    WS_MSG_TRADES_UPDATED,
} from '@shared/ws/protocol';
import { accountApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuth } from './useAuth';
import { useWsConnectionState } from './useWsConnectionState';

export interface AccountSummary {
    balance: number;
    equity: number;
    usedMargin: number;
    freeMargin: number;
    floatingPnl: number;
    marginLevel: number | null;
    openPositions: number;
    pricingStale: boolean;
    staleSymbols: string[];
    asOf: string | null;
}

export function useAccountSummary() {
    const queryClient = useQueryClient();
    const { isAuthenticated } = useAuth();
    const isLive = useWsConnectionState();

    // Subscribe to account updates via WebSocket (requires authenticated WS session)
    useEffect(() => {
        if (!isAuthenticated) return;

        const subscribeNow = () => {
            wsService.subscribeAccount();
        };

        const unsubConnect = wsService.onConnect(() => subscribeNow());

        // Subscribe immediately if already connected
        if (wsService.isConnected()) {
            subscribeNow();
        }

        const unsubMessage = wsService.onMessage((message) => {
            if (!message || typeof message !== 'object') return;

            if (
                message.type === WS_MSG_ACCOUNT_SNAPSHOT ||
                message.type === WS_MSG_ACCOUNT_UPDATE ||
                message.type === WS_MSG_ACCOUNT_UPDATED
            ) {
                const summary = (message as any)?.payload?.summary;
                if (summary && typeof summary === 'object') {
                    queryClient.setQueryData(['account', 'summary'], summary);
                } else {
                    queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
                }
            }

            if (message.type === WS_MSG_TRADES_UPDATED || message.type === WS_MSG_TRADES_UPDATE) {
                queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
            }
        });

        return () => {
            wsService.unsubscribeAccount();
            unsubConnect();
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
        refetchInterval: isLive ? false : 7000,
    });

    useEffect(() => {
        if (!isAuthenticated || isLive) return;
        refetch().catch(() => undefined);
    }, [isAuthenticated, isLive, refetch]);

    // Computed values
    const portfolioValue = summary?.equity || 0;
    const buyingPower = summary?.freeMargin || 0;
    const totalPnl = summary?.floatingPnl || 0;
    const marginUsage = summary?.usedMargin || 0;

    // Calculate margin level percentage
    const marginLevel = typeof summary?.marginLevel === 'number'
        ? summary.marginLevel
        : null;

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
        marginUsage,
        marginLevel,
        pnlPercentage,

        // Raw values
        balance: summary?.balance || 0,
        equity: summary?.equity || 0,
        freeMargin: summary?.freeMargin || 0,
        usedMargin: summary?.usedMargin || 0,
        openPositions: summary?.openPositions || 0,
        pricingStale: summary?.pricingStale || false,
        staleSymbols: summary?.staleSymbols || [],
        asOf: summary?.asOf || null,
    };
}

export default useAccountSummary;
