import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;

// User tier type for tiered access system
export type UserTier = "CANDIDATE" | "PERFORMER" | "SELECTED";
export type ContenderTier = "NONE" | "CANDIDATE_EMAIL_ONLY" | "CANDIDATE_SMS_REQUIRED" | "VERIFIED_SMS" | "SELECTED_REAL_CAPITAL";

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
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
  createdAt: integer("created_at").notNull().default(nowUnix),
  isAdmin: boolean("is_admin").notNull().default(false),
  isDisabled: boolean("is_disabled").notNull().default(false), // Account disabled flag
  // Account lifecycle (inactivity + bot actions)
  deletionExempt: boolean("deletion_exempt").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  inactivatedAt: integer("inactivated_at"),
  deletedAt: integer("deleted_at"),
  deletedMode: text("deleted_mode"),
  deletedReason: text("deleted_reason"),
  deletedByAdminId: integer("deleted_by_admin_id"),
  // Tiered access system
  userTier: text("user_tier").notNull().default("CANDIDATE"), // CANDIDATE | PERFORMER | SELECTED
  tierPromotedAt: integer("tier_promoted_at"),
  tierPromotedBy: integer("tier_promoted_by"),
  selectedAt: integer("selected_at"),
  // Margin-related fields
  leverage: real("leverage").notNull().default(5), // Default 5x leverage
  usedMargin: real("used_margin").notNull().default(0), // Margin currently in use
  equity: real("equity").notNull().default(0), // Balance + floating P/L
  freeMargin: real("free_margin").notNull().default(0), // Equity - used margin
  // Account freeze controls (admin)
  isFrozen: boolean("is_frozen").notNull().default(false),
  freezeReasonCode: text("freeze_reason_code"),
  freezeReasonText: text("freeze_reason_text"),
  frozenAt: integer("frozen_at"),
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
  kycVerifiedAt: integer("kyc_verified_at"),
  kycExpiresAt: integer("kyc_expires_at"),

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
  mailboxPublicKey: text("mailbox_public_key"),
  mailboxPublicKeyAlgo: text("mailbox_public_key_algo"),
  mailboxPublicKeyFingerprint: text("mailbox_public_key_fingerprint"),
  mailboxPublicKeyUpdatedAt: integer("mailbox_public_key_updated_at"),
});

// Signup fingerprints - immutable audit record (write-once per signup)
export const signupFingerprints = pgTable("signup_fingerprints", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(), // One per user, immutable
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
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// Active user sessions table (for session management)
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(), // Express session ID
  userId: integer("user_id").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"), // desktop, mobile, tablet
  browser: text("browser"),
  os: text("os"),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: integer("created_at").notNull().default(nowUnix),
  lastActiveAt: integer("last_active_at").notNull().default(nowUnix),
  expiresAt: integer("expires_at"),
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
  revokedAt: integer("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id"),
  revokeReason: text("revoke_reason"),
});

// Express/connect-pg-simple backing table for cookie sessions.
export const sessionStore = pgTable(
  "session",
  {
    sid: text("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => ({
    expireIdx: index("IDX_session_expire").on(table.expire),
  }),
);

// Persistent remember-me tokens (selector + hashed validator)
export const rememberMeTokens = pgTable(
  "remember_me_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    selector: text("selector").notNull().unique(),
    validatorHash: text("validator_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastUsedAt: integer("last_used_at").notNull().default(nowUnix),
    createdAt: integer("created_at").notNull().default(nowUnix),
    userAgent: text("user_agent"),
    ip: text("ip"),
    deviceType: text("device_type"),
    browser: text("browser"),
    os: text("os"),
    deviceFp: text("device_fp"),
    deviceInstallId: text("device_install_id"),
    countryCode: text("country_code"),
    city: text("city"),
  },
  (table) => ({
    userLastUsedIdx: index("remember_me_tokens_user_last_used_idx").on(table.userId, table.lastUsedAt),
    expiresAtIdx: index("remember_me_tokens_expires_at_idx").on(table.expiresAt),
  }),
);

// Symbol configurations
export const symbolConfigs = pgTable("symbol_configs", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  category: text("category"), // e.g. forex|stocks|crypto|commodities|bonds|etf|funds|mutual_funds|indices
  baseCurrency: text("base_currency"),
  quoteCurrency: text("quote_currency"),
  spread: real("spread"),
  minSpreadPips: real("min_spread_pips").default(2.0), // Minimum spread in pips (2 pips default)
  pipDecimals: integer("pip_decimals"), // pip = 10^-pipDecimals (e.g. 4 => 0.0001)
  quoteDecimals: integer("quote_decimals"), // formatting/rounding hint (e.g. 5 for non-JPY FX)
  providerSymbolMapJson: text("provider_symbol_map_json").notNull().default("{}"), // JSON: { "twelvedata":"EUR/USD", "1forge":"EUR/USD" }
  enabled: boolean("enabled").notNull().default(true),
  minLot: integer("min_lot").notNull().default(100000), // 1 standard lot = $100,000
  maxLot: integer("max_lot").notNull().default(5000000), // 50 standard lots
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// Per-trader quote subscription preferences.
export const traderQuotePrefs = pgTable("trader_quote_prefs", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  quoteMode: text("quote_mode").notNull().default("BASIC_ONLY"), // BASIC_ONLY | BASIC_PLUS_CUSTOM | CUSTOM_ONLY
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// Per-trader custom quote subscriptions (symbols loaded in symbol_configs).
export const traderQuoteSubscriptions = pgTable(
  "trader_quote_subscriptions",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbolId: integer("symbol_id")
      .notNull()
      .references(() => symbolConfigs.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.symbolId] }),
    symbolIdIdx: index("trader_quote_subscriptions_symbol_id_idx").on(table.symbolId),
  }),
);

// Global quote-subscription behavior (system-wide enable + default mode).
export const quoteSubscriptionConfig = pgTable("quote_subscription_config", {
  id: integer("id").primaryKey().default(1),
  globalEnabled: boolean("global_enabled").notNull().default(false),
  defaultMode: text("default_mode").notNull().default("BASIC_PLUS_CUSTOM"),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
  updatedBy: text("updated_by"),
});

// Trade history
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  symbolId: integer("symbol_id").notNull().references(() => symbolConfigs.id),
  type: text("type").notNull(), // BUY or SELL
  orderType: text("order_type").notNull().default("Market"), // Market, Limit, Stop
  timeInForce: text("time_in_force").notNull().default("GTC"),
  size: integer("size").notNull(),
  lots: integer("lots"), // Number of lots (1 lot = $100,000)
  openPrice: real("open_price").notNull(),
  closePrice: real("close_price"),
  intradayHigh: real("intraday_high"),
  intradayLow: real("intraday_low"),
  mae: real("mae"), // Max Adverse Excursion (fractional return)
  mfe: real("mfe"), // Max Favorable Excursion (fractional return)
  takeProfit: real("take_profit"),
  stopLoss: real("stop_loss"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  profit: text("profit"),
  // Gross/net/cost breakdown (institutional-grade TCA)
  grossProfitUsd: real("gross_profit_usd"),
  netProfitUsd: real("net_profit_usd"),
  notionalUsd: real("notional_usd"),
  totalCostsUsd: real("total_costs_usd").notNull().default(0),
  openCommissionUsd: real("open_commission_usd").notNull().default(0),
  closeCommissionUsd: real("close_commission_usd").notNull().default(0),
  openOtherFeesUsd: real("open_other_fees_usd").notNull().default(0),
  closeOtherFeesUsd: real("close_other_fees_usd").notNull().default(0),
  financingAccruedUsd: real("financing_accrued_usd").notNull().default(0),
  swapAccruedUsd: real("swap_accrued_usd").notNull().default(0),
  overnightDays: integer("overnight_days").notNull().default(0),
  categorySnapshot: text("category_snapshot"),
  costModelVersion: text("cost_model_version"),
  status: text("status").notNull().default("PENDING"), // PENDING, OPEN, CLOSED, CANCELED
  openedAt: integer("opened_at").notNull().default(nowUnix),
  expiresAt: integer("expires_at"),
  executedAt: integer("executed_at"),
  closedAt: integer("closed_at"),
  // Audit fields for trade close tracking
  closeReason: text("close_reason"), // e.g. "AUTO_TIME_LIMIT", "MANUAL"
  closeQuoteTs: integer("close_quote_ts"), // quote timestamp
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
  lastActorUserId: integer("last_actor_user_id"),
  lastActorSessionId: text("last_actor_session_id"),
  lastActorIp: text("last_actor_ip"),
  lastActorUserAgent: text("last_actor_user_agent"),
  lastActorType: text("last_actor_type"),
  lastActorDeviceId: text("last_actor_device_id"), // Device identifier for grift detection
});

// Define relations
export const usersRelations = relations(users, ({ many }) => ({
  trades: many(trades),
  quotePrefs: many(traderQuotePrefs),
  quoteSubscriptions: many(traderQuoteSubscriptions),
}));

export const symbolConfigsRelations = relations(symbolConfigs, ({ many }) => ({
  trades: many(trades),
  traderQuoteSubscriptions: many(traderQuoteSubscriptions),
}));

export const traderQuotePrefsRelations = relations(traderQuotePrefs, ({ one }) => ({
  user: one(users, {
    fields: [traderQuotePrefs.userId],
    references: [users.id],
  }),
}));

export const traderQuoteSubscriptionsRelations = relations(traderQuoteSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [traderQuoteSubscriptions.userId],
    references: [users.id],
  }),
  symbol: one(symbolConfigs, {
    fields: [traderQuoteSubscriptions.symbolId],
    references: [symbolConfigs.id],
  }),
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
  rememberMe: z.boolean().optional(),
});

export const insertSymbolConfigSchema = createInsertSchema(symbolConfigs);
export const insertTraderQuotePrefSchema = createInsertSchema(traderQuotePrefs);
export const insertTraderQuoteSubscriptionSchema = createInsertSchema(traderQuoteSubscriptions);
export const insertQuoteSubscriptionConfigSchema = createInsertSchema(quoteSubscriptionConfig);
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
  timeInForce: (schema) => schema.optional(),
  expiresAt: (schema) => schema.optional(),
  openedAt: (schema) => schema.optional(),
});

// User settings table
export const userSettings = pgTable("user_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id),
  leverage: real("leverage").notNull().default(50),
  maxConcurrent: integer("max_concurrent").notNull().default(5),
  maxConcurrentPerInstrument: integer("max_concurrent_per_instrument"),
  maxConcurrentLots: integer("max_concurrent_lots").notNull().default(50),
  minHoldSec: integer("min_hold_sec").notNull().default(60),
  maxHoldSec: integer("max_hold_sec").notNull().default(24 * 3600),
  showOnLeaderboard: boolean("show_lb")
    .notNull()
    .default(true),
});

// Internal mailbox threads (formal admin↔trader communications)
export const mailboxThreads = pgTable(
  "mailbox_threads",
  {
    id: serial("id").primaryKey(),
    subject: text("subject"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
    isBroadcast: boolean("is_broadcast").notNull().default(false),
    category: text("category").notNull().default("SUPPORT"), // SYSTEM | SUPPORT | ANNOUNCEMENT
  },
  (table) => ({
    updatedAtIdx: index("mailbox_threads_updated_at_idx").on(table.updatedAt),
    createdByIdx: index("mailbox_threads_created_by_idx").on(table.createdBy),
  }),
);

// Individual mailbox messages inside a thread
export const mailboxMessages = pgTable(
  "mailbox_messages",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => mailboxThreads.id, { onDelete: "cascade" }),
    senderId: integer("sender_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull().default(""),
    bodyEncrypted: text("body_encrypted"),
    bodyEncoding: text("body_encoding").notNull().default("PLAINTEXT_V0"),
    encryptionVersion: integer("encryption_version").notNull().default(0),
    bodyDigestSha256: text("body_digest_sha256"),
    e2eeEnvelope: text("e2ee_envelope"),
    e2eeSenderKeyFingerprint: text("e2ee_sender_key_fingerprint"),
    contentFormat: text("content_format").notNull().default("PLAINTEXT"), // PLAINTEXT | MARKDOWN
    createdAt: integer("created_at").notNull().default(nowUnix),
    allowReply: boolean("allow_reply").notNull().default(false),
    messageType: text("message_type").notNull().default("DIRECT"),
    metadata: text("metadata").notNull().default("{}"),
  },
  (table) => ({
    threadCreatedIdx: index("mailbox_messages_thread_created_idx").on(table.threadId, table.createdAt),
    senderIdx: index("mailbox_messages_sender_idx").on(table.senderId),
  }),
);

// Per-user mailbox thread membership and read markers
export const mailboxParticipants = pgTable(
  "mailbox_participants",
  {
    threadId: integer("thread_id")
      .notNull()
      .references(() => mailboxThreads.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadMessageId: integer("last_read_message_id").references(() => mailboxMessages.id, { onDelete: "set null" }),
    isArchived: boolean("is_archived").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.threadId, table.userId] }),
    userUpdatedIdx: index("mailbox_participants_user_updated_idx").on(table.userId, table.updatedAt),
    userArchivedIdx: index("mailbox_participants_user_archived_idx").on(table.userId, table.isArchived),
  }),
);

// Short-form actionable alerts (distinct from mailbox)
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("SYSTEM"), // TRADE | SYSTEM | ACCOUNT | SECURITY | KYC | CHALLENGE
    severity: text("severity").notNull().default("INFO"), // INFO | SUCCESS | WARNING | CRITICAL
    title: text("title").notNull(),
    titleEncrypted: text("title_encrypted"),
    message: text("message").notNull(),
    messageEncrypted: text("message_encrypted"),
    contentEncoding: text("content_encoding").notNull().default("PLAINTEXT_V0"),
    encryptionVersion: integer("encryption_version").notNull().default(0),
    contentDigestSha256: text("content_digest_sha256"),
    e2eeEnvelope: text("e2ee_envelope"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: integer("created_at").notNull().default(nowUnix),
    readAt: integer("read_at"),
    link: text("link"),
    sourceEvent: text("source_event"),
  },
  (table) => ({
    userCreatedIdx: index("notifications_user_created_idx").on(table.userId, table.createdAt),
    userReadIdx: index("notifications_user_read_idx").on(table.userId, table.isRead),
  }),
);

// Registered push-notification endpoints (native and wrapper clients)
export const pushDevices = pgTable(
  "push_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appVariant: text("app_variant").notNull().default("native"), // native | wrapper
    platform: text("platform").notNull().default("android"), // android | ios | web
    environment: text("environment").notNull().default("production"), // development | staging | production
    pushProvider: text("push_provider").notNull().default("FCM"), // FCM | APNS
    token: text("token").notNull(),
    tokenHash: text("token_hash").notNull(),
    deviceId: text("device_id"),
    deviceInstallId: text("device_install_id"),
    deviceFingerprint: text("device_fingerprint"),
    appVersion: text("app_version"),
    buildNumber: text("build_number"),
    locale: text("locale"),
    timezone: text("timezone"),
    metadataJson: text("metadata_json"),
    lastSeenAt: integer("last_seen_at").notNull().default(nowUnix),
    createdAt: integer("created_at").notNull().default(nowUnix),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
    revokedAt: integer("revoked_at"),
  },
  (table) => ({
    userUpdatedIdx: index("push_devices_user_updated_idx").on(table.userId, table.updatedAt),
    userPlatformIdx: index("push_devices_user_platform_idx").on(table.userId, table.platform),
    tokenHashUq: uniqueIndex("push_devices_token_hash_uq").on(table.tokenHash),
    deviceInstallIdx: index("push_devices_device_install_idx").on(table.deviceInstallId),
  }),
);

// Immutable mailbox audit trail (append-only hash-chain)
export const mailboxMessageAudit = pgTable(
  "mailbox_message_audit",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").references(() => mailboxMessages.id, { onDelete: "cascade" }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => mailboxThreads.id, { onDelete: "cascade" }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role").notNull().default("SYSTEM"), // USER | ADMIN | SYSTEM
    action: text("action").notNull(), // MESSAGE_CREATED | MESSAGE_REPLIED | THREAD_READ
    ip: text("ip"),
    userAgent: text("user_agent"),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    prevHash: text("prev_hash"),
    eventHash: text("event_hash").notNull(),
  },
  (table) => ({
    threadCreatedIdx: index("mailbox_message_audit_thread_created_idx").on(table.threadId, table.createdAt),
    messageIdx: index("mailbox_message_audit_message_idx").on(table.messageId),
  }),
);

// Global communications configuration (admin-controlled, instantly propagated)
export const communicationSettings = pgTable("communication_settings", {
  id: integer("id").primaryKey().default(1),
  // Messaging controls
  messagingEnabled: boolean("messaging_enabled").notNull().default(true),
  messagingAllowReplyByDefault: boolean("messaging_allow_reply_by_default").notNull().default(false),
  messagingAllowBroadcastReplies: boolean("messaging_allow_broadcast_replies").notNull().default(false),
  messagingLargeTargetThreshold: integer("messaging_large_target_threshold").notNull().default(100),
  messagingMaxRecipientsPerSend: integer("messaging_max_recipients_per_send").notNull().default(10000),
  messagingAsyncFanoutThreshold: integer("messaging_async_fanout_threshold").notNull().default(200),
  messagingFanoutBatchSize: integer("messaging_fanout_batch_size").notNull().default(500),
  messagingAutoWelcomeEnabled: boolean("messaging_auto_welcome_enabled").notNull().default(true),
  messagingAccountStatusMailboxEnabled: boolean("messaging_account_status_mailbox_enabled").notNull().default(true),
  messagingKycMailboxEnabled: boolean("messaging_kyc_mailbox_enabled").notNull().default(true),
  messagingE2eeEnabled: boolean("messaging_e2ee_enabled").notNull().default(false),
  messagingE2eeRequired: boolean("messaging_e2ee_required").notNull().default(false),
  // Notification controls
  notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  notificationRealtimeEnabled: boolean("notification_realtime_enabled").notNull().default(true),
  notificationSoundDefaultEnabled: boolean("notification_sound_default_enabled").notNull().default(true),
  notificationE2eeEnabled: boolean("notification_e2ee_enabled").notNull().default(false),
  notificationE2eeRequired: boolean("notification_e2ee_required").notNull().default(false),
  notificationTradePendingFillEnabled: boolean("notification_trade_pending_fill_enabled").notNull().default(true),
  notificationTradeTakeProfitEnabled: boolean("notification_trade_take_profit_enabled").notNull().default(true),
  notificationTradeStopLossEnabled: boolean("notification_trade_stop_loss_enabled").notNull().default(true),
  notificationTradeMaxHoldEnabled: boolean("notification_trade_max_hold_enabled").notNull().default(true),
  notificationAccountFreezeEnabled: boolean("notification_account_freeze_enabled").notNull().default(true),
  notificationAccountUnfreezeEnabled: boolean("notification_account_unfreeze_enabled").notNull().default(true),
  notificationKycUpdatesEnabled: boolean("notification_kyc_updates_enabled").notNull().default(true),
  notificationChallengeEnabled: boolean("notification_challenge_enabled").notNull().default(true),
  // Audit
  updatedAt: integer("updated_at").notNull().default(nowUnix),
  updatedBy: text("updated_by"),
});

export const mailboxThreadsRelations = relations(mailboxThreads, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [mailboxThreads.createdBy],
    references: [users.id],
  }),
  messages: many(mailboxMessages),
  participants: many(mailboxParticipants),
}));

export const mailboxMessagesRelations = relations(mailboxMessages, ({ one }) => ({
  thread: one(mailboxThreads, {
    fields: [mailboxMessages.threadId],
    references: [mailboxThreads.id],
  }),
  sender: one(users, {
    fields: [mailboxMessages.senderId],
    references: [users.id],
  }),
}));

export const mailboxParticipantsRelations = relations(mailboxParticipants, ({ one }) => ({
  thread: one(mailboxThreads, {
    fields: [mailboxParticipants.threadId],
    references: [mailboxThreads.id],
  }),
  user: one(users, {
    fields: [mailboxParticipants.userId],
    references: [users.id],
  }),
  lastReadMessage: one(mailboxMessages, {
    fields: [mailboxParticipants.lastReadMessageId],
    references: [mailboxMessages.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

export const pushDevicesRelations = relations(pushDevices, ({ one }) => ({
  user: one(users, {
    fields: [pushDevices.userId],
    references: [users.id],
  }),
}));

export const mailboxMessageAuditRelations = relations(mailboxMessageAudit, ({ one }) => ({
  thread: one(mailboxThreads, {
    fields: [mailboxMessageAudit.threadId],
    references: [mailboxThreads.id],
  }),
  message: one(mailboxMessages, {
    fields: [mailboxMessageAudit.messageId],
    references: [mailboxMessages.id],
  }),
  actor: one(users, {
    fields: [mailboxMessageAudit.actorUserId],
    references: [users.id],
  }),
}));

export const insertUserSettingsSchema = createInsertSchema(userSettings);
export const insertMailboxThreadSchema = createInsertSchema(mailboxThreads);
export const insertMailboxMessageSchema = createInsertSchema(mailboxMessages);
export const insertMailboxParticipantSchema = createInsertSchema(mailboxParticipants);
export const insertNotificationSchema = createInsertSchema(notifications);
export const insertPushDeviceSchema = createInsertSchema(pushDevices);
export const insertMailboxMessageAuditSchema = createInsertSchema(mailboxMessageAudit);
export const insertCommunicationSettingsSchema = createInsertSchema(communicationSettings);

// Quotes cache (market data)
export const quotes = pgTable("quotes", {
  symbol: text("symbol").primaryKey(),
  price: real("price").notNull().default(0),
  bid: real("bid"),
  ask: real("ask"),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
  isStale: boolean("is_stale").notNull().default(false),
  lastApiUpdate: bigint("last_api_update", { mode: "number" }),
});

// Global settings table for admin-configured defaults
export const globalSettings = pgTable("global_settings", {
  id: integer("id").primaryKey().default(1),
  // Default Risk Parameters
  defaultLeverage: real("default_leverage").notNull().default(50),
  maxPositionSize: real("max_position_size").notNull().default(100000),
  maxTradesPerUser: integer("max_trades_per_user").notNull().default(10),
  maxTradesPerInstrument: integer("max_trades_per_instrument").notNull().default(3),
  maxConcurrentLots: integer("max_concurrent_lots").notNull().default(50),
  minPriceDistancePips: integer("min_price_distance_pips").notNull().default(20),
  // Market Hours
  marketOpenTime: text("market_open_time").notNull().default("09:00"),
  marketCloseTime: text("market_close_time").notNull().default("17:00"),
  allowWeekendTrading: boolean("allow_weekend_trading").notNull().default(false),
  // Auto-Close Settings and Minimum Hold Times
  enableAutoClose: boolean("enable_auto_close").notNull().default(true),
  autoCloseAfterDays: integer("auto_close_after_days").notNull().default(4),
  autoCloseCheckFrequencyMinutes: integer("auto_close_check_frequency_minutes").notNull().default(60),
  minHoldSec: integer("min_hold_sec").notNull().default(60),
  // Loss Limit Controls
  enableLossLimits: boolean("enable_loss_limits").notNull().default(true),
  dailyLossLimitPct: real("daily_loss_limit_pct").notNull().default(10),
  lifetimeLossLimitPct: real("lifetime_loss_limit_pct").notNull().default(20),
  // Default capital baselines (used for new accounts/challenges)
  defaultUserStartingBalanceUsd: real("default_user_starting_balance_usd").notNull().default(1000000),
  defaultUserStartingEquityUsd: real("default_user_starting_equity_usd").notNull().default(1000000),
  defaultChallengeVirtualCapitalUsd: real("default_challenge_virtual_capital_usd").notNull().default(100000),
  // Visual Lot Settings (UI configuration for trader order form)
  lotPresetCards: text("lot_preset_cards").notNull().default("[1,5,10,25,50]"), // JSON array of lot values for quick-select cards
  lotDropdownMax: integer("lot_dropdown_max").notNull().default(50), // Maximum lot value shown in dropdown
  // Client performance tuning defaults (adaptive tiers apply multipliers on top of these values)
  restFallbackPollMs: integer("rest_fallback_poll_ms").notNull().default(500),
  wsPushFrequencyMs: integer("ws_push_frequency_ms").notNull().default(0),
  quoteFlushIntervalMs: integer("quote_flush_interval_ms").notNull().default(50),
  maxWsReconnectAttempts: integer("max_ws_reconnect_attempts").notNull().default(30),
  wsReconnectBaseDelayMs: integer("ws_reconnect_base_delay_ms").notNull().default(1500),
  prefetchStrategy: text("prefetch_strategy").notNull().default("all"),
  prefetchMaxConcurrency: integer("prefetch_max_concurrency").notNull().default(4),
  prefetchStartDelayMs: integer("prefetch_start_delay_ms").notNull().default(0),
  prefetchFastConcurrencyCap: integer("prefetch_fast_concurrency_cap").notNull().default(3),
  prefetchModerateConcurrencyCap: integer("prefetch_moderate_concurrency_cap").notNull().default(2),
  prefetchConstrainedConcurrencyCap: integer("prefetch_constrained_concurrency_cap").notNull().default(1),
  prefetchNetworkFastStartDelayMs: integer("prefetch_network_fast_start_delay_ms").notNull().default(75),
  prefetchNetworkModerateStartDelayMs: integer("prefetch_network_moderate_start_delay_ms").notNull().default(200),
  prefetchNetworkConstrainedStartDelayMs: integer("prefetch_network_constrained_start_delay_ms").notNull().default(450),
  prefetchDeviceModerateStartDelayMs: integer("prefetch_device_moderate_start_delay_ms").notNull().default(50),
  prefetchDeviceConstrainedStartDelayMs: integer("prefetch_device_constrained_start_delay_ms").notNull().default(150),
  prefetchDeviceMinimalStartDelayMs: integer("prefetch_device_minimal_start_delay_ms").notNull().default(300),
  pollInstantMs: integer("poll_instant_ms").notNull().default(200),
  pollFastMs: integer("poll_fast_ms").notNull().default(500),
  pollModerateMs: integer("poll_moderate_ms").notNull().default(1500),
  pollConstrainedMs: integer("poll_constrained_ms").notNull().default(4000),
  pollMinimalMs: integer("poll_minimal_ms").notNull().default(6000),
  flushInstantMs: integer("flush_instant_ms").notNull().default(50),
  flushFastMs: integer("flush_fast_ms").notNull().default(150),
  flushModerateMs: integer("flush_moderate_ms").notNull().default(300),
  flushConstrainedMs: integer("flush_constrained_ms").notNull().default(500),
  flushMinimalMs: integer("flush_minimal_ms").notNull().default(1000),
  // Timestamp
  updatedAt: integer("updated_at").default(nowUnix),
});

export const insertGlobalSettingsSchema = createInsertSchema(globalSettings);

// System config table for operational controls (separate from trade settings)
export const systemConfig = pgTable("system_config", {
  id: integer("id").primaryKey().default(1),
  // Trading Controls (Safety Switches)
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  tradingHalt: boolean("trading_halt").notNull().default(false),
  closeOnlyMode: boolean("close_only_mode").notNull().default(false),
  blockOpenOnStaleQuotes: boolean("block_open_on_stale_quotes").notNull().default(true),
  maintenanceMessage: text("maintenance_message").default("System is under maintenance. Trading will resume shortly."),
  // Market Data & Refresh Settings
  quoteRefreshMs: integer("quote_refresh_ms").notNull().default(870),
  feedPollMs: integer("feed_poll_ms").notNull().default(870),
  staleThresholdMs: integer("stale_threshold_ms").notNull().default(30000),
  marketDataActiveProviderKey: text("market_data_active_provider_key"),
  marketDataFallbackProviderKeysCsv: text("market_data_fallback_provider_keys_csv").notNull().default(""),
  fxRolloverTz: text("fx_rollover_tz").notNull().default("America/New_York"),
  fxRolloverTime: text("fx_rollover_time").notNull().default("17:00"),
  // Legal Coverage Enforcement
  legalCoverageEnforce: boolean("legal_coverage_enforce").notNull().default(false),
  // Jurisdiction restrictions (block signup/terms resolution)
  jurisdictionRestrictedIso2Csv: text("jurisdiction_restricted_iso2_csv")
    .notNull()
    .default("KP,IR,CU,SY"),
  jurisdictionRestrictedMessage: text("jurisdiction_restricted_message")
    .notNull()
    .default("This jurisdiction is not supported due to regulatory restrictions."),
  // Jurisdiction access controls (geo-blocking)
  jurisdictionEnforceByIpGeo: boolean("jurisdiction_enforce_by_ip_geo")
    .notNull()
    .default(false),
  jurisdictionEnforceBySignupCountry: boolean("jurisdiction_enforce_by_signup_country")
    .notNull()
    .default(true),
  jurisdictionBlockSignup: boolean("jurisdiction_block_signup")
    .notNull()
    .default(true),
  jurisdictionBlockLogin: boolean("jurisdiction_block_login")
    .notNull()
    .default(true),
  // Signup CAPTCHA settings
  signupCaptchaEnforce: boolean("signup_captcha_enforce").notNull().default(true),
  captchaProvider: text("captcha_provider").notNull().default("SLIDER"),
  // Signup phone capture requirement (optional enforcement)
  signupPhoneEnforce: boolean("signup_phone_enforce").notNull().default(true),
  // Signup capacity controls (freeze + invite waitlist)
  signupFreeze: boolean("signup_freeze").notNull().default(false),
  signupFreezeMessage: text("signup_freeze_message").notNull().default(
    "Signups are temporarily paused due to capacity. Existing users can still log in."
  ),
  signupWaitlistEnabled: boolean("signup_waitlist_enabled").notNull().default(true),
  signupWaitlistInviteSender: text("signup_waitlist_invite_sender").notNull().default("TradeQuip <noreply@tradequip.com>"),
  signupWaitlistInviteSubject: text("signup_waitlist_invite_subject").notNull().default("Signup slots are open again"),
  signupWaitlistInviteBodyText: text("signup_waitlist_invite_body_text").notNull().default(
    "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message."
  ),
  signupWaitlistAutoInviteOnUnfreeze: boolean("signup_waitlist_auto_invite_on_unfreeze").notNull().default(false),
  signupWaitlistInviteBatchCap: integer("signup_waitlist_invite_batch_cap").notNull().default(200),
  signupWaitlistPolicyVersion: text("signup_waitlist_policy_version").notNull().default("1"),
  signupWaitlistPolicyContent: text("signup_waitlist_policy_content").notNull().default(
    "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support."
  ),
  // Activity / inactivity deletion controls
  inactivityThresholdDays: integer("inactivity_threshold_days").notNull().default(90),
  deletionGraceDays: integer("deletion_grace_days").notNull().default(30),
  activityAutoQueueInactive: boolean("activity_auto_queue_inactive").notNull().default(true),
  activityAutoSoftDelete: boolean("activity_auto_soft_delete").notNull().default(false),
  // Session and persistent-login controls
  rememberMeEnabled: boolean("remember_me_enabled").notNull().default(true),
  rememberMeMaxAgeDays: integer("remember_me_max_age_days").notNull().default(30),
  rememberMeMaxDevicesPerUser: integer("remember_me_max_devices_per_user").notNull().default(10),
  rememberMeReauthAfterAbsenceDays: integer("remember_me_reauth_after_absence_days").notNull().default(7),
  rememberMeTokenRotationEnabled: boolean("remember_me_token_rotation_enabled").notNull().default(true),
  rememberMeTheftAutoRevokeAll: boolean("remember_me_theft_auto_revoke_all").notNull().default(true),
  sessionCookieMaxAgeHours: integer("session_cookie_max_age_hours").notNull().default(24),
  sessionIdleTimeoutMinutes: integer("session_idle_timeout_minutes").notNull().default(0),
  logoutClearAllDeviceTokens: boolean("logout_clear_all_device_tokens").notNull().default(false),

  // Bot detection (adaptive PoW + score storage)
  botScoreThreshold: integer("bot_score_threshold").notNull().default(40),
  botPowEnabled: boolean("bot_pow_enabled").notNull().default(true),
  botPowEnforceSignup: boolean("bot_pow_enforce_signup").notNull().default(true),
  botPowEnforceLogin: boolean("bot_pow_enforce_login").notNull().default(false),
  botPowChallengeScore: integer("bot_pow_challenge_score").notNull().default(25),
  botPowBaseDifficulty: integer("bot_pow_base_difficulty").notNull().default(14),
  botPowMaxDifficulty: integer("bot_pow_max_difficulty").notNull().default(20),
  botPowTtlSec: integer("bot_pow_ttl_sec").notNull().default(120),
  botValkeyEnabled: boolean("bot_valkey_enabled").notNull().default(true),

  // User preference policy
  allowUserTimezoneEdit: boolean("allow_user_timezone_edit").notNull().default(true),
  // Policy config: contender thresholds (admin-editable)
  policyContenderPath1MinAgeDays: integer("policy_contender_path1_min_age_days").notNull().default(30),
  policyContenderPath1MinTradesLifetime: integer("policy_contender_path1_min_trades_lifetime").notNull().default(30),
  policyContenderPath1MinBalancePct: real("policy_contender_path1_min_balance_pct").notNull().default(1.2),
  policyContenderPath2MinAgeDays: integer("policy_contender_path2_min_age_days").notNull().default(90),
  policyContenderPath2MinTradesLast90: integer("policy_contender_path2_min_trades_last90").notNull().default(20),
  policyContenderPath2MinReturnLast90: real("policy_contender_path2_min_return_last90").notNull().default(0.1),
  policyContenderPath2MaxDaysSinceLastTrade: integer("policy_contender_path2_max_days_since_last_trade").notNull().default(14),
  policyAutoPromotePerformer: boolean("policy_auto_promote_performer").notNull().default(true),
  // Scout + recruitment ecosystem toggles
  scoutTabEnabled: boolean("scout_tab_enabled").notNull().default(true),
  partnerPortalEnabled: boolean("partner_portal_enabled").notNull().default(false),
  traderProProfilesEnabled: boolean("trader_pro_profiles_enabled").notNull().default(false),
  traderCompeteEnabled: boolean("trader_compete_enabled").notNull().default(false),
  // Challenges V4 defaults & toggles
  challengeAutoAdvancePhase: boolean("challenge_auto_advance_phase").notNull().default(true),
  challengeDefaultDrawdownType: text("challenge_default_drawdown_type").notNull().default("STATIC"),
  challengeDefaultCapitalMode: text("challenge_default_capital_mode").notNull().default("VIRTUAL"),
  challengeDefaultMaxRetries: integer("challenge_default_max_retries").notNull().default(3),
  challengeDefaultRetryCooldownHours: integer("challenge_default_retry_cooldown_hours").notNull().default(24),
  challengeDefaultEligibility: text("challenge_default_eligibility").notNull().default("EMAIL_VERIFIED"),
  challengeDefaultCategory: text("challenge_default_category").notNull().default("STANDARD"),
  challengeDefaultTier: text("challenge_default_tier").notNull().default("STARTER"),
  challengeRewardsEnabled: boolean("challenge_rewards_enabled").notNull().default(true),
  challengePrizePoolsEnabled: boolean("challenge_prize_pools_enabled").notNull().default(true),
  challengeBadgesEnabled: boolean("challenge_badges_enabled").notNull().default(true),
  challengeCertificatesEnabled: boolean("challenge_certificates_enabled").notNull().default(true),
  challengeCertificatesDownloadable: boolean("challenge_certificates_downloadable").notNull().default(true),
  challengeCertificatesShareable: boolean("challenge_certificates_shareable").notNull().default(true),
  challengeSelectionBoostEnabled: boolean("challenge_selection_boost_enabled").notNull().default(true),
  challengeDefaultSelectionBoost: integer("challenge_default_selection_boost").notNull().default(0),
  challengeProgressionEnabled: boolean("challenge_progression_enabled").notNull().default(true),
  challengeCustomRewardsEnabled: boolean("challenge_custom_rewards_enabled").notNull().default(false),
  challengeNotifyOnEnroll: boolean("challenge_notify_on_enroll").notNull().default(true),
  challengeNotifyOnPhaseWarning: boolean("challenge_notify_on_phase_warning").notNull().default(true),
  challengeNotifyOnBreach: boolean("challenge_notify_on_breach").notNull().default(true),
  challengeNotifyOnPhasePass: boolean("challenge_notify_on_phase_pass").notNull().default(true),
  challengeNotifyOnFail: boolean("challenge_notify_on_fail").notNull().default(true),
  challengeNotifyOnComplete: boolean("challenge_notify_on_complete").notNull().default(true),
  challengeNotifyOnBadgeAward: boolean("challenge_notify_on_badge_award").notNull().default(true),
  challengeNotifyOnPrizeAward: boolean("challenge_notify_on_prize_award").notNull().default(true),
  challengeNotifyOnCertIssue: boolean("challenge_notify_on_cert_issue").notNull().default(true),
  challengeNotifyOnTierUp: boolean("challenge_notify_on_tier_up").notNull().default(true),
  challengeNotifyOnAdminAction: boolean("challenge_notify_on_admin_action").notNull().default(true),
  challengeNotifyViaMailbox: boolean("challenge_notify_via_mailbox").notNull().default(false),
  challengeMailboxCategory: text("challenge_mailbox_category").notNull().default("SYSTEM"),
  challengeWarningThresholdPct: real("challenge_warning_threshold_pct").notNull().default(0.8),
  challengeBreachPolicyDefault: text("challenge_breach_policy_default").notNull().default("FAIL"), // FAIL | BREACH_AND_CONTINUE | MANUAL_REVIEW
  challengeSingleDayProfitBasis: text("challenge_single_day_profit_basis").notNull().default("PNL_PCT"), // PNL_PCT | EQUITY_PCT | REALIZED_ONLY
  challengeLeaderboardEnabled: boolean("challenge_leaderboard_enabled").notNull().default(true),
  challengeLeaderboardRefreshSec: integer("challenge_leaderboard_refresh_sec").notNull().default(60),
  challengeLeaderboardSnapshotIntervalSec: integer("challenge_leaderboard_snapshot_interval_sec").notNull().default(60),
  challengeLeaderboardRankingMetric: text("challenge_leaderboard_ranking_metric").notNull().default("COMPOSITE_SCORE"), // COMPOSITE_SCORE | PNL_PCT
  challengePrizeAwardTimingDefault: text("challenge_prize_award_timing_default").notNull().default("ON_COMPLETE"), // ON_COMPLETE | ON_CHALLENGE_END | MANUAL
  challengePrizeCandidatesDefault: text("challenge_prize_candidates_default").notNull().default("PASSED_ONLY"), // PASSED_ONLY | INCLUDE_ACTIVE
  challengeNewsBlackoutWindowsJson: text("challenge_news_blackout_windows_json").notNull().default("[]"),
  challengeWeekendCutoffHours: integer("challenge_weekend_cutoff_hours").notNull().default(6),
  challengeForceCloseBeforeWeekend: boolean("challenge_force_close_before_weekend").notNull().default(false),
  challengeLeverageMultiplierDefault: real("challenge_leverage_multiplier_default").notNull().default(1),
  challengeMaxActiveEnrollmentsUser: integer("challenge_max_active_enrollments_user").notNull().default(5),
  challengeMaxActiveEnrollmentsPerChallenge: integer("challenge_max_active_enrollments_per_challenge").notNull().default(1),
  challengeCooldownHoursAfterFail: integer("challenge_cooldown_hours_after_fail").notNull().default(24),
  challengeCooldownHoursAfterWithdraw: integer("challenge_cooldown_hours_after_withdraw").notNull().default(12),
  challengeCertificateDefaultTemplateId: integer("challenge_certificate_default_template_id"),
  challengeCertificateIncludeMetricsDefault: boolean("challenge_certificate_include_metrics_default").notNull().default(true),
  challengeCertificateIncludeQrDefault: boolean("challenge_certificate_include_qr_default").notNull().default(true),
  challengeCertificateVerificationKeyId: text("challenge_certificate_verification_key_id").notNull().default("v1"),
  challengeEvaluationIntervalSec: integer("challenge_evaluation_interval_sec").notNull().default(3600),
  challengeAuditStrictMode: boolean("challenge_audit_strict_mode").notNull().default(true),
  challengeAnomalyDetectionEnabled: boolean("challenge_anomaly_detection_enabled").notNull().default(true),
  challengeManualReviewEnabled: boolean("challenge_manual_review_enabled").notNull().default(false),
  challengeManualReviewSuspiciousThreshold: integer("challenge_manual_review_suspicious_threshold").notNull().default(3),
  challengeEvalEnabled: boolean("challenge_eval_enabled").notNull().default(true),
  challengeEvalIntervalMin: integer("challenge_eval_interval_min").notNull().default(60),
  challengeEvalMaxRows: integer("challenge_eval_max_rows").notNull().default(500),
  traderCommunityEnabled: boolean("trader_community_enabled").notNull().default(false),
  partnerAllocationsEnabled: boolean("partner_allocations_enabled").notNull().default(false),
  partnerGatingConfig: text("partner_gating_config")
    .notNull()
    .default(
      JSON.stringify({
        viewDataRoom: "INVITED",
        runSimulations: "IDENTITY",
        requestAllocation: "COMPLIANT",
        directContact: "ADMIN_APPROVED",
      }),
    ),
  partnerPasswordRotationDays: integer("partner_password_rotation_days").notNull().default(90),
  partnerPasswordReminderLogins: integer("partner_password_reminder_logins").notNull().default(3),
  partnerInviteDefaultExpiryDays: integer("partner_invite_default_expiry_days").notNull().default(7),
  partnerInquiryInboxAlias: text("partner_inquiry_inbox_alias").notNull().default("inquiries@"),
  partnerInquiryRouteAdminEmailsCsv: text("partner_inquiry_route_admin_emails_csv").notNull().default(""),
  partnerInquiryViewerAdminEmailsCsv: text("partner_inquiry_viewer_admin_emails_csv").notNull().default(""),
  leaderboardMode: text("leaderboard_mode").notNull().default("PUBLIC"), // PUBLIC | TOP_10 | DISABLED
  scoutMinSharpeAlert: real("scout_min_sharpe_alert").notNull().default(2.0),
  policyEmailResendCooldownSec: integer("policy_email_resend_cooldown_sec").notNull().default(60),
  policyEmailDailySendCap: integer("policy_email_daily_send_cap").notNull().default(5),
  policySmsDailySendCap: integer("policy_sms_daily_send_cap").notNull().default(5),
  policySmsResendCooldownSec: integer("policy_sms_resend_cooldown_sec").notNull().default(60),
  policyOtpMaxAttempts: integer("policy_otp_max_attempts").notNull().default(5),
  policyOtpLockMinutes: integer("policy_otp_lock_minutes").notNull().default(30),
  // i18n (dynamic UI translations)
  i18nEnabled: boolean("i18n_enabled").notNull().default(true),
  i18nDefaultLocale: text("i18n_default_locale").notNull().default("en"),
  i18nSupportedLocalesCsv: text("i18n_supported_locales_csv")
    .notNull()
    .default("en,fr,pt,es,de,ar,hi,id,zh,ms,tl,ko,ja,sw,th,bn,tr"),
  i18nAutoTranslate: boolean("i18n_auto_translate").notNull().default(true),
  i18nLlmEnabled: boolean("i18n_llm_enabled").notNull().default(true),
  i18nLlmProvider: text("i18n_llm_provider").notNull().default("openai"),
  i18nLlmModel: text("i18n_llm_model").notNull().default("gpt-4o-mini"),
  i18nLlmMaxBatchSize: integer("i18n_llm_max_batch_size").notNull().default(50),
  i18nLlmMaxAttempts: integer("i18n_llm_max_attempts").notNull().default(3),
  // Migration export/import chunking
  migrationChunkingEnabled: boolean("migration_chunking_enabled").notNull().default(false),
  migrationChunkSizeMb: integer("migration_chunk_size_mb").notNull().default(51200),
  // Timestamp
  updatedAt: integer("updated_at").default(nowUnix),
  updatedBy: text("updated_by"),
});

export const insertSystemConfigSchema = createInsertSchema(systemConfig);
