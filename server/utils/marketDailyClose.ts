import { computeSessionDay, normalizeFxRolloverConfig } from "./quoteSession";
import { dbClient } from "@db";
import { dbDialect } from "@db/config";

export const MARKET_DAILY_CLOSE_TABLE = "market_daily_close";

export type MarketDailyCloseConfig = {
  rolloverTz: string;
  rolloverTime: string; // HH:MM
};

export async function ensureMarketDailyCloseTable(db?: any) {
  if (dbDialect === "postgres") {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS ${MARKET_DAILY_CLOSE_TABLE} (
        symbol TEXT NOT NULL,
        session_day TEXT NOT NULL,
        close REAL NOT NULL,
        close_ts_ms BIGINT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (extract(epoch from now())),
        PRIMARY KEY (symbol, session_day)
      );
    `);
    await dbClient.query(
      `CREATE INDEX IF NOT EXISTS idx_mdc_symbol_day ON ${MARKET_DAILY_CLOSE_TABLE}(symbol, session_day);`
    );
    return;
  }

  if (!db) return;

  db.exec(`
      CREATE TABLE IF NOT EXISTS ${MARKET_DAILY_CLOSE_TABLE} (
        symbol TEXT NOT NULL,
        session_day TEXT NOT NULL,
        close REAL NOT NULL,
        close_ts_ms INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (symbol, session_day)
      );
    `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_mdc_symbol_day ON ${MARKET_DAILY_CLOSE_TABLE}(symbol, session_day);`
  );
}

export function computeSessionDayForQuote(tsMs: number, cfg?: Partial<MarketDailyCloseConfig>) {
  const rollover = normalizeFxRolloverConfig({
    tz: cfg?.rolloverTz,
    time: cfg?.rolloverTime,
  });
  return computeSessionDay(tsMs, rollover);
}
