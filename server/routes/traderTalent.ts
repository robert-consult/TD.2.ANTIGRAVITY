// @ts-nocheck
import { Router } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import {
  challengeBadgeAwards,
  challengeBadges,
  challengeCertificateTemplates,
  challengeCertificates,
  challengeEnrollmentEvents,
  challengeEnrollments,
  challengeLeaderboardSnapshot,
  challengePhases,
  challengePrizeAwards,
  challengeProgressionTiers,
  challengeUserProgression,
  challengeSelectionBoosts,
  challenges,
  recruitingPipeline,
  systemConfig,
  traderProfiles,
  userVerification,
  users,
  trades,
  symbolConfigs,
} from "@shared/schema";
import { requireAuth } from "../middleware/auth";
import { appendIdentityAudit } from "../services/identityAudit";
import { createMailboxThreadWithMessage, createNotification } from "../services/messaging";
import { appendChallengeEvent } from "../recruitment/challengesV4/challengeEvents";
import { getSystemChallengeConfig } from "../recruitment/challengesV4/challengeConfig";

const traderTalentPublicRouter = Router();
const traderTalentRouter = Router();
traderTalentRouter.use(requireAuth);

const profileUpdateSchema = z.object({
  bio: z.string().trim().max(4000).optional().nullable(),
  strategy: z.string().trim().max(4000).optional().nullable(),
  pinnedTradeIds: z.array(z.number().int().positive()).max(50).optional(),
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parsePinnedTradeIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50);
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, 50);
    } catch {
      return [];
    }
  }

  return [];
}

type ChallengeRateRecord = { count: number; resetAtMs: number };
const challengeRateLimitStore = new Map<string, ChallengeRateRecord>();

function consumeChallengeRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = challengeRateLimitStore.get(key);
  if (!entry || entry.resetAtMs <= now) {
    challengeRateLimitStore.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (entry.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAtMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  entry.count += 1;
  challengeRateLimitStore.set(key, entry);
  return { allowed: true, retryAfterSec: Math.max(1, Math.ceil((entry.resetAtMs - now) / 1000)) };
}

const challengeRateLimitCleanupHandle = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challengeRateLimitStore.entries()) {
    if (v.resetAtMs <= now) challengeRateLimitStore.delete(k);
  }
}, 60_000);
(challengeRateLimitCleanupHandle as any)?.unref?.();

async function getRecruitmentConfig() {
  const [cfg] = await db
    .select({
      traderProProfilesEnabled: systemConfig.traderProProfilesEnabled,
      traderCompeteEnabled: systemConfig.traderCompeteEnabled,
      traderCommunityEnabled: systemConfig.traderCommunityEnabled,
      leaderboardMode: systemConfig.leaderboardMode,
      // challenges v4
      challengeLeaderboardEnabled: systemConfig.challengeLeaderboardEnabled,
      challengeRewardsEnabled: systemConfig.challengeRewardsEnabled,
      challengePrizePoolsEnabled: systemConfig.challengePrizePoolsEnabled,
      challengeBadgesEnabled: systemConfig.challengeBadgesEnabled,
      challengeCertificatesEnabled: systemConfig.challengeCertificatesEnabled,
      challengeCertificatesDownloadable: systemConfig.challengeCertificatesDownloadable,
      challengeCertificatesShareable: systemConfig.challengeCertificatesShareable,
      challengeSelectionBoostEnabled: systemConfig.challengeSelectionBoostEnabled,
      challengeProgressionEnabled: systemConfig.challengeProgressionEnabled,
      challengeCustomRewardsEnabled: systemConfig.challengeCustomRewardsEnabled,
    })
    .from(systemConfig)
    .where(eq(systemConfig.id, 1))
    .limit(1);

  return {
    traderProProfilesEnabled: Boolean(cfg?.traderProProfilesEnabled ?? false),
    traderCompeteEnabled: Boolean(cfg?.traderCompeteEnabled ?? false),
    traderCommunityEnabled: Boolean(cfg?.traderCommunityEnabled ?? false),
    leaderboardMode: ["PUBLIC", "TOP_10", "DISABLED"].includes(String(cfg?.leaderboardMode || ""))
      ? String(cfg?.leaderboardMode)
      : "PUBLIC",

    // challenges v4
    challengeLeaderboardEnabled: Boolean(cfg?.challengeLeaderboardEnabled ?? true),
    challengeRewardsEnabled: Boolean(cfg?.challengeRewardsEnabled ?? true),
    challengePrizePoolsEnabled: Boolean(cfg?.challengePrizePoolsEnabled ?? true),
    challengeBadgesEnabled: Boolean(cfg?.challengeBadgesEnabled ?? true),
    challengeCertificatesEnabled: Boolean(cfg?.challengeCertificatesEnabled ?? true),
    challengeCertificatesDownloadable: Boolean(cfg?.challengeCertificatesDownloadable ?? true),
    challengeCertificatesShareable: Boolean(cfg?.challengeCertificatesShareable ?? true),
    challengeSelectionBoostEnabled: Boolean(cfg?.challengeSelectionBoostEnabled ?? true),
    challengeProgressionEnabled: Boolean(cfg?.challengeProgressionEnabled ?? true),
    challengeCustomRewardsEnabled: Boolean(cfg?.challengeCustomRewardsEnabled ?? true),
  };
}

function normalizeChallengeMailboxCategory(raw: unknown): "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT" | "CHALLENGES" {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "SYSTEM" || value === "SUPPORT" || value === "ANNOUNCEMENT" || value === "CHALLENGES") {
    return value;
  }
  return "SYSTEM";
}

async function sendChallengeMailboxMessage(input: {
  userId: number;
  challengeId: number;
  enrollmentId: number | null;
  sourceEvent: string;
  subject: string;
  body: string;
}) {
  try {
    const cfg = await getSystemChallengeConfig();
    if (!cfg.challengeNotifyViaMailbox) return;

    const category = normalizeChallengeMailboxCategory(cfg.challengeMailboxCategory);
    await createMailboxThreadWithMessage({
      createdByUserId: null,
      senderUserId: null,
      recipientUserIds: [input.userId],
      subject: input.subject,
      body: input.body,
      category,
      allowReply: false,
      messageType: "CHALLENGE_EVENT",
      metadata: {
        sourceEvent: input.sourceEvent,
        challengeId: input.challengeId,
        enrollmentId: input.enrollmentId,
      },
    });
  } catch (error) {
    console.error("[trader-talent] challenge mailbox dispatch failed:", error);
  }
}

traderTalentRouter.get("/leaderboard-mode", async (_req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    return res.json({ ok: true, ...cfg });
  } catch (error) {
    console.error("[trader-talent] leaderboard-mode error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_LEADERBOARD_MODE" });
  }
});

// ---------------------------
// Trader Pro profile
// ---------------------------

traderTalentRouter.get("/profile", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderProProfilesEnabled) {
      return res.status(403).json({ message: "TRADER_PROFILES_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const [profile] = await db.select().from(traderProfiles).where(eq(traderProfiles.userId, userId)).limit(1);

    const row =
      profile ??
      ({
        userId,
        bio: null,
        strategy: null,
        pinnedTradeIds: "[]",
        updatedAt: null,
      } as any);

    return res.json({
      ok: true,
      row: {
        userId,
        bio: row.bio ?? null,
        strategy: row.strategy ?? null,
        pinnedTradeIds: parsePinnedTradeIds(row.pinnedTradeIds),
        updatedAt: row.updatedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[trader-talent] profile get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PROFILE" });
  }
});

traderTalentRouter.put("/profile", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderProProfilesEnabled) {
      return res.status(403).json({ message: "TRADER_PROFILES_DISABLED" });
    }

    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const userId = Number(req.session?.userId || 0);
    const ts = nowSec();
    const pinnedTradeIds =
      parsed.data.pinnedTradeIds === undefined ? undefined : JSON.stringify(parsePinnedTradeIds(parsed.data.pinnedTradeIds));

    await db
      .insert(traderProfiles)
      .values({
        userId,
        bio: parsed.data.bio ?? null,
        strategy: parsed.data.strategy ?? null,
        pinnedTradeIds: pinnedTradeIds ?? "[]",
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: traderProfiles.userId,
        set: {
          bio: parsed.data.bio,
          strategy: parsed.data.strategy,
          pinnedTradeIds,
          updatedAt: ts,
        },
      });

    const [updated] = await db.select().from(traderProfiles).where(eq(traderProfiles.userId, userId)).limit(1);

    return res.json({
      ok: true,
      row: {
        userId,
        bio: updated?.bio ?? null,
        strategy: updated?.strategy ?? null,
        pinnedTradeIds: parsePinnedTradeIds(updated?.pinnedTradeIds),
        updatedAt: updated?.updatedAt ?? ts,
      },
    });
  } catch (error) {
    console.error("[trader-talent] profile update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PROFILE" });
  }
});

// ---------------------------
// Challenges v4 (Trader)
// ---------------------------

function isWithinWindow(now: number, startAt: number | null, endAt: number | null): boolean {
  if (startAt != null && now < startAt) return false;
  if (endAt != null && now > endAt) return false;
  return true;
}

function parseEligibilityGate(raw: unknown): { mode: string; json: Record<string, unknown> } {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { mode: "NONE", json: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { mode: "JSON", json: parsed as Record<string, unknown> };
      }
    } catch {
      // ignore; treat as enum-like gate mode
    }
    return { mode: trimmed.toUpperCase(), json: {} };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { mode: "JSON", json: raw as Record<string, unknown> };
  }
  return { mode: "NONE", json: {} };
}

async function checkEligibilityGate(args: {
  userId: number;
  gate: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const gate = parseEligibilityGate(args.gate ?? null);
  if (gate.mode === "NONE") return { ok: true };

  const [u] = await db
    .select({
      userTier: users.userTier,
      emailVerifiedAt: userVerification.emailVerifiedAt,
      smsVerifiedAt: userVerification.smsVerifiedAt,
      kycStatus: users.kycStatus,
      contenderTier: userVerification.contenderTier,
      pipelineStage: recruitingPipeline.stage,
    })
    .from(users)
    .leftJoin(userVerification, eq(userVerification.userId, users.id))
    .leftJoin(recruitingPipeline, eq(recruitingPipeline.userId, users.id))
    .where(eq(users.id, args.userId))
    .limit(1);

  if (!u) return { ok: false, reason: "USER_NOT_FOUND" };

  if (gate.mode === "EMAIL_VERIFIED") {
    if (!u.emailVerifiedAt) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
    return { ok: true };
  }

  if (gate.mode === "CONTENDER") {
    const tier = String(u.contenderTier ?? "NONE");
    if (tier === "NONE") return { ok: false, reason: "NOT_A_CONTENDER" };
    return { ok: true };
  }

  if (gate.mode === "ADMIN_APPROVED") {
    // Conservative default: accept traders already promoted to PERFORMER or explicitly tracked in pipeline.
    if (String(u.userTier || "").toUpperCase() === "PERFORMER") return { ok: true };
    if ((u.pipelineStage ?? null) != null) return { ok: true };
    return { ok: false, reason: "NOT_ADMIN_APPROVED" };
  }

  if (gate.mode === "JSON") {
    if (gate.json.requireEmailVerified && !u.emailVerifiedAt) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
    if (gate.json.requireSmsVerified && !u.smsVerifiedAt) return { ok: false, reason: "SMS_NOT_VERIFIED" };
    if (gate.json.requireKycApproved && String(u.kycStatus || "").toLowerCase() !== "approved") {
      return { ok: false, reason: "KYC_NOT_APPROVED" };
    }
    return { ok: true };
  }

  return { ok: false, reason: "UNKNOWN_GATE" };
}

traderTalentRouter.get("/challenges", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const browseRate = consumeChallengeRateLimit(`challenges-list:${userId}`, 60, 60_000);
    if (!browseRate.allowed) {
      res.setHeader("Retry-After", String(browseRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_LIST_RATE_LIMIT",
        retryAfterSec: browseRate.retryAfterSec,
      });
    }
    const ts = nowSec();

    // Latest enrollment per challenge for this user.
    const rows = await db.execute(sql`
      WITH latest_enroll AS (
        SELECT DISTINCT ON (e.challenge_id)
          e.*
        FROM challenge_enrollments e
        WHERE e.user_id = ${userId}
        ORDER BY e.challenge_id, e.attempt_number DESC, e.id DESC
      )
      SELECT
        c.*,
        le.id AS enrollment_id,
        le.status AS enrollment_status,
        le.enrolled_at,
        le.completed_at,
        le.attempt_number,
        le.current_phase,
        le.phase_started_at,
        le.current_pnl_pct,
        le.max_daily_loss_hit,
        le.max_total_loss_hit,
        le.trading_days
      FROM challenges c
      LEFT JOIN latest_enroll le ON le.challenge_id = c.id
      WHERE c.visible_to_traders = true
        AND (c.start_at IS NULL OR c.start_at <= ${ts})
        AND (c.end_at IS NULL OR c.end_at >= ${ts})
      ORDER BY COALESCE(c.featured_order, 999999) ASC, c.id DESC
    `);

    return res.json({ ok: true, now: ts, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[trader-talent] challenges list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGES" });
  }
});

traderTalentRouter.get("/challenges/my-enrollments", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);

    const rows = await db
      .select({
        id: challengeEnrollments.id,
        challengeId: challengeEnrollments.challengeId,
        status: challengeEnrollments.status,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
        attemptNumber: challengeEnrollments.attemptNumber,
        currentPhase: challengeEnrollments.currentPhase,
        phaseStartedAt: challengeEnrollments.phaseStartedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        tradingDays: challengeEnrollments.tradingDays,
        name: challenges.name,
        slug: challenges.slug,
        category: challenges.category,
        tier: challenges.tier,
        visibleToTraders: challenges.visibleToTraders,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challenges.id, challengeEnrollments.challengeId))
      .where(eq(challengeEnrollments.userId, userId))
      .orderBy(desc(challengeEnrollments.enrolledAt));

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[trader-talent] my-enrollments error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ENROLLMENTS" });
  }
});

traderTalentRouter.get("/challenges/my-badges", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }
    if (!cfg.challengeBadgesEnabled) {
      return res.json({ ok: true, rows: [] });
    }

    const userId = Number(req.session?.userId || 0);
    const rows = await db
      .select({
        id: challengeBadgeAwards.id,
        badgeId: challengeBadgeAwards.badgeId,
        challengeId: challengeBadgeAwards.challengeId,
        enrollmentId: challengeBadgeAwards.enrollmentId,
        awardedAt: challengeBadgeAwards.awardedAt,
        awardedReason: challengeBadgeAwards.awardedReason,
        key: challengeBadges.key,
        name: challengeBadges.name,
        description: challengeBadges.description,
        iconUrl: challengeBadges.iconUrl,
        iconEmoji: challengeBadges.iconEmoji,
        category: challengeBadges.category,
      })
      .from(challengeBadgeAwards)
      .innerJoin(challengeBadges, eq(challengeBadges.id, challengeBadgeAwards.badgeId))
      .where(eq(challengeBadgeAwards.userId, userId))
      .orderBy(desc(challengeBadgeAwards.awardedAt), desc(challengeBadgeAwards.id));

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[trader-talent] my-badges error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_BADGES" });
  }
});

traderTalentRouter.get("/challenges/my-progression", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }
    if (!cfg.challengeProgressionEnabled) {
      return res.json({ ok: true, progression: null, plan: null });
    }

    const userId = Number(req.session?.userId || 0);
    const [progression] = await db
      .select()
      .from(challengeUserProgression)
      .where(eq(challengeUserProgression.userId, userId))
      .limit(1);

    if (!progression) {
      return res.json({ ok: true, progression: null, plan: null });
    }

    const planId = Number(progression.progressionPlanId ?? 0);
    const [plan] =
      planId > 0
        ? await db
            .select({
              id: challengeProgressionTiers.id,
              name: challengeProgressionTiers.name,
              description: challengeProgressionTiers.description,
              tiersJson: challengeProgressionTiers.tiersJson,
              updatedAt: challengeProgressionTiers.updatedAt,
            })
            .from(challengeProgressionTiers)
            .where(eq(challengeProgressionTiers.id, planId))
            .limit(1)
        : [null];

    return res.json({ ok: true, progression, plan: plan ?? null });
  } catch (error) {
    console.error("[trader-talent] my-progression error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PROGRESSION" });
  }
});

traderTalentRouter.get("/challenges/my-certificates", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }
    if (!cfg.challengeCertificatesEnabled) {
      return res.json({ ok: true, rows: [] });
    }

    const userId = Number(req.session?.userId || 0);
    const rows = await db
      .select({
        id: challengeCertificates.id,
        challengeId: challengeCertificates.challengeId,
        enrollmentId: challengeCertificates.enrollmentId,
        templateId: challengeCertificates.templateId,
        issuedAt: challengeCertificates.issuedAt,
        isDownloadable: challengeCertificates.isDownloadable,
        isShareable: challengeCertificates.isShareable,
        verificationCodeHmac: challengeCertificates.verificationCodeHmac,
        downloadedAt: challengeCertificates.downloadedAt,
        challengeName: challenges.name,
        challengeSlug: challenges.slug,
        templateName: challengeCertificateTemplates.name,
      })
      .from(challengeCertificates)
      .innerJoin(challenges, eq(challenges.id, challengeCertificates.challengeId))
      .leftJoin(challengeCertificateTemplates, eq(challengeCertificateTemplates.id, challengeCertificates.templateId))
      .where(eq(challengeCertificates.userId, userId))
      .orderBy(desc(challengeCertificates.issuedAt), desc(challengeCertificates.id));

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("[trader-talent] my-certificates error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CERTIFICATES" });
  }
});

traderTalentRouter.get("/challenges/:id", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const detailRate = consumeChallengeRateLimit(`challenge-detail:${userId}`, 60, 60_000);
    if (!detailRate.allowed) {
      res.setHeader("Retry-After", String(detailRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_DETAIL_RATE_LIMIT",
        retryAfterSec: detailRate.retryAfterSec,
      });
    }
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [ch] = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!ch || !ch.visibleToTraders) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const phases = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, challengeId))
      .orderBy(challengePhases.phaseNumber);

    const [enrollment] = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber))
      .limit(1);

    return res.json({ ok: true, challenge: ch, phases, enrollment: enrollment ?? null });
  } catch (error) {
    console.error("[trader-talent] challenge detail error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE" });
  }
});

traderTalentRouter.get("/challenges/:id/status", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [challenge] = await db
      .select({ id: challenges.id, visibleToTraders: challenges.visibleToTraders })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);
    if (!challenge || !challenge.visibleToTraders) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const [enrollment] = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber), desc(challengeEnrollments.id))
      .limit(1);
    if (!enrollment) {
      return res.status(404).json({ message: "NOT_ENROLLED" });
    }

    const [phase] = await db
      .select()
      .from(challengePhases)
      .where(and(eq(challengePhases.challengeId, challengeId), eq(challengePhases.phaseNumber, enrollment.currentPhase)))
      .limit(1);

    return res.json({ ok: true, enrollment, phase: phase ?? null });
  } catch (error) {
    console.error("[trader-talent] challenge status error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CHALLENGE_STATUS" });
  }
});

traderTalentRouter.post("/challenges/:id/enroll", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const enrollRate = consumeChallengeRateLimit(`enroll:${userId}`, 5, 60_000);
    if (!enrollRate.allowed) {
      res.setHeader("Retry-After", String(enrollRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_ENROLL_RATE_LIMIT",
        retryAfterSec: enrollRate.retryAfterSec,
      });
    }

    const ts = nowSec();
    const [ch] = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!ch || !ch.isActive || !ch.visibleToTraders) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }
    const challengeCfg = await getSystemChallengeConfig();

    if (!isWithinWindow(ts, ch.enrollmentStartAt ?? null, ch.enrollmentEndAt ?? null)) {
      return res.status(403).json({ message: "ENROLLMENT_WINDOW_CLOSED" });
    }

    const gate = await checkEligibilityGate({ userId, gate: ch.eligibilityGate ?? null });
    if (!gate.ok) {
      return res.status(403).json({ message: "NOT_ELIGIBLE", reason: gate.reason ?? "UNKNOWN" });
    }

    const existing = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber))
      .limit(1);

    const latest = existing[0] ?? null;

    if (latest && latest.status === "ACTIVE") {
      return res.json({ ok: true, reused: true, enrollment: latest });
    }

    const maxEnrollments = Number(ch.maxEnrollments ?? 0);
    if (!latest && Number.isFinite(maxEnrollments) && maxEnrollments > 0) {
      const [totalEnrollmentsRow] = await db
        .select({ c: sql<number>`count(*)` })
        .from(challengeEnrollments)
        .where(eq(challengeEnrollments.challengeId, challengeId));
      const totalEnrollments = Number(totalEnrollmentsRow?.c ?? 0);
      if (totalEnrollments >= Math.trunc(maxEnrollments)) {
        return res.status(409).json({ message: "MAX_ENROLLMENTS_REACHED" });
      }
    }

    const maxActiveEnrollments = Number(ch.maxActiveEnrollments ?? 0);
    if (Number.isFinite(maxActiveEnrollments) && maxActiveEnrollments > 0) {
      const [activeEnrollmentsRow] = await db
        .select({ c: sql<number>`count(*)` })
        .from(challengeEnrollments)
        .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.status, "ACTIVE")));
      const activeEnrollments = Number(activeEnrollmentsRow?.c ?? 0);
      if (activeEnrollments >= Math.trunc(maxActiveEnrollments)) {
        return res.status(409).json({ message: "MAX_ACTIVE_ENROLLMENTS_REACHED" });
      }
    }

    // Retry logic
    const maxRetries = Math.max(0, Number(ch.maxRetriesPerTrader ?? 0));
    const cooldownHrs = Math.max(0, Number(ch.retryCooldownHours ?? 0));

    const nextAttempt = latest ? Number(latest.attemptNumber ?? 1) + 1 : 1;
    if (latest && nextAttempt > maxRetries + 1) {
      return res.status(403).json({ message: "MAX_RETRIES_EXCEEDED" });
    }

    if (latest && cooldownHrs > 0 && latest.completedAt != null) {
      const coolUntil = Number(latest.completedAt) + cooldownHrs * 3600;
      if (ts < coolUntil) {
        return res.status(403).json({ message: "RETRY_COOLDOWN", retryAt: coolUntil });
      }
    }

    const [u] = await db.select({ equity: users.equity, startingEquity: users.startingEquity }).from(users).where(eq(users.id, userId)).limit(1);
    const snapshotEquity = Number(u?.equity ?? u?.startingEquity ?? 1_000_000);

    const effectiveCapitalMode = String(ch.capitalMode || "").toUpperCase() === "VIRTUAL" ? "VIRTUAL" : "TRADER_EQUITY";
    const capitalBaseUsed = effectiveCapitalMode === "VIRTUAL" ? Number(ch.virtualCapitalUsd ?? snapshotEquity) : snapshotEquity;

    if (latest) {
      const [updated] = await db
        .update(challengeEnrollments)
        .set({
          status: "ACTIVE",
          enrolledAt: ts,
          completedAt: null,
          attemptNumber: nextAttempt,
          currentPhase: 1,
          phaseStartedAt: ts,
          currentPnlPct: 0,
          maxDailyLossHit: null,
          maxTotalLossHit: null,
          peakEquity: capitalBaseUsed,
          tradingDays: 0,
          lastWarningEvent: null,
          lastWarningAt: null,
          snapshotEquity,
          capitalBaseUsed,
          updatedAt: ts,
        })
        .where(eq(challengeEnrollments.id, latest.id))
        .returning();

      await appendChallengeEvent({
        enrollmentId: Number(updated.id),
        eventType: "CHALLENGE_ENROLLED",
        eventAt: ts,
        actorType: "TRADER",
        actorUserId: userId,
        phaseNumber: Number(updated.currentPhase ?? 1),
        details: {
          challengeId,
          attemptNumber: Number(updated.attemptNumber ?? 1),
          resumedEnrollmentId: Number(updated.id),
        },
      });

      appendIdentityAudit({
        userId,
        category: "RECRUITMENT",
        type: "CHALLENGE_ENROLLED",
        actorType: "USER",
        actorUserId: userId,
        sessionId: String(req.sessionID || ""),
        ip: String(req.ip || ""),
        userAgent: String(req.get("user-agent") || ""),
        data: {
          challengeId,
          enrollmentId: Number(updated.id),
          attemptNumber: Number(updated.attemptNumber ?? 1),
          resumed: true,
        },
      });

      if (challengeCfg.challengeNotifyOnEnroll) {
        await createNotification({
          userId,
          type: "CHALLENGE",
          severity: "INFO",
          title: "Challenge enrolled",
          message: `You are enrolled in ${ch.name}. Attempt #${Number(updated.attemptNumber ?? 1)} is now active.`,
          sourceEvent: "CHALLENGE_ENROLLED",
          link: `/compete/enrollment/${Number(updated.id)}`,
        });
        await sendChallengeMailboxMessage({
          userId,
          challengeId,
          enrollmentId: Number(updated.id),
          sourceEvent: "CHALLENGE_ENROLLED",
          subject: `Challenge enrolled: ${ch.name}`,
          body: `Attempt #${Number(updated.attemptNumber ?? 1)} is active for ${ch.name}.`,
        });
      }
      return res.json({ ok: true, reused: false, enrollment: updated });
    }

    const [created] = await db
      .insert(challengeEnrollments)
      .values({
        challengeId,
        userId,
        status: "ACTIVE",
        enrolledAt: ts,
        completedAt: null,
        attemptNumber: nextAttempt,
        currentPhase: 1,
        phaseStartedAt: ts,
        snapshotEquity,
        capitalBaseUsed,
        peakEquity: capitalBaseUsed,
        updatedAt: ts,
      })
      .returning();

    await appendChallengeEvent({
      enrollmentId: Number(created.id),
      eventType: "CHALLENGE_ENROLLED",
      eventAt: ts,
      actorType: "TRADER",
      actorUserId: userId,
      phaseNumber: 1,
      details: {
        challengeId,
        attemptNumber: Number(created.attemptNumber ?? 1),
        resumedEnrollmentId: null,
      },
    });

    appendIdentityAudit({
      userId,
      category: "RECRUITMENT",
      type: "CHALLENGE_ENROLLED",
      actorType: "USER",
      actorUserId: userId,
      sessionId: String(req.sessionID || ""),
      ip: String(req.ip || ""),
      userAgent: String(req.get("user-agent") || ""),
      data: {
        challengeId,
        enrollmentId: Number(created.id),
        attemptNumber: Number(created.attemptNumber ?? 1),
        resumed: false,
      },
    });

    if (challengeCfg.challengeNotifyOnEnroll) {
      await createNotification({
        userId,
        type: "CHALLENGE",
        severity: "INFO",
        title: "Challenge enrolled",
        message: `You are enrolled in ${ch.name}. Good luck.`,
        sourceEvent: "CHALLENGE_ENROLLED",
        link: `/compete/enrollment/${Number(created.id)}`,
      });
      await sendChallengeMailboxMessage({
        userId,
        challengeId,
        enrollmentId: Number(created.id),
        sourceEvent: "CHALLENGE_ENROLLED",
        subject: `Challenge enrolled: ${ch.name}`,
        body: `Attempt #${Number(created.attemptNumber ?? 1)} is active for ${ch.name}.`,
      });
    }

    return res.json({ ok: true, reused: false, enrollment: created });
  } catch (error) {
    console.error("[trader-talent] enroll error:", error);
    return res.status(500).json({ message: "FAILED_TO_ENROLL" });
  }
});

traderTalentRouter.post("/challenges/:id/withdraw", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const withdrawRate = consumeChallengeRateLimit(`withdraw:${userId}`, 3, 60_000);
    if (!withdrawRate.allowed) {
      res.setHeader("Retry-After", String(withdrawRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_WITHDRAW_RATE_LIMIT",
        retryAfterSec: withdrawRate.retryAfterSec,
      });
    }

    const [enrollment] = await db
      .select()
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber))
      .limit(1);

    if (!enrollment) return res.status(404).json({ message: "NOT_ENROLLED" });
    if (!(enrollment.status === "ENROLLED" || enrollment.status === "ACTIVE")) {
      return res.status(400).json({ message: "CANNOT_WITHDRAW_STATUS", status: enrollment.status });
    }

    const ts = nowSec();

    await db
      .update(challengeEnrollments)
      .set({
        status: "WITHDRAWN",
        completedAt: ts,
        updatedAt: ts,
      })
      .where(eq(challengeEnrollments.id, enrollment.id));

    await appendChallengeEvent({
      enrollmentId: Number(enrollment.id),
      eventType: "CHALLENGE_WITHDRAWN",
      eventAt: ts,
      actorType: "TRADER",
      actorUserId: userId,
      phaseNumber: Number(enrollment.currentPhase ?? 1),
      details: {
        challengeId,
        priorStatus: enrollment.status,
      },
    });

    appendIdentityAudit({
      userId,
      category: "RECRUITMENT",
      type: "CHALLENGE_WITHDRAWN",
      actorType: "USER",
      actorUserId: userId,
      sessionId: String(req.sessionID || ""),
      ip: String(req.ip || ""),
      userAgent: String(req.get("user-agent") || ""),
      data: {
        challengeId,
        enrollmentId: Number(enrollment.id),
        priorStatus: enrollment.status,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("[trader-talent] withdraw error:", error);
    return res.status(500).json({ message: "FAILED_TO_WITHDRAW" });
  }
});

traderTalentRouter.get("/challenges/:id/leaderboard", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    if (!cfg.challengeLeaderboardEnabled || cfg.leaderboardMode === "DISABLED") {
      return res.status(403).json({ message: "LEADERBOARD_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const leaderboardRate = consumeChallengeRateLimit(`leaderboard:${userId}`, 30, 60_000);
    if (!leaderboardRate.allowed) {
      res.setHeader("Retry-After", String(leaderboardRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_LEADERBOARD_RATE_LIMIT",
        retryAfterSec: leaderboardRate.retryAfterSec,
      });
    }
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [ch] = await db
      .select({
        id: challenges.id,
        name: challenges.name,
        leaderboardEnabled: challenges.leaderboardEnabled,
        leaderboardAnonymize: challenges.leaderboardAnonymize,
        leaderboardMaxVisible: challenges.leaderboardMaxVisible,
        visibleToTraders: challenges.visibleToTraders,
      })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!ch || !ch.visibleToTraders) return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    if (!ch.leaderboardEnabled) return res.status(403).json({ message: "CHALLENGE_LEADERBOARD_DISABLED" });

    const maxVisible = Math.max(1, Math.min(500, Number(ch.leaderboardMaxVisible ?? 100)));

    const rows = await db.execute(sql`
      SELECT
        s.rank,
        s.pnl_pct,
        s.user_id,
        u.username
      FROM challenge_leaderboard_snapshot s
      JOIN users u ON u.id = s.user_id
      WHERE s.challenge_id = ${challengeId}
      ORDER BY s.rank ASC
      LIMIT ${cfg.leaderboardMode === 'TOP_10' ? 10 : maxVisible}
    `);

    const out = ((rows as any).rows ?? []).map((r: any) => {
      const id = Number(r.user_id);
      const uname = String(r.username ?? "");
      const displayName = ch.leaderboardAnonymize && id !== userId ? `Trader #${id}` : uname || `Trader #${id}`;
      return {
        rank: Number(r.rank),
        pnlPct: Number(r.pnl_pct),
        userId: id,
        displayName,
        isYou: id === userId,
      };
    });

    return res.json({ ok: true, challengeId, rows: out });
  } catch (error) {
    console.error("[trader-talent] leaderboard error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_LEADERBOARD" });
  }
});

traderTalentRouter.get("/challenges/enrollment/:id", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const enrollmentId = Number(req.params.id || 0);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    }

    const [row] = await db
      .select({
        enrollment: challengeEnrollments,
        challenge: challenges,
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challenges.id, challengeEnrollments.challengeId))
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);

    if (!row || row.enrollment.userId !== userId) {
      return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    }

    const phases = await db
      .select()
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, row.challenge.id))
      .orderBy(asc(challengePhases.phaseNumber));

    const currentPhase = Number(row.enrollment.currentPhase ?? 1);
    const phase = phases.find((p) => Number(p.phaseNumber) === currentPhase) ?? null;

    return res.json({
      ok: true,
      enrollment: row.enrollment,
      challenge: row.challenge,
      phase,
      phases,
    });
  } catch (error) {
    console.error("[trader-talent] enrollment detail error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ENROLLMENT" });
  }
});

traderTalentRouter.get("/challenges/enrollment/:id/events", async (req, res) => {
  try {
    const userId = Number(req.session?.userId || 0);
    const enrollmentId = Number(req.params.id || 0);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    }

    const [en] = await db
      .select({ id: challengeEnrollments.id, userId: challengeEnrollments.userId })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);

    if (!en || en.userId !== userId) return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });

    const events = await db
      .select({
        id: challengeEnrollmentEvents.id,
        eventAt: challengeEnrollmentEvents.eventAt,
        eventType: challengeEnrollmentEvents.eventType,
        actorType: challengeEnrollmentEvents.actorType,
        actorUserId: challengeEnrollmentEvents.actorUserId,
        phaseNumber: challengeEnrollmentEvents.phaseNumber,
        detailsJson: challengeEnrollmentEvents.detailsJson,
        note: challengeEnrollmentEvents.note,
        eventHash: challengeEnrollmentEvents.eventHash,
        prevHash: challengeEnrollmentEvents.prevHash,
      })
      .from(challengeEnrollmentEvents)
      .where(eq(challengeEnrollmentEvents.enrollmentId, enrollmentId))
      .orderBy(desc(challengeEnrollmentEvents.id));

    return res.json({ ok: true, events });
  } catch (error) {
    console.error("[trader-talent] enrollment events error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ENROLLMENT_EVENTS" });
  }
});

traderTalentRouter.get("/challenges/enrollment/:id/trades", async (req, res) => {
  try {
    const userId = Number(req.session?.userId || 0);
    const enrollmentId = Number(req.params.id || 0);
    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({ message: "INVALID_ENROLLMENT_ID" });
    }

    const [en] = await db
      .select({
        id: challengeEnrollments.id,
        userId: challengeEnrollments.userId,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
      })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);

    if (!en || en.userId !== userId) return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });

    const startAt = Number(en.enrolledAt ?? 0);
    const endAt = Number(en.completedAt ?? nowSec());

    const limit = Math.max(1, Math.min(2000, Number(req.query.limit ?? 200)));

    const rows = await db
      .select({
        id: trades.id,
        symbol: symbolConfigs.symbol,
        type: trades.type,
        size: trades.size,
        lots: trades.lots,
        openPrice: trades.openPrice,
        closePrice: trades.closePrice,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        status: trades.status,
        netProfitUsd: trades.netProfitUsd,
        totalCostsUsd: trades.totalCostsUsd,
      })
      .from(trades)
      .innerJoin(symbolConfigs, eq(symbolConfigs.id, trades.symbolId))
      .where(and(eq(trades.userId, userId), sql`${trades.openedAt} >= ${startAt}`, sql`${trades.openedAt} <= ${endAt}`))
      .orderBy(desc(trades.openedAt))
      .limit(limit);

    return res.json({ ok: true, startAt, endAt, trades: rows });
  } catch (error) {
    console.error("[trader-talent] enrollment trades error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ENROLLMENT_TRADES" });
  }
});

traderTalentRouter.get("/challenges/:id/my-rewards", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) {
      return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    }

    const userId = Number(req.session?.userId || 0);
    const challengeId = Number(req.params.id || 0);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ message: "INVALID_CHALLENGE_ID" });
    }

    const [en] = await db
      .select({ id: challengeEnrollments.id })
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber))
      .limit(1);

    const enrollmentId = en?.id ?? null;

    const badgeRows = cfg.challengeBadgesEnabled
      ? await db
          .select({
            id: challengeBadgeAwards.id,
            badgeId: challengeBadgeAwards.badgeId,
            awardedAt: challengeBadgeAwards.awardedAt,
            awardedReason: challengeBadgeAwards.awardedReason,
            key: challengeBadges.key,
            name: challengeBadges.name,
            iconUrl: challengeBadges.iconUrl,
            iconEmoji: challengeBadges.iconEmoji,
            category: challengeBadges.category,
          })
          .from(challengeBadgeAwards)
          .innerJoin(challengeBadges, eq(challengeBadges.id, challengeBadgeAwards.badgeId))
          .where(and(eq(challengeBadgeAwards.userId, userId), eq(challengeBadgeAwards.challengeId, challengeId)))
          .orderBy(desc(challengeBadgeAwards.awardedAt))
      : [];

    const [cert] = cfg.challengeCertificatesEnabled
      ? await db
          .select({
            id: challengeCertificates.id,
            challengeId: challengeCertificates.challengeId,
            enrollmentId: challengeCertificates.enrollmentId,
            templateId: challengeCertificates.templateId,
            issuedAt: challengeCertificates.issuedAt,
            isDownloadable: challengeCertificates.isDownloadable,
            isShareable: challengeCertificates.isShareable,
            shareTokenHash: challengeCertificates.shareTokenHash,
            verificationCodeHmac: challengeCertificates.verificationCodeHmac,
            metricsJson: challengeCertificates.metricsJson,
          })
          .from(challengeCertificates)
          .where(and(eq(challengeCertificates.userId, userId), eq(challengeCertificates.challengeId, challengeId)))
          .orderBy(desc(challengeCertificates.issuedAt))
          .limit(1)
      : [];

    const boosts = cfg.challengeSelectionBoostEnabled
      ? await db
          .select({
            id: challengeSelectionBoosts.id,
            points: challengeSelectionBoosts.points,
            reason: challengeSelectionBoosts.reason,
            awardedAt: challengeSelectionBoosts.awardedAt,
          })
          .from(challengeSelectionBoosts)
          .where(and(eq(challengeSelectionBoosts.userId, userId), eq(challengeSelectionBoosts.challengeId, challengeId)))
          .orderBy(desc(challengeSelectionBoosts.awardedAt))
      : [];

    const prizes = cfg.challengePrizePoolsEnabled
      ? await db
          .select({
            id: challengePrizeAwards.id,
            rank: challengePrizeAwards.rank,
            prizeAmountUsd: challengePrizeAwards.prizeAmountUsd,
            status: challengePrizeAwards.status,
            approvedAt: challengePrizeAwards.approvedAt,
            note: challengePrizeAwards.note,
            createdAt: challengePrizeAwards.createdAt,
          })
          .from(challengePrizeAwards)
          .where(and(eq(challengePrizeAwards.userId, userId), eq(challengePrizeAwards.challengeId, challengeId)))
          .orderBy(desc(challengePrizeAwards.createdAt))
      : [];

    return res.json({
      ok: true,
      enrollmentId,
      badges: badgeRows,
      certificate: cert ?? null,
      boosts,
      prizes,
    });
  } catch (error) {
    console.error("[trader-talent] my-rewards error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_REWARDS" });
  }
});

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimplePdf(lines: string[]): Buffer {
  const safeLines = lines
    .map((line) => String(line ?? "").replace(/\r?\n/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, 42);

  const streamParts: string[] = ["BT", "/F1 12 Tf", "50 770 Td"];
  for (let i = 0; i < safeLines.length; i += 1) {
    const text = escapePdfText(safeLines[i].slice(0, 160));
    if (i > 0) streamParts.push("0 -16 Td");
    streamParts.push(`(${text}) Tj`);
  }
  streamParts.push("ET");
  const contentStream = streamParts.join("\n");

  const objects = [
    "",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

const certificateIdSchema = z.object({ id: z.coerce.number().int().positive() });

async function getOwnedCertificateBundle(userId: number, certificateId: number) {
  const [cert] = await db
    .select({
      id: challengeCertificates.id,
      userId: challengeCertificates.userId,
      challengeId: challengeCertificates.challengeId,
      enrollmentId: challengeCertificates.enrollmentId,
      templateId: challengeCertificates.templateId,
      issuedAt: challengeCertificates.issuedAt,
      isDownloadable: challengeCertificates.isDownloadable,
      isShareable: challengeCertificates.isShareable,
      shareTokenHash: challengeCertificates.shareTokenHash,
      verificationCodeHmac: challengeCertificates.verificationCodeHmac,
      metricsJson: challengeCertificates.metricsJson,
      downloadedAt: challengeCertificates.downloadedAt,
    })
    .from(challengeCertificates)
    .where(eq(challengeCertificates.id, certificateId))
    .limit(1);

  if (!cert || cert.userId !== userId) return null;

  const [tmpl] = await db
    .select({
      id: challengeCertificateTemplates.id,
      name: challengeCertificateTemplates.name,
      headerText: challengeCertificateTemplates.headerText,
      bodyText: challengeCertificateTemplates.bodyText,
      includeMetrics: challengeCertificateTemplates.includeMetrics,
      includeVerificationCode: challengeCertificateTemplates.includeVerificationCode,
      brandColor: challengeCertificateTemplates.brandColor,
      logoUrl: challengeCertificateTemplates.logoUrl,
    })
    .from(challengeCertificateTemplates)
    .where(eq(challengeCertificateTemplates.id, cert.templateId))
    .limit(1);

  const [challenge] = await db
    .select({
      id: challenges.id,
      name: challenges.name,
      slug: challenges.slug,
    })
    .from(challenges)
    .where(eq(challenges.id, cert.challengeId))
    .limit(1);

  return { cert, tmpl: tmpl ?? null, challenge: challenge ?? null };
}

async function handleCertificateDetail(req: any, res: any) {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });

    const userId = Number(req.session?.userId || 0);
    const parsed = certificateIdSchema.safeParse({ id: req.params.id });
    if (!parsed.success) return res.status(400).json({ message: "INVALID_CERTIFICATE_ID" });

    const bundle = await getOwnedCertificateBundle(userId, parsed.data.id);
    if (!bundle) return res.status(404).json({ message: "CERTIFICATE_NOT_FOUND" });

    return res.json({ ok: true, certificate: bundle.cert, template: bundle.tmpl, challenge: bundle.challenge });
  } catch (error) {
    console.error("[trader-talent] certificate get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_CERTIFICATE" });
  }
}

traderTalentRouter.get("/challenges/certificates/:id", handleCertificateDetail);
traderTalentRouter.get("/challenges/certificate/:id", handleCertificateDetail);

traderTalentRouter.get("/challenges/certificate/:id/download", async (req, res) => {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.traderCompeteEnabled) return res.status(403).json({ message: "TRADER_COMPETE_DISABLED" });
    if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });
    if (!cfg.challengeCertificatesDownloadable) return res.status(403).json({ message: "CERTIFICATE_DOWNLOAD_DISABLED" });

    const userId = Number(req.session?.userId || 0);
    const parsed = certificateIdSchema.safeParse({ id: req.params.id });
    if (!parsed.success) return res.status(400).json({ message: "INVALID_CERTIFICATE_ID" });

    const bundle = await getOwnedCertificateBundle(userId, parsed.data.id);
    if (!bundle) return res.status(404).json({ message: "CERTIFICATE_NOT_FOUND" });
    if (!bundle.cert.isDownloadable) return res.status(403).json({ message: "CERTIFICATE_NOT_DOWNLOADABLE" });

    const ts = nowSec();
    await db
      .update(challengeCertificates)
      .set({ downloadedAt: ts })
      .where(eq(challengeCertificates.id, bundle.cert.id));

    let metricsPretty = "{}";
    let parsedMetrics: Record<string, unknown> = {};
    try {
      parsedMetrics = JSON.parse(String(bundle.cert.metricsJson || "{}")) as Record<string, unknown>;
      metricsPretty = JSON.stringify(parsedMetrics);
    } catch {
      metricsPretty = String(bundle.cert.metricsJson || "{}");
    }

    const issuedIso = new Date(Number(bundle.cert.issuedAt || 0) * 1000).toISOString();
    const bodyText = String(bundle.tmpl?.bodyText ?? "")
      .replaceAll("{{challenge_name}}", String(bundle.challenge?.name ?? "Challenge"))
      .replaceAll("{{completion_date}}", issuedIso.split("T")[0] || issuedIso)
      .replaceAll("{{certificate_id}}", String(bundle.cert.id))
      .replaceAll("{{verification_code}}", String(bundle.cert.verificationCodeHmac ?? ""));

    const lines = [
      "TradeQuip Challenge Certificate",
      String(bundle.tmpl?.headerText || "").trim() || "Completion Certificate",
      `Challenge: ${bundle.challenge?.name ?? "Unknown Challenge"}`,
      `Certificate ID: ${bundle.cert.id}`,
      `Issued: ${issuedIso}`,
      bodyText || "This certifies successful completion of the challenge assessment.",
      bundle.tmpl?.includeVerificationCode !== false
        ? `Verification Code: ${bundle.cert.verificationCodeHmac}`
        : "",
      bundle.tmpl?.includeMetrics !== false
        ? `Metrics: pnlPct=${String(parsedMetrics.pnlPct ?? "-")} tradingDays=${String(parsedMetrics.tradingDays ?? "-")} maxDD=${String(parsedMetrics.maxTotalLossHit ?? "-")}`
        : "",
      bundle.tmpl?.includeMetrics !== false ? `Metrics Json: ${metricsPretty}` : "",
      `Template: ${bundle.tmpl?.name ?? "Default"}`,
    ].filter(Boolean);

    const pdf = buildSimplePdf(lines);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"challenge-certificate-${bundle.cert.id}.pdf\"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    return res.status(200).send(pdf);
  } catch (error) {
    console.error("[trader-talent] certificate download error:", error);
    return res.status(500).json({ message: "FAILED_TO_DOWNLOAD_CERTIFICATE" });
  }
});

async function handleCertificateVerify(req: any, res: any) {
  try {
    const cfg = await getRecruitmentConfig();
    if (!cfg.challengeCertificatesEnabled) return res.status(403).json({ message: "CERTIFICATES_DISABLED" });
    if (!cfg.challengeCertificatesShareable) return res.status(403).json({ message: "CERTIFICATE_SHARE_DISABLED" });

    const rate = consumeChallengeRateLimit(`challenge-cert-verify:${req.ip}`, 60, 60_000);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_CERT_VERIFY_RATE_LIMIT",
        retryAfterSec: rate.retryAfterSec,
      });
    }

    const code = String(req.params.code || req.params.verificationCode || "").trim();
    if (!code || code.length < 16) return res.status(400).json({ message: "INVALID_CODE" });

    const [cert] = await db
      .select({
        id: challengeCertificates.id,
        userId: challengeCertificates.userId,
        challengeId: challengeCertificates.challengeId,
        enrollmentId: challengeCertificates.enrollmentId,
        templateId: challengeCertificates.templateId,
        issuedAt: challengeCertificates.issuedAt,
        isShareable: challengeCertificates.isShareable,
        verificationCodeHmac: challengeCertificates.verificationCodeHmac,
        metricsJson: challengeCertificates.metricsJson,
      })
      .from(challengeCertificates)
      .where(eq(challengeCertificates.verificationCodeHmac, code))
      .limit(1);

    if (!cert) return res.status(404).json({ message: "NOT_FOUND" });
    if (!cert.isShareable) return res.status(404).json({ message: "NOT_FOUND" });

    const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, cert.userId)).limit(1);
    const [ch] = await db.select({ name: challenges.name }).from(challenges).where(eq(challenges.id, cert.challengeId)).limit(1);

    return res.json({
      ok: true,
      certificate: {
        id: cert.id,
        issuedAt: cert.issuedAt,
        challengeId: cert.challengeId,
        challengeName: ch?.name ?? null,
        userId: cert.userId,
        username: u?.username ?? null,
        metricsJson: cert.metricsJson,
      },
    });
  } catch (error) {
    console.error("[trader-talent] certificate verify error:", error);
    return res.status(500).json({ message: "FAILED_TO_VERIFY_CERT" });
  }
}

traderTalentPublicRouter.get("/challenges/certificates/verify/:code", handleCertificateVerify);
traderTalentPublicRouter.get("/challenges/certificate/:verificationCode/verify", handleCertificateVerify);

export { traderTalentRouter, traderTalentPublicRouter };
