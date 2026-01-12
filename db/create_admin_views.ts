import { dbClient } from "./index";
import { dbDialect } from "./config";

const execSql = async (statement: string) => {
  if (dbDialect === "postgres") {
    await (dbClient as any).query(statement);
  } else {
    (dbClient as any).exec(statement);
  }
};

/**
 * Create the admin data views and tables needed for analytics
 */
async function createAdminViews() {
  console.log("Creating admin data views...");

  // Create a view for trader statistics
  const viewStatement =
    dbDialect === "postgres"
      ? `
    CREATE OR REPLACE VIEW vw_trader_stats AS
    SELECT 
      u.id AS user_id,
      u.username,
      u.email,
      COUNT(t.id) AS total_trades,
      ROUND(SUM(CASE WHEN t.profit > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(t.id), 0), 2) AS win_rate,
      ROUND(SUM(CAST(t.profit AS REAL)), 2) AS profit,
      ROUND(SUM(CAST(t.profit AS REAL)) * 100.0 / NULLIF(u.balance, 0), 2) AS profit_percent,
      ROUND(AVG((t.closed_at - t.opened_at) / 3600.0), 2) AS avg_hold_time,
      MAX(t.closed_at) AS last_trade_date
    FROM users u
    LEFT JOIN trades t ON u.id = t.user_id AND t.status = 'CLOSED'
    GROUP BY u.id
  `
      : `
    CREATE VIEW IF NOT EXISTS vw_trader_stats AS
    SELECT 
      u.id AS user_id,
      u.username,
      u.email,
      COUNT(t.id) AS total_trades,
      ROUND(SUM(CASE WHEN t.profit > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(t.id), 0), 2) AS win_rate,
      ROUND(SUM(CAST(t.profit AS REAL)), 2) AS profit,
      ROUND(SUM(CAST(t.profit AS REAL)) * 100.0 / NULLIF(u.balance, 0), 2) AS profit_percent,
      ROUND(AVG((t.closed_at - t.opened_at) / 3600.0), 2) AS avg_hold_time,
      MAX(t.closed_at) AS last_trade_date
    FROM users u
    LEFT JOIN trades t ON u.id = t.user_id AND t.status = 'CLOSED'
    GROUP BY u.id
  `;

  await execSql(viewStatement);

  // Create a table for daily P&L tracking if it doesn't exist
  const dailyClosesStatement =
    dbDialect === "postgres"
      ? `
    CREATE TABLE IF NOT EXISTS daily_closes (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      balance REAL NOT NULL,
      profit_day REAL,
      trades_closed INTEGER,
      trades_won INTEGER
    )
  `
      : `
    CREATE TABLE IF NOT EXISTS daily_closes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      profit_day REAL,
      trades_closed INTEGER,
      trades_won INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `;

  await execSql(dailyClosesStatement);
  
  // Create index on daily_closes if it doesn't exist
  await execSql(`
    CREATE INDEX IF NOT EXISTS idx_daily_closes_user_date ON daily_closes(user_id, date)
  `);

  console.log("Admin data views created successfully");
}

export async function main() {
  try {
    await createAdminViews();
    console.log("Database admin views setup complete");
  } catch (error) {
    console.error("Error setting up admin views:", error);
  }
}

// For direct execution - removed require.main check for ESM compatibility
