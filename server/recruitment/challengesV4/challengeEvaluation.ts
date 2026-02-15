import { db } from "@db";
import {
  challengeBadgeAwards,
  challengeBadges,
  challengeCertificates,
  challengeCertificateTemplates,
  challengeEnrollments,
  challengeEvaluationRuns,
  challengeLeaderboardSnapshot,
  challengePhaseSnapshots,
  challengePhases,
  challengePrizeAwards,
  challengeProgressionTiers,
  challengeRewardLedger,
  challengeSelectionBoosts,
  challengeUserProgression,
  challenges,
  recruitingPipeline,
  scoutWatchlists,
  trades,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createMailboxThreadWithMessage, createNotification } from "../../services/messaging";
import { appendIdentityAudit } from "../../services/identityAudit";
import { appendChallengeEvent } from "./challengeEvents";
import { getSystemChallengeConfig, type SystemChallengeConfig } from "./challengeConfig";
import { generateCertificateVerificationBundle } from "./certificateCode";
import {
  parseCustomRewardRules,
  scopedCustomRewardKey,
  type CustomRewardActionType,
  type CustomRewardTrigger,
} from "./customRewards";
import { chainHash, stableStringify } from "./hashChain";
import { getPhaseForEnrollment, hasRestrictedSymbolTrade, nowSec, parseCsvSet } from "./challengeService";

type EvalResult = {
  processed: number;
  advanced: number;
  passed: number;
  failed: number;
  warned: number;
};

export type PhaseStats = {
  pnlBasis: "REALIZED_ONLY";
  roundingMode: "HALF_AWAY_FROM_ZERO_8DP";
  inputHash: string;
  tradeCount: number;
  totalPnl: number;
  pnlPct: number;
  tradingDays: number;
  worstDayLossPct: number;
  bestDayProfitPct: number;
  startDdPct: number;
  trailingDdPct: number;
  peakEquity: number;
};

type RankedPassedRow = {
  enrollmentId: number;
  userId: number;
  rank: number;
  pnlPct: number;
  tradingDays: number;
};

type PrizeRecomputeResult = {
  rankByEnrollmentId: Map<number, number>;
  newlyAwardedEnrollmentIds: Set<number>;
};

type TierRule = {
  name: string;
  minChallengesPassed: number;
  minTop3: number;
  minAvgPnlPct: number;
  maxDqs: number | null;
  order: number;
};

const EVALUATION_RUN_LOCK_KEY = 920_451_172;
const customRewardRuleCache = new Map<string, ReturnType<typeof parseCustomRewardRules>>();

function buildEvalRunId(now: number): string {
  return `challenge-eval-${now}-${Math.floor(Math.random() * 1_000_000_000).toString(36)}`;
}

function withRunDetails(details: unknown, runId: string): Record<string, unknown> {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return { ...(details as Record<string, unknown>), runId };
  }
  return { runId, details: details ?? null };
}

async function appendChallengeEventWithRun(
  input: Parameters<typeof appendChallengeEvent>[0],
  runId: string,
): Promise<void> {
  await appendChallengeEvent({
    ...input,
    details: withRunDetails(input.details, runId),
  });
}

function appendChallengeTransitionAudit(input: {
  runId: string;
  userId: number;
  challengeId: number;
  enrollmentId: number;
  type: string;
  data?: Record<string, unknown>;
}) {
  appendIdentityAudit({
    userId: input.userId,
    category: "RECRUITMENT",
    type: input.type,
    actorType: "SYSTEM",
    actorUserId: null,
    correlationId: input.runId,
    data: {
      challengeId: input.challengeId,
      enrollmentId: input.enrollmentId,
      runId: input.runId,
      ...(input.data ?? {}),
    },
  });
}

function normalizeChallengeMailboxCategory(raw: unknown): "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT" | "CHALLENGES" {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value === "SYSTEM" || value === "SUPPORT" || value === "ANNOUNCEMENT" || value === "CHALLENGES") {
    return value;
  }
  return "SYSTEM";
}

async function maybeSendChallengeMailboxMessage(args: {
  cfg: SystemChallengeConfig;
  userId: number;
  challengeId: number;
  enrollmentId: number;
  sourceEvent: string;
  subject: string;
  body: string;
}) {
  if (!args.cfg.challengeNotifyViaMailbox) return;
  try {
    await createMailboxThreadWithMessage({
      createdByUserId: null,
      senderUserId: null,
      recipientUserIds: [args.userId],
      subject: args.subject,
      body: args.body,
      category: normalizeChallengeMailboxCategory(args.cfg.challengeMailboxCategory),
      allowReply: false,
      messageType: "CHALLENGE_EVENT",
      metadata: {
        sourceEvent: args.sourceEvent,
        challengeId: args.challengeId,
        enrollmentId: args.enrollmentId,
      },
    });
  } catch (error) {
    console.error("[challenges-v4] mailbox notification failed:", {
      userId: args.userId,
      challengeId: args.challengeId,
      enrollmentId: args.enrollmentId,
      sourceEvent: args.sourceEvent,
      error,
    });
  }
}

function toPositiveInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundDeterministic(value: number, decimals = 8): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizePrizeDistribution(raw: unknown): Array<{ rank: number; pct: number }> {
  const parsed = parseJsonValue(raw);
  const out: Array<{ rank: number; pct: number }> = [];

  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i] as any;
      const rank = toPositiveInt(row?.rank ?? i + 1, i + 1);
      const rawPct = toNumber(row?.pct ?? row?.percentage ?? row?.share ?? row?.value, 0);
      const pct = rawPct > 1 ? rawPct / 100 : rawPct;
      if (rank > 0 && pct > 0) out.push({ rank, pct });
    }
  } else if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const rank = toPositiveInt(k, 0);
      const rawPct = toNumber(v, 0);
      const pct = rawPct > 1 ? rawPct / 100 : rawPct;
      if (rank > 0 && pct > 0) out.push({ rank, pct });
    }
  }

  out.sort((a, b) => a.rank - b.rank);

  const dedup = new Map<number, number>();
  for (const row of out) {
    if (!dedup.has(row.rank)) dedup.set(row.rank, row.pct);
  }

  const normalized = Array.from(dedup.entries()).map(([rank, pct]) => ({ rank, pct }));
  const sum = normalized.reduce((acc, row) => acc + row.pct, 0);
  if (sum > 1.000001) {
    return normalized.map((row) => ({ rank: row.rank, pct: row.pct / sum }));
  }
  return normalized;
}

async function resolveBadgeByRef(tx: any, badgeRef: unknown): Promise<{ id: number; name: string } | null> {
  const raw = String(badgeRef ?? "").trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric > 0) {
    const [byId] = await tx
      .select({ id: challengeBadges.id, name: challengeBadges.name })
      .from(challengeBadges)
      .where(and(eq(challengeBadges.id, numeric), eq(challengeBadges.isActive, true)))
      .limit(1);
    if (byId) return byId;
  }

  const [byKey] = await tx
    .select({ id: challengeBadges.id, name: challengeBadges.name })
    .from(challengeBadges)
    .where(and(eq(challengeBadges.key, raw), eq(challengeBadges.isActive, true)))
    .limit(1);
  if (byKey) return byKey;

  const q = await tx.execute(sql`
    SELECT id, name
    FROM challenge_badges
    WHERE is_active = true
      AND lower(key) = lower(${raw})
    LIMIT 1
  `);
  const row: any = (q as any).rows?.[0] ?? null;
  if (!row) return null;

  return { id: Number(row.id), name: String(row.name ?? raw) };
}

async function awardBadge(args: {
  userId: number;
  challengeId: number;
  enrollmentId: number;
  badgeRef: unknown;
  reason: string;
  awardedAt: number;
}): Promise<{ awarded: boolean; badgeName: string | null }> {
  return db.transaction(async (tx) => {
    const badge = await resolveBadgeByRef(tx, args.badgeRef);
    if (!badge) return { awarded: false, badgeName: null };

    const inserted = await tx
      .insert(challengeBadgeAwards)
      .values({
        userId: args.userId,
        badgeId: badge.id,
        challengeId: args.challengeId,
        enrollmentId: args.enrollmentId,
        awardedAt: args.awardedAt,
        awardedReason: args.reason,
      })
      .onConflictDoNothing()
      .returning({ id: challengeBadgeAwards.id });

    return { awarded: inserted.length > 0, badgeName: badge.name };
  });
}

async function issueCertificate(args: {
  userId: number;
  challengeId: number;
  enrollmentId: number;
  templateId: number | null;
  verificationKeyId: string;
  isDownloadable: boolean;
  isShareable: boolean;
  includeMetrics: boolean;
  metrics: PhaseStats;
  issuedAt: number;
}): Promise<{ issued: boolean; certificateId: number | null }> {
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: challengeCertificates.id })
      .from(challengeCertificates)
      .where(eq(challengeCertificates.enrollmentId, args.enrollmentId))
      .limit(1);
    if (exists) return { issued: false, certificateId: exists.id };

    let templateId = args.templateId;
    if (!templateId || templateId <= 0) {
      const [tmpl] = await tx
        .select({ id: challengeCertificateTemplates.id })
        .from(challengeCertificateTemplates)
        .where(eq(challengeCertificateTemplates.isActive, true))
        .orderBy(asc(challengeCertificateTemplates.id))
        .limit(1);
      templateId = tmpl?.id ?? null;
    }

    const verification = generateCertificateVerificationBundle(args.verificationKeyId);

    const shareTokenHash = args.isShareable
      ? chainHash(verification.hmac, {
          kind: "challenge-cert-share",
          enrollmentId: args.enrollmentId,
          issuedAt: args.issuedAt,
        })
      : null;

    const metricsJson = args.includeMetrics
      ? stableStringify({
          pnlPct: args.metrics.pnlPct,
          pnlUsd: args.metrics.totalPnl,
          tradingDays: args.metrics.tradingDays,
          maxDailyLossHit: args.metrics.worstDayLossPct,
          maxTotalLossHit: Math.max(args.metrics.startDdPct, args.metrics.trailingDdPct),
          peakEquity: args.metrics.peakEquity,
        })
      : "{}";

    const inserted = await tx
      .insert(challengeCertificates)
      .values({
        enrollmentId: args.enrollmentId,
        userId: args.userId,
        challengeId: args.challengeId,
        templateId,
        verificationCodeNonce: verification.nonce,
        verificationHmacKeyId: verification.keyId,
        verificationCodeHmac: verification.hmac,
        metricsJson,
        isDownloadable: args.isDownloadable,
        isShareable: args.isShareable,
        shareTokenHash,
        issuedAt: args.issuedAt,
        createdAt: args.issuedAt,
      })
      .onConflictDoNothing()
      .returning({ id: challengeCertificates.id });

    return { issued: inserted.length > 0, certificateId: inserted[0]?.id ?? null };
  });
}

async function awardSelectionBoost(args: {
  userId: number;
  challengeId: number;
  enrollmentId: number;
  points: number;
  reason: string;
  awardedAt: number;
  createdBy: number | null;
}): Promise<boolean> {
  if (!Number.isFinite(args.points) || args.points <= 0) return false;

  const inserted = await db
    .insert(challengeSelectionBoosts)
    .values({
      challengeId: args.challengeId,
      enrollmentId: args.enrollmentId,
      userId: args.userId,
      points: args.points,
      reason: args.reason,
      awardedAt: args.awardedAt,
      createdBy: args.createdBy,
      createdAt: args.awardedAt,
    })
    .onConflictDoNothing()
    .returning({ id: challengeSelectionBoosts.id });

  return inserted.length > 0;
}

async function claimCustomRewardLedger(args: {
  enrollmentId: number;
  challengeId: number;
  userId: number;
  trigger: CustomRewardTrigger;
  rewardKey: string;
  actionType: CustomRewardActionType;
  runId: string;
  details: Record<string, unknown>;
  now: number;
}): Promise<boolean> {
  const inserted = await db
    .insert(challengeRewardLedger)
    .values({
      enrollmentId: args.enrollmentId,
      challengeId: args.challengeId,
      userId: args.userId,
      trigger: args.trigger,
      rewardKey: args.rewardKey,
      actionType: args.actionType,
      runId: args.runId,
      detailsJson: stableStringify(args.details),
      createdAt: args.now,
    })
    .onConflictDoNothing()
    .returning({ id: challengeRewardLedger.id });
  return inserted.length > 0;
}

async function executeCustomRewardAction(args: {
  enrollment: any;
  challenge: any;
  cfg: SystemChallengeConfig;
  trigger: CustomRewardTrigger;
  actionType: CustomRewardActionType;
  rewardKey: string;
  payload: Record<string, unknown>;
  rank?: number | null;
  now: number;
}): Promise<boolean> {
  const challengeName = String(args.challenge.name ?? `Challenge ${args.challenge.id}`);

  if (args.actionType === "BADGE_AWARD") {
    const badgeRef = args.payload.badgeRef ?? args.payload.badgeId ?? args.payload.badgeKey;
    if (badgeRef == null || String(badgeRef).trim() === "") return false;
    const awarded = await awardBadge({
      userId: args.enrollment.userId,
      challengeId: args.challenge.id,
      enrollmentId: args.enrollment.id,
      badgeRef,
      reason: String(args.payload.reason ?? `CUSTOM_REWARD_${args.trigger}`),
      awardedAt: args.now,
    });
    return awarded.awarded;
  }

  if (args.actionType === "SELECTION_BOOST") {
    const points = toNumber(args.payload.points, 0);
    if (!Number.isFinite(points) || points <= 0) return false;
    return awardSelectionBoost({
      userId: args.enrollment.userId,
      challengeId: args.challenge.id,
      enrollmentId: args.enrollment.id,
      points,
      reason: String(args.payload.reason ?? `CUSTOM_REWARD_${args.trigger}`),
      awardedAt: args.now,
      createdBy: Number(args.challenge.createdBy ?? 0) > 0 ? Number(args.challenge.createdBy) : null,
    });
  }

  if (args.actionType === "INBOX_MESSAGE") {
    const subject = String(args.payload.subject ?? "").trim();
    const body = String(args.payload.body ?? "").trim();
    if (!subject || !body) return false;
    await createMailboxThreadWithMessage({
      createdByUserId: null,
      senderUserId: null,
      recipientUserIds: [args.enrollment.userId],
      subject,
      body,
      category: normalizeChallengeMailboxCategory(args.payload.category),
      allowReply: false,
      messageType: "CHALLENGE_EVENT",
      metadata: {
        sourceEvent: "CHALLENGE_CUSTOM_REWARD",
        trigger: args.trigger,
        rewardKey: args.rewardKey,
        challengeId: args.challenge.id,
        enrollmentId: args.enrollment.id,
        rank: args.rank ?? null,
      },
    });
    return true;
  }

  if (args.actionType === "NOTIFY") {
    const title = String(args.payload.title ?? "").trim();
    const message = String(args.payload.message ?? "").trim();
    if (!title || !message) return false;
    const severityRaw = String(args.payload.severity ?? "INFO").trim().toUpperCase();
    const severity = severityRaw === "SUCCESS" || severityRaw === "WARNING" || severityRaw === "CRITICAL" ? severityRaw : "INFO";
    await createNotification({
      userId: args.enrollment.userId,
      type: "CHALLENGE",
      severity: severity as any,
      title,
      message,
      sourceEvent: String(args.payload.sourceEvent ?? "CHALLENGE_CUSTOM_REWARD"),
      link: String(args.payload.link ?? "").trim() || undefined,
    });
    return true;
  }

  console.warn("[challenges-v4] unsupported custom reward action ignored:", {
    actionType: args.actionType,
    trigger: args.trigger,
    challengeId: args.challenge.id,
    enrollmentId: args.enrollment.id,
    challengeName,
  });
  return false;
}

async function applyCustomRewardsForTrigger(args: {
  cfg: SystemChallengeConfig;
  enrollment: any;
  challenge: any;
  trigger: CustomRewardTrigger;
  now: number;
  runId: string;
  phaseNumber?: number | null;
  rank?: number | null;
}): Promise<void> {
  if (!args.cfg.challengeCustomRewardsEnabled) return;

  const cacheKey = `${Number(args.challenge.id)}:${String(args.challenge.customRewardJson ?? "")}`;
  let allRules = customRewardRuleCache.get(cacheKey);
  if (!allRules) {
    allRules = parseCustomRewardRules(args.challenge.customRewardJson);
    customRewardRuleCache.set(cacheKey, allRules);
    if (customRewardRuleCache.size > 1000) customRewardRuleCache.clear();
  }
  if (!allRules.length) return;

  const matching = allRules.filter((rule) => rule.trigger === args.trigger);
  for (const rule of matching) {
    if (rule.trigger === "ON_RANK_TOP_N") {
      const rank = Number(args.rank ?? 0);
      if (!Number.isFinite(rank) || rank <= 0) continue;
      const topN = Number(rule.topN ?? 0);
      if (topN > 0 && rank > topN) continue;
    }

    const rewardKey = scopedCustomRewardKey({
      rewardKey: rule.rewardKey,
      trigger: rule.trigger,
      phaseNumber: args.phaseNumber ?? null,
    });

    const claimed = await claimCustomRewardLedger({
      enrollmentId: args.enrollment.id,
      challengeId: args.challenge.id,
      userId: args.enrollment.userId,
      trigger: rule.trigger,
      rewardKey,
      actionType: rule.actionType,
      runId: args.runId,
      now: args.now,
      details: {
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        phaseNumber: args.phaseNumber ?? null,
        rank: args.rank ?? null,
        topN: rule.topN ?? null,
      },
    });
    if (!claimed) continue;

    let applied = false;
    try {
      applied = await executeCustomRewardAction({
        enrollment: args.enrollment,
        challenge: args.challenge,
        cfg: args.cfg,
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        payload: rule.payload,
        rank: args.rank,
        now: args.now,
      });
    } catch (error) {
      console.error("[challenges-v4] custom reward action failed:", {
        challengeId: args.challenge.id,
        enrollmentId: args.enrollment.id,
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        error,
      });
    }

    await appendChallengeEventWithRun(
      {
        enrollmentId: args.enrollment.id,
        eventType: "CHALLENGE_CUSTOM_REWARD_EXECUTED",
        phaseNumber: Number(args.phaseNumber ?? args.enrollment.currentPhase ?? 1),
        details: {
          trigger: rule.trigger,
          actionType: rule.actionType,
          rewardKey,
          rank: args.rank ?? null,
          topN: rule.topN ?? null,
          applied,
        },
      },
      args.runId,
    );
    appendChallengeTransitionAudit({
      runId: args.runId,
      userId: args.enrollment.userId,
      challengeId: args.challenge.id,
      enrollmentId: args.enrollment.id,
      type: "CHALLENGE_CUSTOM_REWARD_EXECUTED",
      data: {
        trigger: rule.trigger,
        actionType: rule.actionType,
        rewardKey,
        rank: args.rank ?? null,
        topN: rule.topN ?? null,
        applied,
      },
    });
  }
}

async function upsertPipelineVisibility(args: {
  userId: number;
  challengeName: string;
  challengeId: number;
  createdBy: number | null;
  autoWatchlistTier: unknown;
  now: number;
}): Promise<boolean> {
  await db
    .insert(recruitingPipeline)
    .values({
      userId: args.userId,
      stage: "WATCHLIST",
      isPartnerVisible: false,
      updatedAt: args.now,
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ stage: recruitingPipeline.stage })
    .from(recruitingPipeline)
    .where(eq(recruitingPipeline.userId, args.userId))
    .limit(1);

  const currentStage = String(row?.stage ?? "").toUpperCase();
  if (!currentStage || currentStage === "DETECTED") {
    await db
      .update(recruitingPipeline)
      .set({
        stage: "WATCHLIST",
        updatedAt: args.now,
      })
      .where(eq(recruitingPipeline.userId, args.userId));
  }

  const adminId = Number(args.createdBy ?? 0);
  if (Number.isInteger(adminId) && adminId > 0) {
    const normalizedTierRaw = String(args.autoWatchlistTier ?? "").trim().toUpperCase();
    const normalizedTier = ["A_LIST", "B_LIST", "INCUBATOR"].includes(normalizedTierRaw)
      ? normalizedTierRaw
      : "B_LIST";

    await db
      .insert(scoutWatchlists)
      .values({
        adminId,
        userId: args.userId,
        tier: normalizedTier,
        notes: `Auto-added from challenge #${args.challengeId}: ${args.challengeName}`,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .onConflictDoUpdate({
        target: [scoutWatchlists.adminId, scoutWatchlists.userId],
        set: {
          tier: normalizedTier,
          updatedAt: args.now,
        },
      });
  }

  return true;
}

function resolvePrizeAwardTiming(challenge: any, cfg: SystemChallengeConfig): "ON_COMPLETE" | "ON_CHALLENGE_END" | "MANUAL" {
  const raw = String(challenge?.prizeAwardTiming ?? cfg.challengePrizeAwardTimingDefault ?? "ON_COMPLETE").trim().toUpperCase();
  if (raw === "ON_CHALLENGE_END") return "ON_CHALLENGE_END";
  if (raw === "MANUAL") return "MANUAL";
  return "ON_COMPLETE";
}

function resolveBreachPolicy(challenge: any, cfg: SystemChallengeConfig): "FAIL" | "BREACH_AND_CONTINUE" | "MANUAL_REVIEW" {
  const overrideRaw = String((challenge as any)?.breachPolicy ?? "").trim().toUpperCase();
  if (overrideRaw === "FAIL" || overrideRaw === "BREACH_AND_CONTINUE" || overrideRaw === "MANUAL_REVIEW") {
    return overrideRaw;
  }
  const raw = String(cfg.challengeBreachPolicyDefault ?? "FAIL").trim().toUpperCase();
  if (raw === "BREACH_AND_CONTINUE" || raw === "MANUAL_REVIEW") return raw;
  return "FAIL";
}

function resolvePrizeCandidateMode(challenge: any, cfg: SystemChallengeConfig): "PASSED_ONLY" | "INCLUDE_ACTIVE" {
  const overrideRaw = String((challenge as any)?.prizeCandidatesMode ?? "").trim().toUpperCase();
  if (overrideRaw === "INCLUDE_ACTIVE" || overrideRaw === "PASSED_ONLY") {
    return overrideRaw;
  }

  const raw = String(cfg.challengePrizeCandidatesDefault ?? "PASSED_ONLY").trim().toUpperCase();
  if (raw === "INCLUDE_ACTIVE") return "INCLUDE_ACTIVE";
  return "PASSED_ONLY";
}

async function rankPrizeCandidates(
  challengeId: number,
  candidateMode: "PASSED_ONLY" | "INCLUDE_ACTIVE",
): Promise<RankedPassedRow[]> {
  const statusFilter = candidateMode === "INCLUDE_ACTIVE" ? ["PASSED", "ACTIVE"] : ["PASSED"];
  const rows = await db
    .select({
      enrollmentId: challengeEnrollments.id,
      userId: challengeEnrollments.userId,
      pnlPct: challengeEnrollments.currentPnlPct,
      tradingDays: challengeEnrollments.tradingDays,
      completedAt: challengeEnrollments.completedAt,
    })
    .from(challengeEnrollments)
    .where(and(eq(challengeEnrollments.challengeId, challengeId), inArray(challengeEnrollments.status, statusFilter as any)))
    .orderBy(
      desc(challengeEnrollments.currentPnlPct),
      desc(challengeEnrollments.tradingDays),
      asc(challengeEnrollments.completedAt),
      asc(challengeEnrollments.id),
    );

  return rows.map((row, i) => ({
    enrollmentId: row.enrollmentId,
    userId: row.userId,
    rank: i + 1,
    pnlPct: Number(row.pnlPct ?? 0),
    tradingDays: Number(row.tradingDays ?? 0),
  }));
}

async function recomputePrizeAwards(args: {
  challenge: any;
  cfg: SystemChallengeConfig;
  rankedCandidates: RankedPassedRow[];
  now: number;
}): Promise<PrizeRecomputeResult> {
  const rankByEnrollmentId = new Map<number, number>();
  for (const row of args.rankedCandidates) rankByEnrollmentId.set(row.enrollmentId, row.rank);

  const newlyAwardedEnrollmentIds = new Set<number>();

  if (!args.cfg.challengeRewardsEnabled) {
    return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
  }
  if (!args.cfg.challengePrizePoolsEnabled || !Boolean(args.challenge.prizePoolEnabled)) {
    return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
  }

  const prizePoolUsd = toNumber(args.challenge.prizePoolUsd, 0);
  if (prizePoolUsd <= 0) {
    return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
  }

  const minCompletions = toPositiveInt(args.challenge.prizeMinCompletions, 0);
  if (args.rankedCandidates.length < minCompletions) {
    return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
  }

  let distribution = normalizePrizeDistribution(args.challenge.prizeDistributionJson);
  if (!distribution.length) {
    distribution = [{ rank: 1, pct: 1 }];
  }

  const winners = distribution
    .map((d) => {
      const row = args.rankedCandidates[d.rank - 1];
      if (!row) return null;
      return {
        rank: d.rank,
        pct: d.pct,
        enrollmentId: row.enrollmentId,
        userId: row.userId,
        amountUsd: roundMoney(prizePoolUsd * d.pct),
      };
    })
    .filter(Boolean) as Array<{ rank: number; pct: number; enrollmentId: number; userId: number; amountUsd: number }>;

  if (!winners.length) {
    return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
  }

  await db.transaction(async (tx) => {
    const winnerIds = winners.map((w) => w.enrollmentId);

    const existing = await tx
      .select({
        id: challengePrizeAwards.id,
        enrollmentId: challengePrizeAwards.enrollmentId,
      })
      .from(challengePrizeAwards)
      .where(and(eq(challengePrizeAwards.challengeId, args.challenge.id), inArray(challengePrizeAwards.enrollmentId, winnerIds)));

    const existingByEnrollment = new Map<number, { id: number }>();
    for (const row of existing) {
      existingByEnrollment.set(Number(row.enrollmentId), { id: row.id });
    }

    const [last] = await tx
      .select({ eventHash: challengePrizeAwards.eventHash })
      .from(challengePrizeAwards)
      .where(eq(challengePrizeAwards.challengeId, args.challenge.id))
      .orderBy(desc(challengePrizeAwards.createdAt), desc(challengePrizeAwards.id))
      .limit(1);

    let prevHash = last?.eventHash ?? null;

    for (const winner of winners) {
      const existingRow = existingByEnrollment.get(winner.enrollmentId);
      if (existingRow) {
        await tx
          .update(challengePrizeAwards)
          .set({
            rank: winner.rank,
            prizeAmountUsd: winner.amountUsd,
            note: "Auto-ranked from challenge completion",
          })
          .where(eq(challengePrizeAwards.id, existingRow.id));
      } else {
        const payload = {
          challengeId: args.challenge.id,
          enrollmentId: winner.enrollmentId,
          userId: winner.userId,
          rank: winner.rank,
          amountUsd: winner.amountUsd,
          status: "PENDING",
          createdAt: args.now,
        };

        const eventHash = chainHash(prevHash, payload);

        await tx.insert(challengePrizeAwards).values({
          challengeId: args.challenge.id,
          enrollmentId: winner.enrollmentId,
          userId: winner.userId,
          rank: winner.rank,
          prizeAmountUsd: winner.amountUsd,
          status: "PENDING",
          note: "Auto-ranked from challenge completion",
          prevHash,
          eventHash,
          createdAt: args.now,
        });

        prevHash = eventHash;
        newlyAwardedEnrollmentIds.add(winner.enrollmentId);
      }
    }

    const keepEnrollmentIds = winners.map((w) => w.enrollmentId);
    await tx.execute(sql`
      UPDATE challenge_prize_awards
      SET status = CASE WHEN status = 'PENDING' THEN 'CANCELLED' ELSE status END,
          note = CASE WHEN status = 'PENDING' THEN 'Auto-cancelled after ranking refresh' ELSE note END
      WHERE challenge_id = ${args.challenge.id}
        AND enrollment_id NOT IN (${sql.join(keepEnrollmentIds.map((id) => sql`${id}`), sql`, `)})
    `);
  });

  return { rankByEnrollmentId, newlyAwardedEnrollmentIds };
}

function parseTierRules(raw: unknown): TierRule[] {
  const parsed = parseJsonValue(raw);
  if (!Array.isArray(parsed)) return [];

  const rules: TierRule[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const row = parsed[i] as any;
    const name = String(row?.name ?? row?.tier ?? row?.label ?? `TIER_${i + 1}`).trim();
    if (!name) continue;

    const minChallengesPassed = toPositiveInt(
      row?.minChallengesPassed ?? row?.minPasses ?? row?.passes ?? row?.requiredPasses,
      0,
    );
    const minTop3 = toPositiveInt(row?.minTop3 ?? row?.top3 ?? row?.requiredTop3, 0);
    const minAvgPnlPct = toNumber(row?.minAvgPnlPct ?? row?.minPnlPct ?? row?.requiredAvgPnlPct, 0);

    const maxDqsRaw = row?.maxDqs ?? row?.maxDisqualifications;
    const maxDqs = maxDqsRaw == null ? null : toPositiveInt(maxDqsRaw, 0);

    const order = toNumber(row?.order ?? row?.rank ?? row?.level ?? i + 1, i + 1);

    rules.push({
      name,
      minChallengesPassed,
      minTop3,
      minAvgPnlPct,
      maxDqs,
      order,
    });
  }

  rules.sort((a, b) => a.order - b.order);
  return rules;
}

function resolveProgressionTierName(args: {
  rules: TierRule[];
  challengesPassed: number;
  top3Count: number;
  avgPnlPct: number;
  totalDqs: number;
}): string {
  let best = "NONE";
  for (const rule of args.rules) {
    const passOk = args.challengesPassed >= rule.minChallengesPassed;
    const top3Ok = args.top3Count >= rule.minTop3;
    const pnlOk = args.avgPnlPct >= rule.minAvgPnlPct;
    const dqsOk = rule.maxDqs == null ? true : args.totalDqs <= rule.maxDqs;

    if (passOk && top3Ok && pnlOk && dqsOk) {
      best = rule.name;
    }
  }
  return best;
}

async function updateUserProgression(args: {
  userId: number;
  challengeProgressionTierId: number | null;
  now: number;
}): Promise<{ tierChanged: boolean; currentTier: string; planId: number | null }> {
  const [existing] = await db
    .select()
    .from(challengeUserProgression)
    .where(eq(challengeUserProgression.userId, args.userId))
    .limit(1);

  const progressionPlanId =
    Number.isInteger(args.challengeProgressionTierId) && Number(args.challengeProgressionTierId) > 0
      ? Number(args.challengeProgressionTierId)
      : Number(existing?.progressionPlanId ?? 0) > 0
        ? Number(existing?.progressionPlanId)
        : null;

  const agg = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'PASSED' THEN 1 ELSE 0 END), 0)::int AS passed_count,
      COALESCE(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0)::int AS dq_count,
      COALESCE(AVG(CASE WHEN status = 'PASSED' THEN current_pnl_pct END), 0)::float8 AS avg_pnl_pct
    FROM challenge_enrollments
    WHERE user_id = ${args.userId}
  `);
  const aggRow: any = (agg as any).rows?.[0] ?? {};

  const top3 = await db.execute(sql`
    SELECT COALESCE(COUNT(*), 0)::int AS top3_count
    FROM challenge_prize_awards
    WHERE user_id = ${args.userId}
      AND rank <= 3
      AND status IN ('PENDING', 'APPROVED', 'PAID')
  `);
  const top3Row: any = (top3 as any).rows?.[0] ?? {};

  let rules: TierRule[] = [];
  if (progressionPlanId) {
    const [plan] = await db
      .select({ tiersJson: challengeProgressionTiers.tiersJson })
      .from(challengeProgressionTiers)
      .where(eq(challengeProgressionTiers.id, progressionPlanId))
      .limit(1);
    rules = parseTierRules(plan?.tiersJson ?? "[]");
  }

  const challengesPassed = toPositiveInt(aggRow.passed_count, 0);
  const top3Count = toPositiveInt(top3Row.top3_count, 0);
  const avgPnlPct = toNumber(aggRow.avg_pnl_pct, 0);
  const totalDqs = toPositiveInt(aggRow.dq_count, 0);

  const nextTier = rules.length
    ? resolveProgressionTierName({ rules, challengesPassed, top3Count, avgPnlPct, totalDqs })
    : String(existing?.currentTier ?? "NONE");

  const prevTier = String(existing?.currentTier ?? "NONE");
  const tierChanged = prevTier !== nextTier;

  await db
    .insert(challengeUserProgression)
    .values({
      userId: args.userId,
      currentTier: nextTier,
      challengesPassed,
      top3Count,
      avgPnlPct,
      totalDqs,
      tierAdvancedAt: tierChanged ? args.now : existing?.tierAdvancedAt ?? null,
      progressionPlanId,
      updatedAt: args.now,
    })
    .onConflictDoUpdate({
      target: [challengeUserProgression.userId],
      set: {
        currentTier: nextTier,
        challengesPassed,
        top3Count,
        avgPnlPct,
        totalDqs,
        tierAdvancedAt: tierChanged ? args.now : existing?.tierAdvancedAt ?? null,
        progressionPlanId,
        updatedAt: args.now,
      },
    });

  return {
    tierChanged,
    currentTier: nextTier,
    planId: progressionPlanId,
  };
}

async function refreshChallengeLeaderboard(args: {
  challengeId: number;
  maxVisible: number;
  calculatedAt: number;
  rankingMetric: "COMPOSITE_SCORE" | "PNL_PCT";
}): Promise<void> {
  const maxVisible = Math.max(1, Math.min(500, toPositiveInt(args.maxVisible, 100) || 100));

  await db.transaction(async (tx) => {
    await tx.delete(challengeLeaderboardSnapshot).where(eq(challengeLeaderboardSnapshot.challengeId, args.challengeId));

    const ranked =
      args.rankingMetric === "PNL_PCT"
        ? await tx.execute(sql`
            WITH ranked AS (
              SELECT
                e.user_id,
                ROW_NUMBER() OVER (
                  ORDER BY
                    COALESCE(e.current_pnl_pct, 0)::float8 DESC,
                    COALESCE(e.max_total_loss_hit, e.max_daily_loss_hit, 0)::float8 ASC,
                    COALESCE(e.max_daily_loss_hit, 0)::float8 ASC,
                    COALESCE(e.completed_at, 2147483647)::int ASC,
                    e.id ASC
                )::int AS rank,
                COALESCE(e.current_pnl_pct, 0)::float8 AS pnl_pct,
                COALESCE(e.trading_days, 0)::int AS trading_days,
                e.max_daily_loss_hit::float8 AS max_daily_loss_hit,
                COALESCE(e.current_pnl_pct, 0)::float8 AS composite_score
              FROM challenge_enrollments e
              WHERE e.challenge_id = ${args.challengeId}
                AND e.status IN ('ACTIVE', 'PASSED')
            )
            SELECT *
            FROM ranked
            ORDER BY rank ASC
            LIMIT ${maxVisible}
          `)
        : await tx.execute(sql`
            WITH ranked AS (
              SELECT
                e.user_id,
                ROW_NUMBER() OVER (
                  ORDER BY
                    (
                      (CASE WHEN e.status = 'PASSED' THEN 100000 ELSE 0 END)::float8 +
                      COALESCE(e.current_phase, 1)::float8 * 1000 +
                      COALESCE(e.current_pnl_pct, 0)::float8 * 100 -
                      COALESCE(e.max_daily_loss_hit, 0)::float8 * 10
                    ) DESC,
                    COALESCE(e.max_total_loss_hit, e.max_daily_loss_hit, 0)::float8 ASC,
                    COALESCE(e.max_daily_loss_hit, 0)::float8 ASC,
                    COALESCE(e.completed_at, 2147483647)::int ASC,
                    e.id ASC
                )::int AS rank,
                COALESCE(e.current_pnl_pct, 0)::float8 AS pnl_pct,
                COALESCE(e.trading_days, 0)::int AS trading_days,
                e.max_daily_loss_hit::float8 AS max_daily_loss_hit,
                (
                  (CASE WHEN e.status = 'PASSED' THEN 100000 ELSE 0 END)::float8 +
                  COALESCE(e.current_phase, 1)::float8 * 1000 +
                  COALESCE(e.current_pnl_pct, 0)::float8 * 100 -
                  COALESCE(e.max_daily_loss_hit, 0)::float8 * 10
                )::float8 AS composite_score
              FROM challenge_enrollments e
              WHERE e.challenge_id = ${args.challengeId}
                AND e.status IN ('ACTIVE', 'PASSED')
            )
            SELECT *
            FROM ranked
            ORDER BY rank ASC
            LIMIT ${maxVisible}
          `);

    const rows = ((ranked as any).rows ?? []) as Array<any>;
    if (!rows.length) return;

    await tx.insert(challengeLeaderboardSnapshot).values(
      rows.map((row) => ({
        challengeId: args.challengeId,
        userId: Number(row.user_id),
        rank: Number(row.rank),
        pnlPct: Number(row.pnl_pct ?? 0),
        tradingDays: Number(row.trading_days ?? 0),
        maxDailyLossHit: row.max_daily_loss_hit == null ? null : Number(row.max_daily_loss_hit),
        compositeScore: row.composite_score == null ? null : Number(row.composite_score),
        calculatedAt: args.calculatedAt,
      })),
    );
  });
}

async function maybeRefreshChallengeLeaderboard(args: {
  challenge: any;
  cfg: SystemChallengeConfig;
  now: number;
  force: boolean;
}): Promise<void> {
  if (!args.cfg.challengeLeaderboardEnabled) return;
  if (!Boolean(args.challenge.leaderboardEnabled)) return;

  if (!args.force) {
    const [last] = await db
      .select({ lastCalc: sql<number>`MAX(${challengeLeaderboardSnapshot.calculatedAt})` })
      .from(challengeLeaderboardSnapshot)
      .where(eq(challengeLeaderboardSnapshot.challengeId, args.challenge.id));

    const lastCalc = Number(last?.lastCalc ?? 0);
    if (lastCalc > 0 && args.now - lastCalc < args.cfg.challengeLeaderboardRefreshSec) {
      return;
    }
  }

  await refreshChallengeLeaderboard({
    challengeId: args.challenge.id,
    maxVisible: Number(args.challenge.leaderboardMaxVisible ?? 100),
    calculatedAt: args.now,
    rankingMetric: args.cfg.challengeLeaderboardRankingMetric,
  });
}

async function applyCompletionRewards(args: {
  enrollment: any;
  challenge: any;
  stats: PhaseStats;
  cfg: SystemChallengeConfig;
  now: number;
  runId: string;
}): Promise<void> {
  const { enrollment, challenge, stats, cfg, now, runId } = args;
  const challengeName = String(challenge.name ?? `Challenge ${challenge.id}`);

  try {
    await applyCustomRewardsForTrigger({
      cfg,
      enrollment,
      challenge,
      trigger: "ON_CHALLENGE_PASS",
      now,
      runId,
      phaseNumber: Number(enrollment.currentPhase ?? 1),
    });

    if (cfg.challengeRewardsEnabled && cfg.challengeBadgesEnabled && Boolean(challenge.badgesEnabled) && challenge.badgeOnPass) {
      const badge = await awardBadge({
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        badgeRef: challenge.badgeOnPass,
        reason: "CHALLENGE_PASS",
        awardedAt: now,
      });

      if (badge.awarded) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_REWARD_BADGE",
          phaseNumber: Number(enrollment.currentPhase ?? 1),
          details: {
            kind: "PASS",
            badgeName: badge.badgeName,
          },
        }, runId);
        appendChallengeTransitionAudit({
          runId,
          userId: enrollment.userId,
          challengeId: challenge.id,
          enrollmentId: enrollment.id,
          type: "CHALLENGE_REWARD_BADGE",
          data: { kind: "PASS", badgeName: badge.badgeName },
        });

        if (cfg.challengeNotifyOnBadgeAward) {
          await createNotification({
            userId: enrollment.userId,
            type: "CHALLENGE",
            severity: "SUCCESS",
            title: "Badge awarded",
            message: badge.badgeName
              ? `You earned the ${badge.badgeName} badge for completing ${challengeName}.`
              : `You earned a new badge for completing ${challengeName}.`,
            sourceEvent: "CHALLENGE_BADGE_AWARD",
          });
        }
      }
    }

    if (cfg.challengeRewardsEnabled && cfg.challengeSelectionBoostEnabled && Boolean(challenge.selectionBoostEnabled)) {
      const configuredPoints = toNumber(challenge.selectionBoostPoints, 0);
      const fallbackPoints = toNumber(cfg.challengeDefaultSelectionBoost, 0);
      const points = configuredPoints > 0 ? configuredPoints : fallbackPoints;

      const boosted = await awardSelectionBoost({
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        points,
        reason: "CHALLENGE_PASS",
        awardedAt: now,
        createdBy: Number(challenge.createdBy ?? 0) > 0 ? Number(challenge.createdBy) : null,
      });

      if (boosted) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_REWARD_SELECTION_BOOST",
          phaseNumber: Number(enrollment.currentPhase ?? 1),
          details: { points },
        }, runId);
      }
    }

    if (cfg.challengeRewardsEnabled && cfg.challengeCertificatesEnabled && Boolean(challenge.certificateEnabled)) {
      const cert = await issueCertificate({
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        templateId:
          Number(challenge.certificateTemplateId ?? 0) > 0
            ? Number(challenge.certificateTemplateId)
            : cfg.challengeCertificateDefaultTemplateId,
        verificationKeyId: String(cfg.challengeCertificateVerificationKeyId || "v1"),
        isDownloadable: cfg.challengeCertificatesDownloadable && Boolean(challenge.certificateDownloadable),
        isShareable: cfg.challengeCertificatesShareable && Boolean(challenge.certificateShareable),
        includeMetrics: Boolean(challenge.certificateIncludeMetrics ?? cfg.challengeCertificateIncludeMetricsDefault),
        metrics: stats,
        issuedAt: now,
      });

      if (cert.issued) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_REWARD_CERTIFICATE",
          phaseNumber: Number(enrollment.currentPhase ?? 1),
          details: { certificateId: cert.certificateId },
        }, runId);
        appendChallengeTransitionAudit({
          runId,
          userId: enrollment.userId,
          challengeId: challenge.id,
          enrollmentId: enrollment.id,
          type: "CHALLENGE_REWARD_CERTIFICATE",
          data: { certificateId: cert.certificateId },
        });

        if (cfg.challengeNotifyOnCertIssue) {
          await createNotification({
            userId: enrollment.userId,
            type: "CHALLENGE",
            severity: "SUCCESS",
            title: "Certificate issued",
            message: `Your completion certificate for ${challengeName} is ready.`,
            sourceEvent: "CHALLENGE_CERTIFICATE_ISSUED",
          });
        }
      }
    }

    if (Boolean(challenge.partnerVisibilityOnPass)) {
      const promoted = await upsertPipelineVisibility({
        userId: enrollment.userId,
        challengeName,
        challengeId: challenge.id,
        createdBy: Number(challenge.createdBy ?? 0) > 0 ? Number(challenge.createdBy) : null,
        autoWatchlistTier: challenge.autoWatchlistTier,
        now,
      });

      if (promoted) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_PIPELINE_PROMOTION",
          details: { to: "WATCHLIST" },
        }, runId);
      }
    }

    const prizeTiming = resolvePrizeAwardTiming(challenge, cfg);
    const prizeCandidateMode = resolvePrizeCandidateMode(challenge, cfg);
    const rankedCandidates = await rankPrizeCandidates(challenge.id, prizeCandidateMode);
    const prizeResult =
      prizeTiming === "ON_COMPLETE"
        ? await recomputePrizeAwards({
            challenge,
            cfg,
            rankedCandidates,
            now,
          })
        : { rankByEnrollmentId: new Map<number, number>(), newlyAwardedEnrollmentIds: new Set<number>() };

    const thisRank = prizeResult.rankByEnrollmentId.get(enrollment.id) ?? null;
    if (thisRank != null) {
      await applyCustomRewardsForTrigger({
        cfg,
        enrollment,
        challenge,
        trigger: "ON_RANK_TOP_N",
        now,
        runId,
        phaseNumber: Number(enrollment.currentPhase ?? 1),
        rank: thisRank,
      });
    }

    if (thisRank != null && thisRank <= 3 && cfg.challengeRewardsEnabled && cfg.challengeBadgesEnabled && Boolean(challenge.badgesEnabled) && challenge.badgeOnTop3) {
      const top3Badge = await awardBadge({
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        badgeRef: challenge.badgeOnTop3,
        reason: `CHALLENGE_TOP_${thisRank}`,
        awardedAt: now,
      });

      if (top3Badge.awarded) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_REWARD_BADGE_TOP3",
          details: {
            rank: thisRank,
            badgeName: top3Badge.badgeName,
          },
        }, runId);
        appendChallengeTransitionAudit({
          runId,
          userId: enrollment.userId,
          challengeId: challenge.id,
          enrollmentId: enrollment.id,
          type: "CHALLENGE_REWARD_BADGE",
          data: { kind: "TOP_RANK", rank: thisRank, badgeName: top3Badge.badgeName },
        });

        if (cfg.challengeNotifyOnBadgeAward) {
          await createNotification({
            userId: enrollment.userId,
            type: "CHALLENGE",
            severity: "SUCCESS",
            title: "Top rank badge awarded",
            message: `You ranked #${thisRank} in ${challengeName}.`,
            sourceEvent: "CHALLENGE_TOP3_BADGE_AWARD",
          });
        }
      }
    }

    if (prizeTiming === "MANUAL") {
      await appendChallengeEventWithRun(
        {
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_PRIZE_MANUAL_REVIEW_REQUIRED",
          details: {
            candidateMode: prizeCandidateMode,
            timing: prizeTiming,
          },
        },
        runId,
      );
      appendChallengeTransitionAudit({
        runId,
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        type: "CHALLENGE_PRIZE_MANUAL_REVIEW_REQUIRED",
        data: { candidateMode: prizeCandidateMode },
      });
    } else if (prizeResult.newlyAwardedEnrollmentIds.has(enrollment.id) && cfg.challengeNotifyOnPrizeAward) {
      appendChallengeTransitionAudit({
        runId,
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        type: "CHALLENGE_REWARD_PRIZE",
        data: { created: true, timing: prizeTiming, candidateMode: prizeCandidateMode },
      });
      await createNotification({
        userId: enrollment.userId,
        type: "CHALLENGE",
        severity: "SUCCESS",
        title: "Prize award created",
        message: `A prize award entry has been created for your ${challengeName} completion.`,
        sourceEvent: "CHALLENGE_PRIZE_AWARD_CREATED",
      });
      await maybeSendChallengeMailboxMessage({
        cfg,
        userId: enrollment.userId,
        challengeId: challenge.id,
        enrollmentId: enrollment.id,
        sourceEvent: "CHALLENGE_PRIZE_AWARD_CREATED",
        subject: `Prize award created: ${challengeName}`,
        body: `A prize award entry has been created for your completion of ${challengeName}.`,
      });
    }

    if (cfg.challengeProgressionEnabled) {
      const progression = await updateUserProgression({
        userId: enrollment.userId,
        challengeProgressionTierId:
          Number(challenge.progressionTierId ?? 0) > 0 ? Number(challenge.progressionTierId) : null,
        now,
      });

      if (progression.tierChanged) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_PROGRESSION_TIER_UP",
          details: { tier: progression.currentTier, progressionPlanId: progression.planId },
        }, runId);

        if (cfg.challengeNotifyOnTierUp) {
          await createNotification({
            userId: enrollment.userId,
            type: "CHALLENGE",
            severity: "SUCCESS",
            title: "Progression tier advanced",
            message: `You advanced to ${progression.currentTier} after completing ${challengeName}.`,
            sourceEvent: "CHALLENGE_TIER_UP",
          });
        }
      }
    }
  } catch (error) {
    console.error("[challenges-v4] completion rewards failed:", {
      challengeId: challenge.id,
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      error,
    });
  }
}

async function notifyPrizeAwardsForChallenge(args: {
  challenge: any;
  cfg: SystemChallengeConfig;
  runId: string;
  newlyAwardedEnrollmentIds: Set<number>;
}): Promise<void> {
  if (!args.newlyAwardedEnrollmentIds.size) return;
  if (!args.cfg.challengeNotifyOnPrizeAward) return;

  const enrollmentIds = Array.from(args.newlyAwardedEnrollmentIds).slice(0, 500);
  if (!enrollmentIds.length) return;

  const rows = await db
    .select({
      id: challengeEnrollments.id,
      userId: challengeEnrollments.userId,
    })
    .from(challengeEnrollments)
    .where(inArray(challengeEnrollments.id, enrollmentIds as any));

  const challengeName = String(args.challenge?.name ?? `Challenge ${args.challenge?.id ?? ""}`);
  for (const row of rows) {
    await appendChallengeEventWithRun(
      {
        enrollmentId: Number(row.id),
        eventType: "CHALLENGE_REWARD_PRIZE",
        details: { timing: "ON_CHALLENGE_END" },
      },
      args.runId,
    );
    appendChallengeTransitionAudit({
      runId: args.runId,
      userId: Number(row.userId),
      challengeId: Number(args.challenge.id),
      enrollmentId: Number(row.id),
      type: "CHALLENGE_REWARD_PRIZE",
      data: { created: true, timing: "ON_CHALLENGE_END" },
    });

    await createNotification({
      userId: Number(row.userId),
      type: "CHALLENGE",
      severity: "SUCCESS",
      title: "Prize award created",
      message: `A prize award entry has been created for your ${challengeName} completion.`,
      sourceEvent: "CHALLENGE_PRIZE_AWARD_CREATED",
    });
    await maybeSendChallengeMailboxMessage({
      cfg: args.cfg,
      userId: Number(row.userId),
      challengeId: Number(args.challenge.id),
      enrollmentId: Number(row.id),
      sourceEvent: "CHALLENGE_PRIZE_AWARD_CREATED",
      subject: `Prize award created: ${challengeName}`,
      body: `A prize award entry has been created for your completion of ${challengeName}.`,
    });
  }
}

export async function computePhaseStats(args: {
  userId: number;
  startAt: number;
  endAt: number;
  capitalBase: number;
}): Promise<PhaseStats> {
  const { userId, startAt, endAt, capitalBase } = args;

  const q = await db.execute(sql`
    WITH t AS (
      SELECT
        tr.id AS id,
        tr.closed_at AS closed_at,
        COALESCE(
          tr.net_profit_usd::numeric,
          CASE
            WHEN tr.profit IS NULL OR btrim(tr.profit) = '' THEN 0::numeric
            WHEN tr.profit ~ '^-?\\d+(\\.\\d+)?$' THEN tr.profit::numeric
            ELSE 0::numeric
          END
        )::float8 AS net_profit,
        (to_timestamp(tr.closed_at)::date) AS d
      FROM trades tr
      WHERE tr.user_id = ${userId}
        AND tr.status = 'CLOSED'
        AND tr.closed_at IS NOT NULL
        AND tr.closed_at >= ${startAt}
        AND tr.closed_at <= ${endAt}
    ),
    daily AS (
      SELECT d, SUM(net_profit) AS pnl
      FROM t
      GROUP BY d
    ),
    equity AS (
      SELECT
        id,
        closed_at,
        net_profit,
        ROW_NUMBER() OVER (ORDER BY closed_at, id) AS seq,
        SUM(net_profit) OVER (ORDER BY closed_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
      FROM t
    ),
    eq2 AS (
      SELECT
        closed_at,
        cum,
        MAX(cum) OVER (ORDER BY closed_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak_cum
      FROM equity
    )
    SELECT
      COALESCE((SELECT SUM(net_profit) FROM t), 0) AS total_pnl,
      COALESCE((SELECT COUNT(DISTINCT d)::int FROM daily), 0) AS trading_days,
      COALESCE((SELECT MIN(pnl) FROM daily), 0) AS worst_day_pnl,
      COALESCE((SELECT MAX(pnl) FROM daily), 0) AS best_day_pnl,
      COALESCE((SELECT MIN(cum) FROM equity), 0) AS min_cum,
      COALESCE((SELECT MAX(peak_cum) FROM eq2), 0) AS peak_cum,
      COALESCE((SELECT MAX((peak_cum - cum) / NULLIF((${capitalBase} + peak_cum), 0)) FROM eq2), 0) AS trailing_dd,
      COALESCE((SELECT COUNT(*)::int FROM t), 0) AS trade_count,
      COALESCE((SELECT MIN(closed_at)::bigint FROM t), 0) AS first_trade_at,
      COALESCE((SELECT MAX(closed_at)::bigint FROM t), 0) AS last_trade_at,
      COALESCE((SELECT SUM(ROUND(net_profit * 100000)::bigint) FROM t), 0)::bigint AS pnl_scaled_sum,
      COALESCE((
        SELECT SUM(
          (
            (closed_at::bigint * 31) +
            (ROUND(net_profit * 100000)::bigint * 17) +
            (seq::bigint * 13)
          )::bigint
        )
        FROM equity
      ), 0)::bigint AS seq_signature_a,
      COALESCE((
        SELECT SUM(
          (
            (ROUND(cum * 100000)::bigint * 19) +
            (seq::bigint * 7)
          )::bigint
        )
        FROM equity
      ), 0)::bigint AS seq_signature_b
  `);

  const row: any = (q as any).rows?.[0] ?? {};

  const totalPnl = roundDeterministic(Number(row.total_pnl ?? 0));
  const tradingDays = Math.max(0, Math.trunc(Number(row.trading_days ?? 0)));
  const worstDayPnl = roundDeterministic(Number(row.worst_day_pnl ?? 0));
  const bestDayPnl = roundDeterministic(Number(row.best_day_pnl ?? 0));
  const minCum = roundDeterministic(Number(row.min_cum ?? 0));
  const peakCum = roundDeterministic(Number(row.peak_cum ?? 0));
  const trailingDd = roundDeterministic(Number(row.trailing_dd ?? 0));
  const tradeCount = Math.max(0, Math.trunc(Number(row.trade_count ?? 0)));

  const pnlPct = roundDeterministic(capitalBase > 0 ? totalPnl / capitalBase : 0);
  const worstDayLossPct = roundDeterministic(capitalBase > 0 ? Math.max(0, -worstDayPnl / capitalBase) : 0);
  const bestDayProfitPct = roundDeterministic(capitalBase > 0 ? Math.max(0, bestDayPnl / capitalBase) : 0);
  const startDdPct = roundDeterministic(capitalBase > 0 ? Math.max(0, -minCum / capitalBase) : 0);
  const trailingDdPct = roundDeterministic(Math.max(0, trailingDd));
  const peakEquity = roundDeterministic(capitalBase + peakCum);

  const inputHash = chainHash(null, {
    basis: "REALIZED_ONLY",
    roundingMode: "HALF_AWAY_FROM_ZERO_8DP",
    userId,
    startAt,
    endAt,
    capitalBase: roundDeterministic(capitalBase),
    tradeCount,
    firstTradeAt: Math.max(0, Math.trunc(Number(row.first_trade_at ?? 0))),
    lastTradeAt: Math.max(0, Math.trunc(Number(row.last_trade_at ?? 0))),
    pnlScaledSum: String(row.pnl_scaled_sum ?? "0"),
    seqSignatureA: String(row.seq_signature_a ?? "0"),
    seqSignatureB: String(row.seq_signature_b ?? "0"),
  });

  return {
    pnlBasis: "REALIZED_ONLY",
    roundingMode: "HALF_AWAY_FROM_ZERO_8DP",
    inputHash,
    tradeCount,
    totalPnl,
    pnlPct,
    tradingDays,
    worstDayLossPct,
    bestDayProfitPct,
    startDdPct,
    trailingDdPct,
    peakEquity,
  };
}

async function persistPhaseSnapshot(args: {
  enrollmentId: number;
  challengeId: number;
  userId: number;
  phaseNumber: number;
  runId: string;
  computedAt: number;
  stats: PhaseStats;
}) {
  await db
    .insert(challengePhaseSnapshots)
    .values({
      enrollmentId: args.enrollmentId,
      challengeId: args.challengeId,
      userId: args.userId,
      phaseNumber: args.phaseNumber,
      runId: args.runId,
      pnlBasis: args.stats.pnlBasis,
      roundingMode: args.stats.roundingMode,
      inputHash: args.stats.inputHash,
      tradeCount: args.stats.tradeCount,
      totalPnl: args.stats.totalPnl,
      pnlPct: args.stats.pnlPct,
      tradingDays: args.stats.tradingDays,
      worstDayLossPct: args.stats.worstDayLossPct,
      bestDayProfitPct: args.stats.bestDayProfitPct,
      startDdPct: args.stats.startDdPct,
      trailingDdPct: args.stats.trailingDdPct,
      peakEquity: args.stats.peakEquity,
      computedAt: args.computedAt,
      createdAt: args.computedAt,
    })
    .onConflictDoNothing();
}

function nearLimit(hit: number, limit: number, thresholdPct: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  const threshold = Math.max(0, Math.min(1, thresholdPct));
  const warnAt = limit * threshold;
  return hit >= warnAt && hit < limit;
}

export async function evaluateChallengesTick(options?: { batchSize?: number; runId?: string }): Promise<EvalResult> {
  const batchSize = options?.batchSize ?? 500;
  const emptyResult: EvalResult = { processed: 0, advanced: 0, passed: 0, failed: 0, warned: 0 };
  const runStartedAt = nowSec();
  const runId = String(options?.runId ?? "").trim() || buildEvalRunId(runStartedAt);
  let runInserted = false;
  let lockAcquired = false;

  const finishRun = async (status: "SUCCESS" | "FAILED", result: EvalResult, error?: unknown) => {
    if (!runInserted) return;
    await db
      .update(challengeEvaluationRuns)
      .set({
        status,
        endedAt: nowSec(),
        processedCount: result.processed,
        advancedCount: result.advanced,
        passedCount: result.passed,
        failedCount: result.failed,
        warnedCount: result.warned,
        errorJson: error ? stableStringify({ message: String((error as any)?.message ?? error), error }) : null,
      })
      .where(eq(challengeEvaluationRuns.runId, runId));
  };

  try {
    const lockRow = await db.execute(sql`SELECT pg_try_advisory_lock(${EVALUATION_RUN_LOCK_KEY}) AS locked`);
    lockAcquired = Boolean((lockRow as any).rows?.[0]?.locked);
    if (!lockAcquired) {
      await db
        .insert(challengeEvaluationRuns)
        .values({
          runId,
          status: "SKIPPED_LOCK",
          startedAt: runStartedAt,
          endedAt: runStartedAt,
          createdAt: runStartedAt,
        })
        .onConflictDoNothing();
      return emptyResult;
    }

    await db
      .insert(challengeEvaluationRuns)
      .values({
        runId,
        status: "RUNNING",
        startedAt: runStartedAt,
        createdAt: runStartedAt,
      })
      .onConflictDoNothing();
    runInserted = true;

    const cfg = await getSystemChallengeConfig();

    if (!cfg.traderCompeteEnabled || !cfg.challengeEvalEnabled) {
      await finishRun("SUCCESS", emptyResult);
      return emptyResult;
    }

    const now = nowSec();

  const enrolls = await db
    .select({
      enrollment: challengeEnrollments,
      challenge: challenges,
    })
    .from(challengeEnrollments)
    .innerJoin(challenges, eq(challengeEnrollments.challengeId, challenges.id))
    .where(and(eq(challengeEnrollments.status, "ACTIVE"), eq(challenges.isActive, true)))
    .orderBy(asc(challengeEnrollments.updatedAt))
    .limit(batchSize);

    if (!enrolls.length) {
      await finishRun("SUCCESS", emptyResult);
      return emptyResult;
    }

  const challengeIds = Array.from(new Set(enrolls.map((r) => r.challenge.id)));
  const challengeById = new Map<number, any>();
  for (const row of enrolls) challengeById.set(row.challenge.id, row.challenge);

  const phases = await db.select().from(challengePhases).where(inArray(challengePhases.challengeId, challengeIds));

  let processed = 0;
  let advanced = 0;
  let passed = 0;
  let failed = 0;
  let warned = 0;

  const touchedChallenges = new Set<number>();
  const forceLeaderboardRefresh = new Set<number>();

  for (const r of enrolls) {
    processed += 1;

    const enrollment = r.enrollment as any;
    const challenge = r.challenge as any;
    touchedChallenges.add(challenge.id);

    try {
      const currentPhase = Number(enrollment.currentPhase ?? 1);
      const phase = phases.find((p) => p.challengeId === challenge.id && p.phaseNumber === currentPhase);
      const phaseRules = phase ?? getPhaseForEnrollment({ ...challenge, phases: [] } as any, currentPhase);

      const phaseStart = Number(enrollment.phaseStartedAt ?? enrollment.enrolledAt ?? now);
      const durationDays = Number((phaseRules as any).durationDays ?? challenge.durationDays ?? 0);
      const phaseDeadline = durationDays > 0 ? phaseStart + durationDays * 86400 : null;
      const evalEnd = phaseDeadline ? Math.min(now, phaseDeadline) : now;

      const capitalBaseRaw = Number(enrollment.capitalBaseUsed ?? challenge.virtualCapitalUsd ?? 100000);
      const capitalBase = Number.isFinite(capitalBaseRaw) && capitalBaseRaw > 0 ? capitalBaseRaw : 100000;

      const stats = await computePhaseStats({
        userId: enrollment.userId,
        startAt: phaseStart,
        endAt: evalEnd,
        capitalBase,
      });
      await persistPhaseSnapshot({
        enrollmentId: enrollment.id,
        challengeId: challenge.id,
        userId: enrollment.userId,
        phaseNumber: currentPhase,
        runId,
        computedAt: now,
        stats,
      });

      const profitTarget = Number((phaseRules as any).profitTargetPct ?? challenge.profitTargetPct ?? 0);
      const maxDailyLoss = Number((phaseRules as any).maxDailyLossPct ?? challenge.maxDailyLossPct ?? 1);
      const maxTotalLoss = Number((phaseRules as any).maxTotalLossPct ?? challenge.maxTotalLossPct ?? 1);
      const drawdownType = String((phaseRules as any).drawdownType ?? cfg.challengeDefaultDrawdownType ?? "STATIC").toUpperCase();
      const totalDdHit = drawdownType === "TRAILING" ? stats.trailingDdPct : stats.startDdPct;
      const minTradingDays = Number((phaseRules as any).minTradingDays ?? challenge.minTradingDays ?? 0);
      const maxSingleDayProfit =
        (phaseRules as any).maxSingleDayProfitPct == null ? null : Number((phaseRules as any).maxSingleDayProfitPct);

      const restricted = parseCsvSet((phaseRules as any).restrictedSymbolsCsv);
      const restrictedHit = restricted.size
        ? await hasRestrictedSymbolTrade(enrollment.userId, phaseStart, evalEnd, restricted)
        : false;

      const dailyBreach = maxDailyLoss > 0 && stats.worstDayLossPct >= maxDailyLoss;
      const totalBreach = maxTotalLoss > 0 && totalDdHit >= maxTotalLoss;
      const consistencyBreach = maxSingleDayProfit != null && stats.bestDayProfitPct > maxSingleDayProfit;

      const targetHit = profitTarget <= 0 ? true : stats.pnlPct >= profitTarget;
      const daysOk = minTradingDays <= 0 ? true : stats.tradingDays >= minTradingDays;
      const timeoutFail = Boolean(phaseDeadline && now > phaseDeadline && !(targetHit && daysOk));

      const nowUpdate: any = {
        currentPnlPct: stats.pnlPct,
        tradingDays: stats.tradingDays,
        maxDailyLossHit: stats.worstDayLossPct,
        maxTotalLossHit: totalDdHit,
        peakEquity: stats.peakEquity,
        updatedAt: now,
      };

      const ruleBreach = dailyBreach || totalBreach || consistencyBreach || restrictedHit;
      if (ruleBreach || timeoutFail) {
        const reason = dailyBreach
          ? "MAX_DAILY_LOSS_BREACH"
          : totalBreach
            ? "MAX_TOTAL_LOSS_BREACH"
            : consistencyBreach
              ? "CONSISTENCY_RULE_BREACH"
              : restrictedHit
                ? "RESTRICTED_SYMBOL_BREACH"
                : "DEADLINE_EXPIRED";
        const breachPolicy = timeoutFail ? "FAIL" : resolveBreachPolicy(challenge, cfg);

        if (!timeoutFail && breachPolicy === "BREACH_AND_CONTINUE") {
          await db
            .update(challengeEnrollments)
            .set({
              ...nowUpdate,
              lastWarningEvent: `CHALLENGE_BREACH_CONTINUE_${reason}`,
              lastWarningAt: now,
            })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun(
            {
              enrollmentId: enrollment.id,
              eventType: `CHALLENGE_BREACH_CONTINUE_${reason}`,
              phaseNumber: currentPhase,
              details: {
                pnlInputHash: stats.inputHash,
                breachPolicy,
                reason,
                pnlPct: stats.pnlPct,
                tradingDays: stats.tradingDays,
                worstDayLossPct: stats.worstDayLossPct,
                totalDdHit,
                bestDayProfitPct: stats.bestDayProfitPct,
              },
            },
            runId,
          );
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_BREACH_CONTINUED",
            data: { reason, phaseNumber: currentPhase, breachPolicy },
          });

          if (cfg.challengeNotifyOnBreach) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "WARNING",
              title: "Challenge rule breached",
              message: `A breach was recorded in Phase ${currentPhase} of ${challenge.name}, but progression remains active (${reason}).`,
              sourceEvent: `CHALLENGE_BREACH_CONTINUE_${reason}`,
            });
          }

          warned += 1;
          continue;
        }

        if (!timeoutFail && breachPolicy === "MANUAL_REVIEW" && cfg.challengeManualReviewEnabled) {
          await db
            .update(challengeEnrollments)
            .set({ ...nowUpdate, status: "REVIEW_REQUIRED", completedAt: now })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun(
            {
              enrollmentId: enrollment.id,
              eventType: "CHALLENGE_REVIEW_REQUIRED",
              phaseNumber: currentPhase,
              details: {
                pnlInputHash: stats.inputHash,
                breachPolicy,
                reason,
                pnlPct: stats.pnlPct,
                tradingDays: stats.tradingDays,
                worstDayLossPct: stats.worstDayLossPct,
                totalDdHit,
                bestDayProfitPct: stats.bestDayProfitPct,
                phaseDeadline,
              },
            },
            runId,
          );
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_REVIEW_REQUIRED",
            data: { reason, phaseNumber: currentPhase, breachPolicy },
          });

          if (cfg.challengeNotifyOnBreach) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "WARNING",
              title: "Challenge under review",
              message: `Your ${challenge.name} enrollment is now in manual review (${reason}).`,
              sourceEvent: "CHALLENGE_REVIEW_REQUIRED",
            });
            await maybeSendChallengeMailboxMessage({
              cfg,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              sourceEvent: "CHALLENGE_REVIEW_REQUIRED",
              subject: `Manual review required: ${challenge.name}`,
              body: `Your enrollment was moved to manual review in Phase ${currentPhase} (${reason}).`,
            });
          }

          warned += 1;
          forceLeaderboardRefresh.add(challenge.id);
          continue;
        }

        await db
          .update(challengeEnrollments)
          .set({ ...nowUpdate, status: "FAILED", completedAt: now })
          .where(eq(challengeEnrollments.id, enrollment.id));

        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: `CHALLENGE_FAIL_${reason}`,
          phaseNumber: currentPhase,
          details: {
            pnlInputHash: stats.inputHash,
            breachPolicy,
            pnlPct: stats.pnlPct,
            tradingDays: stats.tradingDays,
            worstDayLossPct: stats.worstDayLossPct,
            totalDdHit,
            bestDayProfitPct: stats.bestDayProfitPct,
            profitTarget,
            maxDailyLoss,
            maxTotalLoss,
            maxSingleDayProfit,
            restrictedSymbols: restricted.size ? Array.from(restricted).slice(0, 50) : [],
            phaseDeadline,
          },
          pnlSnapshotPct: stats.pnlPct,
          dailyLossSnapshot: stats.worstDayLossPct,
          totalDdSnapshot: totalDdHit,
          tradingDaysSnapshot: stats.tradingDays,
        }, runId);
        appendChallengeTransitionAudit({
          runId,
          userId: enrollment.userId,
          challengeId: challenge.id,
          enrollmentId: enrollment.id,
          type: "CHALLENGE_FAILED",
          data: { reason, phaseNumber: currentPhase, breachPolicy },
        });

        if (cfg.challengeNotifyOnFail || cfg.challengeNotifyOnBreach) {
          await createNotification({
            userId: enrollment.userId,
            type: "CHALLENGE",
            severity: "WARNING",
            title: "Challenge failed",
            message: `You breached a rule in Phase ${currentPhase} of ${challenge.name} (${reason}).`,
            sourceEvent: `CHALLENGE_FAIL_${reason}`,
          });
          await maybeSendChallengeMailboxMessage({
            cfg,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            sourceEvent: `CHALLENGE_FAIL_${reason}`,
            subject: `Challenge failed: ${challenge.name}`,
            body: `Phase ${currentPhase} failed due to ${reason}. Review your timeline for details.`,
          });
        }

        failed += 1;
        forceLeaderboardRefresh.add(challenge.id);
        continue;
      }

      if (targetHit && daysOk) {
        await appendChallengeEventWithRun({
          enrollmentId: enrollment.id,
          eventType: "CHALLENGE_PHASE_PASS",
          phaseNumber: currentPhase,
          details: { pnlInputHash: stats.inputHash, pnlPct: stats.pnlPct, tradingDays: stats.tradingDays },
          pnlSnapshotPct: stats.pnlPct,
          dailyLossSnapshot: stats.worstDayLossPct,
          totalDdSnapshot: totalDdHit,
          tradingDaysSnapshot: stats.tradingDays,
        }, runId);
        appendChallengeTransitionAudit({
          runId,
          userId: enrollment.userId,
          challengeId: challenge.id,
          enrollmentId: enrollment.id,
          type: "CHALLENGE_PHASE_PASS",
          data: { phaseNumber: currentPhase },
        });
        await applyCustomRewardsForTrigger({
          cfg,
          enrollment,
          challenge,
          trigger: "ON_PHASE_PASS",
          now,
          runId,
          phaseNumber: currentPhase,
        });

        const maxPhase = phases
          .filter((p) => p.challengeId === challenge.id)
          .reduce((acc, p) => Math.max(acc, p.phaseNumber), 1);

        if (currentPhase >= maxPhase) {
          await db
            .update(challengeEnrollments)
            .set({ ...nowUpdate, status: "PASSED", completedAt: now, lastWarningEvent: null, lastWarningAt: null })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun({
            enrollmentId: enrollment.id,
            eventType: "CHALLENGE_COMPLETE",
            phaseNumber: currentPhase,
            details: {
              pnlInputHash: stats.inputHash,
              pnlPct: stats.pnlPct,
              tradingDays: stats.tradingDays,
              maxPhase,
            },
            pnlSnapshotPct: stats.pnlPct,
            dailyLossSnapshot: stats.worstDayLossPct,
            totalDdSnapshot: totalDdHit,
            tradingDaysSnapshot: stats.tradingDays,
          }, runId);
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_COMPLETE",
            data: { phaseNumber: currentPhase, maxPhase },
          });

          if (cfg.challengeNotifyOnComplete) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "SUCCESS",
              title: "Challenge completed",
              message: `You completed ${challenge.name}.`,
              sourceEvent: "CHALLENGE_COMPLETE",
            });
            await maybeSendChallengeMailboxMessage({
              cfg,
              userId: enrollment.userId,
              challengeId: challenge.id,
              enrollmentId: enrollment.id,
              sourceEvent: "CHALLENGE_COMPLETE",
              subject: `Challenge completed: ${challenge.name}`,
              body: `Congratulations. You completed ${challenge.name} at phase ${currentPhase}. Rewards are being processed.`,
            });
          }

          await applyCompletionRewards({
            enrollment,
            challenge,
            stats,
            cfg,
            now,
            runId,
          });

          passed += 1;
          forceLeaderboardRefresh.add(challenge.id);
          continue;
        }

        if (cfg.challengeAutoAdvancePhase) {
          const nextPhase = currentPhase + 1;
          await db
            .update(challengeEnrollments)
            .set({
              ...nowUpdate,
              currentPhase: nextPhase,
              phaseStartedAt: now,
              lastWarningEvent: null,
              lastWarningAt: null,
            })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun({
            enrollmentId: enrollment.id,
            eventType: "CHALLENGE_PHASE_ADVANCE",
            phaseNumber: nextPhase,
            details: { fromPhase: currentPhase, toPhase: nextPhase },
          }, runId);
          appendChallengeTransitionAudit({
            runId,
            userId: enrollment.userId,
            challengeId: challenge.id,
            enrollmentId: enrollment.id,
            type: "CHALLENGE_PHASE_ADVANCE",
            data: { fromPhase: currentPhase, toPhase: nextPhase },
          });

          if (cfg.challengeNotifyOnPhasePass) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "SUCCESS",
              title: "Phase passed",
              message: `You passed Phase ${currentPhase} of ${challenge.name}.`,
              sourceEvent: "CHALLENGE_PHASE_PASS",
            });
          }

          advanced += 1;
          forceLeaderboardRefresh.add(challenge.id);
          continue;
        }
      }

      const warnDaily = nearLimit(stats.worstDayLossPct, maxDailyLoss, cfg.challengeWarningThresholdPct);
      const warnTotal = nearLimit(totalDdHit, maxTotalLoss, cfg.challengeWarningThresholdPct);
      if (warnDaily || warnTotal) {
        const warningEvent = warnDaily ? "CHALLENGE_WARN_DAILY" : "CHALLENGE_WARN_TOTAL";
        const lastEvent = String(enrollment.lastWarningEvent ?? "");

        if (lastEvent !== warningEvent) {
          await db
            .update(challengeEnrollments)
            .set({ ...nowUpdate, lastWarningEvent: warningEvent, lastWarningAt: now })
            .where(eq(challengeEnrollments.id, enrollment.id));

          await appendChallengeEventWithRun({
            enrollmentId: enrollment.id,
            eventType: warningEvent,
            phaseNumber: currentPhase,
            details: {
              pnlInputHash: stats.inputHash,
              maxDailyLoss,
              maxTotalLoss,
              totalDdHit,
              worstDayLossPct: stats.worstDayLossPct,
            },
            pnlSnapshotPct: stats.pnlPct,
            dailyLossSnapshot: stats.worstDayLossPct,
            totalDdSnapshot: totalDdHit,
            tradingDaysSnapshot: stats.tradingDays,
          }, runId);

          if (cfg.challengeNotifyOnPhaseWarning) {
            await createNotification({
              userId: enrollment.userId,
              type: "CHALLENGE",
              severity: "INFO",
              title: "Challenge warning",
              message: `You're close to a risk limit in Phase ${currentPhase} of ${challenge.name}.`,
              sourceEvent: warningEvent,
            });
          }

          warned += 1;
        } else {
          await db.update(challengeEnrollments).set(nowUpdate).where(eq(challengeEnrollments.id, enrollment.id));
        }
      } else {
        await db
          .update(challengeEnrollments)
          .set({ ...nowUpdate, lastWarningEvent: null, lastWarningAt: null })
          .where(eq(challengeEnrollments.id, enrollment.id));
      }
    } catch (error) {
      console.error("[challenges-v4] evaluation row failed:", {
        enrollmentId: enrollment.id,
        challengeId: challenge.id,
        error,
      });
    }
  }

  for (const challengeId of touchedChallenges) {
    try {
      const challenge = challengeById.get(challengeId);
      if (!challenge) continue;

      const prizeTiming = resolvePrizeAwardTiming(challenge, cfg);
      if (prizeTiming !== "ON_CHALLENGE_END") continue;

      const endAt = Number(challenge.endAt ?? 0);
      if (!Number.isFinite(endAt) || endAt <= 0 || now < endAt) continue;

      const prizeCandidateMode = resolvePrizeCandidateMode(challenge, cfg);
      const rankedCandidates = await rankPrizeCandidates(challengeId, prizeCandidateMode);
      const prizeResult = await recomputePrizeAwards({
        challenge,
        cfg,
        rankedCandidates,
        now,
      });
      await notifyPrizeAwardsForChallenge({
        challenge,
        cfg,
        runId,
        newlyAwardedEnrollmentIds: prizeResult.newlyAwardedEnrollmentIds,
      });
    } catch (error) {
      console.error("[challenges-v4] challenge-end prize processing failed:", {
        runId,
        challengeId,
        error,
      });
    }
  }

  for (const challengeId of touchedChallenges) {
    try {
      const challenge = challengeById.get(challengeId);
      if (!challenge) continue;

      await maybeRefreshChallengeLeaderboard({
        challenge,
        cfg,
        now,
        force: forceLeaderboardRefresh.has(challengeId),
      });
    } catch (error) {
      console.error("[challenges-v4] leaderboard refresh failed:", {
        challengeId,
        error,
      });
    }
  }

    const result: EvalResult = { processed, advanced, passed, failed, warned };
    await finishRun("SUCCESS", result);
    return result;
  } catch (error) {
    console.error("[challenges-v4] evaluation run failed:", { runId, error });
    await finishRun("FAILED", emptyResult, error);
    return emptyResult;
  } finally {
    if (lockAcquired) {
      await db.execute(sql`SELECT pg_advisory_unlock(${EVALUATION_RUN_LOCK_KEY})`);
    }
  }
}
