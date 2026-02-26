import fs from "fs";
import os from "os";
import path from "path";
import { dbClient } from "@db";
import {
  canonicalizeInstrumentCategory,
  normalizeInstrumentCategory,
} from "@shared/instruments/categories";
import type {
  AdminDataExportCreateRequest,
  AllTradesExportFilters,
  DailyPnlExportFilters,
  DeactivatedAccountsExportFilters,
  OrderIntentAuditExportFilters,
  TradeAuditExportFilters,
  TraderScoutingExportFilters,
  UserTimelineExportFilters,
  UsersExportFilters,
} from "@shared/admin/dataExports";
import {
  queryAllTradesFromClickHouse,
  queryDailyPnlFromClickHouse,
  queryDeactivatedAccountsFromClickHouse,
  queryOrderIntentAuditFromClickHouse,
  queryTradeAuditFromClickHouse,
  streamTraderScoutingFromClickHouse,
} from "./adminDataExportBuildClickhouse";

type BuildExportArtifactParams = {
  jobId: string;
  request: AdminDataExportCreateRequest;
};

type BuildExportArtifactResult = {
  filePath: string;
  filename: string;
  contentType: string;
  rowCount: number;
  truncated: boolean;
};

const MAX_DEACTIVATED_USERS = 200_000;
const MAX_USERS_EXPORT_ROWS = 5_000_000;
const MAX_USER_TIMELINE_ROWS = 5_000_000;
const MAX_TRADE_AUDIT_ROWS = 5_000_000;
const MAX_ORDER_INTENT_AUDIT_ROWS = 5_000_000;
const TRADER_SCOUT_FETCH_CHUNK = 5000;
const TRADE_FETCH_CHUNK = 5000;
const USER_EXPORT_FETCH_CHUNK = 5000;
const PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet";

function ensureTmpDir(): string {
  const dir = path.join(os.tmpdir(), "tradehub-admin-data-exports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIsoDateTag(): string {
  return new Date().toISOString().slice(0, 10);
}

function convertQuestionMarks(sqlText: string): string {
  let out = "";
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i++) {
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

async function queryAll<T = any>(sqlText: string, args: any[] = []): Promise<T[]> {
  const res = await dbClient.query(convertQuestionMarks(sqlText), args);
  return res.rows as T[];
}

function toUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

function safeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
  const neutralized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replaceAll("\"", "\"\"")}"`;
  }
  return neutralized;
}

function writeJsonlLine(fd: fs.WriteStream, row: Record<string, unknown>): void {
  fd.write(JSON.stringify(row));
  fd.write("\n");
}

type ParquetFieldType = "UTF8" | "DOUBLE" | "INT64" | "BOOLEAN";

function sanitizeParquetValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return JSON.stringify(value);
}

function inferParquetFieldType(value: unknown): ParquetFieldType {
  const cleaned = sanitizeParquetValue(value);
  if (cleaned == null) return "UTF8";
  if (typeof cleaned === "boolean") return "BOOLEAN";
  if (typeof cleaned === "number") {
    return Number.isInteger(cleaned) ? "INT64" : "DOUBLE";
  }
  return "UTF8";
}

async function writeParquetRows(params: {
  outputPath: string;
  rows: Array<Record<string, unknown>>;
  columns?: readonly string[];
  schemaHints?: Partial<Record<string, ParquetFieldType>>;
}): Promise<void> {
  const parquetModule = await import("parquetjs-lite");
  const parquet = (parquetModule as any)?.default ?? (parquetModule as any);
  if (!parquet?.ParquetSchema || !parquet?.ParquetWriter) {
    throw new Error("parquetjs-lite unavailable");
  }

  const columns =
    params.columns && params.columns.length > 0
      ? Array.from(params.columns)
      : Array.from(
          new Set(
            params.rows.flatMap((row) => Object.keys(row)),
          ),
        );

  const schemaDef: Record<string, { type: ParquetFieldType; optional: boolean }> = {};
  for (const column of columns) {
    const hinted = params.schemaHints?.[column];
    if (hinted) {
      schemaDef[column] = { type: hinted, optional: true };
      continue;
    }
    let inferred: ParquetFieldType = "UTF8";
    for (const row of params.rows) {
      const value = row[column];
      if (value == null) continue;
      inferred = inferParquetFieldType(value);
      break;
    }
    schemaDef[column] = { type: inferred, optional: true };
  }

  const schema = new parquet.ParquetSchema(schemaDef);
  const writer = await parquet.ParquetWriter.openFile(schema, params.outputPath);
  try {
    for (const row of params.rows) {
      const next: Record<string, unknown> = {};
      for (const column of columns) {
        const value = sanitizeParquetValue(row[column]);
        next[column] = value == null ? undefined : value;
      }
      await writer.appendRow(next);
    }
  } finally {
    await writer.close();
  }
}

async function writeStreamChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      stream.off("error", onError);
      resolve();
    };
    const onError = (error: Error) => {
      stream.off("drain", onDrain);
      reject(error);
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

async function closeWriteStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.once("error", reject);
  });
}

type StreamingExportWriter = {
  writeRow: (row: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
};

async function createStreamingExportWriter(params: {
  format: AdminDataExportCreateRequest["format"];
  outputPath: string;
  columns: readonly string[];
  schemaHints?: Partial<Record<string, ParquetFieldType>>;
}): Promise<StreamingExportWriter> {
  if (params.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    return {
      writeRow: async (row) => {
        await writeStreamChunk(fd, `${JSON.stringify(row)}\n`);
      },
      close: async () => {
        await closeWriteStream(fd);
      },
    };
  }

  if (params.format === "csv") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    await writeStreamChunk(fd, "\uFEFF");
    await writeStreamChunk(fd, `${params.columns.join(",")}\n`);
    return {
      writeRow: async (row) => {
        const values = params.columns.map((column) => row[column] ?? "");
        await writeStreamChunk(fd, `${values.map(safeCsv).join(",")}\n`);
      },
      close: async () => {
        await closeWriteStream(fd);
      },
    };
  }

  const parquetModule = await import("parquetjs-lite");
  const parquet = (parquetModule as any)?.default ?? (parquetModule as any);
  if (!parquet?.ParquetSchema || !parquet?.ParquetWriter) {
    throw new Error("parquetjs-lite unavailable");
  }
  const schemaDef: Record<string, { type: ParquetFieldType; optional: boolean }> = {};
  for (const column of params.columns) {
    schemaDef[column] = {
      type: params.schemaHints?.[column] ?? "UTF8",
      optional: true,
    };
  }
  const schema = new parquet.ParquetSchema(schemaDef);
  const writer = await parquet.ParquetWriter.openFile(schema, params.outputPath);
  return {
    writeRow: async (row) => {
      const next: Record<string, unknown> = {};
      for (const column of params.columns) {
        const value = sanitizeParquetValue(row[column]);
        next[column] = value == null ? undefined : value;
      }
      await writer.appendRow(next);
    },
    close: async () => {
      await writer.close();
    },
  };
}

function formatSessionLength(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const normalized = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(normalized / 3600);
  const mins = Math.floor((normalized % 3600) / 60);
  const secs = normalized % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function exportFileMeta(
  baseName: string,
  format: AdminDataExportCreateRequest["format"],
): { filename: string; contentType: string } {
  if (format === "jsonl") {
    return {
      filename: `${baseName}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }
  if (format === "parquet") {
    return {
      filename: `${baseName}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }
  return {
    filename: `${baseName}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function toIsoFromUnix(value: unknown): string | null {
  const n = toInt(value);
  if (n == null || n <= 0) return null;
  const sec = n > 1e12 ? Math.floor(n / 1000) : n;
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

const LEGACY_TRADE_PROFIT_NUMERIC_SQL = `
  CASE
    WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
    WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
    ELSE 0::numeric
  END
`;

const TRADE_NET_PROFIT_SQL = `
  COALESCE(
    t.net_profit_usd::numeric,
    ${LEGACY_TRADE_PROFIT_NUMERIC_SQL}
  )
`;

const TRADER_SCOUT_CATEGORY_SQL = `
  CASE
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fx', 'forex', 'forex_pair', 'forex_pairs', 'physical_currency') THEN 'forex'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('stock', 'stocks', 'common_stock', 'preferred_stock', 'american_depositary_receipt', 'depositary_receipt', 'global_depositary_receipt', 'reit', 'right', 'warrant', 'limited_partnership', 'structured_product') THEN 'stocks'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('etf', 'etfs', 'exchange_traded_note', 'exchange_traded_fund') THEN 'etf'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('crypto', 'cryptocurrency', 'cryptocurrencies', 'digital_currency', 'crypto_pair', 'crypto_pairs') THEN 'crypto'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('commodity', 'commodities', 'agricultural_product', 'energy', 'energies', 'energy_resource', 'livestock', 'metal', 'metals', 'precious_metal', 'precious_metals', 'industrial_metal', 'industrial_metals', 'gold', 'silver', 'platinum', 'palladium', 'oil', 'gas', 'natural_gas', 'crude_oil') THEN 'commodities'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('bond', 'bonds') THEN 'bonds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fund', 'funds', 'bond_fund', 'closed_end_fund', 'trust', 'unit') THEN 'funds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('mutual_fund', 'mutual_funds') THEN 'mutual_funds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('index', 'indices') THEN 'indices'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) = 'unknown' THEN 'unknown'
    ELSE LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown'))
  END
`;

const TRADER_SCOUT_SEARCH_SQL = `
WITH ft AS (
  SELECT
    t.user_id,
    t.opened_at,
    t.closed_at,
    ${TRADE_NET_PROFIT_SQL} AS profit,
    t.stop_loss,
    t.take_profit,
    ${TRADER_SCOUT_CATEGORY_SQL} AS category
  FROM trades t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND t.closed_at >= $1::int
    AND u.is_admin = FALSE
    AND ($2::text[] IS NULL OR ${TRADER_SCOUT_CATEGORY_SQL} = ANY($2::text[]))
    AND ($3::text IS NULL OR u.username ILIKE $3::text OR u.email ILIKE $3::text)
),
agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS trades,
    SUM(profit) AS net_profit,
    SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) AS gross_profit,
    SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END) AS gross_loss,
    (SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
    AVG((closed_at - opened_at)::float) AS avg_hold_sec,
    MAX((closed_at - opened_at)::float) AS max_hold_sec,
    MIN((closed_at - opened_at)::float) AS min_hold_sec,
    (SUM(CASE WHEN stop_loss IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS sl_usage,
    (SUM(CASE WHEN take_profit IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS tp_usage
  FROM ft
  GROUP BY user_id
  HAVING COUNT(*) >= $6::int
),
candidates AS (
  SELECT
    a.*,
    CASE
      WHEN ABS(a.gross_loss) < 0.0001 THEN CASE WHEN a.gross_profit > 0 THEN 999.0 ELSE NULL END
      ELSE (a.gross_profit / ABS(a.gross_loss))
    END AS profit_factor
  FROM agg a
  WHERE ($7::float IS NULL OR a.win_rate >= $7::float)
    AND ($8::numeric IS NULL OR a.net_profit >= $8::numeric)
    AND ($4::int IS NULL OR a.avg_hold_sec >= $4::int)
    AND ($5::int IS NULL OR a.avg_hold_sec <= $5::int)
    AND ($12::float IS NULL OR a.sl_usage >= $12::float)
    AND ($13::float IS NULL OR a.tp_usage >= $13::float)
),
candidates2 AS (
  SELECT *
  FROM candidates c
  WHERE ($11::float IS NULL OR (c.profit_factor IS NOT NULL AND c.profit_factor >= $11::float))
),
day_pnl AS (
  SELECT
    ft.user_id,
    date_trunc('day', to_timestamp(ft.closed_at)) AS day,
    SUM(ft.profit) AS pnl
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, day
),
day_equity AS (
  SELECT
    dp.user_id,
    dp.day,
    SUM(dp.pnl) OVER (PARTITION BY dp.user_id ORDER BY dp.day) AS cum_pnl
  FROM day_pnl dp
),
day_equity2 AS (
  SELECT
    de.user_id,
    de.day,
    de.cum_pnl,
    MAX(de.cum_pnl) OVER (
      PARTITION BY de.user_id
      ORDER BY de.day
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS peak_cum_pnl
  FROM day_equity de
),
dd AS (
  SELECT
    de.user_id,
    MAX(
      CASE
        WHEN (u.starting_equity::numeric + de.peak_cum_pnl) <= 0 THEN NULL
        ELSE (de.peak_cum_pnl - de.cum_pnl) / NULLIF((u.starting_equity::numeric + de.peak_cum_pnl), 0)
      END
    ) AS max_drawdown
  FROM day_equity2 de
  JOIN users u ON u.id = de.user_id
  GROUP BY de.user_id
),
best_day AS (
  SELECT
    user_id,
    MAX(pnl) AS best_day_pnl,
    SUM(pnl) AS total_pnl
  FROM day_pnl
  GROUP BY user_id
),
best_day_pct AS (
  SELECT
    user_id,
    CASE WHEN total_pnl > 0 THEN (best_day_pnl / total_pnl) ELSE NULL END AS best_day_pct
  FROM best_day
),
mix AS (
  SELECT
    ft.user_id,
    ft.category,
    COUNT(*)::int AS trades
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, ft.category
),
mix_totals AS (
  SELECT user_id, SUM(trades)::int AS total_trades
  FROM mix
  GROUP BY user_id
),
mix_json AS (
  SELECT
    m.user_id,
    jsonb_object_agg(m.category, (m.trades::float / NULLIF(mt.total_trades, 0))) AS asset_mix
  FROM mix m
  JOIN mix_totals mt ON mt.user_id = m.user_id
  GROUP BY m.user_id
)
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  c.trades,
  c.win_rate,
  c.net_profit,
  c.gross_profit,
  c.gross_loss,
  c.profit_factor,
  c.avg_hold_sec,
  c.max_hold_sec,
  c.min_hold_sec,
  d.max_drawdown,
  b.best_day_pct,
  c.sl_usage,
  c.tp_usage,
  mj.asset_mix
FROM candidates2 c
JOIN users u ON u.id = c.user_id
LEFT JOIN dd d ON d.user_id = c.user_id
LEFT JOIN best_day_pct b ON b.user_id = c.user_id
LEFT JOIN mix_json mj ON mj.user_id = c.user_id
WHERE ($9::float IS NULL OR (d.max_drawdown IS NOT NULL AND d.max_drawdown <= $9::float))
  AND ($10::float IS NULL OR (b.best_day_pct IS NOT NULL AND b.best_day_pct <= $10::float))
ORDER BY c.net_profit DESC, c.trades DESC, u.id ASC
LIMIT $14::int OFFSET $15::int;
`;

function buildDeactivatedAccountsCte(cutoff: number | null, params: any[]): string {
  let cutoffClause = "";
  if (cutoff !== null) {
    params.push(cutoff);
    cutoffClause = `AND e.created_at >= $${params.length}`;
  }

  return `
    WITH latest_events AS (
      SELECT
        e.user_id AS "userId",
        e.event_type AS "eventType",
        e.reason_code AS "reasonCode",
        e.reason_text AS "reasonText",
        e.created_at AS "actionAt",
        ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC) AS rn
      FROM user_account_events e
      WHERE e.event_type IN ('ACCOUNT_SELF_DEACTIVATED', 'ACCOUNT_SELF_DELETED')
      ${cutoffClause}
    ),
    latest AS (
      SELECT * FROM latest_events WHERE rn = 1
    ),
    trade_stats AS (
      SELECT
        t.user_id AS "userId",
        COUNT(*) FILTER (WHERE t.status = 'CLOSED') AS "closedTrades",
        SUM(
          CASE
            WHEN t.status = 'CLOSED' THEN ${TRADE_NET_PROFIT_SQL}
            ELSE 0
          END
        ) AS "profit",
        SUM(
          CASE
            WHEN t.status = 'CLOSED' AND ${TRADE_NET_PROFIT_SQL} > 0 THEN 1
            ELSE 0
          END
        ) AS "winningTrades"
      FROM trades t
      GROUP BY t.user_id
    )
  `;
}

function normalizeTraderScoutingExportRow(row: any): Record<string, unknown> {
  return {
    userId: Number(row.user_id),
    username: row.username ?? null,
    email: row.email ?? null,
    trades: Number(row.trades ?? 0),
    winRate: Number(row.win_rate ?? 0),
    netProfit: Number(row.net_profit ?? 0),
    grossProfit: Number(row.gross_profit ?? 0),
    grossLoss: Number(row.gross_loss ?? 0),
    profitFactor: row.profit_factor == null ? null : Number(row.profit_factor),
    avgHoldSec: row.avg_hold_sec == null ? null : Number(row.avg_hold_sec),
    maxHoldSec: row.max_hold_sec == null ? null : Number(row.max_hold_sec),
    minHoldSec: row.min_hold_sec == null ? null : Number(row.min_hold_sec),
    maxDrawdown: row.max_drawdown == null ? null : Number(row.max_drawdown),
    bestDayPct: row.best_day_pct == null ? null : Number(row.best_day_pct),
    slUsage: row.sl_usage == null ? null : Number(row.sl_usage),
    tpUsage: row.tp_usage == null ? null : Number(row.tp_usage),
    assetMix: row.asset_mix ?? null,
  };
}

async function buildTraderScoutingExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as TraderScoutingExportFilters;
  const nowSec = toUnixSec();
  const days = Math.max(0, Math.trunc(filters.days ?? 30));
  const cutoffSec = days > 0 ? nowSec - days * 86400 : 0;

  const categorySet = new Set<string>();
  for (const raw of filters.categories ?? []) {
    const normalized = canonicalizeInstrumentCategory(String(raw || ""));
    if (normalized) categorySet.add(normalizeInstrumentCategory(normalized, "unknown"));
  }
  const categories = Array.from(categorySet.values());
  const requestedLimit =
    filters.exportLimit == null || !Number.isFinite(filters.exportLimit)
      ? null
      : Math.max(1, Math.trunc(filters.exportLimit));
  const q = filters.q && filters.q.trim() ? `%${filters.q.trim().slice(0, 200)}%` : null;

  const columns = [
    "userId",
    "username",
    "email",
    "trades",
    "winRate",
    "netProfit",
    "grossProfit",
    "grossLoss",
    "profitFactor",
    "avgHoldSec",
    "maxHoldSec",
    "minHoldSec",
    "maxDrawdown",
    "bestDayPct",
    "slUsage",
    "tpUsage",
    "assetMix",
  ] as const;
  const writer = await createStreamingExportWriter({
    format: params.request.format,
    outputPath: params.outputPath,
    columns,
    schemaHints: {
      userId: "INT64",
      trades: "INT64",
      winRate: "DOUBLE",
      netProfit: "DOUBLE",
      grossProfit: "DOUBLE",
      grossLoss: "DOUBLE",
      profitFactor: "DOUBLE",
      avgHoldSec: "DOUBLE",
      maxHoldSec: "DOUBLE",
      minHoldSec: "DOUBLE",
      maxDrawdown: "DOUBLE",
      bestDayPct: "DOUBLE",
      slUsage: "DOUBLE",
      tpUsage: "DOUBLE",
    },
  });

  let written = 0;
  let truncated = false;
  try {
    const clickhouseStream = await streamTraderScoutingFromClickHouse({
      filters,
      cutoffSec,
      limitRows: requestedLimit == null ? null : requestedLimit + 1,
    }).catch((error) => {
      console.warn("[admin-export] trader scouting clickhouse query failed; falling back to postgres", error);
      return null;
    });

    if (clickhouseStream) {
      for await (const raw of clickhouseStream) {
        if (requestedLimit != null && written >= requestedLimit) {
          truncated = true;
          break;
        }
        await writer.writeRow(normalizeTraderScoutingExportRow(raw));
        written += 1;
      }
    } else {
      let offset = 0;
      while (true) {
        const remainingPlusOne =
          requestedLimit == null ? TRADER_SCOUT_FETCH_CHUNK : Math.max(1, requestedLimit - written + 1);
        const fetchLimit = Math.min(TRADER_SCOUT_FETCH_CHUNK, remainingPlusOne);
        const rows = await queryAll<any>(TRADER_SCOUT_SEARCH_SQL, [
          cutoffSec,
          categories.length ? categories : null,
          q,
          filters.minHoldSec ?? null,
          filters.maxHoldSec ?? null,
          Math.max(0, Math.trunc(filters.minTrades ?? 0)),
          filters.minWinRate ?? null,
          filters.minNetProfit ?? null,
          filters.maxDrawdown ?? null,
          filters.maxBestDayPct ?? null,
          filters.minProfitFactor ?? null,
          filters.minSlUsage ?? null,
          filters.minTpUsage ?? null,
          fetchLimit,
          offset,
        ]);
        if (rows.length === 0) break;

        const canWrite = requestedLimit == null ? rows.length : Math.max(0, requestedLimit - written);
        const rowsToWrite = Math.min(rows.length, canWrite);
        for (let i = 0; i < rowsToWrite; i += 1) {
          await writer.writeRow(normalizeTraderScoutingExportRow(rows[i]));
          written += 1;
        }

        if (requestedLimit != null && rows.length > rowsToWrite) {
          truncated = true;
          break;
        }
        offset += rows.length;
        if (rows.length < fetchLimit) break;
      }
    }
  } finally {
    await writer.close();
  }

  const file = exportFileMeta(`trader-scout-${days}d-${nowIsoDateTag()}`, params.request.format);
  return {
    rowCount: written,
    truncated,
    filename: file.filename,
    contentType: file.contentType,
  };
}

async function buildDeactivatedAccountsExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as DeactivatedAccountsExportFilters;
  const days = Math.max(0, Math.trunc(filters.days ?? 0));
  const includeTrades = Boolean(filters.includeTrades ?? true);
  const nowSec = toUnixSec();
  const cutoff = days > 0 ? nowSec - days * 86400 : null;

  let truncated = false;
  let slicedUsers: any[] = [];
  const tradesByUser = new Map<number, any[]>();

  const clickhouseResult = await queryDeactivatedAccountsFromClickHouse({
    filters,
    maxUsers: MAX_DEACTIVATED_USERS,
    includeTrades,
  }).catch((error) => {
    console.warn("[admin-export] deactivated accounts clickhouse query failed; falling back to postgres", error);
    return null;
  });

  if (clickhouseResult) {
    truncated = clickhouseResult.truncated;
    slicedUsers = clickhouseResult.users;
    for (const [userId, rows] of clickhouseResult.tradesByUser.entries()) {
      tradesByUser.set(userId, rows);
    }
  } else {
    const userParams: any[] = [];
    const userCte = buildDeactivatedAccountsCte(cutoff, userParams);
    userParams.push(MAX_DEACTIVATED_USERS + 1);
    const userSql = `
      ${userCte}
      SELECT
        l."userId" AS "userId",
        u.username AS username,
        u.email AS email,
        l."eventType" AS "eventType",
        l."reasonCode" AS "reasonCode",
        l."reasonText" AS "reasonText",
        l."actionAt" AS "actionAt",
        COALESCE(ts."profit", 0) AS "profit",
        COALESCE(ts."closedTrades", 0) AS "trades",
        CASE
          WHEN COALESCE(ts."closedTrades", 0) > 0
            THEN ROUND(((COALESCE(ts."winningTrades", 0)::numeric / ts."closedTrades") * 100)::numeric, 2)
          ELSE 0
        END AS "winRate"
      FROM latest l
      JOIN users u ON u.id = l."userId"
      LEFT JOIN trade_stats ts ON ts."userId" = l."userId"
      ORDER BY l."actionAt" DESC
      LIMIT $${userParams.length}::int;
    `;
    const userRows = await queryAll<any>(userSql, userParams);
    truncated = userRows.length > MAX_DEACTIVATED_USERS;
    slicedUsers = truncated ? userRows.slice(0, MAX_DEACTIVATED_USERS) : userRows;
  }

  const exportUsers = slicedUsers.map((row) => {
    const rawReasonCode = row.reasonCode ?? row.reason_code;
    const rawReasonText = row.reasonText ?? row.reason_text;
    const rawActionAt = row.actionAt ?? row.action_at;
    return {
      userId: Number(row.userId ?? row.user_id ?? 0),
      username: row.username ? String(row.username) : null,
      email: row.email ? String(row.email) : null,
      actionType:
        String(row.eventType || row.event_type || "").toUpperCase() === "ACCOUNT_SELF_DELETED"
          ? "DELETED"
          : "DEACTIVATED",
      reasonCode: rawReasonCode == null ? null : String(rawReasonCode),
      reasonText: rawReasonText == null ? null : String(rawReasonText),
      actionAt: rawActionAt == null ? null : Number(rawActionAt),
      profitUsd: Number(row.profit || 0),
      trades: Number(row.trades || row.closedTrades || row.closed_trades || 0),
      winRatePct: Number(row.winRate || row.win_rate || 0),
    };
  });

  const userIds = exportUsers.map((row) => row.userId).filter((id) => Number.isFinite(id));
  if (!clickhouseResult && includeTrades && userIds.length > 0) {
    for (let i = 0; i < userIds.length; i += TRADE_FETCH_CHUNK) {
      const batch = userIds.slice(i, i + TRADE_FETCH_CHUNK);
      const tradesSql = `
        SELECT
          t.id AS "tradeId",
          t.user_id AS "userId",
          s.symbol AS symbol,
          t.type AS type,
          t.status AS status,
          t.lots AS lots,
          t.open_price AS "openPrice",
          t.close_price AS "closePrice",
          COALESCE(
            t.net_profit_usd,
            CASE
              WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
              WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
              ELSE NULL
            END
          ) AS profit,
          t.net_profit_usd AS "netProfitUsd",
          t.total_costs_usd AS "totalCostsUsd",
          t.open_commission_usd AS "openCommissionUsd",
          t.close_commission_usd AS "closeCommissionUsd",
          t.financing_accrued_usd AS "financingAccruedUsd",
          t.swap_accrued_usd AS "swapAccruedUsd",
          t.overnight_days AS "overnightDays",
          t.opened_at AS "openedAt",
          t.closed_at AS "closedAt"
        FROM trades t
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE t.user_id = ANY($1::int[])
        ORDER BY t.user_id, t.opened_at DESC;
      `;
      const tradeRows = await queryAll<any>(tradesSql, [batch]);
      for (const row of tradeRows) {
        const userId = Number(row.userId);
        if (!tradesByUser.has(userId)) tradesByUser.set(userId, []);
        tradesByUser.get(userId)!.push(row);
      }
    }
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    const exportedAt = new Date().toISOString();
    writeJsonlLine(fd, {
      type: "meta",
      exportedAt,
      totalUsers: exportUsers.length,
      totalTrades: Array.from(tradesByUser.values()).reduce((sum, rows) => sum + rows.length, 0),
      includeTrades,
      truncated,
    });
    for (const user of exportUsers) {
      writeJsonlLine(fd, {
        type: "user",
        ...user,
        actionAtIso: user.actionAt ? new Date(user.actionAt * 1000).toISOString() : null,
      });
    }
    if (includeTrades) {
      for (const user of exportUsers) {
        const trades = tradesByUser.get(user.userId) ?? [];
        for (const trade of trades) {
          writeJsonlLine(fd, {
            type: "trade",
            userId: user.userId,
            username: user.username,
            email: user.email,
            actionType: user.actionType,
            reasonCode: user.reasonCode,
            reasonText: user.reasonText,
            actionAt: user.actionAt,
            tradeId: Number(trade.tradeId),
            symbol: trade.symbol ? String(trade.symbol) : null,
            tradeType: trade.type ? String(trade.type) : null,
            status: trade.status ? String(trade.status) : null,
            lots: trade.lots != null ? Number(trade.lots) : null,
            openPrice: trade.openPrice != null ? Number(trade.openPrice) : null,
            closePrice: trade.closePrice != null ? Number(trade.closePrice) : null,
            netProfitUsd: trade.netProfitUsd != null ? Number(trade.netProfitUsd) : null,
            totalCostsUsd: trade.totalCostsUsd != null ? Number(trade.totalCostsUsd) : null,
            openCommissionUsd: trade.openCommissionUsd != null ? Number(trade.openCommissionUsd) : null,
            closeCommissionUsd: trade.closeCommissionUsd != null ? Number(trade.closeCommissionUsd) : null,
            financingAccruedUsd:
              trade.financingAccruedUsd != null ? Number(trade.financingAccruedUsd) : null,
            swapAccruedUsd: trade.swapAccruedUsd != null ? Number(trade.swapAccruedUsd) : null,
            overnightDays: trade.overnightDays != null ? Number(trade.overnightDays) : null,
            openedAt: trade.openedAt != null ? Number(trade.openedAt) : null,
            closedAt: trade.closedAt != null ? Number(trade.closedAt) : null,
          });
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: exportUsers.length,
      truncated,
      filename: `deactivated_accounts_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const columns = [
    "user_id",
    "username",
    "email",
    "action_type",
    "action_at",
    "reason_code",
    "reason_text",
    "total_profit_usd",
    "total_trades",
    "win_rate_pct",
    "trade_id",
    "symbol",
    "trade_type",
    "trade_status",
    "lots",
    "open_price",
    "close_price",
    "net_profit_usd",
    "total_costs_usd",
    "open_commission_usd",
    "close_commission_usd",
    "financing_accrued_usd",
    "swap_accrued_usd",
    "overnight_days",
    "opened_at",
    "closed_at",
  ];
  const flattenedRows: Array<Record<string, unknown>> = [];

  for (const user of exportUsers) {
    const userTrades = includeTrades ? tradesByUser.get(user.userId) ?? [] : [];
    const actionAtIso = user.actionAt ? new Date(user.actionAt * 1000).toISOString() : "";
    if (userTrades.length === 0) {
      flattenedRows.push({
        user_id: user.userId,
        username: user.username ?? "",
        email: user.email ?? "",
        action_type: user.actionType,
        action_at: actionAtIso,
        reason_code: user.reasonCode ?? "",
        reason_text: user.reasonText ?? "",
        total_profit_usd: user.profitUsd,
        total_trades: user.trades,
        win_rate_pct: user.winRatePct,
        trade_id: null,
        symbol: null,
        trade_type: null,
        trade_status: null,
        lots: null,
        open_price: null,
        close_price: null,
        net_profit_usd: null,
        total_costs_usd: null,
        open_commission_usd: null,
        close_commission_usd: null,
        financing_accrued_usd: null,
        swap_accrued_usd: null,
        overnight_days: null,
        opened_at: null,
        closed_at: null,
      });
      continue;
    }

    for (const trade of userTrades) {
      flattenedRows.push({
        user_id: user.userId,
        username: user.username ?? "",
        email: user.email ?? "",
        action_type: user.actionType,
        action_at: actionAtIso,
        reason_code: user.reasonCode ?? "",
        reason_text: user.reasonText ?? "",
        total_profit_usd: user.profitUsd,
        total_trades: user.trades,
        win_rate_pct: user.winRatePct,
        trade_id: Number(trade.tradeId),
        symbol: trade.symbol ?? "",
        trade_type: trade.type ?? "",
        trade_status: trade.status ?? "",
        lots: trade.lots ?? null,
        open_price: trade.openPrice ?? null,
        close_price: trade.closePrice ?? null,
        net_profit_usd: trade.netProfitUsd ?? trade.profit ?? null,
        total_costs_usd: trade.totalCostsUsd ?? null,
        open_commission_usd: trade.openCommissionUsd ?? null,
        close_commission_usd: trade.closeCommissionUsd ?? null,
        financing_accrued_usd: trade.financingAccruedUsd ?? null,
        swap_accrued_usd: trade.swapAccruedUsd ?? null,
        overnight_days: trade.overnightDays ?? null,
        opened_at: trade.openedAt ?? null,
        closed_at: trade.closedAt ?? null,
      });
    }
  }

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: flattenedRows,
      columns,
      schemaHints: {
        user_id: "INT64",
        total_profit_usd: "DOUBLE",
        total_trades: "INT64",
        win_rate_pct: "DOUBLE",
        trade_id: "INT64",
        lots: "DOUBLE",
        open_price: "DOUBLE",
        close_price: "DOUBLE",
        net_profit_usd: "DOUBLE",
        total_costs_usd: "DOUBLE",
        open_commission_usd: "DOUBLE",
        close_commission_usd: "DOUBLE",
        financing_accrued_usd: "DOUBLE",
        swap_accrued_usd: "DOUBLE",
        overnight_days: "INT64",
        opened_at: "INT64",
        closed_at: "INT64",
      },
    });
    return {
      rowCount: exportUsers.length,
      truncated,
      filename: `deactivated_accounts_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of flattenedRows) {
    const values = columns.map((column) => row[column] ?? "");
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }

  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });

  return {
    rowCount: exportUsers.length,
    truncated,
    filename: `deactivated_accounts_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

const USERS_EXPORT_COLUMNS = [
  "id",
  "name",
  "email",
  "username",
  "phone",
  "balance",
  "status",
  "isAdmin",
  "isDisabled",
  "isFrozen",
  "freezeReason",
  "leverage",
  "maxConcurrent",
  "maxConcurrentLots",
  "minHoldSec",
  "maxHoldSec",
  "createdAt",
  "lastLoginTime",
  "lastLoginIp",
  "totalSessionsLength",
  "totalSessionsLengthSec",
  "lastLogoutTime",
] as const;

const USER_TIMELINE_EXPORT_COLUMNS = [
  "userId",
  "userPhone",
  "userUsername",
  "userEmail",
  "eventId",
  "type",
  "source",
  "title",
  "description",
  "severity",
  "timestamp",
  "timestampIso",
  "reasonCode",
  "loginTime",
  "loginTimeIso",
  "loginIp",
  "sessionLength",
  "sessionLengthSec",
  "logoutTime",
  "logoutTimeIso",
  "metadataJson",
] as const;

function deriveUserAccountStatus(row: any): string {
  if (row.isFrozen && row.isDisabled) return "Frozen+Disabled";
  if (row.isFrozen) return "Frozen";
  if (row.isDisabled) return "Disabled";
  return "Active";
}

async function buildUsersExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as UsersExportFilters;
  const limit = Math.max(1, Math.min(MAX_USERS_EXPORT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const includeAdmins = Boolean(filters.includeAdmins ?? true);
  const includeDeleted = Boolean(filters.includeDeleted ?? true);
  const schemaHints: Partial<Record<string, ParquetFieldType>> = {
    id: "INT64",
    balance: "DOUBLE",
    leverage: "DOUBLE",
    maxConcurrent: "INT64",
    maxConcurrentLots: "INT64",
    minHoldSec: "INT64",
    maxHoldSec: "INT64",
    createdAt: "UTF8",
    lastLoginTime: "UTF8",
    totalSessionsLengthSec: "INT64",
    lastLogoutTime: "UTF8",
  };

  const writer = await createStreamingExportWriter({
    format: params.request.format,
    outputPath: params.outputPath,
    columns: USERS_EXPORT_COLUMNS,
    schemaHints,
  });

  let written = 0;
  let lastUserId = 0;
  let truncated = false;
  try {
    while (written <= limit) {
      const remaining = limit + 1 - written;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const fetchLimit = Math.min(USER_EXPORT_FETCH_CHUNK, remaining);
      const usersChunk = await queryAll<any>(
        `
          SELECT
            u.id AS "id",
            u.name AS "name",
            u.email AS "email",
            u.username AS "username",
            u.phone AS "phone",
            u.balance AS "balance",
            u.is_admin AS "isAdmin",
            u.is_disabled AS "isDisabled",
            u.is_frozen AS "isFrozen",
            u.freeze_reason_code AS "freezeReasonCode",
            us.leverage AS "leverage",
            us.max_concurrent AS "maxConcurrent",
            us.max_concurrent_lots AS "maxConcurrentLots",
            us.min_hold_sec AS "minHoldSec",
            us.max_hold_sec AS "maxHoldSec",
            u.created_at AS "createdAt"
          FROM users u
          LEFT JOIN user_settings us ON us.user_id = u.id
          WHERE u.id > $1::int
            AND ($2::boolean OR u.is_admin = FALSE)
            AND ($3::boolean OR COALESCE(u.is_deleted, FALSE) = FALSE)
          ORDER BY u.id ASC
          LIMIT $4::int
        `,
        [lastUserId, includeAdmins, includeDeleted, fetchLimit],
      );

      if (usersChunk.length === 0) break;

      const userIds = usersChunk
        .map((row) => Number(row.id))
        .filter((value) => Number.isFinite(value) && value > 0);

      const loginStatsByUser = new Map<
        number,
        {
          lastLoginTime: number | null;
          lastLoginIp: string | null;
          lastLogoutTime: number | null;
          totalSessionLengthSec: number;
        }
      >();

      if (userIds.length > 0) {
        const loginStatsRows = await queryAll<any>(
          `
            WITH scoped AS (
              SELECT user_id, ip, created_at, logout_at, session_length_sec, success
              FROM user_login_history
              WHERE user_id = ANY($1::int[])
            ),
            latest_login AS (
              SELECT DISTINCT ON (user_id)
                user_id,
                created_at AS last_login_time,
                ip AS last_login_ip
              FROM scoped
              WHERE success = TRUE
              ORDER BY user_id, created_at DESC
            ),
            latest_logout AS (
              SELECT DISTINCT ON (user_id)
                user_id,
                logout_at AS last_logout_time
              FROM scoped
              WHERE success = TRUE AND logout_at IS NOT NULL
              ORDER BY user_id, logout_at DESC
            ),
            session_totals AS (
              SELECT
                user_id,
                COALESCE(SUM(COALESCE(session_length_sec, 0)), 0)::bigint AS total_session_length_sec
              FROM scoped
              WHERE success = TRUE
              GROUP BY user_id
            )
            SELECT
              COALESCE(ll.user_id, lo.user_id, st.user_id) AS "userId",
              ll.last_login_time AS "lastLoginTime",
              ll.last_login_ip AS "lastLoginIp",
              lo.last_logout_time AS "lastLogoutTime",
              st.total_session_length_sec AS "totalSessionLengthSec"
            FROM latest_login ll
            FULL OUTER JOIN latest_logout lo
              ON lo.user_id = ll.user_id
            FULL OUTER JOIN session_totals st
              ON st.user_id = COALESCE(ll.user_id, lo.user_id)
          `,
          [userIds],
        );

        for (const row of loginStatsRows) {
          const userId = Number(row.userId);
          if (!Number.isFinite(userId) || userId <= 0) continue;
          loginStatsByUser.set(userId, {
            lastLoginTime: row.lastLoginTime == null ? null : Number(row.lastLoginTime),
            lastLoginIp: row.lastLoginIp == null ? null : String(row.lastLoginIp),
            lastLogoutTime: row.lastLogoutTime == null ? null : Number(row.lastLogoutTime),
            totalSessionLengthSec:
              row.totalSessionLengthSec == null ? 0 : Math.max(0, Number(row.totalSessionLengthSec)),
          });
        }
      }

      for (const user of usersChunk) {
        if (written >= limit) {
          truncated = true;
          break;
        }
        const userId = Number(user.id);
        const stats = loginStatsByUser.get(userId);
        const balanceNum = Number(user.balance);
        await writer.writeRow({
          id: userId,
          name: user.name ?? "",
          email: user.email ?? "",
          username: user.username ?? "",
          phone: user.phone ?? "",
          balance: Number.isFinite(balanceNum) ? balanceNum : user.balance ?? "",
          status: deriveUserAccountStatus(user),
          isAdmin: user.isAdmin ? "Yes" : "No",
          isDisabled: user.isDisabled ? "Yes" : "No",
          isFrozen: user.isFrozen ? "Yes" : "No",
          freezeReason: user.freezeReasonCode ?? "",
          leverage: user.leverage == null ? null : Number(user.leverage),
          maxConcurrent: user.maxConcurrent == null ? null : Number(user.maxConcurrent),
          maxConcurrentLots: user.maxConcurrentLots == null ? null : Number(user.maxConcurrentLots),
          minHoldSec: user.minHoldSec == null ? null : Number(user.minHoldSec),
          maxHoldSec: user.maxHoldSec == null ? null : Number(user.maxHoldSec),
          createdAt: toIsoFromUnix(user.createdAt) ?? "",
          lastLoginTime: toIsoFromUnix(stats?.lastLoginTime) ?? "",
          lastLoginIp: stats?.lastLoginIp ?? "",
          totalSessionsLength: formatSessionLength(stats?.totalSessionLengthSec ?? 0),
          totalSessionsLengthSec: stats?.totalSessionLengthSec ?? 0,
          lastLogoutTime: toIsoFromUnix(stats?.lastLogoutTime) ?? "",
        });
        written += 1;
      }

      lastUserId = Number(usersChunk[usersChunk.length - 1]?.id || lastUserId);
      if (usersChunk.length < fetchLimit || truncated) break;
    }
  } finally {
    await writer.close();
  }

  const file = exportFileMeta(`users_export_${Date.now()}`, params.request.format);
  return {
    rowCount: written,
    truncated,
    filename: file.filename,
    contentType: file.contentType,
  };
}

async function buildUserTimelineExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as UserTimelineExportFilters;
  const userId = Math.trunc(filters.userId);
  const limit = Math.max(1, Math.min(MAX_USER_TIMELINE_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const user = await queryAll<any>(
    `
      SELECT id, phone, username, email
      FROM users
      WHERE id = $1::int
      LIMIT 1
    `,
    [userId],
  );
  const userRow = user[0];
  if (!userRow) throw new Error("User not found for timeline export");

  const timelineRows = await queryAll<any>(
    `
      WITH login_events AS (
        SELECT
          ('login-' || l.id)::text AS event_id,
          'LOGIN'::text AS event_type,
          'LOGIN'::text AS event_source,
          CASE WHEN l.success THEN 'User logged in' ELSE 'Login failed' END::text AS title,
          CASE
            WHEN l.success THEN ('From IP: ' || COALESCE(l.ip, 'unknown'))
            ELSE ('Failed: ' || COALESCE(l.failure_reason, 'unknown'))
          END::text AS description,
          CASE WHEN l.success THEN 'INFO' ELSE 'WARN' END::text AS severity,
          NULL::text AS reason_code,
          l.created_at AS ts,
          l.created_at AS login_time,
          l.ip AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          NULL::text AS metadata_json
        FROM user_login_history l
        WHERE l.user_id = $1::int
      ),
      logout_events AS (
        SELECT
          ('logout-' || l.id)::text AS event_id,
          'LOGOUT'::text AS event_type,
          'LOGOUT'::text AS event_source,
          'User logged out'::text AS title,
          (
            'Session length: ' ||
            CASE
              WHEN COALESCE(l.session_length_sec, 0) <= 0 THEN 'Unknown'
              WHEN l.session_length_sec >= 3600 THEN
                (l.session_length_sec / 3600)::int::text || 'h ' ||
                ((l.session_length_sec % 3600) / 60)::int::text || 'm ' ||
                (l.session_length_sec % 60)::int::text || 's'
              WHEN l.session_length_sec >= 60 THEN
                (l.session_length_sec / 60)::int::text || 'm ' ||
                (l.session_length_sec % 60)::int::text || 's'
              ELSE l.session_length_sec::int::text || 's'
            END
          )::text AS description,
          'INFO'::text AS severity,
          NULL::text AS reason_code,
          l.logout_at AS ts,
          l.created_at AS login_time,
          l.ip AS login_ip,
          l.session_length_sec AS session_length_sec,
          l.logout_at AS logout_time,
          NULL::text AS metadata_json
        FROM user_login_history l
        WHERE l.user_id = $1::int
          AND l.success = TRUE
          AND l.logout_at IS NOT NULL
      ),
      account_events AS (
        SELECT
          ('event-' || e.id)::text AS event_id,
          e.event_type AS event_type,
          'ACCOUNT_EVENT'::text AS event_source,
          e.title AS title,
          COALESCE(e.description, '') AS description,
          CASE WHEN e.event_type ILIKE '%FREEZE%' THEN 'HIGH' ELSE 'INFO' END::text AS severity,
          e.reason_code AS reason_code,
          e.created_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          e.metadata AS metadata_json
        FROM user_account_events e
        WHERE e.user_id = $1::int
      ),
      trade_open_events AS (
        SELECT
          ('trade-open-' || t.id)::text AS event_id,
          'TRADE_OPENED'::text AS event_type,
          'TRADE'::text AS event_source,
          (COALESCE(t.type, 'TRADE') || ' ' || COALESCE(s.symbol, 'Unknown'))::text AS title,
          (COALESCE(t.lots::text, '0') || ' lots @ ' || COALESCE(t.open_price::text, '0'))::text AS description,
          'INFO'::text AS severity,
          NULL::text AS reason_code,
          t.opened_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          jsonb_build_object(
            'tradeId', t.id,
            'symbol', s.symbol,
            'lots', t.lots
          )::text AS metadata_json
        FROM trades t
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE t.user_id = $1::int
          AND t.status IN ('OPEN', 'CLOSED')
      ),
      trade_close_events AS (
        SELECT
          ('trade-close-' || t.id)::text AS event_id,
          'TRADE_CLOSED'::text AS event_type,
          'TRADE'::text AS event_source,
          ('Closed ' || COALESCE(s.symbol, 'Unknown'))::text AS title,
          (
            'P/L: $' ||
            to_char(
              COALESCE(
                t.net_profit_usd::numeric,
                CASE
                  WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                  WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                  ELSE 0::numeric
                END
              ),
              'FM9999999999990D00'
            )
          )::text AS description,
          CASE
            WHEN COALESCE(
              t.net_profit_usd::numeric,
              CASE
                WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                ELSE 0::numeric
              END
            ) >= 0 THEN 'INFO'
            ELSE 'WARN'
          END::text AS severity,
          NULL::text AS reason_code,
          t.closed_at AS ts,
          NULL::int AS login_time,
          NULL::text AS login_ip,
          NULL::int AS session_length_sec,
          NULL::int AS logout_time,
          jsonb_build_object(
            'tradeId', t.id,
            'symbol', s.symbol,
            'profit', t.profit,
            'netProfitUsd', t.net_profit_usd,
            'totalCostsUsd', t.total_costs_usd
          )::text AS metadata_json
        FROM trades t
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        WHERE t.user_id = $1::int
          AND t.status = 'CLOSED'
          AND t.closed_at IS NOT NULL
      ),
      combined AS (
        SELECT * FROM login_events
        UNION ALL
        SELECT * FROM logout_events
        UNION ALL
        SELECT * FROM account_events
        UNION ALL
        SELECT * FROM trade_open_events
        UNION ALL
        SELECT * FROM trade_close_events
      )
      SELECT
        event_id AS "eventId",
        event_type AS "type",
        event_source AS "source",
        title,
        description,
        severity,
        reason_code AS "reasonCode",
        ts AS "timestamp",
        login_time AS "loginTime",
        login_ip AS "loginIp",
        session_length_sec AS "sessionLengthSec",
        logout_time AS "logoutTime",
        metadata_json AS "metadataJson"
      FROM combined
      WHERE ts IS NOT NULL
      ORDER BY ts DESC, event_id DESC
      LIMIT $2::int
    `,
    [userId, limit + 1],
  );

  const truncated = timelineRows.length > limit;
  const sliced = truncated ? timelineRows.slice(0, limit) : timelineRows;
  const writer = await createStreamingExportWriter({
    format: params.request.format,
    outputPath: params.outputPath,
    columns: USER_TIMELINE_EXPORT_COLUMNS,
    schemaHints: {
      userId: "INT64",
      timestamp: "INT64",
      loginTime: "INT64",
      sessionLengthSec: "INT64",
      logoutTime: "INT64",
    },
  });

  try {
    for (const row of sliced) {
      const sessionLengthSec = row.sessionLengthSec == null ? null : Number(row.sessionLengthSec);
      await writer.writeRow({
        userId,
        userPhone: userRow.phone ?? null,
        userUsername: userRow.username ?? null,
        userEmail: userRow.email ?? null,
        eventId: row.eventId ?? null,
        type: row.type ?? null,
        source: row.source ?? null,
        title: row.title ?? null,
        description: row.description ?? null,
        severity: row.severity ?? null,
        timestamp: row.timestamp == null ? null : Number(row.timestamp),
        timestampIso: toIsoFromUnix(row.timestamp),
        reasonCode: row.reasonCode ?? null,
        loginTime: row.loginTime == null ? null : Number(row.loginTime),
        loginTimeIso: toIsoFromUnix(row.loginTime),
        loginIp: row.loginIp ?? null,
        sessionLength: formatSessionLength(sessionLengthSec),
        sessionLengthSec,
        logoutTime: row.logoutTime == null ? null : Number(row.logoutTime),
        logoutTimeIso: toIsoFromUnix(row.logoutTime),
        metadataJson: row.metadataJson ?? null,
      });
    }
  } finally {
    await writer.close();
  }

  const file = exportFileMeta(`user_${userId}_timeline_${Date.now()}`, params.request.format);
  return {
    rowCount: sliced.length,
    truncated,
    filename: file.filename,
    contentType: file.contentType,
  };
}

const TRADE_AUDIT_EXPORT_COLUMNS = [
  "id",
  "tradeId",
  "eventType",
  "eventCategory",
  "eventAt",
  "eventAtIso",
  "eventAtMs",
  "correlationId",
  "orderId",
  "executionId",
  "positionId",
  "actorType",
  "actorUserId",
  "sessionId",
  "ip",
  "userAgent",
  "symbol",
  "side",
  "orderType",
  "timeInForce",
  "qtyLots",
  "notionalUsd",
  "grossProfitUsd",
  "netProfitUsd",
  "totalCostsUsd",
  "openCommissionUsd",
  "closeCommissionUsd",
  "openOtherFeesUsd",
  "closeOtherFeesUsd",
  "financingAccruedUsd",
  "swapAccruedUsd",
  "overnightDays",
  "categorySnapshot",
  "costModelVersion",
  "requestedPrice",
  "triggerPrice",
  "limitPrice",
  "stopPrice",
  "fillPrice",
  "avgFillPrice",
  "slippage",
  "slippagePips",
  "slippageReference",
  "latencyMs",
  "quoteTs",
  "quoteTsIso",
  "quoteSource",
  "quoteBid",
  "quoteAsk",
  "quoteMid",
  "quoteSpread",
  "spreadPips",
  "riskCheckName",
  "riskLimitValue",
  "riskObservedValue",
  "riskResult",
  "reasonCode",
  "payloadJson",
  "prevHash",
  "eventHash",
  "note",
  "userId",
  "username",
  "userEmail",
] as const;

const ORDER_INTENT_AUDIT_EXPORT_COLUMNS = [
  "id",
  "correlationId",
  "eventAt",
  "eventAtIso",
  "eventAtMs",
  "eventCode",
  "decision",
  "rejectCheck",
  "rejectReason",
  "actorType",
  "userId",
  "sessionId",
  "ip",
  "userAgent",
  "symbol",
  "side",
  "orderType",
  "timeInForce",
  "qtyLots",
  "requestedPrice",
  "limitPrice",
  "stopPrice",
  "takeProfit",
  "stopLoss",
  "quoteBid",
  "quoteAsk",
  "quoteMid",
  "quoteTs",
  "quoteTsIso",
  "quoteIsStale",
  "riskLimitJson",
  "riskObservedJson",
  "riskSnapshotJson",
  "payloadJson",
  "prevHash",
  "eventHash",
  "username",
  "userEmail",
] as const;

function normalizeTradeAuditExportRow(row: any): Record<string, unknown> {
  const symbol = row.symbol || row.symbolFromTrade || null;
  const notionalUsd = row.notionalUsd ?? row.tradeNotionalUsd ?? null;
  const grossProfitUsd = row.grossProfitUsd ?? row.tradeGrossProfitUsd ?? null;
  const netProfitUsd = row.netProfitUsd ?? row.tradeNetProfitUsd ?? null;
  const totalCostsUsd = row.totalCostsUsd ?? row.tradeTotalCostsUsd ?? null;
  const openCommissionUsd = row.openCommissionUsd ?? row.tradeOpenCommissionUsd ?? null;
  const closeCommissionUsd = row.closeCommissionUsd ?? row.tradeCloseCommissionUsd ?? null;
  const openOtherFeesUsd = row.openOtherFeesUsd ?? row.tradeOpenOtherFeesUsd ?? null;
  const closeOtherFeesUsd = row.closeOtherFeesUsd ?? row.tradeCloseOtherFeesUsd ?? null;
  const financingAccruedUsd = row.financingAccruedUsd ?? row.tradeFinancingAccruedUsd ?? null;
  const swapAccruedUsd = row.swapAccruedUsd ?? row.tradeSwapAccruedUsd ?? null;
  const overnightDays = row.overnightDays ?? row.tradeOvernightDays ?? null;
  const categorySnapshot = row.categorySnapshot ?? row.tradeCategorySnapshot ?? null;
  const costModelVersion = row.costModelVersion ?? row.tradeCostModelVersion ?? null;
  const eventAt = toInt(row.eventAt);
  const quoteTs = toInt(row.quoteTs);
  return {
    id: toInt(row.id),
    tradeId: toInt(row.tradeId),
    eventType: row.eventType ? String(row.eventType) : null,
    eventCategory: row.eventCategory ? String(row.eventCategory) : null,
    eventAt,
    eventAtIso: toIsoFromUnix(eventAt),
    eventAtMs: row.eventAtMs == null ? null : toInt(row.eventAtMs),
    correlationId: row.correlationId ? String(row.correlationId) : null,
    orderId: row.orderId ? String(row.orderId) : null,
    executionId: row.executionId ? String(row.executionId) : null,
    positionId: row.positionId ? String(row.positionId) : null,
    actorType: row.actorType ? String(row.actorType) : null,
    actorUserId: row.actorUserId == null ? null : toInt(row.actorUserId),
    sessionId: row.sessionId ? String(row.sessionId) : null,
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.userAgent ? String(row.userAgent) : null,
    symbol: symbol ? String(symbol) : null,
    side: row.side ? String(row.side) : null,
    orderType: row.orderType ? String(row.orderType) : null,
    timeInForce: row.timeInForce ? String(row.timeInForce) : null,
    qtyLots: row.qtyLots == null ? null : Number(row.qtyLots),
    notionalUsd: notionalUsd == null ? null : Number(notionalUsd),
    grossProfitUsd: grossProfitUsd == null ? null : Number(grossProfitUsd),
    netProfitUsd: netProfitUsd == null ? null : Number(netProfitUsd),
    totalCostsUsd: totalCostsUsd == null ? null : Number(totalCostsUsd),
    openCommissionUsd: openCommissionUsd == null ? null : Number(openCommissionUsd),
    closeCommissionUsd: closeCommissionUsd == null ? null : Number(closeCommissionUsd),
    openOtherFeesUsd: openOtherFeesUsd == null ? null : Number(openOtherFeesUsd),
    closeOtherFeesUsd: closeOtherFeesUsd == null ? null : Number(closeOtherFeesUsd),
    financingAccruedUsd: financingAccruedUsd == null ? null : Number(financingAccruedUsd),
    swapAccruedUsd: swapAccruedUsd == null ? null : Number(swapAccruedUsd),
    overnightDays: overnightDays == null ? null : toInt(overnightDays),
    categorySnapshot: categorySnapshot == null ? null : String(categorySnapshot),
    costModelVersion: costModelVersion == null ? null : String(costModelVersion),
    requestedPrice: row.requestedPrice == null ? null : Number(row.requestedPrice),
    triggerPrice: row.triggerPrice == null ? null : Number(row.triggerPrice),
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    fillPrice: row.fillPrice == null ? null : Number(row.fillPrice),
    avgFillPrice: row.avgFillPrice == null ? null : Number(row.avgFillPrice),
    slippage: row.slippage == null ? null : Number(row.slippage),
    slippagePips: row.slippagePips == null ? null : Number(row.slippagePips),
    slippageReference: row.slippageReference == null ? null : String(row.slippageReference),
    latencyMs: row.latencyMs == null ? null : toInt(row.latencyMs),
    quoteTs,
    quoteTsIso: toIsoFromUnix(quoteTs),
    quoteSource: row.quoteSource == null ? null : String(row.quoteSource),
    quoteBid: row.quoteBid == null ? null : Number(row.quoteBid),
    quoteAsk: row.quoteAsk == null ? null : Number(row.quoteAsk),
    quoteMid: row.quoteMid == null ? null : Number(row.quoteMid),
    quoteSpread: row.quoteSpread == null ? null : Number(row.quoteSpread),
    spreadPips: row.spreadPips == null ? null : Number(row.spreadPips),
    riskCheckName: row.riskCheckName == null ? null : String(row.riskCheckName),
    riskLimitValue: row.riskLimitValue == null ? null : Number(row.riskLimitValue),
    riskObservedValue: row.riskObservedValue == null ? null : Number(row.riskObservedValue),
    riskResult: row.riskResult == null ? null : String(row.riskResult),
    reasonCode: row.reasonCode == null ? null : String(row.reasonCode),
    payloadJson: row.payloadJson == null ? null : String(row.payloadJson),
    prevHash: row.prevHash == null ? null : String(row.prevHash),
    eventHash: row.eventHash == null ? null : String(row.eventHash),
    note: row.note == null ? null : String(row.note),
    userId: row.userId == null ? null : toInt(row.userId),
    username: row.username == null ? null : String(row.username),
    userEmail: row.userEmail == null ? null : String(row.userEmail),
  };
}

function normalizeOrderIntentAuditExportRow(row: any): Record<string, unknown> {
  const eventAt = toInt(row.eventAt);
  const quoteTs = toInt(row.quoteTs);
  return {
    id: toInt(row.id),
    correlationId: row.correlationId == null ? null : String(row.correlationId),
    eventAt,
    eventAtIso: toIsoFromUnix(eventAt),
    eventAtMs: row.eventAtMs == null ? null : toInt(row.eventAtMs),
    eventCode: row.eventCode == null ? null : String(row.eventCode),
    decision: row.decision == null ? null : String(row.decision),
    rejectCheck: row.rejectCheck == null ? null : String(row.rejectCheck),
    rejectReason: row.rejectReason == null ? null : String(row.rejectReason),
    actorType: row.actorType == null ? null : String(row.actorType),
    userId: row.userId == null ? null : toInt(row.userId),
    sessionId: row.sessionId == null ? null : String(row.sessionId),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.userAgent == null ? null : String(row.userAgent),
    symbol: row.symbol == null ? null : String(row.symbol),
    side: row.side == null ? null : String(row.side),
    orderType: row.orderType == null ? null : String(row.orderType),
    timeInForce: row.timeInForce == null ? null : String(row.timeInForce),
    qtyLots: row.qtyLots == null ? null : Number(row.qtyLots),
    requestedPrice: row.requestedPrice == null ? null : Number(row.requestedPrice),
    limitPrice: row.limitPrice == null ? null : Number(row.limitPrice),
    stopPrice: row.stopPrice == null ? null : Number(row.stopPrice),
    takeProfit: row.takeProfit == null ? null : Number(row.takeProfit),
    stopLoss: row.stopLoss == null ? null : Number(row.stopLoss),
    quoteBid: row.quoteBid == null ? null : Number(row.quoteBid),
    quoteAsk: row.quoteAsk == null ? null : Number(row.quoteAsk),
    quoteMid: row.quoteMid == null ? null : Number(row.quoteMid),
    quoteTs,
    quoteTsIso: toIsoFromUnix(quoteTs),
    quoteIsStale: row.quoteIsStale == null ? null : Boolean(row.quoteIsStale),
    riskLimitJson: row.riskLimitJson == null ? null : String(row.riskLimitJson),
    riskObservedJson: row.riskObservedJson == null ? null : String(row.riskObservedJson),
    riskSnapshotJson: row.riskSnapshotJson == null ? null : String(row.riskSnapshotJson),
    payloadJson: row.payloadJson == null ? null : String(row.payloadJson),
    prevHash: row.prevHash == null ? null : String(row.prevHash),
    eventHash: row.eventHash == null ? null : String(row.eventHash),
    username: row.username == null ? null : String(row.username),
    userEmail: row.userEmail == null ? null : String(row.userEmail),
  };
}

function writeCsvRows(
  fd: fs.WriteStream,
  columns: readonly string[],
  rows: Array<Record<string, unknown>>,
): void {
  fd.write("\uFEFF");
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of rows) {
    const values = columns.map((column) => row[column] ?? "");
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
}

async function fetchTradeAuditExportRows(
  filters: TradeAuditExportFilters,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const limit = Math.max(1, Math.min(MAX_TRADE_AUDIT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const clickhouseRows = await queryTradeAuditFromClickHouse({ filters: { ...filters, limit } }).catch((error) => {
    console.warn("[admin-export] trade audit clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (clickhouseRows) {
    return {
      rows: clickhouseRows.rows.map((row) => normalizeTradeAuditExportRow(row)),
      truncated: clickhouseRows.truncated,
    };
  }

  const where: string[] = [];
  const params: any[] = [];
  if (filters.tradeId != null) {
    where.push("ta.trade_id = ?");
    params.push(Math.trunc(filters.tradeId));
  }
  if (filters.eventType && String(filters.eventType).toLowerCase() !== "all") {
    where.push("ta.event_type = ?");
    params.push(String(filters.eventType));
  }
  if (filters.riskResult && String(filters.riskResult).toLowerCase() !== "all") {
    where.push("ta.risk_result = ?");
    params.push(String(filters.riskResult));
  }
  if (filters.correlationId) {
    where.push("ta.correlation_id = ?");
    params.push(String(filters.correlationId));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  params.push(limit + 1);
  const rawRows = await queryAll<any>(
    `
      SELECT
        ta.id AS "id",
        ta.trade_id AS "tradeId",
        ta.event_type AS "eventType",
        ta.event_category AS "eventCategory",
        ta.event_at AS "eventAt",
        ta.event_at_ms AS "eventAtMs",
        ta.correlation_id AS "correlationId",
        ta.order_id AS "orderId",
        ta.execution_id AS "executionId",
        ta.position_id AS "positionId",
        ta.actor_type AS "actorType",
        ta.actor_user_id AS "actorUserId",
        ta.session_id AS "sessionId",
        ta.ip AS "ip",
        ta.user_agent AS "userAgent",
        ta.symbol AS "symbol",
        ta.side AS "side",
        ta.order_type AS "orderType",
        ta.time_in_force AS "timeInForce",
        ta.qty_lots AS "qtyLots",
        ta.notional_usd AS "notionalUsd",
        ta.gross_profit_usd AS "grossProfitUsd",
        ta.net_profit_usd AS "netProfitUsd",
        ta.total_costs_usd AS "totalCostsUsd",
        ta.open_commission_usd AS "openCommissionUsd",
        ta.close_commission_usd AS "closeCommissionUsd",
        ta.open_other_fees_usd AS "openOtherFeesUsd",
        ta.close_other_fees_usd AS "closeOtherFeesUsd",
        ta.financing_accrued_usd AS "financingAccruedUsd",
        ta.swap_accrued_usd AS "swapAccruedUsd",
        ta.overnight_days AS "overnightDays",
        ta.category_snapshot AS "categorySnapshot",
        ta.cost_model_version AS "costModelVersion",
        ta.requested_price AS "requestedPrice",
        ta.trigger_price AS "triggerPrice",
        ta.limit_price AS "limitPrice",
        ta.stop_price AS "stopPrice",
        ta.fill_price AS "fillPrice",
        ta.avg_fill_price AS "avgFillPrice",
        ta.slippage AS "slippage",
        ta.slippage_pips AS "slippagePips",
        ta.slippage_reference AS "slippageReference",
        ta.latency_ms AS "latencyMs",
        ta.quote_ts AS "quoteTs",
        ta.quote_source AS "quoteSource",
        ta.quote_bid AS "quoteBid",
        ta.quote_ask AS "quoteAsk",
        ta.quote_mid AS "quoteMid",
        ta.quote_spread AS "quoteSpread",
        ta.spread_pips AS "spreadPips",
        ta.risk_check_name AS "riskCheckName",
        ta.risk_limit_value AS "riskLimitValue",
        ta.risk_observed_value AS "riskObservedValue",
        ta.risk_result AS "riskResult",
        ta.reason_code AS "reasonCode",
        ta.payload_json AS "payloadJson",
        ta.prev_hash AS "prevHash",
        ta.event_hash AS "eventHash",
        ta.note AS "note",
        t.user_id AS "userId",
        u.username AS "username",
        u.email AS "userEmail",
        s.symbol AS "symbolFromTrade",
        t.notional_usd AS "tradeNotionalUsd",
        t.gross_profit_usd AS "tradeGrossProfitUsd",
        t.net_profit_usd AS "tradeNetProfitUsd",
        t.total_costs_usd AS "tradeTotalCostsUsd",
        t.open_commission_usd AS "tradeOpenCommissionUsd",
        t.close_commission_usd AS "tradeCloseCommissionUsd",
        t.open_other_fees_usd AS "tradeOpenOtherFeesUsd",
        t.close_other_fees_usd AS "tradeCloseOtherFeesUsd",
        t.financing_accrued_usd AS "tradeFinancingAccruedUsd",
        t.swap_accrued_usd AS "tradeSwapAccruedUsd",
        t.overnight_days AS "tradeOvernightDays",
        t.category_snapshot AS "tradeCategorySnapshot",
        t.cost_model_version AS "tradeCostModelVersion"
      FROM trade_audit ta
      LEFT JOIN trades t ON ta.trade_id = t.id
      LEFT JOIN users u ON u.id = t.user_id
      LEFT JOIN symbol_configs s ON s.id = t.symbol_id
      ${whereSql}
      ORDER BY ta.event_at DESC, ta.id DESC
      LIMIT ?::int
    `,
    params,
  );

  const truncated = rawRows.length > limit;
  const sliced = truncated ? rawRows.slice(0, limit) : rawRows;
  return {
    rows: sliced.map((row) => normalizeTradeAuditExportRow(row)),
    truncated,
  };
}

async function fetchOrderIntentAuditExportRows(
  filters: OrderIntentAuditExportFilters,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const limit = Math.max(1, Math.min(MAX_ORDER_INTENT_AUDIT_ROWS, Math.trunc(filters.limit ?? 100_000)));
  const clickhouseRows = await queryOrderIntentAuditFromClickHouse({
    filters: { ...filters, limit },
  }).catch((error) => {
    console.warn("[admin-export] order intent audit clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (clickhouseRows) {
    return {
      rows: clickhouseRows.rows.map((row) => normalizeOrderIntentAuditExportRow(row)),
      truncated: clickhouseRows.truncated,
    };
  }

  const where: string[] = [];
  const params: any[] = [];
  if (filters.correlationId) {
    where.push("oia.correlation_id = ?");
    params.push(String(filters.correlationId));
  }
  if (filters.decision && String(filters.decision).toLowerCase() !== "all") {
    where.push("oia.decision = ?");
    params.push(String(filters.decision));
  }
  if (filters.userId != null) {
    where.push("oia.user_id = ?");
    params.push(Math.trunc(filters.userId));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  params.push(limit + 1);
  const rawRows = await queryAll<any>(
    `
      SELECT
        oia.id AS "id",
        oia.correlation_id AS "correlationId",
        oia.event_at AS "eventAt",
        oia.event_at_ms AS "eventAtMs",
        oia.event_code AS "eventCode",
        oia.decision AS "decision",
        oia.reject_check AS "rejectCheck",
        oia.reject_reason AS "rejectReason",
        oia.actor_type AS "actorType",
        oia.user_id AS "userId",
        oia.session_id AS "sessionId",
        oia.ip AS "ip",
        oia.user_agent AS "userAgent",
        oia.symbol AS "symbol",
        oia.side AS "side",
        oia.order_type AS "orderType",
        oia.time_in_force AS "timeInForce",
        oia.qty_lots AS "qtyLots",
        oia.requested_price AS "requestedPrice",
        oia.limit_price AS "limitPrice",
        oia.stop_price AS "stopPrice",
        oia.take_profit AS "takeProfit",
        oia.stop_loss AS "stopLoss",
        oia.quote_bid AS "quoteBid",
        oia.quote_ask AS "quoteAsk",
        oia.quote_mid AS "quoteMid",
        oia.quote_ts AS "quoteTs",
        oia.quote_is_stale AS "quoteIsStale",
        oia.risk_limit_json AS "riskLimitJson",
        oia.risk_observed_json AS "riskObservedJson",
        oia.risk_snapshot_json AS "riskSnapshotJson",
        oia.payload_json AS "payloadJson",
        oia.prev_hash AS "prevHash",
        oia.event_hash AS "eventHash",
        u.username AS "username",
        u.email AS "userEmail"
      FROM order_intent_audit oia
      LEFT JOIN users u ON u.id = oia.user_id
      ${whereSql}
      ORDER BY oia.event_at DESC, oia.id DESC
      LIMIT ?::int
    `,
    params,
  );

  const truncated = rawRows.length > limit;
  const sliced = truncated ? rawRows.slice(0, limit) : rawRows;
  return {
    rows: sliced.map((row) => normalizeOrderIntentAuditExportRow(row)),
    truncated,
  };
}

async function buildTradeAuditExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as TradeAuditExportFilters;
  const fetched = await fetchTradeAuditExportRows(filters);

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of fetched.rows) {
      writeJsonlLine(fd, row);
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `trade_audit_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: fetched.rows,
      columns: TRADE_AUDIT_EXPORT_COLUMNS,
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `trade_audit_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  writeCsvRows(fd, TRADE_AUDIT_EXPORT_COLUMNS, fetched.rows);
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: fetched.rows.length,
    truncated: fetched.truncated,
    filename: `trade_audit_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildOrderIntentAuditExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as OrderIntentAuditExportFilters;
  const fetched = await fetchOrderIntentAuditExportRows(filters);

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of fetched.rows) {
      writeJsonlLine(fd, row);
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `order_intent_audit_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: fetched.rows,
      columns: ORDER_INTENT_AUDIT_EXPORT_COLUMNS,
    });
    return {
      rowCount: fetched.rows.length,
      truncated: fetched.truncated,
      filename: `order_intent_audit_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  writeCsvRows(fd, ORDER_INTENT_AUDIT_EXPORT_COLUMNS, fetched.rows);
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: fetched.rows.length,
    truncated: fetched.truncated,
    filename: `order_intent_audit_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildAllTradesExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as AllTradesExportFilters;
  const limit = Math.max(1, Math.min(5_000_000, Math.trunc(filters.limit ?? 50_000)));
  let rows = await queryAllTradesFromClickHouse(limit).catch((error) => {
    console.warn("[admin-export] all trades clickhouse query failed; falling back to postgres", error);
    return null;
  });
  if (!rows || rows.length === 0) {
    rows = await queryAll<any>(
      `
        SELECT
          t.id,
          t.user_id AS "userId",
          u.username,
          s.symbol,
          t.type,
          t.status,
          t.lots,
          t.open_price AS "openPrice",
          t.close_price AS "closePrice",
          t.opened_at AS "openedAt",
          t.closed_at AS "closedAt",
          COALESCE(
            t.net_profit_usd,
            CASE
              WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
              WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
              ELSE NULL
            END
          ) AS "netProfitUsd"
        FROM trades t
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN symbol_configs s ON s.id = t.symbol_id
        ORDER BY t.opened_at DESC
        LIMIT $1::int;
      `,
      [limit],
    );
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of rows) {
      const rawUserId = row.userId ?? row.user_id;
      const rawOpenPrice = row.openPrice ?? row.open_price;
      const rawClosePrice = row.closePrice ?? row.close_price;
      const rawOpenedAt = row.openedAt ?? row.opened_at;
      const rawClosedAt = row.closedAt ?? row.closed_at;
      const rawNetProfitUsd = row.netProfitUsd ?? row.net_profit_usd;
      writeJsonlLine(fd, {
        id: Number(row.id),
        userId: Number(rawUserId),
        username: row.username ? String(row.username) : null,
        symbol: row.symbol ? String(row.symbol) : null,
        type: row.type ? String(row.type) : null,
        status: row.status ? String(row.status) : null,
        lots: row.lots != null ? Number(row.lots) : null,
        openPrice: rawOpenPrice == null ? null : Number(rawOpenPrice),
        closePrice: rawClosePrice == null ? null : Number(rawClosePrice),
        openedAt: rawOpenedAt == null ? null : Number(rawOpenedAt),
        closedAt: rawClosedAt == null ? null : Number(rawClosedAt),
        netProfitUsd: rawNetProfitUsd == null ? null : Number(rawNetProfitUsd),
      });
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: rows.length,
      truncated: false,
      filename: `all_trades_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const columns = [
    "id",
    "userId",
    "username",
    "symbol",
    "type",
    "status",
    "lots",
    "openPrice",
    "closePrice",
    "openedAt",
    "closedAt",
    "netProfitUsd",
  ];
  const normalizedRows = rows.map((row) => ({
    id: row.id,
    userId: row.userId ?? row.user_id,
    username: row.username ?? null,
    symbol: row.symbol ?? null,
    type: row.type ?? null,
    status: row.status ?? null,
    lots: row.lots ?? null,
    openPrice: row.openPrice ?? row.open_price ?? null,
    closePrice: row.closePrice ?? row.close_price ?? null,
    openedAt: row.openedAt ?? row.opened_at ?? null,
    closedAt: row.closedAt ?? row.closed_at ?? null,
    netProfitUsd: row.netProfitUsd ?? row.net_profit_usd ?? null,
  }));

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: normalizedRows,
      columns,
      schemaHints: {
        id: "INT64",
        userId: "INT64",
        lots: "DOUBLE",
        openPrice: "DOUBLE",
        closePrice: "DOUBLE",
        openedAt: "INT64",
        closedAt: "INT64",
        netProfitUsd: "DOUBLE",
      },
    });
    return {
      rowCount: normalizedRows.length,
      truncated: false,
      filename: `all_trades_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of normalizedRows) {
    const values = [
      row.id,
      row.userId,
      row.username,
      row.symbol,
      row.type,
      row.status,
      row.lots,
      row.openPrice,
      row.closePrice,
      row.openedAt,
      row.closedAt,
      row.netProfitUsd,
    ];
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: rows.length,
    truncated: false,
    filename: `all_trades_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

async function buildDailyPnlExport(params: {
  request: AdminDataExportCreateRequest;
  outputPath: string;
}): Promise<{ rowCount: number; truncated: boolean; filename: string; contentType: string }> {
  const filters = params.request.filters as DailyPnlExportFilters;
  const limitDays = Math.max(1, Math.min(3650, Math.trunc(filters.limitDays ?? 365)));
  let rows = await queryDailyPnlFromClickHouse(limitDays).catch((error) => {
    console.warn("[admin-export] daily pnl clickhouse query failed; falling back to postgres", error);
    return null;
  });

  if (!rows || rows.length === 0) {
    rows = await queryAll<any>(
      `
        SELECT
          date,
          SUM(profit_day) AS total_profit,
          SUM(trades_closed) AS total_trades,
          SUM(trades_won) AS winning_trades,
          COUNT(DISTINCT user_id) AS active_users
        FROM daily_closes
        GROUP BY date
        ORDER BY date DESC
        LIMIT $1::int
      `,
      [limitDays],
    );
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const row of rows) {
      writeJsonlLine(fd, {
        date: row.date ? String(row.date) : null,
        totalProfit: Number(row.total_profit || 0),
        totalTrades: Number(row.total_trades || 0),
        winningTrades: Number(row.winning_trades || 0),
        activeUsers: Number(row.active_users || 0),
      });
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: rows.length,
      truncated: false,
      filename: `daily_pnl_${Date.now()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const normalizedRows = rows.map((row) => ({
    date: row.date ? String(row.date) : null,
    total_profit: Number(row.total_profit || 0),
    total_trades: Number(row.total_trades || 0),
    winning_trades: Number(row.winning_trades || 0),
    active_users: Number(row.active_users || 0),
  }));

  if (params.request.format === "parquet") {
    await writeParquetRows({
      outputPath: params.outputPath,
      rows: normalizedRows,
      columns: ["date", "total_profit", "total_trades", "winning_trades", "active_users"],
      schemaHints: {
        total_profit: "DOUBLE",
        total_trades: "INT64",
        winning_trades: "INT64",
        active_users: "INT64",
      },
    });
    return {
      rowCount: normalizedRows.length,
      truncated: false,
      filename: `daily_pnl_${Date.now()}.parquet`,
      contentType: PARQUET_CONTENT_TYPE,
    };
  }

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write("date,total_profit,total_trades,winning_trades,active_users\n");
  for (const row of normalizedRows) {
    const values = [
      row.date ?? "",
      row.total_profit,
      row.total_trades,
      row.winning_trades,
      row.active_users,
    ];
    fd.write(values.map(safeCsv).join(","));
    fd.write("\n");
  }
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: rows.length,
    truncated: false,
    filename: `daily_pnl_${Date.now()}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

export async function buildAdminDataExportArtifact(
  params: BuildExportArtifactParams,
): Promise<BuildExportArtifactResult> {
  const dir = ensureTmpDir();
  const ext =
    params.request.format === "jsonl" ? "jsonl" : params.request.format === "parquet" ? "parquet" : "csv";
  const outputPath = path.join(dir, `${params.jobId}.${Date.now()}.${ext}`);

  try {
    if (params.request.type === "users") {
      const built = await buildUsersExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "user_timeline") {
      const built = await buildUserTimelineExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "trader_scouting") {
      const built = await buildTraderScoutingExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "deactivated_accounts") {
      const built = await buildDeactivatedAccountsExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "all_trades") {
      const built = await buildAllTradesExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "daily_pnl") {
      const built = await buildDailyPnlExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "trade_audit") {
      const built = await buildTradeAuditExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    if (params.request.type === "order_intent_audit") {
      const built = await buildOrderIntentAuditExport({
        request: params.request,
        outputPath,
      });
      return {
        filePath: outputPath,
        filename: built.filename,
        contentType: built.contentType,
        rowCount: built.rowCount,
        truncated: built.truncated,
      };
    }

    throw new Error(`Unsupported export type: ${params.request.type}`);
  } catch (err) {
    fs.rmSync(outputPath, { force: true });
    throw err;
  }
}
