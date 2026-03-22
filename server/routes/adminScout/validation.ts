import { z } from "zod";
import { CHALLENGE_MAILBOX_CATEGORIES } from "@shared/challenges/mailbox";
import {
  MAX_CHALLENGE_EVAL_INTERVAL_MIN,
  MAX_CHALLENGE_EVAL_INTERVAL_SEC,
  MIN_CHALLENGE_EVAL_INTERVAL_MIN,
  MIN_CHALLENGE_EVAL_INTERVAL_SEC,
} from "@shared/challenges/systemConfig";
import { PIPELINE_STAGES } from "../../recruitment/pipelineService";

export const LEADERBOARD_MODES = ["PUBLIC", "TOP_10", "DISABLED"] as const;
export const PARTNER_GATE_LEVELS = ["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"] as const;
export const PARTNER_INVITE_EMAIL_STATUSES = [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "OPENED",
  "FAILED",
  "SKIPPED",
] as const;

const pipelineStageSchema = z.enum(PIPELINE_STAGES);
const leaderboardModeSchema = z.enum(LEADERBOARD_MODES);
const partnerGateLevelSchema = z.enum(PARTNER_GATE_LEVELS);
const ELIGIBILITY_GATES = new Set(["NONE", "EMAIL_VERIFIED", "CONTENDER", "ADMIN_APPROVED"]);

function isJsonStringValid(value: unknown, mode: "ANY" | "OBJECT_OR_ARRAY" | "OBJECT_ONLY" = "ANY"): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  try {
    const parsed = JSON.parse(text);
    if (mode === "ANY") return true;
    if (mode === "OBJECT_OR_ARRAY") return parsed != null && typeof parsed === "object";
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function isEligibilityGateInputValid(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return true;
  if (ELIGIBILITY_GATES.has(text.toUpperCase())) return true;
  return isJsonStringValid(text, "OBJECT_ONLY");
}

export const watchlistInputSchema = z.object({
  userId: z.number().int().positive(),
  tier: z.enum(["A_LIST", "B_LIST", "INCUBATOR"]).optional(),
  notes: z.string().trim().max(3000).optional().nullable(),
}).strict();

export const pipelineUpdateSchema = z.object({
  stage: pipelineStageSchema.optional(),
  assignedAdminId: z.number().int().positive().optional().nullable(),
  lastContactedAt: z.number().int().nonnegative().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  isPartnerVisible: z.boolean().optional(),
}).strict();

export const scoutConfigPatchSchema = z.object({
  scoutTabEnabled: z.boolean().optional(),
  partnerPortalEnabled: z.boolean().optional(),
  traderProProfilesEnabled: z.boolean().optional(),
  traderCompeteEnabled: z.boolean().optional(),
  traderCommunityEnabled: z.boolean().optional(),
  partnerAllocationsEnabled: z.boolean().optional(),
  leaderboardMode: leaderboardModeSchema.optional(),
  scoutMinSharpeAlert: z.coerce.number().min(-100).max(100).optional(),
  partnerGatingConfig: z
    .object({
      viewDataRoom: partnerGateLevelSchema,
      runSimulations: partnerGateLevelSchema,
      requestAllocation: partnerGateLevelSchema,
      directContact: partnerGateLevelSchema,
    })
    .strict()
    .optional(),
  partnerPasswordRotationDays: z.coerce.number().int().min(7).max(365).optional(),
  partnerPasswordReminderLogins: z.coerce.number().int().min(1).max(20).optional(),
  partnerInviteDefaultExpiryDays: z.coerce.number().int().min(1).max(180).optional(),
}).strict();

export const challengeUpsertSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(4000).optional().nullable(),
  profitTargetPct: z.number().min(0).max(10),
  maxDailyLossPct: z.number().min(0).max(10),
  maxTotalLossPct: z.number().min(0).max(10).optional().nullable(),
  minTradingDays: z.number().int().min(0).max(365).optional().nullable(),
  durationDays: z.number().int().min(1).max(365),
  startAt: z.number().int().nonnegative().optional().nullable(),
  endAt: z.number().int().nonnegative().optional().nullable(),
  enrollmentStartAt: z.number().int().nonnegative().optional().nullable(),
  enrollmentEndAt: z.number().int().nonnegative().optional().nullable(),
  visibleToTraders: z.boolean().optional(),
  featuredOrder: z.number().int().min(0).max(100000).optional(),
  category: z.string().trim().max(80).optional(),
  tier: z.string().trim().max(80).optional(),
  slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9-]+$/).optional().nullable(),
  tags: z.string().trim().max(500).optional(),
  iconColor: z.string().trim().max(32).optional().nullable(),
  virtualCapitalUsd: z.number().positive().max(100_000_000).optional(),
  capitalMode: z.enum(["VIRTUAL", "SNAPSHOT_EQUITY"]).optional(),
  leverageMultiplier: z.number().positive().max(500).optional(),
  maxEnrollments: z.number().int().min(1).max(1_000_000).optional().nullable(),
  maxActiveEnrollments: z.number().int().min(1).max(1_000_000).optional().nullable(),
  maxRetriesPerTrader: z.number().int().min(0).max(100).optional(),
  retryCooldownHours: z.number().int().min(0).max(24 * 365).optional(),
  eligibilityGate: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .refine((value) => isEligibilityGateInputValid(value), { message: "INVALID_ELIGIBILITY_GATE" }),
  prizePoolEnabled: z.boolean().optional(),
  prizePoolUsd: z.number().min(0).max(100_000_000).optional(),
  prizeDistributionJson: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .refine((value) => value == null || value.trim() === "" || isJsonStringValid(value, "OBJECT_OR_ARRAY"), {
      message: "INVALID_PRIZE_DISTRIBUTION_JSON",
    }),
  prizeMinCompletions: z.number().int().min(0).max(1_000_000).optional(),
  prizeAwardTiming: z.enum(["ON_COMPLETE", "ON_CHALLENGE_END", "MANUAL"]).optional(),
  badgesEnabled: z.boolean().optional(),
  badgeOnPass: z.string().trim().max(120).optional().nullable(),
  badgeOnTop3: z.string().trim().max(120).optional().nullable(),
  certificateEnabled: z.boolean().optional(),
  certificateDownloadable: z.boolean().optional(),
  certificateShareable: z.boolean().optional(),
  certificateTemplateId: z.number().int().positive().optional().nullable(),
  certificateIncludeMetrics: z.boolean().optional(),
  selectionBoostEnabled: z.boolean().optional(),
  selectionBoostPoints: z.number().min(0).max(100000).optional(),
  partnerVisibilityOnPass: z.boolean().optional(),
  autoWatchlistTier: z.enum(["A_LIST", "B_LIST", "INCUBATOR"]).optional().nullable(),
  progressionTierId: z.number().int().positive().optional().nullable(),
  customRewardJson: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .refine((value) => value == null || value.trim() === "" || isJsonStringValid(value, "OBJECT_OR_ARRAY"), {
      message: "INVALID_CUSTOM_REWARD_JSON",
    }),
  leaderboardEnabled: z.boolean().optional(),
  leaderboardAnonymize: z.boolean().optional(),
  leaderboardMaxVisible: z.number().int().min(1).max(500).optional(),
  isActive: z.boolean().optional(),
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
    .max(3)
    .optional(),
});

export const challengeEnrollmentActionSchema = z.object({
  action: z.enum(["ADVANCE_PHASE", "RESET_PHASE", "DISQUALIFY", "WITHDRAW", "ADD_NOTE"]),
  note: z.string().trim().max(4000).optional().nullable(),
});

export const challengeSettingsPatchSchema = z.object({
  traderCompeteEnabled: z.boolean().optional(),
  challengeAutoAdvancePhase: z.boolean().optional(),
  challengeEvalIntervalMin: z.coerce.number().int().min(MIN_CHALLENGE_EVAL_INTERVAL_MIN).max(MAX_CHALLENGE_EVAL_INTERVAL_MIN).optional(),
  challengeEvaluationIntervalSec: z.coerce.number().int().min(MIN_CHALLENGE_EVAL_INTERVAL_SEC).max(MAX_CHALLENGE_EVAL_INTERVAL_SEC).optional(),
  challengeEvalMaxRows: z.coerce.number().int().min(1).max(5000).optional(),
  challengeWarningThresholdPct: z.coerce.number().min(0.01).max(0.99).optional(),
  challengeDefaultDrawdownType: z.enum(["STATIC", "TRAILING"]).optional(),
  challengeDefaultCapitalMode: z.enum(["VIRTUAL", "SNAPSHOT_EQUITY"]).optional(),
  challengeDefaultMaxRetries: z.coerce.number().int().min(0).max(100).optional(),
  challengeDefaultRetryCooldownHours: z.coerce.number().int().min(0).max(24 * 365).optional(),
  challengeDefaultEligibility: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .refine((value) => isEligibilityGateInputValid(value), { message: "INVALID_DEFAULT_ELIGIBILITY" }),
  challengeDefaultCategory: z.string().trim().max(80).optional(),
  challengeDefaultTier: z.string().trim().max(80).optional(),
  challengeRewardsEnabled: z.boolean().optional(),
  challengePrizePoolsEnabled: z.boolean().optional(),
  challengeBadgesEnabled: z.boolean().optional(),
  challengeCertificatesEnabled: z.boolean().optional(),
  challengeCertificatesDownloadable: z.boolean().optional(),
  challengeCertificatesShareable: z.boolean().optional(),
  challengeSelectionBoostEnabled: z.boolean().optional(),
  challengeDefaultSelectionBoost: z.coerce.number().min(0).max(100000).optional(),
  challengeProgressionEnabled: z.boolean().optional(),
  challengeCustomRewardsEnabled: z.boolean().optional(),
  challengeNotifyOnEnroll: z.boolean().optional(),
  challengeNotifyOnPhaseWarning: z.boolean().optional(),
  challengeNotifyOnBreach: z.boolean().optional(),
  challengeNotifyOnPhasePass: z.boolean().optional(),
  challengeNotifyOnFail: z.boolean().optional(),
  challengeNotifyOnComplete: z.boolean().optional(),
  challengeNotifyOnBadgeAward: z.boolean().optional(),
  challengeNotifyOnPrizeAward: z.boolean().optional(),
  challengeNotifyOnCertIssue: z.boolean().optional(),
  challengeNotifyOnTierUp: z.boolean().optional(),
  challengeNotifyOnAdminAction: z.boolean().optional(),
  challengeNotifyViaMailbox: z.boolean().optional(),
  challengeMailboxCategory: z.enum(CHALLENGE_MAILBOX_CATEGORIES).optional(),
  challengeLeaderboardEnabled: z.boolean().optional(),
  challengeLeaderboardRefreshSec: z.coerce.number().int().min(10).max(24 * 3600).optional(),
  challengeLeaderboardSnapshotIntervalSec: z.coerce.number().int().min(10).max(24 * 3600).optional(),
  challengeLeaderboardRankingMetric: z.enum(["COMPOSITE_SCORE", "PNL_PCT"]).optional(),
  challengePrizeAwardTimingDefault: z.enum(["ON_COMPLETE", "ON_CHALLENGE_END", "MANUAL"]).optional(),
  challengePrizeCandidatesDefault: z.enum(["PASSED_ONLY", "INCLUDE_ACTIVE"]).optional(),
  challengeBreachPolicyDefault: z.enum(["FAIL", "BREACH_AND_CONTINUE", "MANUAL_REVIEW"]).optional(),
  challengeSingleDayProfitBasis: z.enum(["PNL_PCT", "EQUITY_PCT", "REALIZED_ONLY"]).optional(),
  challengeNewsBlackoutWindowsJson: z
    .string()
    .trim()
    .max(20000)
    .optional()
    .refine((value) => value == null || value === "" || isJsonStringValid(value, "OBJECT_OR_ARRAY"), {
      message: "INVALID_NEWS_BLACKOUT_WINDOWS_JSON",
    }),
  challengeWeekendCutoffHours: z.coerce.number().int().min(0).max(72).optional(),
  challengeForceCloseBeforeWeekend: z.boolean().optional(),
  challengeLeverageMultiplierDefault: z.coerce.number().min(0.01).max(100).optional(),
  challengeMaxActiveEnrollmentsUser: z.coerce.number().int().min(1).max(1000).optional(),
  challengeMaxActiveEnrollmentsPerChallenge: z.coerce.number().int().min(1).max(1000).optional(),
  challengeCooldownHoursAfterFail: z.coerce.number().int().min(0).max(24 * 365).optional(),
  challengeCooldownHoursAfterWithdraw: z.coerce.number().int().min(0).max(24 * 365).optional(),
  challengeCertificateDefaultTemplateId: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  challengeCertificateIncludeMetricsDefault: z.boolean().optional(),
  challengeCertificateIncludeQrDefault: z.boolean().optional(),
  challengeCertificateVerificationKeyId: z.string().trim().min(1).max(32).optional(),
  challengeAuditStrictMode: z.boolean().optional(),
  challengeAnomalyDetectionEnabled: z.boolean().optional(),
  challengeManualReviewEnabled: z.boolean().optional(),
  challengeManualReviewSuspiciousThreshold: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const challengeBadgeUpsertSchema = z.object({
  key: z.string().trim().min(2).max(120).regex(/^[a-z0-9-_]+$/i),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  iconUrl: z.string().trim().url().max(2000).optional().nullable(),
  iconEmoji: z.string().trim().max(64).optional().nullable(),
  category: z.string().trim().max(80).optional(),
  criteriaJson: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .refine((value) => value == null || value.trim() === "" || isJsonStringValid(value, "OBJECT_OR_ARRAY"), {
      message: "INVALID_BADGE_CRITERIA_JSON",
    }),
  isActive: z.boolean().optional(),
});

export const challengeCertificateTemplateUpsertSchema = z.object({
  name: z.string().trim().min(2).max(200),
  headerText: z.string().trim().max(1000).optional(),
  bodyText: z.string().trim().max(10000).optional(),
  includeMetrics: z.boolean().optional(),
  includeVerificationCode: z.boolean().optional(),
  brandColor: z.string().trim().max(64).optional().nullable(),
  logoUrl: z.string().trim().url().max(2000).optional().nullable(),
  isDownloadable: z.boolean().optional(),
  isShareable: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const challengeProgressionTierUpsertSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  tiersJson: z
    .string()
    .trim()
    .min(2)
    .max(16000)
    .optional()
    .refine((value) => value == null || value.trim() === "" || isJsonStringValid(value, "OBJECT_OR_ARRAY"), {
      message: "INVALID_TIERS_JSON",
    }),
  isActive: z.boolean().optional(),
});

export const challengePrizeApproveSchema = z.object({
  action: z.enum(["APPROVE", "PAID", "CANCEL"]),
  note: z.string().trim().max(4000).optional().nullable(),
});

export const challengeEnrollmentOverrideSchema = z.object({
  status: z.enum(["ACTIVE", "PASSED", "FAILED", "WITHDRAWN", "REVIEW_REQUIRED"]),
  reason: z.string().trim().min(3).max(4000),
  currentPhase: z.number().int().min(1).max(10).optional(),
  completedAt: z.number().int().nonnegative().optional().nullable(),
});

export const challengeEnrollmentExtendSchema = z.object({
  extendDays: z.coerce.number().int().min(1).max(365),
  reason: z.string().trim().min(3).max(4000),
});

export const challengeEnrollmentNotifySchema = z.object({
  title: z.string().trim().min(3).max(180),
  message: z.string().trim().min(3).max(4000),
  severity: z.enum(["INFO", "SUCCESS", "WARNING", "CRITICAL"]).optional(),
  sendMailbox: z.boolean().optional(),
});

export const challengePhaseUpsertSchema = z.object({
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
});

export const partnerCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ipWhitelist: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const partnerPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  ipWhitelist: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
  rotateKey: z.boolean().optional(),
}).strict();

export const inquiryRoutingPatchSchema = z
  .object({
    inboxAlias: z.string().trim().min(1).max(160).optional(),
    routeAdminEmails: z.array(z.string().trim().email().max(254)).max(200).optional(),
    viewerAdminEmails: z.array(z.string().trim().email().max(254)).max(200).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one inquiry routing field is required",
    path: [],
  });

export const partnerInviteSchema = z.object({
  email: z.string().trim().email().max(254),
  fundName: z.string().trim().min(2).max(120).optional().nullable(),
  adminNotes: z.string().trim().max(5000).optional().nullable(),
  expiresInDays: z.coerce.number().int().min(1).max(180).optional(),
  autoActivate: z.boolean().optional(),
}).strict();

export const partnerApproveSchema = z.object({
  action: z.enum(["APPROVE", "HOLD", "REVOKE"]),
  adminNotes: z.string().trim().max(5000).optional().nullable(),
}).strict();

export const partnerGatingOverrideSchema = z
  .object({
    viewDataRoom: partnerGateLevelSchema.optional(),
    runSimulations: partnerGateLevelSchema.optional(),
    requestAllocation: partnerGateLevelSchema.optional(),
    directContact: partnerGateLevelSchema.optional(),
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one override field is required",
    path: [],
  });
