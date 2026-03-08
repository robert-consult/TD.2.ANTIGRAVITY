import { db } from "@db";
import { nowSec } from "@shared/scalars";
import {
  challengeEnrollments,
  challengePhases,
  challenges,
  recruitingPipeline,
  symbolConfigs,
  trades,
  userVerification,
  users,
} from "@shared/schema";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getSystemChallengeConfig } from "./challengeConfig";

export { nowSec };

export type ChallengeRow = typeof challenges.$inferSelect;
export type PhaseRow = typeof challengePhases.$inferSelect;
export type EnrollmentRow = typeof challengeEnrollments.$inferSelect;

export type ChallengeWithPhases = ChallengeRow & { phases: PhaseRow[] };

export function parseCsvSet(csv?: string | null): Set<string> {
  if (!csv) return new Set();
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toUpperCase()),
  );
}

export async function getChallengeWithPhases(challengeId: number): Promise<ChallengeWithPhases | null> {
  const [c] = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
  if (!c) return null;
  const phases = await db
    .select()
    .from(challengePhases)
    .where(eq(challengePhases.challengeId, challengeId))
    .orderBy(asc(challengePhases.phaseNumber));
  return Object.assign({}, c, { phases });
}

export function getPhaseForEnrollment(c: ChallengeWithPhases, phaseNumber: number): PhaseRow {
  const p = c.phases.find((x) => x.phaseNumber === phaseNumber);
  if (p) return p;

  // Fallback to legacy single-phase config in challenges.
  return {
    id: -1,
    challengeId: c.id,
    phaseNumber,
    phaseName: `Phase ${phaseNumber}`,
    profitTargetPct: c.profitTargetPct,
    maxDailyLossPct: c.maxDailyLossPct,
    maxTotalLossPct: c.maxTotalLossPct,
    drawdownType: "STATIC",
    durationDays: c.durationDays,
    minTradingDays: c.minTradingDays,
    maxSingleDayProfitPct: null,
    allowWeekendHolding: true,
    allowNewsTrading: true,
    restrictedSymbolsCsv: "",
    maxConcurrentPositions: null,
    maxLotSize: null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  } as any;
}

export async function listVisibleChallengesForTrader(userId: number): Promise<any[]> {
  const cfg = await getSystemChallengeConfig();
  if (!cfg.traderCompeteEnabled) return [];
  const now = nowSec();

  const rows = await db
    .select({
      challenge: challenges,
      activeEnrollments: sql<number>`(
        SELECT COUNT(*)::int FROM challenge_enrollments ce
        WHERE ce.challenge_id = challenges.id AND ce.status = 'ACTIVE'
      )`,
      totalEnrollments: sql<number>`(
        SELECT COUNT(*)::int FROM challenge_enrollments ce
        WHERE ce.challenge_id = challenges.id
      )`,
      myEnrollmentId: sql<number | null>`(
        SELECT ce.id FROM challenge_enrollments ce
        WHERE ce.challenge_id = challenges.id AND ce.user_id = ${userId}
        ORDER BY ce.id DESC LIMIT 1
      )`,
      myStatus: sql<string | null>`(
        SELECT ce.status FROM challenge_enrollments ce
        WHERE ce.challenge_id = challenges.id AND ce.user_id = ${userId}
        ORDER BY ce.id DESC LIMIT 1
      )`,
      myPhase: sql<number | null>`(
        SELECT ce.current_phase FROM challenge_enrollments ce
        WHERE ce.challenge_id = challenges.id AND ce.user_id = ${userId}
        ORDER BY ce.id DESC LIMIT 1
      )`,
    })
    .from(challenges)
    .where(
      and(
        eq(challenges.isActive, true),
        eq(challenges.visibleToTraders, true),
        or(isNull(challenges.enrollmentStartAt), lte(challenges.enrollmentStartAt, now)),
        or(isNull(challenges.enrollmentEndAt), gte(challenges.enrollmentEndAt, now)),
      ),
    )
    .orderBy(asc(challenges.featuredOrder), desc(challenges.updatedAt));

  return rows.map((r) => ({
    ...r.challenge,
    activeEnrollments: r.activeEnrollments,
    totalEnrollments: r.totalEnrollments,
    myEnrollmentId: r.myEnrollmentId,
    myStatus: r.myStatus,
    myPhase: r.myPhase,
  }));
}

export async function getUserBasics(userId: number): Promise<{
  id: number;
  equity: number;
  emailVerifiedAt: number | null;
  smsVerifiedAt: number | null;
  kycStatus: string | null;
  userTier: string | null;
  contenderTier: string | null;
  pipelineStage: string | null;
}> {
  const [u] = await db
    .select({
      id: users.id,
      equity: users.equity,
      emailVerifiedAt: userVerification.emailVerifiedAt,
      smsVerifiedAt: userVerification.smsVerifiedAt,
      kycStatus: users.kycStatus,
      userTier: users.userTier,
      contenderTier: userVerification.contenderTier,
      pipelineStage: recruitingPipeline.stage,
    })
    .from(users)
    .leftJoin(userVerification, eq(userVerification.userId, users.id))
    .leftJoin(recruitingPipeline, eq(recruitingPipeline.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!u) throw new Error("USER_NOT_FOUND");
  return {
    id: u.id,
    equity: Number(u.equity ?? 0),
    emailVerifiedAt: (u as any).emailVerifiedAt ?? null,
    smsVerifiedAt: (u as any).smsVerifiedAt ?? null,
    kycStatus: (u as any).kycStatus ?? null,
    userTier: (u as any).userTier ?? null,
    contenderTier: (u as any).contenderTier ?? null,
    pipelineStage: (u as any).pipelineStage ?? null,
  };
}

export type EligibilityCheckResult = { ok: true } | { ok: false; reason: string };

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
      // not JSON, treat as enum-like mode
    }
    return { mode: trimmed.toUpperCase(), json: {} };
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { mode: "JSON", json: raw as Record<string, unknown> };
  }

  return { mode: "NONE", json: {} };
}

export async function checkEligibilityForChallenge(userId: number, challenge: ChallengeRow): Promise<EligibilityCheckResult> {
  const cfg = await getSystemChallengeConfig();
  if (!cfg.traderCompeteEnabled) return { ok: false, reason: "COMPETE_DISABLED" };

  const now = nowSec();
  if (!challenge.isActive || !challenge.visibleToTraders) return { ok: false, reason: "CHALLENGE_NOT_ACTIVE" };
  if (challenge.enrollmentStartAt != null && now < challenge.enrollmentStartAt) return { ok: false, reason: "ENROLLMENT_NOT_OPEN" };
  if (challenge.enrollmentEndAt != null && now > challenge.enrollmentEndAt) return { ok: false, reason: "ENROLLMENT_CLOSED" };

  const u = await getUserBasics(userId);
  const gate = parseEligibilityGate((challenge as any).eligibilityGate);

  if (gate.mode === "EMAIL_VERIFIED" && !u.emailVerifiedAt) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
  if (gate.mode === "CONTENDER" && String(u.contenderTier ?? "NONE").toUpperCase() === "NONE") {
    return { ok: false, reason: "NOT_A_CONTENDER" };
  }
  if (gate.mode === "ADMIN_APPROVED") {
    const isPerformer = String(u.userTier ?? "").toUpperCase() === "PERFORMER";
    const hasPipeline = Boolean(u.pipelineStage);
    if (!isPerformer && !hasPipeline) return { ok: false, reason: "NOT_ADMIN_APPROVED" };
  }

  if (gate.mode === "JSON") {
    if (gate.json.requireEmailVerified && !u.emailVerifiedAt) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };
    if (gate.json.requireSmsVerified && !u.smsVerifiedAt) return { ok: false, reason: "SMS_NOT_VERIFIED" };
    if (gate.json.requireKycApproved && String(u.kycStatus || "").toLowerCase() !== "approved") {
      return { ok: false, reason: "KYC_NOT_APPROVED" };
    }
  }

  if ((challenge as any).maxEnrollments != null) {
    const [{ c }] = await db
      .select({ c: count() })
      .from(challengeEnrollments)
      .where(eq(challengeEnrollments.challengeId, challenge.id));
    if (Number(c) >= Number((challenge as any).maxEnrollments)) {
      return { ok: false, reason: "MAX_ENROLLMENTS_REACHED" };
    }
  }

  if ((challenge as any).maxActiveEnrollments != null) {
    const [{ c }] = await db
      .select({ c: count() })
      .from(challengeEnrollments)
      .where(and(eq(challengeEnrollments.challengeId, challenge.id), eq(challengeEnrollments.status, "ACTIVE")));
    if (Number(c) >= Number((challenge as any).maxActiveEnrollments)) {
      return { ok: false, reason: "MAX_ACTIVE_ENROLLMENTS_REACHED" };
    }
  }

  return { ok: true };
}

export function computeEnrollmentCapitalBase(
  challenge: ChallengeRow,
  userEquity: number,
): { snapshotEquity: number | null; capitalBaseUsed: number } {
  const capitalMode = String((challenge as any).capitalMode || "VIRTUAL").toUpperCase();
  if (["SNAPSHOT_EQUITY", "TRADER_EQUITY", "SNAPSHOT", "USER_STARTING_EQUITY", "ISOLATED"].includes(capitalMode)) {
    const snap = Number.isFinite(userEquity) && userEquity > 0 ? userEquity : Number((challenge as any).virtualCapitalUsd ?? 100000);
    return { snapshotEquity: snap, capitalBaseUsed: snap };
  }

  const base = Number((challenge as any).virtualCapitalUsd ?? 100000);
  return { snapshotEquity: null, capitalBaseUsed: base };
}

export async function enrollInChallenge(userId: number, challengeId: number): Promise<EnrollmentRow> {
  const c = await getChallengeWithPhases(challengeId);
  if (!c) throw new Error("CHALLENGE_NOT_FOUND");

  const eligibility = await checkEligibilityForChallenge(userId, c);
  if (!eligibility.ok) throw new Error(eligibility.reason);

  const cfg = await getSystemChallengeConfig();
  const now = nowSec();

  const [existing] = await db
    .select()
    .from(challengeEnrollments)
    .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
    .limit(1);

  const maxRetries = Number((c as any).maxRetriesPerTrader ?? cfg.challengeDefaultMaxRetries ?? 0);
  const retryCooldownHours = Number((c as any).retryCooldownHours ?? cfg.challengeDefaultRetryCooldownHours ?? 0);

  if (existing) {
    if (existing.status === "ACTIVE") throw new Error("ALREADY_ENROLLED");

    const attempt = Number((existing as any).attemptNumber ?? 1);
    const allowedMaxAttempt = 1 + Math.max(0, maxRetries);
    if (attempt >= allowedMaxAttempt) throw new Error("MAX_RETRIES_EXCEEDED");

    if (retryCooldownHours > 0 && existing.completedAt) {
      const earliest = existing.completedAt + retryCooldownHours * 3600;
      if (now < earliest) throw new Error("RETRY_COOLDOWN");
    }

    const u = await getUserBasics(userId);
    const cap = computeEnrollmentCapitalBase(c, u.equity);

    const [updated] = await db
      .update(challengeEnrollments)
      .set({
        status: "ACTIVE",
        enrolledAt: now,
        completedAt: null,
        currentPnlPct: 0,
        maxDailyLossHit: null,
        tradingDays: 0,
        currentPhase: 1,
        phaseStartedAt: now,
        snapshotEquity: cap.snapshotEquity,
        capitalBaseUsed: cap.capitalBaseUsed,
        attemptNumber: attempt + 1,
        maxTotalLossHit: null,
        peakEquity: cap.capitalBaseUsed,
        lastWarningEvent: null,
        lastWarningAt: null,
        updatedAt: now,
      })
      .where(eq(challengeEnrollments.id, existing.id))
      .returning();

    return updated;
  }

  const u = await getUserBasics(userId);
  const cap = computeEnrollmentCapitalBase(c, u.equity);

  const [created] = await db
    .insert(challengeEnrollments)
    .values({
      challengeId,
      userId,
      status: "ACTIVE",
      enrolledAt: now,
      currentPnlPct: 0,
      tradingDays: 0,
      currentPhase: 1,
      phaseStartedAt: now,
      snapshotEquity: cap.snapshotEquity,
      capitalBaseUsed: cap.capitalBaseUsed,
      attemptNumber: 1,
      peakEquity: cap.capitalBaseUsed,
      updatedAt: now,
    } as any)
    .returning();

  return created;
}

export async function withdrawFromChallenge(userId: number, challengeId: number): Promise<EnrollmentRow> {
  const now = nowSec();
  const [existing] = await db
    .select()
    .from(challengeEnrollments)
    .where(and(eq(challengeEnrollments.challengeId, challengeId), eq(challengeEnrollments.userId, userId)))
    .limit(1);

  if (!existing) throw new Error("NOT_ENROLLED");
  if (existing.status !== "ACTIVE") throw new Error("NOT_ACTIVE");

  const [updated] = await db
    .update(challengeEnrollments)
    .set({ status: "WITHDRAWN", completedAt: now, updatedAt: now })
    .where(eq(challengeEnrollments.id, existing.id))
    .returning();
  return updated;
}

export type ChallengeTradeConstraints = {
  maxLotSize: number | null;
  maxConcurrentPositions: number | null;
  restrictedSymbols: Set<string>;
  allowWeekendHolding: boolean;
  allowNewsTrading: boolean;
  leverageMultiplier: number;
  enrollmentIds: number[];
  challengeIds: number[];
};

const constraintsCache = new Map<number, { at: number; value: ChallengeTradeConstraints | null }>();
const CONSTRAINTS_TTL_MS = 1000;

export async function getActiveTradeConstraintsForUser(userId: number): Promise<ChallengeTradeConstraints | null> {
  const nowMs = Date.now();
  const cached = constraintsCache.get(userId);
  if (cached && nowMs - cached.at < CONSTRAINTS_TTL_MS) return cached.value;

  const activeEnrolls = await db
    .select({
      enrollment: challengeEnrollments,
      challenge: challenges,
    })
    .from(challengeEnrollments)
    .innerJoin(challenges, eq(challengeEnrollments.challengeId, challenges.id))
    .where(and(eq(challengeEnrollments.userId, userId), eq(challengeEnrollments.status, "ACTIVE"), eq(challenges.isActive, true)));

  if (!activeEnrolls.length) {
    constraintsCache.set(userId, { at: nowMs, value: null });
    return null;
  }

  const activeChallengeIds = activeEnrolls.map((r) => r.challenge.id);
  const phases = await db
    .select()
    .from(challengePhases)
    .where(inArray(challengePhases.challengeId, activeChallengeIds));

  let maxLot: number | null = null;
  let maxPos: number | null = null;
  const restricted = new Set<string>();
  let allowWeekendHolding = true;
  let allowNewsTrading = true;
  let leverageMultiplier = Number.POSITIVE_INFINITY;
  const enrollmentIds: number[] = [];
  const challengeIds: number[] = [];

  for (const r of activeEnrolls) {
    const phaseNum = Number((r.enrollment as any).currentPhase ?? 1);
    const phase = phases.find((p) => p.challengeId === r.challenge.id && p.phaseNumber === phaseNum);
    enrollmentIds.push(Number((r.enrollment as any).id));
    challengeIds.push(Number((r.challenge as any).id));

    if (phase?.maxLotSize != null) {
      maxLot = maxLot == null ? phase.maxLotSize : Math.min(maxLot, phase.maxLotSize);
    }
    if (phase?.maxConcurrentPositions != null) {
      maxPos = maxPos == null ? phase.maxConcurrentPositions : Math.min(maxPos, phase.maxConcurrentPositions);
    }

    const phaseRestricted = parseCsvSet(phase?.restrictedSymbolsCsv);
    for (const sym of phaseRestricted) restricted.add(sym);

    if (phase?.allowWeekendHolding === false) {
      allowWeekendHolding = false;
    }

    if (phase?.allowNewsTrading === false) {
      allowNewsTrading = false;
    }

    const challengeLeverage = Number((r.challenge as any)?.leverageMultiplier ?? 1);
    if (Number.isFinite(challengeLeverage) && challengeLeverage > 0) {
      leverageMultiplier = Math.min(leverageMultiplier, challengeLeverage);
    }
  }

  const value: ChallengeTradeConstraints = {
    maxLotSize: maxLot,
    maxConcurrentPositions: maxPos,
    restrictedSymbols: restricted,
    allowWeekendHolding,
    allowNewsTrading,
    leverageMultiplier:
      leverageMultiplier === Number.POSITIVE_INFINITY ? 1 : Math.max(0.01, Math.min(100, leverageMultiplier)),
    enrollmentIds,
    challengeIds,
  };
  constraintsCache.set(userId, { at: nowMs, value });
  return value;
}

export async function hasRestrictedSymbolTrade(
  userId: number,
  startAt: number,
  endAt: number,
  restrictedSymbols: Set<string>,
): Promise<boolean> {
  if (!restrictedSymbols.size) return false;
  const symbols = Array.from(restrictedSymbols);

  const q = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(trades)
    .innerJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
    .where(
      and(
        eq(trades.userId, userId),
        isNotNull(trades.closedAt),
        gte(trades.closedAt, startAt),
        lte(trades.closedAt, endAt),
        inArray(symbolConfigs.symbol, symbols),
      ),
    );

  return Number(q[0]?.c ?? 0) > 0;
}
