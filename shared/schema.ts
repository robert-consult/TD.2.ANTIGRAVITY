import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

// User tier type for tiered access system
export type UserTier = "CANDIDATE" | "PERFORMER" | "SELECTED";
export type ContenderTier = "NONE" | "CANDIDATE_EMAIL_ONLY" | "CANDIDATE_SMS_REQUIRED" | "VERIFIED_SMS" | "SELECTED_REAL_CAPITAL";

// Users table
export const users = sqliteTable("users", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  name: text("name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  displayName: text("display_name"),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  balance: text("balance").notNull().default("1000000.00"),
  startingEquity: real("starting_equity").default(1000000), // Initial equity for tier calculations
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  isDisabled: integer("is_disabled", { mode: "boolean" }).notNull().default(false), // Account disabled flag
  // Account lifecycle (inactivity + bot actions)
  deletionExempt: integer("deletion_exempt", { mode: "boolean" }).notNull().default(false),
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  inactivatedAt: integer("inactivated_at", { mode: "timestamp" }),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
  deletedMode: text("deleted_mode"),
  deletedReason: text("deleted_reason"),
  deletedByAdminId: integer("deleted_by_admin_id", { mode: "number" }),
  // Tiered access system
  userTier: text("user_tier").notNull().default("CANDIDATE"), // CANDIDATE | PERFORMER | SELECTED
  tierPromotedAt: integer("tier_promoted_at", { mode: "timestamp" }),
  tierPromotedBy: integer("tier_promoted_by", { mode: "number" }),
  selectedAt: integer("selected_at", { mode: "timestamp" }),
  // Margin-related fields
  leverage: real("leverage").notNull().default(5), // Default 5x leverage
  usedMargin: real("used_margin").notNull().default(0), // Margin currently in use
  equity: real("equity").notNull().default(0), // Balance + floating P/L
  freeMargin: real("free_margin").notNull().default(0), // Equity - used margin
  // Account freeze controls (admin)
  isFrozen: integer("is_frozen", { mode: "boolean" }).notNull().default(false),
  freezeReasonCode: text("freeze_reason_code"),
  freezeReasonText: text("freeze_reason_text"),
  frozenAt: integer("frozen_at", { mode: "timestamp" }),
  frozenBy: integer("frozen_by"),
  // User preferences
  timezone: text("timezone").default("UTC"),
  language: text("language").default("en"),
  country: text("country"),
  // Jurisdiction selection (ISO-3166-1 alpha-2) + regional grouping
  countryIso2: text("country_iso2"),
  regionKey: text("region_key"),
  // Verification status for compliance tracking
  kycStatus: text("kyc_status").default("none"), // none, pending, approved, rejected, reverify_required
  kycVerifiedAt: integer("kyc_verified_at", { mode: "timestamp" }),
  kycExpiresAt: integer("kyc_expires_at", { mode: "timestamp" }),
  
  // Signup fingerprinting (denormalized for quick access)
  signupIp: text("signup_ip"),
  signupIpHash: text("signup_ip_hash"), // SHA-256 for privacy-safe indexing
  signupUserAgent: text("signup_user_agent"),
  signupCountryCode: text("signup_country_code"),
  signupRegion: text("signup_region"),
  signupCity: text("signup_city"),
  signupLatitude: real("signup_latitude"),
  signupLongitude: real("signup_longitude"),
  signupDeviceType: text("signup_device_type"),
  signupBrowser: text("signup_browser"),
  signupOs: text("signup_os"),
  signupClientTz: text("signup_client_tz"),
  signupInferredTz: text("signup_inferred_tz"),
  signupDeviceFp: text("signup_device_fp"),
  signupDeviceInstallId: text("signup_device_install_id"),
  signupClientLang: text("signup_client_lang"),
});

// Signup fingerprints - immutable audit record (write-once per signup)
export const signupFingerprints = sqliteTable("signup_fingerprints", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull().unique(), // One per user, immutable
  requestId: text("request_id").notNull(), // UUID for request correlation
  
  // Network identity
  ip: text("ip").notNull(),
  ipHash: text("ip_hash").notNull(), // SHA-256 for privacy-safe joins
  
  // User agent & device
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  
  // Geo enrichment
  countryCode: text("country_code"),
  region: text("region"),
  city: text("city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  inferredTz: text("inferred_tz"),
  
  // Client identity headers
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  
  // Registration context
  countryIso2Selected: text("country_iso2_selected"), // Country user selected at signup
  regionKeySelected: text("region_key_selected"), // Region from terms token
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Active user sessions table (for session management)
export const userSessions = sqliteTable("user_sessions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique(), // Express session ID
  userId: integer("user_id", { mode: "number" }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // desktop, mobile, tablet
  browser: text("browser"),
  os: text("os"),
  isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastActiveAt: integer("last_active_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  // Device identity columns (for grift detection)
  deviceFp: text("device_fp"), // Hashed browser fingerprint
  deviceInstallId: text("device_install_id"), // LocalStorage UUID
  clientTz: text("client_tz"), // Client-reported timezone
  clientLang: text("client_lang"), // Client-reported language
  // Geo-enrichment fields
  countryCode: text("country_code"),
  region: text("region"),
  city: text("city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  inferredTz: text("inferred_tz"), // IANA timezone derived from geo
  // Revocation tracking
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  revokedByUserId: integer("revoked_by_user_id", { mode: "number" }),
  revokeReason: text("revoke_reason"),
});

// Symbol configurations
export const symbolConfigs = sqliteTable("symbol_configs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  baseCurrency: text("base_currency"),
  quoteCurrency: text("quote_currency"),
  spread: real("spread"),
  minSpreadPips: real("min_spread_pips").default(2.0), // Minimum spread in pips (2 pips default)
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  minLot: integer("min_lot", { mode: "number" }).notNull().default(100000), // 1 standard lot = $100,000
  maxLot: integer("max_lot", { mode: "number" }).notNull().default(5000000), // 50 standard lots
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Trade history
export const trades = sqliteTable("trades", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull().references(() => users.id),
  symbolId: integer("symbol_id", { mode: "number" }).notNull().references(() => symbolConfigs.id),
  type: text("type").notNull(), // BUY or SELL
  orderType: text("order_type").notNull().default("Market"), // Market, Limit, Stop
  size: integer("size", { mode: "number" }).notNull(),
  lots: integer("lots", { mode: "number" }), // Number of lots (1 lot = $100,000)
  openPrice: real("open_price").notNull(),
  closePrice: real("close_price"),
  takeProfit: real("take_profit"),
  stopLoss: real("stop_loss"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  profit: text("profit"),
  status: text("status").notNull().default("PENDING"), // PENDING, OPEN, CLOSED, CANCELED
  openedAt: integer("opened_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  executedAt: integer("executed_at", { mode: "timestamp" }),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  // Audit fields for trade close tracking
  closeReason: text("close_reason"), // e.g. "AUTO_TIME_LIMIT", "MANUAL"
  closeQuoteTs: integer("close_quote_ts", { mode: "timestamp" }), // quote timestamp
  closeSource: text("close_source"), // e.g. "1forge", "quotes_db", "stale:quotes_db"
  closeBid: real("close_bid"),
  closeAsk: real("close_ask"),
  closeMid: real("close_mid"),
  closeSpread: real("close_spread"),
  // Institutional audit provenance columns
  correlationId: text("correlation_id"),
  // Stable lifecycle identifiers (allocator-grade)
  orderId: text("order_id"),
  positionId: text("position_id"),
  lastExecutionId: text("last_execution_id"),
  lastActorUserId: integer("last_actor_user_id", { mode: "number" }),
  lastActorSessionId: text("last_actor_session_id"),
  lastActorIp: text("last_actor_ip"),
  lastActorUserAgent: text("last_actor_user_agent"),
  lastActorType: text("last_actor_type"),
  lastActorDeviceId: text("last_actor_device_id"), // Device identifier for grift detection
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  trades: many(trades),
}));

export const symbolConfigsRelations = relations(symbolConfigs, ({ many }) => ({
  trades: many(trades),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  user: one(users, {
    fields: [trades.userId],
    references: [users.id],
  }),
  symbol: one(symbolConfigs, {
    fields: [trades.symbolId],
    references: [symbolConfigs.id],
  }),
}));

// Schemas for validation
export const insertUserSchema = createInsertSchema(users, {
  email: (schema) => schema.email("Please enter a valid email"),
  username: (schema) => schema.min(3, "Username must be at least 3 characters"),
  passwordHash: (schema) => schema.min(8, "Password must be at least 8 characters"),
  balance: (schema) => schema.optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(25, "Password must be at most 25 characters"),
});

export const insertSymbolConfigSchema = createInsertSchema(symbolConfigs);
// Create a custom lots validator that handles string values
const lotsValidator = z.preprocess(
  (val) => {
    // Convert string to number if needed
    if (typeof val === 'string') {
      return parseInt(val, 10);
    }
    return val;
  },
  z.number().int().min(1).max(50)
);

export const insertTradeSchema = createInsertSchema(trades, {
  size: (schema) => schema.optional(),
  lots: () => lotsValidator,  // Use the custom validator for lots
  type: (schema) => schema.optional(),
  orderType: (schema) => schema.optional(),
  status: (schema) => schema.optional(),
  openPrice: (schema) => schema.optional(),
  takeProfit: (schema) => schema.optional(),
  stopLoss: (schema) => schema.optional(),
  limitPrice: (schema) => schema.optional(),
  stopPrice: (schema) => schema.optional(),
  openedAt: (schema) => schema.optional(),
});

// User settings table
export const userSettings = sqliteTable("user_settings", {
  userId: integer("user_id", { mode: "number" })
    .primaryKey()
    .references(() => users.id),
  leverage: real("leverage").notNull().default(50),
  maxConcurrent: integer("max_concurrent").notNull().default(5),
  maxConcurrentPerInstrument: integer("max_concurrent_per_instrument"),
  maxConcurrentLots: integer("max_concurrent_lots").notNull().default(50),
  minHoldSec: integer("min_hold_sec").notNull().default(60),
  maxHoldSec: integer("max_hold_sec").notNull().default(24 * 3600),
  showOnLeaderboard: integer("show_lb", { mode: "boolean" })
    .notNull()
    .default(true),
});

export const insertUserSettingsSchema = createInsertSchema(userSettings);

// Global settings table for admin-configured defaults
export const globalSettings = sqliteTable("global_settings", {
  id: integer("id", { mode: "number" }).primaryKey().default(1),
  // Default Risk Parameters
  defaultLeverage: real("default_leverage").notNull().default(50),
  maxPositionSize: real("max_position_size").notNull().default(100000),
  maxTradesPerUser: integer("max_trades_per_user").notNull().default(10),
  maxTradesPerInstrument: integer("max_trades_per_instrument").notNull().default(3),
  maxConcurrentLots: integer("max_concurrent_lots").notNull().default(50),
  // Market Hours
  marketOpenTime: text("market_open_time").notNull().default("09:00"),
  marketCloseTime: text("market_close_time").notNull().default("17:00"),
  allowWeekendTrading: integer("allow_weekend_trading", { mode: "boolean" }).notNull().default(false),
  // Auto-Close Settings and Minimum Hold Times
  enableAutoClose: integer("enable_auto_close", { mode: "boolean" }).notNull().default(true),
  autoCloseAfterDays: integer("auto_close_after_days").notNull().default(4),
  autoCloseCheckFrequencyMinutes: integer("auto_close_check_frequency_minutes").notNull().default(60),
  minHoldSec: integer("min_hold_sec").notNull().default(60),
  // Loss Limit Controls
  enableLossLimits: integer("enable_loss_limits", { mode: "boolean" }).notNull().default(true),
  dailyLossLimitPct: real("daily_loss_limit_pct").notNull().default(10),
  lifetimeLossLimitPct: real("lifetime_loss_limit_pct").notNull().default(20),
  // Timestamp
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const insertGlobalSettingsSchema = createInsertSchema(globalSettings);

// System config table for operational controls (separate from trade settings)
export const systemConfig = sqliteTable("system_config", {
  id: integer("id", { mode: "number" }).primaryKey().default(1),
  // Trading Controls (Safety Switches)
  maintenanceMode: integer("maintenance_mode", { mode: "boolean" }).notNull().default(false),
  tradingHalt: integer("trading_halt", { mode: "boolean" }).notNull().default(false),
  closeOnlyMode: integer("close_only_mode", { mode: "boolean" }).notNull().default(false),
  blockOpenOnStaleQuotes: integer("block_open_on_stale_quotes", { mode: "boolean" }).notNull().default(true),
  maintenanceMessage: text("maintenance_message").default("System is under maintenance. Trading will resume shortly."),
  // Market Data & Refresh Settings
  quoteRefreshMs: integer("quote_refresh_ms").notNull().default(870),
  feedPollMs: integer("feed_poll_ms").notNull().default(870),
  staleThresholdMs: integer("stale_threshold_ms").notNull().default(30000),
  fxRolloverTz: text("fx_rollover_tz").notNull().default("America/New_York"),
  fxRolloverTime: text("fx_rollover_time").notNull().default("17:00"),
  // Legal Coverage Enforcement
  legalCoverageEnforce: integer("legal_coverage_enforce", { mode: "boolean" }).notNull().default(false),
  // Jurisdiction restrictions (block signup/terms resolution)
  jurisdictionRestrictedIso2Csv: text("jurisdiction_restricted_iso2_csv")
    .notNull()
    .default("KP,IR,CU,SY"),
  jurisdictionRestrictedMessage: text("jurisdiction_restricted_message")
    .notNull()
    .default("This jurisdiction is not supported due to regulatory restrictions."),
  // Jurisdiction access controls (geo-blocking)
  jurisdictionEnforceByIpGeo: integer("jurisdiction_enforce_by_ip_geo", { mode: "boolean" })
    .notNull()
    .default(false),
  jurisdictionEnforceBySignupCountry: integer("jurisdiction_enforce_by_signup_country", { mode: "boolean" })
    .notNull()
    .default(true),
  jurisdictionBlockSignup: integer("jurisdiction_block_signup", { mode: "boolean" })
    .notNull()
    .default(true),
  jurisdictionBlockLogin: integer("jurisdiction_block_login", { mode: "boolean" })
    .notNull()
    .default(true),
  // Signup CAPTCHA settings
  signupCaptchaEnforce: integer("signup_captcha_enforce", { mode: "boolean" }).notNull().default(true),
  captchaProvider: text("captcha_provider").notNull().default("SLIDER"),
  // Signup phone capture requirement (optional enforcement)
  signupPhoneEnforce: integer("signup_phone_enforce", { mode: "boolean" }).notNull().default(true),
  // Signup capacity controls (freeze + invite waitlist)
  signupFreeze: integer("signup_freeze", { mode: "boolean" }).notNull().default(false),
  signupFreezeMessage: text("signup_freeze_message").notNull().default(
    "Signups are temporarily paused due to capacity. Existing users can still log in."
  ),
  signupWaitlistEnabled: integer("signup_waitlist_enabled", { mode: "boolean" }).notNull().default(true),
  signupWaitlistInviteSender: text("signup_waitlist_invite_sender").notNull().default("TradeQuip <noreply@tradequip.com>"),
  signupWaitlistInviteSubject: text("signup_waitlist_invite_subject").notNull().default("Signup slots are open again"),
  signupWaitlistInviteBodyText: text("signup_waitlist_invite_body_text").notNull().default(
    "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message."
  ),
  signupWaitlistAutoInviteOnUnfreeze: integer("signup_waitlist_auto_invite_on_unfreeze", { mode: "boolean" }).notNull().default(false),
  signupWaitlistInviteBatchCap: integer("signup_waitlist_invite_batch_cap", { mode: "number" }).notNull().default(200),
  signupWaitlistPolicyVersion: text("signup_waitlist_policy_version").notNull().default("1"),
  signupWaitlistPolicyContent: text("signup_waitlist_policy_content").notNull().default(
    "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support."
  ),
  // Activity / inactivity deletion controls
  inactivityThresholdDays: integer("inactivity_threshold_days", { mode: "number" }).notNull().default(90),
  deletionGraceDays: integer("deletion_grace_days", { mode: "number" }).notNull().default(30),
  activityAutoQueueInactive: integer("activity_auto_queue_inactive", { mode: "boolean" }).notNull().default(true),
  activityAutoSoftDelete: integer("activity_auto_soft_delete", { mode: "boolean" }).notNull().default(false),

  // Bot detection (adaptive PoW + score storage)
  botScoreThreshold: integer("bot_score_threshold", { mode: "number" }).notNull().default(40),
  botPowEnabled: integer("bot_pow_enabled", { mode: "boolean" }).notNull().default(true),
  botPowEnforceSignup: integer("bot_pow_enforce_signup", { mode: "boolean" }).notNull().default(true),
  botPowEnforceLogin: integer("bot_pow_enforce_login", { mode: "boolean" }).notNull().default(false),
  botPowChallengeScore: integer("bot_pow_challenge_score", { mode: "number" }).notNull().default(25),
  botPowBaseDifficulty: integer("bot_pow_base_difficulty", { mode: "number" }).notNull().default(14),
  botPowMaxDifficulty: integer("bot_pow_max_difficulty", { mode: "number" }).notNull().default(20),
  botPowTtlSec: integer("bot_pow_ttl_sec", { mode: "number" }).notNull().default(120),
  botValkeyEnabled: integer("bot_valkey_enabled", { mode: "boolean" }).notNull().default(true),

  // User preference policy
  allowUserTimezoneEdit: integer("allow_user_timezone_edit", { mode: "boolean" }).notNull().default(true),
  // Policy config: contender thresholds (admin-editable)
  policyContenderPath1MinAgeDays: integer("policy_contender_path1_min_age_days", { mode: "number" }).notNull().default(30),
  policyContenderPath1MinTradesLifetime: integer("policy_contender_path1_min_trades_lifetime", { mode: "number" }).notNull().default(30),
  policyContenderPath1MinBalancePct: real("policy_contender_path1_min_balance_pct").notNull().default(1.2),
  policyContenderPath2MinAgeDays: integer("policy_contender_path2_min_age_days", { mode: "number" }).notNull().default(90),
  policyContenderPath2MinTradesLast90: integer("policy_contender_path2_min_trades_last90", { mode: "number" }).notNull().default(20),
  policyContenderPath2MinReturnLast90: real("policy_contender_path2_min_return_last90").notNull().default(0.1),
  policyContenderPath2MaxDaysSinceLastTrade: integer("policy_contender_path2_max_days_since_last_trade", { mode: "number" }).notNull().default(14),
  policyAutoPromotePerformer: integer("policy_auto_promote_performer", { mode: "boolean" }).notNull().default(true),
  policyEmailResendCooldownSec: integer("policy_email_resend_cooldown_sec", { mode: "number" }).notNull().default(60),
  policyEmailDailySendCap: integer("policy_email_daily_send_cap", { mode: "number" }).notNull().default(5),
  policySmsDailySendCap: integer("policy_sms_daily_send_cap", { mode: "number" }).notNull().default(5),
  policySmsResendCooldownSec: integer("policy_sms_resend_cooldown_sec", { mode: "number" }).notNull().default(60),
  policyOtpMaxAttempts: integer("policy_otp_max_attempts", { mode: "number" }).notNull().default(5),
  policyOtpLockMinutes: integer("policy_otp_lock_minutes", { mode: "number" }).notNull().default(30),
  // i18n (dynamic UI translations)
  i18nEnabled: integer("i18n_enabled", { mode: "boolean" }).notNull().default(true),
  i18nDefaultLocale: text("i18n_default_locale").notNull().default("en"),
  i18nSupportedLocalesCsv: text("i18n_supported_locales_csv")
    .notNull()
    .default("en,fr,pt,es,de,ar,hi,id,zh,ms,tl,ko,ja,sw,th,bn,tr"),
  i18nAutoTranslate: integer("i18n_auto_translate", { mode: "boolean" }).notNull().default(true),
  i18nLlmEnabled: integer("i18n_llm_enabled", { mode: "boolean" }).notNull().default(true),
  i18nLlmProvider: text("i18n_llm_provider").notNull().default("openai"),
  i18nLlmModel: text("i18n_llm_model").notNull().default("gpt-4o-mini"),
  i18nLlmMaxBatchSize: integer("i18n_llm_max_batch_size", { mode: "number" }).notNull().default(50),
  i18nLlmMaxAttempts: integer("i18n_llm_max_attempts", { mode: "number" }).notNull().default(3),
  // Migration export/import chunking
  migrationChunkingEnabled: integer("migration_chunking_enabled", { mode: "boolean" }).notNull().default(false),
  migrationChunkSizeMb: integer("migration_chunk_size_mb", { mode: "number" }).notNull().default(51200),
  // Timestamp
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
  updatedBy: text("updated_by"),
});

export const insertSystemConfigSchema = createInsertSchema(systemConfig);

// --- Signup freeze attempt logging (always recorded when blocked) ---
export const signupFreezeAttempts = sqliteTable("signup_freeze_attempts", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  email: text("email"),
  emailLower: text("email_lower"),
  username: text("username"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

// --- Signup jurisdiction blocks (always recorded when blocked) ---
export const signupJurisdictionBlocks = sqliteTable("signup_jurisdiction_blocks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  email: text("email"),
  emailLower: text("email_lower"),
  username: text("username"),
  ip: text("ip"),
  userAgent: text("user_agent"),

  ipCountryIso2: text("ip_country_iso2"),
  selectedCountryIso2: text("selected_country_iso2"),

  reasonCode: text("reason_code").notNull(),
  policySnapshotJson: text("policy_snapshot_json"),

  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

// --- Signup waitlist entries (only created when user opts in) ---
export const signupWaitlist = sqliteTable("signup_waitlist", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  emailLower: text("email_lower").notNull(),
  source: text("source").notNull().default("PUBLIC_WAITLIST"),
  ip: text("ip"),
  userAgent: text("user_agent"),

  consentedAt: integer("consented_at", { mode: "number" }).notNull(),
  consentDocVersion: text("consent_doc_version").notNull(),
  consentDocSha256: text("consent_doc_sha256").notNull(),
  consentDocContent: text("consent_doc_content").notNull(),
  consentSignature: text("consent_signature").notNull(),
  prevHash: text("prev_hash"),
  recordHash: text("record_hash").notNull(),

  status: text("status").notNull().default("PENDING"), // PENDING | INVITED | CONVERTED | OPTED_OUT

  invitedAt: integer("invited_at", { mode: "number" }),
  invitedByAdminId: integer("invited_by_admin_id", { mode: "number" }),
  inviteSendCount: integer("invite_send_count", { mode: "number" }).notNull().default(0),
  lastInviteSentAt: integer("last_invite_sent_at", { mode: "number" }),
  lastInviteStatus: text("last_invite_status"), // SENT | FAILED
  lastInviteError: text("last_invite_error"),
  lastInviteFrom: text("last_invite_from"),
  lastInviteSubject: text("last_invite_subject"),
  lastInviteBodySha256: text("last_invite_body_sha256"),

  convertedAt: integer("converted_at", { mode: "number" }),
  convertedUserId: integer("converted_user_id", { mode: "number" }),

  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Trade audit table (backend-only for full execution audit trail) - INSTITUTIONAL GRADE
export const tradeAudit = sqliteTable("trade_audit", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  tradeId: integer("trade_id", { mode: "number" }).notNull().references(() => trades.id),
  
  // Event identification
  eventType: text("event_type").notNull(), // ORDER_PLACED, ORDER_FILLED, POSITION_CLOSED, ORDER_CANCELED, ORDER_REJECTED, RISK_CHECK_PASS, RISK_CHECK_FAIL, TARGETS_UPDATED, SL_TRIGGERED, TP_TRIGGERED
  eventCategory: text("event_category").notNull().default("TRADE"), // ORDER, EXECUTION, POSITION, RISK, ADMIN, SYSTEM
  eventAt: integer("event_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  eventAtMs: integer("event_at_ms"), // Millisecond precision timestamp
  
  // Correlation & lifecycle IDs
  correlationId: text("correlation_id"), // Links related events across the order lifecycle
  orderId: text("order_id"), // Unique per order intent
  executionId: text("execution_id"), // Unique per fill
  positionId: text("position_id"), // Unique per open position
  
  // Actor/provenance (who/where/how)
  actorType: text("actor_type").notNull().default("SYSTEM"), // USER, ADMIN, SYSTEM
  actorUserId: integer("actor_user_id", { mode: "number" }),
  sessionId: text("session_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  
  // Order economics
  symbol: text("symbol"),
  side: text("side"), // BUY, SELL
  orderType: text("order_type"), // MARKET, LIMIT, STOP, STOP_LIMIT
  timeInForce: text("time_in_force"), // GTC, DAY, IOC, FOK
  qtyLots: real("qty_lots"),
  
  // Pricing
  requestedPrice: real("requested_price"),
  triggerPrice: real("trigger_price"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  fillPrice: real("fill_price"),
  avgFillPrice: real("avg_fill_price"),
  
  // Market context at event time
  quoteTs: integer("quote_ts", { mode: "timestamp" }),
  quoteSource: text("quote_source"),
  quoteBid: real("quote_bid"),
  quoteAsk: real("quote_ask"),
  quoteMid: real("quote_mid"),
  quoteSpread: real("quote_spread"),
  spreadPips: real("spread_pips"),
  
  // Slippage analysis (TCA)
  slippage: real("slippage"),
  slippagePips: real("slippage_pips"),
  slippageReference: text("slippage_reference"), // MID, BIDASK, LAST, REQUESTED
  latencyMs: integer("latency_ms"), // Time from order receipt to execution
  
  // Risk control evidence
  riskCheckName: text("risk_check_name"), // e.g., MAX_CONCURRENT_LOTS, MAX_TRADES_PER_SYMBOL
  riskLimitValue: real("risk_limit_value"), // The limit that was enforced
  riskObservedValue: real("risk_observed_value"), // The value at decision time
  riskResult: text("risk_result"), // PASS, FAIL, OVERRIDE
  reasonCode: text("reason_code"), // Standardized rejection code
  
  // Data integrity (tamper-evident hash chain)
  payloadJson: text("payload_json"), // Canonical JSON for forensic replay
  prevHash: text("prev_hash"), // Hash of previous event
  eventHash: text("event_hash"), // SHA-256 hash for tamper-evidence
  
  note: text("note"),
});

export const tradeAuditRelations = relations(tradeAudit, ({ one }) => ({
  trade: one(trades, {
    fields: [tradeAudit.tradeId],
    references: [trades.id],
  }),
}));

// Order Intent Audit - captures RECEIVED and DECISION events for full order lifecycle
export const orderIntentAudit = sqliteTable("order_intent_audit", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  correlationId: text("correlation_id").notNull(), // Links to trade_audit events
  
  // Timestamps
  eventAt: integer("event_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  eventAtMs: integer("event_at_ms"), // Millisecond precision
  
  // Event type
  eventCode: text("event_code").notNull(), // ORDER_RECEIVED, ORDER_VALIDATED, RISK_CHECK, DECISION
  decision: text("decision"), // PASS, REJECT (for DECISION events)
  rejectCheck: text("reject_check"), // Which check failed (e.g., MAX_CONCURRENT_LOTS)
  rejectReason: text("reject_reason"), // Human-readable reason
  
  // Actor/provenance
  actorType: text("actor_type").notNull().default("USER"), // USER, ADMIN, SYSTEM
  userId: integer("user_id", { mode: "number" }).notNull(),
  sessionId: text("session_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  
  // Order economics
  symbol: text("symbol"),
  side: text("side"), // BUY, SELL
  orderType: text("order_type"), // MARKET, LIMIT, STOP
  timeInForce: text("time_in_force"),
  qtyLots: real("qty_lots"),
  requestedPrice: real("requested_price"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  takeProfit: real("take_profit"),
  stopLoss: real("stop_loss"),
  
  // Quote context at receipt
  quoteBid: real("quote_bid"),
  quoteAsk: real("quote_ask"),
  quoteMid: real("quote_mid"),
  quoteTs: integer("quote_ts", { mode: "timestamp" }),
  quoteIsStale: integer("quote_is_stale", { mode: "boolean" }),
  
  // Risk evidence snapshot
  riskLimitJson: text("risk_limit_json"), // JSON: {maxLots: 50, maxTrades: 5, ...}
  riskObservedJson: text("risk_observed_json"), // JSON: {currentLots: 45, openTrades: 3, ...}
  riskSnapshotJson: text("risk_snapshot_json"), // Full account state at decision time
  
  // Data integrity
  payloadJson: text("payload_json").notNull(),
  prevHash: text("prev_hash").notNull(),
  eventHash: text("event_hash").notNull(),
});

// Login history & IP tracking (with session tracking)
export const userLoginHistory = sqliteTable("user_login_history", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }),
  email: text("email").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  success: integer("success", { mode: "boolean" }).notNull(),
  failureReason: text("failure_reason"),
  logoutAt: integer("logout_at", { mode: "timestamp" }), // When the session ended
  sessionLengthSec: integer("session_length_sec"), // Session duration in seconds
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  // Geo-enrichment fields
  countryCode: text("country_code"),
  region: text("region"),
  city: text("city"),
  latitude: real("latitude"), // For impossible travel detection
  longitude: real("longitude"), // For impossible travel detection
  // Session reference for linking
  sessionId: text("session_id"),
  // Event type for security trail
  eventType: text("event_type"), // LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, SESSION_REVOKED
  // Device identity columns (for grift detection)
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
});

// User account events (timeline source: freeze, unfreeze, balance adjustments, admin actions)
export const userAccountEvents = sqliteTable("user_account_events", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  adminId: integer("admin_id", { mode: "number" }),
  eventType: text("event_type").notNull(), // FREEZE, UNFREEZE, BALANCE_ADJUSTMENT, STATUS_CHANGE, NOTE_ADDED, FLAG_ADDED
  title: text("title").notNull(),
  description: text("description"),
  reasonCode: text("reason_code"),
  reasonText: text("reason_text"),
  metadata: text("metadata"), // JSON string for additional data
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Admin notes/flags on user accounts
export const userAdminNotes = sqliteTable("user_admin_notes", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  adminId: integer("admin_id", { mode: "number" }),
  type: text("type").notNull().default("NOTE"), // NOTE | FLAG
  severity: text("severity").notNull().default("INFO"), // INFO | WARN | HIGH | CRITICAL
  flagCode: text("flag_code"), // e.g. COMPLIANCE_REVIEW, SUSPICIOUS_ACTIVITY
  content: text("content").notNull(),
  isResolved: integer("is_resolved", { mode: "boolean" }).notNull().default(false),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  resolvedByAdminId: integer("resolved_by_admin_id", { mode: "number" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Bot risk assessments (one per user; higher score => more bot-like)
export const botRiskAssessments = sqliteTable("bot_risk_assessments", {
  userId: integer("user_id", { mode: "number" }).primaryKey(),
  score: integer("score", { mode: "number" }).notNull().default(0),
  label: text("label").notNull().default("OK"), // OK | SUSPICIOUS | HIGH
  signalsJson: text("signals_json").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// User deletion queue (one row per user)
export const userDeletionQueue = sqliteTable("user_deletion_queue", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull().unique(),
  status: text("status").notNull().default("GRACE"), // GRACE | EXECUTED_SOFT | EXECUTED_HARD | CANCELLED
  reason: text("reason").notNull().default("INACTIVE"), // INACTIVE | BOT | ADMIN
  markedAt: integer("marked_at", { mode: "timestamp" }).notNull(),
  graceExpiresAt: integer("grace_expires_at", { mode: "timestamp" }).notNull(),
  lastActiveAt: integer("last_active_at", { mode: "timestamp" }),
  executedAt: integer("executed_at", { mode: "timestamp" }),
  executedByAdminId: integer("executed_by_admin_id", { mode: "number" }),
  note: text("note"),
});

export const insertUserLoginHistorySchema = createInsertSchema(userLoginHistory);
export const insertUserAccountEventSchema = createInsertSchema(userAccountEvents);
export const insertUserAdminNoteSchema = createInsertSchema(userAdminNotes);
export const insertUserSessionSchema = createInsertSchema(userSessions);

// Trader Journal for trade logging/notes
export const traderJournal = sqliteTable("trader_journal", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  tradeId: integer("trade_id", { mode: "number" }), // Deprecated - use tradeIds
  tradeIds: text("trade_ids"), // JSON array of trade IDs - for multiple trades
  note: text("note").notNull(),
  mood: text("mood"), // e.g. "confident", "nervous", "neutral"
  tags: text("tags"), // JSON array stored as string
  attachmentUrl: text("attachment_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const insertTraderJournalSchema = createInsertSchema(traderJournal);

// Admin actions audit log (for View-As and other admin actions)
export const adminActions = sqliteTable("admin_actions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  adminId: integer("admin_id", { mode: "number" }).notNull(),
  userId: integer("user_id", { mode: "number" }).notNull(),
  actionType: text("action_type").notNull(), // VIEW_AS_START, VIEW_AS_STOP, etc.
  metadata: text("metadata"), // JSON string for additional data
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

export const insertAdminActionSchema = createInsertSchema(adminActions);

// Migration export/import jobs (backup + platform migration)
export const migrationExportJobs = sqliteTable("migration_export_jobs", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(), // FULL_PLATFORM | USER_BUNDLE | DELTA
  userId: integer("user_id", { mode: "number" }),
  sinceTs: integer("since_ts", { mode: "number" }),
  requestedByAdminId: integer("requested_by_admin_id", { mode: "number" }),
  status: text("status").notNull(), // QUEUED | RUNNING | READY | FAILED
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  startedAt: integer("started_at", { mode: "number" }),
  completedAt: integer("completed_at", { mode: "number" }),
  totalsJson: text("totals_json").notNull().default("{}"),
  manifestJson: text("manifest_json").notNull().default("{}"),
  // Chunking metadata (optional)
  dataPartsJson: text("data_parts_json"),
  chunkingEnabled: integer("chunking_enabled", { mode: "boolean" }),
  chunkSizeMb: integer("chunk_size_mb", { mode: "number" }),
  manifestSha256: text("manifest_sha256"),
  dataSha256: text("data_sha256"),
  dataPath: text("data_path"),
  manifestPath: text("manifest_path"),
  error: text("error"),
});

export const migrationImportJobs = sqliteTable("migration_import_jobs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(), // DRY_RUN | IMPORT
  idStrategy: text("id_strategy").notNull().default("PRESERVE"), // PRESERVE
  requestedByAdminId: integer("requested_by_admin_id", { mode: "number" }),
  status: text("status").notNull(), // QUEUED | RUNNING | COMPLETE | FAILED
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  startedAt: integer("started_at", { mode: "number" }),
  completedAt: integer("completed_at", { mode: "number" }),
  manifestSha256: text("manifest_sha256"),
  dataSha256: text("data_sha256"),
  // Chunked imports can store multiple uploaded part paths
  dataPartsJson: text("data_parts_json"),
  dataPath: text("data_path"),
  manifestPath: text("manifest_path"),
  totalsJson: text("totals_json").notNull().default("{}"),
  error: text("error"),
});

export const migrationJobLogs = sqliteTable("migration_job_logs", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull(),
  ts: integer("ts", { mode: "number" }).notNull(),
  level: text("level").notNull(), // INFO | WARN | ERROR
  message: text("message").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
});

export const migrationIdMap = sqliteTable("migration_id_map", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull(),
  entityType: text("entity_type").notNull(),
  legacyId: text("legacy_id").notNull(),
  newId: text("new_id").notNull(),
});

export const migrationIntegrityChecks = sqliteTable("migration_integrity_checks", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull(),
  chainType: text("chain_type").notNull(),
  entityKey: text("entity_key").notNull(),
  status: text("status").notNull(), // PASS | FAIL
  failureReason: text("failure_reason"),
  verifiedAt: integer("verified_at", { mode: "number" }).notNull(),
});

// =========================
// Identity / Verification Tables
// =========================

// User verification status and rate limiting
export const userVerification = sqliteTable("user_verification", {
  userId: integer("user_id", { mode: "number" }).primaryKey().notNull(),
  
  // Email verification lifecycle
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp" }),
  emailInitialDueAt: integer("email_initial_due_at", { mode: "timestamp" }),
  emailReverifyDueAt: integer("email_reverify_due_at", { mode: "timestamp" }),
  emailResendDayKey: text("email_resend_day_key"), // YYYY-MM-DD for daily rate limit
  emailResendCountDay: integer("email_resend_count_day").default(0),
  emailLastResendAt: integer("email_last_resend_at", { mode: "timestamp" }),
  emailResendDayStart: integer("email_resend_day_start", { mode: "timestamp" }),
  
  // Phone/SMS verification
  phoneE164: text("phone_e164"),
  smsVerifiedAt: integer("sms_verified_at", { mode: "timestamp" }),
  smsSendDayKey: text("sms_send_day_key"),
  smsSendCountDay: integer("sms_send_count_day").default(0),
  smsLastSentAt: integer("sms_last_sent_at", { mode: "timestamp" }),
  smsLastSendAt: integer("sms_last_send_at", { mode: "timestamp" }),
  smsSendDayStart: integer("sms_send_day_start", { mode: "timestamp" }),
  smsVerifyFailCount: integer("sms_verify_fail_count").default(0),
  smsOtpLockedUntil: integer("sms_otp_locked_until", { mode: "timestamp" }),
  smsEnabled: integer("sms_enabled", { mode: "boolean" }).default(false),
  
  // Contender tier (progression tracking)
  contenderTier: text("contender_tier").notNull().default("NONE"), // NONE, CANDIDATE_EMAIL_ONLY, CANDIDATE_SMS_REQUIRED, VERIFIED_SMS, SELECTED_REAL_CAPITAL
  contenderEligibleAt: integer("contender_eligible_at", { mode: "timestamp" }),

  // Lock snapshot (policy reporting only; runtime enforcement derives state)
  lockedAt: integer("locked_at", { mode: "timestamp" }),
  lockReason: text("lock_reason"),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Email verification tokens
export const emailVerificationTokens = sqliteTable("email_verification_tokens", {
  id: text("id").primaryKey().notNull(), // UUID
  userId: integer("user_id", { mode: "number" }).notNull(),
  tokenHash: text("token_hash").notNull(), // SHA-256 hash of token
  purpose: text("purpose").notNull().default("VERIFY"), // INITIAL | REVERIFY | VERIFY | RESET
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// SMS OTP tokens (hashed; no plaintext OTP stored)
export const smsOtpTokens = sqliteTable("sms_otp_tokens", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  phoneE164: text("phone_e164").notNull(),
  otpHash: text("otp_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Daily equity snapshots (deterministic last-90d return)
export const userEquityDaily = sqliteTable(
  "user_equity_daily",
  {
    userId: integer("user_id", { mode: "number" }).notNull(),
    dayKey: text("day_key").notNull(), // YYYY-MM-DD (UTC)
    equity: real("equity").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.dayKey] }),
  })
);

// MFA (TOTP) configuration
export const userMfa = sqliteTable("user_mfa", {
  userId: integer("user_id", { mode: "number" }).primaryKey().notNull(),
  
  // TOTP secrets (encrypted)
  totpSecretEnc: text("totp_secret_enc"), // AES-256-GCM encrypted base32 secret
  totpPendingSecretEnc: text("totp_pending_secret_enc"), // Pending during setup
  
  // Recovery codes (hashed)
  recoveryCodesHashJson: text("recovery_codes_hash_json"), // JSON array of SHA-256 hashes
  recoveryCodesUsedJson: text("recovery_codes_used_json"), // JSON array of used indices
  
  // Status
  enabledAt: integer("enabled_at", { mode: "timestamp" }),
  disabledAt: integer("disabled_at", { mode: "timestamp" }),
  lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }),
  failedAttempts: integer("failed_attempts").default(0),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// KYC profiles (invite-based)
export const userKycProfiles = sqliteTable("user_kyc_profiles", {
  userId: integer("user_id", { mode: "number" }).primaryKey().notNull(),
  
  // Status: NOT_STARTED | INVITED | SUBMITTED | APPROVED | REJECTED
  status: text("status").notNull().default("NOT_STARTED"),
  
  // Invite tracking
  invitedAt: integer("invited_at", { mode: "timestamp" }),
  invitedByAdminId: integer("invited_by_admin_id", { mode: "number" }),
  inviteNote: text("invite_note"),
  
  // Submission tracking
  submittedAt: integer("submitted_at", { mode: "timestamp" }),
  documentType: text("document_type"), // PASSPORT, DRIVERS_LICENSE, ID_CARD
  documentNumber: text("document_number"), // Encrypted or masked
  legalFirstName: text("legal_first_name"),
  legalLastName: text("legal_last_name"),
  dob: text("dob"), // YYYY-MM-DD
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  region: text("region"),
  postalCode: text("postal_code"),
  country: text("country"),
  idDocumentRef: text("id_document_ref"),
  
  // Review tracking
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  reviewedByAdminId: integer("reviewed_by_admin_id", { mode: "number" }),
  reviewerNote: text("reviewer_note"),
  rejectionReason: text("rejection_reason"),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Payout profiles (gated to Selected tier)
export const userPayoutProfiles = sqliteTable("user_payout_profiles", {
  userId: integer("user_id", { mode: "number" }).primaryKey().notNull(),
  
  // Payment preferences
  preferredPaymentCurrency: text("preferred_payment_currency").default("USD"),
  payoutMethod: text("payout_method"), // BANK_TRANSFER, WISE, PAYPAL, CRYPTO
  
  // Payout details (encrypted JSON for flexibility)
  payoutDetailsJson: text("payout_details_json"),
  
  // Status
  isVerified: integer("is_verified", { mode: "boolean" }).default(false),
  verifiedAt: integer("verified_at", { mode: "timestamp" }),
  
  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
});

// Identity audit trail (hash-chained for tamper evidence)
export const identityAudit = sqliteTable("identity_audit", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  
  // Event timing
  at: integer("at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  
  // User context
  userId: integer("user_id", { mode: "number" }),
  email: text("email"),
  username: text("username"),
  
  // Event classification
  category: text("category").notNull(), // ACCOUNT_EVENT, EMAIL, SMS, MFA, KYC, LOGIN, ADMIN
  type: text("type").notNull(), // e.g., EMAIL_VERIFIED, SMS_OTP_SENT, MFA_ENABLED, KYC_APPROVED
  title: text("title"),
  description: text("description"),
  
  // Actor/provenance
  ip: text("ip"),
  userAgent: text("user_agent"),
  actorAdminId: integer("actor_admin_id", { mode: "number" }),
  actorType: text("actor_type"),
  actorUserId: integer("actor_user_id", { mode: "number" }),
  sessionId: text("session_id"),
  correlationId: text("correlation_id"),
  dataJson: text("data_json"),
  
  // Data integrity (hash chain)
  prevHash: text("prev_hash"),
  eventHash: text("event_hash").notNull(),
});

export const insertUserVerificationSchema = createInsertSchema(userVerification);
export const insertEmailVerificationTokenSchema = createInsertSchema(emailVerificationTokens);
export const insertSmsOtpTokenSchema = createInsertSchema(smsOtpTokens);
export const insertUserEquityDailySchema = createInsertSchema(userEquityDaily);
export const insertUserMfaSchema = createInsertSchema(userMfa);
export const insertUserKycProfileSchema = createInsertSchema(userKycProfiles);
export const insertUserPayoutProfileSchema = createInsertSchema(userPayoutProfiles);
export const insertIdentityAuditSchema = createInsertSchema(identityAudit);

// ================================================================
// GRIFT DETECTION TABLES (identity linking, alerts, risk scoring)
// Note: These tables use raw SQLite via ensureSchema.ts, not Drizzle ORM
// Schema here is for type inference only - actual tables in ensureSchema.ts
// ================================================================

// Identity links: many-to-many between users and identity keys (device, IP, fingerprint)
export const griftIdentityLinks = sqliteTable("grift_identity_links", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  linkType: text("link_type").notNull(), // device_install_id | device_fp | device_id | ip | ip_subnet
  linkValue: text("link_value").notNull(),
  firstSeenAt: integer("first_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  occurrenceCount: integer("occurrence_count", { mode: "number" }).notNull().default(1),
  metadataJson: text("metadata_json"),
});

// Alerts for admin review
export const griftAlerts = sqliteTable("grift_alerts", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  ruleType: text("rule_type").notNull(), // SHARED_DEVICE | SHARED_DEVICE_FP | etc.
  severity: text("severity").notNull().default("medium"), // low | medium | high | critical
  score: integer("score", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("open"), // open | resolved | dismissed | in_review
  detailsJson: text("details_json"),
  relatedUserId: integer("related_user_id", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  reviewedAt: integer("reviewed_at", { mode: "number" }),
  reviewedBy: integer("reviewed_by", { mode: "number" }),
  resolutionNote: text("resolution_note"),
});

// Cached/aggregated risk score per user
export const griftUserRisk = sqliteTable("grift_user_risk", {
  userId: integer("user_id", { mode: "number" }).primaryKey(),
  riskScore: integer("risk_score", { mode: "number" }).notNull().default(0),
  riskFactorsJson: text("risk_factors_json"),
  lastEvaluatedAt: integer("last_evaluated_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  manualOverride: text("manual_override"),
  overrideBy: integer("override_by", { mode: "number" }),
  overrideAt: integer("override_at", { mode: "number" }),
  overrideReason: text("override_reason"),
  enforcementStatus: text("enforcement_status").default("ACTIVE"),
  enforcementAt: integer("enforcement_at", { mode: "number" }),
  enforcementBy: integer("enforcement_by", { mode: "number" }),
  enforcementReason: text("enforcement_reason"),
});

// Linked account edges (graph representation)
export const griftLinkedAccountEdges = sqliteTable("grift_linked_account_edges", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userA: integer("user_a", { mode: "number" }).notNull(),
  userB: integer("user_b", { mode: "number" }).notNull(),
  linkType: text("link_type").notNull(), // SHARED_DEVICE | SHARED_IP | etc.
  linkValue: text("link_value"),
  confidence: real("confidence").notNull().default(1.0),
  firstLinkedAt: integer("first_linked_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastConfirmedAt: integer("last_confirmed_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  metadataJson: text("metadata_json"),
});

// Admin-editable grift detection configuration (thresholds and point values)
export const griftConfig = sqliteTable("grift_config", {
  id: integer("id", { mode: "number" }).primaryKey().default(1),
  enabled: integer("enabled", { mode: "number" }).notNull().default(1),
  multiAccountWindowDays: integer("multi_account_window_days").notNull().default(30),
  churnWindowHours: integer("churn_window_hours").notNull().default(24),
  hedgeWindowMinutes: integer("hedge_window_minutes").notNull().default(10),
  concurrentWindowMinutes: integer("concurrent_window_minutes").notNull().default(15),
  ipUniqueThreshold: integer("ip_unique_threshold").notNull().default(4),
  uaUniqueThreshold: integer("ua_unique_threshold").notNull().default(3),
  deviceUniqueThreshold: integer("device_unique_threshold").notNull().default(3),
  asnUniqueThreshold: integer("asn_unique_threshold").notNull().default(3),
  geoVelocityKmhThreshold: integer("geo_velocity_kmh_threshold").notNull().default(900),
  geoVelocityMinDistanceKm: integer("geo_velocity_min_distance_km").notNull().default(800),
  geoVelocityMaxHours: integer("geo_velocity_max_hours").notNull().default(6),
  hedgeRequireDeviceMatch: integer("hedge_require_device_match").notNull().default(1),
  hedgeAllowIpMatch: integer("hedge_allow_ip_match").notNull().default(1),
  scoreMultiAccountDevice: integer("score_multi_account_device").notNull().default(35),
  scoreHedgePair: integer("score_hedge_pair").notNull().default(55),
  scoreIpChurn: integer("score_ip_churn").notNull().default(20),
  scoreUaChurn: integer("score_ua_churn").notNull().default(15),
  scoreDeviceChurn: integer("score_device_churn").notNull().default(20),
  scoreGeoVelocity: integer("score_geo_velocity").notNull().default(30),
  scoreConcurrentSessions: integer("score_concurrent_sessions").notNull().default(25),
  scoreAsnVolatility: integer("score_asn_volatility").notNull().default(15),
  scoreSharedIpAsnCluster: integer("score_shared_ip_asn_cluster").notNull().default(40),
  scoreMultiAccountLaddering: integer("score_multi_account_laddering").notNull().default(50),
  clusterMinUsersForIpAsn: integer("cluster_min_users_for_ip_asn").notNull().default(3),
  ladderingWindowDays: integer("laddering_window_days").notNull().default(7),
  ladderingMinSequence: integer("laddering_min_sequence").notNull().default(3),
  tierMed: integer("tier_med").notNull().default(40),
  tierHigh: integer("tier_high").notNull().default(60),
  tierCritical: integer("tier_critical").notNull().default(80),
  mitigationMfa: integer("mitigation_mfa").notNull().default(10),
  mitigationKycApproved: integer("mitigation_kyc_approved").notNull().default(15),
  enforcementFreezeThreshold: integer("enforcement_freeze_threshold").notNull().default(80),
  enforcementDisableThreshold: integer("enforcement_disable_threshold").notNull().default(100),
  enforcementAutoFreeze: integer("enforcement_auto_freeze").notNull().default(0),
  enforcementAutoDisable: integer("enforcement_auto_disable").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedByAdminId: integer("updated_by_admin_id", { mode: "number" }),
});

// Device rollups (aggregate device info)
export const griftDevices = sqliteTable("grift_devices", {
  deviceId: text("device_id").primaryKey(),
  firstSeenAt: integer("first_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  firstIp: text("first_ip"),
  firstGeoCountry: text("first_geo_country"),
  trustLevel: text("trust_level").notNull().default("NEW"), // NEW | TRUSTED | CHALLENGED | BLOCKED
  usersCount: integer("users_count").notNull().default(1),
  metadataJson: text("metadata_json"),
});

// Device-to-user link graph
export const griftDeviceUsers = sqliteTable("grift_device_users", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  deviceId: text("device_id").notNull(),
  userId: integer("user_id", { mode: "number" }).notNull(),
  firstSeenAt: integer("first_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  seenCount: integer("seen_count").notNull().default(1),
  linkStrength: real("link_strength").notNull().default(1.0),
});

// Open/closed signals per user (individual rule triggers)
export const griftSignals = sqliteTable("grift_signals", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  ruleCode: text("rule_code").notNull(), // MULTI_ACCOUNT_DEVICE | IP_CHURN | etc.
  dedupeKey: text("dedupe_key"), // For preventing duplicate signals in same window
  severity: text("severity").notNull().default("MEDIUM"),
  points: integer("points").notNull().default(0),
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED
  evidenceJson: text("evidence_json"),
  relatedUserId: integer("related_user_id", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now'))`),
  closedAt: integer("closed_at", { mode: "number" }),
  closedByAdminId: integer("closed_by_admin_id", { mode: "number" }),
  closureNote: text("closure_note"),
  deviceId: text("device_id"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  geoCountry: text("geo_country"),
  geoRegion: text("geo_region"),
  geoCity: text("geo_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  asn: integer("asn", { mode: "number" }),
  org: text("org"),
  symbol: text("symbol"),
  tradeId: integer("trade_id", { mode: "number" }),
});

// Grift observations (request/session telemetry)
export const griftObservations = sqliteTable("grift_observations", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  eventType: text("event_type").notNull().default("SESSION_PING"),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  geoCountry: text("geo_country"),
  geoRegion: text("geo_region"),
  geoCity: text("geo_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  asn: integer("asn", { mode: "number" }),
  org: text("org"),
  observedAt: integer("observed_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

// Grift trade observations (trade telemetry)
export const griftTradeObservations = sqliteTable("grift_trade_observations", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  tradeId: integer("trade_id", { mode: "number" }).notNull(),
  userId: integer("user_id", { mode: "number" }).notNull(),
  sessionId: text("session_id"),
  deviceId: text("device_id"),
  deviceFp: text("device_fp"),
  deviceInstallId: text("device_install_id"),
  clientTz: text("client_tz"),
  clientLang: text("client_lang"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  lots: real("lots").notNull(),
  geoCountry: text("geo_country"),
  geoRegion: text("geo_region"),
  geoCity: text("geo_city"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  asn: integer("asn", { mode: "number" }),
  org: text("org"),
  observedAt: integer("observed_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

// Aggregated grift risk scores
export const griftUserScores = sqliteTable("grift_user_scores", {
  userId: integer("user_id", { mode: "number" }).primaryKey(),
  scoreCurrent: integer("score_current", { mode: "number" }).notNull().default(0),
  score7d: integer("score_7d", { mode: "number" }).notNull().default(0),
  score30d: integer("score_30d", { mode: "number" }).notNull().default(0),
  tier: text("tier").notNull().default("LOW"),
  devices7d: integer("devices_7d", { mode: "number" }).notNull().default(0),
  ips7d: integer("ips_7d", { mode: "number" }).notNull().default(0),
  userAgents7d: integer("user_agents_7d", { mode: "number" }).notNull().default(0),
  countries7d: integer("countries_7d", { mode: "number" }).notNull().default(0),
  asns7d: integer("asns_7d", { mode: "number" }).notNull().default(0),
  linkedAccounts30d: integer("linked_accounts_30d", { mode: "number" }).notNull().default(0),
  hedgePairs7d: integer("hedge_pairs_7d", { mode: "number" }).notNull().default(0),
  openSignalsCount: integer("open_signals_count", { mode: "number" }).notNull().default(0),
  lastEvaluatedAt: integer("last_evaluated_at", { mode: "number" }).notNull().default(0),
});

// Grift user enforcement status (freeze/disable)
export const griftUserEnforcements = sqliteTable("grift_user_enforcements", {
  userId: integer("user_id", { mode: "number" }).primaryKey(),
  frozenAt: integer("frozen_at", { mode: "number" }),
  frozenByAdminId: integer("frozen_by_admin_id", { mode: "number" }),
  disabledAt: integer("disabled_at", { mode: "number" }),
  disabledByAdminId: integer("disabled_by_admin_id", { mode: "number" }),
  notes: text("notes"),
});

// Grift cases workflow
export const griftCases = sqliteTable("grift_cases", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status").notNull().default("OPEN"),
  priority: text("priority").notNull().default("MEDIUM"),
  createdByAdminId: integer("created_by_admin_id", { mode: "number" }),
  assignedAdminId: integer("assigned_admin_id", { mode: "number" }),
  resolution: text("resolution"),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
  closedAt: integer("closed_at", { mode: "number" }),
});

export const griftCaseSignals = sqliteTable("grift_case_signals", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  caseId: integer("case_id", { mode: "number" }).notNull(),
  signalId: integer("signal_id", { mode: "number" }).notNull(),
  addedAt: integer("added_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

export const griftCaseNotes = sqliteTable("grift_case_notes", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  caseId: integer("case_id", { mode: "number" }).notNull(),
  adminId: integer("admin_id", { mode: "number" }).notNull(),
  note: text("note").notNull(),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

export const griftCaseLinks = sqliteTable("grift_case_links", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  caseId: integer("case_id", { mode: "number" }).notNull(),
  linkType: text("link_type").notNull(),
  linkId: integer("link_id", { mode: "number" }).notNull(),
  addedByAdminId: integer("added_by_admin_id", { mode: "number" }),
  addedAt: integer("added_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

// Grift admin audit entries (tamper-evident)
export const griftAdminActions = sqliteTable("grift_admin_actions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  adminId: integer("admin_id", { mode: "number" }).notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id", { mode: "number" }),
  payloadJson: text("payload_json"),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
  prevHash: text("prev_hash"),
  eventHash: text("hash"),
});

// Grift enforcement log entries
export const griftEnforcementLog = sqliteTable("grift_enforcement_log", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull(),
  action: text("action").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  adminId: integer("admin_id", { mode: "number" }),
  reason: text("reason"),
  riskScoreAtAction: integer("risk_score_at_action", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`),
});

// ================================================================
// LEGAL COMPLIANCE TABLES (Spec-Compliant 4-Part Key Structure)
// ================================================================

// Legal document type enum values
export type LegalDocType = "GLOBAL_MASTER" | "ADDENDUM";
export type LegalJurisdictionType = "DEFAULT" | "COUNTRY" | "REGION";
export type LegalDocAction = "CREATE_VERSION" | "SET_ACTIVE" | "REPLACE_ACTIVE" | "ROLLBACK";

// Legal documents (versioned terms with 4-part key structure)
export const legalDocuments = sqliteTable("legal_documents", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  docSet: text("doc_set").notNull(), // e.g., "TERMS_V1", "PRIVACY_V1"
  docType: text("doc_type").notNull(), // GLOBAL_MASTER | ADDENDUM
  jurisdictionType: text("jurisdiction_type").notNull(), // DEFAULT | COUNTRY | REGION
  jurisdictionKey: text("jurisdiction_key").notNull(), // e.g., "GLOBAL", "US", "EU", "US-CA"
  version: text("version").notNull(), // semver: 1.0.0
  sha256: text("sha256").notNull(), // SHA-256 hash of content
  content: text("content").notNull(), // Full document HTML/Markdown
  notes: text("notes"), // Admin notes about this version
  createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`), // timestamp_ms
  createdByAdminUserId: integer("created_by_admin_user_id", { mode: "number" }),
});

// Legal document pointers (which doc version is active for each 4-part key)
export const legalDocPointers = sqliteTable("legal_doc_pointers", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  docSet: text("doc_set").notNull(), // e.g., "TERMS_V1", "PRIVACY_V1"
  docType: text("doc_type").notNull(), // GLOBAL_MASTER | ADDENDUM
  jurisdictionType: text("jurisdiction_type").notNull(), // DEFAULT | COUNTRY | REGION
  jurisdictionKey: text("jurisdiction_key").notNull(), // e.g., "GLOBAL", "US", "EU"
  activeDocumentId: integer("active_document_id", { mode: "number" }).references(() => legalDocuments.id),
  updatedAt: integer("updated_at", { mode: "number" }).notNull().default(sql`(strftime('%s', 'now') * 1000)`), // timestamp_ms
  updatedByAdminUserId: integer("updated_by_admin_user_id", { mode: "number" }),
});
// Note: Unique index on (docSet, docType, jurisdictionType, jurisdictionKey) should be created in ensureSchema.ts

// Legal acceptances (hash-chained tamper-evident ledger with full audit trail)
export const legalAcceptances = sqliteTable("legal_acceptances", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull().references(() => users.id),
  
  // User context at time of acceptance
  emailAtAcceptance: text("email_at_acceptance"), // Email address at acceptance time
  countryIso2: text("country_iso2"), // User's country (ISO 3166-1 alpha-2)
  regionKey: text("region_key"), // User's region (e.g., "US-CA", "EU")
  
  // Global Master document reference
  globalDocId: integer("global_doc_id", { mode: "number" }).references(() => legalDocuments.id),
  globalDocVersion: text("global_doc_version"),
  globalDocSha256: text("global_doc_sha256"),
  
  // Addendum document reference (if applicable)
  addendumId: integer("addendum_id", { mode: "number" }).references(() => legalDocuments.id),
  addendumVersion: text("addendum_version"),
  addendumSha256: text("addendum_sha256"),
  
  // Combined document hash (for tamper evidence)
  combinedSha256: text("combined_sha256").notNull(), // SHA-256 of global + addendum combined
  combinedText: text("combined_text"), // Full combined text that was accepted
  
  // Hash-chain for tamper-evident ledger
  ledgerSeq: integer("ledger_seq", { mode: "number" }).notNull(), // Monotonic sequence number
  prevLedgerHash: text("prev_ledger_hash"), // Hash of previous acceptance record (null for first)
  ledgerHash: text("ledger_hash").notNull(), // SHA-256 hash of this record including prevLedgerHash
  
  // Client provenance
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  sessionId: text("session_id"),
  
  // Legacy fields (deprecated but kept for compatibility)
  docId: integer("doc_id", { mode: "number" }).references(() => legalDocuments.id),
  docVersion: text("doc_version"),
  docContentHash: text("doc_content_hash"),
  termsToken: text("terms_token"),
  termsTokenVerified: integer("terms_token_verified", { mode: "boolean" }).default(false),
  acceptedFromIp: text("accepted_from_ip"),
  acceptedUserAgent: text("accepted_user_agent"),
  prevHash: text("prev_hash"),
  recordHash: text("record_hash"),
  
  acceptedAt: integer("accepted_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  // Milliseconds precision timestamp for hash computation (not coerced by Drizzle)
  acceptedAtMs: integer("accepted_at_ms", { mode: "number" }),
});

// Re-acceptance requirements (when active terms change after last user acceptance)
export const legalReacceptRequirements = sqliteTable("legal_reaccept_requirements", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  userId: integer("user_id", { mode: "number" }).notNull().references(() => users.id),

  docSet: text("doc_set").notNull(), // e.g. "DOC1"

  // Jurisdiction snapshot for the required hash
  countryIso2: text("country_iso2").notNull(),
  regionKey: text("region_key"),

  requiredCombinedSha256: text("required_combined_sha256").notNull(),

  // Snapshot of the last known acceptance at the time this requirement was detected
  lastAcceptedCombinedSha256: text("last_accepted_combined_sha256"),
  lastAcceptanceId: integer("last_acceptance_id", { mode: "number" }).references(() => legalAcceptances.id),

  detectedAtMs: integer("detected_at_ms", { mode: "number" }).notNull(),
  detectedBy: text("detected_by").notNull().default("LOGIN"), // LOGIN | TRADE | STATUS
});

// Legacy (pre-chain) change audit table used by legacy admin routes.
// Kept to avoid breaking the legacy legal-docs system.
export const legalDocChangeAuditLegacy = sqliteTable("legal_doc_change_audit", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  docId: integer("doc_id", { mode: "number" }),
  targetId: integer("target_id", { mode: "number" }),
  action: text("action").notNull(),
  changedBy: text("changed_by"),
  changedAt: integer("changed_at", { mode: "number" }),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
});

// Legal document change audit trail (v2, hash-chained)
export const legalDocChangeAudit = sqliteTable("legal_doc_change_audit_chain", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  
  // Hash-chain for tamper-evidence
  seq: integer("seq", { mode: "number" }).notNull(), // Monotonic sequence number
  prevHash: text("prev_hash").notNull(), // Hash of previous audit record ("GENESIS" for first)
  eventHash: text("event_hash").notNull(), // SHA-256 hash of this event including prevHash
  
  // Actor
  adminUserId: integer("admin_user_id", { mode: "number" }),
  
  // Action type
  action: text("action").notNull(), // CREATE_VERSION | SET_ACTIVE | REPLACE_ACTIVE | ROLLBACK
  
  // 4-part key context
  docSet: text("doc_set"),
  docType: text("doc_type"),
  jurisdictionType: text("jurisdiction_type"),
  jurisdictionKey: text("jurisdiction_key"),
  
  // Document references
  oldActiveDocumentId: integer("old_active_document_id", { mode: "number" }).references(() => legalDocuments.id),
  newActiveDocumentId: integer("new_active_document_id", { mode: "number" }).references(() => legalDocuments.id),
  
  // Additional context
  note: text("note"),

  // Millisecond precision timestamp used in the hash payload (must be stored for verifiability).
  createdAtMs: integer("created_at_ms", { mode: "number" }).notNull(),
});

// Legal document relations
export const legalDocumentsRelations = relations(legalDocuments, ({ many }) => ({
  pointers: many(legalDocPointers),
  globalAcceptances: many(legalAcceptances, { relationName: "globalDoc" }),
  addendumAcceptances: many(legalAcceptances, { relationName: "addendumDoc" }),
  auditLogsAsOld: many(legalDocChangeAudit, { relationName: "oldDoc" }),
  auditLogsAsNew: many(legalDocChangeAudit, { relationName: "newDoc" }),
}));

export const legalDocPointersRelations = relations(legalDocPointers, ({ one }) => ({
  activeDocument: one(legalDocuments, {
    fields: [legalDocPointers.activeDocumentId],
    references: [legalDocuments.id],
  }),
}));

export const legalAcceptancesRelations = relations(legalAcceptances, ({ one }) => ({
  user: one(users, {
    fields: [legalAcceptances.userId],
    references: [users.id],
  }),
  globalDocument: one(legalDocuments, {
    fields: [legalAcceptances.globalDocId],
    references: [legalDocuments.id],
    relationName: "globalDoc",
  }),
  addendumDocument: one(legalDocuments, {
    fields: [legalAcceptances.addendumId],
    references: [legalDocuments.id],
    relationName: "addendumDoc",
  }),
  legacyDocument: one(legalDocuments, {
    fields: [legalAcceptances.docId],
    references: [legalDocuments.id],
    relationName: "legacyDoc",
  }),
}));

export const legalDocChangeAuditRelations = relations(legalDocChangeAudit, ({ one }) => ({
  oldDocument: one(legalDocuments, {
    fields: [legalDocChangeAudit.oldActiveDocumentId],
    references: [legalDocuments.id],
    relationName: "oldDoc",
  }),
  newDocument: one(legalDocuments, {
    fields: [legalDocChangeAudit.newActiveDocumentId],
    references: [legalDocuments.id],
    relationName: "newDoc",
  }),
}));

// Daily FX closes - archives previous day close prices at rollover time
export const dailyFxCloses = sqliteTable("daily_fx_closes", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  symbolId: integer("symbol_id", { mode: "number" }).notNull().references(() => symbolConfigs.id),
  symbolName: text("symbol_name").notNull(), // Denormalized for quick lookup
  tradeDate: text("trade_date").notNull(), // YYYY-MM-DD in rollover TZ
  closePrice: real("close_price").notNull(),
  bidPrice: real("bid_price"),
  askPrice: real("ask_price"),
  source: text("source").notNull().default("1FORGE"), // Data source
  rolloverTz: text("rollover_tz").notNull(), // TZ used for this calculation
  rolloverTime: text("rollover_time").notNull(), // HH:MM used for this calculation
  calculatedAt: integer("calculated_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  createdBy: text("created_by"), // "SYSTEM" for cron, admin email for manual
});

// Unique constraint on symbol + trade date
export const dailyFxClosesRelations = relations(dailyFxCloses, ({ one }) => ({
  symbol: one(symbolConfigs, {
    fields: [dailyFxCloses.symbolId],
    references: [symbolConfigs.id],
  }),
}));

export const insertDailyFxCloseSchema = createInsertSchema(dailyFxCloses);
export const selectDailyFxCloseSchema = createSelectSchema(dailyFxCloses);

// Legal compliance insert schemas
export const insertLegalDocumentSchema = createInsertSchema(legalDocuments);
export const insertLegalDocPointerSchema = createInsertSchema(legalDocPointers);
export const insertLegalAcceptanceSchema = createInsertSchema(legalAcceptances);
export const insertLegalDocChangeAuditSchema = createInsertSchema(legalDocChangeAudit);

// Legal compliance select schemas
export const selectLegalDocumentSchema = createSelectSchema(legalDocuments);
export const selectLegalDocPointerSchema = createSelectSchema(legalDocPointers);
export const selectLegalAcceptanceSchema = createSelectSchema(legalAcceptances);
export const selectLegalDocChangeAuditSchema = createSelectSchema(legalDocChangeAudit);

export const insertGriftIdentityLinkSchema = createInsertSchema(griftIdentityLinks);
export const insertGriftConfigSchema = createInsertSchema(griftConfig);
export const insertGriftDeviceSchema = createInsertSchema(griftDevices);
export const insertGriftDeviceUserSchema = createInsertSchema(griftDeviceUsers);
export const insertGriftSignalSchema = createInsertSchema(griftSignals);
export const insertGriftAlertSchema = createInsertSchema(griftAlerts);
export const insertGriftUserRiskSchema = createInsertSchema(griftUserRisk);
export const insertGriftLinkedAccountEdgeSchema = createInsertSchema(griftLinkedAccountEdges);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type SymbolConfig = typeof symbolConfigs.$inferSelect;
export type InsertSymbolConfig = z.infer<typeof insertSymbolConfigSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type GlobalSettings = typeof globalSettings.$inferSelect;
export type InsertGlobalSettings = z.infer<typeof insertGlobalSettingsSchema>;
export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type LoginCredentials = z.infer<typeof loginSchema>;
export type UserLoginHistory = typeof userLoginHistory.$inferSelect;
export type InsertUserLoginHistory = z.infer<typeof insertUserLoginHistorySchema>;
export type UserAccountEvent = typeof userAccountEvents.$inferSelect;
export type InsertUserAccountEvent = z.infer<typeof insertUserAccountEventSchema>;
export type UserAdminNote = typeof userAdminNotes.$inferSelect;
export type InsertUserAdminNote = z.infer<typeof insertUserAdminNoteSchema>;
export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type TraderJournal = typeof traderJournal.$inferSelect;
export type InsertTraderJournal = z.infer<typeof insertTraderJournalSchema>;
export type AdminAction = typeof adminActions.$inferSelect;
export type InsertAdminAction = z.infer<typeof insertAdminActionSchema>;
export type MigrationExportJob = typeof migrationExportJobs.$inferSelect;
export type MigrationImportJob = typeof migrationImportJobs.$inferSelect;
export type MigrationJobLog = typeof migrationJobLogs.$inferSelect;
export type MigrationIdMap = typeof migrationIdMap.$inferSelect;
export type MigrationIntegrityCheck = typeof migrationIntegrityChecks.$inferSelect;
export type UserVerification = typeof userVerification.$inferSelect;
export type InsertUserVerification = z.infer<typeof insertUserVerificationSchema>;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type InsertEmailVerificationToken = z.infer<typeof insertEmailVerificationTokenSchema>;
export type SmsOtpToken = typeof smsOtpTokens.$inferSelect;
export type InsertSmsOtpToken = z.infer<typeof insertSmsOtpTokenSchema>;
export type UserEquityDaily = typeof userEquityDaily.$inferSelect;
export type InsertUserEquityDaily = z.infer<typeof insertUserEquityDailySchema>;
export type UserMfa = typeof userMfa.$inferSelect;
export type InsertUserMfa = z.infer<typeof insertUserMfaSchema>;
export type UserKycProfile = typeof userKycProfiles.$inferSelect;
export type InsertUserKycProfile = z.infer<typeof insertUserKycProfileSchema>;
export type UserPayoutProfile = typeof userPayoutProfiles.$inferSelect;
export type InsertUserPayoutProfile = z.infer<typeof insertUserPayoutProfileSchema>;
export type IdentityAuditEvent = typeof identityAudit.$inferSelect;
export type InsertIdentityAuditEvent = z.infer<typeof insertIdentityAuditSchema>;
export type GriftIdentityLink = typeof griftIdentityLinks.$inferSelect;
export type InsertGriftIdentityLink = z.infer<typeof insertGriftIdentityLinkSchema>;
export type GriftAlert = typeof griftAlerts.$inferSelect;
export type InsertGriftAlert = z.infer<typeof insertGriftAlertSchema>;
export type GriftUserRisk = typeof griftUserRisk.$inferSelect;
export type InsertGriftUserRisk = z.infer<typeof insertGriftUserRiskSchema>;
export type GriftLinkedAccountEdge = typeof griftLinkedAccountEdges.$inferSelect;
export type InsertGriftLinkedAccountEdge = z.infer<typeof insertGriftLinkedAccountEdgeSchema>;
export type GriftConfig = typeof griftConfig.$inferSelect;
export type InsertGriftConfig = z.infer<typeof insertGriftConfigSchema>;
export type GriftDevice = typeof griftDevices.$inferSelect;
export type InsertGriftDevice = z.infer<typeof insertGriftDeviceSchema>;
export type GriftDeviceUser = typeof griftDeviceUsers.$inferSelect;
export type InsertGriftDeviceUser = z.infer<typeof insertGriftDeviceUserSchema>;
export type GriftSignal = typeof griftSignals.$inferSelect;
export type InsertGriftSignal = z.infer<typeof insertGriftSignalSchema>;

// Legal compliance types
export type LegalDocument = typeof legalDocuments.$inferSelect;
export type InsertLegalDocument = z.infer<typeof insertLegalDocumentSchema>;
export type LegalDocPointer = typeof legalDocPointers.$inferSelect;
export type InsertLegalDocPointer = z.infer<typeof insertLegalDocPointerSchema>;
export type LegalAcceptance = typeof legalAcceptances.$inferSelect;
export type InsertLegalAcceptance = z.infer<typeof insertLegalAcceptanceSchema>;
export type LegalDocChangeAuditEntry = typeof legalDocChangeAudit.$inferSelect;
export type InsertLegalDocChangeAudit = z.infer<typeof insertLegalDocChangeAuditSchema>;

// Daily FX closes types
export type DailyFxClose = typeof dailyFxCloses.$inferSelect;
export type InsertDailyFxClose = z.infer<typeof insertDailyFxCloseSchema>;
