import { dbClient } from "@db";
import {
  canonicalizeInstrumentCategory,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";
import {
  commandClickHouse,
  getClickHouseClient,
  insertClickHouseJsonRows,
  queryClickHouseJson,
} from "./clickhouseClient";

type SyncState = {
  lastMarker: number;
  lastRowId: number;
};

type SyncLoopOptions = {
  batchSize: number;
  maxLoopsPerTick: number;
};

let schedulerStarted = false;
let syncTickRunning = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let schemaEnsured = false;

type ClickHouseSyncMetrics = {
  runningGauge: number;
  lastRunAtSec: number;
  lastSuccessAtSec: number;
  lastFailureAtSec: number;
  lastDurationMs: number;
  lastSyncedRowsTotal: number;
  lastSyncedUsersRows: number;
  lastSyncedTradesRows: number;
  lastSyncedDailyRows: number;
  lastSyncedEventRows: number;
  lastSyncedTradeAuditRows: number;
  lastSyncedOrderIntentRows: number;
  syncedRowsTotal: number;
};

const metrics: ClickHouseSyncMetrics = {
  runningGauge: 0,
  lastRunAtSec: 0,
  lastSuccessAtSec: 0,
  lastFailureAtSec: 0,
  lastDurationMs: 0,
  lastSyncedRowsTotal: 0,
  lastSyncedUsersRows: 0,
  lastSyncedTradesRows: 0,
  lastSyncedDailyRows: 0,
  lastSyncedEventRows: 0,
  lastSyncedTradeAuditRows: 0,
  lastSyncedOrderIntentRows: 0,
  syncedRowsTotal: 0,
};

function parsePositiveIntEnv(name: string, fallback: number, min = 1, max = 1_000_000): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function envEnabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const CLICKHOUSE_SYNC_ENABLED = envEnabled("CLICKHOUSE_SYNC_ENABLED", true);
const CLICKHOUSE_SYNC_INTERVAL_SEC = parsePositiveIntEnv("CLICKHOUSE_SYNC_INTERVAL_SEC", 300, 10, 86_400);
const CLICKHOUSE_SYNC_START_DELAY_SEC = parsePositiveIntEnv(
  "CLICKHOUSE_SYNC_START_DELAY_SEC",
  60,
  0,
  86_400,
);
const CLICKHOUSE_SYNC_BATCH_SIZE = parsePositiveIntEnv(
  "CLICKHOUSE_SYNC_BATCH_SIZE",
  20_000,
  100,
  250_000,
);
const CLICKHOUSE_SYNC_MAX_LOOPS_PER_TICK = parsePositiveIntEnv(
  "CLICKHOUSE_SYNC_MAX_LOOPS_PER_TICK",
  4,
  1,
  100,
);

const USERS_MARKER_SQL = `
  GREATEST(
    COALESCE(u.created_at, 0),
    COALESCE(u.deleted_at, 0),
    COALESCE(u.inactivated_at, 0),
    COALESCE(u.kyc_verified_at, 0),
    COALESCE(u.kyc_expires_at, 0),
    u.id
  )
`;

const TRADES_MARKER_SQL = `
  GREATEST(
    COALESCE(t.closed_at, 0),
    COALESCE(t.executed_at, 0),
    COALESCE(t.opened_at, 0),
    t.id
  )
`;

async function ensureClickHouseSchema(): Promise<void> {
  if (schemaEnsured) return;
  const client = getClickHouseClient();
  if (!client) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS sync_state (
      sync_key LowCardinality(String),
      last_marker UInt64 DEFAULT 0,
      last_row_id UInt64 DEFAULT 0,
      updated_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (sync_key, updated_at)`,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id UInt32,
      username String,
      email String,
      is_admin UInt8,
      starting_equity Float64,
      sync_marker UInt64
    )
    ENGINE = ReplacingMergeTree(sync_marker)
    ORDER BY (id)`,
    `CREATE TABLE IF NOT EXISTS admin_trades (
      id UInt64,
      user_id UInt32,
      username String,
      email String,
      is_admin UInt8,
      symbol String,
      category LowCardinality(String),
      side LowCardinality(String),
      status LowCardinality(String),
      lots Float64,
      open_price Float64,
      close_price Nullable(Float64),
      opened_at UInt32,
      closed_at UInt32,
      net_profit_usd Float64,
      stop_loss Nullable(Float64),
      take_profit Nullable(Float64),
      total_costs_usd Float64,
      open_commission_usd Float64,
      close_commission_usd Float64,
      financing_accrued_usd Float64,
      swap_accrued_usd Float64,
      overnight_days UInt16,
      row_version UInt64
    )
    ENGINE = ReplacingMergeTree(row_version)
    PARTITION BY toYYYYMM(toDateTime(opened_at))
    ORDER BY (id)
    SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS admin_daily_closes (
      id UInt64,
      user_id UInt32,
      date Date,
      balance Float64,
      profit_day Float64,
      trades_closed UInt32,
      trades_won UInt32,
      row_version UInt64
    )
    ENGINE = ReplacingMergeTree(row_version)
    PARTITION BY toYYYYMM(date)
    ORDER BY (date, user_id, id)
    SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS admin_user_account_events (
      id UInt64,
      user_id UInt32,
      event_type LowCardinality(String),
      reason_code Nullable(String),
      reason_text Nullable(String),
      created_at UInt32,
      row_version UInt64
    )
    ENGINE = ReplacingMergeTree(row_version)
    PARTITION BY toYYYYMM(toDateTime(created_at))
    ORDER BY (user_id, created_at, id)
    SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS admin_export_events (
      ts DateTime,
      job_id String,
      export_type LowCardinality(String),
      export_format LowCardinality(String),
      status LowCardinality(String),
      row_count UInt64,
      bytes_written UInt64,
      latency_ms UInt64,
      admin_id UInt32
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(ts)
    ORDER BY (ts, job_id)
    SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS admin_trade_audit (
      id UInt64,
      trade_id UInt64,
      event_type LowCardinality(String),
      event_category Nullable(String),
      event_at UInt32,
      event_at_ms Nullable(UInt64),
      correlation_id Nullable(String),
      order_id Nullable(String),
      execution_id Nullable(String),
      position_id Nullable(String),
      actor_type Nullable(String),
      actor_user_id Nullable(UInt32),
      session_id Nullable(String),
      ip Nullable(String),
      user_agent Nullable(String),
      symbol Nullable(String),
      side Nullable(String),
      order_type Nullable(String),
      time_in_force Nullable(String),
      qty_lots Nullable(Float64),
      notional_usd Nullable(Float64),
      gross_profit_usd Nullable(Float64),
      net_profit_usd Nullable(Float64),
      total_costs_usd Nullable(Float64),
      open_commission_usd Nullable(Float64),
      close_commission_usd Nullable(Float64),
      open_other_fees_usd Nullable(Float64),
      close_other_fees_usd Nullable(Float64),
      financing_accrued_usd Nullable(Float64),
      swap_accrued_usd Nullable(Float64),
      overnight_days Nullable(UInt16),
      category_snapshot Nullable(String),
      cost_model_version Nullable(String),
      requested_price Nullable(Float64),
      trigger_price Nullable(Float64),
      limit_price Nullable(Float64),
      stop_price Nullable(Float64),
      fill_price Nullable(Float64),
      avg_fill_price Nullable(Float64),
      slippage Nullable(Float64),
      slippage_pips Nullable(Float64),
      slippage_reference Nullable(String),
      latency_ms Nullable(UInt32),
      quote_ts Nullable(UInt32),
      quote_source Nullable(String),
      quote_bid Nullable(Float64),
      quote_ask Nullable(Float64),
      quote_mid Nullable(Float64),
      quote_spread Nullable(Float64),
      spread_pips Nullable(Float64),
      risk_check_name Nullable(String),
      risk_limit_value Nullable(Float64),
      risk_observed_value Nullable(Float64),
      risk_result Nullable(String),
      reason_code Nullable(String),
      payload_json Nullable(String),
      prev_hash Nullable(String),
      event_hash String,
      note Nullable(String),
      user_id Nullable(UInt32),
      username Nullable(String),
      user_email Nullable(String),
      row_version UInt64
    )
    ENGINE = ReplacingMergeTree(row_version)
    PARTITION BY toYYYYMM(toDateTime(event_at))
    ORDER BY (id)
    SETTINGS index_granularity = 8192`,
    `CREATE TABLE IF NOT EXISTS admin_order_intent_audit (
      id UInt64,
      correlation_id String,
      event_at UInt32,
      event_at_ms Nullable(UInt64),
      event_code LowCardinality(String),
      decision Nullable(String),
      reject_check Nullable(String),
      reject_reason Nullable(String),
      actor_type Nullable(String),
      user_id Nullable(UInt32),
      session_id Nullable(String),
      ip Nullable(String),
      user_agent Nullable(String),
      symbol Nullable(String),
      side Nullable(String),
      order_type Nullable(String),
      time_in_force Nullable(String),
      qty_lots Nullable(Float64),
      requested_price Nullable(Float64),
      limit_price Nullable(Float64),
      stop_price Nullable(Float64),
      take_profit Nullable(Float64),
      stop_loss Nullable(Float64),
      quote_bid Nullable(Float64),
      quote_ask Nullable(Float64),
      quote_mid Nullable(Float64),
      quote_ts Nullable(UInt32),
      quote_is_stale UInt8,
      risk_limit_json Nullable(String),
      risk_observed_json Nullable(String),
      risk_snapshot_json Nullable(String),
      payload_json Nullable(String),
      prev_hash Nullable(String),
      event_hash String,
      username Nullable(String),
      user_email Nullable(String),
      row_version UInt64
    )
    ENGINE = ReplacingMergeTree(row_version)
    PARTITION BY toYYYYMM(toDateTime(event_at))
    ORDER BY (id)
    SETTINGS index_granularity = 8192`,
  ];

  for (const query of statements) {
    await commandClickHouse({ query });
  }

  schemaEnsured = true;
}

function convertQuestionMarks(sqlText: string): string {
  let out = "";
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i += 1) {
    const ch = sqlText[i];
    const next = i + 1 < sqlText.length ? sqlText[i + 1] : "";

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        out += ch + next;
        i += 1;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        out += ch + next;
        i += 1;
        inBlockComment = true;
        continue;
      }
    }
    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (ch === "\"" && !inSingle) {
      out += ch;
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === "?") {
      out += `$${index++}`;
      continue;
    }
    out += ch;
  }
  return out;
}

async function queryPostgresRows<T = any>(sqlText: string, params: unknown[] = []): Promise<T[]> {
  const result = await dbClient.query(convertQuestionMarks(sqlText), params);
  return result.rows as T[];
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toNullableInt(value: unknown): number | null {
  const parsed = toNullableNumber(value);
  if (parsed == null) return null;
  return Math.trunc(parsed);
}

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function toBool01(value: unknown): number {
  return value === true || String(value) === "1" ? 1 : 0;
}

function normalizeCategory(raw: unknown): string {
  const input = String(raw || "");
  const canonical = canonicalizeInstrumentCategory(input);
  return normalizeInstrumentCategory(canonical || "unknown", "unknown");
}

async function getSyncState(syncKey: string): Promise<SyncState> {
  const rows = await queryClickHouseJson<{ last_marker?: number; last_row_id?: number }>({
    query: `
      SELECT last_marker, last_row_id
      FROM sync_state
      WHERE sync_key = {syncKey:String}
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    query_params: { syncKey },
  });

  if (!rows || rows.length === 0) {
    return { lastMarker: 0, lastRowId: 0 };
  }

  const row = rows[0] || {};
  return {
    lastMarker: Math.max(0, Math.trunc(toFiniteNumber(row.last_marker, 0))),
    lastRowId: Math.max(0, Math.trunc(toFiniteNumber(row.last_row_id, 0))),
  };
}

async function saveSyncState(syncKey: string, state: SyncState): Promise<void> {
  await insertClickHouseJsonRows("sync_state", [
    {
      sync_key: syncKey,
      last_marker: Math.max(0, Math.trunc(state.lastMarker)),
      last_row_id: Math.max(0, Math.trunc(state.lastRowId)),
    },
  ]);
}

async function syncUsers(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_users");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          u.id::bigint AS id,
          COALESCE(u.username, '') AS username,
          COALESCE(u.email, '') AS email,
          CASE WHEN u.is_admin THEN 1 ELSE 0 END AS is_admin,
          COALESCE(u.starting_equity::float8, 0) AS starting_equity,
          ${USERS_MARKER_SQL}::bigint AS sync_marker
        FROM users u
        WHERE (
          ${USERS_MARKER_SQL} > ?::bigint
          OR (${USERS_MARKER_SQL} = ?::bigint AND u.id > ?::int)
        )
        ORDER BY ${USERS_MARKER_SQL} ASC, u.id ASC
        LIMIT ?::int
      `,
      [state.lastMarker, state.lastMarker, state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => ({
      id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      username: String(row.username || ""),
      email: String(row.email || ""),
      is_admin: toBool01(row.is_admin),
      starting_equity: toFiniteNumber(row.starting_equity, 0),
      sync_marker: Math.max(0, Math.trunc(toFiniteNumber(row.sync_marker, 0))),
    }));

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_users", chRows);
    state = {
      lastMarker: Number(last.sync_marker || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_users", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function syncTrades(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_trades");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          t.id::bigint AS id,
          t.user_id::bigint AS user_id,
          COALESCE(u.username, '') AS username,
          COALESCE(u.email, '') AS email,
          CASE WHEN u.is_admin THEN 1 ELSE 0 END AS is_admin,
          COALESCE(s.symbol, '') AS symbol,
          COALESCE(NULLIF(s.category, ''), 'unknown') AS raw_category,
          COALESCE(t.type, '') AS side,
          COALESCE(t.status, '') AS status,
          COALESCE(t.lots::float8, 0) AS lots,
          COALESCE(t.open_price::float8, 0) AS open_price,
          t.close_price::float8 AS close_price,
          COALESCE(t.opened_at, 0)::bigint AS opened_at,
          COALESCE(t.closed_at, 0)::bigint AS closed_at,
          COALESCE(
            t.net_profit_usd::float8,
            CASE
              WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::float8
              WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::float8
              ELSE 0::float8
            END
          ) AS net_profit_usd,
          t.stop_loss::float8 AS stop_loss,
          t.take_profit::float8 AS take_profit,
          COALESCE(t.total_costs_usd::float8, 0) AS total_costs_usd,
          COALESCE(t.open_commission_usd::float8, 0) AS open_commission_usd,
          COALESCE(t.close_commission_usd::float8, 0) AS close_commission_usd,
          COALESCE(t.financing_accrued_usd::float8, 0) AS financing_accrued_usd,
          COALESCE(t.swap_accrued_usd::float8, 0) AS swap_accrued_usd,
          COALESCE(t.overnight_days, 0)::bigint AS overnight_days,
          ${TRADES_MARKER_SQL}::bigint AS sync_marker
        FROM trades t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE (
          ${TRADES_MARKER_SQL} > ?::bigint
          OR (${TRADES_MARKER_SQL} = ?::bigint AND t.id > ?::int)
        )
        ORDER BY ${TRADES_MARKER_SQL} ASC, t.id ASC
        LIMIT ?::int
      `,
      [state.lastMarker, state.lastMarker, state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => ({
      id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      user_id: Math.max(0, Math.trunc(toFiniteNumber(row.user_id, 0))),
      username: String(row.username || ""),
      email: String(row.email || ""),
      is_admin: toBool01(row.is_admin),
      symbol: String(row.symbol || ""),
      category: normalizeCategory(row.raw_category),
      side: String(row.side || "").toUpperCase(),
      status: String(row.status || "").toUpperCase(),
      lots: toFiniteNumber(row.lots, 0),
      open_price: toFiniteNumber(row.open_price, 0),
      close_price: row.close_price == null ? null : toFiniteNumber(row.close_price, 0),
      opened_at: Math.max(0, Math.trunc(toFiniteNumber(row.opened_at, 0))),
      closed_at: Math.max(0, Math.trunc(toFiniteNumber(row.closed_at, 0))),
      net_profit_usd: toFiniteNumber(row.net_profit_usd, 0),
      stop_loss: row.stop_loss == null ? null : toFiniteNumber(row.stop_loss, 0),
      take_profit: row.take_profit == null ? null : toFiniteNumber(row.take_profit, 0),
      total_costs_usd: toFiniteNumber(row.total_costs_usd, 0),
      open_commission_usd: toFiniteNumber(row.open_commission_usd, 0),
      close_commission_usd: toFiniteNumber(row.close_commission_usd, 0),
      financing_accrued_usd: toFiniteNumber(row.financing_accrued_usd, 0),
      swap_accrued_usd: toFiniteNumber(row.swap_accrued_usd, 0),
      overnight_days: Math.max(0, Math.trunc(toFiniteNumber(row.overnight_days, 0))),
      row_version: Math.max(0, Math.trunc(toFiniteNumber(row.sync_marker, 0))),
    }));

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_trades", chRows);
    state = {
      lastMarker: Number(last.row_version || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_trades", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function syncDailyCloses(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_daily_closes");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          d.id::bigint AS id,
          d.user_id::bigint AS user_id,
          COALESCE(d.date, '') AS date_key,
          COALESCE(d.balance::float8, 0) AS balance,
          COALESCE(d.profit_day::float8, 0) AS profit_day,
          COALESCE(d.trades_closed, 0)::bigint AS trades_closed,
          COALESCE(d.trades_won, 0)::bigint AS trades_won
        FROM daily_closes d
        WHERE d.id > ?::int
        ORDER BY d.id ASC
        LIMIT ?::int
      `,
      [state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => ({
      id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      user_id: Math.max(0, Math.trunc(toFiniteNumber(row.user_id, 0))),
      date: String(row.date_key || ""),
      balance: toFiniteNumber(row.balance, 0),
      profit_day: toFiniteNumber(row.profit_day, 0),
      trades_closed: Math.max(0, Math.trunc(toFiniteNumber(row.trades_closed, 0))),
      trades_won: Math.max(0, Math.trunc(toFiniteNumber(row.trades_won, 0))),
      row_version: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
    }));

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_daily_closes", chRows);
    state = {
      lastMarker: Number(last.row_version || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_daily_closes", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function syncUserAccountEvents(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_user_account_events");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          e.id::bigint AS id,
          e.user_id::bigint AS user_id,
          COALESCE(e.event_type, '') AS event_type,
          e.reason_code AS reason_code,
          e.reason_text AS reason_text,
          COALESCE(e.created_at, 0)::bigint AS created_at
        FROM user_account_events e
        WHERE e.id > ?::int
          AND e.event_type IN ('ACCOUNT_SELF_DEACTIVATED', 'ACCOUNT_SELF_DELETED')
        ORDER BY e.id ASC
        LIMIT ?::int
      `,
      [state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => ({
      id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      user_id: Math.max(0, Math.trunc(toFiniteNumber(row.user_id, 0))),
      event_type: String(row.event_type || ""),
      reason_code: row.reason_code == null ? null : String(row.reason_code),
      reason_text: row.reason_text == null ? null : String(row.reason_text),
      created_at: Math.max(0, Math.trunc(toFiniteNumber(row.created_at, 0))),
      row_version: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
    }));

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_user_account_events", chRows);
    state = {
      lastMarker: Number(last.row_version || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_user_account_events", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function syncTradeAudit(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_trade_audit");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          ta.id::bigint AS id,
          ta.trade_id::bigint AS trade_id,
          COALESCE(ta.event_type, '') AS event_type,
          ta.event_category AS event_category,
          COALESCE(ta.event_at, 0)::bigint AS event_at,
          ta.event_at_ms::bigint AS event_at_ms,
          ta.correlation_id AS correlation_id,
          ta.order_id AS order_id,
          ta.execution_id AS execution_id,
          ta.position_id AS position_id,
          ta.actor_type AS actor_type,
          ta.actor_user_id::bigint AS actor_user_id,
          ta.session_id AS session_id,
          ta.ip AS ip,
          ta.user_agent AS user_agent,
          ta.symbol AS symbol,
          ta.side AS side,
          ta.order_type AS order_type,
          ta.time_in_force AS time_in_force,
          ta.qty_lots::float8 AS qty_lots,
          ta.notional_usd::float8 AS notional_usd,
          ta.gross_profit_usd::float8 AS gross_profit_usd,
          ta.net_profit_usd::float8 AS net_profit_usd,
          ta.total_costs_usd::float8 AS total_costs_usd,
          ta.open_commission_usd::float8 AS open_commission_usd,
          ta.close_commission_usd::float8 AS close_commission_usd,
          ta.open_other_fees_usd::float8 AS open_other_fees_usd,
          ta.close_other_fees_usd::float8 AS close_other_fees_usd,
          ta.financing_accrued_usd::float8 AS financing_accrued_usd,
          ta.swap_accrued_usd::float8 AS swap_accrued_usd,
          ta.overnight_days::bigint AS overnight_days,
          ta.category_snapshot AS category_snapshot,
          ta.cost_model_version AS cost_model_version,
          ta.requested_price::float8 AS requested_price,
          ta.trigger_price::float8 AS trigger_price,
          ta.limit_price::float8 AS limit_price,
          ta.stop_price::float8 AS stop_price,
          ta.fill_price::float8 AS fill_price,
          ta.avg_fill_price::float8 AS avg_fill_price,
          ta.slippage::float8 AS slippage,
          ta.slippage_pips::float8 AS slippage_pips,
          ta.slippage_reference AS slippage_reference,
          ta.latency_ms::bigint AS latency_ms,
          ta.quote_ts::bigint AS quote_ts,
          ta.quote_source AS quote_source,
          ta.quote_bid::float8 AS quote_bid,
          ta.quote_ask::float8 AS quote_ask,
          ta.quote_mid::float8 AS quote_mid,
          ta.quote_spread::float8 AS quote_spread,
          ta.spread_pips::float8 AS spread_pips,
          ta.risk_check_name AS risk_check_name,
          ta.risk_limit_value::float8 AS risk_limit_value,
          ta.risk_observed_value::float8 AS risk_observed_value,
          ta.risk_result AS risk_result,
          ta.reason_code AS reason_code,
          ta.payload_json AS payload_json,
          ta.prev_hash AS prev_hash,
          COALESCE(ta.event_hash, '') AS event_hash,
          ta.note AS note,
          t.user_id::bigint AS user_id,
          u.username AS username,
          u.email AS user_email
        FROM trade_audit ta
        LEFT JOIN trades t ON t.id = ta.trade_id
        LEFT JOIN users u ON u.id = t.user_id
        WHERE ta.id > ?::int
        ORDER BY ta.id ASC
        LIMIT ?::int
      `,
      [state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => {
      const eventAt = Math.max(0, Math.trunc(toFiniteNumber(row.event_at, 0)));
      const eventAtMs = toNullableInt(row.event_at_ms);
      const actorUserId = toNullableInt(row.actor_user_id);
      const overnightDays = toNullableInt(row.overnight_days);
      const latencyMs = toNullableInt(row.latency_ms);
      const quoteTs = toNullableInt(row.quote_ts);
      const userId = toNullableInt(row.user_id);
      return {
        id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
        trade_id: Math.max(0, Math.trunc(toFiniteNumber(row.trade_id, 0))),
        event_type: String(row.event_type || ""),
        event_category: toNullableString(row.event_category),
        event_at: eventAt,
        event_at_ms: eventAtMs == null ? null : Math.max(0, eventAtMs),
        correlation_id: toNullableString(row.correlation_id),
        order_id: toNullableString(row.order_id),
        execution_id: toNullableString(row.execution_id),
        position_id: toNullableString(row.position_id),
        actor_type: toNullableString(row.actor_type),
        actor_user_id: actorUserId == null ? null : Math.max(0, actorUserId),
        session_id: toNullableString(row.session_id),
        ip: toNullableString(row.ip),
        user_agent: toNullableString(row.user_agent),
        symbol: toNullableString(row.symbol),
        side: toNullableString(row.side),
        order_type: toNullableString(row.order_type),
        time_in_force: toNullableString(row.time_in_force),
        qty_lots: toNullableNumber(row.qty_lots),
        notional_usd: toNullableNumber(row.notional_usd),
        gross_profit_usd: toNullableNumber(row.gross_profit_usd),
        net_profit_usd: toNullableNumber(row.net_profit_usd),
        total_costs_usd: toNullableNumber(row.total_costs_usd),
        open_commission_usd: toNullableNumber(row.open_commission_usd),
        close_commission_usd: toNullableNumber(row.close_commission_usd),
        open_other_fees_usd: toNullableNumber(row.open_other_fees_usd),
        close_other_fees_usd: toNullableNumber(row.close_other_fees_usd),
        financing_accrued_usd: toNullableNumber(row.financing_accrued_usd),
        swap_accrued_usd: toNullableNumber(row.swap_accrued_usd),
        overnight_days: overnightDays == null ? null : Math.max(0, overnightDays),
        category_snapshot: toNullableString(row.category_snapshot),
        cost_model_version: toNullableString(row.cost_model_version),
        requested_price: toNullableNumber(row.requested_price),
        trigger_price: toNullableNumber(row.trigger_price),
        limit_price: toNullableNumber(row.limit_price),
        stop_price: toNullableNumber(row.stop_price),
        fill_price: toNullableNumber(row.fill_price),
        avg_fill_price: toNullableNumber(row.avg_fill_price),
        slippage: toNullableNumber(row.slippage),
        slippage_pips: toNullableNumber(row.slippage_pips),
        slippage_reference: toNullableString(row.slippage_reference),
        latency_ms: latencyMs == null ? null : Math.max(0, latencyMs),
        quote_ts: quoteTs == null ? null : Math.max(0, quoteTs),
        quote_source: toNullableString(row.quote_source),
        quote_bid: toNullableNumber(row.quote_bid),
        quote_ask: toNullableNumber(row.quote_ask),
        quote_mid: toNullableNumber(row.quote_mid),
        quote_spread: toNullableNumber(row.quote_spread),
        spread_pips: toNullableNumber(row.spread_pips),
        risk_check_name: toNullableString(row.risk_check_name),
        risk_limit_value: toNullableNumber(row.risk_limit_value),
        risk_observed_value: toNullableNumber(row.risk_observed_value),
        risk_result: toNullableString(row.risk_result),
        reason_code: toNullableString(row.reason_code),
        payload_json: toNullableString(row.payload_json),
        prev_hash: toNullableString(row.prev_hash),
        event_hash: String(row.event_hash || ""),
        note: toNullableString(row.note),
        user_id: userId == null ? null : Math.max(0, userId),
        username: toNullableString(row.username),
        user_email: toNullableString(row.user_email),
        row_version: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      };
    });

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_trade_audit", chRows);
    state = {
      lastMarker: Number(last.row_version || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_trade_audit", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function syncOrderIntentAudit(options: SyncLoopOptions): Promise<number> {
  let totalRows = 0;
  let loops = 0;
  let state = await getSyncState("admin_order_intent_audit");

  while (loops < options.maxLoopsPerTick) {
    const rows = await queryPostgresRows<any>(
      `
        SELECT
          oia.id::bigint AS id,
          COALESCE(oia.correlation_id, '') AS correlation_id,
          COALESCE(oia.event_at, 0)::bigint AS event_at,
          oia.event_at_ms::bigint AS event_at_ms,
          COALESCE(oia.event_code, '') AS event_code,
          oia.decision AS decision,
          oia.reject_check AS reject_check,
          oia.reject_reason AS reject_reason,
          oia.actor_type AS actor_type,
          oia.user_id::bigint AS user_id,
          oia.session_id AS session_id,
          oia.ip AS ip,
          oia.user_agent AS user_agent,
          oia.symbol AS symbol,
          oia.side AS side,
          oia.order_type AS order_type,
          oia.time_in_force AS time_in_force,
          oia.qty_lots::float8 AS qty_lots,
          oia.requested_price::float8 AS requested_price,
          oia.limit_price::float8 AS limit_price,
          oia.stop_price::float8 AS stop_price,
          oia.take_profit::float8 AS take_profit,
          oia.stop_loss::float8 AS stop_loss,
          oia.quote_bid::float8 AS quote_bid,
          oia.quote_ask::float8 AS quote_ask,
          oia.quote_mid::float8 AS quote_mid,
          oia.quote_ts::bigint AS quote_ts,
          CASE WHEN oia.quote_is_stale THEN 1 ELSE 0 END AS quote_is_stale,
          oia.risk_limit_json AS risk_limit_json,
          oia.risk_observed_json AS risk_observed_json,
          oia.risk_snapshot_json AS risk_snapshot_json,
          oia.payload_json AS payload_json,
          oia.prev_hash AS prev_hash,
          COALESCE(oia.event_hash, '') AS event_hash,
          u.username AS username,
          u.email AS user_email
        FROM order_intent_audit oia
        LEFT JOIN users u ON u.id = oia.user_id
        WHERE oia.id > ?::int
        ORDER BY oia.id ASC
        LIMIT ?::int
      `,
      [state.lastRowId, options.batchSize],
    );

    if (!rows.length) break;

    const chRows = rows.map((row) => {
      const eventAt = Math.max(0, Math.trunc(toFiniteNumber(row.event_at, 0)));
      const eventAtMs = toNullableInt(row.event_at_ms);
      const userId = toNullableInt(row.user_id);
      const quoteTs = toNullableInt(row.quote_ts);
      return {
        id: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
        correlation_id: String(row.correlation_id || ""),
        event_at: eventAt,
        event_at_ms: eventAtMs == null ? null : Math.max(0, eventAtMs),
        event_code: String(row.event_code || ""),
        decision: toNullableString(row.decision),
        reject_check: toNullableString(row.reject_check),
        reject_reason: toNullableString(row.reject_reason),
        actor_type: toNullableString(row.actor_type),
        user_id: userId == null ? null : Math.max(0, userId),
        session_id: toNullableString(row.session_id),
        ip: toNullableString(row.ip),
        user_agent: toNullableString(row.user_agent),
        symbol: toNullableString(row.symbol),
        side: toNullableString(row.side),
        order_type: toNullableString(row.order_type),
        time_in_force: toNullableString(row.time_in_force),
        qty_lots: toNullableNumber(row.qty_lots),
        requested_price: toNullableNumber(row.requested_price),
        limit_price: toNullableNumber(row.limit_price),
        stop_price: toNullableNumber(row.stop_price),
        take_profit: toNullableNumber(row.take_profit),
        stop_loss: toNullableNumber(row.stop_loss),
        quote_bid: toNullableNumber(row.quote_bid),
        quote_ask: toNullableNumber(row.quote_ask),
        quote_mid: toNullableNumber(row.quote_mid),
        quote_ts: quoteTs == null ? null : Math.max(0, quoteTs),
        quote_is_stale: toBool01(row.quote_is_stale),
        risk_limit_json: toNullableString(row.risk_limit_json),
        risk_observed_json: toNullableString(row.risk_observed_json),
        risk_snapshot_json: toNullableString(row.risk_snapshot_json),
        payload_json: toNullableString(row.payload_json),
        prev_hash: toNullableString(row.prev_hash),
        event_hash: String(row.event_hash || ""),
        username: toNullableString(row.username),
        user_email: toNullableString(row.user_email),
        row_version: Math.max(0, Math.trunc(toFiniteNumber(row.id, 0))),
      };
    });

    const last = chRows[chRows.length - 1];
    await insertClickHouseJsonRows("admin_order_intent_audit", chRows);
    state = {
      lastMarker: Number(last.row_version || state.lastMarker),
      lastRowId: Number(last.id || state.lastRowId),
    };
    await saveSyncState("admin_order_intent_audit", state);
    totalRows += chRows.length;
    loops += 1;

    if (chRows.length < options.batchSize) break;
  }

  return totalRows;
}

async function runClickHouseSyncTick(): Promise<void> {
  if (syncTickRunning) return;
  syncTickRunning = true;
  metrics.runningGauge = 1;
  metrics.lastRunAtSec = Math.floor(Date.now() / 1000);
  const startedAt = Date.now();

  try {
    const client = getClickHouseClient();
    if (!client) return;
    await ensureClickHouseSchema();

    const options: SyncLoopOptions = {
      batchSize: CLICKHOUSE_SYNC_BATCH_SIZE,
      maxLoopsPerTick: CLICKHOUSE_SYNC_MAX_LOOPS_PER_TICK,
    };

    const [usersRows, tradesRows, dailyRows, eventRows, tradeAuditRows, orderIntentRows] = await Promise.all([
      syncUsers(options),
      syncTrades(options),
      syncDailyCloses(options),
      syncUserAccountEvents(options),
      syncTradeAudit(options),
      syncOrderIntentAudit(options),
    ]);

    const totalRows = usersRows + tradesRows + dailyRows + eventRows + tradeAuditRows + orderIntentRows;
    metrics.lastSyncedUsersRows = usersRows;
    metrics.lastSyncedTradesRows = tradesRows;
    metrics.lastSyncedDailyRows = dailyRows;
    metrics.lastSyncedEventRows = eventRows;
    metrics.lastSyncedTradeAuditRows = tradeAuditRows;
    metrics.lastSyncedOrderIntentRows = orderIntentRows;
    metrics.lastSyncedRowsTotal = totalRows;
    metrics.syncedRowsTotal += totalRows;
    metrics.lastDurationMs = Math.max(0, Date.now() - startedAt);
    metrics.lastSuccessAtSec = Math.floor(Date.now() / 1000);
    if (totalRows > 0) {
      console.log(
        `[clickhouse-sync] users=${usersRows} trades=${tradesRows} daily=${dailyRows} events=${eventRows} tradeAudit=${tradeAuditRows} orderIntent=${orderIntentRows} total=${totalRows} tookMs=${Date.now() - startedAt}`,
      );
    }
  } catch (error) {
    metrics.lastDurationMs = Math.max(0, Date.now() - startedAt);
    metrics.lastFailureAtSec = Math.floor(Date.now() / 1000);
    console.warn("[clickhouse-sync] sync tick failed:", error);
  } finally {
    syncTickRunning = false;
    metrics.runningGauge = 0;
  }
}

export function startClickHouseSyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!CLICKHOUSE_SYNC_ENABLED) {
    console.log("[clickhouse-sync] disabled (CLICKHOUSE_SYNC_ENABLED=0)");
    return;
  }

  const client = getClickHouseClient();
  if (!client) {
    console.log("[clickhouse-sync] skipped (ClickHouse client unavailable)");
    return;
  }

  void ensureClickHouseSchema().catch((error) => {
    console.warn("[clickhouse-sync] schema bootstrap failed:", error);
  });

  console.log(
    `[clickhouse-sync] starting interval=${CLICKHOUSE_SYNC_INTERVAL_SEC}s startDelay=${CLICKHOUSE_SYNC_START_DELAY_SEC}s batch=${CLICKHOUSE_SYNC_BATCH_SIZE} loops=${CLICKHOUSE_SYNC_MAX_LOOPS_PER_TICK}`,
  );

  startupTimer = setTimeout(() => {
    void runClickHouseSyncTick();
  }, CLICKHOUSE_SYNC_START_DELAY_SEC * 1000);
  startupTimer.unref?.();

  intervalTimer = setInterval(() => {
    void runClickHouseSyncTick();
  }, CLICKHOUSE_SYNC_INTERVAL_SEC * 1000);
  intervalTimer.unref?.();
}

export function stopClickHouseSyncScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  schedulerStarted = false;
}

export function getClickHouseSyncMetricsSnapshot(): ClickHouseSyncMetrics {
  return { ...metrics };
}
