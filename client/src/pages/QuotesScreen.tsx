import { useQuotes } from "@/hooks/use-quotes";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import SpreadBadge from "@/components/SpreadBadge";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ArrowUpDown, AlertTriangle, Clock } from "lucide-react";

interface QuotesScreenProps {
  onSelectSymbol: (symbol: string) => void;
}

export default function QuotesScreen({ onSelectSymbol }: QuotesScreenProps) {
  const { quotes, isLoading, isConnected, hasStaleData } = useQuotes();
  const { user } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<string>("connecting");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [sortField, setSortField] = useState<string>("symbol");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const DEFAULT_BALANCE = 1000000; // $1,000,000 as shown in reference image

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

  return (
    <div className="h-full flex flex-col bg-neutral-900">
      <div className="tq-page-header flex flex-col sticky top-0 z-10 gap-[clamp(0.35rem,1.2vw,0.5rem)]">
        <div className="flex justify-between items-center">
          <h2 className="tq-page-title">Live Quotes</h2>
          <div className="flex items-center">
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
            className="pl-8 bg-neutral-800 border-neutral-700 text-white"
          />
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-neutral-500" />
        </div>
        
        {/* Sort controls */}
        <div className="flex justify-between text-xs text-neutral-400 px-1">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className={`px-2 py-1 h-7 ${sortField === 'symbol' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('symbol')}
            >
              Symbol {sortField === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              className={`px-2 py-1 h-7 ${sortField === 'price' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('price')}
            >
              Price {sortField === 'price' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className={`px-2 py-1 h-7 ${sortField === 'change' ? 'text-white' : 'text-neutral-400'}`}
              onClick={() => toggleSort('change')}
            >
              Change {sortField === 'change' && (sortDirection === 'asc' ? '↑' : '↓')}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 app-scroll" style={{ scrollbarWidth: "thin" }}>
        <div className="divide-y divide-gray-800">
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
            filteredAndSortedQuotes.map((quote) => (
              <div
                key={quote.symbol}
                className="flex items-center justify-between gap-3 px-gutter py-3 hover:bg-neutral-850 transition-colors cursor-pointer"
                onClick={() => onSelectSymbol(quote.symbol)}
              >
                <div className="min-w-0">
                  <div className="flex items-start gap-2">
                    <div className="w-20 shrink-0 font-medium text-base">{quote.symbol}</div>
                    <div className="text-sm text-gray-400 mt-0.5 truncate">
                      {quote.name}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 md:gap-6">
                  {/* Price and change display */}
                  <div className="flex flex-col items-end">
                    <div className="font-mono font-medium text-base text-white">
                      {quote.price?.toFixed(
                        quote.symbol.includes("JPY") ? 2 : 4
                      )}
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
                        {quote.bid?.toFixed(quote.symbol.includes("JPY") ? 2 : 4)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-400 mr-1 font-medium">Ask:</span>
                      <span className="font-mono text-success-500 font-medium">
                        {quote.ask?.toFixed(quote.symbol.includes("JPY") ? 2 : 4)}
                      </span>
                    </div>
                    {quote.spread !== undefined && (
                      <div className="flex justify-end mt-1">
                        <SpreadBadge spread={(quote.spread * (quote.symbol.includes("JPY") ? 100 : 10000)).toFixed(1) + " pips"} />
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
            ))}

          {(!filteredAndSortedQuotes || filteredAndSortedQuotes.length === 0) && !isLoading && (
            <div className="px-gutter py-8 text-center text-gray-500">
              {searchTerm 
                ? `No instruments found matching "${searchTerm}"`
                : "No quotes available"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
