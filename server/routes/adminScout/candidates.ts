import { Router } from "express";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, dbClient } from "@db";
import {
  challengeBadges,
  challengeBadgeAwards,
  challengeEnrollments,
  challengeEnrollmentEvents,
  challengeCertificateTemplates,
  challengeCertificates,
  challengeLeaderboardSnapshot,
  challengePhaseSnapshots,
  challengePhases,
  challengePrizeAwards,
  challengeProgressionTiers,
  challengeSelectionBoosts,
  challengeUserProgression,
  challenges,
  partnerAllocations,
  partnerInvites,
  partnerInquiries,
  partners,
  recruitingPipeline,
  scoutMetricsSnapshot,
  scoutWatchlists,
  globalSettings,
  systemConfig,
  trades,
  users,
} from "@shared/schema";
import { requireAdmin } from "../../middleware/requireAdmin";
import { randomToken, sha256Hex } from "../../services/crypto";
import {
  PIPELINE_STAGES,
  ensurePipelineRowForUser,
  updateRecruitingPipelineForUser,
} from "../../recruitment/pipelineService";
import { appendChallengeEvent } from "../../recruitment/challengesV4/challengeEvents";
import { getSystemChallengeConfig } from "../../recruitment/challengesV4/challengeConfig";
import { computePhaseStats } from "../../recruitment/challengesV4/challengeEvaluation";
import { listAdminScoutCandidates } from "../../scout/scoutService";
import {
  getPartnerInquiryRoutingConfig,
  resolvePartnerInquiryRouting,
  upsertPartnerInquiryRoutingConfig,
} from "../../partner/inquiryRouting";
import { createMailboxThreadWithMessage, createNotification, getCommunicationSettings } from "../../services/messaging";
import { publishLiveEvent } from "../../services/liveBus";
import {
  DEFAULT_PARTNER_GATING_CONFIG,
  normalizePartnerGatingConfig,
  normalizePartnerGatingOverrides,
} from "../../partner/onboarding";
import {
  LEADERBOARD_MODES,
  PARTNER_INVITE_EMAIL_STATUSES,
  challengeBadgeUpsertSchema,
  challengeCertificateTemplateUpsertSchema,
  challengeEnrollmentActionSchema,
  challengeEnrollmentExtendSchema,
  challengeEnrollmentNotifySchema,
  challengeEnrollmentOverrideSchema,
  challengePhaseUpsertSchema,
  challengePrizeApproveSchema,
  challengeProgressionTierUpsertSchema,
  challengeSettingsPatchSchema,
  challengeUpsertSchema,
  inquiryRoutingPatchSchema,
  partnerApproveSchema,
  partnerCreateSchema,
  partnerGatingOverrideSchema,
  partnerInviteSchema,
  partnerPatchSchema,
  pipelineUpdateSchema,
  scoutConfigPatchSchema,
  watchlistInputSchema,
} from "./validation";
import {
  PARTNER_INVITE_ADMIN_LIMIT,
  PARTNER_INVITE_IP_LIMIT,
  appendRecruitmentAudit,
  applyChallengeEnrollmentAdminAction,
  beginIdempotentMutation,
  buildPartnerApiKey,
  buildPartnerInviteDeepLink,
  buildPartnerTempPassword,
  buildPartnerUsername,
  clampInt,
  commitIdempotentMutation,
  computeMaxDrawdownFromEquitySeries,
  consumeRateLimit,
  decryptChallengeAdminNote,
  driftAbs,
  enforceAdminResourceScope,
  enforceChallengeAdminActionRateLimit,
  getTraderUser,
  netProfitSqlAlias,
  normalizeEmailArray,
  normalizeChallengeMailboxCategory,
  normalizePartnerEmail,
  notifyChallengeTrader,
  nowSec,
  parseBooleanQuery,
  parseJsonObjectSafe,
  parseOffset,
  parseOptionalFloat,
  parseOptionalStage,
  parsePositiveInt,
  partnerInviteRateByAdmin,
  partnerInviteRateByIp,
  publishChallengesUpdated,
  releaseIdempotentMutation,
  safeString,
  sanitizePartnerIpWhitelist,
  sendPartnerInviteEmail,
  toFiniteNumber,
} from "./support";

export const adminScoutRouter = Router();
adminScoutRouter.use(requireAdmin);
adminScoutRouter.use(async (req, res, next) => {
  try {
    // Keep config endpoint reachable so admins can re-enable the feature.
    if (req.path === "/config") return next();

    const [cfg] = await db
      .select({ scoutTabEnabled: systemConfig.scoutTabEnabled })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    if (cfg?.scoutTabEnabled === false) {
      return res.status(403).json({ message: "SCOUT_TAB_DISABLED" });
    }
    return next();
  } catch (error) {
    console.error("[admin-scout] scout enabled check failed:", error);
    return res.status(500).json({ message: "SCOUT_TAB_GATING_FAILED" });
  }
});

adminScoutRouter.get("/candidates", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const qRaw = safeString(req.query.q).trim();
    const q = qRaw ? `%${qRaw.slice(0, 200)}%` : null;
    const stage = parseOptionalStage(req.query.stage);
    if (safeString(req.query.stage).trim() && !stage) {
      return res.status(400).json({ message: "INVALID_STAGE" });
    }

    const minSharpe = parseOptionalFloat(req.query.minSharpe);
    const minScore = parseOptionalFloat(req.query.minScore);
    const days = parsePositiveInt(req.query.days, 90, 365);
    const cutoffSec = nowSec() - days * 86400;

    const limit = parsePositiveInt(req.query.limit, 25, 200);
    const offset = parseOffset(req.query.offset);

    const out = await listAdminScoutCandidates({
      adminId,
      q,
      stage,
      minSharpe,
      minScore,
      limit,
      offset,
      cutoffSec,
    });

    return res.json({
      ok: true,
      limit,
      offset,
      total: out.total,
      hasMore: out.hasMore,
      results: out.rows,
    });
  } catch (error) {
    console.error("[admin-scout] candidates error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CANDIDATES" });
  }
});

adminScoutRouter.get("/candidates/:userId", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const user = await getTraderUser(userId);
    if (!user || user.isAdmin || user.isDeleted) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    await ensurePipelineRowForUser(userId);

    const netProfitSql = netProfitSqlAlias("t");
    const days = parsePositiveInt(req.query.days, 180, 730);
    const cutoffSec = nowSec() - days * 86400;

    const userRes = await dbClient.query(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.name,
          u.user_tier,
          u.kyc_status,
          u.created_at,
          u.country_iso2,
          u.region_key,
          COALESCE(u.starting_equity, 1000000)::float8 AS starting_equity,
          uv.email_verified_at,
          uv.sms_verified_at,
          uv.contender_tier,
          rp.stage,
          rp.assigned_admin_id,
          rp.last_contacted_at,
          rp.notes AS pipeline_notes,
          rp.is_partner_visible,
          rp.updated_at AS pipeline_updated_at,
          sm.sharpe_ratio,
          sm.sortino_ratio,
          sm.calmar_ratio,
          sm.equity_curve_r2,
          sm.avg_mae,
          sm.avg_mfe,
          sm.style_cluster,
          sm.composite_score,
          sm.calculated_at,
          w.id AS watchlist_id,
          w.tier AS watchlist_tier,
          w.notes AS watchlist_notes
        FROM users u
        LEFT JOIN user_verification uv ON uv.user_id = u.id
        LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
        LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = u.id
        LEFT JOIN scout_watchlists w ON w.user_id = u.id AND w.admin_id = $2::int
        WHERE u.id = $1::int
          AND u.is_admin = false
          AND u.is_deleted = false
        LIMIT 1
      `,
      [userId, adminId],
    );

    const row = userRes.rows?.[0];
    if (!row) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    const perfRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            t.id,
            t.opened_at,
            t.closed_at,
            ${netProfitSql}::float8 AS net_profit
          FROM trades t
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT
          COUNT(*)::int AS trades,
          COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate,
          COALESCE(AVG((closed_at - opened_at)::float8), 0)::float8 AS avg_hold_sec,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0)::float8 AS gross_profit,
          COALESCE(SUM(CASE WHEN net_profit < 0 THEN -net_profit ELSE 0 END), 0)::float8 AS gross_loss
        FROM src
      `,
      [userId, cutoffSec],
    );

    const dayRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              t.closed_at,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            to_char(to_timestamp(closed_at), 'YYYY-MM-DD') AS day_key,
            SUM(net_profit)::float8 AS pnl
          FROM src
          GROUP BY day_key
          ORDER BY day_key ASC
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ day_key: string; pnl: number }>;

    const hourlyRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              EXTRACT(HOUR FROM to_timestamp(t.closed_at))::int AS hour_utc,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            hour_utc,
            COUNT(*)::int AS trades,
            COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
            COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
          FROM src
          GROUP BY hour_utc
          ORDER BY hour_utc ASC
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ hour_utc: number; trades: number; net_profit: number; win_rate: number }>;

    const symbolRows = (
      await dbClient.query(
        `
          WITH src AS (
            SELECT
              COALESCE(sc.symbol, 'UNKNOWN') AS symbol,
              COALESCE(NULLIF(lower(sc.category), ''), 'unknown') AS category,
              ${netProfitSql}::float8 AS net_profit
            FROM trades t
            LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
            WHERE t.user_id = $1::int
              AND t.status = 'CLOSED'
              AND t.closed_at IS NOT NULL
              AND t.closed_at >= $2::int
          )
          SELECT
            symbol,
            category,
            COUNT(*)::int AS trades,
            COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
            COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
          FROM src
          GROUP BY symbol, category
          ORDER BY net_profit DESC, trades DESC
          LIMIT 40
        `,
        [userId, cutoffSec],
      )
    ).rows as Array<{ symbol: string; category: string; trades: number; net_profit: number; win_rate: number }>;

    const summary = perfRes.rows?.[0] ?? {};
    const startingEquity = Math.max(1, Number(row.starting_equity ?? 1_000_000));
    let runningPnl = 0;
    const equityCurve: Array<{ day: string; equity: number; pnl: number }> = [];
    for (const dayRow of dayRows) {
      const pnl = Number(dayRow.pnl ?? 0);
      runningPnl += pnl;
      equityCurve.push({
        day: String(dayRow.day_key),
        equity: Number((startingEquity + runningPnl).toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
      });
    }
    const maxDrawdown = computeMaxDrawdownFromEquitySeries(equityCurve.map((v) => v.equity));

    return res.json({
      ok: true,
      row: {
        userId: Number(row.id),
        email: row.email ?? null,
        username: row.username ?? null,
        name: row.name ?? null,
        userTier: row.user_tier ?? null,
        kycStatus: row.kyc_status ?? null,
        createdAt: row.created_at == null ? null : Number(row.created_at),
        countryIso2: row.country_iso2 ?? null,
        regionKey: row.region_key ?? null,
        verification: {
          emailVerifiedAt: row.email_verified_at == null ? null : Number(row.email_verified_at),
          smsVerifiedAt: row.sms_verified_at == null ? null : Number(row.sms_verified_at),
          contenderTier: row.contender_tier ?? null,
        },
        pipeline: {
          stage: row.stage ?? "DETECTED",
          assignedAdminId: row.assigned_admin_id == null ? null : Number(row.assigned_admin_id),
          lastContactedAt: row.last_contacted_at == null ? null : Number(row.last_contacted_at),
          notes: row.pipeline_notes ?? null,
          isPartnerVisible: Boolean(row.is_partner_visible ?? false),
          updatedAt: row.pipeline_updated_at == null ? null : Number(row.pipeline_updated_at),
        },
        watchlist: row.watchlist_id
          ? {
              id: Number(row.watchlist_id),
              tier: row.watchlist_tier ?? "B_LIST",
              notes: row.watchlist_notes ?? null,
            }
          : null,
        metrics: {
          sharpeRatio: row.sharpe_ratio == null ? null : Number(row.sharpe_ratio),
          sortinoRatio: row.sortino_ratio == null ? null : Number(row.sortino_ratio),
          calmarRatio: row.calmar_ratio == null ? null : Number(row.calmar_ratio),
          equityCurveR2: row.equity_curve_r2 == null ? null : Number(row.equity_curve_r2),
          avgMae: row.avg_mae == null ? null : Number(row.avg_mae),
          avgMfe: row.avg_mfe == null ? null : Number(row.avg_mfe),
          styleCluster: row.style_cluster ?? null,
          compositeScore: row.composite_score == null ? null : Number(row.composite_score),
          calculatedAt: row.calculated_at == null ? null : Number(row.calculated_at),
        },
        performance: {
          days,
          trades: Number(summary.trades ?? 0),
          netProfit: Number(summary.net_profit ?? 0),
          winRate: Number(summary.win_rate ?? 0),
          avgHoldSec: Number(summary.avg_hold_sec ?? 0),
          grossProfit: Number(summary.gross_profit ?? 0),
          grossLoss: Number(summary.gross_loss ?? 0),
          maxDrawdown,
        },
        equityCurve,
        attributionBySymbol: symbolRows.map((r) => ({
          symbol: r.symbol,
          category: r.category,
          trades: Number(r.trades ?? 0),
          netProfit: Number(r.net_profit ?? 0),
          winRate: Number(r.win_rate ?? 0),
        })),
        attributionByHourUtc: hourlyRows.map((r) => ({
          hourUtc: Number(r.hour_utc ?? 0),
          trades: Number(r.trades ?? 0),
          netProfit: Number(r.net_profit ?? 0),
          winRate: Number(r.win_rate ?? 0),
        })),
      },
    });
  } catch (error) {
    console.error("[admin-scout] candidate detail error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CANDIDATE" });
  }
});

adminScoutRouter.get("/watchlist", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);

    const rows = await db
      .select({
        id: scoutWatchlists.id,
        userId: scoutWatchlists.userId,
        tier: scoutWatchlists.tier,
        notes: scoutWatchlists.notes,
        createdAt: scoutWatchlists.createdAt,
        updatedAt: scoutWatchlists.updatedAt,
        username: users.username,
        email: users.email,
        name: users.name,
        stage: recruitingPipeline.stage,
        isPartnerVisible: recruitingPipeline.isPartnerVisible,
        sharpeRatio: scoutMetricsSnapshot.sharpeRatio,
        compositeScore: scoutMetricsSnapshot.compositeScore,
        styleCluster: scoutMetricsSnapshot.styleCluster,
      })
      .from(scoutWatchlists)
      .innerJoin(users, eq(users.id, scoutWatchlists.userId))
      .leftJoin(recruitingPipeline, eq(recruitingPipeline.userId, scoutWatchlists.userId))
      .leftJoin(scoutMetricsSnapshot, eq(scoutMetricsSnapshot.userId, scoutWatchlists.userId))
      .where(eq(scoutWatchlists.adminId, adminId))
      .orderBy(desc(scoutWatchlists.updatedAt), desc(scoutWatchlists.id));

    return res.json({
      ok: true,
      rows: rows.map((r) => ({
        id: Number(r.id),
        userId: Number(r.userId),
        tier: r.tier,
        notes: r.notes,
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        user: {
          username: r.username,
          email: r.email,
          name: r.name,
        },
        pipeline: {
          stage: r.stage ?? "DETECTED",
          isPartnerVisible: Boolean(r.isPartnerVisible ?? false),
        },
        metrics: {
          sharpeRatio: r.sharpeRatio == null ? null : Number(r.sharpeRatio),
          compositeScore: r.compositeScore == null ? null : Number(r.compositeScore),
          styleCluster: r.styleCluster ?? null,
        },
      })),
    });
  } catch (error) {
    console.error("[admin-scout] watchlist list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_WATCHLIST" });
  }
});

adminScoutRouter.post("/watchlist", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const parsed = watchlistInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const { userId, tier, notes } = parsed.data;

    const [userRow] = await db
      .select({ id: users.id, isAdmin: users.isAdmin, isDeleted: users.isDeleted })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!userRow || userRow.isAdmin || userRow.isDeleted) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    await ensurePipelineRowForUser(userId);
    const ts = nowSec();

    await db
      .insert(scoutWatchlists)
      .values({
        adminId,
        userId,
        tier: tier ?? "B_LIST",
        notes: notes ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: [scoutWatchlists.adminId, scoutWatchlists.userId],
        set: {
          tier: tier ?? "B_LIST",
          notes: notes ?? null,
          updatedAt: ts,
        },
      });

    const [saved] = await db
      .select()
      .from(scoutWatchlists)
      .where(and(eq(scoutWatchlists.adminId, adminId), eq(scoutWatchlists.userId, userId)))
      .limit(1);

    await appendRecruitmentAudit(req, "SCOUT_WATCHLIST_UPSERT", {
      targetUserId: userId,
      tier: tier ?? "B_LIST",
      watchlistId: saved?.id ?? null,
    });

    return res.status(201).json({ ok: true, row: saved });
  } catch (error) {
    console.error("[admin-scout] watchlist upsert error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPSERT_WATCHLIST" });
  }
});

adminScoutRouter.delete("/watchlist/:id", async (req, res) => {
  try {
    const adminId = Number(req.session?.userId || 0);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_WATCHLIST_ID" });
    }

    const [deleted] = await db
      .delete(scoutWatchlists)
      .where(and(eq(scoutWatchlists.id, id), eq(scoutWatchlists.adminId, adminId)))
      .returning({ id: scoutWatchlists.id, userId: scoutWatchlists.userId });

    if (!deleted) {
      return res.status(404).json({ message: "WATCHLIST_ITEM_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "SCOUT_WATCHLIST_DELETE", {
      watchlistId: id,
      targetUserId: deleted.userId,
    });

    return res.json({ ok: true, id });
  } catch (error) {
    console.error("[admin-scout] watchlist delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_WATCHLIST" });
  }
});

adminScoutRouter.get("/pipeline", async (req, res) => {
  try {
    const stage = parseOptionalStage(req.query.stage);
    if (safeString(req.query.stage).trim() && !stage) {
      return res.status(400).json({ message: "INVALID_STAGE" });
    }

    const limit = parsePositiveInt(req.query.limit, 50, 300);
    const offset = parseOffset(req.query.offset);

    const rows = (
      await dbClient.query(
        `
          SELECT
            u.id AS user_id,
            u.username,
            u.email,
            u.name,
            u.user_tier,
            u.kyc_status,
            u.created_at,
            COALESCE(rp.stage, 'DETECTED') AS stage,
            COALESCE(rp.assigned_admin_id, NULL) AS assigned_admin_id,
            COALESCE(rp.last_contacted_at, NULL) AS last_contacted_at,
            COALESCE(rp.notes, NULL) AS notes,
            COALESCE(rp.is_partner_visible, false) AS is_partner_visible,
            COALESCE(rp.updated_at, u.created_at) AS updated_at,
            sm.composite_score,
            sm.sharpe_ratio,
            sm.style_cluster,
            COUNT(*) OVER()::int AS total_count
          FROM users u
          LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
          LEFT JOIN scout_metrics_snapshot sm ON sm.user_id = u.id
          WHERE u.is_admin = false
            AND u.is_deleted = false
            AND ($1::text IS NULL OR COALESCE(rp.stage, 'DETECTED') = $1::text)
          ORDER BY COALESCE(rp.updated_at, u.created_at) DESC, u.id DESC
          LIMIT $2::int OFFSET $3::int
        `,
        [stage, limit, offset],
      )
    ).rows as any[];

    const stageCountRows = (
      await dbClient.query(
        `
          SELECT
            COALESCE(rp.stage, 'DETECTED') AS stage,
            COUNT(*)::int AS count
          FROM users u
          LEFT JOIN recruiting_pipeline rp ON rp.user_id = u.id
          WHERE u.is_admin = false
            AND u.is_deleted = false
          GROUP BY COALESCE(rp.stage, 'DETECTED')
        `,
      )
    ).rows as Array<{ stage: string; count: number }>;

    const stageCounts: Record<string, number> = {};
    for (const key of PIPELINE_STAGES) stageCounts[key] = 0;
    for (const row of stageCountRows) {
      const key = String(row.stage || "").toUpperCase();
      if (PIPELINE_STAGES.includes(key as any)) {
        stageCounts[key] = Number(row.count ?? 0);
      }
    }

    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
    const hasMore = offset + rows.length < total;

    return res.json({
      ok: true,
      limit,
      offset,
      total,
      hasMore,
      stageCounts,
      rows: rows.map((r) => ({
        userId: Number(r.user_id),
        username: r.username ?? null,
        email: r.email ?? null,
        name: r.name ?? null,
        userTier: r.user_tier ?? null,
        kycStatus: r.kyc_status ?? null,
        createdAt: r.created_at == null ? null : Number(r.created_at),
        stage: r.stage ?? "DETECTED",
        assignedAdminId: r.assigned_admin_id == null ? null : Number(r.assigned_admin_id),
        lastContactedAt: r.last_contacted_at == null ? null : Number(r.last_contacted_at),
        notes: r.notes ?? null,
        isPartnerVisible: Boolean(r.is_partner_visible),
        updatedAt: r.updated_at == null ? null : Number(r.updated_at),
        metrics: {
          compositeScore: r.composite_score == null ? null : Number(r.composite_score),
          sharpeRatio: r.sharpe_ratio == null ? null : Number(r.sharpe_ratio),
          styleCluster: r.style_cluster ?? null,
        },
      })),
    });
  } catch (error) {
    console.error("[admin-scout] pipeline list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PIPELINE_LIST" });
  }
});

adminScoutRouter.get("/pipeline/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const ensured = await ensurePipelineRowForUser(userId);
    if (!ensured) {
      return res.status(404).json({ message: "TRADER_NOT_FOUND" });
    }

    const [row] = await db
      .select({
        userId: recruitingPipeline.userId,
        stage: recruitingPipeline.stage,
        assignedAdminId: recruitingPipeline.assignedAdminId,
        lastContactedAt: recruitingPipeline.lastContactedAt,
        notes: recruitingPipeline.notes,
        isPartnerVisible: recruitingPipeline.isPartnerVisible,
        updatedAt: recruitingPipeline.updatedAt,
        username: users.username,
        email: users.email,
        name: users.name,
        userTier: users.userTier,
        kycStatus: users.kycStatus,
      })
      .from(recruitingPipeline)
      .innerJoin(users, eq(users.id, recruitingPipeline.userId))
      .where(eq(recruitingPipeline.userId, userId))
      .limit(1);

    if (!row) {
      return res.status(404).json({ message: "PIPELINE_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      row: {
        userId: Number(row.userId),
        stage: row.stage,
        assignedAdminId: row.assignedAdminId == null ? null : Number(row.assignedAdminId),
        lastContactedAt: row.lastContactedAt == null ? null : Number(row.lastContactedAt),
        notes: row.notes,
        isPartnerVisible: Boolean(row.isPartnerVisible),
        updatedAt: Number(row.updatedAt),
        user: {
          username: row.username,
          email: row.email,
          name: row.name,
          userTier: row.userTier,
          kycStatus: row.kycStatus,
        },
      },
    });
  } catch (error) {
    console.error("[admin-scout] pipeline get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PIPELINE" });
  }
});

adminScoutRouter.put("/pipeline/:userId", async (req, res) => {
  let idempotency: { storeKey: string; fingerprint: string } | null = null;
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "INVALID_USER_ID" });
    }

    const parsed = pipelineUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    idempotency = beginIdempotentMutation(req, res, "SCOUT_PIPELINE_UPDATE");
    if (!idempotency) return;

    const updated = await updateRecruitingPipelineForUser({
      userId,
      patch: parsed.data,
    });

    if (!updated.ok) {
      if (updated.message === "TRADER_NOT_FOUND" || updated.message === "PIPELINE_NOT_FOUND") {
        return res.status(404).json({ message: updated.message });
      }
      if (updated.message === "PARTNER_READY_GATING_FAILED") {
        return res.status(409).json({ message: updated.message, reason: updated.reason });
      }
      return res.status(409).json({ message: updated.message });
    }

    await appendRecruitmentAudit(req, "SCOUT_PIPELINE_UPDATE", {
      targetUserId: userId,
      stage: updated.applied.stage,
      isPartnerVisible: updated.applied.isPartnerVisible,
      assignedAdminId: parsed.data.assignedAdminId,
    });

    const payload = { ok: true, row: updated.row };
    commitIdempotentMutation(idempotency, 200, payload);
    return res.json(payload);
  } catch (error) {
    releaseIdempotentMutation(idempotency);
    console.error("[admin-scout] pipeline update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PIPELINE" });
  }
});

adminScoutRouter.get("/inquiry-routing", async (_req, res) => {
  try {
    const [config, resolved, messagingSettings, adminRows] = await Promise.all([
      getPartnerInquiryRoutingConfig(),
      resolvePartnerInquiryRouting(),
      getCommunicationSettings(),
      db
        .select({
          userId: users.id,
          email: users.email,
          username: users.username,
          name: users.name,
          mailboxPublicKey: users.mailboxPublicKey,
          mailboxPublicKeyUpdatedAt: users.mailboxPublicKeyUpdatedAt,
        })
        .from(users)
        .where(and(eq(users.isAdmin, true), eq(users.isDisabled, false), eq(users.isDeleted, false)))
        .orderBy(sql`lower(${users.email}) asc`, sql`${users.id} asc`),
    ]);

    const routeSet = new Set(resolved.routeAdmins.map((row) => row.userId));
    const viewerSet = new Set(resolved.viewerAdmins.map((row) => row.userId));

    return res.json({
      ok: true,
      config,
      resolved: {
        routeAdminCount: resolved.routeAdmins.length,
        viewerAdminCount: resolved.viewerAdmins.length,
        participantAdminCount: resolved.participantAdmins.length,
        unresolvedRouteEmails: resolved.unresolvedRouteEmails,
        unresolvedViewerEmails: resolved.unresolvedViewerEmails,
        missingKeyAdminIds: resolved.missingKeyAdminIds,
      },
      messaging: {
        messagingEnabled: messagingSettings.messagingEnabled,
        messagingE2eeEnabled: messagingSettings.messagingE2eeEnabled,
        messagingE2eeRequired: messagingSettings.messagingE2eeRequired,
      },
      availableAdmins: adminRows.map((row) => ({
        userId: Number(row.userId),
        email: String(row.email || "").toLowerCase(),
        username: row.username ?? null,
        name: row.name ?? null,
        routeRecipient: routeSet.has(Number(row.userId)),
        viewerRecipient: viewerSet.has(Number(row.userId)),
        hasMailboxKey: String(row.mailboxPublicKey || "").trim().length > 0,
        mailboxPublicKeyUpdatedAt:
          row.mailboxPublicKeyUpdatedAt == null ? null : Number(row.mailboxPublicKeyUpdatedAt),
      })),
    });
  } catch (error) {
    console.error("[admin-scout] inquiry routing get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_INQUIRY_ROUTING" });
  }
});

adminScoutRouter.put("/inquiry-routing", async (req, res) => {
  try {
    const parsed = inquiryRoutingPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const routeAdminEmails =
      parsed.data.routeAdminEmails === undefined ? undefined : normalizeEmailArray(parsed.data.routeAdminEmails);
    const viewerAdminEmails =
      parsed.data.viewerAdminEmails === undefined ? undefined : normalizeEmailArray(parsed.data.viewerAdminEmails);

    const activeAdminRows = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.isDisabled, false), eq(users.isDeleted, false)));
    const activeAdminEmailSet = new Set(
      activeAdminRows
        .map((row) => String(row.email || "").trim().toLowerCase())
        .filter((email) => email.length > 0),
    );

    const unknownRouteEmails = (routeAdminEmails ?? []).filter((email) => !activeAdminEmailSet.has(email));
    if (unknownRouteEmails.length) {
      return res.status(400).json({ message: "UNKNOWN_ROUTE_ADMIN_EMAILS", emails: unknownRouteEmails });
    }

    const unknownViewerEmails = (viewerAdminEmails ?? []).filter((email) => !activeAdminEmailSet.has(email));
    if (unknownViewerEmails.length) {
      return res.status(400).json({ message: "UNKNOWN_VIEWER_ADMIN_EMAILS", emails: unknownViewerEmails });
    }

    const config = await upsertPartnerInquiryRoutingConfig({
      inboxAlias: parsed.data.inboxAlias,
      routeAdminEmails,
      viewerAdminEmails,
      updatedBy: String(req.session?.email || "admin"),
    });
    const resolved = await resolvePartnerInquiryRouting();
    if (!resolved.routeAdmins.length) {
      return res.status(409).json({ message: "NO_ACTIVE_ADMIN_RECIPIENTS" });
    }

    await appendRecruitmentAudit(req, "PARTNER_INQUIRY_ROUTING_UPDATE", {
      inboxAlias: config.inboxAlias,
      routeAdminCount: config.routeAdminEmails.length,
      viewerAdminCount: config.viewerAdminEmails.length,
      routeAdminEmails: config.routeAdminEmails,
      viewerAdminEmails: config.viewerAdminEmails,
    });

    return res.json({
      ok: true,
      config,
      resolved: {
        routeAdminCount: resolved.routeAdmins.length,
        viewerAdminCount: resolved.viewerAdmins.length,
        participantAdminCount: resolved.participantAdmins.length,
        missingKeyAdminIds: resolved.missingKeyAdminIds,
      },
    });
  } catch (error) {
    console.error("[admin-scout] inquiry routing update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_INQUIRY_ROUTING" });
  }
});

adminScoutRouter.get("/inquiries", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 80, 300);
    const offset = parseOffset(req.query.offset);
    const statusRaw = safeString(req.query.status).trim().toUpperCase();
    const statusFilter = statusRaw
      ? ["OPEN", "FORWARDED", "ANSWERED", "CLOSED"].includes(statusRaw)
        ? statusRaw
        : null
      : null;
    if (statusRaw && !statusFilter) {
      return res.status(400).json({ message: "INVALID_STATUS" });
    }

    const rows = (
      await dbClient.query(
        `
          SELECT
            i.id,
            i.partner_id,
            p.name AS partner_name,
            i.user_hash_id,
            i.sender_name,
            i.sender_email,
            i.subject,
            i.body,
            i.status,
            i.mailbox_thread_id,
            i.created_at,
            i.updated_at,
            COUNT(*) OVER()::int AS total_count
          FROM partner_inquiries i
          INNER JOIN partners p ON p.id = i.partner_id
          WHERE ($1::text IS NULL OR i.status = $1::text)
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT $2::int OFFSET $3::int
        `,
        [statusFilter, limit, offset],
      )
    ).rows as any[];

    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;
    const hasMore = offset + rows.length < total;

    await appendRecruitmentAudit(req, "PARTNER_INQUIRIES_ADMIN_LIST", {
      statusFilter: statusFilter ?? null,
      limit,
      offset,
      rowsReturned: rows.length,
      total,
    });

    return res.json({
      ok: true,
      limit,
      offset,
      total,
      hasMore,
      rows: rows.map((row) => ({
        id: Number(row.id),
        partnerId: Number(row.partner_id),
        partnerName: row.partner_name ?? null,
        userHashId: row.user_hash_id ?? null,
        senderName: row.sender_name ?? null,
        senderEmail: row.sender_email ?? null,
        subject: row.subject ?? null,
        body: row.body ?? null,
        status: row.status ?? null,
        mailboxThreadId: row.mailbox_thread_id == null ? null : Number(row.mailbox_thread_id),
        createdAt: row.created_at == null ? null : Number(row.created_at),
        updatedAt: row.updated_at == null ? null : Number(row.updated_at),
      })),
    });
  } catch (error) {
    console.error("[admin-scout] inquiries list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNER_INQUIRIES" });
  }
});

adminScoutRouter.get("/config", async (_req, res) => {
  try {
    const [cfg] = await db
      .select({
        scoutTabEnabled: systemConfig.scoutTabEnabled,
        partnerPortalEnabled: systemConfig.partnerPortalEnabled,
        traderProProfilesEnabled: systemConfig.traderProProfilesEnabled,
        traderCompeteEnabled: systemConfig.traderCompeteEnabled,
        traderCommunityEnabled: systemConfig.traderCommunityEnabled,
        partnerAllocationsEnabled: systemConfig.partnerAllocationsEnabled,
        partnerGatingConfig: systemConfig.partnerGatingConfig,
        partnerPasswordRotationDays: systemConfig.partnerPasswordRotationDays,
        partnerPasswordReminderLogins: systemConfig.partnerPasswordReminderLogins,
        partnerInviteDefaultExpiryDays: systemConfig.partnerInviteDefaultExpiryDays,
        leaderboardMode: systemConfig.leaderboardMode,
        scoutMinSharpeAlert: systemConfig.scoutMinSharpeAlert,
        updatedAt: systemConfig.updatedAt,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    return res.json({
      ok: true,
      config: {
        scoutTabEnabled: Boolean(cfg?.scoutTabEnabled ?? true),
        partnerPortalEnabled: Boolean(cfg?.partnerPortalEnabled ?? false),
        traderProProfilesEnabled: Boolean(cfg?.traderProProfilesEnabled ?? false),
        traderCompeteEnabled: Boolean(cfg?.traderCompeteEnabled ?? false),
        traderCommunityEnabled: Boolean(cfg?.traderCommunityEnabled ?? false),
        partnerAllocationsEnabled: Boolean(cfg?.partnerAllocationsEnabled ?? false),
        partnerGatingConfig: normalizePartnerGatingConfig(cfg?.partnerGatingConfig),
        partnerPasswordRotationDays: Math.max(7, Math.min(365, Number(cfg?.partnerPasswordRotationDays ?? 90))),
        partnerPasswordReminderLogins: Math.max(
          1,
          Math.min(20, Number(cfg?.partnerPasswordReminderLogins ?? 3)),
        ),
        partnerInviteDefaultExpiryDays: Math.max(
          1,
          Math.min(180, Number(cfg?.partnerInviteDefaultExpiryDays ?? 7)),
        ),
        leaderboardMode: LEADERBOARD_MODES.includes(String(cfg?.leaderboardMode || "") as any)
          ? String(cfg?.leaderboardMode)
          : "PUBLIC",
        scoutMinSharpeAlert: Number(cfg?.scoutMinSharpeAlert ?? 2),
        updatedAt: cfg?.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[admin-scout] config get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_SCOUT_CONFIG" });
  }
});

adminScoutRouter.put("/config", async (req, res) => {
  try {
    const parsed = scoutConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    if (!existing) {
      await db.insert(systemConfig).values({
        id: 1,
        marketDataActiveProviderKey: "twelvedata",
        marketDataFallbackProviderKeysCsv: "",
      });
    }

    const ts = nowSec();
    await db
      .update(systemConfig)
      .set({
        scoutTabEnabled: parsed.data.scoutTabEnabled,
        partnerPortalEnabled: parsed.data.partnerPortalEnabled,
        traderProProfilesEnabled: parsed.data.traderProProfilesEnabled,
        traderCompeteEnabled: parsed.data.traderCompeteEnabled,
        traderCommunityEnabled: parsed.data.traderCommunityEnabled,
        partnerAllocationsEnabled: parsed.data.partnerAllocationsEnabled,
        partnerGatingConfig:
          parsed.data.partnerGatingConfig === undefined
            ? undefined
            : JSON.stringify(normalizePartnerGatingConfig(parsed.data.partnerGatingConfig)),
        partnerPasswordRotationDays: parsed.data.partnerPasswordRotationDays,
        partnerPasswordReminderLogins: parsed.data.partnerPasswordReminderLogins,
        partnerInviteDefaultExpiryDays: parsed.data.partnerInviteDefaultExpiryDays,
        leaderboardMode: parsed.data.leaderboardMode,
        scoutMinSharpeAlert: parsed.data.scoutMinSharpeAlert,
        updatedAt: ts,
        updatedBy: String(req.session?.email || "admin"),
      })
      .where(eq(systemConfig.id, 1));

    const [updated] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);

    await appendRecruitmentAudit(req, "SCOUT_CONFIG_UPDATE", {
      patchKeys: Object.keys(parsed.data),
    });

    publishLiveEvent({
      type: "system-config:updated",
      payload: {
        updatedAt: ts,
        scope: "SCOUT_CONFIG",
        patchKeys: Object.keys(parsed.data),
      },
    });

    return res.json({ ok: true, config: updated });
  } catch (error) {
    console.error("[admin-scout] config update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_SCOUT_CONFIG" });
  }
});
