import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;

import { rememberMeTokens, trades, userSessions } from "./schema.pg.base";

// Trade audit table (backend-only for full execution audit trail) - INSTITUTIONAL GRADE
export const tradeAudit = pgTable("trade_audit", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull().references(() => trades.id),

  // Event identification
  eventType: text("event_type").notNull(), // ORDER_PLACED, ORDER_FILLED, POSITION_CLOSED, ORDER_CANCELED, ORDER_REJECTED, RISK_CHECK_PASS, RISK_CHECK_FAIL, TARGETS_UPDATED, SL_TRIGGERED, TP_TRIGGERED
  eventCategory: text("event_category").notNull().default("TRADE"), // ORDER, EXECUTION, POSITION, RISK, ADMIN, SYSTEM
  eventAt: integer("event_at").notNull().default(nowUnix),
  eventAtMs: bigint("event_at_ms", { mode: "number" }), // Millisecond precision timestamp

  // Correlation & lifecycle IDs
  correlationId: text("correlation_id"), // Links related events across the order lifecycle
  orderId: text("order_id"), // Unique per order intent
  executionId: text("execution_id"), // Unique per fill
  positionId: text("position_id"), // Unique per open position

  // Actor/provenance (who/where/how)
  actorType: text("actor_type").notNull().default("SYSTEM"), // USER, ADMIN, SYSTEM
  actorUserId: integer("actor_user_id"),
  sessionId: text("session_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),

  // Order economics
  symbol: text("symbol"),
  side: text("side"), // BUY, SELL
  orderType: text("order_type"), // MARKET, LIMIT, STOP, STOP_LIMIT
  timeInForce: text("time_in_force"), // GTC, DAY, IOC, FOK
  qtyLots: real("qty_lots"),
  notionalUsd: real("notional_usd"),

  // Cost & P/L breakdown (snapshot at event time)
  grossProfitUsd: real("gross_profit_usd"),
  netProfitUsd: real("net_profit_usd"),
  totalCostsUsd: real("total_costs_usd"),
  openCommissionUsd: real("open_commission_usd"),
  closeCommissionUsd: real("close_commission_usd"),
  openOtherFeesUsd: real("open_other_fees_usd"),
  closeOtherFeesUsd: real("close_other_fees_usd"),
  financingAccruedUsd: real("financing_accrued_usd"),
  swapAccruedUsd: real("swap_accrued_usd"),
  overnightDays: integer("overnight_days"),
  categorySnapshot: text("category_snapshot"),
  costModelVersion: text("cost_model_version"),

  // Pricing
  requestedPrice: real("requested_price"),
  triggerPrice: real("trigger_price"),
  limitPrice: real("limit_price"),
  stopPrice: real("stop_price"),
  fillPrice: real("fill_price"),
  avgFillPrice: real("avg_fill_price"),

  // Market context at event time
  quoteTs: integer("quote_ts"),
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
}, (table) => ({
  tradeIdx: index("trade_audit_trade_idx").on(table.tradeId),
  tradePrevHashUid: uniqueIndex("trade_audit_trade_prev_hash_uidx").on(table.tradeId, table.prevHash),
}));

export const tradeAuditRelations = relations(tradeAudit, ({ one }) => ({
  trade: one(trades, {
    fields: [tradeAudit.tradeId],
    references: [trades.id],
  }),
}));

// Order Intent Audit - captures RECEIVED and DECISION events for full order lifecycle
export const orderIntentAudit = pgTable("order_intent_audit", {
  id: serial("id").primaryKey(),
  correlationId: text("correlation_id").notNull(), // Links to trade_audit events

  // Timestamps
  eventAt: integer("event_at").notNull().default(nowUnix),
  eventAtMs: bigint("event_at_ms", { mode: "number" }), // Millisecond precision

  // Event type
  eventCode: text("event_code").notNull(), // ORDER_RECEIVED, ORDER_VALIDATED, RISK_CHECK, DECISION
  decision: text("decision"), // PASS, REJECT (for DECISION events)
  rejectCheck: text("reject_check"), // Which check failed (e.g., MAX_CONCURRENT_LOTS)
  rejectReason: text("reject_reason"), // Human-readable reason

  // Actor/provenance
  actorType: text("actor_type").notNull().default("USER"), // USER, ADMIN, SYSTEM
  userId: integer("user_id").notNull(),
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
  quoteTs: integer("quote_ts"),
  quoteIsStale: boolean("quote_is_stale"),

  // Risk evidence snapshot
  riskLimitJson: text("risk_limit_json"), // JSON: {maxLots: 50, maxTrades: 5, ...}
  riskObservedJson: text("risk_observed_json"), // JSON: {currentLots: 45, openTrades: 3, ...}
  riskSnapshotJson: text("risk_snapshot_json"), // Full account state at decision time

  // Data integrity
  payloadJson: text("payload_json").notNull(),
  prevHash: text("prev_hash").notNull(),
  eventHash: text("event_hash").notNull(),
}, (table) => ({
  corrIdx: index("order_intent_audit_corr_idx").on(table.correlationId),
  corrPrevHashUid: uniqueIndex("order_intent_audit_corr_prev_hash_uidx").on(table.correlationId, table.prevHash),
}));

// Login history & IP tracking (with session tracking)
export const userLoginHistory = pgTable("user_login_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  email: text("email").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"),
  logoutAt: integer("logout_at"), // When the session ended
  sessionLengthSec: integer("session_length_sec"), // Session duration in seconds
  createdAt: integer("created_at").notNull().default(nowUnix),
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
export const userAccountEvents = pgTable("user_account_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  adminId: integer("admin_id"),
  eventType: text("event_type").notNull(), // FREEZE, UNFREEZE, BALANCE_ADJUSTMENT, STATUS_CHANGE, NOTE_ADDED, FLAG_ADDED
  title: text("title").notNull(),
  description: text("description"),
  reasonCode: text("reason_code"),
  reasonText: text("reason_text"),
  metadata: text("metadata"), // JSON string for additional data
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// Admin notes/flags on user accounts
export const userAdminNotes = pgTable("user_admin_notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  adminId: integer("admin_id"),
  type: text("type").notNull().default("NOTE"), // NOTE | FLAG
  severity: text("severity").notNull().default("INFO"), // INFO | WARN | HIGH | CRITICAL
  flagCode: text("flag_code"), // e.g. COMPLIANCE_REVIEW, SUSPICIOUS_ACTIVITY
  content: text("content").notNull(),
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedAt: integer("resolved_at"),
  resolvedByAdminId: integer("resolved_by_admin_id"),
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// Bot risk assessments (one per user; higher score => more bot-like)
export const botRiskAssessments = pgTable("bot_risk_assessments", {
  userId: integer("user_id").primaryKey(),
  score: integer("score").notNull().default(0),
  label: text("label").notNull().default("OK"), // OK | SUSPICIOUS | HIGH
  signalsJson: text("signals_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// User deletion queue (one row per user)
export const userDeletionQueue = pgTable("user_deletion_queue", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  status: text("status").notNull().default("GRACE"), // GRACE | EXECUTED_SOFT | EXECUTED_HARD | CANCELLED
  reason: text("reason").notNull().default("INACTIVE"), // INACTIVE | BOT | ADMIN
  markedAt: integer("marked_at").notNull(),
  graceExpiresAt: integer("grace_expires_at").notNull(),
  lastActiveAt: integer("last_active_at"),
  executedAt: integer("executed_at"),
  executedByAdminId: integer("executed_by_admin_id"),
  note: text("note"),
});

export const insertUserLoginHistorySchema = createInsertSchema(userLoginHistory);
export const insertUserAccountEventSchema = createInsertSchema(userAccountEvents);
export const insertUserAdminNoteSchema = createInsertSchema(userAdminNotes);
export const insertUserSessionSchema = createInsertSchema(userSessions);
export const insertRememberMeTokenSchema = createInsertSchema(rememberMeTokens);

// Trader Journal for trade logging/notes
export const traderJournal = pgTable("trader_journal", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  tradeId: integer("trade_id"), // Deprecated - use tradeIds
  tradeIds: text("trade_ids"), // JSON array of trade IDs - for multiple trades
  note: text("note").notNull(),
  mood: text("mood"), // e.g. "confident", "nervous", "neutral"
  tags: text("tags"), // JSON array stored as string
  attachmentUrl: text("attachment_url"),
  createdAt: integer("created_at").notNull().default(nowUnix),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

export const insertTraderJournalSchema = createInsertSchema(traderJournal);

// Admin actions audit log (for View-As and other admin actions)
export const adminActions = pgTable("admin_actions", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull(),
  userId: integer("user_id").notNull(),
  actionType: text("action_type").notNull(), // VIEW_AS_START, VIEW_AS_STOP, etc.
  metadata: text("metadata"), // JSON string for additional data
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull().default(nowUnix),
});

export const insertAdminActionSchema = createInsertSchema(adminActions);

// Audit export manifest table for export integrity hashing
export const auditExportManifest = pgTable(
  "audit_export_manifest",
  {
    exportId: text("export_id").primaryKey(),
    exportedAtUtcMs: bigint("exported_at_utc_ms", { mode: "number" }).notNull(),
    exportType: text("export_type").notNull(),
    exportFormat: text("export_format").notNull(),
    filtersJson: text("filters_json").notNull(),
    recordCount: integer("record_count").notNull(),
    sha256: text("sha256").notNull(),
  },
  (table) => ({
    byTypeTime: index("idx_aem_type_time").on(table.exportType, table.exportedAtUtcMs),
  })
);

export const insertAuditExportManifestSchema = createInsertSchema(auditExportManifest);

// Admin DataTab export jobs (durable background exports)
export const adminDataExportJobs = pgTable(
  "admin_data_export_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // trader_scouting | deactivated_accounts | all_trades | daily_pnl
    format: text("format").notNull(), // csv | jsonl | parquet
    status: text("status").notNull().default("QUEUED"), // QUEUED | RUNNING | READY | FAILED | CANCELED | EXPIRED
    requestedByAdminId: integer("requested_by_admin_id"),
    filterHash: text("filter_hash"),
    filtersJson: text("filters_json").notNull().default("{}"),
    queueName: text("queue_name").notNull().default("admin-export-v1"),
    queueJobId: text("queue_job_id"),
    objectKey: text("object_key"),
    rowCount: integer("row_count"),
    bytesWritten: bigint("bytes_written", { mode: "number" }),
    truncated: boolean("truncated").notNull().default(false),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(6),
    error: text("error"),
    createdAt: integer("created_at").notNull().default(nowUnix),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    expiresAt: integer("expires_at"),
    updatedAt: integer("updated_at").notNull().default(nowUnix),
  },
  (table) => ({
    statusCreatedIdx: index("idx_ade_jobs_status_created").on(table.status, table.createdAt),
    typeCreatedIdx: index("idx_ade_jobs_type_created").on(table.type, table.createdAt),
    requestedByCreatedIdx: index("idx_ade_jobs_req_created").on(table.requestedByAdminId, table.createdAt),
    dedupeIdx: index("idx_ade_jobs_filter_hash").on(table.filterHash, table.status, table.createdAt),
    queueIdx: index("idx_ade_jobs_queue").on(table.queueName, table.queueJobId),
  }),
);

export const adminDataExportJobEvents = pgTable(
  "admin_data_export_job_events",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    ts: integer("ts").notNull().default(nowUnix),
    level: text("level").notNull().default("INFO"), // INFO | WARN | ERROR
    message: text("message").notNull(),
    contextJson: text("context_json").notNull().default("{}"),
  },
  (table) => ({
    jobTsIdx: index("idx_ade_events_job_ts").on(table.jobId, table.ts),
  }),
);

export const insertAdminDataExportJobSchema = createInsertSchema(adminDataExportJobs);
export const insertAdminDataExportJobEventSchema = createInsertSchema(adminDataExportJobEvents);

// Admin DataTab rollup snapshots (bounded read model for hot dashboard endpoints)
export const adminDataRollups = pgTable(
  "admin_data_rollups",
  {
    metricKey: text("metric_key").notNull(),
    windowDays: integer("window_days").notNull().default(0),
    computedAt: integer("computed_at").notNull().default(nowUnix),
    dataJson: text("data_json").notNull().default("{}"),
    source: text("source").notNull().default("sql"),
    refreshedByRole: text("refreshed_by_role"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.metricKey, table.windowDays], name: "admin_data_rollups_pk" }),
    computedIdx: index("idx_admin_data_rollups_computed").on(table.metricKey, table.windowDays, table.computedAt),
  }),
);

export const insertAdminDataRollupSchema = createInsertSchema(adminDataRollups);

// Migration export/import jobs (backup + platform migration)
export const migrationExportJobs = pgTable("migration_export_jobs", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(), // FULL_PLATFORM | USER_BUNDLE | DELTA
  userId: integer("user_id"),
  sinceTs: integer("since_ts"),
  requestedByAdminId: integer("requested_by_admin_id"),
  status: text("status").notNull(), // QUEUED | RUNNING | READY | FAILED
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  totalsJson: text("totals_json").notNull().default("{}"),
  manifestJson: text("manifest_json").notNull().default("{}"),
  // Chunking metadata (optional)
  dataPartsJson: text("data_parts_json"),
  chunkingEnabled: boolean("chunking_enabled"),
  chunkSizeMb: integer("chunk_size_mb"),
  manifestSha256: text("manifest_sha256"),
  dataSha256: text("data_sha256"),
  dataPath: text("data_path"),
  manifestPath: text("manifest_path"),
  error: text("error"),
});

export const migrationImportJobs = pgTable("migration_import_jobs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(), // DRY_RUN | IMPORT
  idStrategy: text("id_strategy").notNull().default("PRESERVE"), // PRESERVE
  requestedByAdminId: integer("requested_by_admin_id"),
  status: text("status").notNull(), // QUEUED | RUNNING | COMPLETE | FAILED
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  manifestSha256: text("manifest_sha256"),
  dataSha256: text("data_sha256"),
  // Chunked imports can store multiple uploaded part paths
  dataPartsJson: text("data_parts_json"),
  dataPath: text("data_path"),
  manifestPath: text("manifest_path"),
  totalsJson: text("totals_json").notNull().default("{}"),
  error: text("error"),
});

export const migrationJobLogs = pgTable("migration_job_logs", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull(),
  ts: integer("ts").notNull(),
  level: text("level").notNull(), // INFO | WARN | ERROR
  message: text("message").notNull(),
  contextJson: text("context_json").notNull().default("{}"),
});

export const migrationIdMap = pgTable("migration_id_map", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull(),
  entityType: text("entity_type").notNull(),
  legacyId: text("legacy_id").notNull(),
  newId: text("new_id").notNull(),
});

export const migrationIntegrityChecks = pgTable("migration_integrity_checks", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull(),
  chainType: text("chain_type").notNull(),
  entityKey: text("entity_key").notNull(),
  status: text("status").notNull(), // PASS | FAIL
  failureReason: text("failure_reason"),
  verifiedAt: integer("verified_at").notNull(),
});
