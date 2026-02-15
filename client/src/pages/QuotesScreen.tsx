import { useQuotes } from "@/hooks/use-quotes";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import SpreadBadge from "@/components/SpreadBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, AlertTriangle, Clock, PencilLine, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getQuoteDecimals, pointsToPips } from "@shared/pips";
import { SymbolSubscriptionDialog } from "@/components/SymbolSubscriptionDialog";
import { useAuth } from "@/hooks/use-auth";

interface QuotesScreenProps {
  onSelectSymbol: (symbol: string) => void;
}

export default function QuotesScreen({ onSelectSymbol }: QuotesScreenProps) {
  const { quotes, isLoading, isConnected, hasStaleData } = useQuotes();
  const { isAuthenticated } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<string>("connecting");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<string>("symbol");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [quoteHighlight, setQuoteHighlight] = useState({
    top: 0,
    height: 0,
    visible: false,
  });
  const quoteListRef = useRef<HTMLDivElement | null>(null);

  const { data: allowedSymbolsData = { symbols: [] } } = useQuery<{ symbols: any[] }>({
    queryKey: ["/api/quote-subscriptions/allowed-symbols"],
    initialData: { symbols: [] },
  });
  const { data: quoteModeData } = useQuery<{
    supportsCustom?: boolean;
    effectiveMode?: "BASIC_ONLY" | "BASIC_PLUS_CUSTOM" | "CUSTOM_ONLY";
  }>({
    queryKey: ["/api/quote-subscriptions/me"],
    enabled: isAuthenticated,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const symbolConfigs = allowedSymbolsData.symbols ?? [];
  const supportsCustomUi = Boolean(quoteModeData?.supportsCustom);
  const effectiveModeUi = quoteModeData?.effectiveMode ?? "BASIC_ONLY";

  const symbolCfgBySymbol = useMemo(() => new Map(symbolConfigs.map((s) => [s.symbol, s])), [symbolConfigs]);

  // Update connection status for UI display (including stale data warning)
  useEffect(() => {
    if (hasStaleData) {
      setConnectionStatus("stale");
    } else if (quotes.length > 0 && quotes.every((q) => q.marketOpen === false)) {
      setConnectionStatus("market_closed");
    } else if (isConnected) {
      setConnectionStatus("connected");
    } else if (isLoading) {
      setConnectionStatus("connecting");
    } else {
      setConnectionStatus("disconnected");
    }
  }, [hasStaleData, isConnected, isLoading, quotes]);

  useEffect(() => {
    if (supportsCustomUi) return;
    setAddDialogOpen(false);
    setManageDialogOpen(false);
  }, [supportsCustomUi]);
  
  // Filter and sort quotes
  const filteredAndSortedQuotes = quotes
    // Filter by search term (case-insensitive)
    .filter(quote => 
      searchTerm === "" || 
      quote.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      quote.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    // Sort by selected field and direction
    .sort((a, b) => {
      // Handle special case for numeric sorting
      if (sortField === 'price' || sortField === 'change' || sortField === 'spread') {
        const aValue = a[sortField as keyof typeof a] || 0;
        const bValue = b[sortField as keyof typeof b] || 0;
        return sortDirection === 'asc' 
          ? Number(aValue) - Number(bValue)
          : Number(bValue) - Number(aValue);
      }
      
      // Handle string sorting
      const aValue = String(a[sortField as keyof typeof a] || '');
      const bValue = String(b[sortField as keyof typeof b] || '');
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    });
  
  // Toggle sort when clicking a column header
  const toggleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new field and reset to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const revealQuoteHighlight = (row: HTMLDivElement) => {
    const container = quoteListRef.current;
    if (!container) return;
    const nextTop = row.offsetTop;
    const nextHeight = row.offsetHeight;
    setQuoteHighlight((prev) => {
      if (prev.visible && prev.top === nextTop && prev.height === nextHeight) return prev;
      return {
        top: nextTop,
        height: nextHeight,
        visible: true,
      };
    });
  };

  const hideQuoteHighlight = () => {
    setQuoteHighlight((prev) => (prev.visible ? { ...prev, visible: false } : prev));
  };

  return (
    <div className="tq-quotes-screen h-full flex flex-col bg-neutral-900">
      <div className="tq-panel-header tq-page-header tq-quotes-header flex flex-col sticky top-0 z-10 gap-[clamp(0.35rem,1.2vw,0.5rem)]">
        <div className="flex justify-between items-center">
          <h2 className="tq-page-title">Live Quotes</h2>
          <div className="flex items-center gap-2">
            {supportsCustomUi ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-cyan-300 hover:text-cyan-200 hover:bg-neutral-800"
                  onClick={() => setAddDialogOpen(true)}
                  aria-label="Add quote symbol"
                  title="Add symbols"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-cyan-300 hover:text-cyan-200 hover:bg-neutral-800"
                  onClick={() => setManageDialogOpen(true)}
                  aria-label="Manage quote symbols"
                  title="Manage symbols"
                >
                  <PencilLine className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
            {connectionStatus === "stale" ? (
              <AlertTriangle className="w-3 h-3 mr-1.5 text-orange-400" />
            ) : connectionStatus === "market_closed" ? (
              <Clock className="w-3 h-3 mr-1.5 text-sky-400" />
            ) : (
              <span 
                className={`w-2 h-2 rounded-full mr-2 ${
                  connectionStatus === "connected" 
                    ? "bg-green-500"
                    : connectionStatus === "connecting" 
                      ? "bg-yellow-500" 
                      : "bg-red-500"
                }`}>
              </span>
            )}
            <span
              className={`text-xs ${
                connectionStatus === "stale"
                  ? "text-orange-400"
                  : connectionStatus === "market_closed"
                    ? "text-sky-400"
                    : "text-gray-400"
              }`}>
              {connectionStatus === "connected" 
                ? "Real-time Data"
                : connectionStatus === "market_closed"
                  ? "Market Closed"
                  : connectionStatus === "stale"
                    ? "Cached Prices"
                  : connectionStatus === "connecting" 
                    ? "Connecting..." 
                    : "Offline"}
            </span>
          </div>
        </div>
        
        {/* Search bar */}
        <div className="relative">
          <Input
            type="text"
            placeholder="Search instruments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="tq-quotes-search-input pl-8 bg-neutral-800 border-neutral-700 text-white"
          />
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-neutral-500" />
        </div>
        
        {/* Sort controls */}
        <div className="tq-quotes-sort flex justify-between text-xs text-neutral-400 px-1">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className={`tq-quotes-sort-btn px-2 py-1 h-7 ${sortField === 'symbol' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('symbol')}
            >
              Symbol {sortField === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className={`tq-quotes-sort-btn px-2 py-1 h-7 ${sortField === 'price' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('price')}
            >
              Price {sortField === 'price' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`tq-quotes-sort-btn px-2 py-1 h-7 ${sortField === 'change' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('change')}
            >
              Change {sortField === 'change' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
          </div>
        </div>
      </div>

      <div className="tq-quotes-scroll flex-1 min-h-0 app-scroll" style={{ scrollbarWidth: "thin" }}>
        <div
          ref={quoteListRef}
          onMouseLeave={hideQuoteHighlight}
          className="tq-quotes-list relative divide-y divide-gray-800"
        >
          <div
            aria-hidden
            className={`tq-quotes-highlight ${quoteHighlight.visible ? "is-visible" : ""}`}
            style={{
              transform: `translateY(${quoteHighlight.top}px)`,
              height: `${quoteHighlight.height}px`,
            }}
          />
          {isLoading &&
            Array(8) // Show more skeletons to match larger list
              .fill(null)
              .map((_, index) => (
                <div key={index} className="px-gutter py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <Skeleton className="h-6 w-16 mr-2" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <Skeleton className="h-6 w-16 mb-1" />
                        <Skeleton className="h-4 w-12" />
                      </div>
                      <Skeleton className="h-4 w-4 rounded-full" />
                    </div>
                  </div>
                </div>
              ))}

          {!isLoading && filteredAndSortedQuotes.length > 0 &&
            filteredAndSortedQuotes.map((quote) => {
              const cfg = symbolCfgBySymbol.get(quote.symbol);
              const decimals = getQuoteDecimals({
                symbol: quote.symbol,
                category: cfg?.category,
                quoteCurrency: cfg?.quoteCurrency,
                pipDecimals: cfg?.pipDecimals,
                quoteDecimals: cfg?.quoteDecimals,
              });

              const spreadPips = quote.spread != null
                ? pointsToPips(quote.spread, {
                    symbol: quote.symbol,
                    category: cfg?.category,
                    quoteCurrency: cfg?.quoteCurrency,
                    pipDecimals: cfg?.pipDecimals,
                    quoteDecimals: cfg?.quoteDecimals,
                  })
                : null;

              return (
                <div
                  key={quote.symbol}
                  className="tq-quote-row flex items-center justify-between gap-3 px-gutter py-2.5 hover:bg-neutral-850 transition-colors cursor-pointer"
                  onMouseEnter={(event) => revealQuoteHighlight(event.currentTarget)}
                  onClick={() => onSelectSymbol(quote.symbol)}
                >
                  <div className="min-w-0 flex flex-col justify-center leading-tight">
                    <div className="font-medium text-[clamp(1.02rem,0.97rem+0.18vw,1.2rem)] tracking-[0.02em] text-white">
                      {quote.symbol}
                    </div>
                    <div className="mt-0.5 text-[clamp(0.69rem,0.66rem+0.14vw,0.8rem)] text-gray-400 truncate max-w-[clamp(8rem,26vw,15rem)] leading-[1.15]">
                      {quote.name}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 md:gap-6">
                    {/* Price and change display */}
                    <div className="flex flex-col items-end">
                      <div className="font-mono font-medium text-base text-white">
                        {quote.price?.toFixed(decimals)}
                      </div>
                      <div
                        className={`text-sm ${
                          (quote.percent_change ?? 0) > 0
                            ? "text-lime-400" // Bright green for increases
                            : (quote.percent_change ?? 0) < 0
                              ? "text-red-500" // Red for decreases
                              : "text-yellow-500" // Yellow for unchanged
                        }`}
                      >
                        {(quote.percent_change ?? 0) > 0 ? "+" : ""}
                        {(quote.percent_change ?? 0).toFixed(2)}%
                      </div>
                    </div>
                    
                    {/* Bid/Ask/Spread display - Enhanced for Phase-2 */}
                    <div className="hidden md:flex flex-col items-end text-sm gap-1">
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-400 mr-1 font-medium">Bid:</span>
                        <span className="font-mono text-danger-500 font-medium">
                          {quote.bid?.toFixed(decimals)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-400 mr-1 font-medium">Ask:</span>
                        <span className="font-mono text-success-500 font-medium">
                          {quote.ask?.toFixed(decimals)}
                        </span>
                      </div>
                      {spreadPips !== null && (
                        <div className="flex justify-end mt-1">
                          <SpreadBadge spread={`${spreadPips.toFixed(1)} pips`} />
                        </div>
                      )}
                    </div>
                    
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-gray-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </div>
              );
            })}

          {(!filteredAndSortedQuotes || filteredAndSortedQuotes.length === 0) && !isLoading && (
            <div className="px-gutter py-8 text-center text-gray-500">
              {searchTerm 
                ? `No instruments found matching "${searchTerm}"`
                : "No quotes available"}
            </div>
          )}
        </div>
      </div>

      <SymbolSubscriptionDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        mode="add"
        effectiveMode={effectiveModeUi}
      />
      <SymbolSubscriptionDialog
        open={manageDialogOpen}
        onOpenChange={setManageDialogOpen}
        mode="manage"
        effectiveMode={effectiveModeUi}
      />
    </div>
  );
}
