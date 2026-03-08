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

export const MAX_DEACTIVATED_USERS = 200_000;
export const MAX_USERS_EXPORT_ROWS = 5_000_000;
export const MAX_USER_TIMELINE_ROWS = 5_000_000;
export const MAX_TRADE_AUDIT_ROWS = 5_000_000;
export const MAX_ORDER_INTENT_AUDIT_ROWS = 5_000_000;
export const TRADER_SCOUT_FETCH_CHUNK = 5000;
export const TRADE_FETCH_CHUNK = 5000;
export const USER_EXPORT_FETCH_CHUNK = 5000;
export const PARQUET_CONTENT_TYPE = "application/vnd.apache.parquet";

export function ensureTmpDir(): string {
  const dir = path.join(os.tmpdir(), "tradehub-admin-data-exports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function nowIsoDateTag(): string {
  return new Date().toISOString().slice(0, 10);
}

export function convertQuestionMarks(sqlText: string): string {
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

export async function queryAll<T = any>(sqlText: string, args: any[] = []): Promise<T[]> {
  const res = await dbClient.query(convertQuestionMarks(sqlText), args);
  return res.rows as T[];
}

export function toUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function safeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
  const neutralized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replaceAll("\"", "\"\"")}"`;
  }
  return neutralized;
}

export function writeJsonlLine(fd: fs.WriteStream, row: Record<string, unknown>): void {
  fd.write(JSON.stringify(row));
  fd.write("\n");
}

export type ParquetFieldType = "UTF8" | "DOUBLE" | "INT64" | "BOOLEAN";

export function sanitizeParquetValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return JSON.stringify(value);
}

export function inferParquetFieldType(value: unknown): ParquetFieldType {
  const cleaned = sanitizeParquetValue(value);
  if (cleaned == null) return "UTF8";
  if (typeof cleaned === "boolean") return "BOOLEAN";
  if (typeof cleaned === "number") {
    return Number.isInteger(cleaned) ? "INT64" : "DOUBLE";
  }
  return "UTF8";
}

export async function writeParquetRows(params: {
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

export async function writeStreamChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
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

export async function closeWriteStream(stream: fs.WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.once("error", reject);
  });
}

export type StreamingExportWriter = {
  writeRow: (row: Record<string, unknown>) => Promise<void>;
  close: () => Promise<void>;
};

export async function createStreamingExportWriter(params: {
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

export function formatSessionLength(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "";
  const normalized = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(normalized / 3600);
  const mins = Math.floor((normalized % 3600) / 60);
  const secs = normalized % 60;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function exportFileMeta(
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

export function toInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

export function toIsoFromUnix(value: unknown): string | null {
  const n = toInt(value);
  if (n == null || n <= 0) return null;
  const sec = n > 1e12 ? Math.floor(n / 1000) : n;
  const date = new Date(sec * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export const LEGACY_TRADE_PROFIT_NUMERIC_SQL = `
  CASE
    WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
    WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
    ELSE 0::numeric
  END
`;

export const TRADE_NET_PROFIT_SQL = `
  COALESCE(
    t.net_profit_usd::numeric,
    ${LEGACY_TRADE_PROFIT_NUMERIC_SQL}
  )
`;

export const TRADER_SCOUT_CATEGORY_SQL = `
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

export const TRADER_SCOUT_SEARCH_SQL = `
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

export function buildDeactivatedAccountsCte(cutoff: number | null, params: any[]): string {
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

export function normalizeTraderScoutingExportRow(row: any): Record<string, unknown> {
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

export async function buildTraderScoutingExport(params: {
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

export async function buildDeactivatedAccountsExport(params: {
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

