import { db } from "./index";
import { users, symbolConfigs, trades, userSettings } from "../shared/schema";

async function createTables() {
  console.log("Creating database tables...");
  
  // Create tables
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      balance TEXT NOT NULL DEFAULT '10000.00',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      is_admin INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS symbol_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      base_currency TEXT NOT NULL,
      quote_currency TEXT NOT NULL,
      spread REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      min_lot INTEGER NOT NULL DEFAULT 1000,
      max_lot INTEGER NOT NULL DEFAULT 100000,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      open_price REAL NOT NULL,
      close_price REAL,
      take_profit REAL,
      stop_loss REAL,
      profit TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN',
      opened_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      closed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (symbol_id) REFERENCES symbol_configs (id)
    )
  `);
  
  await db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      leverage REAL NOT NULL DEFAULT 50,
      max_concurrent INTEGER NOT NULL DEFAULT 5,
      min_hold_sec INTEGER NOT NULL DEFAULT 60,
      max_hold_sec INTEGER NOT NULL DEFAULT 86400,
      show_lb INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // Seed initial symbol data
  const symbols = [
    {
      symbol: 'EURUSD',
      name: 'Euro / US Dollar',
      baseCurrency: 'EUR',
      quoteCurrency: 'USD',
      spread: 0.0002,
    },
    {
      symbol: 'GBPUSD',
      name: 'British Pound / US Dollar',
      baseCurrency: 'GBP',
      quoteCurrency: 'USD',
      spread: 0.0003,
    },
    {
      symbol: 'USDJPY',
      name: 'US Dollar / Japanese Yen',
      baseCurrency: 'USD',
      quoteCurrency: 'JPY',
      spread: 0.015,
    },
    {
      symbol: 'AUDUSD',
      name: 'Australian Dollar / US Dollar',
      baseCurrency: 'AUD',
      quoteCurrency: 'USD',
      spread: 0.0003,
    }
  ];

  // Insert symbols if they don't exist
  for (const symbol of symbols) {
    try {
      // Check if symbol exists
      const existingSymbol = await db.query.symbolConfigs.findFirst({
        where: (s, { eq }) => eq(s.symbol, symbol.symbol)
      });

      if (!existingSymbol) {
        await db.insert(symbolConfigs).values(symbol);
        console.log(`Added symbol: ${symbol.symbol}`);
      }
    } catch (error) {
      console.error(`Error adding symbol ${symbol.symbol}:`, error);
    }
  }

  console.log("Database migration completed!");
}

// Run migrations
createTables()
  .then(() => {
    console.log("Database successfully initialized");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error initializing database:", error);
    process.exit(1);
  });