import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { recommendedPollIntervalMs, recommendedQuoteFlushIntervalMs } from "@/lib/perfHints";
import { useAuth } from "@/hooks/use-auth";

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

type QuotesState = {
  quotes: Quote[];
  isConnected: boolean;
  isLoading: boolean;
  hasStaleData: boolean;
};

const QuotesContext = createContext<QuotesState | null>(null);
const EMPTY_SYMBOLS: SymbolConfig[] = [];

function toNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calculatePctChange(current: number | null, previous: number | null): number {
  if (!current || !previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export function QuotesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const quotesRef = useRef<Map<string, Quote>>(new Map());
  const symbolNameMapRef = useRef<Map<string, string>>(new Map());
  const allowedSymbolsRef = useRef<Set<string>>(new Set());
  const prevSymbolsRef = useRef<string[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const pendingFlushRef = useRef(false);

  const { isConnected: isWsConnected, sendMessage, subscribe } = useLiveUpdates();

  useEffect(() => {
    if (isAuthenticated) return;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingFlushRef.current = false;
    quotesRef.current = new Map();
    prevSymbolsRef.current = [];
    symbolNameMapRef.current = new Map();
    setQuotes([]);
  }, [isAuthenticated]);

  const flushNow = useCallback(() => {
    flushTimerRef.current = null;
    if (!pendingFlushRef.current) return;
    pendingFlushRef.current = false;
    setQuotes(Array.from(quotesRef.current.values()));
  }, []);

  const scheduleFlush = useCallback(() => {
    pendingFlushRef.current = true;
    if (flushTimerRef.current !== null) return;
    const intervalMs = recommendedQuoteFlushIntervalMs();
    flushTimerRef.current = window.setTimeout(flushNow, intervalMs);
  }, [flushNow]);

  const { data: symbolsData, isLoading: isSymbolsLoading } = useQuery<SymbolConfig[]>({
    queryKey: ["/api/config/symbols"],
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    refetchInterval: isWsConnected ? false : recommendedPollIntervalMs(30_000),
    placeholderData: EMPTY_SYMBOLS,
  });

  const symbols = symbolsData ?? EMPTY_SYMBOLS;

  useEffect(() => {
    const map = new Map<string, string>();
    const allowed = new Set<string>();
    (symbols || []).forEach((s) => {
      if (s.enabled !== false) {
        const sym = String(s.symbol).toUpperCase();
        allowed.add(sym);
        map.set(sym, s.name);
      }
    });
    symbolNameMapRef.current = map;
    allowedSymbolsRef.current = allowed;

    if (!allowed.size) {
      quotesRef.current = new Map();
      setQuotes((prev) => (prev.length ? [] : prev));
      return;
    }

    if (quotesRef.current.size === 0) return;

    const next = new Map<string, Quote>();
    let changed = false;
    for (const sym of allowed) {
      const existing = quotesRef.current.get(sym);
      if (!existing) continue;
      const nextName = map.get(sym) || existing.name;
      if (existing.name !== nextName) changed = true;
      next.set(sym, existing.name === nextName ? existing : { ...existing, name: nextName });
    }

    if (next.size !== quotesRef.current.size) changed = true;

    if (changed) {
      quotesRef.current = next;
      setQuotes(Array.from(next.values()));
    }
  }, [symbols]);

  const requestedSymbols = useMemo(() => {
    return (symbols || [])
      .filter((s) => s.enabled !== false)
      .map((s) => String(s.symbol).toUpperCase());
  }, [symbols]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isWsConnected) {
      prevSymbolsRef.current = [];
      return;
    }
    if (!requestedSymbols.length) {
      if (prevSymbolsRef.current.length) {
        sendMessage({ type: "quotes:unsubscribe", symbols: prevSymbolsRef.current });
        prevSymbolsRef.current = [];
      }
      // Ensure server-side subscriptions are cleared even if we don't know the previous set.
      sendMessage({ type: "quotes:unsubscribe" });
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
  }, [isAuthenticated, isWsConnected, requestedSymbols.join("|"), sendMessage]);

  const applyQuoteRows = useCallback(
    (rows: any[], replace: boolean) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const nextMap = replace ? new Map<string, Quote>() : new Map(quotesRef.current);
      const nameMap = symbolNameMapRef.current;
      const allowed = allowedSymbolsRef.current;

      for (const row of rows) {
        if (!row?.symbol) continue;
        const symbol = String(row.symbol).toUpperCase();
        if (!allowed.size || !allowed.has(symbol)) continue;

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
      scheduleFlush();
    },
    [scheduleFlush],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "quotes:snapshot") {
        applyQuoteRows(message.rows ?? [], true);
      }
      if (message.type === "quotes:update") {
        applyQuoteRows(message.rows ?? [], false);
      }
    });
  }, [applyQuoteRows, isAuthenticated, subscribe]);

  const symbolsQuery = requestedSymbols.join(",");
  const quotesUrl = symbolsQuery
    ? `/api/quotes/latest?symbols=${encodeURIComponent(symbolsQuery)}`
    : "/api/quotes/latest";

  const { data: latestQuotesData, isLoading, isError } = useQuery({
    queryKey: [quotesUrl],
    enabled: isAuthenticated && requestedSymbols.length > 0,
    refetchInterval: isWsConnected ? false : recommendedPollIntervalMs(5000),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (Array.isArray(latestQuotesData) && latestQuotesData.length > 0) {
      applyQuoteRows(latestQuotesData, true);
    }
  }, [latestQuotesData, applyQuoteRows]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const isConnected = isWsConnected || (!isError && Array.isArray(latestQuotesData) && latestQuotesData.length > 0);
  const hasStaleData = quotes.some((q) => q.isStale);

  const value = useMemo<QuotesState>(() => {
    return {
      quotes,
      isConnected,
      isLoading: isSymbolsLoading || (isLoading && quotes.length === 0),
      hasStaleData,
    };
  }, [hasStaleData, isConnected, isLoading, isSymbolsLoading, quotes]);

  return <QuotesContext.Provider value={value}>{children}</QuotesContext.Provider>;
}

export function useQuotesContext() {
  const ctx = useContext(QuotesContext);
  if (!ctx) {
    throw new Error("useQuotesContext must be used within QuotesProvider");
  }
  return ctx;
}
