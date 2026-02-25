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

    const [usersRows, tradesRows, dailyRows, eventRows] = await Promise.all([
      syncUsers(options),
      syncTrades(options),
      syncDailyCloses(options),
      syncUserAccountEvents(options),
    ]);

    const totalRows = usersRows + tradesRows + dailyRows + eventRows;
    metrics.lastSyncedUsersRows = usersRows;
    metrics.lastSyncedTradesRows = tradesRows;
    metrics.lastSyncedDailyRows = dailyRows;
    metrics.lastSyncedEventRows = eventRows;
    metrics.lastSyncedRowsTotal = totalRows;
    metrics.syncedRowsTotal += totalRows;
    metrics.lastDurationMs = Math.max(0, Date.now() - startedAt);
    metrics.lastSuccessAtSec = Math.floor(Date.now() / 1000);
    if (totalRows > 0) {
      console.log(
        `[clickhouse-sync] users=${usersRows} trades=${tradesRows} daily=${dailyRows} events=${eventRows} total=${totalRows} tookMs=${Date.now() - startedAt}`,
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
