import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;

import { symbolConfigs, users } from "./schema.pg.base";

// Legal document type enum values
export type LegalDocType = "GLOBAL_MASTER" | "ADDENDUM";
export type LegalJurisdictionType = "DEFAULT" | "COUNTRY" | "REGION";
export type LegalDocAction = "CREATE_VERSION" | "SET_ACTIVE" | "REPLACE_ACTIVE" | "ROLLBACK";

// Legal documents (versioned terms with 4-part key structure)
export const legalDocuments = pgTable("legal_documents", {
  id: serial("id").primaryKey(),
  docSet: text("doc_set").notNull(), // e.g., "TERMS_V1", "PRIVACY_V1"
  docType: text("doc_type").notNull(), // GLOBAL_MASTER | ADDENDUM
  jurisdictionType: text("jurisdiction_type").notNull(), // DEFAULT | COUNTRY | REGION
  jurisdictionKey: text("jurisdiction_key").notNull(), // e.g., "GLOBAL", "US", "EU", "US-CA"
  version: text("version").notNull(), // semver: 1.0.0
  sha256: text("sha256").notNull(), // SHA-256 hash of content
  content: text("content").notNull(), // Full document HTML/Markdown
  notes: text("notes"), // Admin notes about this version
  title: text("title"), // Legacy admin title
  locale: text("locale"), // Legacy admin locale
  updatedAt: bigint("updated_at", { mode: "number" }),
  updatedByAdminUserId: integer("updated_by_admin_user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowUnixMs), // timestamp_ms
  createdByAdminUserId: integer("created_by_admin_user_id"),
});

// Legal document pointers (which doc version is active for each 4-part key)
export const legalDocPointers = pgTable("legal_doc_pointers", {
  id: serial("id").primaryKey(),
  docSet: text("doc_set").notNull(), // e.g., "TERMS_V1", "PRIVACY_V1"
  docType: text("doc_type").notNull(), // GLOBAL_MASTER | ADDENDUM
  jurisdictionType: text("jurisdiction_type").notNull(), // DEFAULT | COUNTRY | REGION
  jurisdictionKey: text("jurisdiction_key").notNull(), // e.g., "GLOBAL", "US", "EU"
  activeDocumentId: integer("active_document_id").references(() => legalDocuments.id),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowUnixMs), // timestamp_ms
  updatedByAdminUserId: integer("updated_by_admin_user_id"),
});
// Note: Unique index on (docSet, docType, jurisdictionType, jurisdictionKey) should be created in ensureSchema.ts

// Legal acceptances (hash-chained tamper-evident ledger with full audit trail)
export const legalAcceptances = pgTable("legal_acceptances", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),

  // User context at time of acceptance
  emailAtAcceptance: text("email_at_acceptance"), // Email address at acceptance time
  countryIso2: text("country_iso2"), // User's country (ISO 3166-1 alpha-2)
  regionKey: text("region_key"), // User's region (e.g., "US-CA", "EU")

  // Global Master document reference
  globalDocId: integer("global_doc_id").references(() => legalDocuments.id),
  globalDocVersion: text("global_doc_version"),
  globalDocSha256: text("global_doc_sha256"),

  // Addendum document reference (if applicable)
  addendumId: integer("addendum_id").references(() => legalDocuments.id),
  addendumVersion: text("addendum_version"),
  addendumSha256: text("addendum_sha256"),

  // Combined document hash (for tamper evidence)
  combinedSha256: text("combined_sha256").notNull(), // SHA-256 of global + addendum combined
  combinedText: text("combined_text"), // Full combined text that was accepted

  // Hash-chain for tamper-evident ledger
  ledgerSeq: integer("ledger_seq").notNull(), // Monotonic sequence number
  prevLedgerHash: text("prev_ledger_hash"), // Hash of previous acceptance record (null for first)
  ledgerHash: text("ledger_hash").notNull(), // SHA-256 hash of this record including prevLedgerHash

  // Client provenance
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  sessionId: text("session_id"),

  // Legacy fields (deprecated but kept for compatibility)
  docId: integer("doc_id").references(() => legalDocuments.id),
  docVersion: text("doc_version"),
  docContentHash: text("doc_content_hash"),
  termsToken: text("terms_token"),
  termsTokenVerified: boolean("terms_token_verified").default(false),
  acceptedFromIp: text("accepted_from_ip"),
  acceptedUserAgent: text("accepted_user_agent"),
  prevHash: text("prev_hash"),
  recordHash: text("record_hash"),

  acceptedAt: integer("accepted_at").notNull().default(nowUnix),
  // Milliseconds precision timestamp for hash computation (not coerced by Drizzle)
  acceptedAtMs: bigint("accepted_at_ms", { mode: "number" }),
});

// Re-acceptance requirements (when active terms change after last user acceptance)
export const legalReacceptRequirements = pgTable(
  "legal_reaccept_requirements",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),

    docSet: text("doc_set").notNull(), // e.g. "DOC1"

    // Jurisdiction snapshot for the required hash
    countryIso2: text("country_iso2").notNull(),
    regionKey: text("region_key"),

    requiredCombinedSha256: text("required_combined_sha256").notNull(),

    // Snapshot of the last known acceptance at the time this requirement was detected
    lastAcceptedCombinedSha256: text("last_accepted_combined_sha256"),
    lastAcceptanceId: integer("last_acceptance_id").references(() => legalAcceptances.id),

    detectedAtMs: bigint("detected_at_ms", { mode: "number" }).notNull(),
    detectedBy: text("detected_by").notNull().default("LOGIN"), // LOGIN | TRADE | STATUS
  },
  (t) => ({
    uniqueUserDocSet: uniqueIndex("idx_legal_reaccept_requirements_user_docset").on(t.userId, t.docSet),
  }),
);

// Legacy (pre-chain) change audit table used by legacy admin routes.
// Kept to avoid breaking the legacy legal-docs system.
export const legalDocChangeAuditLegacy = pgTable("legal_doc_change_audit", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id"),
  targetId: integer("target_id"),
  action: text("action").notNull(),
  changedBy: text("changed_by"),
  changedAt: integer("changed_at"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
});

// Legal document change audit trail (v2, hash-chained)
export const legalDocChangeAudit = pgTable("legal_doc_change_audit_chain", {
  id: serial("id").primaryKey(),

  // Hash-chain for tamper-evidence
  seq: integer("seq").notNull(), // Monotonic sequence number
  prevHash: text("prev_hash").notNull(), // Hash of previous audit record ("GENESIS" for first)
  eventHash: text("event_hash").notNull(), // SHA-256 hash of this event including prevHash

  // Actor
  adminUserId: integer("admin_user_id"),

  // Action type
  action: text("action").notNull(), // CREATE_VERSION | SET_ACTIVE | REPLACE_ACTIVE | ROLLBACK

  // 4-part key context
  docSet: text("doc_set"),
  docType: text("doc_type"),
  jurisdictionType: text("jurisdiction_type"),
  jurisdictionKey: text("jurisdiction_key"),

  // Document references
  oldActiveDocumentId: integer("old_active_document_id").references(() => legalDocuments.id),
  newActiveDocumentId: integer("new_active_document_id").references(() => legalDocuments.id),

  // Additional context
  note: text("note"),

  // Millisecond precision timestamp used in the hash payload (must be stored for verifiability).
  createdAtMs: bigint("created_at_ms", { mode: "number" }).notNull(),
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
export const dailyFxCloses = pgTable("daily_fx_closes", {
  id: serial("id").primaryKey(),
  symbolId: integer("symbol_id").notNull().references(() => symbolConfigs.id),
  symbolName: text("symbol_name").notNull(), // Denormalized for quick lookup
  tradeDate: text("trade_date").notNull(), // YYYY-MM-DD in rollover TZ
  closePrice: real("close_price").notNull(),
  bidPrice: real("bid_price"),
  askPrice: real("ask_price"),
  source: text("source").notNull().default("1FORGE"), // Data source
  rolloverTz: text("rollover_tz").notNull(), // TZ used for this calculation
  rolloverTime: text("rollover_time").notNull(), // HH:MM used for this calculation
  calculatedAt: integer("calculated_at").notNull().default(nowUnix),
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
