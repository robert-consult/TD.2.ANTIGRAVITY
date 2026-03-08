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
import { requireAdmin } from "../middleware/requireAdmin";
import { randomToken, sha256Hex } from "../services/crypto";
import {
  PIPELINE_STAGES,
  ensurePipelineRowForUser,
  updateRecruitingPipelineForUser,
} from "../recruitment/pipelineService";
import { appendChallengeEvent } from "../recruitment/challengesV4/challengeEvents";
import { getSystemChallengeConfig } from "../recruitment/challengesV4/challengeConfig";
import { computePhaseStats } from "../recruitment/challengesV4/challengeEvaluation";
import { listAdminScoutCandidates } from "../scout/scoutService";
import {
  getPartnerInquiryRoutingConfig,
  resolvePartnerInquiryRouting,
  upsertPartnerInquiryRoutingConfig,
} from "../partner/inquiryRouting";
import { createMailboxThreadWithMessage, createNotification, getCommunicationSettings } from "../services/messaging";
import { publishLiveEvent } from "../services/liveBus";
import {
  DEFAULT_PARTNER_GATING_CONFIG,
  normalizePartnerGatingConfig,
  normalizePartnerGatingOverrides,
} from "../partner/onboarding";
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
} from "./adminScout/validation";
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
} from "./adminScout/support";

import { adminScoutRouter } from "./adminScout/candidates";
import { adminChallengesRouter } from "./adminScout/challengeAnalytics";
import { adminPartnersRouter } from "./adminScout/partners";

export { adminScoutRouter, adminChallengesRouter, adminPartnersRouter };
