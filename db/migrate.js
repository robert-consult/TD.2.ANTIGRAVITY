import { db } from "./index.js";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Running database schema migrations...");

  try {
    // Check if min_spread_pips column exists in symbol_configs
    console.log("Adding min_spread_pips column to symbol_configs table if it doesn't exist");
    await db.run(sql`
      PRAGMA foreign_keys=off;
      BEGIN TRANSACTION;
      
      -- Create temporary table
      CREATE TABLE IF NOT EXISTS symbol_configs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        base_currency TEXT,
        quote_currency TEXT,
        spread REAL,
        min_spread_pips REAL DEFAULT 2.0,
        enabled INTEGER NOT NULL DEFAULT 1,
        min_lot INTEGER NOT NULL DEFAULT 100000,
        max_lot INTEGER NOT NULL DEFAULT 1000000,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
      
      -- Copy data
      INSERT INTO symbol_configs_new SELECT 
        id, 
        symbol, 
        name, 
        base_currency, 
        quote_currency, 
        spread, 
        2.0 as min_spread_pips, 
        enabled, 
        min_lot, 
        max_lot, 
        created_at
      FROM symbol_configs;
      
      -- Drop old table
      DROP TABLE symbol_configs;
      
      -- Rename new table
      ALTER TABLE symbol_configs_new RENAME TO symbol_configs;
      
      COMMIT;
      PRAGMA foreign_keys=on;
    `);
    
    // Check if order_type column exists in trades
    console.log("Adding order_type column to trades table if it doesn't exist");
    await db.run(sql`
      PRAGMA foreign_keys=off;
      BEGIN TRANSACTION;
      
      -- Create temporary table
      CREATE TABLE IF NOT EXISTS trades_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        order_type TEXT NOT NULL DEFAULT 'Market',
        size INTEGER NOT NULL,
        open_price REAL NOT NULL,
        close_price REAL,
        take_profit REAL,
        stop_loss REAL,
        limit_price REAL,
        stop_price REAL,
        profit TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        opened_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        executed_at INTEGER,
        closed_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (symbol_id) REFERENCES symbol_configs (id)
      );
      
      -- Copy data
      INSERT INTO trades_new SELECT 
        id, 
        user_id, 
        symbol_id, 
        type, 
        'Market' as order_type,
        size, 
        open_price, 
        close_price, 
        take_profit, 
        stop_loss, 
        limit_price, 
        stop_price, 
        profit, 
        status, 
        opened_at, 
        executed_at, 
        closed_at
      FROM trades;
      
      -- Drop old table
      DROP TABLE trades;
      
      -- Rename new table
      ALTER TABLE trades_new RENAME TO trades;
      
      COMMIT;
      PRAGMA foreign_keys=on;
    `);

    // Update users balance to 1,000,000
    console.log("Updating user balances to $1,000,000");
    await db.run(sql`
      UPDATE users 
      SET balance = '1000000.00' 
      WHERE balance != '1000000.00';
    `);

    console.log("Database migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
}

// Execute the migration
migrate();