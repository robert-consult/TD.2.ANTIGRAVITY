import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;

import { mailboxThreads, users } from "./schema.pg.base";

// Nightly scout metrics (risk-adjusted and behavior features)
export const scoutMetricsSnapshot = pgTable("scout_metrics_snapshot", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sharpeRatio: real("sharpe_ratio"),
  sortinoRatio: real("sortino_ratio"),
  calmarRatio: real("calmar_ratio"),
  equityCurveR2: real("equity_curve_r2"),
  avgMae: real("avg_mae"),
  avgMfe: real("avg_mfe"),
  styleCluster: text("style_cluster"), // SNIPER | SCALPER | SWING | NEWS
  compositeScore: real("composite_score"),
  calculatedAt: integer("calculated_at").notNull().default(nowUnix),
});

// Admin-owned watchlists for promising traders
export const scoutWatchlists = pgTable(
  "scout_watchlists",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull().default("B_LIST"), // A_LIST | B_LIST | INCUBATOR
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    adminUserUniqueIdx: uniqueIndex("scout_watchlists_admin_user_uidx").on(table.adminId, table.userId),
    userTierIdx: index("scout_watchlists_user_tier_idx").on(table.userId, table.tier),
  }),
);

// Recruitment pipeline state for each trader
export const recruitingPipeline = pgTable("recruiting_pipeline", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stage: text("stage").notNull().default("DETECTED"),
  assignedAdminId: integer("assigned_admin_id").references(() => users.id, { onDelete: "set null" }),
  lastContactedAt: integer("last_contacted_at"),
  notes: text("notes"),
  isPartnerVisible: boolean("is_partner_visible").notNull().default(false),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// External partner organizations (API key hash only)
export const partners = pgTable(
  "partners",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    apiKeyPrefix: text("api_key_prefix"),
    ipWhitelist: text("ip_whitelist").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    contactEmail: text("contact_email"),
    contactUsername: text("contact_username"),
    tempPasswordHash: text("temp_password_hash"),
    inviteTokenHash: text("invite_token_hash"),
    inviteExpiresAt: integer("invite_expires_at"),
    passwordRotatedAt: integer("password_rotated_at"),
    loginCount: integer("login_count").notNull().default(0),
    inviteStatus: text("invite_status").notNull().default("ACTIVE"), // INVITED | ACTIVE | REVOKED
    onboardingStep: text("onboarding_step").notNull().default("PROFILE"), // PROFILE | IDENTITY | LEGAL | WAITING_APPROVAL | COMPLETED
    profileData: text("profile_data").notNull().default("{}"), // JSON: { fundName, aumRange, hqLocation, strategyTags[] }
    fundLogoUrl: text("fund_logo_url"),
    aumRange: text("aum_range"),
    hqLocation: text("hq_location"),
    strategyTags: text("strategy_tags").notNull().default("[]"), // JSON array mirror for fast read
    kybDocUrl: text("kyb_doc_url"),
    agreementsSignedAt: integer("agreements_signed_at"),
    contactAccessRequestedAt: integer("contact_access_requested_at"),
    approvedAt: integer("approved_at"),
    gatingOverrides: text("gating_overrides").notNull().default("{}"), // JSON per-partner gate overrides
    adminNotes: text("admin_notes"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
    lastKeyRotatedAt: integer("last_key_rotated_at"),
  },
  (table) => ({
    apiKeyHashUniqueIdx: uniqueIndex("partners_api_key_hash_uidx").on(table.apiKeyHash),
    activeIdx: index("partners_active_idx").on(table.isActive, table.updatedAt),
  }),
);

export const partnerInvites = pgTable(
  "partner_invites",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id").references(() => users.id, { onDelete: "set null" }),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    partnerEmail: text("partner_email").notNull(),
    fundName: text("fund_name"),
    adminNotes: text("admin_notes"),
    expiresInDays: integer("expires_in_days").notNull().default(7),
    invitedAt: integer("invited_at").notNull().default(nowUnix),
    emailStatus: text("email_status").notNull().default("QUEUED"), // QUEUED | SENT | DELIVERED | OPENED | FAILED | SKIPPED
    inviteTokenHash: text("invite_token_hash"),
    emailProviderMessageId: text("email_provider_message_id"),
    emailStatusDetail: text("email_status_detail"),
  },
  (table) => ({
    partnerInvitedIdx: index("partner_invites_partner_invited_idx").on(table.partnerId, table.invitedAt),
    adminInvitedIdx: index("partner_invites_admin_invited_idx").on(table.adminId, table.invitedAt),
    emailIdx: index("partner_invites_email_idx").on(table.partnerEmail),
  }),
);

// Partner virtual allocations (vSMA)
export const partnerAllocations = pgTable(
  "partner_allocations",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHashId: text("user_hash_id").notNull(),
    capitalUsd: real("capital_usd").notNull(),
    shadowStopPct: real("shadow_stop_pct"), // 0.03 => 3%
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | STOPPED | CLOSED
    currentPnlUsd: real("current_pnl_usd").notNull().default(0),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    partnerStatusIdx: index("partner_allocations_partner_status_idx").on(table.partnerId, table.status),
    userStatusIdx: index("partner_allocations_user_status_idx").on(table.userId, table.status),
  }),
);

// Partner requests for information, bridged via admin mailbox
export const partnerInquiries = pgTable(
  "partner_inquiries",
  {
    id: serial("id").primaryKey(),
    partnerId: integer("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    userHashId: text("user_hash_id"),
    senderName: text("sender_name"),
    senderEmail: text("sender_email"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("OPEN"), // OPEN | FORWARDED | ANSWERED | CLOSED
    mailboxThreadId: integer("mailbox_thread_id").references(() => mailboxThreads.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    partnerStatusIdx: index("partner_inquiries_partner_status_idx").on(table.partnerId, table.status),
    mailboxThreadIdx: index("partner_inquiries_mailbox_thread_idx").on(table.mailboxThreadId),
  }),
);

// Trader self-managed talent profile
export const traderProfiles = pgTable("trader_profiles", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  bio: text("bio"),
  strategy: text("strategy"),
  pinnedTradeIds: text("pinned_trade_ids").notNull().default("[]"), // JSON array of trade IDs
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// Admin-defined challenge templates
export const challenges = pgTable(
  "challenges",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),

    // Legacy single-phase fields (kept for compatibility + fallback behavior)
    profitTargetPct: real("profit_target_pct").notNull(),
    maxDailyLossPct: real("max_daily_loss_pct").notNull(),
    maxTotalLossPct: real("max_total_loss_pct"),
    minTradingDays: integer("min_trading_days"),
    durationDays: integer("duration_days").notNull(),

    // Identity & presentation
    category: text("category").notNull().default("GENERAL"),
    tier: text("tier").notNull().default("OPEN"),
    slug: text("slug"),
    tags: text("tags").notNull().default(""),
    iconColor: text("icon_color"),

    // Capital/risk defaults
    virtualCapitalUsd: real("virtual_capital_usd").notNull().default(100000),
    capitalMode: text("capital_mode").notNull().default("VIRTUAL"), // VIRTUAL | SNAPSHOT_EQUITY
    leverageMultiplier: real("leverage_multiplier").notNull().default(1),

    // Enrollment controls
    maxEnrollments: integer("max_enrollments"),
    maxActiveEnrollments: integer("max_active_enrollments"),
    maxRetriesPerTrader: integer("max_retries_per_trader").notNull().default(0),
    retryCooldownHours: integer("retry_cooldown_hours").notNull().default(0),
    eligibilityGate: text("eligibility_gate").notNull().default("{}"),

    // Scheduling/visibility
    startAt: integer("start_at"),
    endAt: integer("end_at"),
    enrollmentStartAt: integer("enrollment_start_at"),
    enrollmentEndAt: integer("enrollment_end_at"),
    visibleToTraders: boolean("visible_to_traders").notNull().default(true),
    featuredOrder: integer("featured_order").notNull().default(0),

    // Rewards
    prizePoolEnabled: boolean("prize_pool_enabled").notNull().default(false),
    prizePoolUsd: real("prize_pool_usd").notNull().default(0),
    prizeDistributionJson: text("prize_distribution_json").notNull().default("{}"),
    prizeMinCompletions: integer("prize_min_completions").notNull().default(0),
    prizeAwardTiming: text("prize_award_timing").notNull().default("ON_COMPLETE"),
    badgesEnabled: boolean("badges_enabled").notNull().default(false),
    badgeOnPass: text("badge_on_pass"),
    badgeOnTop3: text("badge_on_top3"),
    certificateEnabled: boolean("certificate_enabled").notNull().default(false),
    certificateDownloadable: boolean("certificate_downloadable").notNull().default(true),
    certificateShareable: boolean("certificate_shareable").notNull().default(true),
    certificateTemplateId: integer("certificate_template_id"),
    certificateIncludeMetrics: boolean("certificate_include_metrics").notNull().default(true),
    selectionBoostEnabled: boolean("selection_boost_enabled").notNull().default(false),
    selectionBoostPoints: integer("selection_boost_points").notNull().default(0),
    partnerVisibilityOnPass: boolean("partner_visibility_on_pass").notNull().default(true),
    autoWatchlistTier: text("auto_watchlist_tier"),
    progressionTierId: integer("progression_tier_id"),
    customRewardJson: text("custom_reward_json").notNull().default("{}"),
    leaderboardEnabled: boolean("leaderboard_enabled").notNull().default(true),
    leaderboardAnonymize: boolean("leaderboard_anonymize").notNull().default(false),
    leaderboardMaxVisible: integer("leaderboard_max_visible").notNull().default(100),

    // Lifecycle
    isActive: boolean("is_active").notNull().default(false),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
    updatedBy: text("updated_by"),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("challenges_slug_uidx").on(table.slug),
    activeIdx: index("challenges_active_idx").on(
      table.isActive,
      table.visibleToTraders,
      table.featuredOrder,
      table.updatedAt,
    ),
    enrollmentWindowIdx: index("challenges_enrollment_window_idx").on(table.enrollmentStartAt, table.enrollmentEndAt),
  }),
);

// Per-user challenge enrollments and running status
export const challengeEnrollments = pgTable(
  "challenge_enrollments",
  {
    id: serial("id").primaryKey(),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | PASSED | FAILED | WITHDRAWN | REVIEW_REQUIRED
    enrolledAt: integer("enrolled_at").notNull().default(nowUnix),
    completedAt: integer("completed_at"),
    currentPnlPct: real("current_pnl_pct").notNull().default(0),
    maxDailyLossHit: real("max_daily_loss_hit"),
    currentPhase: integer("current_phase").notNull().default(1),
    snapshotEquity: real("snapshot_equity"),
    capitalBaseUsed: real("capital_base_used"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    maxTotalLossHit: real("max_total_loss_hit"),
    peakEquity: real("peak_equity"),
    phaseStartedAt: integer("phase_started_at"),
    adminNotes: text("admin_notes"),
    lastWarningEvent: text("last_warning_event"),
    lastWarningAt: integer("last_warning_at"),
    tradingDays: integer("trading_days").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    challengeUserUniqueIdx: uniqueIndex("challenge_enrollments_challenge_user_uidx").on(table.challengeId, table.userId),
    userStatusIdx: index("challenge_enrollments_user_status_idx").on(table.userId, table.status),
  }),
);

// Challenges v4: per-challenge phase rules
export const challengePhases = pgTable(
  "challenge_phases",
  {
    id: serial("id").primaryKey(),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    phaseNumber: integer("phase_number").notNull(),
    phaseName: text("phase_name"),
    profitTargetPct: real("profit_target_pct").notNull(),
    maxDailyLossPct: real("max_daily_loss_pct").notNull(),
    maxTotalLossPct: real("max_total_loss_pct"),
    drawdownType: text("drawdown_type").notNull().default("STATIC"), // STATIC | TRAILING
    durationDays: integer("duration_days").notNull().default(1),
    minTradingDays: integer("min_trading_days"),
    maxSingleDayProfitPct: real("max_single_day_profit_pct"),
    allowWeekendHolding: boolean("allow_weekend_holding").notNull().default(true),
    allowNewsTrading: boolean("allow_news_trading").notNull().default(true),
    restrictedSymbolsCsv: text("restricted_symbols_csv").notNull().default(""),
    maxConcurrentPositions: integer("max_concurrent_positions"),
    maxLotSize: real("max_lot_size"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    challengePhaseUniqueIdx: uniqueIndex("challenge_phases_challenge_phase_uidx").on(table.challengeId, table.phaseNumber),
    challengeIdx: index("challenge_phases_challenge_idx").on(table.challengeId, table.phaseNumber),
  }),
);

// Append-only challenge enrollment event chain
export const challengeEnrollmentEvents = pgTable(
  "challenge_enrollment_events",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventAt: integer("event_at").notNull().default(nowUnix),
    actorType: text("actor_type").notNull().default("SYSTEM"),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    phaseNumber: integer("phase_number"),
    detailsJson: text("details_json").notNull().default("{}"),
    pnlSnapshotPct: real("pnl_snapshot_pct"),
    dailyLossSnapshot: real("daily_loss_snapshot"),
    totalDdSnapshot: real("total_dd_snapshot"),
    tradingDaysSnapshot: integer("trading_days_snapshot"),
    note: text("note"),
    prevHash: text("prev_hash"),
    eventHash: text("event_hash").notNull().default(""),
  },
  (table) => ({
    enrollmentAtIdx: index("challenge_enrollment_events_enrollment_at_idx").on(table.enrollmentId, table.eventAt),
    typeAtIdx: index("challenge_enrollment_events_type_at_idx").on(table.eventType, table.eventAt),
  }),
);

export const challengeBadges = pgTable(
  "challenge_badges",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    iconUrl: text("icon_url"),
    iconEmoji: text("icon_emoji"),
    category: text("category").notNull().default("GENERAL"),
    criteriaJson: text("criteria_json").notNull().default("{}"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    keyUid: uniqueIndex("challenge_badges_key_uidx").on(table.key),
    activeIdx: index("challenge_badges_active_idx").on(table.isActive, table.createdAt),
  }),
);

export const challengeBadgeAwards = pgTable(
  "challenge_badge_awards",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: integer("badge_id")
      .notNull()
      .references(() => challengeBadges.id, { onDelete: "cascade" }),
    challengeId: integer("challenge_id").references(() => challenges.id, { onDelete: "set null" }),
    enrollmentId: integer("enrollment_id").references(() => challengeEnrollments.id, { onDelete: "set null" }),
    awardedAt: integer("awarded_at").notNull().default(nowUnix),
    awardedReason: text("awarded_reason"),
  },
  (table) => ({
    uniq: uniqueIndex("challenge_badge_awards_user_badge_enroll_uidx").on(table.userId, table.badgeId, table.enrollmentId),
    userAwardedIdx: index("challenge_badge_awards_user_awarded_idx").on(table.userId, table.awardedAt),
  }),
);

export const challengePrizeAwards = pgTable(
  "challenge_prize_awards",
  {
    id: serial("id").primaryKey(),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    prizeAmountUsd: real("prize_amount_usd").notNull().default(0),
    status: text("status").notNull().default("PENDING"), // PENDING | APPROVED | PAID | CANCELLED
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: integer("approved_at"),
    paidAt: integer("paid_at"),
    note: text("note"),
    prevHash: text("prev_hash"),
    eventHash: text("event_hash").notNull().default(""),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    challengeRankIdx: index("challenge_prize_awards_challenge_rank_idx").on(table.challengeId, table.rank),
    userCreatedIdx: index("challenge_prize_awards_user_created_idx").on(table.userId, table.createdAt),
    uniq: uniqueIndex("challenge_prize_awards_uidx").on(table.challengeId, table.userId, table.enrollmentId),
  }),
);

export const challengeCertificateTemplates = pgTable(
  "challenge_certificate_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    headerText: text("header_text").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    includeMetrics: boolean("include_metrics").notNull().default(true),
    includeVerificationCode: boolean("include_verification_code").notNull().default(true),
    brandColor: text("brand_color"),
    logoUrl: text("logo_url"),
    isDownloadable: boolean("is_downloadable").notNull().default(true),
    isShareable: boolean("is_shareable").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    activeIdx: index("challenge_certificate_templates_active_idx").on(table.isActive, table.updatedAt),
  }),
);

export const challengeProgressionTiers = pgTable(
  "challenge_progression_tiers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    tiersJson: text("tiers_json").notNull().default("[]"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    activeIdx: index("challenge_progression_tiers_active_idx").on(table.isActive, table.updatedAt),
  }),
);

export const challengeUserProgression = pgTable("challenge_user_progression", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentTier: text("current_tier").notNull().default("NONE"),
  challengesPassed: integer("challenges_passed").notNull().default(0),
  top3Count: integer("top3_count").notNull().default(0),
  avgPnlPct: real("avg_pnl_pct").notNull().default(0),
  totalDqs: integer("total_dqs").notNull().default(0),
  tierAdvancedAt: integer("tier_advanced_at"),
  progressionPlanId: integer("progression_plan_id").references(() => challengeProgressionTiers.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

export const challengeSelectionBoosts = pgTable(
  "challenge_selection_boosts",
  {
    id: serial("id").primaryKey(),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    points: real("points").notNull().default(0),
    reason: text("reason"),
    awardedAt: integer("awarded_at").notNull().default(nowUnix),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    uniq: uniqueIndex("challenge_selection_boosts_uidx").on(table.challengeId, table.userId, table.enrollmentId),
    userAwardedIdx: index("challenge_selection_boosts_user_awarded_idx").on(table.userId, table.awardedAt),
  }),
);

export const challengeCertificates = pgTable(
  "challenge_certificates",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    templateId: integer("template_id").references(() => challengeCertificateTemplates.id, { onDelete: "set null" }),
    verificationCodeNonce: text("verification_code_nonce"),
    verificationHmacKeyId: text("verification_hmac_key_id").notNull().default("legacy"),
    verificationCodeHmac: text("verification_code_hmac").notNull(),
    metricsJson: text("metrics_json").notNull().default("{}"),
    isDownloadable: boolean("is_downloadable").notNull().default(true),
    isShareable: boolean("is_shareable").notNull().default(true),
    shareTokenHash: text("share_token_hash"),
    issuedAt: integer("issued_at").notNull().default(nowUnix),
    downloadedAt: integer("downloaded_at"),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    enrollmentUid: uniqueIndex("challenge_certificates_enrollment_uidx").on(table.enrollmentId),
    userIssuedIdx: index("challenge_certificates_user_issued_idx").on(table.userId, table.issuedAt),
    verifyIdx: index("challenge_certificates_verify_idx").on(table.verificationCodeHmac),
    shareIdx: index("challenge_certificates_share_idx").on(table.shareTokenHash),
  }),
);

export const challengeRewardLedger = pgTable(
  "challenge_reward_ledger",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    rewardKey: text("reward_key").notNull(),
    actionType: text("action_type").notNull(),
    runId: text("run_id"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    uniq: uniqueIndex("challenge_reward_ledger_uidx").on(table.enrollmentId, table.trigger, table.rewardKey),
    challengeIdx: index("challenge_reward_ledger_challenge_idx").on(table.challengeId, table.createdAt),
    userIdx: index("challenge_reward_ledger_user_idx").on(table.userId, table.createdAt),
    runIdx: index("challenge_reward_ledger_run_idx").on(table.runId, table.createdAt),
  }),
);

export const challengeEvaluationRuns = pgTable(
  "challenge_evaluation_runs",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    status: text("status").notNull().default("RUNNING"), // RUNNING | SUCCESS | FAILED | SKIPPED_LOCK
    startedAt: integer("started_at").notNull().default(nowUnix),
    endedAt: integer("ended_at"),
    processedCount: integer("processed_count").notNull().default(0),
    advancedCount: integer("advanced_count").notNull().default(0),
    passedCount: integer("passed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    warnedCount: integer("warned_count").notNull().default(0),
    errorJson: text("error_json"),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    runUid: uniqueIndex("challenge_evaluation_runs_run_uidx").on(table.runId),
    statusStartedIdx: index("challenge_evaluation_runs_status_started_idx").on(table.status, table.startedAt),
  }),
);

export const challengePhaseSnapshots = pgTable(
  "challenge_phase_snapshots",
  {
    id: serial("id").primaryKey(),
    enrollmentId: integer("enrollment_id")
      .notNull()
      .references(() => challengeEnrollments.id, { onDelete: "cascade" }),
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phaseNumber: integer("phase_number").notNull(),
    runId: text("run_id"),
    pnlBasis: text("pnl_basis").notNull().default("REALIZED_ONLY"),
    roundingMode: text("rounding_mode").notNull().default("HALF_AWAY_FROM_ZERO_8DP"),
    inputHash: text("input_hash").notNull(),
    tradeCount: integer("trade_count").notNull().default(0),
    totalPnl: real("total_pnl").notNull().default(0),
    pnlPct: real("pnl_pct").notNull().default(0),
    tradingDays: integer("trading_days").notNull().default(0),
    worstDayLossPct: real("worst_day_loss_pct").notNull().default(0),
    bestDayProfitPct: real("best_day_profit_pct").notNull().default(0),
    startDdPct: real("start_dd_pct").notNull().default(0),
    trailingDdPct: real("trailing_dd_pct").notNull().default(0),
    peakEquity: real("peak_equity").notNull().default(0),
    computedAt: integer("computed_at").notNull().default(nowUnix),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    uniq: uniqueIndex("challenge_phase_snapshots_uidx").on(table.enrollmentId, table.phaseNumber, table.inputHash),
    challengeComputedIdx: index("challenge_phase_snapshots_challenge_computed_idx").on(table.challengeId, table.computedAt),
    runIdx: index("challenge_phase_snapshots_run_idx").on(table.runId, table.computedAt),
  }),
);

export const challengeLeaderboardSnapshot = pgTable(
  "challenge_leaderboard_snapshot",
  {
    challengeId: integer("challenge_id")
      .notNull()
      .references(() => challenges.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    pnlPct: real("pnl_pct").notNull(),
    tradingDays: integer("trading_days").notNull().default(0),
    maxDailyLossHit: real("max_daily_loss_hit"),
    compositeScore: real("composite_score"),
    calculatedAt: integer("calculated_at").notNull().default(nowUnix),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.challengeId, table.userId] }),
    rankIdx: index("challenge_leaderboard_snapshot_rank_idx").on(table.challengeId, table.rank),
    calcIdx: index("challenge_leaderboard_snapshot_calc_idx").on(table.challengeId, table.calculatedAt),
  }),
);

export const marketDataProviders = pgTable(
  "market_data_providers",
  {
    id: serial("id").primaryKey(),
    providerKey: text("provider_key").notNull().unique(),
    displayName: text("display_name").notNull(),
    driver: text("driver").notNull(), // twelvedata|oneforge|generic_rest_v1
    configJson: text("config_json").notNull().default("{}"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
    deletedAt: integer("deleted_at"),
  },
);

export const instrumentReference = pgTable(
  "instrument_reference",
  {
    id: serial("id").primaryKey(),
    providerKey: text("provider_key").notNull(),
    category: text("category").notNull(),
    canonicalSymbol: text("canonical_symbol").notNull(),
    providerSymbol: text("provider_symbol").notNull(),
    name: text("name"),
    currency: text("currency"),
    exchange: text("exchange"),
    country: text("country"),
    type: text("type"),
    currencyBase: text("currency_base"),
    currencyQuote: text("currency_quote"),
    region: text("region"),
    metaJson: text("meta_json").notNull().default("{}"),
    lastRefreshedAt: integer("last_refreshed_at").notNull().default(nowUnix),
  },
  (table) => ({
    uniq: uniqueIndex("instrument_reference_unique").on(table.providerKey, table.canonicalSymbol, table.providerSymbol),
    providerCategoryIdx: index("instrument_reference_provider_category_idx").on(table.providerKey, table.category, table.lastRefreshedAt),
  }),
);

export const pipCategoryDefaults = pgTable("pip_category_defaults", {
  category: text("category").primaryKey(),
  pipDecimals: integer("pip_decimals").notNull(),
  quoteDecimals: integer("quote_decimals"),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
  updatedByAdminId: integer("updated_by_admin_id"),
});

// i18n (dynamic UI translations) tables
export const i18nManifestVersions = pgTable("i18n_manifest_versions", {
  id: serial("id").primaryKey(),
  version: text("version").notNull().unique(),
  generatedAt: integer("generated_at"),
  ingestedAt: integer("ingested_at").notNull().default(nowUnix),
  entryCount: integer("entry_count").notNull().default(0),
});

export const i18nSourceStrings = pgTable("i18n_source_strings", {
  stringId: text("string_id").primaryKey(),
  defaultText: text("default_text").notNull(),
  checksum: text("checksum").notNull(),
  file: text("file"),
  kind: text("kind"),
  propName: text("prop_name"),
  line: integer("line"),
  column: integer("column"),
  firstSeenAt: integer("first_seen_at").notNull().default(nowUnix),
  lastSeenAt: integer("last_seen_at").notNull().default(nowUnix),
  lastModifiedAt: integer("last_modified_at").notNull().default(nowUnix),
});

export const i18nTranslations = pgTable(
  "i18n_translations",
  {
    stringId: text("string_id").notNull().references(() => i18nSourceStrings.stringId),
    locale: text("locale").notNull(),
    translatedText: text("translated_text").notNull(),
    sourceChecksum: text("source_checksum").notNull(),
    provider: text("provider"),
    model: text("model"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.stringId, table.locale] }),
    localeIdx: index("idx_i18n_tr_locale").on(table.locale, table.updatedAt),
  }),
);

export const i18nTranslationJobs = pgTable(
  "i18n_translation_jobs",
  {
    id: serial("id").primaryKey(),
    stringId: text("string_id").notNull().references(() => i18nSourceStrings.stringId),
    locale: text("locale").notNull(),
    status: text("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    uniqueStringLocale: uniqueIndex("idx_i18n_jobs_string_locale").on(table.stringId, table.locale),
    statusIdx: index("idx_i18n_jobs_status").on(table.status, table.updatedAt),
  }),
);

// Market session daily close table
export const marketDailyClose = pgTable(
  "market_daily_close",
  {
    symbol: text("symbol").notNull(),
    sessionDay: text("session_day").notNull(),
    close: real("close").notNull(),
    closeTsMs: bigint("close_ts_ms", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.symbol, table.sessionDay] }),
    symbolDayIdx: index("idx_mdc_symbol_day").on(table.symbol, table.sessionDay),
  }),
);

// Daily P&L snapshots (admin analytics)
export const dailyCloses = pgTable(
  "daily_closes",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),
    userId: integer("user_id").notNull().references(() => users.id),
    balance: real("balance").notNull(),
    profitDay: real("profit_day"),
    tradesClosed: integer("trades_closed"),
    tradesWon: integer("trades_won"),
  },
  (table) => ({
    userDateIdx: index("idx_daily_closes_user_date").on(table.userId, table.date),
  }),
);

// --- Signup freeze attempt logging (always recorded when blocked) ---
export const signupFreezeAttempts = pgTable("signup_freeze_attempts", {
  id: serial("id").primaryKey(),
  email: text("email"),
  emailLower: text("email_lower"),
  username: text("username"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
});

// --- Signup jurisdiction blocks (always recorded when blocked) ---
export const signupJurisdictionBlocks = pgTable("signup_jurisdiction_blocks", {
  id: serial("id").primaryKey(),
  email: text("email"),
  emailLower: text("email_lower"),
  username: text("username"),
  ip: text("ip"),
  userAgent: text("user_agent"),

  ipCountryIso2: text("ip_country_iso2"),
  selectedCountryIso2: text("selected_country_iso2"),

  reasonCode: text("reason_code").notNull(),
  policySnapshotJson: text("policy_snapshot_json"),

  createdAt: integer("created_at").notNull(),
});

// --- Signup waitlist entries (only created when user opts in) ---
export const signupWaitlist = pgTable("signup_waitlist", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  emailLower: text("email_lower").notNull(),
  source: text("source").notNull().default("PUBLIC_WAITLIST"),
  ip: text("ip"),
  userAgent: text("user_agent"),

  consentedAt: integer("consented_at").notNull(),
  consentDocVersion: text("consent_doc_version").notNull(),
  consentDocSha256: text("consent_doc_sha256").notNull(),
  consentDocContent: text("consent_doc_content").notNull(),
  consentSignature: text("consent_signature").notNull(),
  prevHash: text("prev_hash"),
  recordHash: text("record_hash").notNull(),

  status: text("status").notNull().default("PENDING"), // PENDING | INVITED | CONVERTED | OPTED_OUT

  invitedAt: integer("invited_at"),
  invitedByAdminId: integer("invited_by_admin_id"),
  inviteSendCount: integer("invite_send_count").notNull().default(0),
  lastInviteSentAt: integer("last_invite_sent_at"),
  lastInviteStatus: text("last_invite_status"), // SENT | FAILED
  lastInviteError: text("last_invite_error"),
  lastInviteFrom: text("last_invite_from"),
  lastInviteSubject: text("last_invite_subject"),
  lastInviteBodySha256: text("last_invite_body_sha256"),

  convertedAt: integer("converted_at"),
  convertedUserId: integer("converted_user_id"),

  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
