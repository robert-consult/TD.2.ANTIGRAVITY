import { dbClient } from "@db";
import { anonymizeUserId } from "../partner/anonymizeUser";

export type AdminScoutCandidateQuery = {
  adminId: number;
  q: string | null;
  stage: string | null;
  minSharpe: number | null;
  minScore: number | null;
  limit: number;
  offset: number;
  cutoffSec: number;
};

export type AdminScoutCandidateResult = {
  userId: number;
  username: string | null;
  email: string | null;
  name: string | null;
  userTier: string | null;
  kycStatus: string | null;
  createdAt: number | null;
  stage: string;
  isPartnerVisible: boolean;
  pipelineNotes: string | null;
  assignedAdminId: number | null;
  lastContactedAt: number | null;
  metrics: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    equityCurveR2: number | null;
    avgMae: number | null;
    avgMfe: number | null;
    styleCluster: string | null;
    compositeScore: number | null;
    calculatedAt: number | null;
  };
  performance: {
    trades: number;
    netProfit: number;
    winRate: number;
  };
  watchlist: {
    id: number;
    tier: string;
    notes: string | null;
  } | null;
};

export type PartnerDataRoomQuery = {
  limit: number;
  offset: number;
  minSharpe: number | null;
  minScore: number | null;
  cutoffSec: number;
};

export type PartnerDataRoomResult = {
  hashId: string;
  styleCluster: string | null;
  metrics: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    equityCurveR2: number | null;
    avgMae: number | null;
    avgMfe: number | null;
    compositeScore: number | null;
    calculatedAt: number | null;
  };
  performance: {
    trades: number;
    netProfit: number;
    winRate: number;
  };
};

type PagedOut<T> = {
  total: number;
  hasMore: boolean;
  rows: T[];
};

function netProfitSqlAlias(alias: string): string {
  return `COALESCE(
    ${alias}.net_profit_usd::numeric,
    CASE
      WHEN ${alias}.profit IS NULL OR btrim(${alias}.profit) = '' THEN 0::numeric
      WHEN ${alias}.profit ~ '^-?\\d+(\\.\\d+)?$' THEN ${alias}.profit::numeric
      ELSE 0::numeric
    END
  )`;
}

function toNumOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function listAdminScoutCandidates(params: AdminScoutCandidateQuery): Promise<PagedOut<AdminScoutCandidateResult>> {
  const netProfitSql = netProfitSqlAlias("t");
  const sqlText = `
    WITH trade_rollup AS (
      SELECT
        t.user_id,
        COUNT(*)::int AS trades,
        SUM(${netProfitSql})::float8 AS net_profit,
        SUM(CASE WHEN ${netProfitSql} > 0 THEN 1 ELSE 0 END)::int AS wins
      FROM trades t
      WHERE t.status = 'CLOSED'
        AND t.closed_at IS NOT NULL
        AND t.closed_at >= $8::int
      GROUP BY t.user_id
    )
    SELECT
      u.id AS user_id,
      u.username,
      u.email,
      u.name,
      u.user_tier,
      u.kyc_status,
      u.created_at,
      COALESCE(rp.stage, 'DETECTED') AS stage,
      COALESCE(rp.is_partner_visible, false) AS is_partner_visible,
      rp.notes AS pipeline_notes,
      rp.assigned_admin_id,
      rp.last_contacted_at,
      sm.sharpe_ratio,
      sm.sortino_ratio,
      sm.calmar_ratio,
      sm.equity_curve_r2,
      sm.avg_mae,
      sm.avg_mfe,
      sm.style_cluster,
      sm.composite_score,
      sm.calculated_at,
      COALESCE(tr.trades, 0) AS trades,
      COALESCE(tr.net_profit, 0) AS net_profit,
      CASE
        WHEN COALESCE(tr.trades, 0) > 0 THEN (COALESCE(tr.wins, 0)::float8 / tr.trades::float8)
        ELSE 0
      END AS win_rate,
      w.id AS watchlist_id,
      w.tier AS watchlist_tier,
      w.notes AS watchlist_notes,
      COUNT(*) OVER()::int AS total_count
    FROM users u
    LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
    LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = u.id
    LEFT JOIN trade_rollup tr ON tr.user_id = u.id
    LEFT JOIN scout_watchlists w ON w.user_id = u.id AND w.admin_id = $1::int
    WHERE u.is_admin = false
      AND u.is_deleted = false
      AND ($2::text IS NULL OR u.email ILIKE $2 OR u.username ILIKE $2 OR COALESCE(u.name, '') ILIKE $2)
      AND ($3::text IS NULL OR COALESCE(rp.stage, 'DETECTED') = $3::text)
      AND ($4::float8 IS NULL OR COALESCE(sm.sharpe_ratio, -1e9) >= $4::float8)
      AND ($5::float8 IS NULL OR COALESCE(sm.composite_score, -1e9) >= $5::float8)
    ORDER BY COALESCE(sm.composite_score, -1e9) DESC, u.id DESC
    LIMIT $6::int OFFSET $7::int
  `;

  const rows = (
    await dbClient.query(sqlText, [
      params.adminId,
      params.q,
      params.stage,
      params.minSharpe,
      params.minScore,
      params.limit,
      params.offset,
      params.cutoffSec,
    ])
  ).rows as any[];

  const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
  const hasMore = params.offset + rows.length < total;

  return {
    total,
    hasMore,
    rows: rows.map((r) => ({
      userId: toNum(r.user_id),
      username: r.username ?? null,
      email: r.email ?? null,
      name: r.name ?? null,
      userTier: r.user_tier ?? null,
      kycStatus: r.kyc_status ?? null,
      createdAt: toNumOrNull(r.created_at),
      stage: r.stage ?? "DETECTED",
      isPartnerVisible: Boolean(r.is_partner_visible),
      pipelineNotes: r.pipeline_notes ?? null,
      assignedAdminId: toNumOrNull(r.assigned_admin_id),
      lastContactedAt: toNumOrNull(r.last_contacted_at),
      metrics: {
        sharpeRatio: toNumOrNull(r.sharpe_ratio),
        sortinoRatio: toNumOrNull(r.sortino_ratio),
        calmarRatio: toNumOrNull(r.calmar_ratio),
        equityCurveR2: toNumOrNull(r.equity_curve_r2),
        avgMae: toNumOrNull(r.avg_mae),
        avgMfe: toNumOrNull(r.avg_mfe),
        styleCluster: r.style_cluster ?? null,
        compositeScore: toNumOrNull(r.composite_score),
        calculatedAt: toNumOrNull(r.calculated_at),
      },
      performance: {
        trades: toNum(r.trades),
        netProfit: toNum(r.net_profit),
        winRate: toNum(r.win_rate),
      },
      watchlist: r.watchlist_id
        ? {
            id: toNum(r.watchlist_id),
            tier: r.watchlist_tier ?? "B_LIST",
            notes: r.watchlist_notes ?? null,
          }
        : null,
    })),
  };
}

export async function listPartnerDataRoomCandidates(params: PartnerDataRoomQuery): Promise<PagedOut<PartnerDataRoomResult>> {
  const netProfitSql = netProfitSqlAlias("t");
  const sqlText = `
    WITH eligible AS (
      SELECT rp.user_id
      FROM recruiting_pipeline rp
      INNER JOIN users u ON u.id = rp.user_id
      WHERE rp.stage = 'PARTNER_READY'
        AND rp.is_partner_visible = true
        AND u.is_admin = false
        AND u.is_disabled = false
        AND u.is_deleted = false
        AND COALESCE(LOWER(u.kyc_status), '') = 'approved'
        AND COALESCE(u.user_tier, 'CANDIDATE') IN ('PERFORMER', 'SELECTED')
    ),
    trade_rollup AS (
      SELECT
        t.user_id,
        COUNT(*)::int AS trades,
        SUM(${netProfitSql})::float8 AS net_profit,
        SUM(CASE WHEN ${netProfitSql} > 0 THEN 1 ELSE 0 END)::int AS wins
      FROM trades t
      INNER JOIN eligible e ON e.user_id = t.user_id
      WHERE t.status = 'CLOSED'
        AND t.closed_at IS NOT NULL
        AND t.closed_at >= $5::int
      GROUP BY t.user_id
    )
    SELECT
      e.user_id,
      sm.sharpe_ratio,
      sm.sortino_ratio,
      sm.calmar_ratio,
      sm.equity_curve_r2,
      sm.avg_mae,
      sm.avg_mfe,
      sm.style_cluster,
      sm.composite_score,
      sm.calculated_at,
      COALESCE(tr.trades, 0) AS trades,
      COALESCE(tr.net_profit, 0) AS net_profit,
      CASE
        WHEN COALESCE(tr.trades, 0) > 0 THEN (COALESCE(tr.wins, 0)::float8 / tr.trades::float8)
        ELSE 0
      END AS win_rate,
      COUNT(*) OVER()::int AS total_count
    FROM eligible e
    LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = e.user_id
    LEFT JOIN trade_rollup tr ON tr.user_id = e.user_id
    WHERE ($1::float8 IS NULL OR COALESCE(sm.sharpe_ratio, -1e9) >= $1::float8)
      AND ($2::float8 IS NULL OR COALESCE(sm.composite_score, -1e9) >= $2::float8)
    ORDER BY COALESCE(sm.composite_score, -1e9) DESC, e.user_id DESC
    LIMIT $3::int OFFSET $4::int
  `;

  const rows = (
    await dbClient.query(sqlText, [params.minSharpe, params.minScore, params.limit, params.offset, params.cutoffSec])
  ).rows as any[];

  const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
  const hasMore = params.offset + rows.length < total;

  return {
    total,
    hasMore,
    rows: rows.map((r) => ({
      hashId: anonymizeUserId(toNum(r.user_id)),
      styleCluster: r.style_cluster ?? null,
      metrics: {
        sharpeRatio: toNumOrNull(r.sharpe_ratio),
        sortinoRatio: toNumOrNull(r.sortino_ratio),
        calmarRatio: toNumOrNull(r.calmar_ratio),
        equityCurveR2: toNumOrNull(r.equity_curve_r2),
        avgMae: toNumOrNull(r.avg_mae),
        avgMfe: toNumOrNull(r.avg_mfe),
        compositeScore: toNumOrNull(r.composite_score),
        calculatedAt: toNumOrNull(r.calculated_at),
      },
      performance: {
        trades: toNum(r.trades),
        netProfit: toNum(r.net_profit),
        winRate: toNum(r.win_rate),
      },
    })),
  };
}
