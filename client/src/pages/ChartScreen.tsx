import { useQuotes } from "@/hooks/use-quotes";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { getTradeErrorToast } from "@/lib/tradeErrorMessages";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useLotSettings } from "@/hooks/use-lot-settings";
import { X } from "lucide-react";

// Declare TradingView type for TypeScript
declare global {
  interface Window {
    TradingView?: any;
    tradingViewWidgetConfig?: Record<string, any>;
  }
}

interface ChartScreenProps {
  selectedSymbol: string;
}

type ChartPeriod = "1H" | "1D" | "1W" | "1M";

// Map our symbols to TradingView symbols
const tradingViewSymbolMap: Record<string, string> = {
  "USDJPY": "CMCMARKETS:USDJPY",
  "EURUSD": "CMCMARKETS:EURUSD",
  "GBPUSD": "CMCMARKETS:GBPUSD",
  "AUDUSD": "CMCMARKETS:AUDUSD",
  "EURJPY": "CMCMARKETS:EURJPY",
  "GBPJPY": "CMCMARKETS:GBPJPY",
  "XAUUSD": "CMCMARKETS:XAUUSD",
  "NGAS": "CMCMARKETS:NATURALGAS",
  "WTI": "CMCMARKETS:CRUDEOIL",
  "US30": "CMCMARKETS:US30",
};

// Map our periods to TradingView intervals
const periodIntervalMap: Record<ChartPeriod, string> = {
  "1H": "5",
  "1D": "30",
  "1W": "240",
  "1M": "D",
};

let tradingViewScriptPromise: Promise<void> | null = null;

function ensureResourceHint(rel: string, href: string, crossOrigin?: string) {
  if (typeof document === "undefined") return;
  const selector = `link[rel="${rel}"][href="${href}"]`;
  if (document.head.querySelector(selector)) return;
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  if (crossOrigin) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

function loadTradingViewScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.TradingView?.widget) return Promise.resolve();
  if (tradingViewScriptPromise) return tradingViewScriptPromise;

  tradingViewScriptPromise = new Promise<void>((resolve, reject) => {
    ensureResourceHint("preconnect", "https://s3.tradingview.com", "anonymous");
    ensureResourceHint("dns-prefetch", "https://s3.tradingview.com");
    ensureResourceHint("preconnect", "https://www.tradingview.com", "anonymous");
    ensureResourceHint("dns-prefetch", "https://www.tradingview.com");

    const existing = document.getElementById("tradingview-script") as HTMLScriptElement | null;
    let pollId: number | undefined;

    const resolveIfReady = () => {
      if (window.TradingView?.widget) resolve();
    };

    const timeoutId = window.setTimeout(() => {
      if (pollId !== undefined) window.clearInterval(pollId);
      tradingViewScriptPromise = null;
      reject(new Error("Timed out loading TradingView script"));
    }, 15000);

    const onLoad = (script: HTMLScriptElement) => {
      script.dataset.loaded = "true";
      if (pollId !== undefined) window.clearInterval(pollId);
      resolveIfReady();
      if (!window.TradingView?.widget) {
        tradingViewScriptPromise = null;
        reject(new Error("TradingView script loaded but widget API is missing"));
      }
      window.clearTimeout(timeoutId);
    };

    const onError = () => {
      if (pollId !== undefined) window.clearInterval(pollId);
      tradingViewScriptPromise = null;
      window.clearTimeout(timeoutId);
      reject(new Error("Failed to load TradingView script"));
    };

    if (existing) {
      if (existing.dataset.loaded === "true") {
        window.clearTimeout(timeoutId);
        resolveIfReady();
        if (!window.TradingView?.widget) {
          tradingViewScriptPromise = null;
          reject(new Error("TradingView script is present but widget API is missing"));
        }
        return;
      }

      existing.addEventListener("load", () => onLoad(existing), { once: true });
      existing.addEventListener("error", onError, { once: true });

      pollId = window.setInterval(() => {
        if (!window.TradingView?.widget) return;
        existing.dataset.loaded = "true";
        window.clearTimeout(timeoutId);
        if (pollId !== undefined) window.clearInterval(pollId);
        resolve();
      }, 50);

      return;
    }

    const script = document.createElement("script");
    script.id = "tradingview-script";
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.addEventListener("load", () => onLoad(script), { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    tradingViewScriptPromise = null;
    return Promise.reject(error);
  });

  return tradingViewScriptPromise;
}

export default function ChartScreen({ selectedSymbol }: ChartScreenProps) {
  const { quotes, isLoading } = useQuotes();
  const [activePeriod, setActivePeriod] = useState<ChartPeriod>("1D");

  const currentQuote = quotes?.find(q => q.symbol === selectedSymbol);
  const bid = currentQuote?.bid;
  const ask = currentQuote?.ask;
  const hasQuote = bid !== undefined && ask !== undefined;

  // Chart refs and state
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [tradingViewLoaded, setTradingViewLoaded] = useState(false);
  const [tradingViewError, setTradingViewError] = useState<string | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const [tradingViewReloadKey, setTradingViewReloadKey] = useState(0);
  const widgetInstanceRef = useRef<any>(null);

  const queryClient = useQueryClient();
  const { isConnected: isWsConnected } = useLiveUpdates();
  const { lotDropdownMax, lotDropdownOptions } = useLotSettings();

  // Trade controls
  const [lots, setLots] = useState<number>(1);
  const [currentTradeType, setCurrentTradeType] = useState<"BUY" | "SELL">("BUY");

  useEffect(() => {
    setLots((prev) => {
      if (!Number.isFinite(prev) || prev < 1) return 1;
      if (prev > lotDropdownMax) return lotDropdownMax;
      return prev;
    });
  }, [lotDropdownMax]);

  // Draggable floater state
  const [showQuoteFloater, setShowQuoteFloater] = useState(true);
  const [floaterPosition, setFloaterPosition] = useState({ x: 16, y: 16 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const floaterRef = useRef<HTMLDivElement>(null);

  // Handle floater drag (mouse)
  const handleFloaterMouseDown = (e: React.MouseEvent) => {
    if (!floaterRef.current) return;
    setIsDragging(true);
    const rect = floaterRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    e.preventDefault();
  };

  // Handle floater drag (touch)
  const handleFloaterTouchStart = (e: React.TouchEvent) => {
    if (!floaterRef.current || e.touches.length !== 1) return;
    setIsDragging(true);
    const touch = e.touches[0];
    const rect = floaterRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const updatePosition = (clientX: number, clientY: number) => {
      if (!chartContainerRef.current) return;
      const containerRect = chartContainerRef.current.parentElement?.getBoundingClientRect();
      if (!containerRect) return;
      
      const newX = clientX - containerRect.left - dragOffset.current.x;
      const newY = clientY - containerRect.top - dragOffset.current.y;
      
      const floaterWidth = floaterRef.current?.offsetWidth || 120;
      const floaterHeight = floaterRef.current?.offsetHeight || 80;
      
      setFloaterPosition({
        x: Math.max(0, Math.min(newX, containerRect.width - floaterWidth)),
        y: Math.max(0, Math.min(newY, containerRect.height - floaterHeight)),
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      updatePosition(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      updatePosition(e.touches[0].clientX, e.touches[0].clientY);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleEnd);
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
    document.addEventListener("touchcancel", handleEnd);
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleEnd);
    };
  }, [isDragging]);

  // Load TradingView widget
  useEffect(() => {
    let cancelled = false;

    setTradingViewLoaded(false);
    setTradingViewError(null);

    loadTradingViewScript()
      .then(() => {
        if (cancelled) return;
        setTradingViewLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load TradingView";
        setTradingViewError(message);
      });

    return () => {
      cancelled = true;
      try {
        widgetInstanceRef.current?.remove?.();
      } catch (e) {
        console.error("Error cleaning up TradingView widget:", e);
      } finally {
        widgetInstanceRef.current = null;
      }
    };
  }, [tradingViewReloadKey]);

  // Track chart container size so the widget can be created/resized deterministically.
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    let rafId = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(0, Math.round(rect.width));
      const height = Math.max(0, Math.round(rect.height));
      setChartSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    update();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(update);
      });
      ro.observe(el);

      return () => {
        window.cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }

    const onResize = () => update();
    window.addEventListener("resize", onResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Initialize or update the TradingView widget when symbol or period changes
  useEffect(() => {
    if (!tradingViewLoaded || !chartContainerRef.current) return;
    if (tradingViewError) return;
    if (chartSize.width < 100 || chartSize.height < 100) return;

    const container = chartContainerRef.current;

    // Re-create deterministically (container size can change due to layout, sidebar, etc.)
    try {
      widgetInstanceRef.current?.remove?.();
    } catch {
      // no-op
    }
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    widgetInstanceRef.current = null;

    // Map our symbol to TradingView symbol
    const tvSymbol =
      tradingViewSymbolMap[selectedSymbol] || `CMCMARKETS:${selectedSymbol}`;

    // Create TradingView widget
    if (window.TradingView?.widget) {
      widgetInstanceRef.current = new window.TradingView.widget({
        width: chartSize.width,
        height: chartSize.height,
        symbol: tvSymbol,
        interval: periodIntervalMap[activePeriod],
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: chartContainerRef.current.id,
        hide_top_toolbar: false,
        hide_side_toolbar: false,
        withdateranges: true,
        studies: ["RSI@tv-basicstudies", "MASimple@tv-basicstudies"],
        backgroundColor: "#121212",
        toolbar_bg: "#121212",
      });
    }
  }, [selectedSymbol, activePeriod, tradingViewLoaded, tradingViewError, chartSize.height, chartSize.width]);

  const executeTrade = useMutation({
    mutationFn: async (data: {
      symbol: string;
      type: "BUY" | "SELL";
      orderType: string;
      lots: number;
      openPrice: number;
      symbolId: number;
    }) => {
      return apiRequest("POST", "/api/trades", data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
      if (!isWsConnected) {
        await queryClient.invalidateQueries({ queryKey: ["/api/account/summary"] });
      }

      toast({
        title: "Trade Executed",
        description: "Your trade has been placed successfully.",
      });
    },
    onError: (error: any) => {
      console.error("Trade execution error:", error);
      const { title, description } = getTradeErrorToast(error, { symbol: selectedSymbol });
      toast({
        title,
        description,
        variant: "destructive",
      });
    }
  });

  // Get the symbol ID for the selected symbol
  const { data: symbolList = [] } = useQuery<any[]>({
    queryKey: ["/api/config/symbols"],
  });

  const getSymbolId = (symbol: string): number | null => {
    const symbolEntry = symbolList.find((s) => s.symbol === symbol);
    return symbolEntry ? symbolEntry.id : null;
  };

  const handleTrade = async (action: "buy" | "sell") => {
    if (!symbolList.length) {
      toast({
        title: "Symbol Configurations Missing",
        description:
          "Symbol configurations are not loaded yet. Please wait a moment and try again.",
        variant: "destructive",
      });
      return;
    }

    const symbolId = getSymbolId(selectedSymbol);
    if (!symbolId) {
      toast({
        title: "Symbol Not Found",
        description:
          "Could not find configuration for the selected symbol. Please contact support.",
        variant: "destructive",
      });
      return;
    }

    if (!lots || lots <= 0) {
      toast({
        title: "Invalid Lot Size",
        description: "Please enter a valid lot size greater than 0.",
        variant: "destructive",
      });
      return;
    }

    // Get current price from quotes
    if (!currentQuote || !currentQuote.bid || !currentQuote.ask) {
      toast({
        title: "Trade Error",
        description: "Current price is not available",
        variant: "destructive",
      });
      return;
    }

    // Use the correct price based on trade type
    const tradeType = action.toUpperCase() as "BUY" | "SELL";
    setCurrentTradeType(tradeType);
    const openPrice = tradeType === "BUY" ? currentQuote.ask : currentQuote.bid;

    try {
      executeTrade.mutate({
        symbol: selectedSymbol,
        type: tradeType,
        orderType: "MARKET",
        lots: Number(lots),
        openPrice,
        symbolId,
      });
    } catch (error: any) {
      console.error("Error executing trade:", error);
      toast({
        title: "Trade Error",
        description: "Failed to execute trade. Please try again.",
        variant: "destructive",
      });
    }
  };

  const isJpyPair = selectedSymbol.includes("JPY");
  const pricePrecision = isJpyPair ? 2 : 4;
  const pipMultiplier = isJpyPair ? 100 : 10000;

  return (
    <div className="h-full flex flex-col bg-[#0F0F0F] overflow-hidden">
      {/* Top bar with title and quote information */}
      <div className="shrink-0 tq-page-header flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="tq-page-title truncate">{selectedSymbol}</h1>
          <p className="text-[clamp(0.7rem,0.65rem+0.3vw,0.8rem)] text-gray-400">
            Symbol chart
          </p>
        </div>

        {/* Current Quote Summary */}
        <div className="text-right text-gray-300 text-[clamp(0.75rem,0.7rem+0.5vw,0.875rem)]">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24 bg-neutral-700" />
              <Skeleton className="h-4 w-24 bg-neutral-700" />
            </div>
          ) : hasQuote && currentQuote ? (
            <div className="space-y-0.5">
              <div className="flex gap-4 items-center justify-end">
                <span className="text-gray-400">Bid:</span>
                <span className="font-mono text-danger-500 font-medium">
                  {bid?.toFixed(pricePrecision) ?? "-"}
                </span>
                <span className="text-gray-400">Ask:</span>
                <span className="font-mono text-success-500 font-medium">
                  {ask?.toFixed(pricePrecision) ?? "-"}
                </span>
              </div>
              <div className="flex gap-4 items-center justify-end">
                <span className="text-gray-400">Spread:</span>
                <span className="font-mono text-white">
                  {hasQuote ? ((ask! - bid!) * pipMultiplier).toFixed(1) : "0.0"} pips
                </span>
              </div>
            </div>
          ) : (
            <span className="text-gray-500">No market data</span>
          )}
        </div>
      </div>

      {/* Chart area - takes remaining space */}
      <div className="flex-1 min-h-0 relative bg-neutral-900">
        {/* TradingView Chart Container */}
        <div className="absolute inset-0 overflow-hidden">
          <div
            ref={chartContainerRef}
            id="tradingview_chart"
            className="w-full h-full bg-[#121212]"
          />
        </div>

        {tradingViewError ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-card">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/60 p-card text-center">
              <div className="text-sm font-semibold text-white">Chart unavailable</div>
              <div className="mt-1 text-xs text-gray-300 break-words">{tradingViewError}</div>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => setTradingViewReloadKey((v) => v + 1)}
              >
                Retry
              </Button>
            </div>
          </div>
        ) : !tradingViewLoaded ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <div className="text-sm text-gray-400">Loading chart…</div>
          </div>
        ) : null}

        {/* Chart overlays - Draggable bid/ask/spread floater */}
        {showQuoteFloater && hasQuote && currentQuote && (
          <div
            ref={floaterRef}
            onMouseDown={handleFloaterMouseDown}
            onTouchStart={handleFloaterTouchStart}
            className={`absolute z-10 select-none touch-none border border-gray-800 bg-black/75 max-w-[min(18rem,calc(100%-0.75rem))] p-[clamp(0.375rem,1vw,0.5rem)] rounded-[clamp(0.375rem,1vw,0.5rem)] text-[clamp(0.75rem,1.1vw,0.875rem)] leading-[1.25] ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={{
              left: floaterPosition.x,
              top: floaterPosition.y,
            }}
          >
            <button
              type="button"
              aria-label="Hide quote floater"
              className="absolute left-1/2 top-0 -translate-x-1/2 inline-flex h-6 w-6 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
              onClick={() => {
                setShowQuoteFloater(false);
                setIsDragging(false);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-[clamp(0.25rem,0.8vw,0.5rem)]">
              <span className="text-gray-400">Bid:</span>
              <span className="font-mono text-danger-500 font-medium text-right">
                {bid?.toFixed(pricePrecision) ?? "-"}
              </span>
              <span className="text-gray-400">Ask:</span>
              <span className="font-mono text-success-500 font-medium text-right">
                {ask?.toFixed(pricePrecision) ?? "-"}
              </span>
              <span className="text-gray-400">Spread:</span>
              <span className="font-mono text-white text-right">
                {hasQuote ? ((ask! - bid!) * pipMultiplier).toFixed(1) : "0.0"} pips
              </span>
            </div>
          </div>
        )}

        {/* Chart period controls overlay */}
        <div className="absolute bottom-3 left-3 bg-black bg-opacity-80 rounded-full px-3 py-1.5 flex items-center gap-1 z-10">
          {(["1D", "1H", "1W", "1M"] as ChartPeriod[]).map((period) => (
            <button
              key={period}
              onClick={() => setActivePeriod(period)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activePeriod === period
                  ? "bg-blue-500 text-white"
                  : "bg-transparent text-gray-300 hover:bg-white/10"
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      {/* Trade panel - fixed at bottom */}
      <div className="shrink-0 border-t border-neutral-800 bg-[#111111] px-gutter py-2 sm:py-3">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Button
            className={`flex-1 min-w-0 h-10 sm:h-12 font-bold text-xs sm:text-base px-2 sm:px-4 ${
              currentTradeType === "SELL"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-red-500 hover:bg-red-600"
            } text-white uppercase`}
            onClick={() => handleTrade("sell")}
            disabled={executeTrade.isPending}
          >
            {executeTrade.isPending && currentTradeType === "SELL" ? (
              <span className="animate-pulse text-xs">...</span>
            ) : bid !== undefined ? (
              <span className="truncate">
                <span className="sm:hidden">Sell {bid.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                <span className="hidden sm:inline">SELL @ {bid.toFixed(selectedSymbol.includes("JPY") ? 2 : 5)}</span>
              </span>
            ) : (
              "Sell"
            )}
          </Button>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <span className="font-bold text-gray-400 text-xs sm:text-sm hidden sm:inline uppercase">Lots</span>
            <Select
              value={lots.toString()}
              onValueChange={(value) => setLots(Number(value))}
              disabled={executeTrade.isPending}
            >
              <SelectTrigger className="w-12 sm:w-16 h-10 sm:h-12 bg-neutral-800 border-gray-700 text-xs sm:text-sm px-2">
                <SelectValue placeholder="1" />
              </SelectTrigger>
              <SelectContent className="max-h-[calc(5*2.25rem)] overflow-y-auto w-14 sm:w-16 bg-neutral-900 border-gray-700">
                {lotDropdownOptions.map((lot) => (
                  <SelectItem key={lot} value={lot.toString()} className="text-white hover:bg-neutral-800">
                    {lot}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            className={`flex-1 min-w-0 h-10 sm:h-12 font-bold text-xs sm:text-base px-2 sm:px-4 ${
              currentTradeType === "BUY"
                ? "bg-lime-600 hover:bg-lime-700"
                : "bg-lime-500 hover:bg-lime-600"
            } text-white uppercase`}
            onClick={() => handleTrade("buy")}
            disabled={executeTrade.isPending}
          >
            {executeTrade.isPending && currentTradeType === "BUY" ? (
              <span className="animate-pulse text-xs">...</span>
            ) : currentQuote && currentQuote.ask ? (
              <span className="truncate">
                <span className="sm:hidden">Buy {currentQuote.ask.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                <span className="hidden sm:inline">BUY @ {currentQuote.ask.toFixed(selectedSymbol.includes("JPY") ? 2 : 5)}</span>
              </span>
            ) : (
              "Buy"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
