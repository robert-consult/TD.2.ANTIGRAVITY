import { db } from "@db";
import { systemConfig } from "@shared/schema";

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

  challengeLeaderboardEnabled: boolean;
  challengeLeaderboardRefreshSec: number;
  challengeEvalEnabled: boolean;
  challengeEvalIntervalMin: number;
  challengeEvalMaxRows: number;
};

let cache: { at: number; value: SystemChallengeConfig } | null = null;
const TTL_MS = 3000;

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

export async function getSystemChallengeConfig(force = false): Promise<SystemChallengeConfig> {
  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) return cache.value;

  const [row] = await db.select().from(systemConfig).limit(1);

  const value: SystemChallengeConfig = {
    traderCompeteEnabled: Boolean((row as any)?.traderCompeteEnabled ?? false),
    challengeAutoAdvancePhase: Boolean((row as any)?.challengeAutoAdvancePhase ?? true),
    challengeDefaultDrawdownType: normalizeDrawdownType((row as any)?.challengeDefaultDrawdownType),
    challengeDefaultCapitalMode: normalizeCapitalMode((row as any)?.challengeDefaultCapitalMode),
    challengeDefaultMaxRetries: Math.max(0, Math.trunc(clamp((row as any)?.challengeDefaultMaxRetries, 3, 0, 100))),
    challengeDefaultRetryCooldownHours: Math.max(
      0,
      Math.trunc(clamp((row as any)?.challengeDefaultRetryCooldownHours, 24, 0, 24 * 365)),
    ),
    challengeDefaultEligibility: safeJson((row as any)?.challengeDefaultEligibility, "EMAIL_VERIFIED"),
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
    challengeWarningThresholdPct: clamp((row as any)?.challengeWarningThresholdPct, 0.8, 0.01, 0.99),

    challengeLeaderboardEnabled: Boolean((row as any)?.challengeLeaderboardEnabled ?? true),
    challengeLeaderboardRefreshSec: Math.max(
      10,
      Math.trunc(clamp((row as any)?.challengeLeaderboardRefreshSec, 60, 10, 24 * 3600)),
    ),
    challengeEvalEnabled: Boolean((row as any)?.challengeEvalEnabled ?? true),
    challengeEvalIntervalMin: Math.max(1, Math.trunc(clamp((row as any)?.challengeEvalIntervalMin, 60, 1, 24 * 60))),
    challengeEvalMaxRows: Math.max(1, Math.trunc(clamp((row as any)?.challengeEvalMaxRows, 500, 1, 5000))),
  };

  cache = { at: now, value };
  return value;
}
