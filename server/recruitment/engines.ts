import { and, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { partnerAllocations, partners } from "@shared/schema";
import { evaluateChallengesTick } from "./challengesV4/challengeEvaluation";
import { recalcAccount } from "../recalcAccount";

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function evaluateChallengeEnrollmentsPass(options?: {
  maxRows?: number;
}): Promise<{ processed: number; changed: number; advanced?: number; passed?: number; failed?: number; warned?: number }> {
  const maxRows = Math.max(1, Math.min(5000, Math.trunc(safeNum(options?.maxRows, 500))));
  const v4 = await evaluateChallengesTick({ batchSize: maxRows });
  return {
    processed: v4.processed,
    changed: v4.advanced + v4.passed + v4.failed + v4.warned,
    advanced: v4.advanced,
    passed: v4.passed,
    failed: v4.failed,
    warned: v4.warned,
  };
}

type ActiveAllocation = {
  id: number;
  partnerId: number;
  userId: number;
  capitalUsd: number;
  shadowStopPct: number | null;
};

async function computeAllocationPnlUsd(userId: number, capitalUsd: number, sinceSec: number): Promise<number> {
  let floatingPnlUsd = 0;
  try {
    const recalc = await recalcAccount(userId, { emit: false });
    if (recalc) floatingPnlUsd = Number(recalc.floatingPnl) || 0;
  } catch (e) {
    console.error("[engines] error running recalcAccount on active allocation user:", e);
  }

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
      (COALESCE((SELECT SUM(net_profit) FROM src), 0)::float8 + ${floatingPnlUsd}::float8) / NULLIF((SELECT eq FROM start_eq), 0)::float8 AS pnl_pct
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
