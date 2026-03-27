import { dbClient } from "@db";
import { nowSec } from "@shared/scalars";
import { withObservedBackgroundJob } from "../observability/business";

export type AdminDataRollupMetricKey =
  | "kpi_summary"
  | "signup_funnel"
  | "user_analytics"
  | "compliance"
  | "deactivated_summary";

type CacheState = "fresh" | "recomputed";

type RollupRow = {
  metric_key: string;
  window_days: number;
  computed_at: number;
  data_json: string;
};

type RollupComputeResult = {
  data: unknown;
  computedAt: number;
};

type GetOrRefreshRollupParams = {
  metricKey: AdminDataRollupMetricKey;
  windowDays: number;
  maxAgeSec: number;
  forceRefresh?: boolean;
  refreshedByRole?: string;
};

export type GetOrRefreshRollupResult<T> = {
  data: T;
  asOfSec: number;
  cacheState: CacheState;
};

const DEFAULT_REFRESH_SEC = 15 * 60;
const DEFAULT_WINDOWS = [7, 30, 90];
let rollupSchedulerHandle: NodeJS.Timeout | null = null;

type AdminDataRollupMetricsState = {
  runningGauge: number;
  lastRunAtSec: number;
  lastSuccessAtSec: number;
  lastFailureAtSec: number;
  lastDurationMs: number;
  refreshTotal: number;
  refreshFailedTotal: number;
  recomputeTotal: number;
  lastRefreshedMetricCount: number;
};

const rollupMetrics: AdminDataRollupMetricsState = {
  runningGauge: 0,
  lastRunAtSec: 0,
  lastSuccessAtSec: 0,
  lastFailureAtSec: 0,
  lastDurationMs: 0,
  refreshTotal: 0,
  refreshFailedTotal: 0,
  recomputeTotal: 0,
  lastRefreshedMetricCount: 0,
};

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

function clampDays(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(365, Math.trunc(raw)));
}

function parseJsonObject(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function queryOne<T = any>(sqlText: string, args: any[] = []): Promise<T | null> {
  const res = await dbClient.query(sqlText, args);
  return (res.rows?.[0] as T | undefined) ?? null;
}

async function queryAll<T = any>(sqlText: string, args: any[] = []): Promise<T[]> {
  const res = await dbClient.query(sqlText, args);
  return (res.rows ?? []) as T[];
}

async function getRollupRow(metricKey: AdminDataRollupMetricKey, windowDays: number): Promise<RollupRow | null> {
  return queryOne<RollupRow>(
    `
      SELECT metric_key, window_days, computed_at, data_json
      FROM admin_data_rollups
      WHERE metric_key = $1
        AND window_days = $2
      LIMIT 1
    `,
    [metricKey, windowDays],
  );
}

async function upsertRollupRow(params: {
  metricKey: AdminDataRollupMetricKey;
  windowDays: number;
  computedAt: number;
  data: unknown;
  source: string;
  refreshedByRole: string;
}): Promise<void> {
  await dbClient.query(
    `
      INSERT INTO admin_data_rollups (
        metric_key,
        window_days,
        computed_at,
        data_json,
        source,
        refreshed_by_role
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (metric_key, window_days)
      DO UPDATE SET
        computed_at = EXCLUDED.computed_at,
        data_json = EXCLUDED.data_json,
        source = EXCLUDED.source,
        refreshed_by_role = EXCLUDED.refreshed_by_role
    `,
    [
      params.metricKey,
      params.windowDays,
      params.computedAt,
      JSON.stringify(params.data ?? {}),
      params.source,
      params.refreshedByRole,
    ],
  );
}

async function computeKpiSummary(windowDays: number): Promise<RollupComputeResult> {
  const computedAt = nowSec();
  const cutoff = windowDays === 0 ? 0 : computedAt - windowDays * 86400;

  const row = await queryOne<any>(
    `
      WITH user_counts AS (
        SELECT COUNT(*)::int AS total_users
        FROM users u
        WHERE COALESCE(u.is_admin, FALSE) = FALSE
      ),
      period_trades AS (
        SELECT
          t.user_id,
          COALESCE(t.lots, 0)::numeric AS lots,
          ${TRADE_NET_PROFIT_SQL} AS net_profit
        FROM trades t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.status = 'CLOSED'
          AND COALESCE(u.is_admin, FALSE) = FALSE
          AND ($1::int = 0 OR COALESCE(t.opened_at, 0) >= $1::int)
      )
      SELECT
        uc.total_users AS total_users,
        COUNT(pt.user_id)::int AS total_trades,
        COUNT(DISTINCT pt.user_id)::int AS active_traders,
        COALESCE(ROUND(SUM(pt.lots * 100000::numeric), 0), 0)::numeric AS total_volume,
        COALESCE(ROUND(SUM(pt.net_profit), 2), 0)::numeric AS total_pnl,
        COALESCE(
          ROUND(
            (SUM(CASE WHEN pt.net_profit > 0 THEN 1 ELSE 0 END)::numeric * 100.0)
            / NULLIF(COUNT(pt.user_id), 0),
            1
          ),
          0
        )::numeric AS avg_win_rate
      FROM user_counts uc
      LEFT JOIN period_trades pt ON TRUE
      GROUP BY uc.total_users
    `,
    [cutoff],
  );

  return {
    computedAt,
    data: {
      totalUsers: Number(row?.total_users || 0),
      activeTraders: Number(row?.active_traders || 0),
      totalTrades: Number(row?.total_trades || 0),
      totalVolume: Number(row?.total_volume || 0),
      totalPnL: Number(row?.total_pnl || 0),
      avgWinRate: Number(row?.avg_win_rate || 0),
    },
  };
}

async function computeSignupFunnel(windowDays: number): Promise<RollupComputeResult> {
  const computedAt = nowSec();
  const cutoff = windowDays === 0 ? 0 : computedAt - windowDays * 86400;

  const row = await queryOne<any>(
    `
      WITH filtered_users AS (
        SELECT
          u.id,
          u.username,
          u.phone,
          COALESCE(u.created_at, 0) AS created_at
        FROM users u
        WHERE COALESCE(u.is_admin, FALSE) = FALSE
          AND ($1::int = 0 OR COALESCE(u.created_at, 0) >= $1::int)
      ),
      user_trade_stats AS (
        SELECT
          fu.id AS user_id,
          COUNT(*) FILTER (WHERE t.status = 'CLOSED')::int AS closed_trades,
          COALESCE(
            SUM(
              CASE
                WHEN t.status = 'CLOSED' THEN ${TRADE_NET_PROFIT_SQL}
                ELSE 0::numeric
              END
            ),
            0::numeric
          ) AS total_profit
        FROM filtered_users fu
        LEFT JOIN trades t ON t.user_id = fu.id
        GROUP BY fu.id
      )
      SELECT
        COUNT(*)::int AS total_signups,
        COUNT(*) FILTER (
          WHERE NULLIF(btrim(COALESCE(fu.username, '')), '') IS NOT NULL
            AND NULLIF(btrim(COALESCE(fu.phone, '')), '') IS NOT NULL
        )::int AS completed_profiles,
        COUNT(*) FILTER (WHERE uts.closed_trades > 0)::int AS first_trade,
        COUNT(*) FILTER (WHERE uts.closed_trades >= 10)::int AS ten_trades,
        COUNT(*) FILTER (WHERE uts.closed_trades >= 10 AND uts.total_profit > 0)::int AS profitable
      FROM filtered_users fu
      LEFT JOIN user_trade_stats uts ON uts.user_id = fu.id
    `,
    [cutoff],
  );

  return {
    computedAt,
    data: {
      totalSignups: Number(row?.total_signups || 0),
      completedProfiles: Number(row?.completed_profiles || 0),
      firstTrade: Number(row?.first_trade || 0),
      tenTrades: Number(row?.ten_trades || 0),
      profitable: Number(row?.profitable || 0),
    },
  };
}

async function computeUserAnalytics(windowDays: number): Promise<RollupComputeResult> {
  const computedAt = nowSec();
  const oneDayAgo = computedAt - 86400;
  const sevenDaysAgo = computedAt - 7 * 86400;
  const thirtyDaysAgo = computedAt - 30 * 86400;
  const analyticsCutoff = windowDays > 0 ? computedAt - windowDays * 86400 : 0;

  const row = await queryOne<any>(
    `
      WITH non_admin_users AS (
        SELECT
          u.id,
          COALESCE(u.created_at, 0) AS created_at
        FROM users u
        WHERE COALESCE(u.is_admin, FALSE) = FALSE
      ),
      activity AS (
        SELECT
          COUNT(DISTINCT CASE WHEN l.success = TRUE AND COALESCE(l.created_at, 0) >= $1::int THEN l.user_id END)::int AS active_daily,
          COUNT(DISTINCT CASE WHEN l.success = TRUE AND COALESCE(l.created_at, 0) >= $2::int THEN l.user_id END)::int AS active_weekly,
          COUNT(DISTINCT CASE WHEN l.success = TRUE AND COALESCE(l.created_at, 0) >= $3::int THEN l.user_id END)::int AS active_monthly,
          AVG(
            CASE
              WHEN l.success = TRUE
                AND l.session_length_sec IS NOT NULL
                AND l.session_length_sec >= 0
                AND ($4::int = 0 OR COALESCE(l.created_at, 0) >= $4::int)
              THEN l.session_length_sec::numeric
              ELSE NULL
            END
          ) AS avg_session_sec
        FROM user_login_history l
      ),
      trade_stats AS (
        SELECT COUNT(*)::numeric AS closed_trade_count
        FROM trades t
        INNER JOIN non_admin_users u ON u.id = t.user_id
        WHERE t.status = 'CLOSED'
      ),
      retention_source AS (
        SELECT
          u.id AS user_id,
          u.created_at,
          MAX(
            CASE
              WHEN l.success = TRUE AND COALESCE(l.created_at, 0) > u.created_at + (7 * 86400) THEN 1
              ELSE 0
            END
          ) AS returned_d7,
          MAX(
            CASE
              WHEN l.success = TRUE AND COALESCE(l.created_at, 0) > u.created_at + (30 * 86400) THEN 1
              ELSE 0
            END
          ) AS returned_d30
        FROM non_admin_users u
        LEFT JOIN user_login_history l ON l.user_id = u.id
        GROUP BY u.id, u.created_at
      ),
      retention AS (
        SELECT
          COUNT(*) FILTER (WHERE rs.created_at <= $5::int - (7 * 86400))::int AS eligible_7,
          COUNT(*) FILTER (WHERE rs.created_at <= $5::int - (30 * 86400))::int AS eligible_30,
          COALESCE(
            SUM(
              CASE
                WHEN rs.created_at <= $5::int - (7 * 86400) AND rs.returned_d7 = 1 THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS returned_7,
          COALESCE(
            SUM(
              CASE
                WHEN rs.created_at <= $5::int - (30 * 86400) AND rs.returned_d30 = 1 THEN 1
                ELSE 0
              END
            ),
            0
          )::int AS returned_30
        FROM retention_source rs
      )
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM non_admin_users), 0) AS total_users,
        a.active_daily,
        a.active_weekly,
        a.active_monthly,
        COALESCE(a.avg_session_sec, 0)::numeric AS avg_session_sec,
        COALESCE(ts.closed_trade_count, 0)::numeric AS closed_trade_count,
        r.eligible_7,
        r.eligible_30,
        r.returned_7,
        r.returned_30
      FROM activity a
      CROSS JOIN trade_stats ts
      CROSS JOIN retention r
    `,
    [oneDayAgo, sevenDaysAgo, thirtyDaysAgo, analyticsCutoff, computedAt],
  );

  const totalUsers = Number(row?.total_users || 0);
  const avgSessionMinutesRaw = Number(row?.avg_session_sec || 0) / 60;
  const avgSessionMinutes = Number.isFinite(avgSessionMinutesRaw) ? avgSessionMinutesRaw : 0;
  const avgTradesPerUser = totalUsers > 0 ? Number(row?.closed_trade_count || 0) / totalUsers : 0;
  const eligibleFor7Day = Number(row?.eligible_7 || 0);
  const eligibleFor30Day = Number(row?.eligible_30 || 0);
  const signupsWith7DayReturn = Number(row?.returned_7 || 0);
  const signupsWith30DayReturn = Number(row?.returned_30 || 0);
  const retentionD7 = eligibleFor7Day > 0 ? (signupsWith7DayReturn / eligibleFor7Day) * 100 : 0;
  const retentionD30 = eligibleFor30Day > 0 ? (signupsWith30DayReturn / eligibleFor30Day) * 100 : 0;

  return {
    computedAt,
    data: {
      activeDaily: Number(row?.active_daily || 0),
      activeWeekly: Number(row?.active_weekly || 0),
      activeMonthly: Number(row?.active_monthly || 0),
      avgSessionMinutes: Math.round(avgSessionMinutes * 10) / 10,
      avgTradesPerUser: Math.round(avgTradesPerUser * 10) / 10,
      retentionD7: Math.round(retentionD7 * 10) / 10,
      retentionD30: Math.round(retentionD30 * 10) / 10,
    },
  };
}

async function computeCompliance(): Promise<RollupComputeResult> {
  const computedAt = nowSec();
  const fourteenDaysAgo = computedAt - 14 * 86400;

  const row = await queryOne<any>(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE kyc_status = 'approved'
            AND kyc_verified_at IS NOT NULL
            AND kyc_verified_at >= $1::int
        )::int AS verified_within_14_days,
        COUNT(*) FILTER (
          WHERE kyc_status = 'reverify_required'
             OR (kyc_status = 'approved' AND kyc_expires_at IS NOT NULL AND kyc_expires_at < $2::int)
        )::int AS overdue_reverify,
        COUNT(*) FILTER (
          WHERE COALESCE(is_disabled, FALSE) = TRUE
             OR COALESCE(is_frozen, FALSE) = TRUE
        )::int AS locked_accounts,
        COUNT(*) FILTER (
          WHERE kyc_status = 'pending'
        )::int AS pending_kyc,
        COUNT(*)::int AS total_users
      FROM users
    `,
    [fourteenDaysAgo, computedAt],
  );

  return {
    computedAt,
    data: {
      verifiedWithin14Days: Number(row?.verified_within_14_days || 0),
      overdueReverify: Number(row?.overdue_reverify || 0),
      lockedAccounts: Number(row?.locked_accounts || 0),
      pendingKyc: Number(row?.pending_kyc || 0),
      totalUsers: Number(row?.total_users || 0),
    },
  };
}

async function computeDeactivatedSummary(windowDays: number): Promise<RollupComputeResult> {
  const computedAt = nowSec();
  const cutoff = windowDays > 0 ? computedAt - windowDays * 86400 : 0;

  const summaryRow = await queryOne<any>(
    `
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
          AND ($1::int = 0 OR e.created_at >= $1::int)
      ),
      latest AS (
        SELECT * FROM latest_events WHERE rn = 1
      ),
      trade_stats AS (
        SELECT
          t.user_id AS "userId",
          COUNT(*) FILTER (WHERE t.status = 'CLOSED') AS "closedTrades",
          SUM(CASE WHEN t.status = 'CLOSED' THEN ${TRADE_NET_PROFIT_SQL} ELSE 0 END) AS "profit",
          SUM(CASE WHEN t.status = 'CLOSED' AND ${TRADE_NET_PROFIT_SQL} > 0 THEN 1 ELSE 0 END) AS "winningTrades"
        FROM trades t
        GROUP BY t.user_id
      )
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN l."eventType" = 'ACCOUNT_SELF_DEACTIVATED' THEN 1 ELSE 0 END) AS deactivated,
        SUM(CASE WHEN l."eventType" = 'ACCOUNT_SELF_DELETED' THEN 1 ELSE 0 END) AS deleted,
        COALESCE(AVG(COALESCE(ts."profit", 0)), 0) AS avg_profit,
        COALESCE(AVG(COALESCE(ts."closedTrades", 0)), 0) AS avg_trades,
        COALESCE(
          AVG(
            CASE
              WHEN COALESCE(ts."closedTrades", 0) > 0
                THEN (COALESCE(ts."winningTrades", 0)::float / ts."closedTrades") * 100
              ELSE 0
            END
          ),
          0
        ) AS avg_win_rate
      FROM latest l
      LEFT JOIN trade_stats ts ON ts."userId" = l."userId"
    `,
    [cutoff],
  );

  const reasonsRows = await queryAll<any>(
    `
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
          AND ($1::int = 0 OR e.created_at >= $1::int)
      ),
      latest AS (
        SELECT * FROM latest_events WHERE rn = 1
      )
      SELECT
        l."reasonCode" AS "reasonCode",
        l."reasonText" AS "reasonText",
        COUNT(*) AS count
      FROM latest l
      GROUP BY l."reasonCode", l."reasonText"
      ORDER BY COUNT(*) DESC
    `,
    [cutoff],
  );

  const topRows = await queryAll<any>(
    `
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
          AND ($1::int = 0 OR e.created_at >= $1::int)
      ),
      latest AS (
        SELECT * FROM latest_events WHERE rn = 1
      ),
      trade_stats AS (
        SELECT
          t.user_id AS "userId",
          COUNT(*) FILTER (WHERE t.status = 'CLOSED') AS "closedTrades",
          SUM(CASE WHEN t.status = 'CLOSED' THEN ${TRADE_NET_PROFIT_SQL} ELSE 0 END) AS "profit",
          SUM(CASE WHEN t.status = 'CLOSED' AND ${TRADE_NET_PROFIT_SQL} > 0 THEN 1 ELSE 0 END) AS "winningTrades"
        FROM trades t
        GROUP BY t.user_id
      )
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
            THEN ROUND(
              (COALESCE(ts."winningTrades", 0)::numeric / NULLIF(ts."closedTrades", 0)::numeric) * 100::numeric,
              2
            )
          ELSE 0
        END AS "winRate"
      FROM latest l
      JOIN users u ON u.id = l."userId"
      LEFT JOIN trade_stats ts ON ts."userId" = l."userId"
      ORDER BY "profit" DESC NULLS LAST, l."actionAt" DESC
      LIMIT 5
    `,
    [cutoff],
  );

  return {
    computedAt,
    data: {
      totals: {
        total: Number(summaryRow?.total || 0),
        deactivated: Number(summaryRow?.deactivated || 0),
        deleted: Number(summaryRow?.deleted || 0),
      },
      averages: {
        profitUsd: Number(summaryRow?.avg_profit || 0),
        trades: Number(summaryRow?.avg_trades || 0),
        winRatePct: Number(summaryRow?.avg_win_rate || 0),
      },
      reasons: reasonsRows.map((row: any) => ({
        reasonCode: row.reasonCode ? String(row.reasonCode) : null,
        reasonText: row.reasonText ? String(row.reasonText) : null,
        count: Number(row.count || 0),
      })),
      top: topRows.map((row: any) => ({
        userId: Number(row.userId),
        username: row.username ? String(row.username) : null,
        email: row.email ? String(row.email) : null,
        mode: row.eventType === "ACCOUNT_SELF_DELETED" ? "DELETED" : "DEACTIVATED",
        reasonCode: row.reasonCode ? String(row.reasonCode) : null,
        reasonText: row.reasonText ? String(row.reasonText) : null,
        profitUsd: Number(row.profit || 0),
        trades: Number(row.trades || 0),
        winRatePct: Number(row.winRate || 0),
        actionAt: row.actionAt ? Number(row.actionAt) : null,
      })),
    },
  };
}

async function computeMetric(metricKey: AdminDataRollupMetricKey, windowDays: number): Promise<RollupComputeResult> {
  if (metricKey === "kpi_summary") return computeKpiSummary(windowDays);
  if (metricKey === "signup_funnel") return computeSignupFunnel(windowDays);
  if (metricKey === "user_analytics") return computeUserAnalytics(windowDays);
  if (metricKey === "compliance") return computeCompliance();
  return computeDeactivatedSummary(windowDays);
}

export async function getOrRefreshAdminDataRollup<T>(params: GetOrRefreshRollupParams): Promise<GetOrRefreshRollupResult<T>> {
  const windowDays = clampDays(params.windowDays, 0);
  const maxAgeSec = Math.max(15, Math.min(3600, Math.trunc(params.maxAgeSec || 300)));
  const now = nowSec();

  if (!params.forceRefresh) {
    const existing = await getRollupRow(params.metricKey, windowDays);
    if (existing && now - Number(existing.computed_at || 0) <= maxAgeSec) {
      const parsed = parseJsonObject(existing.data_json);
      if (parsed !== null) {
        return {
          data: parsed as T,
          asOfSec: Number(existing.computed_at || now),
          cacheState: "fresh",
        };
      }
    }
  }

  const computed = await computeMetric(params.metricKey, windowDays);
  rollupMetrics.recomputeTotal += 1;
  await upsertRollupRow({
    metricKey: params.metricKey,
    windowDays,
    computedAt: computed.computedAt,
    data: computed.data,
    source: "sql",
    refreshedByRole: params.refreshedByRole || "runtime",
  });

  return {
    data: computed.data as T,
    asOfSec: computed.computedAt,
    cacheState: "recomputed",
  };
}

function parseRollupRefreshSec(): number {
  const parsed = Number(process.env.ADMIN_DATA_ROLLUP_REFRESH_SEC ?? DEFAULT_REFRESH_SEC);
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_SEC;
  return Math.max(60, Math.min(24 * 3600, Math.trunc(parsed)));
}

function parseRollupWindows(): number[] {
  const raw = String(process.env.ADMIN_DATA_ROLLUP_WINDOWS ?? "").trim();
  if (!raw) return DEFAULT_WINDOWS;
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const parsed = Number(part.trim());
    if (!Number.isFinite(parsed)) continue;
    set.add(clampDays(parsed, 30));
  }
  const out = Array.from(set.values()).sort((a, b) => a - b);
  return out.length ? out : DEFAULT_WINDOWS;
}

export async function refreshAdminDataRollups(params?: { refreshedByRole?: string }): Promise<void> {
  const startedAtMs = Date.now();
  const role = params?.refreshedByRole || "worker";
  return withObservedBackgroundJob({
    job: "admin_rollup_refresh",
    spanName: "admin.rollups.refresh",
    attributes: {
      "tradehub.refreshed_by_role": role,
    },
    fn: async () => {
      rollupMetrics.runningGauge = 1;
      rollupMetrics.lastRunAtSec = Math.floor(startedAtMs / 1000);
      rollupMetrics.refreshTotal += 1;

      const windows = parseRollupWindows();
      const metricsWithWindow: AdminDataRollupMetricKey[] = [
        "kpi_summary",
        "signup_funnel",
        "user_analytics",
        "deactivated_summary",
      ];

      let refreshedCount = 0;
      try {
        for (const windowDays of windows) {
          for (const metricKey of metricsWithWindow) {
            await getOrRefreshAdminDataRollup({
              metricKey,
              windowDays,
              maxAgeSec: 1,
              forceRefresh: true,
              refreshedByRole: role,
            });
            refreshedCount += 1;
          }
        }

        await getOrRefreshAdminDataRollup({
          metricKey: "compliance",
          windowDays: 0,
          maxAgeSec: 1,
          forceRefresh: true,
          refreshedByRole: role,
        });
        refreshedCount += 1;
        rollupMetrics.lastSuccessAtSec = nowSec();
      } catch (error) {
        rollupMetrics.refreshFailedTotal += 1;
        rollupMetrics.lastFailureAtSec = nowSec();
        throw error;
      } finally {
        rollupMetrics.runningGauge = 0;
        rollupMetrics.lastDurationMs = Math.max(0, Date.now() - startedAtMs);
        rollupMetrics.lastRefreshedMetricCount = refreshedCount;
      }
    },
  });
}

export function getAdminDataRollupMetricsSnapshot(): AdminDataRollupMetricsState {
  return { ...rollupMetrics };
}

export function startAdminDataRollupScheduler(): void {
  if (rollupSchedulerHandle) return;
  const everySec = parseRollupRefreshSec();

  const tick = async () => {
    try {
      await refreshAdminDataRollups({ refreshedByRole: "worker" });
    } catch (error) {
      console.warn("[admin-data-rollups] refresh failed:", (error as Error)?.message || error);
    }
  };

  // Warm once before periodic ticks so request path sees cached values quickly.
  void tick();
  rollupSchedulerHandle = setInterval(() => {
    void tick();
  }, everySec * 1000);
  (rollupSchedulerHandle as any)?.unref?.();
}
