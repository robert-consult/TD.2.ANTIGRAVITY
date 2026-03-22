import { db } from "@db";
import {
  resolveChallengeEvalInterval,
} from "@shared/challenges/systemConfig";
import { systemConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { onLiveEvent } from "../../services/liveBus";

type SystemChallengeConfigSource = Partial<typeof systemConfig.$inferSelect> | null | undefined;

export type SystemChallengeConfig = {
  traderCompeteEnabled: boolean;
  challengeAutoAdvancePhase: boolean;
  challengeDefaultDrawdownType: "STATIC" | "TRAILING";
  challengeDefaultCapitalMode: "VIRTUAL" | "SNAPSHOT_EQUITY";
  challengeDefaultMaxRetries: number;
  challengeDefaultRetryCooldownHours: number;
  challengeDefaultEligibility: unknown;
  challengeDefaultCategory: string;
  challengeDefaultTier: string;
  challengeRewardsEnabled: boolean;
  challengePrizePoolsEnabled: boolean;
  challengeBadgesEnabled: boolean;
  challengeCertificatesEnabled: boolean;
  challengeCertificatesDownloadable: boolean;
  challengeCertificatesShareable: boolean;
  challengeSelectionBoostEnabled: boolean;
  challengeDefaultSelectionBoost: number;
  challengeProgressionEnabled: boolean;
  challengeCustomRewardsEnabled: boolean;

  challengeNotifyOnEnroll: boolean;
  challengeNotifyOnPhaseWarning: boolean;
  challengeNotifyOnBreach: boolean;
  challengeNotifyOnPhasePass: boolean;
  challengeNotifyOnFail: boolean;
  challengeNotifyOnComplete: boolean;
  challengeNotifyOnBadgeAward: boolean;
  challengeNotifyOnPrizeAward: boolean;
  challengeNotifyOnCertIssue: boolean;
  challengeNotifyOnTierUp: boolean;
  challengeNotifyOnAdminAction: boolean;

  challengeNotifyViaMailbox: boolean;
  challengeMailboxCategory: string;
  // If maxDailyLossPct=5 and threshold=0.8 -> warn once at >=4.0%.
  challengeWarningThresholdPct: number;
  challengeBreachPolicyDefault: "FAIL" | "BREACH_AND_CONTINUE" | "MANUAL_REVIEW";
  challengeSingleDayProfitBasis: "PNL_PCT" | "EQUITY_PCT" | "REALIZED_ONLY";

  challengeLeaderboardEnabled: boolean;
  challengeLeaderboardRefreshSec: number;
  challengeLeaderboardSnapshotIntervalSec: number;
  challengeLeaderboardRankingMetric: "COMPOSITE_SCORE" | "PNL_PCT";
  challengePrizeAwardTimingDefault: "ON_COMPLETE" | "ON_CHALLENGE_END" | "MANUAL";
  challengePrizeCandidatesDefault: "PASSED_ONLY" | "INCLUDE_ACTIVE";
  challengeNewsBlackoutWindowsJson: string;
  challengeWeekendCutoffHours: number;
  challengeForceCloseBeforeWeekend: boolean;
  challengeLeverageMultiplierDefault: number;
  challengeMaxActiveEnrollmentsUser: number;
  challengeMaxActiveEnrollmentsPerChallenge: number;
  challengeCooldownHoursAfterFail: number;
  challengeCooldownHoursAfterWithdraw: number;
  challengeCertificateDefaultTemplateId: number | null;
  challengeCertificateIncludeMetricsDefault: boolean;
  challengeCertificateIncludeQrDefault: boolean;
  challengeCertificateVerificationKeyId: string;
  challengeEvaluationIntervalSec: number;
  challengeAuditStrictMode: boolean;
  challengeAnomalyDetectionEnabled: boolean;
  challengeManualReviewEnabled: boolean;
  challengeManualReviewSuspiciousThreshold: number;
  challengeEvalEnabled: boolean;
  challengeEvalIntervalMin: number;
  challengeEvalMaxRows: number;
};

let cache: { at: number; value: SystemChallengeConfig } | null = null;
const TTL_MS = 3000;
let subscribed = false;

function ensureSubscribed() {
  if (subscribed) return;
  subscribed = true;
  onLiveEvent((event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "challenges:updated" || event.type === "system-config:updated") {
      cache = null;
    }
  });
}

export function invalidateSystemChallengeConfigCache() {
  cache = null;
}

function safeJson(s: string | null | undefined, fallback: unknown): unknown {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeDrawdownType(value: unknown): "STATIC" | "TRAILING" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "TRAILING") return "TRAILING";
  return "STATIC";
}

function normalizeCapitalMode(value: unknown): "VIRTUAL" | "SNAPSHOT_EQUITY" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (["SNAPSHOT_EQUITY", "TRADER_EQUITY", "SNAPSHOT", "USER_STARTING_EQUITY", "ISOLATED"].includes(raw)) {
    return "SNAPSHOT_EQUITY";
  }
  return "VIRTUAL";
}

function normalizeBreachPolicy(value: unknown): "FAIL" | "BREACH_AND_CONTINUE" | "MANUAL_REVIEW" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "BREACH_AND_CONTINUE") return "BREACH_AND_CONTINUE";
  if (raw === "MANUAL_REVIEW") return "MANUAL_REVIEW";
  return "FAIL";
}

function normalizeSingleDayProfitBasis(value: unknown): "PNL_PCT" | "EQUITY_PCT" | "REALIZED_ONLY" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "EQUITY_PCT") return "EQUITY_PCT";
  if (raw === "REALIZED_ONLY") return "REALIZED_ONLY";
  return "PNL_PCT";
}

function normalizeLeaderboardRankingMetric(value: unknown): "COMPOSITE_SCORE" | "PNL_PCT" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "PNL_PCT") return "PNL_PCT";
  return "COMPOSITE_SCORE";
}

function normalizePrizeAwardTiming(value: unknown): "ON_COMPLETE" | "ON_CHALLENGE_END" | "MANUAL" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "ON_CHALLENGE_END") return "ON_CHALLENGE_END";
  if (raw === "MANUAL") return "MANUAL";
  return "ON_COMPLETE";
}

function normalizePrizeCandidates(value: unknown): "PASSED_ONLY" | "INCLUDE_ACTIVE" {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "INCLUDE_ACTIVE") return "INCLUDE_ACTIVE";
  return "PASSED_ONLY";
}

export async function getSystemChallengeConfig(force = false): Promise<SystemChallengeConfig> {
  ensureSubscribed();
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.value;

  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
  const value = buildSystemChallengeConfig(row);

  cache = { at: now, value };
  return value;
}

export function buildSystemChallengeConfig(source: SystemChallengeConfigSource): SystemChallengeConfig {
  const row = source as any;
  const challengeEval = resolveChallengeEvalInterval({
    challengeEvalIntervalMin: row?.challengeEvalIntervalMin,
    challengeEvaluationIntervalSec: row?.challengeEvaluationIntervalSec,
  });

  return {
    traderCompeteEnabled: Boolean(row?.traderCompeteEnabled ?? false),
    challengeAutoAdvancePhase: Boolean(row?.challengeAutoAdvancePhase ?? true),
    challengeDefaultDrawdownType: normalizeDrawdownType(row?.challengeDefaultDrawdownType),
    challengeDefaultCapitalMode: normalizeCapitalMode(row?.challengeDefaultCapitalMode),
    challengeDefaultMaxRetries: Math.max(0, Math.trunc(clamp(row?.challengeDefaultMaxRetries, 3, 0, 100))),
    challengeDefaultRetryCooldownHours: Math.max(
      0,
      Math.trunc(clamp(row?.challengeDefaultRetryCooldownHours, 24, 0, 24 * 365)),
    ),
    challengeDefaultEligibility: safeJson(row?.challengeDefaultEligibility, "EMAIL_VERIFIED"),
    challengeDefaultCategory: String(row?.challengeDefaultCategory ?? "STANDARD"),
    challengeDefaultTier: String(row?.challengeDefaultTier ?? "STARTER"),
    challengeRewardsEnabled: Boolean(row?.challengeRewardsEnabled ?? true),
    challengePrizePoolsEnabled: Boolean(row?.challengePrizePoolsEnabled ?? true),
    challengeBadgesEnabled: Boolean(row?.challengeBadgesEnabled ?? true),
    challengeCertificatesEnabled: Boolean(row?.challengeCertificatesEnabled ?? true),
    challengeCertificatesDownloadable: Boolean(row?.challengeCertificatesDownloadable ?? true),
    challengeCertificatesShareable: Boolean(row?.challengeCertificatesShareable ?? true),
    challengeSelectionBoostEnabled: Boolean(row?.challengeSelectionBoostEnabled ?? true),
    challengeDefaultSelectionBoost: Number(row?.challengeDefaultSelectionBoost ?? 0),
    challengeProgressionEnabled: Boolean(row?.challengeProgressionEnabled ?? true),
    challengeCustomRewardsEnabled: Boolean(row?.challengeCustomRewardsEnabled ?? false),

    challengeNotifyOnEnroll: Boolean(row?.challengeNotifyOnEnroll ?? true),
    challengeNotifyOnPhaseWarning: Boolean(row?.challengeNotifyOnPhaseWarning ?? true),
    challengeNotifyOnBreach: Boolean(row?.challengeNotifyOnBreach ?? true),
    challengeNotifyOnPhasePass: Boolean(row?.challengeNotifyOnPhasePass ?? true),
    challengeNotifyOnFail: Boolean(row?.challengeNotifyOnFail ?? true),
    challengeNotifyOnComplete: Boolean(row?.challengeNotifyOnComplete ?? true),
    challengeNotifyOnBadgeAward: Boolean(row?.challengeNotifyOnBadgeAward ?? true),
    challengeNotifyOnPrizeAward: Boolean(row?.challengeNotifyOnPrizeAward ?? true),
    challengeNotifyOnCertIssue: Boolean(row?.challengeNotifyOnCertIssue ?? true),
    challengeNotifyOnTierUp: Boolean(row?.challengeNotifyOnTierUp ?? true),
    challengeNotifyOnAdminAction: Boolean(row?.challengeNotifyOnAdminAction ?? true),

    challengeNotifyViaMailbox: Boolean(row?.challengeNotifyViaMailbox ?? false),
    challengeMailboxCategory: String(row?.challengeMailboxCategory ?? "SYSTEM"),
    challengeWarningThresholdPct: clamp(row?.challengeWarningThresholdPct, 0.8, 0.01, 0.99),
    challengeBreachPolicyDefault: normalizeBreachPolicy(row?.challengeBreachPolicyDefault),
    challengeSingleDayProfitBasis: normalizeSingleDayProfitBasis(row?.challengeSingleDayProfitBasis),

    challengeLeaderboardEnabled: Boolean(row?.challengeLeaderboardEnabled ?? true),
    challengeLeaderboardRefreshSec: Math.max(
      10,
      Math.trunc(clamp(row?.challengeLeaderboardRefreshSec, 60, 10, 24 * 3600)),
    ),
    challengeLeaderboardSnapshotIntervalSec: Math.max(
      10,
      Math.trunc(clamp(row?.challengeLeaderboardSnapshotIntervalSec, 60, 10, 24 * 3600)),
    ),
    challengeLeaderboardRankingMetric: normalizeLeaderboardRankingMetric(row?.challengeLeaderboardRankingMetric),
    challengePrizeAwardTimingDefault: normalizePrizeAwardTiming(row?.challengePrizeAwardTimingDefault),
    challengePrizeCandidatesDefault: normalizePrizeCandidates(row?.challengePrizeCandidatesDefault),
    challengeNewsBlackoutWindowsJson: String(row?.challengeNewsBlackoutWindowsJson ?? "[]"),
    challengeWeekendCutoffHours: Math.max(
      0,
      Math.trunc(clamp(row?.challengeWeekendCutoffHours, 6, 0, 72)),
    ),
    challengeForceCloseBeforeWeekend: Boolean(row?.challengeForceCloseBeforeWeekend ?? false),
    challengeLeverageMultiplierDefault: Math.max(
      0.01,
      clamp(row?.challengeLeverageMultiplierDefault, 1, 0.01, 100),
    ),
    challengeMaxActiveEnrollmentsUser: Math.max(
      1,
      Math.trunc(clamp(row?.challengeMaxActiveEnrollmentsUser, 5, 1, 1000)),
    ),
    challengeMaxActiveEnrollmentsPerChallenge: Math.max(
      1,
      Math.trunc(clamp(row?.challengeMaxActiveEnrollmentsPerChallenge, 1, 1, 1000)),
    ),
    challengeCooldownHoursAfterFail: Math.max(
      0,
      Math.trunc(clamp(row?.challengeCooldownHoursAfterFail, 24, 0, 24 * 365)),
    ),
    challengeCooldownHoursAfterWithdraw: Math.max(
      0,
      Math.trunc(clamp(row?.challengeCooldownHoursAfterWithdraw, 12, 0, 24 * 365)),
    ),
    challengeCertificateDefaultTemplateId:
      Number(row?.challengeCertificateDefaultTemplateId ?? 0) > 0
        ? Math.trunc(Number(row?.challengeCertificateDefaultTemplateId))
        : null,
    challengeCertificateIncludeMetricsDefault: Boolean(
      row?.challengeCertificateIncludeMetricsDefault ?? true,
    ),
    challengeCertificateIncludeQrDefault: Boolean(row?.challengeCertificateIncludeQrDefault ?? true),
    challengeCertificateVerificationKeyId: String(row?.challengeCertificateVerificationKeyId ?? "v1"),
    challengeEvaluationIntervalSec: challengeEval.intervalSec,
    challengeAuditStrictMode: Boolean(row?.challengeAuditStrictMode ?? true),
    challengeAnomalyDetectionEnabled: Boolean(row?.challengeAnomalyDetectionEnabled ?? true),
    challengeManualReviewEnabled: Boolean(row?.challengeManualReviewEnabled ?? false),
    challengeManualReviewSuspiciousThreshold: Math.max(
      1,
      Math.trunc(clamp(row?.challengeManualReviewSuspiciousThreshold, 3, 1, 100)),
    ),
    challengeEvalEnabled: Boolean(row?.challengeEvalEnabled ?? true),
    challengeEvalIntervalMin: challengeEval.intervalMin,
    challengeEvalMaxRows: Math.max(1, Math.trunc(clamp(row?.challengeEvalMaxRows, 500, 1, 5000))),
  };
}

export function buildChallengeSchedulerRuntimeConfig(source: SystemChallengeConfigSource) {
  const cfg = buildSystemChallengeConfig(source);
  return {
    enabled: Boolean(cfg.challengeEvalEnabled),
    intervalMin: cfg.challengeEvalIntervalMin,
    intervalSec: cfg.challengeEvaluationIntervalSec,
    maxRows: cfg.challengeEvalMaxRows,
  };
}
