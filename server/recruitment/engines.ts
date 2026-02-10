import { and, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { challengeEnrollments, challenges, partnerAllocations, partners } from "@shared/schema";

type ActiveEnrollment = {
  id: number;
  challengeId: number;
  userId: number;
  enrolledAt: number;
  profitTargetPct: number;
  maxDailyLossPct: number;
  maxTotalLossPct: number | null;
  minTradingDays: number | null;
  durationDays: number;
};

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function computeUserChallengeStats(userId: number, sinceSec: number): Promise<{
  currentPnlPct: number;
  tradingDays: number;
  maxDailyLossHit: number;
}> {
  if (!Number.isInteger(userId) || userId <= 0) {
    return { currentPnlPct: 0, tradingDays: 0, maxDailyLossHit: 0 };
  }
  const safeSinceSec = Number.isFinite(sinceSec) ? Math.max(0, Math.trunc(sinceSec)) : 0;

  const rows = await db.execute(sql`
    WITH src AS (
      SELECT
        t.user_id,
        t.closed_at,
        COALESCE(
          t.net_profit_usd::numeric,
          CASE
            WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
            WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
            ELSE 0::numeric
          END
        )::float8 AS net_profit
      FROM trades t
      WHERE t.user_id = ${userId}
        AND t.status = 'CLOSED'
        AND t.closed_at IS NOT NULL
        AND t.closed_at >= ${safeSinceSec}
    ),
    start_eq AS (
      SELECT COALESCE(starting_equity, 1000000)::float8 AS eq
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    ),
    daily AS (
      SELECT
        to_char(to_timestamp(closed_at), 'YYYY-MM-DD') AS day_key,
        SUM(net_profit)::float8 AS pnl
      FROM src
      GROUP BY day_key
    )
    SELECT
      COALESCE((SELECT SUM(net_profit) FROM src), 0)::float8 / NULLIF((SELECT eq FROM start_eq), 0)::float8 AS current_pnl_pct,
      COALESCE((SELECT COUNT(*) FROM daily), 0)::int AS trading_days,
      COALESCE(ABS(LEAST(0, (SELECT MIN(pnl / NULLIF((SELECT eq FROM start_eq), 0)::float8) FROM daily))), 0)::float8 AS max_daily_loss_hit
  `);

  const row = (rows as any)?.rows?.[0] ?? {};
  return {
    currentPnlPct: safeNum(row.current_pnl_pct),
    tradingDays: Math.max(0, Math.trunc(safeNum(row.trading_days))),
    maxDailyLossHit: Math.max(0, safeNum(row.max_daily_loss_hit)),
  };
}

export async function evaluateChallengeEnrollmentsPass(options?: {
  maxRows?: number;
}): Promise<{ processed: number; changed: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const maxRows = Math.max(1, Math.min(5000, Math.trunc(safeNum(options?.maxRows, 500))));
  const activeRows = await db.execute(sql`
    SELECT
      e.id,
      e.challenge_id AS "challengeId",
      e.user_id AS "userId",
      e.enrolled_at AS "enrolledAt",
      c.profit_target_pct AS "profitTargetPct",
      c.max_daily_loss_pct AS "maxDailyLossPct",
      c.max_total_loss_pct AS "maxTotalLossPct",
      c.min_trading_days AS "minTradingDays",
      c.duration_days AS "durationDays"
    FROM challenge_enrollments e
    INNER JOIN challenges c ON c.id = e.challenge_id
    WHERE e.status = 'ACTIVE'
      AND c.is_active = true
    ORDER BY e.id ASC
    LIMIT ${maxRows}
  `);

  const enrollments = ((activeRows as any)?.rows ?? []) as ActiveEnrollment[];
  let changed = 0;

  for (const enrollment of enrollments) {
    const stats = await computeUserChallengeStats(enrollment.userId, enrollment.enrolledAt);
    let nextStatus: "ACTIVE" | "PASSED" | "FAILED" = "ACTIVE";

    const expiredAt = enrollment.enrolledAt + Math.max(1, safeNum(enrollment.durationDays)) * 86400;
    const durationComplete = nowSec >= expiredAt;
    const minTradingDays = Math.max(0, Math.trunc(safeNum(enrollment.minTradingDays, 0)));
    const hitProfitTarget = stats.currentPnlPct >= safeNum(enrollment.profitTargetPct);
    const hitDailyLoss = stats.maxDailyLossHit >= safeNum(enrollment.maxDailyLossPct);
    const hitTotalLoss =
      enrollment.maxTotalLossPct != null && safeNum(enrollment.maxTotalLossPct) > 0
        ? stats.currentPnlPct <= -safeNum(enrollment.maxTotalLossPct)
        : false;

    if (hitDailyLoss || hitTotalLoss) {
      nextStatus = "FAILED";
    } else if (durationComplete && hitProfitTarget && stats.tradingDays >= minTradingDays) {
      nextStatus = "PASSED";
    } else if (durationComplete && !hitProfitTarget) {
      nextStatus = "FAILED";
    }

    await db
      .update(challengeEnrollments)
      .set({
        currentPnlPct: stats.currentPnlPct,
        tradingDays: stats.tradingDays,
        maxDailyLossHit: stats.maxDailyLossHit,
        status: nextStatus,
        completedAt: nextStatus === "ACTIVE" ? null : nowSec,
        updatedAt: nowSec,
      })
      .where(eq(challengeEnrollments.id, enrollment.id));

    if (nextStatus !== "ACTIVE") changed += 1;
  }

  return { processed: enrollments.length, changed };
}

type ActiveAllocation = {
  id: number;
  partnerId: number;
  userId: number;
  capitalUsd: number;
  shadowStopPct: number | null;
};

async function computeAllocationPnlUsd(userId: number, capitalUsd: number, sinceSec: number): Promise<number> {
  const rows = await db.execute(sql`
    WITH src AS (
      SELECT
        COALESCE(
          t.net_profit_usd::numeric,
          CASE
            WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
            WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
            ELSE 0::numeric
          END
        )::float8 AS net_profit
      FROM trades t
      WHERE t.user_id = ${userId}
        AND t.status = 'CLOSED'
        AND t.closed_at IS NOT NULL
        AND t.closed_at >= ${sinceSec}
    ),
    start_eq AS (
      SELECT COALESCE(starting_equity, 1000000)::float8 AS eq
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    )
    SELECT
      COALESCE((SELECT SUM(net_profit) FROM src), 0)::float8 / NULLIF((SELECT eq FROM start_eq), 0)::float8 AS pnl_pct
  `);

  const pnlPct = safeNum((rows as any)?.rows?.[0]?.pnl_pct);
  return capitalUsd * pnlPct;
}

export async function syncPartnerAllocationsPass(options?: {
  maxRows?: number;
}): Promise<{ processed: number; stopped: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const maxRows = Math.max(1, Math.min(5000, Math.trunc(safeNum(options?.maxRows, 500))));
  const activeRows = await db
    .select({
      id: partnerAllocations.id,
      partnerId: partnerAllocations.partnerId,
      userId: partnerAllocations.userId,
      capitalUsd: partnerAllocations.capitalUsd,
      shadowStopPct: partnerAllocations.shadowStopPct,
      createdAt: partnerAllocations.createdAt,
    })
    .from(partnerAllocations)
    .innerJoin(partners, and(eq(partners.id, partnerAllocations.partnerId), eq(partners.isActive, true)))
    .where(eq(partnerAllocations.status, "ACTIVE"))
    .orderBy(sql`${partnerAllocations.id} ASC`)
    .limit(maxRows);

  let stopped = 0;
  for (const row of activeRows as Array<ActiveAllocation & { createdAt: number }>) {
    const capitalUsd = Math.max(0, safeNum(row.capitalUsd));
    const pnlUsd = await computeAllocationPnlUsd(row.userId, capitalUsd, row.createdAt);
    let status: "ACTIVE" | "STOPPED" = "ACTIVE";
    const shadowStopPct = row.shadowStopPct == null ? null : Math.max(0, safeNum(row.shadowStopPct));
    if (shadowStopPct != null && shadowStopPct > 0 && pnlUsd <= -capitalUsd * shadowStopPct) {
      status = "STOPPED";
      stopped += 1;
    }

    await db
      .update(partnerAllocations)
      .set({
        currentPnlUsd: pnlUsd,
        status,
        updatedAt: nowSec,
      })
      .where(eq(partnerAllocations.id, row.id));
  }

  return { processed: activeRows.length, stopped };
}
