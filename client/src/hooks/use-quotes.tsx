import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";

interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  time: number;
  bid?: number;
  ask?: number;
  spread?: number;
  prevClose?: number;
  changePct?: number;
  percent_change?: number;
  isStale?: boolean;
  lastApiUpdate?: number;
  dataAge?: number;
}

interface SymbolConfig {
  id: number;
  symbol: string;
  name: string;
  enabled?: boolean;
}

// Fallback REST polling interval when WebSocket isn't available.
const FALLBACK_POLL_INTERVAL = 5000;

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
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const quotesRef = useRef<Map<string, Quote>>(new Map());
  const symbolNameMapRef = useRef<Map<string, string>>(new Map());
  const prevSymbolsRef = useRef<string[]>([]);

  const { isConnected: isWsConnected, sendMessage, subscribe } = useLiveUpdates();

  // Fetch available symbols
  const { data: symbols = [] } = useQuery<SymbolConfig[]>({
    queryKey: ["/api/config/symbols"],
  });

  useEffect(() => {
    const map = new Map<string, string>();
    (symbols || []).forEach((s) => {
      if (s.enabled !== false) {
        map.set(String(s.symbol), s.name);
      }
    });
    symbolNameMapRef.current = map;
  }, [symbols]);
  
  const requestedSymbols = useMemo(() => {
    return (symbols || [])
      .filter((s) => s.enabled !== false)
      .map((s) => String(s.symbol).toUpperCase());
  }, [symbols]);

  useEffect(() => {
    if (!isWsConnected) {
      prevSymbolsRef.current = [];
      return;
    }
    if (!requestedSymbols.length) {
      if (prevSymbolsRef.current.length) {
        sendMessage({ type: "quotes:unsubscribe", symbols: prevSymbolsRef.current });
        prevSymbolsRef.current = [];
      }
      return;
    }

    const prev = new Set(prevSymbolsRef.current);
    const next = new Set(requestedSymbols);

    const subscribeSymbols = [...next].filter((s) => !prev.has(s));
    const unsubscribeSymbols = [...prev].filter((s) => !next.has(s));

    if (subscribeSymbols.length) {
      sendMessage({ type: "quotes:subscribe", symbols: subscribeSymbols });
    }
    if (unsubscribeSymbols.length) {
      sendMessage({ type: "quotes:unsubscribe", symbols: unsubscribeSymbols });
    }

    prevSymbolsRef.current = requestedSymbols;
    return () => {
      if (requestedSymbols.length && isWsConnected) {
        sendMessage({ type: "quotes:unsubscribe", symbols: requestedSymbols });
      }
    };
  }, [isWsConnected, requestedSymbols.join("|"), sendMessage]);

  const applyQuoteRows = useCallback((rows: any[], replace: boolean) => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const nextMap = replace ? new Map<string, Quote>() : new Map(quotesRef.current);
    const nameMap = symbolNameMapRef.current;

    for (const row of rows) {
      if (!row?.symbol) continue;
      const symbol = String(row.symbol).toUpperCase();
      if (nameMap.size > 0 && !nameMap.has(symbol)) continue;

      const existing = nextMap.get(symbol);
      const bid = toNumber(row.bid);
      const ask = toNumber(row.ask);
      const price = toNumber(row.price) ?? (bid != null && ask != null ? (bid + ask) / 2 : null) ?? existing?.price ?? 0;
      const prevClose = toNumber(row.prevClose) ?? existing?.prevClose ?? price ?? 0;
      const pctChange = toNumber(row.pctChange) ?? calculatePctChange(price, prevClose);
      const change = toNumber(row.change) ?? (price != null && prevClose != null ? price - prevClose : 0);
      const spread =
        toNumber(row.spread) ??
        (bid != null && ask != null ? Math.abs(ask - bid) : undefined);
      const lastApiUpdate = toNumber(row.lastApiUpdate) ?? existing?.lastApiUpdate;
      const dataAge = toNumber(row.dataAge) ?? (lastApiUpdate ? Date.now() - lastApiUpdate : undefined);
      const isStale = Boolean(row.isStale ?? existing?.isStale ?? false);

      nextMap.set(symbol, {
        symbol,
        name: nameMap.get(symbol) || symbol,
        price: price ?? 0,
        change: change ?? 0,
        time: row.timestamp || Date.now(),
        bid: bid ?? undefined,
        ask: ask ?? undefined,
        spread,
        prevClose: prevClose ?? price ?? 0,
        changePct: pctChange,
        percent_change: pctChange,
        isStale,
        lastApiUpdate: lastApiUpdate ?? undefined,
        dataAge: dataAge ?? undefined,
      });
    }

    quotesRef.current = nextMap;
    setQuotes(Array.from(nextMap.values()));
  }, []);

  useEffect(() => {
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "quotes:snapshot") {
        applyQuoteRows(message.rows ?? [], true);
      }
      if (message.type === "quotes:update") {
        applyQuoteRows(message.rows ?? [], false);
      }
    });
  }, [applyQuoteRows, subscribe]);

  const symbolsQuery = requestedSymbols.join(",");
  const quotesUrl = symbolsQuery
    ? `/api/quotes/latest?symbols=${encodeURIComponent(symbolsQuery)}`
    : "/api/quotes/latest";

  const { data: latestQuotesData, isLoading, isError } = useQuery({
    queryKey: [quotesUrl],
    enabled: true,
    refetchInterval: isWsConnected ? false : FALLBACK_POLL_INTERVAL,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  
  useEffect(() => {
    if (Array.isArray(latestQuotesData) && latestQuotesData.length > 0) {
      applyQuoteRows(latestQuotesData, true);
    }
  }, [latestQuotesData, applyQuoteRows]);

  useEffect(() => {
    setIsConnected(isWsConnected || (!isError && !!latestQuotesData));
  }, [isWsConnected, latestQuotesData, isError]);

  const hasStaleData = quotes.some((q) => q.isStale);
  
  return {
    quotes,
    isConnected,
    isLoading: isLoading && quotes.length === 0,
    hasStaleData,
  };
}
