/**
 * Runtime schema migration for SQLite
 * Adds new columns if they don't exist without losing data
 */

import Database from "better-sqlite3";

function getDb() {
  const db = new Database("./trading_app.db");
  // Improve concurrency for background audit logging + grift telemetry.
  try {
    db.pragma("journal_mode = WAL");
  } catch {}
  try {
    db.pragma("busy_timeout = 5000");
  } catch {}
  try {
    db.pragma("foreign_keys = ON");
  } catch {}
  return db;
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table);
  return !!row;
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return rows.some(r => r.name === col);
}

// Core app tables required for auth + trading.
// This is intentionally additive-only (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN),
// to avoid losing audit trails when the DB was reset/recreated.
export function ensureCoreTradingSchema() {
  const db = getDb();
  try {
    // users (auth + profile + tiering)
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        balance TEXT NOT NULL DEFAULT '1000000.00',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        is_admin INTEGER NOT NULL DEFAULT 0
      );
    `);

    // symbol_configs (trading instruments)
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
      );
    `);

    // trades (core trading ledger)
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
      );
    `);

    // user_settings (risk/user prefs)
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
      );
    `);

    // quotes (market data cache) - used by price feed + staleness tracking
    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        symbol TEXT PRIMARY KEY,
        price REAL NOT NULL,
        bid REAL,
        ask REAL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_stale INTEGER DEFAULT 0,
        last_api_update INTEGER
      );
    `);

    // Backfill missing columns if DB was created by an older init script.
    const symbolAdds: Array<{ col: string; ddl: string }> = [
      { col: "base_currency", ddl: "ALTER TABLE symbol_configs ADD COLUMN base_currency TEXT" },
      { col: "quote_currency", ddl: "ALTER TABLE symbol_configs ADD COLUMN quote_currency TEXT" },
      { col: "spread", ddl: "ALTER TABLE symbol_configs ADD COLUMN spread REAL" },
      { col: "min_spread_pips", ddl: "ALTER TABLE symbol_configs ADD COLUMN min_spread_pips REAL DEFAULT 2.0" },
      { col: "enabled", ddl: "ALTER TABLE symbol_configs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1" },
      { col: "min_lot", ddl: "ALTER TABLE symbol_configs ADD COLUMN min_lot INTEGER NOT NULL DEFAULT 100000" },
      { col: "max_lot", ddl: "ALTER TABLE symbol_configs ADD COLUMN max_lot INTEGER NOT NULL DEFAULT 5000000" },
      { col: "created_at", ddl: "ALTER TABLE symbol_configs ADD COLUMN created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))" },
    ];

    for (const a of symbolAdds) {
      if (hasTable(db, "symbol_configs") && !hasColumn(db, "symbol_configs", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to symbol_configs`);
      }
    }

    const tradeAdds: Array<{ col: string; ddl: string }> = [
      { col: "order_type", ddl: "ALTER TABLE trades ADD COLUMN order_type TEXT NOT NULL DEFAULT 'Market'" },
      { col: "lots", ddl: "ALTER TABLE trades ADD COLUMN lots INTEGER" },
      { col: "limit_price", ddl: "ALTER TABLE trades ADD COLUMN limit_price REAL" },
      { col: "stop_price", ddl: "ALTER TABLE trades ADD COLUMN stop_price REAL" },
      { col: "executed_at", ddl: "ALTER TABLE trades ADD COLUMN executed_at INTEGER" },
      { col: "status", ddl: "ALTER TABLE trades ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'" },
    ];

    for (const a of tradeAdds) {
      if (hasTable(db, "trades") && !hasColumn(db, "trades", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to trades`);
      }
    }

    const quotesAdds: Array<{ col: string; ddl: string }> = [
      { col: "price", ddl: "ALTER TABLE quotes ADD COLUMN price REAL NOT NULL DEFAULT 0" },
      { col: "bid", ddl: "ALTER TABLE quotes ADD COLUMN bid REAL" },
      { col: "ask", ddl: "ALTER TABLE quotes ADD COLUMN ask REAL" },
      { col: "updated_at", ddl: "ALTER TABLE quotes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP" },
      { col: "is_stale", ddl: "ALTER TABLE quotes ADD COLUMN is_stale INTEGER DEFAULT 0" },
      { col: "last_api_update", ddl: "ALTER TABLE quotes ADD COLUMN last_api_update INTEGER" },
    ];

    for (const a of quotesAdds) {
      if (hasTable(db, "quotes") && !hasColumn(db, "quotes", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to quotes`);
      }
    }

    // Seed baseline symbols (only inserts missing rows).
    const seedSymbols = [
      { symbol: "EURUSD", name: "Euro / US Dollar", base: "EUR", quote: "USD", spread: 0.0002 },
      { symbol: "GBPUSD", name: "British Pound / US Dollar", base: "GBP", quote: "USD", spread: 0.0003 },
      { symbol: "USDJPY", name: "US Dollar / Japanese Yen", base: "USD", quote: "JPY", spread: 0.015 },
      { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", base: "AUD", quote: "USD", spread: 0.0003 },
      { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", base: "USD", quote: "CAD", spread: 0.0003 },
      { symbol: "USDCHF", name: "US Dollar / Swiss Franc", base: "USD", quote: "CHF", spread: 0.0003 },
      { symbol: "NZDUSD", name: "New Zealand Dollar / US Dollar", base: "NZD", quote: "USD", spread: 0.0003 },
      { symbol: "EURGBP", name: "Euro / British Pound", base: "EUR", quote: "GBP", spread: 0.0003 },
      { symbol: "EURJPY", name: "Euro / Japanese Yen", base: "EUR", quote: "JPY", spread: 0.02 },
      { symbol: "GBPJPY", name: "British Pound / Japanese Yen", base: "GBP", quote: "JPY", spread: 0.025 },
      { symbol: "XAUUSD", name: "Gold / US Dollar", base: "XAU", quote: "USD", spread: 0.5 },
    ];

    try {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO symbol_configs (symbol, name, base_currency, quote_currency, spread)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const s of seedSymbols) {
        insert.run(s.symbol, s.name, s.base, s.quote, s.spread);
      }
    } catch (e) {
      console.warn("[Schema] Failed to seed symbol_configs:", e);
    }

    console.log("Core trading schema ensured");
  } finally {
    db.close();
  }
}

export function ensureTradeCloseAuditColumns() {
  const db = getDb();
  try {
    const table = "trades";
    if (!hasTable(db, table)) {
      console.log("Trades table does not exist yet, skipping close audit columns");
      return;
    }
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "close_reason", ddl: "ALTER TABLE trades ADD COLUMN close_reason TEXT" },
      { col: "close_quote_ts", ddl: "ALTER TABLE trades ADD COLUMN close_quote_ts INTEGER" },
      { col: "close_source", ddl: "ALTER TABLE trades ADD COLUMN close_source TEXT" },
      { col: "close_bid", ddl: "ALTER TABLE trades ADD COLUMN close_bid REAL" },
      { col: "close_ask", ddl: "ALTER TABLE trades ADD COLUMN close_ask REAL" },
      { col: "close_mid", ddl: "ALTER TABLE trades ADD COLUMN close_mid REAL" },
      { col: "close_spread", ddl: "ALTER TABLE trades ADD COLUMN close_spread REAL" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
  } finally {
    db.close();
  }
}

export function ensureTradeAuditTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trade_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        requested_price REAL,
        trigger_price REAL,
        fill_price REAL,
        slippage REAL,
        quote_ts INTEGER,
        quote_source TEXT,
        quote_bid REAL,
        quote_ask REAL,
        quote_mid REAL,
        quote_spread REAL,
        note TEXT,
        FOREIGN KEY(trade_id) REFERENCES trades(id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_audit_trade_id ON trade_audit(trade_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_audit_event_at ON trade_audit(event_at);`);
    console.log("Trade audit table ensured");
  } finally {
    db.close();
  }
}

// INSTITUTIONAL-GRADE: Add new columns for hedge fund compliance
export function ensureInstitutionalAuditColumns() {
  const db = getDb();
  try {
    const table = "trade_audit";
    const adds: Array<{ col: string; ddl: string }> = [
      // Event identification
      { col: "event_category", ddl: "ALTER TABLE trade_audit ADD COLUMN event_category TEXT NOT NULL DEFAULT 'TRADE'" },
      { col: "event_at_ms", ddl: "ALTER TABLE trade_audit ADD COLUMN event_at_ms INTEGER" },
      // Correlation & lifecycle IDs
      { col: "correlation_id", ddl: "ALTER TABLE trade_audit ADD COLUMN correlation_id TEXT" },
      { col: "order_id", ddl: "ALTER TABLE trade_audit ADD COLUMN order_id TEXT" },
      { col: "execution_id", ddl: "ALTER TABLE trade_audit ADD COLUMN execution_id TEXT" },
      { col: "position_id", ddl: "ALTER TABLE trade_audit ADD COLUMN position_id TEXT" },
      // Actor/provenance
      { col: "actor_type", ddl: "ALTER TABLE trade_audit ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'SYSTEM'" },
      { col: "actor_user_id", ddl: "ALTER TABLE trade_audit ADD COLUMN actor_user_id INTEGER" },
      { col: "session_id", ddl: "ALTER TABLE trade_audit ADD COLUMN session_id TEXT" },
      { col: "ip", ddl: "ALTER TABLE trade_audit ADD COLUMN ip TEXT" },
      { col: "user_agent", ddl: "ALTER TABLE trade_audit ADD COLUMN user_agent TEXT" },
      // Order economics
      { col: "symbol", ddl: "ALTER TABLE trade_audit ADD COLUMN symbol TEXT" },
      { col: "side", ddl: "ALTER TABLE trade_audit ADD COLUMN side TEXT" },
      { col: "order_type", ddl: "ALTER TABLE trade_audit ADD COLUMN order_type TEXT" },
      { col: "time_in_force", ddl: "ALTER TABLE trade_audit ADD COLUMN time_in_force TEXT" },
      { col: "qty_lots", ddl: "ALTER TABLE trade_audit ADD COLUMN qty_lots REAL" },
      // Pricing
      { col: "limit_price", ddl: "ALTER TABLE trade_audit ADD COLUMN limit_price REAL" },
      { col: "stop_price", ddl: "ALTER TABLE trade_audit ADD COLUMN stop_price REAL" },
      { col: "avg_fill_price", ddl: "ALTER TABLE trade_audit ADD COLUMN avg_fill_price REAL" },
      // Market context
      { col: "spread_pips", ddl: "ALTER TABLE trade_audit ADD COLUMN spread_pips REAL" },
      // Slippage analysis
      { col: "slippage_pips", ddl: "ALTER TABLE trade_audit ADD COLUMN slippage_pips REAL" },
      { col: "slippage_reference", ddl: "ALTER TABLE trade_audit ADD COLUMN slippage_reference TEXT" },
      { col: "latency_ms", ddl: "ALTER TABLE trade_audit ADD COLUMN latency_ms INTEGER" },
      // Risk control evidence
      { col: "risk_check_name", ddl: "ALTER TABLE trade_audit ADD COLUMN risk_check_name TEXT" },
      { col: "risk_limit_value", ddl: "ALTER TABLE trade_audit ADD COLUMN risk_limit_value REAL" },
      { col: "risk_observed_value", ddl: "ALTER TABLE trade_audit ADD COLUMN risk_observed_value REAL" },
      { col: "risk_result", ddl: "ALTER TABLE trade_audit ADD COLUMN risk_result TEXT" },
      { col: "reason_code", ddl: "ALTER TABLE trade_audit ADD COLUMN reason_code TEXT" },
      // Data integrity
      { col: "payload_json", ddl: "ALTER TABLE trade_audit ADD COLUMN payload_json TEXT" },
      { col: "prev_hash", ddl: "ALTER TABLE trade_audit ADD COLUMN prev_hash TEXT" },
      { col: "event_hash", ddl: "ALTER TABLE trade_audit ADD COLUMN event_hash TEXT" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }

    // Create additional indexes for institutional queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_audit_correlation ON trade_audit(correlation_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_audit_event_type ON trade_audit(event_type);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_audit_risk_result ON trade_audit(risk_result);`);
    
    console.log("Institutional audit columns ensured");
  } finally {
    db.close();
  }
}

// Order Intent Audit table for capturing RECEIVED and DECISION events
export function ensureOrderIntentAuditTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS order_intent_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        event_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        event_at_ms INTEGER,
        event_code TEXT NOT NULL,
        decision TEXT,
        reject_check TEXT,
        reject_reason TEXT,
        actor_type TEXT NOT NULL DEFAULT 'USER',
        user_id INTEGER NOT NULL,
        session_id TEXT,
        ip TEXT,
        user_agent TEXT,
        symbol TEXT,
        side TEXT,
        order_type TEXT,
        time_in_force TEXT,
        qty_lots REAL,
        requested_price REAL,
        limit_price REAL,
        stop_price REAL,
        take_profit REAL,
        stop_loss REAL,
        quote_bid REAL,
        quote_ask REAL,
        quote_mid REAL,
        quote_ts INTEGER,
        quote_is_stale INTEGER,
        risk_limit_json TEXT,
        risk_observed_json TEXT,
        risk_snapshot_json TEXT,
        payload_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL
      );
    `);
    
    db.exec(`CREATE INDEX IF NOT EXISTS idx_order_intent_correlation ON order_intent_audit(correlation_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_order_intent_user ON order_intent_audit(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_order_intent_event ON order_intent_audit(event_code);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_order_intent_decision ON order_intent_audit(decision);`);
    
    console.log("Order intent audit table ensured");
  } finally {
    db.close();
  }
}

export function ensureQuotesColumns() {
  const db = getDb();
  try {
    // Check if quotes table exists first
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='quotes'"
    ).get();
    
    if (!tableExists) {
      console.log("Quotes table does not exist yet, skipping column check");
      return;
    }

    const table = "quotes";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "is_stale", ddl: "ALTER TABLE quotes ADD COLUMN is_stale INTEGER DEFAULT 0" },
      { col: "last_api_update", ddl: "ALTER TABLE quotes ADD COLUMN last_api_update INTEGER" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
  } finally {
    db.close();
  }
}

export function ensureUserSettingsColumns() {
  const db = getDb();
  try {
    // Check if user_settings table exists first
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_settings'"
    ).get();
    
    if (!tableExists) {
      console.log("User settings table does not exist yet, skipping column check");
      return;
    }

    const table = "user_settings";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "max_concurrent_lots", ddl: "ALTER TABLE user_settings ADD COLUMN max_concurrent_lots INTEGER NOT NULL DEFAULT 50" },
      { col: "max_concurrent_per_instrument", ddl: "ALTER TABLE user_settings ADD COLUMN max_concurrent_per_instrument INTEGER" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
  } finally {
    db.close();
  }
}

export function ensureGlobalSettingsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS global_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        default_leverage REAL NOT NULL DEFAULT 50,
        max_position_size REAL NOT NULL DEFAULT 100000,
        max_trades_per_user INTEGER NOT NULL DEFAULT 5,
        max_trades_per_instrument INTEGER NOT NULL DEFAULT 3,
        max_concurrent_lots INTEGER NOT NULL DEFAULT 50,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);
    
    // Insert default row if not exists
    const existing = db.prepare("SELECT id FROM global_settings WHERE id = 1").get();
    if (!existing) {
      db.exec("INSERT INTO global_settings (id) VALUES (1)");
      console.log("Inserted default global settings row");
    }
    
    // Add new columns for Market Hours, Auto-Close, Loss Limits, and Market Data Settings
    const table = "global_settings";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "market_open_time", ddl: "ALTER TABLE global_settings ADD COLUMN market_open_time TEXT NOT NULL DEFAULT '09:00'" },
      { col: "market_close_time", ddl: "ALTER TABLE global_settings ADD COLUMN market_close_time TEXT NOT NULL DEFAULT '17:00'" },
      { col: "allow_weekend_trading", ddl: "ALTER TABLE global_settings ADD COLUMN allow_weekend_trading INTEGER NOT NULL DEFAULT 0" },
      { col: "enable_auto_close", ddl: "ALTER TABLE global_settings ADD COLUMN enable_auto_close INTEGER NOT NULL DEFAULT 1" },
      { col: "auto_close_after_days", ddl: "ALTER TABLE global_settings ADD COLUMN auto_close_after_days INTEGER NOT NULL DEFAULT 4" },
      { col: "auto_close_check_frequency_minutes", ddl: "ALTER TABLE global_settings ADD COLUMN auto_close_check_frequency_minutes INTEGER NOT NULL DEFAULT 60" },
      { col: "min_hold_sec", ddl: "ALTER TABLE global_settings ADD COLUMN min_hold_sec INTEGER NOT NULL DEFAULT 60" },
      { col: "enable_loss_limits", ddl: "ALTER TABLE global_settings ADD COLUMN enable_loss_limits INTEGER NOT NULL DEFAULT 1" },
      { col: "daily_loss_limit_pct", ddl: "ALTER TABLE global_settings ADD COLUMN daily_loss_limit_pct REAL NOT NULL DEFAULT 10" },
      { col: "lifetime_loss_limit_pct", ddl: "ALTER TABLE global_settings ADD COLUMN lifetime_loss_limit_pct REAL NOT NULL DEFAULT 20" },
      // Market Data & Quote Settings
      { col: "trading_halt", ddl: "ALTER TABLE global_settings ADD COLUMN trading_halt INTEGER NOT NULL DEFAULT 0" },
      { col: "close_only_mode", ddl: "ALTER TABLE global_settings ADD COLUMN close_only_mode INTEGER NOT NULL DEFAULT 0" },
      { col: "block_open_on_stale_quotes", ddl: "ALTER TABLE global_settings ADD COLUMN block_open_on_stale_quotes INTEGER NOT NULL DEFAULT 1" },
      { col: "maintenance_message", ddl: "ALTER TABLE global_settings ADD COLUMN maintenance_message TEXT DEFAULT 'System is under maintenance. Trading will resume shortly.'" },
      { col: "quote_refresh_ms", ddl: "ALTER TABLE global_settings ADD COLUMN quote_refresh_ms INTEGER NOT NULL DEFAULT 870" },
      { col: "feed_poll_ms", ddl: "ALTER TABLE global_settings ADD COLUMN feed_poll_ms INTEGER NOT NULL DEFAULT 870" },
      { col: "stale_threshold_ms", ddl: "ALTER TABLE global_settings ADD COLUMN stale_threshold_ms INTEGER NOT NULL DEFAULT 30000" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    
    console.log("Global settings table ensured");
  } finally {
    db.close();
  }
}

export function ensureUsersColumns() {
  const db = getDb();
  try {
    const table = "users";
    if (!hasTable(db, table)) {
      console.log("Users table does not exist yet, skipping users column ensure");
      return;
    }
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "is_disabled", ddl: "ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0" },
      { col: "deletion_exempt", ddl: "ALTER TABLE users ADD COLUMN deletion_exempt INTEGER NOT NULL DEFAULT 0" },
      { col: "is_deleted", ddl: "ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0" },
      { col: "inactivated_at", ddl: "ALTER TABLE users ADD COLUMN inactivated_at INTEGER" },
      { col: "deleted_at", ddl: "ALTER TABLE users ADD COLUMN deleted_at INTEGER" },
      { col: "deleted_mode", ddl: "ALTER TABLE users ADD COLUMN deleted_mode TEXT" },
      { col: "deleted_reason", ddl: "ALTER TABLE users ADD COLUMN deleted_reason TEXT" },
      { col: "deleted_by_admin_id", ddl: "ALTER TABLE users ADD COLUMN deleted_by_admin_id INTEGER" },
      { col: "is_frozen", ddl: "ALTER TABLE users ADD COLUMN is_frozen INTEGER NOT NULL DEFAULT 0" },
      { col: "freeze_reason_code", ddl: "ALTER TABLE users ADD COLUMN freeze_reason_code TEXT" },
      { col: "freeze_reason_text", ddl: "ALTER TABLE users ADD COLUMN freeze_reason_text TEXT" },
      { col: "frozen_at", ddl: "ALTER TABLE users ADD COLUMN frozen_at INTEGER" },
      { col: "frozen_by", ddl: "ALTER TABLE users ADD COLUMN frozen_by INTEGER" },
      { col: "name", ddl: "ALTER TABLE users ADD COLUMN name TEXT" },
      { col: "phone", ddl: "ALTER TABLE users ADD COLUMN phone TEXT" },
      // User preferences
      { col: "timezone", ddl: "ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT 'UTC'" },
      { col: "language", ddl: "ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'" },
      { col: "country", ddl: "ALTER TABLE users ADD COLUMN country TEXT" },
      // KYC compliance tracking
      { col: "kyc_status", ddl: "ALTER TABLE users ADD COLUMN kyc_status TEXT DEFAULT 'none'" },
      { col: "kyc_verified_at", ddl: "ALTER TABLE users ADD COLUMN kyc_verified_at INTEGER" },
      { col: "kyc_expires_at", ddl: "ALTER TABLE users ADD COLUMN kyc_expires_at INTEGER" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
  } finally {
    db.close();
  }
}

export function ensureUserLoginHistoryTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_login_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        failure_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_login_history_user_id_created_at ON user_login_history(user_id, created_at);`);
    console.log("User login history table ensured");
  } finally {
    db.close();
  }
}

export function ensureUserAccountEventsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_account_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        reason_code TEXT,
        reason_text TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (admin_id) REFERENCES users(id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_account_events_user_id_created_at ON user_account_events(user_id, created_at);`);
    console.log("User account events table ensured");
  } finally {
    db.close();
  }
}

export function ensureUserAdminNotesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_admin_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER,
        type TEXT NOT NULL DEFAULT 'NOTE',
        severity TEXT NOT NULL DEFAULT 'INFO',
        flag_code TEXT,
        content TEXT NOT NULL,
        is_resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER,
        resolved_by_admin_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (admin_id) REFERENCES users(id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_admin_notes_user_id ON user_admin_notes(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_admin_notes_created_at ON user_admin_notes(created_at);`);
    console.log("User admin notes table ensured");
  } finally {
    db.close();
  }
}

export function ensureLoginHistorySessionColumns() {
  const db = getDb();
  try {
    // Check if user_login_history table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_login_history'"
    ).get();
    
    if (!tableExists) {
      console.log("User login history table does not exist yet, skipping column check");
      return;
    }

    const table = "user_login_history";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "logout_at", ddl: "ALTER TABLE user_login_history ADD COLUMN logout_at INTEGER" },
      { col: "session_length_sec", ddl: "ALTER TABLE user_login_history ADD COLUMN session_length_sec INTEGER" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    console.log("Login history session columns ensured");
  } finally {
    db.close();
  }
}

export function ensureSystemConfigTable() {
  const db = getDb();
  try {
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
        migration_chunking_enabled INTEGER NOT NULL DEFAULT 0,
        migration_chunk_size_mb INTEGER NOT NULL DEFAULT 51200,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_by TEXT
      );
    `);
    
    // Insert default row if not exists
    const existing = db.prepare("SELECT id FROM system_config WHERE id = 1").get();
    if (!existing) {
      db.exec("INSERT INTO system_config (id) VALUES (1)");
      console.log("Inserted default system config row");
    }

    const table = "system_config";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "policy_contender_path1_min_age_days", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path1_min_age_days INTEGER NOT NULL DEFAULT 30" },
      { col: "policy_contender_path1_min_trades_lifetime", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path1_min_trades_lifetime INTEGER NOT NULL DEFAULT 30" },
      { col: "policy_contender_path1_min_balance_pct", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path1_min_balance_pct REAL NOT NULL DEFAULT 1.2" },
      { col: "policy_contender_path2_min_age_days", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path2_min_age_days INTEGER NOT NULL DEFAULT 90" },
      { col: "policy_contender_path2_min_trades_last90", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path2_min_trades_last90 INTEGER NOT NULL DEFAULT 20" },
      { col: "policy_contender_path2_min_return_last90", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path2_min_return_last90 REAL NOT NULL DEFAULT 0.1" },
      { col: "policy_contender_path2_max_days_since_last_trade", ddl: "ALTER TABLE system_config ADD COLUMN policy_contender_path2_max_days_since_last_trade INTEGER NOT NULL DEFAULT 14" },
      { col: "policy_auto_promote_performer", ddl: "ALTER TABLE system_config ADD COLUMN policy_auto_promote_performer INTEGER NOT NULL DEFAULT 1" },
      { col: "policy_email_resend_cooldown_sec", ddl: "ALTER TABLE system_config ADD COLUMN policy_email_resend_cooldown_sec INTEGER NOT NULL DEFAULT 60" },
      { col: "policy_email_daily_send_cap", ddl: "ALTER TABLE system_config ADD COLUMN policy_email_daily_send_cap INTEGER NOT NULL DEFAULT 5" },
      { col: "policy_sms_daily_send_cap", ddl: "ALTER TABLE system_config ADD COLUMN policy_sms_daily_send_cap INTEGER NOT NULL DEFAULT 5" },
      { col: "policy_sms_resend_cooldown_sec", ddl: "ALTER TABLE system_config ADD COLUMN policy_sms_resend_cooldown_sec INTEGER NOT NULL DEFAULT 60" },
      { col: "policy_otp_max_attempts", ddl: "ALTER TABLE system_config ADD COLUMN policy_otp_max_attempts INTEGER NOT NULL DEFAULT 5" },
      { col: "policy_otp_lock_minutes", ddl: "ALTER TABLE system_config ADD COLUMN policy_otp_lock_minutes INTEGER NOT NULL DEFAULT 30" },

      // Inactive users + bot activity
      { col: "inactivity_threshold_days", ddl: "ALTER TABLE system_config ADD COLUMN inactivity_threshold_days INTEGER NOT NULL DEFAULT 90" },
      { col: "deletion_grace_days", ddl: "ALTER TABLE system_config ADD COLUMN deletion_grace_days INTEGER NOT NULL DEFAULT 30" },
      { col: "activity_auto_queue_inactive", ddl: "ALTER TABLE system_config ADD COLUMN activity_auto_queue_inactive INTEGER NOT NULL DEFAULT 1" },
      { col: "activity_auto_soft_delete", ddl: "ALTER TABLE system_config ADD COLUMN activity_auto_soft_delete INTEGER NOT NULL DEFAULT 0" },
      { col: "bot_score_threshold", ddl: "ALTER TABLE system_config ADD COLUMN bot_score_threshold INTEGER NOT NULL DEFAULT 40" },
      { col: "bot_pow_enabled", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_enabled INTEGER NOT NULL DEFAULT 1" },
      { col: "bot_pow_enforce_signup", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_enforce_signup INTEGER NOT NULL DEFAULT 1" },
      { col: "bot_pow_enforce_login", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_enforce_login INTEGER NOT NULL DEFAULT 0" },
      { col: "bot_pow_challenge_score", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_challenge_score INTEGER NOT NULL DEFAULT 25" },
      { col: "bot_pow_base_difficulty", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_base_difficulty INTEGER NOT NULL DEFAULT 14" },
      { col: "bot_pow_max_difficulty", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_max_difficulty INTEGER NOT NULL DEFAULT 20" },
      { col: "bot_pow_ttl_sec", ddl: "ALTER TABLE system_config ADD COLUMN bot_pow_ttl_sec INTEGER NOT NULL DEFAULT 120" },
      { col: "bot_valkey_enabled", ddl: "ALTER TABLE system_config ADD COLUMN bot_valkey_enabled INTEGER NOT NULL DEFAULT 1" },
      { col: "fx_rollover_tz", ddl: "ALTER TABLE system_config ADD COLUMN fx_rollover_tz TEXT NOT NULL DEFAULT 'America/New_York'" },
      { col: "fx_rollover_time", ddl: "ALTER TABLE system_config ADD COLUMN fx_rollover_time TEXT NOT NULL DEFAULT '17:00'" },
      { col: "migration_chunking_enabled", ddl: "ALTER TABLE system_config ADD COLUMN migration_chunking_enabled INTEGER NOT NULL DEFAULT 0" },
      { col: "migration_chunk_size_mb", ddl: "ALTER TABLE system_config ADD COLUMN migration_chunk_size_mb INTEGER NOT NULL DEFAULT 51200" },
    ];
    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    
    console.log("System config table ensured");
  } finally {
    db.close();
  }
}

export function ensureMarketDailyCloseTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_daily_close (
        symbol TEXT NOT NULL,
        session_day TEXT NOT NULL,
        close REAL NOT NULL,
        close_ts_ms INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (symbol, session_day)
      );
    `);
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_mdc_symbol_day ON market_daily_close(symbol, session_day);"
    );
    console.log("Market daily close table ensured");
  } finally {
    db.close();
  }
}

export function ensureTraderJournalTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS trader_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        trade_id INTEGER,
        note TEXT NOT NULL,
        mood TEXT,
        tags TEXT,
        attachment_url TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trader_journal_user_id ON trader_journal(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trader_journal_created_at ON trader_journal(created_at);`);
    
    // Add trade_ids column for multi-trade linking (migration)
    const table = "trader_journal";
    if (!hasColumn(db, table, "trade_ids")) {
      db.exec("ALTER TABLE trader_journal ADD COLUMN trade_ids TEXT");
      console.log("Added trade_ids column to trader_journal");
    }
    
    console.log("Trader journal table ensured");
  } finally {
    db.close();
  }
}

export function ensureAdminActionsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        metadata TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id ON admin_actions(admin_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_actions_user_id ON admin_actions(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type ON admin_actions(action_type);`);
    console.log("Admin actions table ensured");
  } finally {
    db.close();
  }
}

export function ensureUserSessionsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        device_type TEXT,
        browser TEXT,
        os TEXT,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_active_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);`);
    console.log("User sessions table ensured");
  } finally {
    db.close();
  }
}

export function ensureUserSessionIdentityColumns() {
  const db = getDb();
  try {
    const table = "user_sessions";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "device_fp", ddl: `ALTER TABLE ${table} ADD COLUMN device_fp TEXT` },
      { col: "device_install_id", ddl: `ALTER TABLE ${table} ADD COLUMN device_install_id TEXT` },
      { col: "client_tz", ddl: `ALTER TABLE ${table} ADD COLUMN client_tz TEXT` },
      { col: "client_lang", ddl: `ALTER TABLE ${table} ADD COLUMN client_lang TEXT` },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_device_fp ON user_sessions(device_fp);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_device_install_id ON user_sessions(device_install_id);`);
    console.log("User sessions identity columns ensured");
  } finally {
    db.close();
  }
}

export function ensureUserSessionGeoColumns() {
  const db = getDb();
  try {
    const table = "user_sessions";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "country_code", ddl: `ALTER TABLE ${table} ADD COLUMN country_code TEXT` },
      { col: "region", ddl: `ALTER TABLE ${table} ADD COLUMN region TEXT` },
      { col: "city", ddl: `ALTER TABLE ${table} ADD COLUMN city TEXT` },
      { col: "latitude", ddl: `ALTER TABLE ${table} ADD COLUMN latitude REAL` },
      { col: "longitude", ddl: `ALTER TABLE ${table} ADD COLUMN longitude REAL` },
      { col: "inferred_tz", ddl: `ALTER TABLE ${table} ADD COLUMN inferred_tz TEXT` },
      { col: "revoked_at", ddl: `ALTER TABLE ${table} ADD COLUMN revoked_at INTEGER` },
      { col: "revoked_by_user_id", ddl: `ALTER TABLE ${table} ADD COLUMN revoked_by_user_id INTEGER` },
      { col: "revoke_reason", ddl: `ALTER TABLE ${table} ADD COLUMN revoke_reason TEXT` },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    console.log("User sessions geo columns ensured");
  } finally {
    db.close();
  }
}

export function ensureLoginHistoryIdentityColumns() {
  const db = getDb();
  try {
    const table = "user_login_history";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "device_fp", ddl: `ALTER TABLE ${table} ADD COLUMN device_fp TEXT` },
      { col: "device_install_id", ddl: `ALTER TABLE ${table} ADD COLUMN device_install_id TEXT` },
      { col: "client_tz", ddl: `ALTER TABLE ${table} ADD COLUMN client_tz TEXT` },
      { col: "client_lang", ddl: `ALTER TABLE ${table} ADD COLUMN client_lang TEXT` },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_device_fp ON user_login_history(device_fp);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_login_history_device_install_id ON user_login_history(device_install_id);`);
    console.log("Login history identity columns ensured");
  } finally {
    db.close();
  }
}

export function ensureLoginHistoryGeoColumns() {
  const db = getDb();
  try {
    const table = "user_login_history";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "country_code", ddl: `ALTER TABLE ${table} ADD COLUMN country_code TEXT` },
      { col: "region", ddl: `ALTER TABLE ${table} ADD COLUMN region TEXT` },
      { col: "city", ddl: `ALTER TABLE ${table} ADD COLUMN city TEXT` },
      { col: "latitude", ddl: `ALTER TABLE ${table} ADD COLUMN latitude REAL` },
      { col: "longitude", ddl: `ALTER TABLE ${table} ADD COLUMN longitude REAL` },
      { col: "session_id", ddl: `ALTER TABLE ${table} ADD COLUMN session_id TEXT` },
      { col: "event_type", ddl: `ALTER TABLE ${table} ADD COLUMN event_type TEXT DEFAULT 'LOGIN_SUCCESS'` },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    console.log("Login history geo columns ensured");
  } finally {
    db.close();
  }
}

// Phase 1: Add provenance columns to trades table for correlation and actor tracking
export function ensureTradesProvenanceColumns() {
  const db = getDb();
  try {
    const table = "trades";
    if (!hasTable(db, table)) {
      console.log("Trades table does not exist yet, skipping provenance columns");
      return;
    }
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "correlation_id", ddl: "ALTER TABLE trades ADD COLUMN correlation_id TEXT" },
      { col: "order_id", ddl: "ALTER TABLE trades ADD COLUMN order_id TEXT" },
      { col: "position_id", ddl: "ALTER TABLE trades ADD COLUMN position_id TEXT" },
      { col: "last_execution_id", ddl: "ALTER TABLE trades ADD COLUMN last_execution_id TEXT" },
      { col: "last_actor_user_id", ddl: "ALTER TABLE trades ADD COLUMN last_actor_user_id INTEGER" },
      { col: "last_actor_session_id", ddl: "ALTER TABLE trades ADD COLUMN last_actor_session_id TEXT" },
      { col: "last_actor_ip", ddl: "ALTER TABLE trades ADD COLUMN last_actor_ip TEXT" },
      { col: "last_actor_user_agent", ddl: "ALTER TABLE trades ADD COLUMN last_actor_user_agent TEXT" },
      { col: "last_actor_type", ddl: "ALTER TABLE trades ADD COLUMN last_actor_type TEXT DEFAULT 'USER'" },
      { col: "last_actor_device_id", ddl: "ALTER TABLE trades ADD COLUMN last_actor_device_id TEXT" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    
    // Backfill legacy rows with stable identifiers (best-effort)
    try {
      db.exec(`
        UPDATE trades
        SET
          correlation_id = COALESCE(correlation_id, 'COR-LEGACY-' || id),
          order_id = COALESCE(order_id, 'ORD-LEGACY-' || id),
          position_id = COALESCE(position_id, 'POS-LEGACY-' || id)
        WHERE correlation_id IS NULL OR order_id IS NULL OR position_id IS NULL
      `);
    } catch (e) {
      console.warn("Trades ID backfill skipped:", e);
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_correlation_id ON trades(correlation_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_order_id ON trades(order_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades(position_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_last_execution_id ON trades(last_execution_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_device_id ON trades(last_actor_device_id);`);
    console.log("Trades provenance columns ensured");
  } finally {
    db.close();
  }
}

// Audit export manifest table for allocator exports with integrity hashes
export function ensureAuditExportManifestTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_export_manifest (
        export_id TEXT PRIMARY KEY,
        exported_at_utc_ms INTEGER NOT NULL,
        export_type TEXT NOT NULL,
        export_format TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_aem_type_time ON audit_export_manifest(export_type, exported_at_utc_ms);`);
    console.log("Audit export manifest table ensured");
  } finally {
    db.close();
  }
}

// Migration tables for platform backup/import jobs
export function ensureMigrationTables() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_export_jobs (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        user_id INTEGER,
        since_ts INTEGER,
        requested_by_admin_id INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        totals_json TEXT NOT NULL DEFAULT '{}',
        manifest_json TEXT NOT NULL DEFAULT '{}',
        data_parts_json TEXT,
        chunking_enabled INTEGER,
        chunk_size_mb INTEGER,
        manifest_sha256 TEXT,
        data_sha256 TEXT,
        data_path TEXT,
        manifest_path TEXT,
        error TEXT
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_import_jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        id_strategy TEXT NOT NULL DEFAULT 'PRESERVE',
        requested_by_admin_id INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        manifest_sha256 TEXT,
        data_sha256 TEXT,
        data_parts_json TEXT,
        data_path TEXT,
        manifest_path TEXT,
        totals_json TEXT NOT NULL DEFAULT '{}',
        error TEXT
      );
    `);

    const exportAdds: Array<{ col: string; ddl: string }> = [
      { col: "data_parts_json", ddl: "ALTER TABLE migration_export_jobs ADD COLUMN data_parts_json TEXT" },
      { col: "chunking_enabled", ddl: "ALTER TABLE migration_export_jobs ADD COLUMN chunking_enabled INTEGER" },
      { col: "chunk_size_mb", ddl: "ALTER TABLE migration_export_jobs ADD COLUMN chunk_size_mb INTEGER" },
    ];
    for (const a of exportAdds) {
      if (!hasColumn(db, "migration_export_jobs", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to migration_export_jobs`);
      }
    }

    const importAdds: Array<{ col: string; ddl: string }> = [
      { col: "requested_by_admin_id", ddl: "ALTER TABLE migration_import_jobs ADD COLUMN requested_by_admin_id INTEGER" },
      { col: "data_path", ddl: "ALTER TABLE migration_import_jobs ADD COLUMN data_path TEXT" },
      { col: "manifest_path", ddl: "ALTER TABLE migration_import_jobs ADD COLUMN manifest_path TEXT" },
      { col: "data_parts_json", ddl: "ALTER TABLE migration_import_jobs ADD COLUMN data_parts_json TEXT" },
    ];
    for (const a of importAdds) {
      if (!hasColumn(db, "migration_import_jobs", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to migration_import_jobs`);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}'
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_id_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        new_id TEXT NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS migration_integrity_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        chain_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        failure_reason TEXT,
        verified_at INTEGER NOT NULL
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_export_jobs_created_at ON migration_export_jobs(created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_export_jobs_status ON migration_export_jobs(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_import_jobs_created_at ON migration_import_jobs(created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_import_jobs_status ON migration_import_jobs(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_job_logs_job_id ON migration_job_logs(job_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_id_map_job_id ON migration_id_map(job_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_migration_integrity_job_id ON migration_integrity_checks(job_id);`);

    console.log("Migration tables ensured");
  } finally {
    db.close();
  }
}

// =========================
// Tiered Access System Tables
// =========================

// Add new columns to users table for tiered access
export function ensureUserTierColumns() {
  const db = getDb();
  try {
    const table = "users";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "first_name", ddl: "ALTER TABLE users ADD COLUMN first_name TEXT" },
      { col: "last_name", ddl: "ALTER TABLE users ADD COLUMN last_name TEXT" },
      { col: "display_name", ddl: "ALTER TABLE users ADD COLUMN display_name TEXT" },
      { col: "starting_equity", ddl: "ALTER TABLE users ADD COLUMN starting_equity REAL DEFAULT 1000000" },
      { col: "user_tier", ddl: "ALTER TABLE users ADD COLUMN user_tier TEXT NOT NULL DEFAULT 'CANDIDATE'" },
      { col: "tier_promoted_at", ddl: "ALTER TABLE users ADD COLUMN tier_promoted_at INTEGER" },
      { col: "tier_promoted_by", ddl: "ALTER TABLE users ADD COLUMN tier_promoted_by INTEGER" },
      { col: "selected_at", ddl: "ALTER TABLE users ADD COLUMN selected_at INTEGER" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }
    console.log("User tier columns ensured");
  } finally {
    db.close();
  }
}

// User verification status and rate limiting
export function ensureUserVerificationTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_verification (
        user_id INTEGER PRIMARY KEY NOT NULL,
        email_verified_at INTEGER,
        email_initial_due_at INTEGER,
        email_reverify_due_at INTEGER,
        email_resend_day_key TEXT,
        email_resend_count_day INTEGER DEFAULT 0,
        email_last_resend_at INTEGER,
        email_resend_day_start INTEGER,
        phone_e164 TEXT,
        sms_verified_at INTEGER,
        sms_send_day_key TEXT,
        sms_send_count_day INTEGER DEFAULT 0,
        sms_last_sent_at INTEGER,
        sms_last_send_at INTEGER,
        sms_send_day_start INTEGER,
        sms_verify_fail_count INTEGER DEFAULT 0,
        sms_enabled INTEGER DEFAULT 0,
        contender_tier TEXT NOT NULL DEFAULT 'NONE',
        contender_eligible_at INTEGER,
        locked_at INTEGER,
        lock_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    console.log("User verification table ensured");
  } finally {
    db.close();
  }
}

export function ensureVerificationThrottleColumns() {
  const db = getDb();
  try {
    const columns = [
      'email_last_resend_at',
      'email_resend_count_day', 
      'email_resend_day_start',
      'sms_last_send_at',
      'sms_send_count_day',
      'sms_send_day_start'
    ];
    const tableInfo = db.prepare("PRAGMA table_info(user_verification)").all() as any[];
    const existingColumns = tableInfo.map((c: any) => c.name);
    
    for (const col of columns) {
      if (!existingColumns.includes(col)) {
        const defaultVal = col.includes('count') ? ' DEFAULT 0' : '';
        db.prepare(`ALTER TABLE user_verification ADD COLUMN ${col} INTEGER${defaultVal}`).run();
        console.log(`Added ${col} column to user_verification`);
      }
    }
    console.log("Verification throttle columns ensured");
  } finally {
    db.close();
  }
}

// Add policy snapshot columns to user_verification table
export function ensureUserVerificationPolicyColumns() {
  const db = getDb();
  try {
    const table = "user_verification";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "email_initial_due_at", ddl: "ALTER TABLE user_verification ADD COLUMN email_initial_due_at INTEGER" },
      { col: "locked_at", ddl: "ALTER TABLE user_verification ADD COLUMN locked_at INTEGER" },
      { col: "lock_reason", ddl: "ALTER TABLE user_verification ADD COLUMN lock_reason TEXT" },
    ];
    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to user_verification`);
      }
    }
    console.log("User verification policy columns ensured");
  } finally {
    db.close();
  }
}

// Email verification tokens
export function ensureEmailVerificationTokensTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'VERIFY',
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_evt_token ON email_verification_tokens(token_hash);`);
    console.log("Email verification tokens table ensured");
  } finally {
    db.close();
  }
}

// SMS OTP tokens (hashed)
export function ensureSmsOtpTokensTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sms_otp_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        phone_e164 TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_otp_user ON sms_otp_tokens(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_otp_phone ON sms_otp_tokens(phone_e164);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_otp_expires ON sms_otp_tokens(expires_at);`);
    console.log("SMS OTP tokens table ensured");
  } finally {
    db.close();
  }
}

// Daily equity snapshots for deterministic returns
export function ensureUserEquityDailyTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_equity_daily (
        user_id INTEGER NOT NULL,
        day_key TEXT NOT NULL,
        equity REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (user_id, day_key)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_equity_daily_user ON user_equity_daily(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_equity_daily_day ON user_equity_daily(day_key);`);
    console.log("User equity daily table ensured");
  } finally {
    db.close();
  }
}

// MFA (TOTP) configuration
export function ensureUserMfaTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_mfa (
        user_id INTEGER PRIMARY KEY NOT NULL,
        totp_secret_enc TEXT,
        totp_pending_secret_enc TEXT,
        recovery_codes_hash_json TEXT,
        recovery_codes_used_json TEXT,
        enabled_at INTEGER,
        disabled_at INTEGER,
        last_verified_at INTEGER,
        failed_attempts INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    console.log("User MFA table ensured");
  } finally {
    db.close();
  }
}

// KYC profiles (invite-based)
export function ensureUserKycProfilesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_kyc_profiles (
        user_id INTEGER PRIMARY KEY NOT NULL,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED',
        invited_at INTEGER,
        invited_by_admin_id INTEGER,
        invite_note TEXT,
        submitted_at INTEGER,
        document_type TEXT,
        document_number TEXT,
        legal_first_name TEXT,
        legal_last_name TEXT,
        dob TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        city TEXT,
        region TEXT,
        postal_code TEXT,
        country TEXT,
        id_document_ref TEXT,
        reviewed_at INTEGER,
        reviewed_by_admin_id INTEGER,
        reviewer_note TEXT,
        rejection_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);

    const adds: Array<{ col: string; ddl: string }> = [
      { col: "legal_first_name", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN legal_first_name TEXT;" },
      { col: "legal_last_name", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN legal_last_name TEXT;" },
      { col: "dob", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN dob TEXT;" },
      { col: "address_line1", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN address_line1 TEXT;" },
      { col: "address_line2", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN address_line2 TEXT;" },
      { col: "city", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN city TEXT;" },
      { col: "region", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN region TEXT;" },
      { col: "postal_code", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN postal_code TEXT;" },
      { col: "country", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN country TEXT;" },
      { col: "id_document_ref", ddl: "ALTER TABLE user_kyc_profiles ADD COLUMN id_document_ref TEXT;" },
    ];
    for (const a of adds) {
      if (!hasColumn(db, "user_kyc_profiles", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to user_kyc_profiles`);
      }
    }
    console.log("User KYC profiles table ensured");
  } finally {
    db.close();
  }
}

// Payout profiles (gated to Selected tier)
export function ensureUserPayoutProfilesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_payout_profiles (
        user_id INTEGER PRIMARY KEY NOT NULL,
        preferred_payment_currency TEXT DEFAULT 'USD',
        payout_method TEXT,
        payout_details_json TEXT,
        is_verified INTEGER DEFAULT 0,
        verified_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    console.log("User payout profiles table ensured");
  } finally {
    db.close();
  }
}

// Identity audit trail (hash-chained for tamper evidence)
export function ensureIdentityAuditTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS identity_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        user_id INTEGER,
        email TEXT,
        username TEXT,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        description TEXT,
        ip TEXT,
        user_agent TEXT,
        actor_admin_id INTEGER,
        actor_type TEXT,
        actor_user_id INTEGER,
        session_id TEXT,
        correlation_id TEXT,
        data_json TEXT,
        prev_hash TEXT,
        event_hash TEXT NOT NULL
      );
    `);
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "actor_type", ddl: "ALTER TABLE identity_audit ADD COLUMN actor_type TEXT" },
      { col: "actor_user_id", ddl: "ALTER TABLE identity_audit ADD COLUMN actor_user_id INTEGER" },
      { col: "session_id", ddl: "ALTER TABLE identity_audit ADD COLUMN session_id TEXT" },
      { col: "correlation_id", ddl: "ALTER TABLE identity_audit ADD COLUMN correlation_id TEXT" },
      { col: "data_json", ddl: "ALTER TABLE identity_audit ADD COLUMN data_json TEXT" },
    ];
    for (const a of adds) {
      if (!hasColumn(db, "identity_audit", a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to identity_audit`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_audit_user ON identity_audit(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_audit_category ON identity_audit(category);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_audit_type ON identity_audit(type);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_audit_at ON identity_audit(at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_identity_audit_correlation ON identity_audit(correlation_id);`);
    console.log("Identity audit table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Identity links (device fingerprints, IPs, payment info)
export function ensureGriftIdentityLinksTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_identity_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_value TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_identity_user ON grift_identity_links(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_identity_type_value ON grift_identity_links(link_type, link_value);`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_identity_unique ON grift_identity_links(user_id, link_type, link_value);`);
    console.log("Grift identity links table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Alerts generated by rules engine
export function ensureGriftAlertsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        rule_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        score INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        details_json TEXT,
        related_user_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        reviewed_at INTEGER,
        reviewed_by INTEGER,
        resolution_note TEXT
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_alerts_user ON grift_alerts(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_alerts_status ON grift_alerts(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_alerts_severity ON grift_alerts(severity);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_alerts_created ON grift_alerts(created_at);`);
    console.log("Grift alerts table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Aggregated user risk scores
export function ensureGriftUserRiskTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_user_risk (
        user_id INTEGER PRIMARY KEY NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        risk_factors_json TEXT,
        last_evaluated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        manual_override TEXT,
        override_by INTEGER,
        override_at INTEGER,
        override_reason TEXT
      );
    `);
    // Add enforcement-related columns
    const enforceCols = [
      "ALTER TABLE grift_user_risk ADD COLUMN enforcement_status TEXT DEFAULT 'ACTIVE'",
      "ALTER TABLE grift_user_risk ADD COLUMN enforcement_at INTEGER",
      "ALTER TABLE grift_user_risk ADD COLUMN enforcement_by INTEGER",
      "ALTER TABLE grift_user_risk ADD COLUMN enforcement_reason TEXT",
    ];
    for (const sql of enforceCols) {
      try { db.exec(sql); } catch (e) { /* column exists */ }
    }
    console.log("Grift user risk table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Enforcement action log
export function ensureGriftEnforcementLogTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_enforcement_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_status TEXT,
        new_status TEXT,
        admin_id INTEGER,
        reason TEXT,
        risk_score_at_action INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_enforcement_user ON grift_enforcement_log(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_enforcement_action ON grift_enforcement_log(action);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_enforcement_created ON grift_enforcement_log(created_at);`);
    console.log("Grift enforcement log table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Linked account edges (graph relationships)
export function ensureGriftLinkedAccountEdgesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_linked_account_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a INTEGER NOT NULL,
        user_b INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_value TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        first_linked_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_confirmed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata_json TEXT
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_edges_user_a ON grift_linked_account_edges(user_a);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_edges_user_b ON grift_linked_account_edges(user_b);`);
    // Unique edge per (pair, type, value) so multiple devices/IPs can link the same pair without overwriting.
    db.exec(`DROP INDEX IF EXISTS idx_grift_edges_unique;`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_edges_unique ON grift_linked_account_edges(user_a, user_b, link_type, link_value);`
    );
    console.log("Grift linked account edges table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Admin-editable configuration table with defaults
export function ensureGriftConfigTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        multi_account_window_days INTEGER NOT NULL DEFAULT 30,
        churn_window_hours INTEGER NOT NULL DEFAULT 24,
        hedge_window_minutes INTEGER NOT NULL DEFAULT 10,
        concurrent_window_minutes INTEGER NOT NULL DEFAULT 15,
        ip_unique_threshold INTEGER NOT NULL DEFAULT 4,
        ua_unique_threshold INTEGER NOT NULL DEFAULT 3,
        device_unique_threshold INTEGER NOT NULL DEFAULT 3,
        asn_unique_threshold INTEGER NOT NULL DEFAULT 3,
        geo_velocity_kmh_threshold INTEGER NOT NULL DEFAULT 900,
        geo_velocity_min_distance_km INTEGER NOT NULL DEFAULT 800,
        geo_velocity_max_hours INTEGER NOT NULL DEFAULT 6,
        hedge_require_device_match INTEGER NOT NULL DEFAULT 1,
        hedge_allow_ip_match INTEGER NOT NULL DEFAULT 1,
        tier_med INTEGER NOT NULL DEFAULT 40,
        tier_high INTEGER NOT NULL DEFAULT 60,
        tier_critical INTEGER NOT NULL DEFAULT 80,
        score_multi_account_device INTEGER NOT NULL DEFAULT 35,
        score_multi_account_fingerprint INTEGER NOT NULL DEFAULT 25,
        score_hedge_pair INTEGER NOT NULL DEFAULT 55,
        score_ip_churn INTEGER NOT NULL DEFAULT 20,
        score_ua_churn INTEGER NOT NULL DEFAULT 15,
        score_device_churn INTEGER NOT NULL DEFAULT 20,
        score_geo_velocity INTEGER NOT NULL DEFAULT 30,
        score_concurrent_sessions INTEGER NOT NULL DEFAULT 25,
        score_asn_volatility INTEGER NOT NULL DEFAULT 15,
        score_shared_ip_asn_cluster INTEGER NOT NULL DEFAULT 40,
        score_multi_account_laddering INTEGER NOT NULL DEFAULT 50,
        cluster_min_users_for_ip_asn INTEGER NOT NULL DEFAULT 3,
        laddering_window_days INTEGER NOT NULL DEFAULT 7,
        laddering_min_sequence INTEGER NOT NULL DEFAULT 3,
        retention_observations_days INTEGER NOT NULL DEFAULT 180,
        retention_trade_observations_days INTEGER NOT NULL DEFAULT 180,
        retention_auth_events_days INTEGER NOT NULL DEFAULT 180,
        retention_ip_asn_cache_days INTEGER NOT NULL DEFAULT 365,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_by_admin_id INTEGER
      );
    `);
    // Seed default config if not exists
    db.exec(`INSERT OR IGNORE INTO grift_config (id) VALUES (1);`);
    // Add new columns for existing tables
    const cols = [
      "ALTER TABLE grift_config ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE grift_config ADD COLUMN concurrent_window_minutes INTEGER NOT NULL DEFAULT 15",
      "ALTER TABLE grift_config ADD COLUMN asn_unique_threshold INTEGER NOT NULL DEFAULT 3",
      "ALTER TABLE grift_config ADD COLUMN hedge_require_device_match INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE grift_config ADD COLUMN hedge_allow_ip_match INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE grift_config ADD COLUMN tier_med INTEGER NOT NULL DEFAULT 40",
      "ALTER TABLE grift_config ADD COLUMN tier_high INTEGER NOT NULL DEFAULT 60",
      "ALTER TABLE grift_config ADD COLUMN tier_critical INTEGER NOT NULL DEFAULT 80",
      "ALTER TABLE grift_config ADD COLUMN score_multi_account_fingerprint INTEGER NOT NULL DEFAULT 25",
      "ALTER TABLE grift_config ADD COLUMN score_hedge_pair INTEGER NOT NULL DEFAULT 55",
      "ALTER TABLE grift_config ADD COLUMN score_geo_velocity INTEGER NOT NULL DEFAULT 30",
      "ALTER TABLE grift_config ADD COLUMN score_concurrent_sessions INTEGER NOT NULL DEFAULT 25",
      "ALTER TABLE grift_config ADD COLUMN score_asn_volatility INTEGER NOT NULL DEFAULT 15",
      "ALTER TABLE grift_config ADD COLUMN score_shared_ip_asn_cluster INTEGER NOT NULL DEFAULT 40",
      "ALTER TABLE grift_config ADD COLUMN score_multi_account_laddering INTEGER NOT NULL DEFAULT 50",
      "ALTER TABLE grift_config ADD COLUMN cluster_min_users_for_ip_asn INTEGER NOT NULL DEFAULT 3",
      "ALTER TABLE grift_config ADD COLUMN laddering_window_days INTEGER NOT NULL DEFAULT 7",
      "ALTER TABLE grift_config ADD COLUMN laddering_min_sequence INTEGER NOT NULL DEFAULT 3",
      // MFA/KYC mitigation columns
      "ALTER TABLE grift_config ADD COLUMN mitigation_mfa INTEGER NOT NULL DEFAULT 10",
      "ALTER TABLE grift_config ADD COLUMN mitigation_kyc_approved INTEGER NOT NULL DEFAULT 15",
      // Enforcement threshold columns
      "ALTER TABLE grift_config ADD COLUMN enforcement_freeze_threshold INTEGER NOT NULL DEFAULT 80",
      "ALTER TABLE grift_config ADD COLUMN enforcement_disable_threshold INTEGER NOT NULL DEFAULT 100",
      "ALTER TABLE grift_config ADD COLUMN enforcement_auto_freeze INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_config ADD COLUMN enforcement_auto_disable INTEGER NOT NULL DEFAULT 0",
      // Retention controls (telemetry pruning)
      "ALTER TABLE grift_config ADD COLUMN retention_observations_days INTEGER NOT NULL DEFAULT 180",
      "ALTER TABLE grift_config ADD COLUMN retention_trade_observations_days INTEGER NOT NULL DEFAULT 180",
      "ALTER TABLE grift_config ADD COLUMN retention_auth_events_days INTEGER NOT NULL DEFAULT 180",
      "ALTER TABLE grift_config ADD COLUMN retention_ip_asn_cache_days INTEGER NOT NULL DEFAULT 365",
    ];
    for (const sql of cols) {
      try { db.exec(sql); } catch (e) { /* column exists */ }
    }

    // Normalize legacy seconds-based updated_at to ms for audit consistency.
    try {
      const row = db.prepare(`SELECT updated_at as updatedAt FROM grift_config WHERE id = 1`).get() as
        | { updatedAt?: number | null }
        | undefined;
      const updatedAt = Number(row?.updatedAt ?? 0);
      if (Number.isFinite(updatedAt) && updatedAt > 0 && updatedAt < 1e12) {
        db.prepare(`UPDATE grift_config SET updated_at = ? WHERE id = 1`).run(updatedAt * 1000);
      }
    } catch {
      // ignore
    }
    console.log("Grift config table ensured with defaults");
  } finally {
    db.close();
  }
}

// Grift detection: Device rollups
export function ensureGriftDevicesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_devices (
        device_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        first_ip TEXT,
        first_geo_country TEXT,
        trust_level TEXT NOT NULL DEFAULT 'NEW',
        users_count INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );
    `);
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_devices_trust ON grift_devices(trust_level);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_devices_users_count ON grift_devices(users_count);`);
    } catch (e) {
      // Schema mismatch - table exists with different structure
    }
    console.log("Grift devices table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Device-to-user link graph
export function ensureGriftDeviceUsersTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_device_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        seen_count INTEGER NOT NULL DEFAULT 1,
        link_strength REAL NOT NULL DEFAULT 1.0
      );
    `);
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_device_users_device ON grift_device_users(device_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_device_users_user ON grift_device_users(user_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_device_users_device_seen ON grift_device_users(device_id, last_seen_at);`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_device_users_unique ON grift_device_users(device_id, user_id);`);
    } catch (e) {
      // Schema mismatch - table exists with different structure
    }
    console.log("Grift device users table ensured");
  } finally {
    db.close();
  }
}

// Grift detection: Open/closed signals (individual rule triggers)
export function ensureGriftSignalsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        rule_code TEXT NOT NULL,
        dedupe_key TEXT,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        points INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'OPEN',
        evidence_json TEXT,
        related_user_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        closed_at INTEGER,
        closed_by_admin_id INTEGER,
        closure_note TEXT
      );
    `);
    // Add missing columns for full spec compliance
    const signalCols = [
      "ALTER TABLE grift_signals ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))",
      "ALTER TABLE grift_signals ADD COLUMN device_id TEXT",
      "ALTER TABLE grift_signals ADD COLUMN device_fp TEXT",
      "ALTER TABLE grift_signals ADD COLUMN device_install_id TEXT",
      "ALTER TABLE grift_signals ADD COLUMN client_tz TEXT",
      "ALTER TABLE grift_signals ADD COLUMN client_lang TEXT",
      "ALTER TABLE grift_signals ADD COLUMN ip TEXT",
      "ALTER TABLE grift_signals ADD COLUMN user_agent TEXT",
      "ALTER TABLE grift_signals ADD COLUMN geo_country TEXT",
      "ALTER TABLE grift_signals ADD COLUMN geo_region TEXT",
      "ALTER TABLE grift_signals ADD COLUMN geo_city TEXT",
      "ALTER TABLE grift_signals ADD COLUMN latitude REAL",
      "ALTER TABLE grift_signals ADD COLUMN longitude REAL",
      "ALTER TABLE grift_signals ADD COLUMN asn INTEGER",
      "ALTER TABLE grift_signals ADD COLUMN org TEXT",
      "ALTER TABLE grift_signals ADD COLUMN symbol TEXT",
      "ALTER TABLE grift_signals ADD COLUMN trade_id INTEGER",
    ];
    for (const sql of signalCols) {
      try { db.exec(sql); } catch (e) { /* column exists */ }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_user ON grift_signals(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_status ON grift_signals(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_rule ON grift_signals(rule_code);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_user_created ON grift_signals(user_id, created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_related_user ON grift_signals(related_user_id, created_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_signals_rule_created ON grift_signals(rule_code, created_at);`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_signals_dedupe ON grift_signals(dedupe_key);`);
    console.log("Grift signals table ensured");
  } finally {
    db.close();
  }
}

// Grift observations (login telemetry)
export function ensureGriftObservationsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'SESSION_PING',
        session_id TEXT,
        device_id TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        client_tz TEXT,
        client_lang TEXT,
        ip TEXT,
        user_agent TEXT,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        observed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
    // Add event_type column if missing
    try { db.exec(`ALTER TABLE grift_observations ADD COLUMN event_type TEXT NOT NULL DEFAULT 'SESSION_PING'`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_observations ADD COLUMN device_fp TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_observations ADD COLUMN device_install_id TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_observations ADD COLUMN client_tz TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_observations ADD COLUMN client_lang TEXT`); } catch (e) {}
    // Performance indices per spec
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_user ON grift_observations(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_device ON grift_observations(device_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_ip ON grift_observations(ip);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_user_ts ON grift_observations(user_id, observed_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_ip_ts ON grift_observations(ip, observed_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_device_ts ON grift_observations(device_id, observed_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_obs_observed ON grift_observations(observed_at);`);
    console.log("Grift observations table ensured");
  } finally {
    db.close();
  }
}

// Grift cases (investigation workflow)
export function ensureGriftCasesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        created_by_admin_id INTEGER,
        assigned_admin_id INTEGER,
        resolution TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        closed_at INTEGER
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_case_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        signal_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(case_id, signal_id)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_case_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_case_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_id INTEGER NOT NULL,
        added_by_admin_id INTEGER,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(case_id, link_type, link_id)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_case_links_case ON grift_case_links(case_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_case_links_type ON grift_case_links(link_type, link_id);`);
    console.log("Grift cases tables ensured");
  } finally {
    db.close();
  }
}

// Grift admin audit trail (tamper-evident)
export function ensureGriftAdminActionsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        payload_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        prev_hash TEXT,
        hash TEXT
      );
    `);
    console.log("Grift admin actions table ensured");
  } finally {
    db.close();
  }
}

// Grift user scores (aggregated risk)
export function ensureGriftUserScoresTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_user_scores (
        user_id INTEGER PRIMARY KEY,
        score_current INTEGER NOT NULL DEFAULT 0,
        score_7d INTEGER NOT NULL DEFAULT 0,
        score_30d INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'LOW',
        devices_7d INTEGER NOT NULL DEFAULT 0,
        ips_7d INTEGER NOT NULL DEFAULT 0,
        user_agents_7d INTEGER NOT NULL DEFAULT 0,
        countries_7d INTEGER NOT NULL DEFAULT 0,
        asns_7d INTEGER NOT NULL DEFAULT 0,
        linked_accounts_30d INTEGER NOT NULL DEFAULT 0,
        hedge_pairs_7d INTEGER NOT NULL DEFAULT 0,
        open_signals_count INTEGER NOT NULL DEFAULT 0,
        last_evaluated_at INTEGER
      );
    `);
    // Add missing columns for existing tables
    const scoreCols = [
      "ALTER TABLE grift_user_scores ADD COLUMN score_current INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN score_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN score_30d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN devices_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN ips_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN user_agents_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN countries_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN asns_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN linked_accounts_30d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN hedge_pairs_7d INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE grift_user_scores ADD COLUMN open_signals_count INTEGER NOT NULL DEFAULT 0",
    ];
    for (const sql of scoreCols) {
      try { db.exec(sql); } catch (e) { /* column exists */ }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_user_scores_current ON grift_user_scores(score_current);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_user_scores_tier ON grift_user_scores(tier);`);
    console.log("Grift user scores table ensured");
  } finally {
    db.close();
  }
}

// Grift user enforcements (freeze/disable)
export function ensureGriftUserEnforcementsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_user_enforcements (
        user_id INTEGER PRIMARY KEY,
        frozen_at INTEGER,
        frozen_by_admin_id INTEGER,
        disabled_at INTEGER,
        disabled_by_admin_id INTEGER,
        notes TEXT
      );
    `);
    console.log("Grift user enforcements table ensured");
  } finally {
    db.close();
  }
}

// Auth events table (append-only event log)
export function ensureAuthEventsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        event_type TEXT NOT NULL,
        session_id TEXT,
        device_id TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        client_tz TEXT,
        client_lang TEXT,
        ip TEXT,
        user_agent TEXT,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        failure_reason TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_type ON auth_events(event_type);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_device ON auth_events(device_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_ip ON auth_events(ip);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at);`);
    console.log("Auth events table ensured");
  } finally {
    db.close();
  }
}

// Grift trade observations table
export function ensureGriftTradeObservationsTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_trade_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        session_id TEXT,
        device_id TEXT,
        ip TEXT,
        user_agent TEXT,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        lots REAL NOT NULL,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        observed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
    try { db.exec(`ALTER TABLE grift_trade_observations ADD COLUMN device_fp TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_trade_observations ADD COLUMN device_install_id TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_trade_observations ADD COLUMN client_tz TEXT`); } catch (e) {}
    try { db.exec(`ALTER TABLE grift_trade_observations ADD COLUMN client_lang TEXT`); } catch (e) {}
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_user ON grift_trade_observations(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_trade ON grift_trade_observations(trade_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_symbol ON grift_trade_observations(symbol);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_device ON grift_trade_observations(device_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_observed ON grift_trade_observations(observed_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_symbol_ts ON grift_trade_observations(symbol, observed_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_trade_obs_user_ts ON grift_trade_observations(user_id, observed_at);`);
    console.log("Grift trade observations table ensured");
  } finally {
    db.close();
  }
}

// Grift IP->ASN cache table (for enrichment when proxy headers are missing)
export function ensureGriftIpAsnCacheTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_ip_asn_cache (
        ip TEXT PRIMARY KEY,
        asn INTEGER,
        org TEXT,
        source TEXT,
        fetched_at INTEGER,
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        error TEXT,
        error_at INTEGER,
        next_retry_at INTEGER
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_cache_last_seen ON grift_ip_asn_cache(last_seen_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_cache_next_retry ON grift_ip_asn_cache(next_retry_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_cache_asn ON grift_ip_asn_cache(asn);`);
    console.log("Grift IP ASN cache table ensured");
  } finally {
    db.close();
  }
}

// Grift IP->ASN range dataset tables (offline ip2asn.com TSV import)
export function ensureGriftIpAsnRangesTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_ip_asn_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_version INTEGER NOT NULL,
        start_int INTEGER,
        end_int INTEGER,
        start_hex TEXT,
        end_hex TEXT,
        asn INTEGER,
        country TEXT,
        org TEXT
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_ranges_v4_start ON grift_ip_asn_ranges(ip_version, start_int);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_ranges_v6_start ON grift_ip_asn_ranges(ip_version, start_hex);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_grift_ip_asn_ranges_asn ON grift_ip_asn_ranges(asn);`);
    console.log("Grift IP ASN ranges table ensured");
  } finally {
    db.close();
  }
}

export function ensureGriftIpAsnDatasetMetaTable() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS grift_ip_asn_dataset_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        file_path TEXT NOT NULL,
        file_mtime_ms INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        ipv4_count INTEGER NOT NULL,
        ipv6_count INTEGER NOT NULL
      );
    `);
    console.log("Grift IP ASN dataset meta table ensured");
  } finally {
    db.close();
  }
}

// Run all grift detection schema migrations
export function ensureGriftDetectionSchema() {
  ensureGriftConfigTable();
  ensureGriftDevicesTable();
  ensureGriftDeviceUsersTable();
  ensureGriftSignalsTable();
  ensureGriftIdentityLinksTable();
  ensureGriftAlertsTable();
  ensureGriftUserRiskTable();
  ensureGriftEnforcementLogTable();
  ensureGriftLinkedAccountEdgesTable();
  ensureGriftObservationsTable();
  ensureGriftTradeObservationsTable();
  ensureGriftIpAsnCacheTable();
  ensureGriftIpAsnRangesTable();
  ensureGriftIpAsnDatasetMetaTable();
  ensureGriftCasesTable();
  ensureGriftAdminActionsTable();
  ensureGriftUserScoresTable();
  ensureGriftUserEnforcementsTable();
  ensureAuthEventsTable();
  console.log("Grift detection schema ensured");
}

// Add sms_otp_locked_until column to user_verification table
export function ensureUserVerificationLockoutColumn() {
  const db = getDb();
  try {
    const table = "user_verification";
    if (!hasColumn(db, table, "sms_otp_locked_until")) {
      db.exec("ALTER TABLE user_verification ADD COLUMN sms_otp_locked_until INTEGER");
      console.log("Added column sms_otp_locked_until to user_verification");
    }
  } finally {
    db.close();
  }
}

// Ensure session revocation columns exist in user_sessions table
export function ensureSessionRevocationColumns() {
  const db = getDb();
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='user_sessions'"
    ).get();
    
    if (!tableExists) {
      console.log("User sessions table does not exist yet, skipping revocation columns check");
      return;
    }

    const columns = ['revoked_at', 'revoked_by_user_id', 'revoke_reason'];
    const tableInfo = db.prepare("PRAGMA table_info(user_sessions)").all() as any[];
    const existingColumns = tableInfo.map((c: any) => c.name);
    
    for (const col of columns) {
      if (!existingColumns.includes(col)) {
        const colType = col === 'revoke_reason' ? 'TEXT' : 'INTEGER';
        db.prepare(`ALTER TABLE user_sessions ADD COLUMN ${col} ${colType}`).run();
        console.log(`Added ${col} column to user_sessions`);
      }
    }
    console.log("Session revocation columns ensured");
  } finally {
    db.close();
  }
}

// Run all tiered access migrations
export function ensureTieredAccessSchema() {
  ensureUserTierColumns();
  ensureUserVerificationTable();
  ensureVerificationThrottleColumns();
  ensureUserVerificationPolicyColumns();
  ensureUserVerificationLockoutColumn();
  ensureEmailVerificationTokensTable();
  ensureSmsOtpTokensTable();
  ensureUserEquityDailyTable();
  ensureUserMfaTable();
  ensureUserKycProfilesTable();
  ensureUserPayoutProfilesTable();
  ensureIdentityAuditTable();
  ensureSessionRevocationColumns();
  ensureGriftDetectionSchema();
  console.log("Tiered access schema ensured");
}

export function ensureLegalComplianceSchema() {
  const db = getDb();
  try {
    // system_config: add missing columns for legal + captcha
    if (!hasColumn(db, "system_config", "legal_coverage_enforce")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN legal_coverage_enforce INTEGER NOT NULL DEFAULT 0;`);
      console.log("Added legal_coverage_enforce to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_restricted_iso2_csv")) {
      db.exec(
        `ALTER TABLE system_config ADD COLUMN jurisdiction_restricted_iso2_csv TEXT NOT NULL DEFAULT 'KP,IR,CU,SY';`
      );
      console.log("Added jurisdiction_restricted_iso2_csv to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_restricted_message")) {
      db.exec(
        `ALTER TABLE system_config ADD COLUMN jurisdiction_restricted_message TEXT NOT NULL DEFAULT 'This jurisdiction is not supported due to regulatory restrictions.';`
      );
      console.log("Added jurisdiction_restricted_message to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_enforce_by_ip_geo")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN jurisdiction_enforce_by_ip_geo INTEGER NOT NULL DEFAULT 0;`);
      console.log("Added jurisdiction_enforce_by_ip_geo to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_enforce_by_signup_country")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN jurisdiction_enforce_by_signup_country INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added jurisdiction_enforce_by_signup_country to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_block_signup")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN jurisdiction_block_signup INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added jurisdiction_block_signup to system_config");
    }
    if (!hasColumn(db, "system_config", "jurisdiction_block_login")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN jurisdiction_block_login INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added jurisdiction_block_login to system_config");
    }
    if (!hasColumn(db, "system_config", "signup_captcha_enforce")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN signup_captcha_enforce INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added signup_captcha_enforce to system_config");
    }
    if (!hasColumn(db, "system_config", "captcha_provider")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN captcha_provider TEXT NOT NULL DEFAULT 'SLIDER';`);
      console.log("Added captcha_provider to system_config");
    }
    if (!hasColumn(db, "system_config", "signup_phone_enforce")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN signup_phone_enforce INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added signup_phone_enforce to system_config");
    }
    try {
      db.exec(`
        UPDATE system_config
        SET signup_phone_enforce = 1
        WHERE id = 1 AND (signup_phone_enforce IS NULL OR signup_phone_enforce = 0);
      `);
    } catch (e) {
      console.warn("[Schema] Failed to enforce signup_phone_enforce:", e);
    }
    if (!hasColumn(db, "system_config", "allow_user_timezone_edit")) {
      db.exec(`ALTER TABLE system_config ADD COLUMN allow_user_timezone_edit INTEGER NOT NULL DEFAULT 1;`);
      console.log("Added allow_user_timezone_edit to system_config");
    }

    // users: region/country capture
    if (!hasColumn(db, "users", "country_iso2")) {
      db.exec(`ALTER TABLE users ADD COLUMN country_iso2 TEXT;`);
      console.log("Added country_iso2 to users");
    }
    if (!hasColumn(db, "users", "region_key")) {
      db.exec(`ALTER TABLE users ADD COLUMN region_key TEXT;`);
      console.log("Added region_key to users");
    }

    // Backfill users.country_iso2 from legacy users.country when possible (ISO2 codes only).
    if (hasColumn(db, "users", "country") && hasColumn(db, "users", "country_iso2")) {
      try {
        db.exec(`
          UPDATE users
          SET country_iso2 = upper(trim(country))
          WHERE (country_iso2 IS NULL OR trim(country_iso2) = '')
            AND country IS NOT NULL
            AND length(trim(country)) = 2;
        `);
      } catch (e) {
        console.warn("[Schema] Failed to backfill users.country_iso2:", e);
      }
    }

    // Signup jurisdiction block attempts (operational auditing)
    db.exec(`
      CREATE TABLE IF NOT EXISTS signup_jurisdiction_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        email_lower TEXT,
        username TEXT,
        ip TEXT,
        user_agent TEXT,
        ip_country_iso2 TEXT,
        selected_country_iso2 TEXT,
        reason_code TEXT NOT NULL,
        policy_snapshot_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_jurisdiction_blocks_email_lower ON signup_jurisdiction_blocks(email_lower);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_jurisdiction_blocks_created_at ON signup_jurisdiction_blocks(created_at);`);

    // legal_documents
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_set TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        jurisdiction_type TEXT NOT NULL,
        jurisdiction_key TEXT NOT NULL,
        version TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        content TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        created_by_admin_user_id INTEGER
      );
    `);

    // legal_doc_pointers
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_doc_pointers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_set TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        jurisdiction_type TEXT NOT NULL,
        jurisdiction_key TEXT NOT NULL,
        active_document_id INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        updated_by_admin_user_id INTEGER,
        FOREIGN KEY(active_document_id) REFERENCES legal_documents(id)
      );
    `);

    // legal_doc_change_audit (legacy table used by legacy admin routes)
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_doc_change_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER,
        target_id INTEGER,
        action TEXT NOT NULL,
        changed_by TEXT,
        changed_at INTEGER,
        previous_value TEXT,
        new_value TEXT,
        reason TEXT
      );
    `);

    // If this table already existed with a different schema (older v2), ensure legacy columns exist so legacy routes keep working.
    const legacyAuditTable = "legal_doc_change_audit";
    const legacyAuditAdds: Array<{ col: string; ddl: string }> = [
      { col: "doc_id", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN doc_id INTEGER;" },
      { col: "target_id", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN target_id INTEGER;" },
      { col: "action", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN action TEXT;" },
      { col: "changed_by", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN changed_by TEXT;" },
      { col: "changed_at", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN changed_at INTEGER;" },
      { col: "previous_value", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN previous_value TEXT;" },
      { col: "new_value", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN new_value TEXT;" },
      { col: "reason", ddl: "ALTER TABLE legal_doc_change_audit ADD COLUMN reason TEXT;" },
    ];
    for (const a of legacyAuditAdds) {
      if (!hasColumn(db, legacyAuditTable, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${legacyAuditTable}`);
      }
    }

    // legal_doc_change_audit_chain (v2 hash-chained audit trail)
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_doc_change_audit_chain (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL,
        prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        admin_user_id INTEGER,
        action TEXT NOT NULL,
        doc_set TEXT,
        doc_type TEXT,
        jurisdiction_type TEXT,
        jurisdiction_key TEXT,
        old_active_document_id INTEGER,
        new_active_document_id INTEGER,
        note TEXT,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY(old_active_document_id) REFERENCES legal_documents(id),
        FOREIGN KEY(new_active_document_id) REFERENCES legal_documents(id)
      );
    `);

    // v2 audit chain forward-compatible migrations
    const chainTable = "legal_doc_change_audit_chain";
    const chainAdds: Array<{ col: string; ddl: string }> = [
      { col: "seq", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN seq INTEGER;" },
      { col: "prev_hash", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN prev_hash TEXT;" },
      { col: "event_hash", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN event_hash TEXT;" },
      { col: "admin_user_id", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN admin_user_id INTEGER;" },
      { col: "action", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN action TEXT;" },
      { col: "doc_set", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN doc_set TEXT;" },
      { col: "doc_type", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN doc_type TEXT;" },
      { col: "jurisdiction_type", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN jurisdiction_type TEXT;" },
      { col: "jurisdiction_key", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN jurisdiction_key TEXT;" },
      { col: "old_active_document_id", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN old_active_document_id INTEGER;" },
      { col: "new_active_document_id", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN new_active_document_id INTEGER;" },
      { col: "note", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN note TEXT;" },
      { col: "created_at_ms", ddl: "ALTER TABLE legal_doc_change_audit_chain ADD COLUMN created_at_ms INTEGER;" },
    ];
    for (const a of chainAdds) {
      if (!hasColumn(db, chainTable, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${chainTable}`);
      }
    }

    // If older versions stored created_at, migrate into created_at_ms for verifiability.
    if (hasColumn(db, chainTable, "created_at") && hasColumn(db, chainTable, "created_at_ms")) {
      try {
        db.exec(`
          UPDATE legal_doc_change_audit_chain
          SET created_at_ms = CASE
            WHEN created_at_ms IS NOT NULL THEN created_at_ms
            WHEN created_at IS NULL THEN NULL
            WHEN created_at < 10000000000 THEN created_at * 1000
            ELSE created_at
          END
          WHERE created_at_ms IS NULL;
        `);
      } catch (e) {
        console.warn("Failed to backfill legal_doc_change_audit_chain.created_at_ms from created_at:", e);
      }
    }

    // legal_acceptances (ledger + legacy columns)
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_seq INTEGER NOT NULL,
        prev_ledger_hash TEXT NOT NULL,
        ledger_hash TEXT NOT NULL,

        user_id INTEGER NOT NULL,
        email_at_acceptance TEXT NOT NULL,
        country_iso2 TEXT NOT NULL,
        region_key TEXT,

        global_doc_id INTEGER NOT NULL,
        global_doc_version TEXT NOT NULL,
        global_doc_sha256 TEXT NOT NULL,

        addendum_id INTEGER,
        addendum_version TEXT,
        addendum_sha256 TEXT,

        combined_text TEXT NOT NULL,
        combined_sha256 TEXT NOT NULL,

        accepted_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
        accepted_at_ms INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        session_id TEXT,

        doc_id INTEGER,
        doc_version TEXT,
        doc_content_hash TEXT,

        terms_token TEXT NOT NULL,
        terms_token_verified INTEGER NOT NULL DEFAULT 0,

        prev_hash TEXT,
        record_hash TEXT,
        accepted_from_ip TEXT,
        accepted_user_agent TEXT,

        FOREIGN KEY(global_doc_id) REFERENCES legal_documents(id),
        FOREIGN KEY(addendum_id) REFERENCES legal_documents(id),
        FOREIGN KEY(doc_id) REFERENCES legal_documents(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    // legal_acceptances forward-compatible migrations (legacy fields used by Drizzle schema)
    const acceptancesTable = "legal_acceptances";
    const acceptancesAdds: Array<{ col: string; ddl: string }> = [
      { col: "doc_id", ddl: "ALTER TABLE legal_acceptances ADD COLUMN doc_id INTEGER;" },
      { col: "doc_version", ddl: "ALTER TABLE legal_acceptances ADD COLUMN doc_version TEXT;" },
      { col: "doc_content_hash", ddl: "ALTER TABLE legal_acceptances ADD COLUMN doc_content_hash TEXT;" },
    ];
    for (const a of acceptancesAdds) {
      if (!hasColumn(db, acceptancesTable, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${acceptancesTable}`);
      }
    }

    // legal_reaccept_requirements (tracks when users must re-accept updated terms)
    db.exec(`
      CREATE TABLE IF NOT EXISTS legal_reaccept_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doc_set TEXT NOT NULL,
        country_iso2 TEXT NOT NULL,
        region_key TEXT,
        required_combined_sha256 TEXT NOT NULL,
        last_accepted_combined_sha256 TEXT,
        last_acceptance_id INTEGER,
        detected_at_ms INTEGER NOT NULL,
        detected_by TEXT NOT NULL DEFAULT 'LOGIN',
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(last_acceptance_id) REFERENCES legal_acceptances(id)
      );
    `);

    // legal_reaccept_requirements forward-compatible migrations
    const reacceptTable = "legal_reaccept_requirements";
    const reacceptAdds: Array<{ col: string; ddl: string }> = [
      { col: "user_id", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN user_id INTEGER;" },
      { col: "doc_set", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN doc_set TEXT;" },
      { col: "country_iso2", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN country_iso2 TEXT;" },
      { col: "region_key", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN region_key TEXT;" },
      { col: "required_combined_sha256", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN required_combined_sha256 TEXT;" },
      { col: "last_accepted_combined_sha256", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN last_accepted_combined_sha256 TEXT;" },
      { col: "last_acceptance_id", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN last_acceptance_id INTEGER;" },
      { col: "detected_at_ms", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN detected_at_ms INTEGER;" },
      { col: "detected_by", ddl: "ALTER TABLE legal_reaccept_requirements ADD COLUMN detected_by TEXT;" },
    ];
    for (const a of reacceptAdds) {
      if (!hasColumn(db, reacceptTable, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${reacceptTable}`);
      }
    }

    // Indexes / constraints
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_doc_pointers_target
      ON legal_doc_pointers(doc_set, doc_type, jurisdiction_type, jurisdiction_key);
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_doc_change_audit_chain_seq
      ON legal_doc_change_audit_chain(seq);
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_reaccept_requirements_user_doc_set
      ON legal_reaccept_requirements(user_id, doc_set);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_legal_reaccept_requirements_user_id
      ON legal_reaccept_requirements(user_id);
    `);

    // Only create ledger_seq index if the column exists (handles legacy tables)
    if (hasColumn(db, "legal_acceptances", "ledger_seq")) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptances_ledger_seq
        ON legal_acceptances(ledger_seq);
      `);
    }

    db.exec(`CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user_id ON legal_acceptances(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_legal_documents_sha ON legal_documents(sha256);`);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_legal_documents_target
      ON legal_documents(doc_set, doc_type, jurisdiction_type, jurisdiction_key);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_legal_doc_pointers_active_doc
      ON legal_doc_pointers(active_document_id);
    `);

    console.log("Legal compliance schema ensured");
  } finally {
    db.close();
  }
}

// Signup freeze + invite waitlist schema (capacity control + consent capture)
export function ensureSignupFreezeWaitlistSchema() {
  const db = getDb();
  try {
    const escapeSql = (value: string) => value.replace(/'/g, "''");

    const defaultFreezeMessage =
      "Signups are temporarily paused due to capacity. Existing users can still log in.";

    const defaultInviteSender = "TradeQuip <noreply@tradequip.com>";
    const defaultInviteSubject = "Signup slots are open again";
    const defaultInviteBodyText =
      "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message.";

    const defaultPolicyContent =
      "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support.";

    // system_config: add missing columns for signup freeze + waitlist
    const table = "system_config";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "signup_freeze", ddl: "ALTER TABLE system_config ADD COLUMN signup_freeze INTEGER NOT NULL DEFAULT 0;" },
      {
        col: "signup_freeze_message",
        ddl: `ALTER TABLE system_config ADD COLUMN signup_freeze_message TEXT NOT NULL DEFAULT '${escapeSql(defaultFreezeMessage)}';`,
      },
      { col: "signup_waitlist_enabled", ddl: "ALTER TABLE system_config ADD COLUMN signup_waitlist_enabled INTEGER NOT NULL DEFAULT 1;" },
      {
        col: "signup_waitlist_invite_sender",
        ddl: `ALTER TABLE system_config ADD COLUMN signup_waitlist_invite_sender TEXT NOT NULL DEFAULT '${escapeSql(defaultInviteSender)}';`,
      },
      {
        col: "signup_waitlist_invite_subject",
        ddl: `ALTER TABLE system_config ADD COLUMN signup_waitlist_invite_subject TEXT NOT NULL DEFAULT '${escapeSql(defaultInviteSubject)}';`,
      },
      {
        col: "signup_waitlist_invite_body_text",
        ddl: `ALTER TABLE system_config ADD COLUMN signup_waitlist_invite_body_text TEXT NOT NULL DEFAULT '${escapeSql(defaultInviteBodyText)}';`,
      },
      {
        col: "signup_waitlist_auto_invite_on_unfreeze",
        ddl: "ALTER TABLE system_config ADD COLUMN signup_waitlist_auto_invite_on_unfreeze INTEGER NOT NULL DEFAULT 0;",
      },
      {
        col: "signup_waitlist_invite_batch_cap",
        ddl: "ALTER TABLE system_config ADD COLUMN signup_waitlist_invite_batch_cap INTEGER NOT NULL DEFAULT 200;",
      },
      {
        col: "signup_waitlist_policy_version",
        ddl: "ALTER TABLE system_config ADD COLUMN signup_waitlist_policy_version TEXT NOT NULL DEFAULT '1';",
      },
      {
        col: "signup_waitlist_policy_content",
        ddl: `ALTER TABLE system_config ADD COLUMN signup_waitlist_policy_content TEXT NOT NULL DEFAULT '${escapeSql(defaultPolicyContent)}';`,
      },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }

    // Attempt log for blocked registrations (operational auditing)
    db.exec(`
      CREATE TABLE IF NOT EXISTS signup_freeze_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        email_lower TEXT,
        username TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_freeze_attempts_email_lower ON signup_freeze_attempts(email_lower);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_freeze_attempts_created_at ON signup_freeze_attempts(created_at);`);

    // Waitlist table (only when user opts in)
    db.exec(`
      CREATE TABLE IF NOT EXISTS signup_waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_lower TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'PUBLIC_WAITLIST',
        ip TEXT,
        user_agent TEXT,

        consented_at INTEGER NOT NULL,
        consent_doc_version TEXT NOT NULL,
        consent_doc_sha256 TEXT NOT NULL,
        consent_doc_content TEXT NOT NULL,
        consent_signature TEXT NOT NULL,
        prev_hash TEXT,
        record_hash TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'PENDING',

        invited_at INTEGER,
        invited_by_admin_id INTEGER,
        invite_send_count INTEGER NOT NULL DEFAULT 0,
        last_invite_sent_at INTEGER,
        last_invite_status TEXT,
        last_invite_error TEXT,
        last_invite_from TEXT,
        last_invite_subject TEXT,
        last_invite_body_sha256 TEXT,

        converted_at INTEGER,
        converted_user_id INTEGER,

        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_signup_waitlist_email_lower ON signup_waitlist(email_lower);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_waitlist_status ON signup_waitlist(status);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_waitlist_created_at ON signup_waitlist(created_at);`);

    console.log("Signup freeze + waitlist schema ensured");
  } finally {
    db.close();
  }
}

// Signup fingerprinting schema - captures IP, user agent, geo, device at registration
export function ensureSignupFingerprintSchema() {
  const db = getDb();
  try {
    // Create signup_fingerprints table (immutable audit record)
    db.exec(`
      CREATE TABLE IF NOT EXISTS signup_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        request_id TEXT NOT NULL,
        
        ip TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        
        user_agent TEXT,
        device_type TEXT,
        browser TEXT,
        os TEXT,
        
        country_code TEXT,
        region TEXT,
        city TEXT,
        latitude REAL,
        longitude REAL,
        inferred_tz TEXT,
        
        client_tz TEXT,
        client_lang TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        
        country_iso2_selected TEXT,
        region_key_selected TEXT,
        
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_fp_user_id ON signup_fingerprints(user_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_fp_ip_hash ON signup_fingerprints(ip_hash);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_signup_fp_device_fp ON signup_fingerprints(device_fp);`);

    // Add signup fingerprint columns to users table
    const userCols: Array<{ col: string; ddl: string }> = [
      { col: "signup_ip", ddl: "ALTER TABLE users ADD COLUMN signup_ip TEXT" },
      { col: "signup_ip_hash", ddl: "ALTER TABLE users ADD COLUMN signup_ip_hash TEXT" },
      { col: "signup_user_agent", ddl: "ALTER TABLE users ADD COLUMN signup_user_agent TEXT" },
      { col: "signup_country_code", ddl: "ALTER TABLE users ADD COLUMN signup_country_code TEXT" },
      { col: "signup_region", ddl: "ALTER TABLE users ADD COLUMN signup_region TEXT" },
      { col: "signup_city", ddl: "ALTER TABLE users ADD COLUMN signup_city TEXT" },
      { col: "signup_latitude", ddl: "ALTER TABLE users ADD COLUMN signup_latitude REAL" },
      { col: "signup_longitude", ddl: "ALTER TABLE users ADD COLUMN signup_longitude REAL" },
      { col: "signup_device_type", ddl: "ALTER TABLE users ADD COLUMN signup_device_type TEXT" },
      { col: "signup_browser", ddl: "ALTER TABLE users ADD COLUMN signup_browser TEXT" },
      { col: "signup_os", ddl: "ALTER TABLE users ADD COLUMN signup_os TEXT" },
      { col: "signup_client_tz", ddl: "ALTER TABLE users ADD COLUMN signup_client_tz TEXT" },
      { col: "signup_inferred_tz", ddl: "ALTER TABLE users ADD COLUMN signup_inferred_tz TEXT" },
      { col: "signup_device_fp", ddl: "ALTER TABLE users ADD COLUMN signup_device_fp TEXT" },
      { col: "signup_device_install_id", ddl: "ALTER TABLE users ADD COLUMN signup_device_install_id TEXT" },
      { col: "signup_client_lang", ddl: "ALTER TABLE users ADD COLUMN signup_client_lang TEXT" },
    ];

    for (const c of userCols) {
      if (!hasColumn(db, "users", c.col)) {
        db.exec(c.ddl);
        console.log(`Added column ${c.col} to users`);
      }
    }

    console.log("Signup fingerprint schema ensured");
  } finally {
    db.close();
  }
}

// Daily FX closes table - archives previous day close prices at rollover time
export function ensureDailyFxClosesSchema() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_fx_closes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_id INTEGER NOT NULL,
        symbol_name TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close_price REAL NOT NULL,
        bid_price REAL,
        ask_price REAL,
        source TEXT NOT NULL DEFAULT '1FORGE',
        rollover_tz TEXT NOT NULL,
        rollover_time TEXT NOT NULL,
        calculated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        created_by TEXT,
        FOREIGN KEY(symbol_id) REFERENCES symbol_configs(id)
      );
    `);
    
    // Unique constraint on symbol + trade date to prevent duplicates
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_fx_closes_symbol_date ON daily_fx_closes(symbol_id, trade_date);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_fx_closes_trade_date ON daily_fx_closes(trade_date);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_daily_fx_closes_symbol_name ON daily_fx_closes(symbol_name);`);
    
    console.log("Daily FX closes schema ensured");
  } finally {
    db.close();
  }
}

// i18n (dynamic UI translations) schema
export function ensureI18nSchema() {
  const db = getDb();
  try {
    // Core i18n tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS i18n_manifest_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        generated_at INTEGER,
        ingested_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        entry_count INTEGER NOT NULL DEFAULT 0
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS i18n_source_strings (
        string_id TEXT PRIMARY KEY,
        default_text TEXT NOT NULL,
        checksum TEXT NOT NULL,
        file TEXT,
        kind TEXT,
        prop_name TEXT,
        line INTEGER,
        column INTEGER,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_modified_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS i18n_translations (
        string_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_checksum TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (string_id, locale),
        FOREIGN KEY (string_id) REFERENCES i18n_source_strings(string_id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS i18n_translation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        string_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        locked_at INTEGER,
        locked_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE (string_id, locale),
        FOREIGN KEY (string_id) REFERENCES i18n_source_strings(string_id)
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_i18n_jobs_status ON i18n_translation_jobs(status, updated_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_i18n_tr_locale ON i18n_translations(locale, updated_at);`);

    // system_config: i18n toggles + defaults
    const table = "system_config";
    const adds: Array<{ col: string; ddl: string }> = [
      { col: "i18n_enabled", ddl: "ALTER TABLE system_config ADD COLUMN i18n_enabled INTEGER NOT NULL DEFAULT 1" },
      { col: "i18n_default_locale", ddl: "ALTER TABLE system_config ADD COLUMN i18n_default_locale TEXT NOT NULL DEFAULT 'en'" },
      {
        col: "i18n_supported_locales_csv",
        ddl:
          "ALTER TABLE system_config ADD COLUMN i18n_supported_locales_csv TEXT NOT NULL DEFAULT 'en,fr,pt,es,de,ar,hi,id,zh,ms,tl,ko,ja,sw,th,bn,tr'",
      },
      { col: "i18n_auto_translate", ddl: "ALTER TABLE system_config ADD COLUMN i18n_auto_translate INTEGER NOT NULL DEFAULT 1" },
      { col: "i18n_llm_enabled", ddl: "ALTER TABLE system_config ADD COLUMN i18n_llm_enabled INTEGER NOT NULL DEFAULT 1" },
      { col: "i18n_llm_provider", ddl: "ALTER TABLE system_config ADD COLUMN i18n_llm_provider TEXT NOT NULL DEFAULT 'openai'" },
      { col: "i18n_llm_model", ddl: "ALTER TABLE system_config ADD COLUMN i18n_llm_model TEXT NOT NULL DEFAULT 'gpt-4o-mini'" },
      { col: "i18n_llm_max_batch_size", ddl: "ALTER TABLE system_config ADD COLUMN i18n_llm_max_batch_size INTEGER NOT NULL DEFAULT 50" },
      { col: "i18n_llm_max_attempts", ddl: "ALTER TABLE system_config ADD COLUMN i18n_llm_max_attempts INTEGER NOT NULL DEFAULT 3" },
    ];

    for (const a of adds) {
      if (!hasColumn(db, table, a.col)) {
        db.exec(a.ddl);
        console.log(`Added column ${a.col} to ${table}`);
      }
    }

    console.log("i18n schema ensured");
  } finally {
    db.close();
  }
}

// Inactive users + bot activity schema (queue + risk assessments)
export function ensureAccountLifecycleSchema() {
  const db = getDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_risk_assessments (
        user_id INTEGER PRIMARY KEY,
        score INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL DEFAULT 'OK',
        signals_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS user_deletion_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'GRACE',
        reason TEXT NOT NULL DEFAULT 'INACTIVE',
        marked_at INTEGER NOT NULL,
        grace_expires_at INTEGER NOT NULL,
        last_active_at INTEGER,
        executed_at INTEGER,
        executed_by_admin_id INTEGER,
        note TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_bot_risk_score ON bot_risk_assessments(score, updated_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_deletion_queue_status ON user_deletion_queue(status, grace_expires_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_user_deletion_queue_grace ON user_deletion_queue(grace_expires_at);`);

    console.log("Account lifecycle schema ensured");
  } finally {
    db.close();
  }
}
