/**
 * TradeQuip Android - Quotes Hook
 * Handles real-time quote updates via WebSocket
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { tradingApi } from '../services/api';

interface Quote {
    symbol: string;
    bid: number;
    ask: number;
    price: number;
    change: number;
    changePercent: number;
    timestamp: number;
}

export const useQuotes = () => {
    const queryClient = useQueryClient();
    const wsRef = useRef<WebSocket | null>(null);

    const {
        data: quotes,
        isLoading,
        error,
        refetch,
    } = useQuery<Quote[]>({
        queryKey: ['quotes'],
        queryFn: async () => {
            const response = await tradingApi.getQuotes();
            return response.quotes || [];
        },
        staleTime: 1000, // 1 second
        refetchInterval: 5000, // Fallback polling every 5 seconds
    });

    // WebSocket connection for real-time updates
    useEffect(() => {
        const connectWebSocket = () => {
            // TODO: Replace with actual WebSocket URL
            const ws = new WebSocket('wss://your-api-domain.com/ws/quotes');

            ws.onopen = () => {
                console.log('WebSocket connected');
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'quote') {
                        // Update the specific quote in cache
                        queryClient.setQueryData<Quote[]>(['quotes'], (oldQuotes) => {
                            if (!oldQuotes) return [data.quote];
                            return oldQuotes.map((q) =>
                                q.symbol === data.quote.symbol ? data.quote : q
                            );
                        });
                    }
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected, reconnecting...');
                // Reconnect after 3 seconds
                setTimeout(connectWebSocket, 3000);
            };

            wsRef.current = ws;
        };

        connectWebSocket();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [queryClient]);

    return {
        quotes: quotes || [],
        isLoading,
        error,
        refetch,
    };
};

export default useQuotes;
