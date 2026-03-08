// Based on the 1Forge documentation provided in the instructions
import axios from "axios";
import { ensureMarketDailyCloseTable } from "./marketDailyClose";
import { cachePrevClose, getCachedPrevClose, getFallbackQuotePrice, normalizePrevCloseSymbol } from "./prevCloseStore";

const ONE_DAY = 86400;
const KEY = process.env.FORGE_KEY;

/**
 * Get previous day's close price for a symbol
 */
export async function getPrevClose(pair: string): Promise<number> {
  await ensureMarketDailyCloseTable();
  const sym = normalizePrevCloseSymbol(pair);
  // Check cache first
  const cachedValue = await getCachedPrevClose(sym);
  if (cachedValue !== null) {
    console.log(`Using cached previous close for ${sym}: ${cachedValue}`);
    return cachedValue;
  }
  
  try {
    // Format pair for 1Forge API (EUR/USD instead of EURUSD)
    const formattedPair = sym.slice(0, 3) + "/" + sym.slice(3);
    
    // Use the exact URL format from the documentation
    const url = `https://api.1forge.com/quotes/history?pair=${formattedPair}&period=${ONE_DAY}&api_key=${KEY}`;
    console.log(`Fetching historical data for ${formattedPair} from 1Forge`);
    
    const { data } = await axios.get(url, { timeout: 5000 });
    
    // Parse the response - 1Forge returns an array of candles
    if (Array.isArray(data) && data.length > 1) {
      // last candle = today (unfinished), take previous one
      const prevDayCandle = data[data.length - 2];
      // Get the closing price
      const closePrice = Number(prevDayCandle?.close || prevDayCandle?.c || prevDayCandle?.price);
      
      // Cache the result
      await cachePrevClose(sym, closePrice);
      
      return closePrice;
    }
    
    return fallbackPrice(sym);
  } catch (error) {
    console.error(`Error fetching 1Forge history for ${sym}:`, error);
    return fallbackPrice(sym);
  }
}

/**
 * Initialize cache table for storing previous closing prices
 */
export async function initCache(): Promise<void> {
  await ensureMarketDailyCloseTable();
  console.log("Market daily close cache ready");
}

/**
 * Get fallback price when API fails
 */
async function fallbackPrice(symbol: string): Promise<number> {
  const fallback = await getFallbackQuotePrice(symbol);
  if (fallback != null) {
    console.log(`Using current price as fallback for ${symbol}: ${fallback}`);
    return fallback;
  }
  return symbol.includes("JPY") ? 140.0 : 1.0;
}

/**
 * Calculate percentage change between current price and previous close
 */
export async function calculatePercentChange(symbol: string, currentPrice: number): Promise<number> {
  try {
    const prevClose = await getPrevClose(symbol);
    
    if (prevClose && prevClose > 0) {
      const change = ((currentPrice - prevClose) / prevClose) * 100;
      // Round to 2 decimal places
      return Math.round(change * 100) / 100;
    }
    
    return 0;
  } catch (error) {
    console.error(`Error calculating percentage change for ${symbol}:`, error);
    return 0;
  }
}

/**
 * Preload cache with previous day's close prices for all symbols
 */
export async function preloadCache(symbols: string[]): Promise<void> {
  console.log("Preloading previous close prices for all symbols...");
  
  for (const symbol of symbols) {
    try {
      await getPrevClose(symbol);
    } catch (error) {
      console.error(`Failed to preload cache for ${symbol}:`, error);
    }
  }
  
  console.log("Finished preloading previous close prices");
}
