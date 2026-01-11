const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '..', 'trading_app.db');
console.log(`Initializing database at: ${dbPath}`);

const db = new Database(dbPath);

try {
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
} catch (e) {
  console.log("Pragma warning:", e.message);
}

console.log("Creating base tables...");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '1000000.00',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    is_admin INTEGER NOT NULL DEFAULT 0
  )
`);
console.log("  - users table created");

db.exec(`
  CREATE TABLE IF NOT EXISTS symbol_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    base_currency TEXT,
    quote_currency TEXT,
    spread REAL,
    min_spread_pips REAL DEFAULT 2.0,
    enabled INTEGER NOT NULL DEFAULT 1,
    min_lot INTEGER NOT NULL DEFAULT 100000,
    max_lot INTEGER NOT NULL DEFAULT 5000000,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  )
`);
console.log("  - symbol_configs table created");

db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'Market',
    size INTEGER NOT NULL,
    lots INTEGER,
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
  )
`);
console.log("  - trades table created");

db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    leverage REAL NOT NULL DEFAULT 50,
    max_concurrent INTEGER NOT NULL DEFAULT 5,
    max_concurrent_per_instrument INTEGER,
    max_concurrent_lots INTEGER NOT NULL DEFAULT 50,
    min_hold_sec INTEGER NOT NULL DEFAULT 60,
    max_hold_sec INTEGER NOT NULL DEFAULT 86400,
    show_lb INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )
`);
console.log("  - user_settings table created");

db.exec(`
  CREATE TABLE IF NOT EXISTS quotes (
    symbol TEXT PRIMARY KEY,
    price REAL NOT NULL,
    bid REAL,
    ask REAL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_stale INTEGER DEFAULT 0,
    last_api_update INTEGER
  )
`);
console.log("  - quotes table created");

db.exec(`
  CREATE TABLE IF NOT EXISTS global_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    default_leverage REAL NOT NULL DEFAULT 50,
    max_position_size REAL NOT NULL DEFAULT 100000,
    max_trades_per_user INTEGER NOT NULL DEFAULT 5,
    max_trades_per_instrument INTEGER NOT NULL DEFAULT 3,
    max_concurrent_lots INTEGER NOT NULL DEFAULT 50,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);
const existingGlobal = db.prepare("SELECT id FROM global_settings WHERE id = 1").get();
if (!existingGlobal) {
  db.exec("INSERT INTO global_settings (id) VALUES (1)");
  console.log("  - global_settings table created and seeded");
} else {
  console.log("  - global_settings table already exists");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    maintenance_mode INTEGER NOT NULL DEFAULT 0,
    trading_halt INTEGER NOT NULL DEFAULT 0,
    close_only_mode INTEGER NOT NULL DEFAULT 0,
    block_open_on_stale_quotes INTEGER NOT NULL DEFAULT 1,
    maintenance_message TEXT DEFAULT 'System is under maintenance. Trading will resume shortly.',
    quote_refresh_ms INTEGER NOT NULL DEFAULT 870,
    feed_poll_ms INTEGER NOT NULL DEFAULT 870,
    stale_threshold_ms INTEGER NOT NULL DEFAULT 30000,
    fx_rollover_tz TEXT NOT NULL DEFAULT 'America/New_York',
    fx_rollover_time TEXT NOT NULL DEFAULT '17:00',
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_by TEXT
  )
`);
const existingConfig = db.prepare("SELECT id FROM system_config WHERE id = 1").get();
if (!existingConfig) {
  db.exec("INSERT INTO system_config (id) VALUES (1)");
  console.log("  - system_config table created and seeded");
} else {
  console.log("  - system_config table already exists");
}

console.log("\nSeeding initial symbols...");
const symbols = [
  { symbol: 'EURUSD', name: 'Euro / US Dollar', base: 'EUR', quote: 'USD', spread: 0.0002 },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', base: 'GBP', quote: 'USD', spread: 0.0003 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', base: 'USD', quote: 'JPY', spread: 0.015 },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', base: 'AUD', quote: 'USD', spread: 0.0003 },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', base: 'USD', quote: 'CAD', spread: 0.0003 },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', base: 'USD', quote: 'CHF', spread: 0.0003 },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', base: 'NZD', quote: 'USD', spread: 0.0003 },
  { symbol: 'EURGBP', name: 'Euro / British Pound', base: 'EUR', quote: 'GBP', spread: 0.0003 },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', base: 'EUR', quote: 'JPY', spread: 0.02 },
  { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', base: 'GBP', quote: 'JPY', spread: 0.025 },
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', base: 'XAU', quote: 'USD', spread: 0.5 },
];

const insertSymbol = db.prepare(`
  INSERT OR IGNORE INTO symbol_configs (symbol, name, base_currency, quote_currency, spread)
  VALUES (?, ?, ?, ?, ?)
`);

for (const s of symbols) {
  const result = insertSymbol.run(s.symbol, s.name, s.base, s.quote, s.spread);
  if (result.changes > 0) {
    console.log(`  - Added ${s.symbol}`);
  }
}

console.log("\nDatabase initialization complete!");
db.close();
