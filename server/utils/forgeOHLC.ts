// @ts-nocheck
import axios from "axios";
import BetterSQLite3 from 'better-sqlite3';

const ONE_DAY = 86400; // seconds in a day
const KEY = process.env.API_KEY_1FORGE;

/**
 * Get previous day's close price for a symbol
 * Follows the 1Forge API format exactly as documented
 */
export async function getPrevClose(symbol: string): Promise<number> {
  try {
    // Format pair for 1Forge API (EUR/USD instead of EURUSD)
    const pair = symbol.slice(0, 3) + "/" + symbol.slice(3);
    
    // Check cache first to minimize API calls
    const cachedPrice = getFromCache(symbol);
    if (cachedPrice !== null) {
      return cachedPrice;
    }
    
    console.log(`Fetching OHLC data for ${pair} from 1Forge`);
    const url = `https://api.1forge.com/ohlc?pair=${pair}&interval=${ONE_DAY}&api_key=${KEY}`;
    const { data } = await axios.get(url, { timeout: 5000 });
    
    if (!Array.isArray(data) || data.length < 2) {
      console.warn(`Not enough candles for ${symbol}, got ${data?.length || 0}`);
      return fallbackPrice(symbol);
    }
    
    // Get yesterday's close (second to last candle)
    const yesterdayClose = Number(data[data.length - 2].close);
    console.log(`Found yesterday's close for ${symbol}: ${yesterdayClose}`);
    
    // Cache the result
    saveToCache(symbol, yesterdayClose);
    
    return yesterdayClose;
  } catch (error) {
    console.error(`Error fetching OHLC data for ${symbol}:`, error);
    return fallbackPrice(symbol);
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
      CREATE TABLE IF NOT EXISTS price_history (
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
 * Get cached close price if available and not expired
 */
function getFromCache(symbol: string): number | null {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    // Cache expires after 24 hours (86400 seconds)
    const cutoffTime = Math.floor(Date.now() / 1000) - 86400;
    
    const stmt = db.prepare('SELECT close_price FROM price_history WHERE symbol = ? AND timestamp > ?');
    const result = stmt.get(symbol, cutoffTime);
    
    if (result && typeof result.close_price === 'number') {
      console.log(`Using cached previous close for ${symbol}: ${result.close_price}`);
      return result.close_price;
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
      'INSERT OR REPLACE INTO price_history (symbol, close_price, timestamp) VALUES (?, ?, ?)'
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
    const stmt = db.prepare('SELECT (bid + ask)/2 as price FROM quotes WHERE symbol = ? LIMIT 1');
    const result = stmt.get(symbol);
    
    if (result && typeof result.price === 'number') {
      console.log(`Using current price as fallback for ${symbol}: ${result.price}`);
      return result.price;
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