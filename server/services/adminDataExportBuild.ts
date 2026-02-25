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
  TraderScoutingExportFilters,
} from "@shared/admin/dataExports";
import {
  queryAllTradesFromClickHouse,
  queryDailyPnlFromClickHouse,
  queryDeactivatedAccountsFromClickHouse,
  queryTraderScoutingFromClickHouse,
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

const MAX_TRADER_SCOUT_ROWS = 200_000;
const MAX_DEACTIVATED_USERS = 200_000;
const TRADE_FETCH_CHUNK = 5000;

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

  const exportLimit = Math.max(1, Math.min(MAX_TRADER_SCOUT_ROWS, Math.trunc(filters.exportLimit ?? 5000)));
  const q = filters.q && filters.q.trim() ? `%${filters.q.trim().slice(0, 200)}%` : null;

  let truncated = false;
  let sliced: any[] = [];

  const clickhouseResult = await queryTraderScoutingFromClickHouse({
    filters,
    cutoffSec,
    exportLimit,
  }).catch((error) => {
    console.warn("[admin-export] trader scouting clickhouse query failed; falling back to postgres", error);
    return null;
  });

  if (clickhouseResult) {
    sliced = clickhouseResult.rows;
    truncated = clickhouseResult.truncated;
  } else {
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
      exportLimit + 1,
      0,
    ]);

    truncated = rows.length > exportLimit;
    sliced = truncated ? rows.slice(0, exportLimit) : rows;
  }

  if (params.request.format === "jsonl") {
    const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
    for (const r of sliced) {
      writeJsonlLine(fd, {
        userId: Number(r.user_id),
        username: r.username ?? null,
        email: r.email ?? null,
        trades: Number(r.trades ?? 0),
        winRate: Number(r.win_rate ?? 0),
        netProfit: Number(r.net_profit ?? 0),
        grossProfit: Number(r.gross_profit ?? 0),
        grossLoss: Number(r.gross_loss ?? 0),
        profitFactor: r.profit_factor == null ? null : Number(r.profit_factor),
        avgHoldSec: r.avg_hold_sec == null ? null : Number(r.avg_hold_sec),
        maxHoldSec: r.max_hold_sec == null ? null : Number(r.max_hold_sec),
        minHoldSec: r.min_hold_sec == null ? null : Number(r.min_hold_sec),
        maxDrawdown: r.max_drawdown == null ? null : Number(r.max_drawdown),
        bestDayPct: r.best_day_pct == null ? null : Number(r.best_day_pct),
        slUsage: r.sl_usage == null ? null : Number(r.sl_usage),
        tpUsage: r.tp_usage == null ? null : Number(r.tp_usage),
        assetMix: r.asset_mix ?? null,
      });
    }
    await new Promise<void>((resolve, reject) => {
      fd.end(() => resolve());
      fd.on("error", reject);
    });
    return {
      rowCount: sliced.length,
      truncated,
      filename: `trader-scout-${days}d-${nowIsoDateTag()}.jsonl`,
      contentType: "application/x-ndjson",
    };
  }

  const header = [
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
  ];

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write(header.join(","));
  fd.write("\n");
  for (const r of sliced) {
    const row = [
      Number(r.user_id),
      r.username ?? "",
      r.email ?? "",
      Number(r.trades ?? 0),
      Number(r.win_rate ?? 0),
      Number(r.net_profit ?? 0),
      Number(r.gross_profit ?? 0),
      Number(r.gross_loss ?? 0),
      r.profit_factor == null ? "" : Number(r.profit_factor),
      r.avg_hold_sec == null ? "" : Number(r.avg_hold_sec),
      r.max_hold_sec == null ? "" : Number(r.max_hold_sec),
      r.min_hold_sec == null ? "" : Number(r.min_hold_sec),
      r.max_drawdown == null ? "" : Number(r.max_drawdown),
      r.best_day_pct == null ? "" : Number(r.best_day_pct),
      r.sl_usage == null ? "" : Number(r.sl_usage),
      r.tp_usage == null ? "" : Number(r.tp_usage),
      r.asset_mix ?? "",
    ];
    fd.write(row.map(safeCsv).join(","));
    fd.write("\n");
  }
  await new Promise<void>((resolve, reject) => {
    fd.end(() => resolve());
    fd.on("error", reject);
  });
  return {
    rowCount: sliced.length,
    truncated,
    filename: `trader-scout-${days}d-${nowIsoDateTag()}.csv`,
    contentType: "text/csv; charset=utf-8",
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
            THEN ROUND((COALESCE(ts."winningTrades", 0)::float / ts."closedTrades") * 100, 2)
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

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
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
  fd.write(columns.join(","));
  fd.write("\n");

  for (const user of exportUsers) {
    const userTrades = includeTrades ? tradesByUser.get(user.userId) ?? [] : [];
    const actionAtIso = user.actionAt ? new Date(user.actionAt * 1000).toISOString() : "";
    if (userTrades.length === 0) {
      const row = [
        user.userId,
        user.username ?? "",
        user.email ?? "",
        user.actionType,
        actionAtIso,
        user.reasonCode ?? "",
        user.reasonText ?? "",
        user.profitUsd,
        user.trades,
        user.winRatePct,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ];
      fd.write(row.map(safeCsv).join(","));
      fd.write("\n");
      continue;
    }

    for (const trade of userTrades) {
      const row = [
        user.userId,
        user.username ?? "",
        user.email ?? "",
        user.actionType,
        actionAtIso,
        user.reasonCode ?? "",
        user.reasonText ?? "",
        user.profitUsd,
        user.trades,
        user.winRatePct,
        Number(trade.tradeId),
        trade.symbol ?? "",
        trade.type ?? "",
        trade.status ?? "",
        trade.lots ?? "",
        trade.openPrice ?? "",
        trade.closePrice ?? "",
        trade.netProfitUsd ?? trade.profit ?? "",
        trade.totalCostsUsd ?? "",
        trade.openCommissionUsd ?? "",
        trade.closeCommissionUsd ?? "",
        trade.financingAccruedUsd ?? "",
        trade.swapAccruedUsd ?? "",
        trade.overnightDays ?? "",
        trade.openedAt ?? "",
        trade.closedAt ?? "",
      ];
      fd.write(row.map(safeCsv).join(","));
      fd.write("\n");
    }
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

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
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
  fd.write(columns.join(","));
  fd.write("\n");
  for (const row of rows) {
    const values = [
      row.id,
      row.userId ?? row.user_id,
      row.username,
      row.symbol,
      row.type,
      row.status,
      row.lots,
      row.openPrice ?? row.open_price,
      row.closePrice ?? row.close_price,
      row.openedAt ?? row.opened_at,
      row.closedAt ?? row.closed_at,
      row.netProfitUsd ?? row.net_profit_usd,
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

  const fd = fs.createWriteStream(params.outputPath, { encoding: "utf8" });
  fd.write("\uFEFF");
  fd.write("date,total_profit,total_trades,winning_trades,active_users\n");
  for (const row of rows) {
    const values = [
      row.date ? String(row.date) : "",
      Number(row.total_profit || 0),
      Number(row.total_trades || 0),
      Number(row.winning_trades || 0),
      Number(row.active_users || 0),
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
  const ext = params.request.format === "jsonl" ? "jsonl" : "csv";
  const outputPath = path.join(dir, `${params.jobId}.${Date.now()}.${ext}`);

  try {
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

    throw new Error(`Unsupported export type: ${params.request.type}`);
  } catch (err) {
    fs.rmSync(outputPath, { force: true });
    throw err;
  }
}
