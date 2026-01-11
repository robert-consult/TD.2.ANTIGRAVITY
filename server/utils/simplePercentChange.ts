// @ts-nocheck
import BetterSQLite3 from 'better-sqlite3';

/**
 * Simple utility to calculate percentage changes using cached prices
 * Since we can't access the 1Forge historical API with current subscription
 */

/**
 * Initialize cache table for storing previous closing prices
 */
export function initCache(): void {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    // Create cache table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_prices (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    console.log("Daily prices cache initialized");
  } catch (error) {
    console.error("Failed to initialize daily prices cache:", error);
  } finally {
    db.close();
  }
}

/**
 * Cache current prices once per day to use as reference
 * for percentage change calculations
 */
export function updateDailyPrices(quotes: Array<{symbol: string, price?: number, bid?: number, ask?: number}>): void {
  if (!quotes || quotes.length === 0) return;
  
  const db = new BetterSQLite3('./trading_app.db');
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400; // 24 hours in seconds
  
  try {
    // First check when we last updated prices
    const stmt = db.prepare('SELECT MAX(timestamp) as last_update FROM daily_prices');
    const result = stmt.get();
    
    // Only update once per day
    if (!result || !result.last_update || result.last_update < oneDayAgo) {
      console.log("Updating daily reference prices for percentage change calculations");
      
      // Start a transaction for batch updates
      const insertStmt = db.prepare(
        'INSERT OR REPLACE INTO daily_prices (symbol, price, timestamp) VALUES (?, ?, ?)'
      );
      
      db.transaction(() => {
        for (const quote of quotes) {
          if (!quote.symbol) continue;
          
          // Calculate mid price if we have bid/ask
          const price = quote.price || 
            (quote.bid && quote.ask ? (quote.bid + quote.ask) / 2 : null);
          
          if (price) {
            insertStmt.run(quote.symbol, price, now);
            console.log(`Saved daily reference price for ${quote.symbol}: ${price}`);
          }
        }
      })();
      
      console.log("Daily reference prices updated");
    }
  } catch (error) {
    console.error("Error updating daily prices:", error);
  } finally {
    db.close();
  }
}

/**
 * Calculate percentage change between current price and previous reference
 */
export async function calculatePercentChange(symbol: string, currentPrice: number): Promise<number> {
  const db = new BetterSQLite3('./trading_app.db');
  
  try {
    const stmt = db.prepare('SELECT price FROM daily_prices WHERE symbol = ?');
    const result = stmt.get(symbol);
    
    if (result && result.price && result.price > 0) {
      const change = ((currentPrice - result.price) / result.price) * 100;
      // Round to 2 decimal places
      return Math.round(change * 100) / 100;
    }
    
    // If no reference price exists yet, store current price and return 0
    const insertStmt = db.prepare(
      'INSERT OR REPLACE INTO daily_prices (symbol, price, timestamp) VALUES (?, ?, ?)'
    );
    insertStmt.run(symbol, currentPrice, Math.floor(Date.now() / 1000));
    
    return 0;
  } catch (error) {
    console.error(`Error calculating percentage change for ${symbol}:`, error);
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Update the cache with initial values if empty
 */
export function preloadCache(symbols: string[]): void {
  // This is now a no-op since we'll populate on first quote
  console.log("Ready to start tracking percentage changes");
}
// @ts-nocheck
// @ts-nocheck