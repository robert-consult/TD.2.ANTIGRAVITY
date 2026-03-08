import axios from "axios";
import { ensureMarketDailyCloseTable } from "./marketDailyClose";
import { cachePrevClose, getCachedPrevClose, getFallbackQuotePrice, normalizePrevCloseSymbol } from "./prevCloseStore";
import { SYMBOLS } from "../constants/symbols";

const ONE_DAY = 86400; // seconds
const KEY_1FORGE = process.env.API_KEY_1FORGE;

/**
 * Initialize cache table for storing previous closing prices
 */
export async function initPrevCloseCache() {
  await ensureMarketDailyCloseTable();
  console.log("Market daily close cache ready");
}

/**
 * Fetch previous day's close price from 1Forge
 * @param pair - Currency pair (e.g., 'EURUSD')
 * @returns Previous day's close price
 */
async function fetch1ForgeClose(pair: string): Promise<number | null> {
  // Format pair for 1Forge API (EUR/USD instead of EURUSD)
  const formattedPair = pair.slice(0, 3) + "/" + pair.slice(3);
  
  try {
    // Correct 1Forge OHLC endpoint
    const url = `https://api.1forge.com/ohlc?pair=${formattedPair}&interval=${ONE_DAY}&api_key=${KEY_1FORGE}`;
    console.log(`Fetching historical data for ${formattedPair} from 1Forge`);
    
    const { data } = await axios.get(url, { timeout: 5000 });
    
    // Parse the response - 1Forge returns an array of candles, newest last
    if (Array.isArray(data) && data.length >= 2) {
      // Get yesterday's candle (second to last in the array)
      const yesterdayCandle = data[data.length - 2];
      console.log(`Found yesterday's close for ${formattedPair}: ${yesterdayCandle.close}`);
      return Number(yesterdayCandle.close);
    } else {
      console.warn(`Not enough candles for ${formattedPair}, got ${data?.length || 0}`);
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching 1Forge history for ${pair}:`, error);
    return null;
  }
}

/**
 * Get previous day's close price for a symbol
 * @param pair - Currency pair (e.g., 'EURUSD')
 * @returns Previous day's close price
 */
export async function getPrevClose(pair: string): Promise<number> {
  await ensureMarketDailyCloseTable();
  const sym = normalizePrevCloseSymbol(pair);
  
  try {
    // 1) Check cache first
    const cached = await getCachedPrevClose(sym);
    if (cached != null) {
      console.log(`Using cached previous close for ${sym}: ${cached}`);
      return Number(cached);
    }
    
    // 2) Try to get from 1Forge API
    const close = await fetch1ForgeClose(sym);
    
    if (close && typeof close === 'number' && !isNaN(close)) {
      // Cache the result
      await cachePrevClose(sym, close);
      console.log(`Stored previous close for ${sym}: ${close}`);
      return close;
    }
    
    // 3) Fallback - use current price in quotes table
    const fallback = await getFallbackQuotePrice(sym);
    if (fallback != null) {
      console.log(`Using current price as fallback for ${sym}: ${fallback}`);
      return fallback;
    }
    
    // 4) Last resort - return a reasonable default based on the pair
    console.log(`No previous close available for ${sym}, using default value`);
    return sym.includes('JPY') ? 140.0 : 1.0;
  } catch (error) {
    console.error(`Error getting previous close for ${sym}:`, error);
    // Return a sensible default if everything fails
    return sym.includes('JPY') ? 140.0 : 1.0;
  }
}

/**
 * Calculate percentage change between current price and previous close
 * @param pair - Currency pair
 * @param currentPrice - Current mid price
 * @returns Percentage change (%)
 */
export async function calculatePercentChange(pair: string, currentPrice: number): Promise<number> {
  try {
    const prevClose = await getPrevClose(pair);
    
    if (prevClose && prevClose > 0) {
      const change = ((currentPrice - prevClose) / prevClose) * 100;
      // Round to 2 decimal places
      return Math.round(change * 100) / 100;
    }
    
    return 0;
  } catch (error) {
    console.error(`Error calculating percentage change for ${pair}:`, error);
    return 0;
  }
}

/**
 * Preload cache with previous day's close prices for all symbols
 * This can be called on server startup
 */
export async function preloadCache(): Promise<void> {
  console.log("Preloading previous close prices for all symbols...");
  
  for (const symbol of SYMBOLS) {
    try {
      await getPrevClose(symbol);
    } catch (error) {
      console.error(`Failed to preload cache for ${symbol}:`, error);
    }
  }
  
  console.log("Finished preloading previous close prices");
}
