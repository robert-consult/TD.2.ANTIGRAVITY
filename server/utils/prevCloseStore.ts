import { dbClient } from "@db";
import { computeSessionDayForQuote } from "./marketDailyClose";

type RolloverConfig = {
  rolloverTz: string;
  rolloverTime: string;
};

const DEFAULT_ROLLOVER: RolloverConfig = {
  rolloverTz: "America/New_York",
  rolloverTime: "17:00",
};

const CONFIG_TTL_MS = 60_000;
let cachedConfig: { cfg: RolloverConfig; fetchedAt: number } | null = null;

function normalizeSymbol(symbol: string): string {
  return symbol.replace("/", "").trim().toUpperCase();
}

function defaultPrevCloseTsMs(): number {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

async function loadRolloverConfig(): Promise<RolloverConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.fetchedAt < CONFIG_TTL_MS) {
    return cachedConfig.cfg;
  }
  try {
    const res = await dbClient.query(
      "SELECT fx_rollover_tz, fx_rollover_time FROM system_config WHERE id = 1 LIMIT 1"
    );
    const row = res.rows?.[0];
    const cfg = {
      rolloverTz: row?.fx_rollover_tz ? String(row.fx_rollover_tz) : DEFAULT_ROLLOVER.rolloverTz,
      rolloverTime: row?.fx_rollover_time ? String(row.fx_rollover_time) : DEFAULT_ROLLOVER.rolloverTime,
    };
    cachedConfig = { cfg, fetchedAt: now };
    return cfg;
  } catch {
    cachedConfig = { cfg: DEFAULT_ROLLOVER, fetchedAt: now };
    return DEFAULT_ROLLOVER;
  }
}

async function resolveSessionDay(tsMs?: number): Promise<string> {
  const cfg = await loadRolloverConfig();
  const ts = Number.isFinite(tsMs) ? Number(tsMs) : defaultPrevCloseTsMs();
  return computeSessionDayForQuote(ts, {
    rolloverTz: cfg.rolloverTz,
    rolloverTime: cfg.rolloverTime,
  });
}

export async function getCachedPrevClose(symbol: string, tsMs?: number): Promise<number | null> {
  const sym = normalizeSymbol(symbol);
  const sessionDay = await resolveSessionDay(tsMs);
  try {
    const res = await dbClient.query(
      `
      SELECT close
      FROM market_daily_close
      WHERE symbol = $1 AND session_day = $2
      ORDER BY close_ts_ms DESC
      LIMIT 1
      `,
      [sym, sessionDay]
    );
    const close = res.rows?.[0]?.close;
    return close != null ? Number(close) : null;
  } catch {
    return null;
  }
}

export async function cachePrevClose(symbol: string, closePrice: number, closeTsMs?: number): Promise<void> {
  if (!Number.isFinite(closePrice) || closePrice <= 0) return;
  const sym = normalizeSymbol(symbol);
  const ts = Number.isFinite(closeTsMs) ? Number(closeTsMs) : defaultPrevCloseTsMs();
  const sessionDay = await resolveSessionDay(ts);
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await dbClient.query(
      `
      INSERT INTO market_daily_close (symbol, session_day, close, close_ts_ms, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (symbol, session_day) DO NOTHING
      `,
      [sym, sessionDay, closePrice, ts, nowSec]
    );
  } catch {
    // ignore cache write failures
  }
}

export async function getFallbackQuotePrice(symbol: string): Promise<number | null> {
  const sym = normalizeSymbol(symbol);
  try {
    const res = await dbClient.query(
      "SELECT bid, ask, price FROM quotes WHERE symbol = $1 LIMIT 1",
      [sym]
    );
    const row = res.rows?.[0];
    if (!row) return null;
    const bid = row.bid != null ? Number(row.bid) : null;
    const ask = row.ask != null ? Number(row.ask) : null;
    const price = row.price != null ? Number(row.price) : null;
    if (bid != null && ask != null) return (bid + ask) / 2;
    return price != null ? price : null;
  } catch {
    return null;
  }
}

export function normalizePrevCloseSymbol(symbol: string): string {
  return normalizeSymbol(symbol);
}
