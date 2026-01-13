// @ts-nocheck
import axios from "axios";
import { ensureMarketDailyCloseTable } from "./marketDailyClose";
import { cachePrevClose, getCachedPrevClose, getFallbackQuotePrice, normalizePrevCloseSymbol } from "./prevCloseStore";

const ONE_DAY = 86400; // seconds in a day
const KEY = process.env.FORGE_KEY;

/**
 * Get previous day's close price for a symbol
 * Implements the exact format from the 1Forge documentation
 */
export async function getPrevClose(symbol: string): Promise<number> {
  await ensureMarketDailyCloseTable();
  const sym = normalizePrevCloseSymbol(symbol);
  try {
    // Format pair for 1Forge API (EUR/USD instead of EURUSD)
    const pair = sym.slice(0, 3) + "/" + sym.slice(3);
    
    // Check cache first to minimize API calls
    const cachedPrice = await getCachedPrevClose(sym);
    if (cachedPrice !== null) {
      return cachedPrice;
    }
    
    console.log(`Fetching OHLC data for ${pair} from 1Forge`);
    // Using the exact endpoint format from the docs
    const url = `https://api.1forge.com/quotes/history?pair=${pair}&period=${ONE_DAY}&api_key=${KEY}`;
    const { data } = await axios.get(url, { timeout: 5000 });
    
    if (!Array.isArray(data) || data.length < 2) {
      console.warn(`Not enough candles for ${sym}, got ${data?.length || 0}`);
      return fallbackPrice(sym);
    }
    
    // Get yesterday's close (second to last candle)
    const yesterdayCandle = data[data.length - 2];
    const closePrice = Number(yesterdayCandle.close);
    console.log(`Found yesterday's close for ${sym}: ${closePrice}`);
    
    // Cache the result
    await cachePrevClose(sym, closePrice);
    
    return closePrice;
  } catch (error) {
    console.error(`Error fetching OHLC data for ${sym}:`, error);
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
// @ts-nocheck
// @ts-nocheck
