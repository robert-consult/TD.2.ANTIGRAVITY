import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { usePerfHints } from "@/lib/perfHints";
import { resolveRuntimeIntervals } from "@/lib/runtimeIntervals";
import { secureGet } from "@/lib/secureCache";
import { useAuth } from "@/hooks/use-auth";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";
import {
  WS_MSG_QUOTES_SNAPSHOT,
  WS_MSG_QUOTES_SUBSCRIBE,
  WS_MSG_QUOTES_UNSUBSCRIBE,
  WS_MSG_QUOTES_UPDATE,
} from "@shared/ws/protocol";

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
  marketOpen?: boolean;
}

interface SymbolConfig {
  id: number;
  symbol: string;
  name: string;
  category?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  pipDecimals?: number | null;
  quoteDecimals?: number | null;
  enabled?: boolean;
}

interface AllowedSymbolsResponse {
  symbols: SymbolConfig[];
  effectiveMode: "BASIC_ONLY" | "BASIC_PLUS_CUSTOM" | "CUSTOM_ONLY";
  supportsCustom: boolean;
  includesBaseline: boolean;
}

type PersistedQueryEntry = {
  schemaVersion?: number;
  data?: unknown;
  updatedAt?: number;
};

type QuotesState = {
  quotes: Quote[];
  isConnected: boolean;
  isLoading: boolean;
  hasStaleData: boolean;
  supportsCustom: boolean;
  effectiveMode: AllowedSymbolsResponse["effectiveMode"];
};

const QuotesContext = createContext<QuotesState | null>(null);
const EMPTY_SYMBOLS: SymbolConfig[] = [];

function toNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calculatePctChange(current: number | null, previous: number | null): number {
  if (current == null || previous == null || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function normalizeAllowedSymbolsPayload(value: unknown): AllowedSymbolsResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AllowedSymbolsResponse>;
  if (!Array.isArray(candidate.symbols)) return null;
  return {
    symbols: candidate.symbols as SymbolConfig[],
    effectiveMode:
      candidate.effectiveMode === "BASIC_PLUS_CUSTOM" || candidate.effectiveMode === "CUSTOM_ONLY"
        ? candidate.effectiveMode
        : "BASIC_ONLY",
    supportsCustom: Boolean(candidate.supportsCustom),
    includesBaseline: candidate.includesBaseline !== false,
  };
}

function toSymbolKey(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function hasSameSymbolSet(a: readonly SymbolConfig[], b: readonly SymbolConfig[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (toSymbolKey(a[i]?.symbol) !== toSymbolKey(b[i]?.symbol)) return false;
  }
  return true;
}

export function QuotesProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [bootstrapSymbols, setBootstrapSymbols] = useState<SymbolConfig[]>(EMPTY_SYMBOLS);
  const quotesRef = useRef<Map<string, Quote>>(new Map());
  const symbolNameMapRef = useRef<Map<string, string>>(new Map());
  const allowedSymbolsRef = useRef<Set<string>>(new Set());
  const prevSymbolsRef = useRef<string[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const pendingFlushRef = useRef(false);

  const { isConnected: isWsConnected, sendMessage, subscribe } = useLiveUpdates();
  const perfHints = usePerfHints();
  const performanceSettings = usePerformanceSettings();
  const runtimeIntervals = useMemo(
    () => resolveRuntimeIntervals(perfHints, performanceSettings),
    [perfHints, performanceSettings],
  );
  const quoteFlushMs = runtimeIntervals.quotes.flushMs;
  const quotePollIntervalMs = runtimeIntervals.quotes.restFallbackPollMs;
  const wsFallbackRefetchMode = isWsConnected ? false : ("always" as const);

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
    allowedSymbolsRef.current = new Set();
    setBootstrapSymbols(EMPTY_SYMBOLS);
    setQuotes([]);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    void (async () => {
      const cachedEntry = await secureGet<PersistedQueryEntry>(
        "query-cache",
        "/api/quote-subscriptions/allowed-symbols",
      );
      const payload =
        normalizeAllowedSymbolsPayload(cachedEntry) ??
        normalizeAllowedSymbolsPayload((cachedEntry as PersistedQueryEntry | null)?.data);
      if (cancelled || !payload) return;

      const nextMap = new Map<string, string>();
      const nextAllowed = new Set<string>();
      for (const row of payload.symbols) {
        const symbol = String(row.symbol || "").toUpperCase().trim();
        if (!symbol) continue;
        nextAllowed.add(symbol);
        nextMap.set(symbol, row.name || symbol);
      }
      if (!nextAllowed.size) return;

      symbolNameMapRef.current = nextMap;
      allowedSymbolsRef.current = nextAllowed;
      setBootstrapSymbols(payload.symbols);
    })();

    return () => {
      cancelled = true;
    };
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
    flushTimerRef.current = window.setTimeout(flushNow, quoteFlushMs);
  }, [flushNow, quoteFlushMs]);

  useEffect(() => {
    if (flushTimerRef.current === null || !pendingFlushRef.current) return;
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(flushNow, quoteFlushMs);
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [flushNow, quoteFlushMs]);

  const { data: symbolsData, isLoading: isSymbolsLoading } = useQuery<AllowedSymbolsResponse>({
    queryKey: ["/api/quote-subscriptions/allowed-symbols"],
    enabled: isAuthenticated,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    // Keep permissions fresh even if an upstream WS event is missed.
    refetchInterval: runtimeIntervals.quotes.permissionsRefreshMs,
  });

  const symbols = symbolsData?.symbols ?? EMPTY_SYMBOLS;
  const resolvedSymbols = useMemo(() => {
    if (symbols.length > 0) return symbols;
    return bootstrapSymbols;
  }, [bootstrapSymbols, symbols]);

  useEffect(() => {
    if (!isAuthenticated || !symbolsData) return;
    const nextSymbols = symbolsData.symbols ?? EMPTY_SYMBOLS;
    setBootstrapSymbols((prev) => (hasSameSymbolSet(prev, nextSymbols) ? prev : nextSymbols));
  }, [isAuthenticated, symbolsData]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const map = new Map<string, string>();
    const allowed = new Set<string>();
    (resolvedSymbols || []).forEach((s) => {
      const sym = String(s.symbol).toUpperCase();
      if (!sym) return;
      allowed.add(sym);
      map.set(sym, s.name);
    });
    symbolNameMapRef.current = map;
    allowedSymbolsRef.current = allowed;

    if (!allowed.size) {
      if (isSymbolsLoading && !symbolsData) return;
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
  }, [isAuthenticated, isSymbolsLoading, resolvedSymbols, symbolsData]);

  const requestedSymbols = useMemo(() => {
    return (resolvedSymbols || [])
      .map((s) => String(s.symbol).toUpperCase());
  }, [resolvedSymbols]);
  const requestedSymbolsKey = useMemo(() => JSON.stringify(requestedSymbols), [requestedSymbols]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!isWsConnected) {
      prevSymbolsRef.current = [];
      return;
    }
    if (!requestedSymbols.length) {
      if (prevSymbolsRef.current.length) {
        sendMessage({ type: WS_MSG_QUOTES_UNSUBSCRIBE, symbols: prevSymbolsRef.current });
        prevSymbolsRef.current = [];
      }
      // Ensure server-side subscriptions are cleared even if we don't know the previous set.
      sendMessage({ type: WS_MSG_QUOTES_UNSUBSCRIBE });
      return;
    }

    const prev = new Set(prevSymbolsRef.current);
    const next = new Set(requestedSymbols);

    const subscribeSymbols = [...next].filter((s) => !prev.has(s));
    const unsubscribeSymbols = [...prev].filter((s) => !next.has(s));

    if (subscribeSymbols.length) {
      sendMessage({ type: WS_MSG_QUOTES_SUBSCRIBE, symbols: subscribeSymbols });
    }
    if (unsubscribeSymbols.length) {
      sendMessage({ type: WS_MSG_QUOTES_UNSUBSCRIBE, symbols: unsubscribeSymbols });
    }

    prevSymbolsRef.current = requestedSymbols;
  }, [isAuthenticated, isWsConnected, requestedSymbolsKey, sendMessage]);

  const applyQuoteRows = useCallback(
    (rows: any[], replace: boolean) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const hadQuotes = quotesRef.current.size > 0;
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
        const marketOpen =
          typeof row.marketOpen === "boolean" ? row.marketOpen : existing?.marketOpen;

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
          marketOpen,
        });
      }

      quotesRef.current = nextMap;
      if (replace && !hadQuotes && nextMap.size > 0) {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        pendingFlushRef.current = false;
        setQuotes(Array.from(nextMap.values()));
        return;
      }
      scheduleFlush();
    },
    [scheduleFlush],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    return subscribe((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === WS_MSG_QUOTES_SNAPSHOT) {
        applyQuoteRows(message.rows ?? [], true);
      }
      if (message.type === WS_MSG_QUOTES_UPDATE) {
        applyQuoteRows(message.rows ?? [], false);
      }
    });
  }, [applyQuoteRows, isAuthenticated, subscribe]);

  const { data: latestQuotesData, isLoading, isError } = useQuery({
    queryKey: ["/api/quotes/latest", requestedSymbols],
    enabled: isAuthenticated && requestedSymbols.length > 0,
    refetchInterval: isWsConnected ? false : quotePollIntervalMs,
    staleTime: isWsConnected ? Infinity : 15_000,
    refetchOnWindowFocus: wsFallbackRefetchMode,
    refetchOnReconnect: wsFallbackRefetchMode,
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
      supportsCustom: Boolean(symbolsData?.supportsCustom),
      effectiveMode: symbolsData?.effectiveMode ?? "BASIC_ONLY",
    };
  }, [hasStaleData, isConnected, isLoading, isSymbolsLoading, quotes, symbolsData?.effectiveMode, symbolsData?.supportsCustom]);

  return <QuotesContext.Provider value={value}>{children}</QuotesContext.Provider>;
}

export function useQuotesContext() {
  const ctx = useContext(QuotesContext);
  if (!ctx) {
    throw new Error("useQuotesContext must be used within QuotesProvider");
  }
  return ctx;
}
