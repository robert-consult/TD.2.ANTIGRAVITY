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

import { adminChallengesRouter } from "./challenges";

adminChallengesRouter.get("/analytics/summary", async (_req, res) => {
  try {
    const summaryResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_enrollments,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_enrollments,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_enrollments,
        SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_enrollments,
        SUM(CASE WHEN e.status = 'REVIEW_REQUIRED' THEN 1 ELSE 0 END)::int AS review_required_enrollments,
        AVG(CASE WHEN e.completed_at IS NOT NULL THEN (e.completed_at - e.enrolled_at) END)::float8 AS avg_time_to_complete_sec
      FROM challenge_enrollments e
    ` as any);
    const summary = Array.isArray(summaryResult) ? summaryResult[0] : (summaryResult as any)?.rows?.[0];

    const [prizes] = await db
      .select({ total: sql<number>`COALESCE(SUM(${challengePrizeAwards.prizeAmountUsd}), 0)::float8` })
      .from(challengePrizeAwards)
      .where(inArray(challengePrizeAwards.status, ["APPROVED", "PAID"] as any));

    const [conversions] = await db
      .select({ c: count() })
      .from(recruitingPipeline)
      .where(eq(recruitingPipeline.isPartnerVisible, true));

    const [badgeCount] = await db.select({ c: count() }).from(challengeBadgeAwards);
    const [certificateCount] = await db.select({ c: count() }).from(challengeCertificates);
    const [boostCount] = await db.select({ c: count() }).from(challengeSelectionBoosts);
    const [progressionCount] = await db.select({ c: count() }).from(challengeUserProgression);

    const total = Number((summary as any)?.total_enrollments ?? 0);
    const passed = Number((summary as any)?.passed_enrollments ?? 0);
    const passRate = total > 0 ? passed / total : 0;

    return res.json({
      ok: true,
      cards: {
        totalEnrollments: total,
        activeEnrollments: Number((summary as any)?.active_enrollments ?? 0),
        reviewRequiredEnrollments: Number((summary as any)?.review_required_enrollments ?? 0),
        passRate,
        avgTimeToCompleteSec: Number((summary as any)?.avg_time_to_complete_sec ?? 0),
        prizeMoneyAwardedUsd: Number(prizes?.total ?? 0),
        selectionConversions: Number(conversions?.c ?? 0),
        badgesAwarded: Number(badgeCount?.c ?? 0),
        certificatesIssued: Number(certificateCount?.c ?? 0),
        boostsApplied: Number(boostCount?.c ?? 0),
        progressionUsers: Number(progressionCount?.c ?? 0),
      },
    });
  } catch (error) {
    console.error("[admin-scout] challenge analytics summary error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_SUMMARY" });
  }
});

adminChallengesRouter.get("/analytics/funnel", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        c.id AS challenge_id,
        c.name AS challenge_name,
        COUNT(e.id)::int AS enrollments,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_count,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_count,
        SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_count,
        SUM(CASE WHEN e.status = 'REVIEW_REQUIRED' THEN 1 ELSE 0 END)::int AS review_required_count,
        SUM(CASE WHEN e.status = 'WITHDRAWN' THEN 1 ELSE 0 END)::int AS withdrawn_count
      FROM challenges c
      LEFT JOIN challenge_enrollments e ON e.challenge_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC, c.id DESC
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics funnel error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_FUNNEL" });
  }
});

adminChallengesRouter.get("/analytics/pass-fail-trend", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        to_char(to_timestamp(e.completed_at), 'YYYY-MM-DD') AS day,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_count,
        SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_count,
        SUM(CASE WHEN e.status = 'WITHDRAWN' THEN 1 ELSE 0 END)::int AS withdrawn_count,
        COUNT(*)::int AS completed_count
      FROM challenge_enrollments e
      WHERE e.completed_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 60
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics pass-fail trend error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_PASS_FAIL_TREND" });
  }
});

adminChallengesRouter.get("/analytics/breach-distribution", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        event_type,
        COUNT(*)::int AS c
      FROM challenge_enrollment_events
      WHERE event_type LIKE 'CHALLENGE_FAIL_%'
      GROUP BY event_type
      ORDER BY c DESC, event_type ASC
      LIMIT 50
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics breach distribution error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_BREACH_DISTRIBUTION" });
  }
});

adminChallengesRouter.get("/analytics/top-performers", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        e.id AS enrollment_id,
        e.challenge_id,
        c.name AS challenge_name,
        e.user_id,
        u.username,
        e.status,
        e.current_phase,
        COALESCE(e.current_pnl_pct, 0)::float8 AS pnl_pct,
        COALESCE(e.trading_days, 0)::int AS trading_days,
        COALESCE(e.max_daily_loss_hit, 0)::float8 AS max_daily_loss_hit
      FROM challenge_enrollments e
      INNER JOIN challenges c ON c.id = e.challenge_id
      INNER JOIN users u ON u.id = e.user_id
      WHERE e.status IN ('ACTIVE', 'PASSED')
      ORDER BY pnl_pct DESC, trading_days DESC, e.id ASC
      LIMIT 50
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics top performers error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_TOP_PERFORMERS" });
  }
});

adminChallengesRouter.get("/analytics/popularity", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        c.id AS challenge_id,
        c.name AS challenge_name,
        COUNT(e.id)::int AS enrollment_count,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_count,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_count
      FROM challenges c
      LEFT JOIN challenge_enrollments e ON e.challenge_id = c.id
      GROUP BY c.id
      ORDER BY enrollment_count DESC, c.id DESC
      LIMIT 100
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics popularity error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_POPULARITY" });
  }
});

adminChallengesRouter.get("/analytics/reward-distribution", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        c.id AS challenge_id,
        c.name AS challenge_name,
        COALESCE(pa.prize_count, 0)::int AS prize_count,
        COALESCE(pa.prize_sum_usd, 0)::float8 AS prize_sum_usd,
        COALESCE(ba.badge_count, 0)::int AS badge_count,
        COALESCE(cert.cert_count, 0)::int AS cert_count,
        COALESCE(sb.boost_count, 0)::int AS boost_count
      FROM challenges c
      LEFT JOIN (
        SELECT
          challenge_id,
          COUNT(*)::int AS prize_count,
          COALESCE(SUM(prize_amount_usd), 0)::float8 AS prize_sum_usd
        FROM challenge_prize_awards
        WHERE status IN ('PENDING', 'APPROVED', 'PAID')
        GROUP BY challenge_id
      ) pa ON pa.challenge_id = c.id
      LEFT JOIN (
        SELECT challenge_id, COUNT(*)::int AS badge_count
        FROM challenge_badge_awards
        GROUP BY challenge_id
      ) ba ON ba.challenge_id = c.id
      LEFT JOIN (
        SELECT challenge_id, COUNT(*)::int AS cert_count
        FROM challenge_certificates
        GROUP BY challenge_id
      ) cert ON cert.challenge_id = c.id
      LEFT JOIN (
        SELECT challenge_id, COUNT(*)::int AS boost_count
        FROM challenge_selection_boosts
        GROUP BY challenge_id
      ) sb ON sb.challenge_id = c.id
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 100
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge analytics reward distribution error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_REWARD_DISTRIBUTION" });
  }
});

adminChallengesRouter.get("/analytics/reconciliation", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;
    const challengeIdRaw = Number(req.query.challengeId);
    const challengeId = Number.isInteger(challengeIdRaw) && challengeIdRaw > 0 ? challengeIdRaw : null;
    const recompute = parseBooleanQuery(req.query.recompute, false);
    const epsilonRaw = Number(req.query.epsilon);
    const epsilon = Number.isFinite(epsilonRaw) ? Math.max(0, Math.min(0.05, epsilonRaw)) : 0.000001;

    const statusFilter = ["ACTIVE", "PASSED", "FAILED", "REVIEW_REQUIRED"];
    const whereClause = challengeId
      ? and(inArray(challengeEnrollments.status, statusFilter as any), eq(challengeEnrollments.challengeId, challengeId))
      : inArray(challengeEnrollments.status, statusFilter as any);

    const enrollments = await db
      .select({
        id: challengeEnrollments.id,
        challengeId: challengeEnrollments.challengeId,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        currentPhase: challengeEnrollments.currentPhase,
        enrolledAt: challengeEnrollments.enrolledAt,
        phaseStartedAt: challengeEnrollments.phaseStartedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        tradingDays: challengeEnrollments.tradingDays,
        maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
        maxTotalLossHit: challengeEnrollments.maxTotalLossHit,
        peakEquity: challengeEnrollments.peakEquity,
        capitalBaseUsed: challengeEnrollments.capitalBaseUsed,
        updatedAt: challengeEnrollments.updatedAt,
        challengeName: challenges.name,
        challengeDurationDays: challenges.durationDays,
        challengeVirtualCapitalUsd: challenges.virtualCapitalUsd,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challengeEnrollments.challengeId, challenges.id))
      .where(whereClause)
      .orderBy(desc(challengeEnrollments.updatedAt), desc(challengeEnrollments.id))
      .limit(limit);

    if (!enrollments.length) {
      return res.json({
        ok: true,
        params: { limit, challengeId, recompute, epsilon },
        summary: {
          checkedEnrollments: 0,
          withSnapshots: 0,
          missingSnapshots: 0,
          phaseMismatchCount: 0,
          enrollmentSnapshotDriftCount: 0,
          recomputedCount: 0,
          recomputeMismatchCount: 0,
          hashMismatchCount: 0,
        },
        mismatches: [],
      });
    }

    const enrollmentIds = enrollments.map((row) => Number(row.id));
    const challengeIds = Array.from(new Set(enrollments.map((row) => Number(row.challengeId))));

    const snapshotRows = await db
      .select({
        enrollmentId: challengePhaseSnapshots.enrollmentId,
        phaseNumber: challengePhaseSnapshots.phaseNumber,
        runId: challengePhaseSnapshots.runId,
        inputHash: challengePhaseSnapshots.inputHash,
        pnlPct: challengePhaseSnapshots.pnlPct,
        tradingDays: challengePhaseSnapshots.tradingDays,
        worstDayLossPct: challengePhaseSnapshots.worstDayLossPct,
        startDdPct: challengePhaseSnapshots.startDdPct,
        trailingDdPct: challengePhaseSnapshots.trailingDdPct,
        peakEquity: challengePhaseSnapshots.peakEquity,
        computedAt: challengePhaseSnapshots.computedAt,
      })
      .from(challengePhaseSnapshots)
      .where(inArray(challengePhaseSnapshots.enrollmentId, enrollmentIds))
      .orderBy(desc(challengePhaseSnapshots.computedAt), desc(challengePhaseSnapshots.id));

    const latestSnapshotByEnrollment = new Map<number, any>();
    for (const row of snapshotRows) {
      const key = Number(row.enrollmentId);
      if (!latestSnapshotByEnrollment.has(key)) {
        latestSnapshotByEnrollment.set(key, row);
      }
    }

    const phaseRows = await db
      .select({
        challengeId: challengePhases.challengeId,
        phaseNumber: challengePhases.phaseNumber,
        durationDays: challengePhases.durationDays,
      })
      .from(challengePhases)
      .where(inArray(challengePhases.challengeId, challengeIds));
    const phaseDurationByKey = new Map<string, number>();
    for (const row of phaseRows) {
      const key = `${Number(row.challengeId)}:${Number(row.phaseNumber)}`;
      phaseDurationByKey.set(key, toFiniteNumber(row.durationDays, 0));
    }

    const mismatches: any[] = [];
    let missingSnapshots = 0;
    let phaseMismatchCount = 0;
    let enrollmentSnapshotDriftCount = 0;
    let recomputedCount = 0;
    let recomputeMismatchCount = 0;
    let hashMismatchCount = 0;

    const now = Math.floor(Date.now() / 1000);
    for (const enrollment of enrollments) {
      const snapshot = latestSnapshotByEnrollment.get(Number(enrollment.id)) ?? null;
      const reasons: string[] = [];
      const drift: Record<string, number | Record<string, number>> = {};
      let recomputed: any = null;

      if (!snapshot) {
        missingSnapshots += 1;
        reasons.push("MISSING_SNAPSHOT");
      } else {
        if (Number(snapshot.phaseNumber) !== Number(enrollment.currentPhase)) {
          phaseMismatchCount += 1;
          reasons.push("PHASE_MISMATCH");
        }

        const pnlDrift = driftAbs(enrollment.currentPnlPct, snapshot.pnlPct);
        if (pnlDrift > epsilon) {
          drift.pnlPct = pnlDrift;
        }
        const tradingDaysDrift = Math.abs(Math.trunc(toFiniteNumber(enrollment.tradingDays, 0)) - Math.trunc(toFiniteNumber(snapshot.tradingDays, 0)));
        if (tradingDaysDrift > 0) {
          drift.tradingDays = tradingDaysDrift;
        }
        const dailyDrift = driftAbs(enrollment.maxDailyLossHit, snapshot.worstDayLossPct);
        if (dailyDrift > epsilon) {
          drift.maxDailyLossHit = dailyDrift;
        }
        const peakDrift = driftAbs(enrollment.peakEquity, snapshot.peakEquity);
        if (peakDrift > epsilon) {
          drift.peakEquity = peakDrift;
        }
        const totalLossHit = toFiniteNumber(enrollment.maxTotalLossHit, 0);
        const ddDrift = Math.min(
          Math.abs(totalLossHit - toFiniteNumber(snapshot.startDdPct, 0)),
          Math.abs(totalLossHit - toFiniteNumber(snapshot.trailingDdPct, 0)),
        );
        if (ddDrift > epsilon) {
          drift.maxTotalLossHit = ddDrift;
        }
        if (Object.keys(drift).length) {
          enrollmentSnapshotDriftCount += 1;
          reasons.push("ENROLLMENT_SNAPSHOT_DRIFT");
        }
      }

      if (recompute) {
        recomputedCount += 1;
        const phaseStart = Math.max(0, Math.trunc(toFiniteNumber(enrollment.phaseStartedAt, enrollment.enrolledAt)));
        const phaseDurationDays =
          phaseDurationByKey.get(`${Number(enrollment.challengeId)}:${Number(enrollment.currentPhase)}`) ??
          toFiniteNumber(enrollment.challengeDurationDays, 0);
        const phaseDeadline = phaseDurationDays > 0 ? phaseStart + phaseDurationDays * 86400 : null;
        const evalEnd = phaseDeadline ? Math.min(now, phaseDeadline) : now;
        const fallbackCapital = toFiniteNumber(enrollment.challengeVirtualCapitalUsd, 100000);
        const capitalBaseRaw = toFiniteNumber(enrollment.capitalBaseUsed, fallbackCapital);
        const capitalBase = capitalBaseRaw > 0 ? capitalBaseRaw : Math.max(1, fallbackCapital);

        recomputed = await computePhaseStats({
          userId: Number(enrollment.userId),
          startAt: phaseStart,
          endAt: evalEnd,
          capitalBase,
        });

        const recomputeDrift: Record<string, number> = {};
        if (snapshot) {
          if (String(snapshot.inputHash || "") !== String(recomputed.inputHash || "")) {
            hashMismatchCount += 1;
            reasons.push("INPUT_HASH_MISMATCH");
          }
          const recomputePnlDrift = driftAbs(recomputed.pnlPct, snapshot.pnlPct);
          if (recomputePnlDrift > epsilon) recomputeDrift.snapshotPnlPct = recomputePnlDrift;
          const recomputeDailyDrift = driftAbs(recomputed.worstDayLossPct, snapshot.worstDayLossPct);
          if (recomputeDailyDrift > epsilon) recomputeDrift.snapshotMaxDailyLossHit = recomputeDailyDrift;
          const recomputePeakDrift = driftAbs(recomputed.peakEquity, snapshot.peakEquity);
          if (recomputePeakDrift > epsilon) recomputeDrift.snapshotPeakEquity = recomputePeakDrift;
        }
        const enrollmentPnlDrift = driftAbs(recomputed.pnlPct, enrollment.currentPnlPct);
        if (enrollmentPnlDrift > epsilon) recomputeDrift.enrollmentPnlPct = enrollmentPnlDrift;
        const enrollmentDailyDrift = driftAbs(recomputed.worstDayLossPct, enrollment.maxDailyLossHit);
        if (enrollmentDailyDrift > epsilon) recomputeDrift.enrollmentMaxDailyLossHit = enrollmentDailyDrift;
        const enrollmentPeakDrift = driftAbs(recomputed.peakEquity, enrollment.peakEquity);
        if (enrollmentPeakDrift > epsilon) recomputeDrift.enrollmentPeakEquity = enrollmentPeakDrift;

        if (Object.keys(recomputeDrift).length) {
          recomputeMismatchCount += 1;
          reasons.push("RECOMPUTE_DRIFT");
          drift.recompute = recomputeDrift;
        }
      }

      if (reasons.length) {
        mismatches.push({
          enrollmentId: Number(enrollment.id),
          challengeId: Number(enrollment.challengeId),
          challengeName: enrollment.challengeName,
          userId: Number(enrollment.userId),
          status: enrollment.status,
          phaseNumber: Number(enrollment.currentPhase),
          reasons,
          drift,
          enrollment: {
            currentPnlPct: toFiniteNumber(enrollment.currentPnlPct, 0),
            tradingDays: Math.trunc(toFiniteNumber(enrollment.tradingDays, 0)),
            maxDailyLossHit: toFiniteNumber(enrollment.maxDailyLossHit, 0),
            maxTotalLossHit: toFiniteNumber(enrollment.maxTotalLossHit, 0),
            peakEquity: toFiniteNumber(enrollment.peakEquity, 0),
            updatedAt: toFiniteNumber(enrollment.updatedAt, 0),
          },
          snapshot: snapshot
            ? {
                phaseNumber: Number(snapshot.phaseNumber),
                runId: String(snapshot.runId),
                inputHash: String(snapshot.inputHash),
                pnlPct: toFiniteNumber(snapshot.pnlPct, 0),
                tradingDays: Math.trunc(toFiniteNumber(snapshot.tradingDays, 0)),
                worstDayLossPct: toFiniteNumber(snapshot.worstDayLossPct, 0),
                startDdPct: toFiniteNumber(snapshot.startDdPct, 0),
                trailingDdPct: toFiniteNumber(snapshot.trailingDdPct, 0),
                peakEquity: toFiniteNumber(snapshot.peakEquity, 0),
                computedAt: toFiniteNumber(snapshot.computedAt, 0),
              }
            : null,
          recomputed: recomputed
            ? {
                inputHash: recomputed.inputHash,
                pnlPct: recomputed.pnlPct,
                tradingDays: recomputed.tradingDays,
                worstDayLossPct: recomputed.worstDayLossPct,
                startDdPct: recomputed.startDdPct,
                trailingDdPct: recomputed.trailingDdPct,
                peakEquity: recomputed.peakEquity,
                tradeCount: recomputed.tradeCount,
              }
            : null,
        });
      }
    }

    return res.json({
      ok: true,
      params: { limit, challengeId, recompute, epsilon },
      summary: {
        checkedEnrollments: enrollments.length,
        withSnapshots: enrollments.length - missingSnapshots,
        missingSnapshots,
        phaseMismatchCount,
        enrollmentSnapshotDriftCount,
        recomputedCount,
        recomputeMismatchCount,
        hashMismatchCount,
        mismatchCount: mismatches.length,
      },
      mismatches: mismatches.slice(0, 500),
    });
  } catch (error) {
    console.error("[admin-scout] challenge analytics reconciliation error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ANALYTICS_RECONCILIATION" });
  }
});

adminChallengesRouter.get("/badges", async (_req, res) => {
  try {
    const rows = await db.select().from(challengeBadges).orderBy(desc(challengeBadges.createdAt), desc(challengeBadges.id));
    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[admin-scout] challenge badges list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_BADGES" });
  }
});

adminChallengesRouter.post("/badges", async (req, res) => {
  try {
    const parsed = challengeBadgeUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    const data = parsed.data;
    const [row] = await db
      .insert(challengeBadges)
      .values({
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        iconUrl: data.iconUrl ?? null,
        iconEmoji: data.iconEmoji ?? null,
        category: data.category ?? "GENERAL",
        criteriaJson: data.criteriaJson ?? "{}",
        isActive: data.isActive ?? true,
        createdAt: nowSec(),
      })
      .returning();
    await appendRecruitmentAudit(req, "CHALLENGE_BADGE_CREATE", { badgeId: row.id, key: row.key });
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge badge create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_CHALLENGE_BADGE" });
  }
});

adminChallengesRouter.put("/badges/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_BADGE_ID" });
    const parsed = challengeBadgeUpsertSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "EMPTY_UPDATE" });
    const [row] = await db
      .update(challengeBadges)
      .set({
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description,
        iconUrl: parsed.data.iconUrl,
        iconEmoji: parsed.data.iconEmoji,
        category: parsed.data.category,
        criteriaJson: parsed.data.criteriaJson,
        isActive: parsed.data.isActive,
      })
      .where(eq(challengeBadges.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "BADGE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_BADGE_UPDATE", { badgeId: id, patchKeys: Object.keys(parsed.data) });
    return res.json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge badge update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE_BADGE" });
  }
});

adminChallengesRouter.delete("/badges/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_BADGE_ID" });
    const [row] = await db.delete(challengeBadges).where(eq(challengeBadges.id, id)).returning({ id: challengeBadges.id });
    if (!row) return res.status(404).json({ message: "BADGE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_BADGE_DELETE", { badgeId: id });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge badge delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE_BADGE" });
  }
});

adminChallengesRouter.get("/certificate-templates", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(challengeCertificateTemplates)
      .orderBy(desc(challengeCertificateTemplates.updatedAt), desc(challengeCertificateTemplates.id));
    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[admin-scout] challenge certificate templates list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_CERTIFICATE_TEMPLATES" });
  }
});

adminChallengesRouter.post("/certificate-templates", async (req, res) => {
  try {
    const parsed = challengeCertificateTemplateUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    const data = parsed.data;
    const ts = nowSec();
    const [row] = await db
      .insert(challengeCertificateTemplates)
      .values({
        name: data.name,
        headerText: data.headerText ?? "",
        bodyText: data.bodyText ?? "",
        includeMetrics: data.includeMetrics ?? true,
        includeVerificationCode: data.includeVerificationCode ?? true,
        brandColor: data.brandColor ?? null,
        logoUrl: data.logoUrl ?? null,
        isDownloadable: data.isDownloadable ?? true,
        isShareable: data.isShareable ?? true,
        isActive: data.isActive ?? true,
        createdBy: Number(req.session?.userId || 0) || null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();
    await appendRecruitmentAudit(req, "CHALLENGE_CERTIFICATE_TEMPLATE_CREATE", { templateId: row.id });
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge certificate template create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_CHALLENGE_CERTIFICATE_TEMPLATE" });
  }
});

adminChallengesRouter.put("/certificate-templates/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_TEMPLATE_ID" });
    const parsed = challengeCertificateTemplateUpsertSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "EMPTY_UPDATE" });
    const [row] = await db
      .update(challengeCertificateTemplates)
      .set({
        name: parsed.data.name,
        headerText: parsed.data.headerText,
        bodyText: parsed.data.bodyText,
        includeMetrics: parsed.data.includeMetrics,
        includeVerificationCode: parsed.data.includeVerificationCode,
        brandColor: parsed.data.brandColor,
        logoUrl: parsed.data.logoUrl,
        isDownloadable: parsed.data.isDownloadable,
        isShareable: parsed.data.isShareable,
        isActive: parsed.data.isActive,
        updatedAt: nowSec(),
      })
      .where(eq(challengeCertificateTemplates.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "TEMPLATE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_CERTIFICATE_TEMPLATE_UPDATE", {
      templateId: id,
      patchKeys: Object.keys(parsed.data),
    });
    return res.json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge certificate template update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE_CERTIFICATE_TEMPLATE" });
  }
});

adminChallengesRouter.delete("/certificate-templates/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_TEMPLATE_ID" });
    const [row] = await db
      .delete(challengeCertificateTemplates)
      .where(eq(challengeCertificateTemplates.id, id))
      .returning({ id: challengeCertificateTemplates.id });
    if (!row) return res.status(404).json({ message: "TEMPLATE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_CERTIFICATE_TEMPLATE_DELETE", { templateId: id });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge certificate template delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE_CERTIFICATE_TEMPLATE" });
  }
});

adminChallengesRouter.get("/progression-tiers", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(challengeProgressionTiers)
      .orderBy(desc(challengeProgressionTiers.updatedAt), desc(challengeProgressionTiers.id));
    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[admin-scout] challenge progression tiers list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_PROGRESSION_TIERS" });
  }
});

adminChallengesRouter.post("/progression-tiers", async (req, res) => {
  try {
    const parsed = challengeProgressionTierUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    const ts = nowSec();
    const [row] = await db
      .insert(challengeProgressionTiers)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        tiersJson: parsed.data.tiersJson ?? "[]",
        isActive: parsed.data.isActive ?? true,
        createdBy: Number(req.session?.userId || 0) || null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();
    await appendRecruitmentAudit(req, "CHALLENGE_PROGRESSION_TIER_CREATE", { progressionTierId: row.id });
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge progression tier create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_CHALLENGE_PROGRESSION_TIER" });
  }
});

adminChallengesRouter.put("/progression-tiers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_PROGRESSION_TIER_ID" });
    const parsed = challengeProgressionTierUpsertSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ message: "EMPTY_UPDATE" });
    const [row] = await db
      .update(challengeProgressionTiers)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        tiersJson: parsed.data.tiersJson,
        isActive: parsed.data.isActive,
        updatedAt: nowSec(),
      })
      .where(eq(challengeProgressionTiers.id, id))
      .returning();
    if (!row) return res.status(404).json({ message: "PROGRESSION_TIER_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_PROGRESSION_TIER_UPDATE", { progressionTierId: id, patchKeys: Object.keys(parsed.data) });
    return res.json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge progression tier update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE_PROGRESSION_TIER" });
  }
});

adminChallengesRouter.delete("/progression-tiers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_PROGRESSION_TIER_ID" });
    const [row] = await db
      .delete(challengeProgressionTiers)
      .where(eq(challengeProgressionTiers.id, id))
      .returning({ id: challengeProgressionTiers.id });
    if (!row) return res.status(404).json({ message: "PROGRESSION_TIER_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_PROGRESSION_TIER_DELETE", { progressionTierId: id });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge progression tier delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE_PROGRESSION_TIER" });
  }
});

adminChallengesRouter.get("/prizes", async (req, res) => {
  try {
    const challengeId = Number(req.query.challengeId ?? 0);
    const status = safeString(req.query.status).trim().toUpperCase();
    const clauses = [sql`1=1`];
    if (Number.isInteger(challengeId) && challengeId > 0) clauses.push(sql`p.challenge_id = ${challengeId}`);
    if (status) clauses.push(sql`p.status = ${status}`);

    const rows = await db.execute(sql`
      SELECT
        p.*,
        c.name AS challenge_name,
        u.username,
        u.email
      FROM challenge_prize_awards p
      INNER JOIN challenges c ON c.id = p.challenge_id
      INNER JOIN users u ON u.id = p.user_id
      WHERE ${sql.join(clauses, sql` AND `)}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 2000
    `);
    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenge prizes list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_PRIZES" });
  }
});

adminChallengesRouter.put("/prizes/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_PRIZE_ID" });
    if (!enforceAdminResourceScope(req, res, "prize", id)) return;
    if (!enforceChallengeAdminActionRateLimit(req, res, "PRIZE_APPROVE", 40)) return;
    const parsed = challengePrizeApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });

    const action = parsed.data.action;
    const status = action === "APPROVE" ? "APPROVED" : action === "PAID" ? "PAID" : "CANCELLED";
    const ts = nowSec();
    const [existing] = await db.select().from(challengePrizeAwards).where(eq(challengePrizeAwards.id, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "PRIZE_NOT_FOUND" });
    if (!enforceAdminResourceScope(req, res, "challenge", Number(existing.challengeId))) return;

    const prevHash = existing.eventHash ?? null;
    const eventPayload = JSON.stringify({
      id,
      action,
      status,
      at: ts,
      by: Number(req.session?.userId || 0) || null,
      note: parsed.data.note ?? null,
    });
    const eventHash = sha256Hex(`${prevHash || ""}|${eventPayload}`);

    const [row] = await db
      .update(challengePrizeAwards)
      .set({
        status,
        approvedBy: Number(req.session?.userId || 0) || null,
        approvedAt: action === "APPROVE" ? ts : existing.approvedAt,
        paidAt: action === "PAID" ? ts : existing.paidAt,
        note: parsed.data.note ?? existing.note,
        prevHash,
        eventHash,
      })
      .where(eq(challengePrizeAwards.id, id))
      .returning();

    await appendRecruitmentAudit(req, "CHALLENGE_PRIZE_APPROVAL", { prizeId: id, action, status });
    return res.json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge prize approval error:", error);
    return res.status(500).json({ message: "FAILED_TO_APPROVE_CHALLENGE_PRIZE" });
  }
});

adminChallengesRouter.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const [challengeRow] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!challengeRow) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const enrollmentRows = await db
      .select({
        id: challengeEnrollments.id,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        tradingDays: challengeEnrollments.tradingDays,
        maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
        maxTotalLossHit: challengeEnrollments.maxTotalLossHit,
        currentPhase: challengeEnrollments.currentPhase,
        attemptNumber: challengeEnrollments.attemptNumber,
        phaseStartedAt: challengeEnrollments.phaseStartedAt,
        adminNotes: challengeEnrollments.adminNotes,
      })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.challengeId, id))
      .orderBy(desc(challengeEnrollments.id))
      .limit(500);
    const phaseRows = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, id))
      .orderBy(asc(challengePhases.phaseNumber));
    const leaderboard = await db
      .select()
      .from(challengeLeaderboardSnapshot)
      .where(eq(challengeLeaderboardSnapshot.challengeId, id))
      .orderBy(asc(challengeLeaderboardSnapshot.rank))
      .limit(100);

    const enrollmentIds = enrollmentRows.map((r) => r.id);
    const recentEvents =
      enrollmentIds.length > 0
        ? await db
            .select()
            .from(challengeEnrollmentEvents)
            .where(inArray(challengeEnrollmentEvents.enrollmentId, enrollmentIds))
            .orderBy(desc(challengeEnrollmentEvents.id))
            .limit(500)
        : [];

    const safeEnrollmentRows = enrollmentRows.map((row) => ({
      ...row,
      adminNotes: decryptChallengeAdminNote(row.adminNotes),
    }));

    return res.json({
      ok: true,
      row: challengeRow,
      phases: phaseRows,
      enrollments: safeEnrollmentRows,
      leaderboard,
      recentEvents,
    });
  } catch (error) {
    console.error("[admin-scout] challenge get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE" });
  }
});

adminChallengesRouter.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const parsed = challengeUpsertSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const nextStartAt = parsed.data.startAt ?? existing.startAt;
    const nextEndAt = parsed.data.endAt ?? existing.endAt;
    if (nextStartAt != null && nextEndAt != null && nextEndAt < nextStartAt) {
      return res.status(400).json({ message: "INVALID_TIME_WINDOW" });
    }
    const nextEnrollmentStartAt = parsed.data.enrollmentStartAt ?? existing.enrollmentStartAt;
    const nextEnrollmentEndAt = parsed.data.enrollmentEndAt ?? existing.enrollmentEndAt;
    if (
      nextEnrollmentStartAt != null &&
      nextEnrollmentEndAt != null &&
      nextEnrollmentEndAt < nextEnrollmentStartAt
    ) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_WINDOW" });
    }
    if (parsed.data.slug && parsed.data.slug !== existing.slug) {
      const [slugRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.slug, parsed.data.slug)).limit(1);
      if (slugRow) return res.status(409).json({ message: "CHALLENGE_SLUG_EXISTS" });
    }

    const [updated] = await db
      .update(challenges)
      .set({
        name: parsed.data.name,
        description: parsed.data.description,
        profitTargetPct: parsed.data.profitTargetPct,
        maxDailyLossPct: parsed.data.maxDailyLossPct,
        maxTotalLossPct: parsed.data.maxTotalLossPct,
        minTradingDays: parsed.data.minTradingDays,
        durationDays: parsed.data.durationDays,
        startAt: parsed.data.startAt,
        endAt: parsed.data.endAt,
        enrollmentStartAt: parsed.data.enrollmentStartAt,
        enrollmentEndAt: parsed.data.enrollmentEndAt,
        visibleToTraders: parsed.data.visibleToTraders,
        featuredOrder: parsed.data.featuredOrder,
        category: parsed.data.category,
        tier: parsed.data.tier,
        slug: parsed.data.slug,
        tags: parsed.data.tags,
        iconColor: parsed.data.iconColor,
        virtualCapitalUsd: parsed.data.virtualCapitalUsd,
        capitalMode: parsed.data.capitalMode,
        leverageMultiplier: parsed.data.leverageMultiplier,
        maxEnrollments: parsed.data.maxEnrollments,
        maxActiveEnrollments: parsed.data.maxActiveEnrollments,
        maxRetriesPerTrader: parsed.data.maxRetriesPerTrader,
        retryCooldownHours: parsed.data.retryCooldownHours,
        eligibilityGate: parsed.data.eligibilityGate,
        prizePoolEnabled: parsed.data.prizePoolEnabled,
        prizePoolUsd: parsed.data.prizePoolUsd,
        prizeDistributionJson: parsed.data.prizeDistributionJson,
        prizeMinCompletions: parsed.data.prizeMinCompletions,
        prizeAwardTiming: parsed.data.prizeAwardTiming,
        badgesEnabled: parsed.data.badgesEnabled,
        badgeOnPass: parsed.data.badgeOnPass,
        badgeOnTop3: parsed.data.badgeOnTop3,
        certificateEnabled: parsed.data.certificateEnabled,
        certificateDownloadable: parsed.data.certificateDownloadable,
        certificateShareable: parsed.data.certificateShareable,
        certificateTemplateId: parsed.data.certificateTemplateId,
        certificateIncludeMetrics: parsed.data.certificateIncludeMetrics,
        selectionBoostEnabled: parsed.data.selectionBoostEnabled,
        selectionBoostPoints: parsed.data.selectionBoostPoints,
        partnerVisibilityOnPass: parsed.data.partnerVisibilityOnPass,
        autoWatchlistTier: parsed.data.autoWatchlistTier,
        progressionTierId: parsed.data.progressionTierId,
        customRewardJson: parsed.data.customRewardJson,
        leaderboardEnabled: parsed.data.leaderboardEnabled,
        leaderboardAnonymize: parsed.data.leaderboardAnonymize,
        leaderboardMaxVisible: parsed.data.leaderboardMaxVisible,
        isActive: parsed.data.isActive,
        updatedAt: nowSec(),
        updatedBy: String(req.session?.email || "admin"),
      })
      .where(eq(challenges.id, id))
      .returning();

    const phases = parsed.data.phases ?? [];
    if (phases.length > 0) {
      const ts = nowSec();
      await db.transaction(async (tx) => {
        await tx.delete(challengePhases).where(eq(challengePhases.challengeId, id));
        await tx.insert(challengePhases).values(
          [...phases]
            .sort((a, b) => a.phaseNumber - b.phaseNumber)
            .map((p) => ({
              challengeId: id,
              phaseNumber: p.phaseNumber,
              phaseName: p.phaseName ?? `Phase ${p.phaseNumber}`,
              profitTargetPct: p.profitTargetPct,
              maxDailyLossPct: p.maxDailyLossPct,
              maxTotalLossPct: p.maxTotalLossPct ?? null,
              drawdownType: p.drawdownType ?? "STATIC",
              durationDays: p.durationDays,
              minTradingDays: p.minTradingDays ?? null,
              maxSingleDayProfitPct: p.maxSingleDayProfitPct ?? null,
              allowWeekendHolding: p.allowWeekendHolding ?? true,
              allowNewsTrading: p.allowNewsTrading ?? true,
              restrictedSymbolsCsv: p.restrictedSymbolsCsv ?? "",
              maxConcurrentPositions: p.maxConcurrentPositions ?? null,
              maxLotSize: p.maxLotSize ?? null,
              createdAt: ts,
              updatedAt: ts,
            })),
        );
      });
    }

    await appendRecruitmentAudit(req, "CHALLENGE_UPDATE", { challengeId: id, patchKeys: Object.keys(parsed.data) });
    publishChallengesUpdated({ action: "updated", challengeId: id, patchKeys: Object.keys(parsed.data) });
    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] challenge update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE" });
  }
});

adminChallengesRouter.put("/:id/phases", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const parsed = z
      .object({
        phases: z
          .array(
            z.object({
              phaseNumber: z.number().int().min(1).max(10),
              phaseName: z.string().trim().max(120).optional().nullable(),
              profitTargetPct: z.number().min(0).max(10),
              maxDailyLossPct: z.number().min(0).max(10),
              maxTotalLossPct: z.number().min(0).max(10).optional().nullable(),
              drawdownType: z.enum(["STATIC", "TRAILING"]).optional(),
              durationDays: z.number().int().min(1).max(365),
              minTradingDays: z.number().int().min(0).max(365).optional().nullable(),
              maxSingleDayProfitPct: z.number().min(0).max(10).optional().nullable(),
              allowWeekendHolding: z.boolean().optional(),
              allowNewsTrading: z.boolean().optional(),
              restrictedSymbolsCsv: z.string().trim().max(4000).optional().nullable(),
              maxConcurrentPositions: z.number().int().min(1).max(2000).optional().nullable(),
              maxLotSize: z.number().positive().max(10000).optional().nullable(),
            }),
          )
          .min(1)
          .max(3),
      })
      .strict()
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const [challengeRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!challengeRow) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });

    const ts = nowSec();
    await db.transaction(async (tx) => {
      await tx.delete(challengePhases).where(eq(challengePhases.challengeId, id));
      await tx.insert(challengePhases).values(
        parsed.data.phases
          .slice()
          .sort((a, b) => a.phaseNumber - b.phaseNumber)
          .map((p) => ({
            challengeId: id,
            phaseNumber: p.phaseNumber,
            phaseName: p.phaseName ?? `Phase ${p.phaseNumber}`,
            profitTargetPct: p.profitTargetPct,
            maxDailyLossPct: p.maxDailyLossPct,
            maxTotalLossPct: p.maxTotalLossPct ?? null,
            drawdownType: p.drawdownType ?? "STATIC",
            durationDays: p.durationDays,
            minTradingDays: p.minTradingDays ?? null,
            maxSingleDayProfitPct: p.maxSingleDayProfitPct ?? null,
            allowWeekendHolding: p.allowWeekendHolding ?? true,
            allowNewsTrading: p.allowNewsTrading ?? true,
            restrictedSymbolsCsv: p.restrictedSymbolsCsv ?? "",
            maxConcurrentPositions: p.maxConcurrentPositions ?? null,
            maxLotSize: p.maxLotSize ?? null,
            createdAt: ts,
            updatedAt: ts,
          })),
      );
    });

    await appendRecruitmentAudit(req, "CHALLENGE_PHASES_REPLACE", { challengeId: id, count: parsed.data.phases.length });
    publishChallengesUpdated({ action: "phases-replaced", challengeId: id, count: parsed.data.phases.length });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge phases update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE_PHASES" });
  }
});

adminChallengesRouter.post("/enrollments/:id/action", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    }
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_ACTION")) return;

    const parsed = challengeEnrollmentActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    const action = parsed.data.action;
    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action,
      note: parsed.data.note ?? null,
      actorUserId: Number(req.session?.userId || 0) || null,
    });

    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_ADMIN_ACTION", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
      action,
    });

    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    const actionTitle =
      action === "DISQUALIFY"
        ? "Challenge disqualified"
        : action === "ADVANCE_PHASE"
          ? "Challenge phase advanced"
          : action === "RESET_PHASE"
            ? "Challenge reset"
            : action === "WITHDRAW"
              ? "Challenge withdrawn"
              : "Challenge note updated";
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: actionTitle,
      message: `Admin action ${action} was applied to your ${challengeRow?.name ?? "challenge"} enrollment.`,
      sourceEvent: `CHALLENGE_ADMIN_${action}`,
      severity: action === "DISQUALIFY" ? "WARNING" : "INFO",
      mailboxRecommended: action === "DISQUALIFY" || action === "WITHDRAW",
    });

    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") {
      return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    }
    console.error("[admin-scout] challenge enrollment action error:", error);
    return res.status(500).json({ message: "FAILED_TO_APPLY_ENROLLMENT_ACTION" });
  }
});

adminChallengesRouter.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const [deleted] = await db.delete(challenges).where(eq(challenges.id, id)).returning({ id: challenges.id });
    if (!deleted) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "CHALLENGE_DELETE", { challengeId: id });
    publishChallengesUpdated({ action: "deleted", challengeId: id });
    return res.json({ ok: true, id });
  } catch (error) {
    console.error("[admin-scout] challenge delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE" });
  }
});


export { adminChallengesRouter };
