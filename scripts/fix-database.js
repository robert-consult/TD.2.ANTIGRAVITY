import sqlite3 from 'sqlite3';

// Open the database
const db = new sqlite3.Database('./trading_app.db');

// Run migrations
db.serialize(() => {
  console.log("Running TradeQuip Phase-2 database migrations...");

  // Add min_spread_pips to symbol_configs if it doesn't exist
  db.run(`ALTER TABLE symbol_configs ADD COLUMN min_spread_pips REAL DEFAULT 2.0`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error("Error adding min_spread_pips column:", err.message);
    } else {
      console.log("Added min_spread_pips column to symbol_configs");
    }
  });

  // Add order_type to trades if it doesn't exist
  db.run(`ALTER TABLE trades ADD COLUMN order_type TEXT NOT NULL DEFAULT 'Market'`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error("Error adding order_type column:", err.message);
    } else {
      console.log("Added order_type column to trades");
    }
  });

  // Add limit_price to trades if it doesn't exist
  db.run(`ALTER TABLE trades ADD COLUMN limit_price REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error("Error adding limit_price column:", err.message);
    } else {
      console.log("Added limit_price column to trades");
    }
  });

  // Add stop_price to trades if it doesn't exist
  db.run(`ALTER TABLE trades ADD COLUMN stop_price REAL`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error("Error adding stop_price column:", err.message);
    } else {
      console.log("Added stop_price column to trades");
    }
  });
  
  // Add executed_at to trades if it doesn't exist
  db.run(`ALTER TABLE trades ADD COLUMN executed_at INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error("Error adding executed_at column:", err.message);
    } else {
      console.log("Added executed_at column to trades");
    }
  });

  // Update all users to have $1,000,000 balance
  db.run(`UPDATE users SET balance = '1000000.00' WHERE balance != '1000000.00'`, function(err) {
    if (err) {
      console.error("Error updating user balances:", err.message);
    } else {
      console.log(`Updated ${this.changes} user(s) to have $1,000,000 balance`);
    }
  });
});

// Close the database connection when done
db.close((err) => {
  if (err) {
    console.error("Error closing database:", err.message);
  } else {
    console.log("Database migration completed successfully!");
  }
});