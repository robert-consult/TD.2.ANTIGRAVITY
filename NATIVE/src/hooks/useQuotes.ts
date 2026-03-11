/**
 * TradeQuip Android - Quotes Hook
 * Real-time quotes with WebSocket support
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    WS_MSG_QUOTES_SNAPSHOT,
    WS_MSG_QUOTES_UPDATE,
} from '@shared/ws/protocol';
import { quotesApi } from '../services/api';
import { wsService } from '../services/websocket';
import { useAuth } from './useAuth';
import { useWsConnectionState } from './useWsConnectionState';

export interface SymbolConfig {
    id: number;
    symbol: string;
    name: string;
    enabled?: boolean;
    minSpreadPips?: number | null;
    minLot?: number | null;
    maxLot?: number | null;
}

export interface Quote {
    symbol: string;
    symbolId?: number;
    name: string;
    price: number;
    bid?: number;
    ask?: number;
    spread?: number;
    prevClose?: number;
    change: number;
    changePct: number;
    isStale?: boolean;
    lastApiUpdate?: number;
    dataAge?: number;
    marketOpen?: boolean;
    timestamp: number;
}

function toNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function calculatePctChange(current: number | null, previous: number | null): number {
    if (!current || !previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
}

export function useQuotes() {
    const queryClient = useQueryClient();
    const { isAuthenticated } = useAuth();
    const isLive = useWsConnectionState();

    // Get symbols configuration
    const {
        data: symbols = [],
        isLoading: isLoadingSymbols,
        error: symbolsError,
    } = useQuery<SymbolConfig[]>({
        queryKey: ['symbols'],
        queryFn: quotesApi.getSymbols,
        enabled: isAuthenticated,
        staleTime: 60000, // Symbols rarely change
    });

    const enabledSymbols = useMemo(() => {
        return (symbols || [])
            .filter((s) => s?.enabled !== false)
            .map((s) => String(s.symbol || '').toUpperCase())
            .filter(Boolean);
    }, [symbols]);

    const symbolNameMap = useMemo(() => {
        const m = new Map<string, { id: number; name: string }>();
        for (const s of symbols || []) {
            const sym = String(s.symbol || '').toUpperCase();
            if (!sym) continue;
            m.set(sym, { id: s.id, name: s.name });
        }
        return m;
    }, [symbols]);

    const quotesUrl = useMemo(() => {
        const q = enabledSymbols.join(',');
        return q ? `/api/quotes/latest?symbols=${encodeURIComponent(q)}` : '/api/quotes/latest';
    }, [enabledSymbols]);

    // Get current quotes (REST snapshot / polling fallback)
    const {
        data: quotes = [],
        isLoading: isLoadingQuotes,
        error: quotesError,
        refetch: refetchQuotes,
    } = useQuery<Quote[]>({
        queryKey: ['quotes'],
        queryFn: async () => {
            const rows = await quotesApi.getQuotes(enabledSymbols);
            if (!Array.isArray(rows)) return [];

            return rows
                .map((row: any) => {
                    const sym = String(row?.symbol || '').toUpperCase();
                    if (!sym) return null;
                    const meta = symbolNameMap.get(sym);
                    const bid = toNumber(row?.bid);
                    const ask = toNumber(row?.ask);
                    const price = toNumber(row?.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : null) ?? 0;
                    const prevClose = toNumber(row?.prevClose) ?? price ?? 0;
                    const change = toNumber(row?.change) ?? (price != null && prevClose != null ? price - prevClose : 0) ?? 0;
                    const changePct = toNumber(row?.pctChange) ?? calculatePctChange(price, prevClose);
                    const spread =
                        toNumber(row?.spread) ??
                        (bid != null && ask != null ? Math.abs(ask - bid) : undefined);
                    const lastApiUpdate = toNumber(row?.lastApiUpdate) ?? undefined;
                    const dataAge = toNumber(row?.dataAge) ?? (lastApiUpdate ? Date.now() - lastApiUpdate : undefined);

                    return {
                        symbol: sym,
                        symbolId: meta?.id,
                        name: meta?.name || sym,
                        price: price ?? 0,
                        bid: bid ?? undefined,
                        ask: ask ?? undefined,
                        spread,
                        prevClose: prevClose ?? undefined,
                        change,
                        changePct: changePct ?? 0,
                        isStale: Boolean(row?.isStale ?? false),
                        lastApiUpdate,
                        dataAge,
                        marketOpen: typeof row?.marketOpen === 'boolean' ? row.marketOpen : undefined,
                        timestamp: typeof row?.timestamp === 'number' ? row.timestamp : Math.floor(Date.now() / 1000),
                    } satisfies Quote;
                })
                .filter(Boolean) as Quote[];
        },
        enabled: isAuthenticated,
        staleTime: 1000,
        refetchInterval: isLive ? false : 5000,
    });

    // Get quote by symbol name
    const getQuote = useCallback(
        (symbol: string): Quote | undefined => {
            const key = String(symbol || '').toUpperCase();
            return quotes.find((q) => q.symbol === key);
        },
        [quotes]
    );

    const getSymbolById = useCallback(
        (symbolId: number): SymbolConfig | undefined => {
            return symbols.find((s) => s.id === symbolId);
        },
        [symbols]
    );

    const getSymbolBySymbol = useCallback(
        (symbol: string): SymbolConfig | undefined => {
            const key = String(symbol || '').toUpperCase();
            return symbols.find((s) => String(s.symbol || '').toUpperCase() === key);
        },
        [symbols]
    );

    // Subscribe to quote updates via WebSocket
    useEffect(() => {
        if (!isAuthenticated) return;

        const applyRows = (rows: any[], replace: boolean) => {
            if (!Array.isArray(rows) || rows.length === 0) return;
            const allowed = new Set(enabledSymbols);

            queryClient.setQueryData(['quotes'], (old: Quote[] | undefined) => {
                const map = new Map<string, Quote>();
                if (!replace && Array.isArray(old)) {
                    for (const q of old) map.set(q.symbol, q);
                }

                for (const row of rows) {
                    const sym = String(row?.symbol || '').toUpperCase();
                    if (!sym) continue;
                    if (allowed.size > 0 && !allowed.has(sym)) continue;

                    const prev = map.get(sym);
                    const meta = symbolNameMap.get(sym);

                    const bid = toNumber(row?.bid) ?? prev?.bid ?? null;
                    const ask = toNumber(row?.ask) ?? prev?.ask ?? null;
                    const price = toNumber(row?.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : null) ?? prev?.price ?? 0;
                    const prevClose = toNumber(row?.prevClose) ?? prev?.prevClose ?? price ?? 0;
                    const change = toNumber(row?.change) ?? (price != null && prevClose != null ? price - prevClose : 0) ?? prev?.change ?? 0;
                    const changePct = toNumber(row?.pctChange) ?? calculatePctChange(price, prevClose);
                    const spread =
                        toNumber(row?.spread) ??
                        (bid != null && ask != null ? Math.abs(ask - bid) : prev?.spread);
                    const lastApiUpdate = toNumber(row?.lastApiUpdate) ?? prev?.lastApiUpdate;
                    const dataAge = toNumber(row?.dataAge) ?? (lastApiUpdate ? Date.now() - lastApiUpdate : prev?.dataAge);
                    const isStale = Boolean(row?.isStale ?? prev?.isStale ?? false);
                    const marketOpen =
                        typeof row?.marketOpen === 'boolean' ? row.marketOpen : prev?.marketOpen;

                    map.set(sym, {
                        symbol: sym,
                        symbolId: meta?.id ?? prev?.symbolId,
                        name: meta?.name || prev?.name || sym,
                        price,
                        bid: bid ?? undefined,
                        ask: ask ?? undefined,
                        spread: typeof spread === 'number' ? spread : undefined,
                        prevClose: typeof prevClose === 'number' ? prevClose : undefined,
                        change,
                        changePct: typeof changePct === 'number' ? changePct : prev?.changePct ?? 0,
                        isStale,
                        lastApiUpdate: typeof lastApiUpdate === 'number' ? lastApiUpdate : undefined,
                        dataAge: typeof dataAge === 'number' ? dataAge : undefined,
                        marketOpen,
                        timestamp: typeof row?.timestamp === 'number' ? row.timestamp : prev?.timestamp ?? Math.floor(Date.now() / 1000),
                    });
                }

                return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
            });
        };

        const subscribeNow = () => {
            if (enabledSymbols.length) {
                wsService.subscribeQuotes(enabledSymbols);
            } else {
                wsService.subscribeQuotes();
            }
        };

        const unsubConnect = wsService.onConnect(() => subscribeNow());
        const unsubDisconnect = wsService.onDisconnect(() => undefined);

        const unsubMessage = wsService.onMessage((message) => {
            if (!message || typeof message !== 'object') return;
            if (message.type === WS_MSG_QUOTES_SNAPSHOT) {
                applyRows((message as any).rows ?? [], true);
            }
            if (message.type === WS_MSG_QUOTES_UPDATE) {
                applyRows((message as any).rows ?? [], false);
            }
        });

        if (wsService.isConnected()) {
            subscribeNow();
        }

        return () => {
            wsService.unsubscribeQuotes();
            unsubConnect();
            unsubDisconnect();
            unsubMessage();
        };
    }, [enabledSymbols, isAuthenticated, queryClient, symbolNameMap]);

    useEffect(() => {
        if (!isAuthenticated || isLive) return;
        refetchQuotes().catch(() => undefined);
    }, [isAuthenticated, isLive, refetchQuotes]);

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
        getSymbolById,
        getSymbolBySymbol,

        // WebSocket status
        isLive,

        // Debug/metrics helpers
        quotesUrl,
    };
}

export default useQuotes;
