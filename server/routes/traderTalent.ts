import { Router } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@db";
import { nowSec } from "@shared/scalars";
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
  challengeRewardLedger,
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
import { deriveCertificatePublicCode } from "../recruitment/challengesV4/certificateCode";
import { parseCustomRewardRules, scopedCustomRewardKey } from "../recruitment/challengesV4/customRewards";
import { registerTraderTalentCertificateRoutes } from "./trader-talent/certificates";

const traderTalentPublicRouter = Router();
const traderTalentRouter = Router();
traderTalentRouter.use(requireAuth);

const profileUpdateSchema = z.object({
  bio: z.string().trim().max(4000).optional().nullable(),
  strategy: z.string().trim().max(4000).optional().nullable(),
  pinnedTradeIds: z.array(z.number().int().positive()).max(50).optional(),
});

function toTraderCertificateRow(cert: Record<string, unknown>) {
  const verificationCode = deriveCertificatePublicCode({
    verificationCodeNonce: cert.verificationCodeNonce as string | null | undefined,
    verificationHmacKeyId: cert.verificationHmacKeyId as string | null | undefined,
    verificationCodeHmac: String(cert.verificationCodeHmac ?? ""),
  });
  const safe = { ...cert, verificationCode } as Record<string, unknown>;
  delete safe.verificationCodeHmac;
  delete safe.verificationCodeNonce;
  delete safe.verificationHmacKeyId;
  return safe;
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

function getChallengeLeaderboardPepper(): string {
  const configured = String(process.env.CHALLENGE_LEADERBOARD_ANON_PEPPER || "").trim();
  if (configured.length >= 16) return configured;
  const legal = String(process.env.LEGAL_TERMS_HMAC_SECRET || "").trim();
  if (legal.length >= 16) return legal;
  const session = String(process.env.SESSION_SECRET || "").trim();
  if (session.length >= 16) return session;
  return "tradequip-challenge-anon-dev-pepper";
}

function buildChallengeAnonId(challengeId: number, userId: number): string {
  const input = `${challengeId}:${userId}`;
  return crypto.createHmac("sha256", getChallengeLeaderboardPepper()).update(input, "utf8").digest("hex").slice(0, 8);
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

async function resolveBadgeForCustomReward(ref: unknown): Promise<{ id: number; name: string } | null> {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;

  const id = Number(raw);
  if (Number.isInteger(id) && id > 0) {
    const [row] = await db.select({ id: challengeBadges.id, name: challengeBadges.name }).from(challengeBadges).where(eq(challengeBadges.id, id)).limit(1);
    if (row) return row;
  }

  const [byKey] = await db.select({ id: challengeBadges.id, name: challengeBadges.name }).from(challengeBadges).where(eq(challengeBadges.key, raw)).limit(1);
  if (byKey) return byKey;

  const [byName] = await db.select({ id: challengeBadges.id, name: challengeBadges.name }).from(challengeBadges).where(eq(challengeBadges.name, raw)).limit(1);
  return byName ?? null;
}

async function applyEnrollCustomRewards(args: {
  req: any;
  cfg: Awaited<ReturnType<typeof getRecruitmentConfig>>;
  challenge: any;
  enrollment: any;
  userId: number;
  now: number;
}) {
  if (!args.cfg.challengeCustomRewardsEnabled) return;

  const rules = parseCustomRewardRules(args.challenge.customRewardJson).filter((rule) => rule.trigger === "ON_ENROLL");
  for (const rule of rules) {
    const rewardKey = scopedCustomRewardKey({
      rewardKey: rule.rewardKey,
      trigger: rule.trigger,
      phaseNumber: Number(args.enrollment.currentPhase ?? 1),
    });

    const claimed = await db
      .insert(challengeRewardLedger)
      .values({
        enrollmentId: Number(args.enrollment.id),
        challengeId: Number(args.challenge.id),
        userId: args.userId,
        trigger: rule.trigger,
        rewardKey,
        actionType: rule.actionType,
        runId: `enroll-${args.now}`,
        detailsJson: JSON.stringify({
          trigger: rule.trigger,
          actionType: rule.actionType,
          rewardKey,
          phaseNumber: Number(args.enrollment.currentPhase ?? 1),
        }),
        createdAt: args.now,
      })
      .onConflictDoNothing()
      .returning({ id: challengeRewardLedger.id });
    if (!claimed.length) continue;

    let applied = false;
    try {
      if (rule.actionType === "BADGE_AWARD") {
        const badgeRef = rule.payload.badgeRef ?? rule.payload.badgeId ?? rule.payload.badgeKey;
        const badge = await resolveBadgeForCustomReward(badgeRef);
        if (badge) {
          const inserted = await db
            .insert(challengeBadgeAwards)
            .values({
              userId: args.userId,
              badgeId: Number(badge.id),
              challengeId: Number(args.challenge.id),
              enrollmentId: Number(args.enrollment.id),
              awardedAt: args.now,
              awardedReason: String(rule.payload.reason ?? "CUSTOM_REWARD_ON_ENROLL"),
            })
            .onConflictDoNothing()
            .returning({ id: challengeBadgeAwards.id });
          applied = inserted.length > 0;
        }
      } else if (rule.actionType === "SELECTION_BOOST") {
        const points = Number(rule.payload.points ?? 0);
        if (Number.isFinite(points) && points > 0) {
          const inserted = await db
            .insert(challengeSelectionBoosts)
            .values({
              challengeId: Number(args.challenge.id),
              enrollmentId: Number(args.enrollment.id),
              userId: args.userId,
              points,
              reason: String(rule.payload.reason ?? "CUSTOM_REWARD_ON_ENROLL"),
              awardedAt: args.now,
              createdBy: Number(args.challenge.createdBy ?? 0) > 0 ? Number(args.challenge.createdBy) : null,
              createdAt: args.now,
            })
            .onConflictDoNothing()
            .returning({ id: challengeSelectionBoosts.id });
          applied = inserted.length > 0;
        }
      } else if (rule.actionType === "INBOX_MESSAGE") {
        const subject = String(rule.payload.subject ?? "").trim();
        const body = String(rule.payload.body ?? "").trim();
        if (subject && body) {
          await createMailboxThreadWithMessage({
            createdByUserId: null,
            senderUserId: null,
            recipientUserIds: [args.userId],
            subject,
            body,
            category: normalizeChallengeMailboxCategory(rule.payload.category),
            allowReply: false,
            messageType: "CHALLENGE_EVENT",
            metadata: {
              sourceEvent: "CHALLENGE_CUSTOM_REWARD",
              challengeId: Number(args.challenge.id),
              enrollmentId: Number(args.enrollment.id),
              trigger: rule.trigger,
              rewardKey,
            },
          });
          applied = true;
        }
      } else if (rule.actionType === "NOTIFY") {
        const title = String(rule.payload.title ?? "").trim();
        const message = String(rule.payload.message ?? "").trim();
        if (title && message) {
          const severityRaw = String(rule.payload.severity ?? "INFO").trim().toUpperCase();
          const severity = severityRaw === "SUCCESS" || severityRaw === "WARNING" || severityRaw === "CRITICAL" ? severityRaw : "INFO";
          await createNotification({
            userId: args.userId,
            type: "CHALLENGE",
            severity: severity as any,
            title,
            message,
            sourceEvent: String(rule.payload.sourceEvent ?? "CHALLENGE_CUSTOM_REWARD"),
            link: String(rule.payload.link ?? "").trim() || undefined,
          });
          applied = true;
        }
      }
    } catch (error) {
      console.error("[trader-talent] custom reward execution error:", {
        challengeId: args.challenge.id,
        enrollmentId: args.enrollment.id,
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        error,
      });
    }

    await appendChallengeEvent({
      enrollmentId: Number(args.enrollment.id),
      eventType: "CHALLENGE_CUSTOM_REWARD_EXECUTED",
      eventAt: args.now,
      actorType: "SYSTEM",
      actorUserId: null,
      phaseNumber: Number(args.enrollment.currentPhase ?? 1),
      details: {
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        applied,
      },
      note: "Custom reward processed",
    });

    appendIdentityAudit({
      userId: args.userId,
      category: "RECRUITMENT",
      type: "CHALLENGE_CUSTOM_REWARD_EXECUTED",
      actorType: "SYSTEM",
      actorUserId: null,
      sessionId: String(args.req.sessionID || ""),
      ip: String(args.req.ip || ""),
      userAgent: String(args.req.get("user-agent") || ""),
      data: {
        challengeId: Number(args.challenge.id),
        enrollmentId: Number(args.enrollment.id),
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        applied,
      },
    });
  }
}

function emitChallengeSuspiciousActivity(input: {
  req: any;
  userId: number;
  challengeId?: number | null;
  enrollmentId?: number | null;
  reason: string;
  details?: Record<string, unknown>;
}) {
  const details = {
    reason: input.reason,
    challengeId: input.challengeId ?? null,
    enrollmentId: input.enrollmentId ?? null,
    ...(input.details ?? {}),
  };

  appendIdentityAudit({
    userId: input.userId,
    category: "RECRUITMENT",
    type: "CHALLENGE_SUSPICIOUS_ACTIVITY",
    actorType: "USER",
    actorUserId: input.userId,
    sessionId: String(input.req.sessionID || ""),
    ip: String(input.req.ip || ""),
    userAgent: String(input.req.get("user-agent") || ""),
    data: details,
  });

  if (Number.isInteger(input.enrollmentId) && Number(input.enrollmentId) > 0) {
    void appendChallengeEvent({
      enrollmentId: Number(input.enrollmentId),
      eventType: "CHALLENGE_SUSPICIOUS_ACTIVITY",
      eventAt: nowSec(),
      actorType: "TRADER",
      actorUserId: input.userId,
      details,
      note: `Suspicious activity detected (${input.reason})`,
    }).catch((error) => {
      console.error("[trader-talent] suspicious challenge event append failed:", error);
    });
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
    const [profile] = await db
      .select({
        userId: traderProfiles.userId,
        bio: traderProfiles.bio,
        strategy: traderProfiles.strategy,
        pinnedTradeIds: traderProfiles.pinnedTradeIds,
        updatedAt: traderProfiles.updatedAt,
      })
      .from(traderProfiles)
      .where(eq(traderProfiles.userId, userId))
      .limit(1);

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

    const [updated] = await db
      .select({
        userId: traderProfiles.userId,
        bio: traderProfiles.bio,
        strategy: traderProfiles.strategy,
        pinnedTradeIds: traderProfiles.pinnedTradeIds,
        updatedAt: traderProfiles.updatedAt,
      })
      .from(traderProfiles)
      .where(eq(traderProfiles.userId, userId))
      .limit(1);

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
        AND c.is_active = true
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
      .select({
        userId: challengeUserProgression.userId,
        currentTier: challengeUserProgression.currentTier,
        challengesPassed: challengeUserProgression.challengesPassed,
        top3Count: challengeUserProgression.top3Count,
        avgPnlPct: challengeUserProgression.avgPnlPct,
        totalDqs: challengeUserProgression.totalDqs,
        tierAdvancedAt: challengeUserProgression.tierAdvancedAt,
        progressionPlanId: challengeUserProgression.progressionPlanId,
        updatedAt: challengeUserProgression.updatedAt,
      })
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
        verificationCodeNonce: challengeCertificates.verificationCodeNonce,
        verificationHmacKeyId: challengeCertificates.verificationHmacKeyId,
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

    return res.json({ ok: true, rows: rows.map((row) => toTraderCertificateRow(row as Record<string, unknown>)) });
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

    const [ch] = await db
      .select({
        id: challenges.id,
        name: challenges.name,
        slug: challenges.slug,
        description: challenges.description,
        category: challenges.category,
        tier: challenges.tier,
        tags: challenges.tags,
        iconColor: challenges.iconColor,
        profitTargetPct: challenges.profitTargetPct,
        maxDailyLossPct: challenges.maxDailyLossPct,
        maxTotalLossPct: challenges.maxTotalLossPct,
        durationDays: challenges.durationDays,
        minTradingDays: challenges.minTradingDays,
        virtualCapitalUsd: challenges.virtualCapitalUsd,
        capitalMode: challenges.capitalMode,
        leverageMultiplier: challenges.leverageMultiplier,
        startAt: challenges.startAt,
        endAt: challenges.endAt,
        enrollmentStartAt: challenges.enrollmentStartAt,
        enrollmentEndAt: challenges.enrollmentEndAt,
        visibleToTraders: challenges.visibleToTraders,
        featuredOrder: challenges.featuredOrder,
        prizePoolEnabled: challenges.prizePoolEnabled,
        prizePoolUsd: challenges.prizePoolUsd,
        prizeMinCompletions: challenges.prizeMinCompletions,
        badgesEnabled: challenges.badgesEnabled,
        certificateEnabled: challenges.certificateEnabled,
        selectionBoostEnabled: challenges.selectionBoostEnabled,
        selectionBoostPoints: challenges.selectionBoostPoints,
        leaderboardEnabled: challenges.leaderboardEnabled,
        leaderboardAnonymize: challenges.leaderboardAnonymize,
        leaderboardMaxVisible: challenges.leaderboardMaxVisible,
        isActive: challenges.isActive,
      })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);
    if (!ch || !ch.visibleToTraders || !ch.isActive) {
      return res.status(404).json({ message: "CHALLENGE_NOT_FOUND" });
    }

    const phases = await db
      .select({
        id: challengePhases.id,
        challengeId: challengePhases.challengeId,
        phaseNumber: challengePhases.phaseNumber,
        phaseName: challengePhases.phaseName,
        profitTargetPct: challengePhases.profitTargetPct,
        maxDailyLossPct: challengePhases.maxDailyLossPct,
        maxTotalLossPct: challengePhases.maxTotalLossPct,
        drawdownType: challengePhases.drawdownType,
        durationDays: challengePhases.durationDays,
        minTradingDays: challengePhases.minTradingDays,
        maxSingleDayProfitPct: challengePhases.maxSingleDayProfitPct,
        allowWeekendHolding: challengePhases.allowWeekendHolding,
        allowNewsTrading: challengePhases.allowNewsTrading,
        restrictedSymbolsCsv: challengePhases.restrictedSymbolsCsv,
        maxConcurrentPositions: challengePhases.maxConcurrentPositions,
        maxLotSize: challengePhases.maxLotSize,
      })
      .from(challengePhases)
      .where(eq(challengePhases.challengeId, challengeId))
      .orderBy(challengePhases.phaseNumber);

    const [enrollment] = await db
      .select({
        id: challengeEnrollments.id,
        challengeId: challengeEnrollments.challengeId,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
        currentPhase: challengeEnrollments.currentPhase,
        snapshotEquity: challengeEnrollments.snapshotEquity,
        capitalBaseUsed: challengeEnrollments.capitalBaseUsed,
        attemptNumber: challengeEnrollments.attemptNumber,
        maxTotalLossHit: challengeEnrollments.maxTotalLossHit,
        peakEquity: challengeEnrollments.peakEquity,
        phaseStartedAt: challengeEnrollments.phaseStartedAt,
        lastWarningEvent: challengeEnrollments.lastWarningEvent,
        lastWarningAt: challengeEnrollments.lastWarningAt,
        tradingDays: challengeEnrollments.tradingDays,
        updatedAt: challengeEnrollments.updatedAt,
      })
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
      .select({
        id: challengeEnrollments.id,
        challengeId: challengeEnrollments.challengeId,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        enrolledAt: challengeEnrollments.enrolledAt,
        completedAt: challengeEnrollments.completedAt,
        currentPnlPct: challengeEnrollments.currentPnlPct,
        maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
        currentPhase: challengeEnrollments.currentPhase,
        snapshotEquity: challengeEnrollments.snapshotEquity,
        capitalBaseUsed: challengeEnrollments.capitalBaseUsed,
        attemptNumber: challengeEnrollments.attemptNumber,
        maxTotalLossHit: challengeEnrollments.maxTotalLossHit,
        peakEquity: challengeEnrollments.peakEquity,
        phaseStartedAt: challengeEnrollments.phaseStartedAt,
        lastWarningEvent: challengeEnrollments.lastWarningEvent,
        lastWarningAt: challengeEnrollments.lastWarningAt,
        tradingDays: challengeEnrollments.tradingDays,
        updatedAt: challengeEnrollments.updatedAt,
      })
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
      .orderBy(desc(challengeEnrollments.attemptNumber), desc(challengeEnrollments.id))
      .limit(1);
    if (!enrollment) {
      return res.status(404).json({ message: "NOT_ENROLLED" });
    }

    const [phase] = await db
      .select({
        id: challengePhases.id,
        challengeId: challengePhases.challengeId,
        phaseNumber: challengePhases.phaseNumber,
        phaseName: challengePhases.phaseName,
        profitTargetPct: challengePhases.profitTargetPct,
        maxDailyLossPct: challengePhases.maxDailyLossPct,
        maxTotalLossPct: challengePhases.maxTotalLossPct,
        drawdownType: challengePhases.drawdownType,
        durationDays: challengePhases.durationDays,
        minTradingDays: challengePhases.minTradingDays,
        maxSingleDayProfitPct: challengePhases.maxSingleDayProfitPct,
        allowWeekendHolding: challengePhases.allowWeekendHolding,
        allowNewsTrading: challengePhases.allowNewsTrading,
        restrictedSymbolsCsv: challengePhases.restrictedSymbolsCsv,
        maxConcurrentPositions: challengePhases.maxConcurrentPositions,
        maxLotSize: challengePhases.maxLotSize,
      })
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
      emitChallengeSuspiciousActivity({
        req,
        userId,
        challengeId,
        reason: "ENROLL_RATE_LIMIT",
        details: { retryAfterSec: enrollRate.retryAfterSec },
      });
      res.setHeader("Retry-After", String(enrollRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_ENROLL_RATE_LIMIT",
        retryAfterSec: enrollRate.retryAfterSec,
      });
    }

    const ts = nowSec();
    const [ch] = await db
      .select({
        id: challenges.id,
        name: challenges.name,
        isActive: challenges.isActive,
        visibleToTraders: challenges.visibleToTraders,
        enrollmentStartAt: challenges.enrollmentStartAt,
        enrollmentEndAt: challenges.enrollmentEndAt,
        eligibilityGate: challenges.eligibilityGate,
        maxEnrollments: challenges.maxEnrollments,
        maxActiveEnrollments: challenges.maxActiveEnrollments,
        maxRetriesPerTrader: challenges.maxRetriesPerTrader,
        retryCooldownHours: challenges.retryCooldownHours,
        capitalMode: challenges.capitalMode,
        virtualCapitalUsd: challenges.virtualCapitalUsd,
        customRewardJson: challenges.customRewardJson,
        createdBy: challenges.createdBy,
      })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);
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

    const enrollmentResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);

      const existing = await tx
        .select({
          id: challengeEnrollments.id,
          challengeId: challengeEnrollments.challengeId,
          userId: challengeEnrollments.userId,
          status: challengeEnrollments.status,
          enrolledAt: challengeEnrollments.enrolledAt,
          completedAt: challengeEnrollments.completedAt,
          currentPhase: challengeEnrollments.currentPhase,
          attemptNumber: challengeEnrollments.attemptNumber,
        })
        .from(challengeEnrollments)
        .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
        .orderBy(desc(challengeEnrollments.attemptNumber))
        .limit(1);
      const latest = existing[0] ?? null;

      if (latest && latest.status === "ACTIVE") {
        return { type: "reused" as const, enrollment: latest };
      }
      if (latest && latest.status === "REVIEW_REQUIRED") {
        return {
          type: "deny" as const,
          status: 409,
          payload: {
            message: "MANUAL_REVIEW_REQUIRED",
            detail: "Previous attempt is pending manual review.",
          },
        };
      }

      const [activeUserRow] = await tx
        .select({ c: sql<number>`count(*)` })
        .from(challengeEnrollments)
        .where(and(eq(challengeEnrollments.userId, userId), eq(challengeEnrollments.status, "ACTIVE")));
      const activeUserEnrollments = Number(activeUserRow?.c ?? 0);
      if (activeUserEnrollments >= Math.max(1, Number(challengeCfg.challengeMaxActiveEnrollmentsUser ?? 1))) {
        return {
          type: "deny" as const,
          status: 409,
          payload: {
            message: "MAX_ACTIVE_ENROLLMENTS_USER_REACHED",
            limit: Math.max(1, Number(challengeCfg.challengeMaxActiveEnrollmentsUser ?? 1)),
            active: activeUserEnrollments,
          },
        };
      }

      const maxEnrollments = Number(ch.maxEnrollments ?? 0);
      if (!latest && Number.isFinite(maxEnrollments) && maxEnrollments > 0) {
        const [totalEnrollmentsRow] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(challengeEnrollments)
          .where(eq(challengeEnrollments.challengeId, challengeId));
        const totalEnrollments = Number(totalEnrollmentsRow?.c ?? 0);
        if (totalEnrollments >= Math.trunc(maxEnrollments)) {
          return { type: "deny" as const, status: 409, payload: { message: "MAX_ENROLLMENTS_REACHED" } };
        }
      }

      const configuredPerChallengeCap = Number(ch.maxActiveEnrollments ?? 0);
      const globalPerChallengeCap = Math.max(1, Number(challengeCfg.challengeMaxActiveEnrollmentsPerChallenge ?? 1));
      const effectivePerChallengeCap =
        Number.isFinite(configuredPerChallengeCap) && configuredPerChallengeCap > 0
          ? Math.trunc(configuredPerChallengeCap)
          : globalPerChallengeCap;
      const [activeEnrollmentsRow] = await tx
        .select({ c: sql<number>`count(*)` })
        .from(challengeEnrollments)
        .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.status, "ACTIVE")));
      const activeEnrollments = Number(activeEnrollmentsRow?.c ?? 0);
      if (activeEnrollments >= effectivePerChallengeCap) {
        return {
          type: "deny" as const,
          status: 409,
          payload: {
            message: "MAX_ACTIVE_ENROLLMENTS_REACHED",
            limit: effectivePerChallengeCap,
            active: activeEnrollments,
          },
        };
      }

      const maxRetries = Math.max(0, Number(ch.maxRetriesPerTrader ?? challengeCfg.challengeDefaultMaxRetries ?? 0));
      const challengeCooldownHrs = Math.max(0, Number(ch.retryCooldownHours ?? challengeCfg.challengeDefaultRetryCooldownHours ?? 0));
      const statusCooldownHrs =
        latest?.status === "FAILED"
          ? Math.max(0, Number(challengeCfg.challengeCooldownHoursAfterFail ?? 0))
          : latest?.status === "WITHDRAWN"
            ? Math.max(0, Number(challengeCfg.challengeCooldownHoursAfterWithdraw ?? 0))
            : 0;
      const effectiveCooldownHrs = Math.max(challengeCooldownHrs, statusCooldownHrs);

      const nextAttempt = latest ? Number(latest.attemptNumber ?? 1) + 1 : 1;
      if (latest && nextAttempt > maxRetries + 1) {
        return { type: "deny" as const, status: 403, payload: { message: "MAX_RETRIES_EXCEEDED" } };
      }

      if (latest && effectiveCooldownHrs > 0 && latest.completedAt != null) {
        const coolUntil = Number(latest.completedAt) + effectiveCooldownHrs * 3600;
        if (ts < coolUntil) {
          return {
            type: "deny" as const,
            status: 403,
            payload: {
              message: "RETRY_COOLDOWN",
              retryAt: coolUntil,
              cooldownHours: effectiveCooldownHrs,
              priorStatus: latest.status,
            },
          };
        }
      }

      const [u] = await tx
        .select({ equity: users.equity, startingEquity: users.startingEquity })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const snapshotEquity = Number(u?.equity ?? u?.startingEquity ?? 1_000_000);

      const effectiveCapitalMode = String(ch.capitalMode || "").toUpperCase() === "VIRTUAL" ? "VIRTUAL" : "TRADER_EQUITY";
      const capitalBaseUsed = effectiveCapitalMode === "VIRTUAL" ? Number(ch.virtualCapitalUsd ?? snapshotEquity) : snapshotEquity;

      if (latest) {
        const [updated] = await tx
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

        return { type: "updated" as const, enrollment: updated };
      }

      const [created] = await tx
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

      return { type: "created" as const, enrollment: created };
    });

    if (enrollmentResult.type === "deny") {
      emitChallengeSuspiciousActivity({
        req,
        userId,
        challengeId,
        reason: String(enrollmentResult.payload?.message ?? "ENROLL_BLOCKED"),
        details: enrollmentResult.payload ?? {},
      });
      return res.status(enrollmentResult.status).json(enrollmentResult.payload);
    }

    if (enrollmentResult.type === "reused") {
      return res.json({ ok: true, reused: true, enrollment: enrollmentResult.enrollment });
    }

    const enrollment = enrollmentResult.enrollment;
    const resumed = enrollmentResult.type === "updated";

    await appendChallengeEvent({
      enrollmentId: Number(enrollment.id),
      eventType: "CHALLENGE_ENROLLED",
      eventAt: ts,
      actorType: "TRADER",
      actorUserId: userId,
      phaseNumber: Number(enrollment.currentPhase ?? 1),
      details: {
        challengeId,
        attemptNumber: Number(enrollment.attemptNumber ?? 1),
        resumedEnrollmentId: resumed ? Number(enrollment.id) : null,
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
        enrollmentId: Number(enrollment.id),
        attemptNumber: Number(enrollment.attemptNumber ?? 1),
        resumed,
      },
    });

    await applyEnrollCustomRewards({
      req,
      cfg,
      challenge: ch,
      enrollment,
      userId,
      now: ts,
    });

    if (challengeCfg.challengeNotifyOnEnroll) {
      await createNotification({
        userId,
        type: "CHALLENGE",
        severity: "INFO",
        title: "Challenge enrolled",
        message: resumed
          ? `You are enrolled in ${ch.name}. Attempt #${Number(enrollment.attemptNumber ?? 1)} is now active.`
          : `You are enrolled in ${ch.name}. Good luck.`,
        sourceEvent: "CHALLENGE_ENROLLED",
        link: `/compete/enrollment/${Number(enrollment.id)}`,
      });
      await sendChallengeMailboxMessage({
        userId,
        challengeId,
        enrollmentId: Number(enrollment.id),
        sourceEvent: "CHALLENGE_ENROLLED",
        subject: `Challenge enrolled: ${ch.name}`,
        body: `Attempt #${Number(enrollment.attemptNumber ?? 1)} is active for ${ch.name}.`,
      });
    }

    return res.json({ ok: true, reused: false, enrollment });
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
      .select({
        id: challengeEnrollments.id,
        challengeId: challengeEnrollments.challengeId,
        userId: challengeEnrollments.userId,
        status: challengeEnrollments.status,
        currentPhase: challengeEnrollments.currentPhase,
        attemptNumber: challengeEnrollments.attemptNumber,
      })
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
    const challengeId = Number(req.params.id || 0);
    const leaderboardRate = consumeChallengeRateLimit(`leaderboard:${userId}`, 30, 60_000);
    if (!leaderboardRate.allowed) {
      emitChallengeSuspiciousActivity({
        req,
        userId,
        challengeId: Number.isInteger(challengeId) && challengeId > 0 ? challengeId : null,
        reason: "LEADERBOARD_SCRAPE_RATE_LIMIT",
        details: { retryAfterSec: leaderboardRate.retryAfterSec },
      });
      res.setHeader("Retry-After", String(leaderboardRate.retryAfterSec));
      return res.status(429).json({
        message: "RATE_LIMITED",
        code: "CHALLENGE_LEADERBOARD_RATE_LIMIT",
        retryAfterSec: leaderboardRate.retryAfterSec,
      });
    }
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
      const anonymize = Boolean(ch.leaderboardAnonymize);
      const anonId = anonymize ? buildChallengeAnonId(challengeId, id) : null;
      const displayName = anonymize
        ? `Trader #${anonId}`
        : uname || `Trader #${id}`;
      const base = {
        rank: Number(r.rank),
        pnlPct: Number(r.pnl_pct),
        anonId,
        displayName,
        isYou: id === userId,
      };
      return anonymize ? base : { ...base, userId: id };
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
        enrollment: {
          id: challengeEnrollments.id,
          challengeId: challengeEnrollments.challengeId,
          userId: challengeEnrollments.userId,
          status: challengeEnrollments.status,
          enrolledAt: challengeEnrollments.enrolledAt,
          completedAt: challengeEnrollments.completedAt,
          currentPnlPct: challengeEnrollments.currentPnlPct,
          maxDailyLossHit: challengeEnrollments.maxDailyLossHit,
          currentPhase: challengeEnrollments.currentPhase,
          snapshotEquity: challengeEnrollments.snapshotEquity,
          capitalBaseUsed: challengeEnrollments.capitalBaseUsed,
          attemptNumber: challengeEnrollments.attemptNumber,
          maxTotalLossHit: challengeEnrollments.maxTotalLossHit,
          peakEquity: challengeEnrollments.peakEquity,
          phaseStartedAt: challengeEnrollments.phaseStartedAt,
          lastWarningEvent: challengeEnrollments.lastWarningEvent,
          lastWarningAt: challengeEnrollments.lastWarningAt,
          tradingDays: challengeEnrollments.tradingDays,
          updatedAt: challengeEnrollments.updatedAt,
        },
        challenge: {
          id: challenges.id,
          name: challenges.name,
          slug: challenges.slug,
          category: challenges.category,
          tier: challenges.tier,
          profitTargetPct: challenges.profitTargetPct,
          maxDailyLossPct: challenges.maxDailyLossPct,
          maxTotalLossPct: challenges.maxTotalLossPct,
          durationDays: challenges.durationDays,
          minTradingDays: challenges.minTradingDays,
          startAt: challenges.startAt,
          endAt: challenges.endAt,
          enrollmentStartAt: challenges.enrollmentStartAt,
          enrollmentEndAt: challenges.enrollmentEndAt,
        },
      })
      .from(challengeEnrollments)
      .innerJoin(challenges, eq(challenges.id, challengeEnrollments.challengeId))
      .where(eq(challengeEnrollments.id, enrollmentId))
      .limit(1);

    if (!row || row.enrollment.userId !== userId) {
      return res.status(404).json({ message: "ENROLLMENT_NOT_FOUND" });
    }

    const phases = await db
      .select({
        id: challengePhases.id,
        challengeId: challengePhases.challengeId,
        phaseNumber: challengePhases.phaseNumber,
        phaseName: challengePhases.phaseName,
        profitTargetPct: challengePhases.profitTargetPct,
        maxDailyLossPct: challengePhases.maxDailyLossPct,
        maxTotalLossPct: challengePhases.maxTotalLossPct,
        drawdownType: challengePhases.drawdownType,
        durationDays: challengePhases.durationDays,
        minTradingDays: challengePhases.minTradingDays,
        maxSingleDayProfitPct: challengePhases.maxSingleDayProfitPct,
        allowWeekendHolding: challengePhases.allowWeekendHolding,
        allowNewsTrading: challengePhases.allowNewsTrading,
        restrictedSymbolsCsv: challengePhases.restrictedSymbolsCsv,
        maxConcurrentPositions: challengePhases.maxConcurrentPositions,
        maxLotSize: challengePhases.maxLotSize,
      })
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
            verificationCodeNonce: challengeCertificates.verificationCodeNonce,
            verificationHmacKeyId: challengeCertificates.verificationHmacKeyId,
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
      certificate: cert ? toTraderCertificateRow(cert as Record<string, unknown>) : null,
      boosts,
      prizes,
    });
  } catch (error) {
    console.error("[trader-talent] my-rewards error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_REWARDS" });
  }
});

registerTraderTalentCertificateRoutes(traderTalentRouter, traderTalentPublicRouter, {
  nowSec,
  consumeChallengeRateLimit,
  getRecruitmentConfig,
  toTraderCertificateRow,
});

export { traderTalentRouter, traderTalentPublicRouter };
