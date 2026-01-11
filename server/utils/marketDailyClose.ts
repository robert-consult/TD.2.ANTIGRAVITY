import { computeSessionDay, normalizeFxRolloverConfig } from "./quoteSession";

export const MARKET_DAILY_CLOSE_TABLE = "market_daily_close";

export type MarketDailyCloseConfig = {
  rolloverTz: string;
  rolloverTime: string; // HH:MM
};

export function ensureMarketDailyCloseTable(db: any) {
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
