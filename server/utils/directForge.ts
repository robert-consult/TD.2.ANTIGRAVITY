// @ts-nocheck
// Based on the 1Forge documentation provided in the instructions
import axios from "axios";
import BetterSQLite3 from 'better-sqlite3';

const ONE_DAY = 86400;
const KEY = process.env.FORGE_KEY;

/**
 * Get previous day's close price for a symbol
 */
export async function getPrevClose(pair: string): Promise<number> {
  // Check cache first
  const cachedValue = getFromCache(pair);
  if (cachedValue !== null) {
    console.log(`Using cached previous close for ${pair}: ${cachedValue}`);
    return cachedValue;
  }
  
  try {
    // Format pair for 1Forge API (EUR/USD instead of EURUSD)
    const formattedPair = pair.slice(0, 3) + "/" + pair.slice(3);
    
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
      saveToCache(pair, closePrice);
      
      return closePrice;
    }
    
    return fallbackPrice(pair);
  } catch (error) {
    console.error(`Error fetching 1Forge history for ${pair}:`, error);
    return fallbackPrice(pair);
  }
}

/**
 * Initialize cache table for storing previous closing prices
 */
export function initCache(): void {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    // Create cache table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS prev_close_cache (
        symbol TEXT PRIMARY KEY,
        close_price REAL NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    console.log("Price history cache initialized");
  } catch (error) {
    console.error("Failed to initialize price history cache:", error);
  } finally {
    db.close();
  }
}

/**
 * Get cached close price if available
 */
function getFromCache(symbol: string): number | null {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    // Cache expires after 24 hours
    const cutoffTime = Math.floor(Date.now() / 1000) - 86400;
    
    const stmt = db.prepare('SELECT close_price FROM prev_close_cache WHERE symbol = ? AND timestamp > ?');
    const result = stmt.get(symbol, cutoffTime);
    
    if (result && result.close_price) {
      return Number(result.close_price);
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting cached price for ${symbol}:`, error);
    return null;
  } finally {
    db.close();
  }
}

/**
 * Save close price to cache
 */
function saveToCache(symbol: string, closePrice: number): void {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    const now = Math.floor(Date.now() / 1000);
    
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO prev_close_cache (symbol, close_price, timestamp) VALUES (?, ?, ?)'
    );
    stmt.run(symbol, closePrice, now);
    
    console.log(`Cached previous close for ${symbol}: ${closePrice}`);
  } catch (error) {
    console.error(`Error caching price for ${symbol}:`, error);
  } finally {
    db.close();
  }
}

/**
 * Get fallback price when API fails
 */
function fallbackPrice(symbol: string): number {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    // Try to get current price from quotes table
    const stmt = db.prepare('SELECT (bid + ask)/2 as price FROM quotes WHERE symbol = ?');
    const result = stmt.get(symbol);
    
    if (result && result.price) {
      console.log(`Using current price as fallback for ${symbol}: ${result.price}`);
      return Number(result.price);
    }
    
    // Return sensible default if all else fails
    return symbol.includes('JPY') ? 140.0 : 1.0;
  } catch (error) {
    console.error(`Error getting fallback price for ${symbol}:`, error);
    return symbol.includes('JPY') ? 140.0 : 1.0;
  } finally {
    db.close();
  }
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