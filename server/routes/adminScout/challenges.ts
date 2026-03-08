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

export const adminChallengesRouter = Router();
adminChallengesRouter.use(requireAdmin);

adminChallengesRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        c.*,
        COUNT(e.id)::int AS enrollment_count,
        SUM(CASE WHEN e.status = 'ACTIVE' THEN 1 ELSE 0 END)::int AS active_enrollment_count,
        SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::int AS passed_count,
        SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_count,
        CASE
          WHEN COUNT(e.id) = 0 THEN 0::float8
          ELSE SUM(CASE WHEN e.status = 'PASSED' THEN 1 ELSE 0 END)::float8 / COUNT(e.id)::float8
        END AS pass_rate
      FROM challenges c
      LEFT JOIN challenge_enrollments e ON e.challenge_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC, c.id DESC
    `);

    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] challenges list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGES" });
  }
});

adminChallengesRouter.post("/", async (req, res) => {
  try {
    const parsed = challengeUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const data = parsed.data;
    const cfg = await getSystemChallengeConfig();
    const [globalCfg] = await db
      .select({ defaultChallengeVirtualCapitalUsd: globalSettings.defaultChallengeVirtualCapitalUsd })
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1);
    const defaultChallengeVirtualCapitalRaw = Number(globalCfg?.defaultChallengeVirtualCapitalUsd ?? 100000);
    const defaultChallengeVirtualCapitalUsd =
      Number.isFinite(defaultChallengeVirtualCapitalRaw) && defaultChallengeVirtualCapitalRaw > 0
        ? defaultChallengeVirtualCapitalRaw
        : 100000;
    const defaultEligibilityGate =
      typeof cfg.challengeDefaultEligibility === "string"
        ? cfg.challengeDefaultEligibility
        : JSON.stringify(cfg.challengeDefaultEligibility ?? "EMAIL_VERIFIED");
    if (data.startAt != null && data.endAt != null && data.endAt < data.startAt) {
      return res.status(400).json({ message: "INVALID_TIME_WINDOW" });
    }
    if (data.enrollmentStartAt != null && data.enrollmentEndAt != null && data.enrollmentEndAt < data.enrollmentStartAt) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_WINDOW" });
    }
    if (data.slug) {
      const [slugRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.slug, data.slug)).limit(1);
      if (slugRow) return res.status(409).json({ message: "CHALLENGE_SLUG_EXISTS" });
    }

    const ts = nowSec();
    const [created] = await db
      .insert(challenges)
      .values({
        name: data.name,
        description: data.description ?? null,
        profitTargetPct: data.profitTargetPct,
        maxDailyLossPct: data.maxDailyLossPct,
        maxTotalLossPct: data.maxTotalLossPct ?? null,
        minTradingDays: data.minTradingDays ?? null,
        durationDays: data.durationDays,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        enrollmentStartAt: data.enrollmentStartAt ?? null,
        enrollmentEndAt: data.enrollmentEndAt ?? null,
        visibleToTraders: data.visibleToTraders ?? true,
        featuredOrder: data.featuredOrder ?? 0,
        category: data.category ?? cfg.challengeDefaultCategory ?? "STANDARD",
        tier: data.tier ?? cfg.challengeDefaultTier ?? "STARTER",
        slug: data.slug ?? null,
        tags: data.tags ?? "",
        iconColor: data.iconColor ?? null,
        virtualCapitalUsd: data.virtualCapitalUsd ?? defaultChallengeVirtualCapitalUsd,
        capitalMode: data.capitalMode ?? "VIRTUAL",
        leverageMultiplier: data.leverageMultiplier ?? 1,
        maxEnrollments: data.maxEnrollments ?? null,
        maxActiveEnrollments: data.maxActiveEnrollments ?? null,
        maxRetriesPerTrader: data.maxRetriesPerTrader ?? cfg.challengeDefaultMaxRetries ?? 3,
        retryCooldownHours: data.retryCooldownHours ?? cfg.challengeDefaultRetryCooldownHours ?? 24,
        eligibilityGate: data.eligibilityGate ?? defaultEligibilityGate,
        prizePoolEnabled: data.prizePoolEnabled ?? false,
        prizePoolUsd: data.prizePoolUsd ?? 0,
        prizeDistributionJson: data.prizeDistributionJson ?? "{}",
        prizeMinCompletions: data.prizeMinCompletions ?? 0,
        prizeAwardTiming: data.prizeAwardTiming ?? "ON_COMPLETE",
        badgesEnabled: data.badgesEnabled ?? false,
        badgeOnPass: data.badgeOnPass ?? null,
        badgeOnTop3: data.badgeOnTop3 ?? null,
        certificateEnabled: data.certificateEnabled ?? false,
        certificateDownloadable: data.certificateDownloadable ?? true,
        certificateShareable: data.certificateShareable ?? true,
        certificateTemplateId: data.certificateTemplateId ?? null,
        certificateIncludeMetrics: data.certificateIncludeMetrics ?? true,
        selectionBoostEnabled: data.selectionBoostEnabled ?? false,
        selectionBoostPoints: data.selectionBoostPoints ?? 0,
        partnerVisibilityOnPass: data.partnerVisibilityOnPass ?? true,
        autoWatchlistTier: data.autoWatchlistTier ?? null,
        progressionTierId: data.progressionTierId ?? null,
        customRewardJson: data.customRewardJson ?? "{}",
        leaderboardEnabled: data.leaderboardEnabled ?? true,
        leaderboardAnonymize: data.leaderboardAnonymize ?? false,
        leaderboardMaxVisible: data.leaderboardMaxVisible ?? 100,
        isActive: Boolean(data.isActive ?? false),
        createdBy: Number(req.session?.userId || 0) || null,
        createdAt: ts,
        updatedAt: ts,
        updatedBy: String(req.session?.email || "admin"),
      })
      .returning();

    const phases = data.phases && data.phases.length > 0
      ? [...data.phases].sort((a, b) => a.phaseNumber - b.phaseNumber)
      : [
          {
            phaseNumber: 1,
            phaseName: "Phase 1",
            profitTargetPct: data.profitTargetPct,
            maxDailyLossPct: data.maxDailyLossPct,
            maxTotalLossPct: data.maxTotalLossPct ?? null,
            drawdownType: "STATIC",
            durationDays: data.durationDays,
            minTradingDays: data.minTradingDays ?? 0,
            maxSingleDayProfitPct: null,
            allowWeekendHolding: true,
            allowNewsTrading: true,
            restrictedSymbolsCsv: "",
            maxConcurrentPositions: null,
            maxLotSize: null,
          },
        ];

    await db.insert(challengePhases).values(
      phases.map((p) => ({
        challengeId: created.id,
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

    await appendRecruitmentAudit(req, "CHALLENGE_CREATE", { challengeId: created.id });
    publishChallengesUpdated({ action: "created", challengeId: created.id });
    return res.status(201).json({ ok: true, row: created });
  } catch (error) {
    console.error("[admin-scout] challenge create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_CHALLENGE" });
  }
});

adminChallengesRouter.get("/settings", async (_req, res) => {
  try {
    const [row] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    return res.json({
      ok: true,
      settings: {
        traderCompeteEnabled: Boolean((row as any)?.traderCompeteEnabled ?? false),
        challengeAutoAdvancePhase: Boolean((row as any)?.challengeAutoAdvancePhase ?? true),
        challengeEvalIntervalMin: clampInt((row as any)?.challengeEvalIntervalMin, 60, 1, 24 * 60),
        challengeEvalMaxRows: clampInt((row as any)?.challengeEvalMaxRows, 500, 1, 5000),
        challengeEvaluationIntervalSec: clampInt((row as any)?.challengeEvaluationIntervalSec, 3600, 60, 24 * 3600),
        challengeWarningThresholdPct: Number((row as any)?.challengeWarningThresholdPct ?? 0.8),
        challengeDefaultDrawdownType: String((row as any)?.challengeDefaultDrawdownType ?? "STATIC"),
        challengeDefaultCapitalMode: String((row as any)?.challengeDefaultCapitalMode ?? "VIRTUAL"),
        challengeDefaultMaxRetries: clampInt((row as any)?.challengeDefaultMaxRetries, 3, 0, 100),
        challengeDefaultRetryCooldownHours: clampInt(
          (row as any)?.challengeDefaultRetryCooldownHours,
          24,
          0,
          24 * 365,
        ),
        challengeDefaultEligibility: String((row as any)?.challengeDefaultEligibility ?? "EMAIL_VERIFIED"),
        challengeDefaultCategory: String((row as any)?.challengeDefaultCategory ?? "STANDARD"),
        challengeDefaultTier: String((row as any)?.challengeDefaultTier ?? "STARTER"),
        challengeRewardsEnabled: Boolean((row as any)?.challengeRewardsEnabled ?? true),
        challengePrizePoolsEnabled: Boolean((row as any)?.challengePrizePoolsEnabled ?? true),
        challengeBadgesEnabled: Boolean((row as any)?.challengeBadgesEnabled ?? true),
        challengeCertificatesEnabled: Boolean((row as any)?.challengeCertificatesEnabled ?? true),
        challengeCertificatesDownloadable: Boolean((row as any)?.challengeCertificatesDownloadable ?? true),
        challengeCertificatesShareable: Boolean((row as any)?.challengeCertificatesShareable ?? true),
        challengeSelectionBoostEnabled: Boolean((row as any)?.challengeSelectionBoostEnabled ?? true),
        challengeDefaultSelectionBoost: Number((row as any)?.challengeDefaultSelectionBoost ?? 0),
        challengeProgressionEnabled: Boolean((row as any)?.challengeProgressionEnabled ?? true),
        challengeCustomRewardsEnabled: Boolean((row as any)?.challengeCustomRewardsEnabled ?? false),
        challengeNotifyOnEnroll: Boolean((row as any)?.challengeNotifyOnEnroll ?? true),
        challengeNotifyOnPhaseWarning: Boolean((row as any)?.challengeNotifyOnPhaseWarning ?? true),
        challengeNotifyOnBreach: Boolean((row as any)?.challengeNotifyOnBreach ?? true),
        challengeNotifyOnPhasePass: Boolean((row as any)?.challengeNotifyOnPhasePass ?? true),
        challengeNotifyOnFail: Boolean((row as any)?.challengeNotifyOnFail ?? true),
        challengeNotifyOnComplete: Boolean((row as any)?.challengeNotifyOnComplete ?? true),
        challengeNotifyOnBadgeAward: Boolean((row as any)?.challengeNotifyOnBadgeAward ?? true),
        challengeNotifyOnPrizeAward: Boolean((row as any)?.challengeNotifyOnPrizeAward ?? true),
        challengeNotifyOnCertIssue: Boolean((row as any)?.challengeNotifyOnCertIssue ?? true),
        challengeNotifyOnTierUp: Boolean((row as any)?.challengeNotifyOnTierUp ?? true),
        challengeNotifyOnAdminAction: Boolean((row as any)?.challengeNotifyOnAdminAction ?? true),
        challengeNotifyViaMailbox: Boolean((row as any)?.challengeNotifyViaMailbox ?? false),
        challengeMailboxCategory: String((row as any)?.challengeMailboxCategory ?? "SYSTEM"),
        challengeLeaderboardEnabled: Boolean((row as any)?.challengeLeaderboardEnabled ?? true),
        challengeLeaderboardRefreshSec: clampInt((row as any)?.challengeLeaderboardRefreshSec, 60, 10, 24 * 3600),
        challengeLeaderboardSnapshotIntervalSec: clampInt(
          (row as any)?.challengeLeaderboardSnapshotIntervalSec,
          60,
          10,
          24 * 3600,
        ),
        challengeLeaderboardRankingMetric: String((row as any)?.challengeLeaderboardRankingMetric ?? "COMPOSITE_SCORE"),
        challengePrizeAwardTimingDefault: String((row as any)?.challengePrizeAwardTimingDefault ?? "ON_COMPLETE"),
        challengePrizeCandidatesDefault: String((row as any)?.challengePrizeCandidatesDefault ?? "PASSED_ONLY"),
        challengeBreachPolicyDefault: String((row as any)?.challengeBreachPolicyDefault ?? "FAIL"),
        challengeSingleDayProfitBasis: String((row as any)?.challengeSingleDayProfitBasis ?? "PNL_PCT"),
        challengeNewsBlackoutWindowsJson: String((row as any)?.challengeNewsBlackoutWindowsJson ?? "[]"),
        challengeWeekendCutoffHours: clampInt((row as any)?.challengeWeekendCutoffHours, 6, 0, 72),
        challengeForceCloseBeforeWeekend: Boolean((row as any)?.challengeForceCloseBeforeWeekend ?? false),
        challengeLeverageMultiplierDefault: Number((row as any)?.challengeLeverageMultiplierDefault ?? 1),
        challengeMaxActiveEnrollmentsUser: clampInt((row as any)?.challengeMaxActiveEnrollmentsUser, 5, 1, 1000),
        challengeMaxActiveEnrollmentsPerChallenge: clampInt(
          (row as any)?.challengeMaxActiveEnrollmentsPerChallenge,
          1,
          1,
          1000,
        ),
        challengeCooldownHoursAfterFail: clampInt((row as any)?.challengeCooldownHoursAfterFail, 24, 0, 24 * 365),
        challengeCooldownHoursAfterWithdraw: clampInt(
          (row as any)?.challengeCooldownHoursAfterWithdraw,
          12,
          0,
          24 * 365,
        ),
        challengeCertificateDefaultTemplateId:
          Number((row as any)?.challengeCertificateDefaultTemplateId ?? 0) > 0
            ? Math.trunc(Number((row as any)?.challengeCertificateDefaultTemplateId))
            : null,
        challengeCertificateIncludeMetricsDefault: Boolean(
          (row as any)?.challengeCertificateIncludeMetricsDefault ?? true,
        ),
        challengeCertificateIncludeQrDefault: Boolean((row as any)?.challengeCertificateIncludeQrDefault ?? true),
        challengeCertificateVerificationKeyId: String((row as any)?.challengeCertificateVerificationKeyId ?? "v1"),
        challengeAuditStrictMode: Boolean((row as any)?.challengeAuditStrictMode ?? true),
        challengeAnomalyDetectionEnabled: Boolean((row as any)?.challengeAnomalyDetectionEnabled ?? true),
        challengeManualReviewEnabled: Boolean((row as any)?.challengeManualReviewEnabled ?? false),
        challengeManualReviewSuspiciousThreshold: clampInt(
          (row as any)?.challengeManualReviewSuspiciousThreshold,
          3,
          1,
          100,
        ),
      },
    });
  } catch (error) {
    console.error("[admin-scout] challenge settings get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_SETTINGS" });
  }
});

adminChallengesRouter.put("/settings", async (req, res) => {
  try {
    const parsed = challengeSettingsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    await db
      .insert(systemConfig)
      .values({ id: 1, updatedAt: nowSec(), updatedBy: String(req.session?.email || "admin") } as any)
      .onConflictDoNothing();

    const payload = parsed.data;
    await db
      .update(systemConfig)
      .set({
        traderCompeteEnabled: payload.traderCompeteEnabled,
        challengeAutoAdvancePhase: payload.challengeAutoAdvancePhase,
        challengeEvalIntervalMin: payload.challengeEvalIntervalMin,
        challengeEvalMaxRows: payload.challengeEvalMaxRows,
        challengeEvaluationIntervalSec: payload.challengeEvaluationIntervalSec,
        challengeWarningThresholdPct: payload.challengeWarningThresholdPct,
        challengeDefaultDrawdownType: payload.challengeDefaultDrawdownType,
        challengeDefaultCapitalMode: payload.challengeDefaultCapitalMode,
        challengeDefaultMaxRetries: payload.challengeDefaultMaxRetries,
        challengeDefaultRetryCooldownHours: payload.challengeDefaultRetryCooldownHours,
        challengeDefaultEligibility: payload.challengeDefaultEligibility,
        challengeDefaultCategory: payload.challengeDefaultCategory,
        challengeDefaultTier: payload.challengeDefaultTier,
        challengeRewardsEnabled: payload.challengeRewardsEnabled,
        challengePrizePoolsEnabled: payload.challengePrizePoolsEnabled,
        challengeBadgesEnabled: payload.challengeBadgesEnabled,
        challengeCertificatesEnabled: payload.challengeCertificatesEnabled,
        challengeCertificatesDownloadable: payload.challengeCertificatesDownloadable,
        challengeCertificatesShareable: payload.challengeCertificatesShareable,
        challengeSelectionBoostEnabled: payload.challengeSelectionBoostEnabled,
        challengeDefaultSelectionBoost: payload.challengeDefaultSelectionBoost,
        challengeProgressionEnabled: payload.challengeProgressionEnabled,
        challengeCustomRewardsEnabled: payload.challengeCustomRewardsEnabled,
        challengeNotifyOnEnroll: payload.challengeNotifyOnEnroll,
        challengeNotifyOnPhaseWarning: payload.challengeNotifyOnPhaseWarning,
        challengeNotifyOnBreach: payload.challengeNotifyOnBreach,
        challengeNotifyOnPhasePass: payload.challengeNotifyOnPhasePass,
        challengeNotifyOnFail: payload.challengeNotifyOnFail,
        challengeNotifyOnComplete: payload.challengeNotifyOnComplete,
        challengeNotifyOnBadgeAward: payload.challengeNotifyOnBadgeAward,
        challengeNotifyOnPrizeAward: payload.challengeNotifyOnPrizeAward,
        challengeNotifyOnCertIssue: payload.challengeNotifyOnCertIssue,
        challengeNotifyOnTierUp: payload.challengeNotifyOnTierUp,
        challengeNotifyOnAdminAction: payload.challengeNotifyOnAdminAction,
        challengeNotifyViaMailbox: payload.challengeNotifyViaMailbox,
        challengeMailboxCategory: payload.challengeMailboxCategory,
        challengeLeaderboardEnabled: payload.challengeLeaderboardEnabled,
        challengeLeaderboardRefreshSec: payload.challengeLeaderboardRefreshSec,
        challengeLeaderboardSnapshotIntervalSec: payload.challengeLeaderboardSnapshotIntervalSec,
        challengeLeaderboardRankingMetric: payload.challengeLeaderboardRankingMetric,
        challengePrizeAwardTimingDefault: payload.challengePrizeAwardTimingDefault,
        challengePrizeCandidatesDefault: payload.challengePrizeCandidatesDefault,
        challengeBreachPolicyDefault: payload.challengeBreachPolicyDefault,
        challengeSingleDayProfitBasis: payload.challengeSingleDayProfitBasis,
        challengeNewsBlackoutWindowsJson: payload.challengeNewsBlackoutWindowsJson,
        challengeWeekendCutoffHours: payload.challengeWeekendCutoffHours,
        challengeForceCloseBeforeWeekend: payload.challengeForceCloseBeforeWeekend,
        challengeLeverageMultiplierDefault: payload.challengeLeverageMultiplierDefault,
        challengeMaxActiveEnrollmentsUser: payload.challengeMaxActiveEnrollmentsUser,
        challengeMaxActiveEnrollmentsPerChallenge: payload.challengeMaxActiveEnrollmentsPerChallenge,
        challengeCooldownHoursAfterFail: payload.challengeCooldownHoursAfterFail,
        challengeCooldownHoursAfterWithdraw: payload.challengeCooldownHoursAfterWithdraw,
        challengeCertificateDefaultTemplateId: payload.challengeCertificateDefaultTemplateId,
        challengeCertificateIncludeMetricsDefault: payload.challengeCertificateIncludeMetricsDefault,
        challengeCertificateIncludeQrDefault: payload.challengeCertificateIncludeQrDefault,
        challengeCertificateVerificationKeyId: payload.challengeCertificateVerificationKeyId,
        challengeAuditStrictMode: payload.challengeAuditStrictMode,
        challengeAnomalyDetectionEnabled: payload.challengeAnomalyDetectionEnabled,
        challengeManualReviewEnabled: payload.challengeManualReviewEnabled,
        challengeManualReviewSuspiciousThreshold: payload.challengeManualReviewSuspiciousThreshold,
        updatedAt: nowSec(),
        updatedBy: String(req.session?.email || "admin"),
      })
      .where(eq(systemConfig.id, 1));

    await appendRecruitmentAudit(req, "CHALLENGE_SETTINGS_UPDATE", { patchKeys: Object.keys(payload) });
    publishChallengesUpdated({ action: "settings-updated", patchKeys: Object.keys(payload) });
    const [updated] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    return res.json({ ok: true, settings: updated });
  } catch (error) {
    console.error("[admin-scout] challenge settings update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_CHALLENGE_SETTINGS" });
  }
});

adminChallengesRouter.post("/:id/duplicate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const [base] = await db.select().from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!base) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });

    const phases = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, id))
      .orderBy(asc(challengePhases.phaseNumber));

    const ts = nowSec();
    const fallbackSlug = `${String(base.slug || `challenge-${base.id}`)}-copy-${ts}`.toLowerCase();
    const [copy] = await db
      .insert(challenges)
      .values({
        ...(base as any),
        id: undefined,
        name: `${base.name} (Copy)`,
        slug: fallbackSlug.slice(0, 120),
        isActive: false,
        createdAt: ts,
        updatedAt: ts,
        createdBy: Number(req.session?.userId || 0) || null,
        updatedBy: String(req.session?.email || "admin"),
      } as any)
      .returning();

    if (phases.length > 0) {
      await db.insert(challengePhases).values(
        phases.map((p) => ({
          ...(p as any),
          id: undefined,
          challengeId: copy.id,
          createdAt: ts,
          updatedAt: ts,
        })),
      );
    }

    await appendRecruitmentAudit(req, "CHALLENGE_DUPLICATE", { sourceChallengeId: id, challengeId: copy.id });
    publishChallengesUpdated({ action: "duplicated", challengeId: copy.id, sourceChallengeId: id });
    return res.status(201).json({ ok: true, row: copy });
  } catch (error) {
    console.error("[admin-scout] challenge duplicate error:", error);
    return res.status(500).json({ message: "FAILED_TO_DUPLICATE_CHALLENGE" });
  }
});

adminChallengesRouter.put("/:id/archive", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;

    const [updated] = await db
      .update(challenges)
      .set({
        isActive: false,
        visibleToTraders: false,
        updatedAt: nowSec(),
        updatedBy: String(req.session?.email || "admin"),
      })
      .where(eq(challenges.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_ARCHIVE", { challengeId: id });
    publishChallengesUpdated({ action: "archived", challengeId: id });
    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] challenge archive error:", error);
    return res.status(500).json({ message: "FAILED_TO_ARCHIVE_CHALLENGE" });
  }
});

adminChallengesRouter.get("/:id/phases", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    if (!enforceAdminResourceScope(req, res, "challenge", id)) return;
    const [challengeRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.id, id)).limit(1);
    if (!challengeRow) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    const rows = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, id))
      .orderBy(asc(challengePhases.phaseNumber));
    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[admin-scout] challenge phases get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_PHASES" });
  }
});

adminChallengesRouter.post("/:id/phases", async (req, res) => {
  try {
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    if (!enforceAdminResourceScope(req, res, "challenge", challengeId)) return;
    const parsed = challengePhaseUpsertSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });

    const [challengeRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challengeRow) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });

    const data = parsed.data;
    const ts = nowSec();
    const existing = await db
      .select({ id: challengePhases.id })
      .from(challengePhases)
      .where(and(eq(challengePhases.challengeId, challengeId), eq(challengePhases.phaseNumber, data.phaseNumber)))
      .limit(1);

    if (existing.length > 0) {
      const [row] = await db
        .update(challengePhases)
        .set({
          phaseName: data.phaseName ?? `Phase ${data.phaseNumber}`,
          profitTargetPct: data.profitTargetPct,
          maxDailyLossPct: data.maxDailyLossPct,
          maxTotalLossPct: data.maxTotalLossPct ?? null,
          drawdownType: data.drawdownType ?? "STATIC",
          durationDays: data.durationDays,
          minTradingDays: data.minTradingDays ?? null,
          maxSingleDayProfitPct: data.maxSingleDayProfitPct ?? null,
          allowWeekendHolding: data.allowWeekendHolding ?? true,
          allowNewsTrading: data.allowNewsTrading ?? true,
          restrictedSymbolsCsv: data.restrictedSymbolsCsv ?? "",
          maxConcurrentPositions: data.maxConcurrentPositions ?? null,
          maxLotSize: data.maxLotSize ?? null,
          updatedAt: ts,
      })
      .where(eq(challengePhases.id, existing[0].id))
      .returning();
      await appendRecruitmentAudit(req, "CHALLENGE_PHASE_UPSERT", { challengeId, phaseNumber: data.phaseNumber, mode: "update" });
      publishChallengesUpdated({ action: "phase-updated", challengeId, phaseNumber: data.phaseNumber });
      return res.json({ ok: true, row });
    }

    const [row] = await db
      .insert(challengePhases)
      .values({
        challengeId,
        phaseNumber: data.phaseNumber,
        phaseName: data.phaseName ?? `Phase ${data.phaseNumber}`,
        profitTargetPct: data.profitTargetPct,
        maxDailyLossPct: data.maxDailyLossPct,
        maxTotalLossPct: data.maxTotalLossPct ?? null,
        drawdownType: data.drawdownType ?? "STATIC",
        durationDays: data.durationDays,
        minTradingDays: data.minTradingDays ?? null,
        maxSingleDayProfitPct: data.maxSingleDayProfitPct ?? null,
        allowWeekendHolding: data.allowWeekendHolding ?? true,
        allowNewsTrading: data.allowNewsTrading ?? true,
        restrictedSymbolsCsv: data.restrictedSymbolsCsv ?? "",
        maxConcurrentPositions: data.maxConcurrentPositions ?? null,
        maxLotSize: data.maxLotSize ?? null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning();

    await appendRecruitmentAudit(req, "CHALLENGE_PHASE_UPSERT", { challengeId, phaseNumber: data.phaseNumber, mode: "insert" });
    publishChallengesUpdated({ action: "phase-created", challengeId, phaseNumber: data.phaseNumber });
    return res.status(201).json({ ok: true, row });
  } catch (error) {
    console.error("[admin-scout] challenge phase upsert error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPSERT_CHALLENGE_PHASE" });
  }
});

adminChallengesRouter.delete("/:id/phases", async (req, res) => {
  try {
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "challenge", challengeId)) return;

    const [challengeRow] = await db.select({ id: challenges.id }).from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challengeRow) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });

    const deleted = await db.delete(challengePhases).where(eq(challengePhases.challengeId, challengeId)).returning({ id: challengePhases.id });

    await appendRecruitmentAudit(req, "CHALLENGE_PHASES_DELETE_ALL", { challengeId, deleted: deleted.length });
    publishChallengesUpdated({ action: "phases-cleared", challengeId, deleted: deleted.length });
    return res.json({ ok: true, deleted: deleted.length });
  } catch (error) {
    console.error("[admin-scout] challenge phases delete-all error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE_PHASES" });
  }
});

adminChallengesRouter.delete("/:id/phases/:phaseNumber", async (req, res) => {
  try {
    const challengeId = Number(req.params.id);
    const phaseNumber = Number(req.params.phaseNumber);
    if (!Number.isInteger(challengeId) || challengeId <= 0) return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    if (!Number.isInteger(phaseNumber) || phaseNumber <= 0) return res.status(400).json({ message: "INVALID_PHASE_NUMBER" });
    if (!enforceAdminResourceScope(req, res, "challenge", challengeId)) return;

    const [deleted] = await db
      .delete(challengePhases)
      .where(and(eq(challengePhases.challengeId, challengeId), eq(challengePhases.phaseNumber, phaseNumber)))
      .returning({ id: challengePhases.id });
    if (!deleted) return res.status(404).json({ message: "PHASE_NOT_FOUND" });
    await appendRecruitmentAudit(req, "CHALLENGE_PHASE_DELETE", { challengeId, phaseNumber });
    publishChallengesUpdated({ action: "phase-deleted", challengeId, phaseNumber });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge phase delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DELETE_CHALLENGE_PHASE" });
  }
});

adminChallengesRouter.get("/enrollments", async (req, res) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 100, 1000);
    const offset = parseOffset(req.query.offset);
    const challengeId = Number(req.query.challengeId ?? 0);
    const userId = Number(req.query.userId ?? 0);
    const status = safeString(req.query.status).trim().toUpperCase();
    const phase = Number(req.query.phase ?? 0);

    const clauses = [sql`1=1`];
    if (Number.isInteger(challengeId) && challengeId > 0) clauses.push(sql`e.challenge_id = ${challengeId}`);
    if (Number.isInteger(userId) && userId > 0) clauses.push(sql`e.user_id = ${userId}`);
    if (status) clauses.push(sql`e.status = ${status}`);
    if (Number.isInteger(phase) && phase > 0) clauses.push(sql`e.current_phase = ${phase}`);

    const rows = await db.execute(sql`
      SELECT
        e.*,
        c.name AS challenge_name,
        c.slug AS challenge_slug,
        u.email AS user_email,
        u.username AS user_username,
        COUNT(*) OVER()::int AS total_count
      FROM challenge_enrollments e
      INNER JOIN challenges c ON c.id = e.challenge_id
      INNER JOIN users u ON u.id = e.user_id
      WHERE ${sql.join(clauses, sql` AND `)}
      ORDER BY e.updated_at DESC, e.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const outRows = ((rows as any).rows ?? []).map((row: any) => ({
      ...row,
      admin_notes: decryptChallengeAdminNote(row.admin_notes),
    }));
    const total = outRows.length > 0 ? Number(outRows[0].total_count ?? 0) : 0;
    return res.json({
      ok: true,
      limit,
      offset,
      total,
      hasMore: offset + outRows.length < total,
      rows: outRows,
    });
  } catch (error) {
    console.error("[admin-scout] challenge enrollments list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ENROLLMENTS" });
  }
});

adminChallengesRouter.get("/enrollments/:id", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });

    const [row] = await db
      .select({
        enrollment: challengeEnrollments,
        challenge: challenges,
        user: users,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challenges.id, challengeEnrollments.challengeId))
      .innerJoin(users, eq(users.id, challengeEnrollments.userId))
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);

    if (!row) return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });

    const phases = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, row.challenge.id))
      .orderBy(asc(challengePhases.phaseNumber));
    const events = await db
      .select()
      .from(challengeEnrollmentEvents)
      .where(eq(challengeEnrollmentEvents.enrollmentId, enrollmentId))
      .orderBy(desc(challengeEnrollmentEvents.id))
      .limit(500);
    const tradeRows = await db
      .select({
        id: trades.id,
        symbolId: trades.symbolId,
        type: trades.type,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        status: trades.status,
        netProfitUsd: trades.netProfitUsd,
      })
      .from(trades)
      .where(
        and(
          eq(trades.userId, row.enrollment.userId),
          gte(trades.openedAt, Number(row.enrollment.enrolledAt ?? 0)),
          lte(trades.openedAt, Number(row.enrollment.completedAt ?? nowSec())),
        ),
      )
      .orderBy(desc(trades.openedAt))
      .limit(2000);

    return res.json({
      ok: true,
      enrollment: {
        ...row.enrollment,
        adminNotes: decryptChallengeAdminNote((row.enrollment as any).adminNotes),
      },
      challenge: row.challenge,
      user: {
        id: row.user.id,
        username: row.user.username,
        email: row.user.email,
      },
      phases,
      events,
      trades: tradeRows,
    });
  } catch (error) {
    console.error("[admin-scout] challenge enrollment detail error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.get("/enrollments/:id/events", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });

    const [exists] = await db
      .select({ id: challengeEnrollments.id })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);
    if (!exists) return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });

    const rows = await db
      .select()
      .from(challengeEnrollmentEvents)
      .where(eq(challengeEnrollmentEvents.enrollmentId, enrollmentId))
      .orderBy(desc(challengeEnrollmentEvents.id))
      .limit(2000);

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[admin-scout] challenge enrollment events error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_ENROLLMENT_EVENTS" });
  }
});

adminChallengesRouter.post("/enrollments/:id/notify", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_NOTIFY", 30)) return;
    const parsed = challengeEnrollmentNotifySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });

    const [row] = await db
      .select({
        enrollmentId: challengeEnrollments.id,
        userId: challengeEnrollments.userId,
        challengeId: challengeEnrollments.challengeId,
        challengeName: challenges.name,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challenges.id, challengeEnrollments.challengeId))
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);
    if (!row) return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });

    const sourceEvent = "CHALLENGE_ADMIN_MANUAL_NOTIFY";
    await createNotification({
      userId: Number(row.userId),
      type: "CHALLENGE",
      severity: parsed.data.severity ?? "INFO",
      title: parsed.data.title,
      message: parsed.data.message,
      sourceEvent,
      link: `/compete/enrollment/${enrollmentId}`,
    });

    if (parsed.data.sendMailbox) {
      const cfg = await getSystemChallengeConfig();
      if (cfg.challengeNotifyViaMailbox) {
        await createMailboxThreadWithMessage({
          createdByUserId: Number(req.session?.userId || 0) || null,
          senderUserId: null,
          recipientUserIds: [Number(row.userId)],
          subject: parsed.data.title,
          body: parsed.data.message,
          category: normalizeChallengeMailboxCategory(cfg.challengeMailboxCategory),
          allowReply: false,
          messageType: "CHALLENGE_ADMIN_ACTION",
          metadata: {
            sourceEvent,
            challengeId: Number(row.challengeId),
            enrollmentId,
            senderAdminId: Number(req.session?.userId || 0) || null,
          },
        });
      }
    }

    await appendChallengeEvent({
      enrollmentId,
      eventType: "ADMIN_MANUAL_NOTIFICATION",
      actorType: "ADMIN",
      actorUserId: Number(req.session?.userId || 0) || null,
      details: {
        title: parsed.data.title,
        severity: parsed.data.severity ?? "INFO",
        mailbox: Boolean(parsed.data.sendMailbox),
      },
      note: parsed.data.message,
    });

    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_NOTIFY", {
      enrollmentId,
      challengeId: Number(row.challengeId),
      userId: Number(row.userId),
      severity: parsed.data.severity ?? "INFO",
      mailbox: Boolean(parsed.data.sendMailbox),
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[admin-scout] challenge enrollment notify error:", error);
    return res.status(500).json({ message: "FAILED_TO_NOTIFY_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.put("/enrollments/:id/override", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_OVERRIDE")) return;
    const parsed = challengeEnrollmentOverrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });

    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action: "OVERRIDE",
      note: parsed.data.reason,
      actorUserId: Number(req.session?.userId || 0) || null,
      overrideStatus: parsed.data.status,
      overrideCompletedAt: parsed.data.completedAt,
      overrideCurrentPhase: parsed.data.currentPhase,
    });

    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_OVERRIDE", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
      status: parsed.data.status,
    });

    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: "Challenge status updated",
      message: `An admin set your ${challengeRow?.name ?? "challenge"} enrollment to ${parsed.data.status}.`,
      sourceEvent: "CHALLENGE_ADMIN_OVERRIDE",
      severity: "INFO",
      mailboxRecommended: true,
    });

    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    console.error("[admin-scout] challenge enrollment override error:", error);
    return res.status(500).json({ message: "FAILED_TO_OVERRIDE_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.put("/enrollments/:id/extend", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_EXTEND")) return;
    const parsed = challengeEnrollmentExtendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });

    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action: "EXTEND_PHASE",
      note: parsed.data.reason,
      extendDays: parsed.data.extendDays,
      actorUserId: Number(req.session?.userId || 0) || null,
    });

    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_EXTEND", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
      extendDays: parsed.data.extendDays,
    });

    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: "Challenge phase extended",
      message: `An admin extended your ${challengeRow?.name ?? "challenge"} phase by ${parsed.data.extendDays} day${parsed.data.extendDays === 1 ? "" : "s"}.`,
      sourceEvent: "CHALLENGE_ADMIN_EXTEND",
      severity: "INFO",
      mailboxRecommended: false,
    });

    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    console.error("[admin-scout] challenge enrollment extend error:", error);
    return res.status(500).json({ message: "FAILED_TO_EXTEND_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.put("/enrollments/:id/advance", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_ADVANCE")) return;
    const note = typeof req.body?.reason === "string" ? String(req.body.reason).slice(0, 4000) : null;
    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action: "ADVANCE_PHASE",
      note,
      actorUserId: Number(req.session?.userId || 0) || null,
    });

    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_ADVANCE", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
      phase: Number(result.updated.currentPhase ?? 1),
    });

    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: "Challenge phase advanced",
      message: `An admin advanced you to phase ${Number(result.updated.currentPhase ?? 1)} in ${challengeRow?.name ?? "your challenge"}.`,
      sourceEvent: "CHALLENGE_ADMIN_ADVANCE",
      severity: "INFO",
      mailboxRecommended: false,
    });

    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    console.error("[admin-scout] challenge enrollment advance error:", error);
    return res.status(500).json({ message: "FAILED_TO_ADVANCE_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.put("/enrollments/:id/reset", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_RESET")) return;
    const note = typeof req.body?.reason === "string" ? String(req.body.reason).slice(0, 4000) : null;
    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action: "RESET_PHASE",
      note,
      actorUserId: Number(req.session?.userId || 0) || null,
    });
    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_RESET", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
    });
    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: "Challenge reset",
      message: `An admin reset your ${challengeRow?.name ?? "challenge"} enrollment to phase 1.`,
      sourceEvent: "CHALLENGE_ADMIN_RESET",
      severity: "INFO",
      mailboxRecommended: false,
    });
    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    console.error("[admin-scout] challenge enrollment reset error:", error);
    return res.status(500).json({ message: "FAILED_TO_RESET_CHALLENGE_ENROLLMENT" });
  }
});

adminChallengesRouter.put("/enrollments/:id/disqualify", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    if (!enforceChallengeAdminActionRateLimit(req, res, "ENROLLMENT_DISQUALIFY")) return;
    const note = typeof req.body?.reason === "string" ? String(req.body.reason).slice(0, 4000) : null;
    const result = await applyChallengeEnrollmentAdminAction({
      enrollmentId,
      action: "DISQUALIFY",
      note,
      actorUserId: Number(req.session?.userId || 0) || null,
    });
    await appendRecruitmentAudit(req, "CHALLENGE_ENROLLMENT_DISQUALIFY", {
      enrollmentId,
      challengeId: result.enrollment.challengeId,
    });
    const [challengeRow] = await db
      .select({ name: challenges.name })
      .from(challenges)
      .where(eq(challenges.id, Number(result.enrollment.challengeId)))
      .limit(1);
    await notifyChallengeTrader({
      userId: Number(result.enrollment.userId),
      challengeId: Number(result.enrollment.challengeId),
      enrollmentId,
      title: "Challenge disqualified",
      message: `An admin disqualified your ${challengeRow?.name ?? "challenge"} enrollment.`,
      sourceEvent: "CHALLENGE_ADMIN_DISQUALIFY",
      severity: "WARNING",
      mailboxRecommended: true,
    });
    return res.json({ ok: true, row: result.updated });
  } catch (error: any) {
    if (String(error?.message || "") === "ENROLLMENT_NOT_FOUND") return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    console.error("[admin-scout] challenge enrollment disqualify error:", error);
    return res.status(500).json({ message: "FAILED_TO_DISQUALIFY_CHALLENGE_ENROLLMENT" });
  }
});

