import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

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

// Polling interval for quotes (milliseconds) - matches Trade Settings configuration
// Pure REST API polling from 1Forge feed - no WebSocket dependency
const POLLING_INTERVAL = 870; // 870ms as configured in trade settings

export function useQuotes() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // Fetch available symbols
  const { data: symbols = [] } = useQuery<SymbolConfig[]>({
    queryKey: ["/api/config/symbols"],
  });

  // Pure REST API polling for 1Forge feed - no WebSocket
  // Polls at 870ms interval as configured in trade settings
  const { data: latestQuotesData, isLoading, isError } = useQuery({
    queryKey: ["/api/quotes/latest"],
    enabled: true,
    refetchInterval: POLLING_INTERVAL,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0
  });
  
  // Update connection status based on REST API response only
  useEffect(() => {
    setIsConnected(!isError && !!latestQuotesData);
  }, [latestQuotesData, isError]);

  // Helper function to calculate percentage change
  const calculatePctChange = (current: number, previous: number): number => {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  };
  
  // Process fetched quotes - use ONLY backend data (includes stale fallback prices)
  // No static placeholders - the backend stores and returns last known live prices
  useEffect(() => {
    if (latestQuotesData && Array.isArray(latestQuotesData) && symbols.length > 0) {
      // Create a map of API quotes for fast lookup
      const apiQuoteMap = latestQuotesData.reduce((acc, data: any) => {
        acc[data.symbol] = data;
        return acc;
      }, {} as Record<string, any>);
      
      // Create a map of enabled symbols for name lookup
      const symbolNameMap = symbols.reduce((acc, s) => {
        if (s.enabled !== false) {
          acc[s.symbol] = s.name;
        }
        return acc;
      }, {} as Record<string, string>);
      
      // Process ALL quotes from API that match enabled symbols
      // Backend provides last known prices as fallback (marked as stale)
      const updatedQuotes = latestQuotesData
        .filter((data: any) => symbolNameMap[data.symbol] !== undefined)
        .map((apiData: any) => {
          const price =
            typeof apiData.price === "number"
              ? apiData.price
              : parseFloat(apiData.price) || 0;
          
          // Use prevClose from backend if available; otherwise fall back to current price
          const prevCloseRaw = apiData.prevClose;
          const prevClose =
            typeof prevCloseRaw === "number"
              ? prevCloseRaw
              : prevCloseRaw
              ? parseFloat(prevCloseRaw)
              : price;
          
          // Local fallback: (current - prevClose)/prevClose * 100
          const changePctLocal = calculatePctChange(price, prevClose);
          
          // Prefer server-provided pctChange, but fall back to local calculation
          const pctChange =
            typeof apiData.pctChange === "number"
              ? apiData.pctChange
              : changePctLocal;
          
          return {
            symbol: apiData.symbol,
            name: symbolNameMap[apiData.symbol] || apiData.symbol,
            price: price,
            change: typeof apiData.change === 'number' ? apiData.change : parseFloat(apiData.change || '0') || 0,
            time: apiData.timestamp || Date.now(),
            bid: apiData.bid ? (typeof apiData.bid === 'number' ? apiData.bid : parseFloat(apiData.bid)) : undefined,
            ask: apiData.ask ? (typeof apiData.ask === 'number' ? apiData.ask : parseFloat(apiData.ask)) : undefined,
            spread: apiData.spread ? (typeof apiData.spread === 'number' ? apiData.spread : parseFloat(apiData.spread)) : 
                   (apiData.bid && apiData.ask ? Math.abs(
                      (typeof apiData.ask === 'number' ? apiData.ask : parseFloat(apiData.ask)) - 
                      (typeof apiData.bid === 'number' ? apiData.bid : parseFloat(apiData.bid))
                   ) : undefined),
            prevClose: prevClose,
            changePct: pctChange,
            percent_change: pctChange,
            isStale: !!apiData.isStale,
            lastApiUpdate: apiData.lastApiUpdate,
            dataAge: apiData.dataAge
          };
        });
      
      setQuotes(updatedQuotes);
    }
  }, [latestQuotesData, symbols]);

  // Check if any quotes are stale (using cached fallback prices from last live API data)
  const hasStaleData = quotes.some(q => q.isStale);
  
  return {
    quotes,
    isConnected,
    isLoading: isLoading && quotes.length === 0,
    hasStaleData,
  };
}
