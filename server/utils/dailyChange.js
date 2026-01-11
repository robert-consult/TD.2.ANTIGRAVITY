/**
 * A simple implementation to calculate percentage changes for 1Forge Starter tier
 * Uses the daily cached reference prices as we don't have access to candles/ohlc API
 */

import BetterSQLite3 from 'better-sqlite3';

// Map to cache reference prices in memory
const refPrices = new Map();
const lastUpdated = new Map();

// Initialize our reference price tracking
export function initReferenceData() {
  try {
    const db = new BetterSQLite3('./trading_app.db');
    
    // Create a reference price table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS reference_prices (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    
    // Load any existing reference prices
    const rows = db.prepare('SELECT * FROM reference_prices').all();
    
    for (const row of rows) {
      refPrices.set(row.symbol, row.price);
      lastUpdated.set(row.symbol, row.timestamp);
    }
    
    db.close();
    
    console.log(`Loaded ${rows.length} reference prices from database`);
  } catch (error) {
    console.error("Error initializing reference price tracking:", error);
  }
}

// Update reference prices once per day
export function updateReferenceData(symbols, prices) {
  const now = Math.floor(Date.now() / 1000);
  const oneDaySeconds = 86400;
  let updated = 0;
  
  try {
    const db = new BetterSQLite3('./trading_app.db');
    const stmt = db.prepare('INSERT OR REPLACE INTO reference_prices (symbol, price, timestamp) VALUES (?, ?, ?)');
    
    symbols.forEach((symbol, index) => {
      const price = prices[index];
      const lastUpdate = lastUpdated.get(symbol) || 0;
      
      // Only update once per day
      if (now - lastUpdate > oneDaySeconds) {
        // Store in database
        stmt.run(symbol, price, now);
        
        // Update in memory
        refPrices.set(symbol, price);
        lastUpdated.set(symbol, now);
        
        updated++;
        console.log(`Updated reference price for ${symbol}: ${price}`);
      }
    });
    
    db.close();
    
    if (updated > 0) {
      console.log(`Updated ${updated} reference prices`);
    }
  } catch (error) {
    console.error("Error updating reference prices:", error);
  }
}

// Calculate percentage change from reference price (previous day's close)
export function calculateChange(symbol, currentPrice) {
  const reference = refPrices.get(symbol);
  
  // If we don't have a reference price yet, initialize it and return 0
  if (!reference) {
    const now = Math.floor(Date.now() / 1000);
    
    refPrices.set(symbol, currentPrice);
    lastUpdated.set(symbol, now);
    
    const db = new BetterSQLite3('./trading_app.db');
    const stmt = db.prepare('INSERT OR REPLACE INTO reference_prices (symbol, price, timestamp) VALUES (?, ?, ?)');
    stmt.run(symbol, currentPrice, now);
    db.close();
    
    return 0;
  }
  
  // Percentage change vs "previous day's close" (reference price)
  const change = ((currentPrice - reference) / reference) * 100;
  
  // Round to 2 decimal places
  return Math.round(change * 100) / 100;
}