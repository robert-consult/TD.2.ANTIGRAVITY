/**
 * TradeQuip Android - Quotes Hook
 * Real-time quotes with WebSocket support
 */

import { useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { quotesApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuth } from './useAuth';

export interface Symbol {
    id: number;
    name: string;
    displayName: string;
    category: string;
    pipSize: number;
    contractSize: number;
    minLotSize: number;
    maxLotSize: number;
    lotStep: number;
}

export interface Quote {
    symbolId: number;
    symbol: string;
    bid: number;
    ask: number;
    spread: number;
    change: number;
    changePercent: number;
    high24h?: number;
    low24h?: number;
    volume24h?: number;
    timestamp: number;
}

export function useQuotes() {
    const queryClient = useQueryClient();
    const { isAuthenticated } = useAuth();

    // Subscribe to quote updates via WebSocket
    useEffect(() => {
        if (!isAuthenticated) return;

        // Subscribe when connected
        const unsubConnect = wsService.onConnect(() => {
            wsService.subscribeQuotes();
        });

        // Handle quote update messages
        const unsubMessage = wsService.onMessage((message) => {
            if (!message || typeof message !== 'object') return;

            if (message.type === 'quote' || message.type === 'quotes:update') {
                // Update specific quote in cache
                if (message.quote) {
                    queryClient.setQueryData(['quotes'], (oldQuotes: Quote[] | undefined) => {
                        if (!oldQuotes) return [message.quote];
                        return oldQuotes.map((q) =>
                            q.symbolId === message.quote.symbolId ? { ...q, ...message.quote } : q
                        );
                    });
                }

                // Batch update
                if (message.quotes && Array.isArray(message.quotes)) {
                    queryClient.setQueryData(['quotes'], (oldQuotes: Quote[] | undefined) => {
                        if (!oldQuotes) return message.quotes;
                        const quoteMap = new Map(message.quotes.map((q: Quote) => [q.symbolId, q]));
                        return oldQuotes.map((q) => quoteMap.has(q.symbolId) ? { ...q, ...quoteMap.get(q.symbolId) } : q);
                    });
                }
            }
        });

        // If already connected, subscribe immediately
        if (wsService.isConnected()) {
            wsService.subscribeQuotes();
        }

        return () => {
            wsService.unsubscribeQuotes();
            unsubConnect();
            unsubMessage();
        };
    }, [isAuthenticated, queryClient]);

    // Get symbols configuration
    const {
        data: symbols = [],
        isLoading: isLoadingSymbols,
        error: symbolsError,
    } = useQuery<Symbol[]>({
        queryKey: ['symbols'],
        queryFn: quotesApi.getSymbols,
        enabled: isAuthenticated,
        staleTime: 60000, // Symbols rarely change
    });

    // Get current quotes
    const {
        data: quotes = [],
        isLoading: isLoadingQuotes,
        error: quotesError,
        refetch: refetchQuotes,
    } = useQuery<Quote[]>({
        queryKey: ['quotes'],
        queryFn: quotesApi.getQuotes,
        enabled: isAuthenticated,
        staleTime: 1000,
        refetchInterval: wsService.isConnected() ? false : 3000,
    });

    // Get quote by symbol name
    const getQuote = useCallback(
        (symbolName: string): Quote | undefined => {
            return quotes.find((q) => q.symbol === symbolName);
        },
        [quotes]
    );

    // Get quote by symbol ID
    const getQuoteById = useCallback(
        (symbolId: number): Quote | undefined => {
            return quotes.find((q) => q.symbolId === symbolId);
        },
        [quotes]
    );

    // Get symbol by ID
    const getSymbol = useCallback(
        (symbolId: number): Symbol | undefined => {
            return symbols.find((s) => s.id === symbolId);
        },
        [symbols]
    );

    // Get symbol by name
    const getSymbolByName = useCallback(
        (name: string): Symbol | undefined => {
            return symbols.find((s) => s.name === name || s.displayName === name);
        },
        [symbols]
    );

    return {
        // Data
        quotes,
        symbols,

        // Loading states
        isLoadingQuotes,
        isLoadingSymbols,
        isLoading: isLoadingQuotes || isLoadingSymbols,

        // Errors
        quotesError,
        symbolsError,

        // Actions
        refetchQuotes,

        // Helpers
        getQuote,
        getQuoteById,
        getSymbol,
        getSymbolByName,

        // WebSocket status
        isLive: wsService.isConnected(),
    };
}

export default useQuotes;
