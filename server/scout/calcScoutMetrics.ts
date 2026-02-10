import { dbClient, db } from "@db";
import { scoutMetricsSnapshot } from "@shared/schema";
import { sql } from "drizzle-orm";
import { classifyStyleCluster, type StyleCluster } from "./styleClassifier";

type CandidateRow = {
  user_id: number;
  starting_equity: number;
  trades: number;
  gross_profit: number;
  gross_loss: number;
  wins: number;
  avg_hold_sec: number | null;
  avg_mae: number | null;
  avg_mfe: number | null;
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function equityCurveR2(values: number[]): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    const dy = values[i] - yMean;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX <= 0 || denY <= 0) return null;
  const r = num / Math.sqrt(denX * denY);
  return Math.max(0, Math.min(1, r * r));
}

function computeMaxDrawdownFromEquity(equitySeries: number[]): number | null {
  if (!equitySeries.length) return null;
  let peak = equitySeries[0];
  let maxDd = 0;
  for (const point of equitySeries) {
    if (point > peak) peak = point;
    if (peak <= 0) continue;
    const dd = (peak - point) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Number.isFinite(maxDd) ? maxDd : null;
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeCompositeScore(input: {
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  winRate: number;
  profitFactor: number | null;
  maxDrawdown: number | null;
}): number {
  const sharpe = Math.max(0, safeNumber(input.sharpe));
  const sortino = Math.max(0, safeNumber(input.sortino));
  const calmar = Math.max(0, safeNumber(input.calmar));
  const winRate = Math.max(0, Math.min(1, safeNumber(input.winRate)));
  const profitFactor = Math.max(0, safeNumber(input.profitFactor));
  const ddPenalty = Math.max(0, Math.min(1, safeNumber(input.maxDrawdown)));

  const raw =
    sharpe * 0.28 +
    sortino * 0.2 +
    calmar * 0.16 +
    winRate * 0.2 +
    Math.min(3, profitFactor) * 0.12 -
    ddPenalty * 0.2;
  return Number(raw.toFixed(6));
}

function toStyleCluster(input: {
  trades: number;
  windowDays: number;
  avgHoldSec: number | null;
  winRate: number;
  avgWinLossRatio: number;
}): StyleCluster {
  return classifyStyleCluster({
    tradesPerDay: input.trades / Math.max(1, input.windowDays),
    avgHoldSec: Math.max(0, safeNumber(input.avgHoldSec)),
    winRate: Math.max(0, Math.min(1, input.winRate)),
    avgWinLossRatio: Math.max(0, input.avgWinLossRatio),
  });
}

export async function runCalcScoutMetricsPass(options?: {
  windowDays?: number;
  minTrades?: number;
  maxUsers?: number;
  userId?: number;
}): Promise<{ processed: number; updatedAt: number }> {
  const windowDays = Math.max(7, Math.min(365, Math.trunc(Number(options?.windowDays ?? 90))));
  const minTrades = Math.max(1, Math.min(1000, Math.trunc(Number(options?.minTrades ?? 20))));
  const targetUserIdRaw = Number(options?.userId);
  const targetUserId = Number.isInteger(targetUserIdRaw) && targetUserIdRaw > 0 ? targetUserIdRaw : null;
  const maxUsers = Math.max(1, Math.min(10_000, Math.trunc(Number(options?.maxUsers ?? 1000))));
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoffSec = nowSec - windowDays * 86400;

  const candidateSql = `
    WITH closed AS (
      SELECT
        t.user_id,
        COALESCE(
          t.net_profit_usd::numeric,
          CASE
            WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
            WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
            ELSE 0::numeric
          END
        ) AS net_profit,
        t.opened_at,
        t.closed_at,
        t.mae,
        t.mfe
      FROM trades t
      WHERE t.status = 'CLOSED'
        AND t.closed_at IS NOT NULL
        AND t.closed_at >= $1::int
        AND ($3::int IS NULL OR t.user_id = $3::int)
    )
    SELECT
      c.user_id,
      COALESCE(u.starting_equity, 1000000)::float8 AS starting_equity,
      COUNT(*)::int AS trades,
      SUM(CASE WHEN c.net_profit > 0 THEN c.net_profit ELSE 0 END)::float8 AS gross_profit,
      SUM(CASE WHEN c.net_profit < 0 THEN -c.net_profit ELSE 0 END)::float8 AS gross_loss,
      SUM(CASE WHEN c.net_profit > 0 THEN 1 ELSE 0 END)::int AS wins,
      AVG((c.closed_at - c.opened_at)::float8) AS avg_hold_sec,
      AVG(c.mae::float8) AS avg_mae,
      AVG(c.mfe::float8) AS avg_mfe
    FROM closed c
    INNER JOIN users u ON u.id = c.user_id
    GROUP BY c.user_id, u.starting_equity
    HAVING COUNT(*) >= $2::int
    ORDER BY c.user_id ASC
    LIMIT $4::int
  `;

  const candidateRows = (
    await dbClient.query(candidateSql, [cutoffSec, minTrades, targetUserId, maxUsers])
  ).rows as CandidateRow[];
  if (!candidateRows.length) {
    return { processed: 0, updatedAt: nowSec };
  }

  for (const candidate of candidateRows) {
    const userId = Number(candidate.user_id);
    const startingEquity = Math.max(1, safeNumber(candidate.starting_equity, 1_000_000));
    const trades = Math.max(0, safeNumber(candidate.trades));
    const grossProfit = Math.max(0, safeNumber(candidate.gross_profit));
    const grossLoss = Math.max(0, safeNumber(candidate.gross_loss));
    const winRate = trades > 0 ? safeNumber(candidate.wins) / trades : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : null;
    const avgHoldSec = candidate.avg_hold_sec == null ? null : safeNumber(candidate.avg_hold_sec);

    const dailyRows = (
      await dbClient.query(
        `
          WITH closed AS (
            SELECT
              COALESCE(
                t.net_profit_usd::numeric,
                CASE
                  WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
                  WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
                  ELSE 0::numeric
                END
              ) AS net_profit,
              t.closed_at
            FROM trades t
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            to_char(to_timestamp(closed_at), 'YYYY-MM-DD') AS day_key,
            SUM(net_profit)::float8 AS pnl
          FROM closed
          GROUP BY day_key
          ORDER BY day_key ASC
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ day_key: string; pnl: number }>;

    const dailyReturns = dailyRows.map((r) => safeNumber(r.pnl) / startingEquity);
    const avgReturn = mean(dailyReturns);
    const sd = stdDev(dailyReturns);
    const downsideReturns = dailyReturns.filter((r) => r < 0);
    const downsideSd = stdDev(downsideReturns);

    const sharpe = sd > 0 ? (avgReturn / sd) * Math.sqrt(252) : null;
    const sortino = downsideSd > 0 ? (avgReturn / downsideSd) * Math.sqrt(252) : null;

    let runningPnl = 0;
    const equitySeries: number[] = [];
    for (const d of dailyRows) {
      runningPnl += safeNumber(d.pnl);
      equitySeries.push(startingEquity + runningPnl);
    }
    const maxDrawdown = computeMaxDrawdownFromEquity(equitySeries);
    const totalReturn = runningPnl / startingEquity;
    const years = Math.max(1 / 365, windowDays / 365);
    const cagr = totalReturn > -1 ? Math.pow(1 + totalReturn, 1 / years) - 1 : null;
    const calmar = cagr != null && maxDrawdown != null && maxDrawdown > 0 ? cagr / maxDrawdown : null;
    const r2 = equityCurveR2(equitySeries);

    const avgMae = candidate.avg_mae == null ? null : safeNumber(candidate.avg_mae);
    const avgMfe = candidate.avg_mfe == null ? null : safeNumber(candidate.avg_mfe);
    const avgWinLossRatio =
      grossProfit > 0 && grossLoss > 0 && safeNumber(candidate.wins) > 0
        ? (grossProfit / safeNumber(candidate.wins)) /
          (grossLoss / Math.max(1, trades - safeNumber(candidate.wins)))
        : 0;
    const styleCluster = toStyleCluster({
      trades,
      windowDays,
      avgHoldSec,
      winRate,
      avgWinLossRatio,
    });

    const compositeScore = computeCompositeScore({
      sharpe,
      sortino,
      calmar,
      winRate,
      profitFactor,
      maxDrawdown,
    });

    await db
      .insert(scoutMetricsSnapshot)
      .values({
        userId,
        sharpeRatio: sharpe,
        sortinoRatio: sortino,
        calmarRatio: calmar,
        equityCurveR2: r2,
        avgMae,
        avgMfe,
        styleCluster,
        compositeScore,
        calculatedAt: nowSec,
      })
      .onConflictDoUpdate({
        target: scoutMetricsSnapshot.userId,
        set: {
          sharpeRatio: sharpe,
          sortinoRatio: sortino,
          calmarRatio: calmar,
          equityCurveR2: r2,
          avgMae,
          avgMfe,
          styleCluster,
          compositeScore,
          calculatedAt: nowSec,
        },
      });
  }

  return { processed: candidateRows.length, updatedAt: nowSec };
}

export async function runScoutMetricsForUser(userId: number, windowDays = 90): Promise<void> {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return;
  await runCalcScoutMetricsPass({ windowDays, minTrades: 1, userId: uid, maxUsers: 1 });
}
