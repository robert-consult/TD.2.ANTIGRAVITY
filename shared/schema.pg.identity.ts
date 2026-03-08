import { pgTable, text, integer, real, primaryKey, serial, boolean, bigint, index, uniqueIndex, json, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";

const nowUnix = sql`(extract(epoch from now()))`;
const nowUnixMs = sql`(extract(epoch from now()) * 1000)`;


// User verification status and rate limiting
export const userVerification = pgTable("user_verification", {
  userId: integer("user_id").primaryKey().notNull(),

  // Email verification lifecycle
  emailVerifiedAt: integer("email_verified_at"),
  emailInitialDueAt: integer("email_initial_due_at"),
  emailReverifyDueAt: integer("email_reverify_due_at"),
  emailResendDayKey: text("email_resend_day_key"), // YYYY-MM-DD for daily rate limit
  emailResendCountDay: integer("email_resend_count_day").default(0),
  emailLastResendAt: integer("email_last_resend_at"),
  emailResendDayStart: integer("email_resend_day_start"),

  // Phone/SMS verification
  phoneE164: text("phone_e164"),
  smsVerifiedAt: integer("sms_verified_at"),
  smsSendDayKey: text("sms_send_day_key"),
  smsSendCountDay: integer("sms_send_count_day").default(0),
  smsLastSentAt: integer("sms_last_sent_at"),
  smsLastSendAt: integer("sms_last_send_at"),
  smsSendDayStart: integer("sms_send_day_start"),
  smsVerifyFailCount: integer("sms_verify_fail_count").default(0),
  smsOtpLockedUntil: integer("sms_otp_locked_until"),
  smsEnabled: boolean("sms_enabled").default(false),

  // Contender tier (progression tracking)
  contenderTier: text("contender_tier").notNull().default("NONE"), // NONE, CANDIDATE_EMAIL_ONLY, CANDIDATE_SMS_REQUIRED, VERIFIED_SMS, SELECTED_REAL_CAPITAL
  contenderEligibleAt: integer("contender_eligible_at"),

  // Lock snapshot (policy reporting only; runtime enforcement derives state)
  lockedAt: integer("locked_at"),
  lockReason: text("lock_reason"),

  // Timestamps
  createdAt: integer("created_at").notNull().default(nowUnix),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// Email verification tokens
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: text("id").primaryKey().notNull(), // UUID
  userId: integer("user_id").notNull(),
  tokenHash: text("token_hash").notNull(), // SHA-256 hash of token
  purpose: text("purpose").notNull().default("VERIFY"), // INITIAL | REVERIFY | VERIFY | RESET
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// SMS OTP tokens (hashed; no plaintext OTP stored)
export const smsOtpTokens = pgTable("sms_otp_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  phoneE164: text("phone_e164").notNull(),
  otpHash: text("otp_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
  createdAt: integer("created_at").notNull().default(nowUnix),
});

// Daily equity snapshots (deterministic last-90d return)
export const userEquityDaily = pgTable(
  "user_equity_daily",
  {
    userId: integer("user_id").notNull(),
    dayKey: text("day_key").notNull(), // YYYY-MM-DD (UTC)
    equity: real("equity").notNull(),
    createdAt: integer("created_at").notNull().default(nowUnix),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.dayKey] }),
  })
);

// MFA (TOTP) configuration
export const userMfa = pgTable("user_mfa", {
  userId: integer("user_id").primaryKey().notNull(),

  // TOTP secrets (encrypted)
  totpSecretEnc: text("totp_secret_enc"), // AES-256-GCM encrypted base32 secret
  totpPendingSecretEnc: text("totp_pending_secret_enc"), // Pending during setup

  // Recovery codes (hashed)
  recoveryCodesHashJson: text("recovery_codes_hash_json"), // JSON array of SHA-256 hashes
  recoveryCodesUsedJson: text("recovery_codes_used_json"), // JSON array of used indices

  // Status
  enabledAt: integer("enabled_at"),
  disabledAt: integer("disabled_at"),
  lastVerifiedAt: integer("last_verified_at"),
  failedAttempts: integer("failed_attempts").default(0),

  // Timestamps
  createdAt: integer("created_at").notNull().default(nowUnix),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// KYC profiles (invite-based)
export const userKycProfiles = pgTable("user_kyc_profiles", {
  userId: integer("user_id").primaryKey().notNull(),

  // Status: NOT_STARTED | INVITED | SUBMITTED | APPROVED | REJECTED
  status: text("status").notNull().default("NOT_STARTED"),

  // Invite tracking
  invitedAt: integer("invited_at"),
  invitedByAdminId: integer("invited_by_admin_id"),
  inviteNote: text("invite_note"),

  // Submission tracking
  submittedAt: integer("submitted_at"),
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
  reviewedAt: integer("reviewed_at"),
  reviewedByAdminId: integer("reviewed_by_admin_id"),
  reviewerNote: text("reviewer_note"),
  rejectionReason: text("rejection_reason"),

  // Timestamps
  createdAt: integer("created_at").notNull().default(nowUnix),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// Payout profiles (gated to Selected tier)
export const userPayoutProfiles = pgTable("user_payout_profiles", {
  userId: integer("user_id").primaryKey().notNull(),

  // Payment preferences
  preferredPaymentCurrency: text("preferred_payment_currency").default("USD"),
  payoutMethod: text("payout_method"), // BANK_TRANSFER, WISE, PAYPAL, CRYPTO

  // Payout details (encrypted JSON for flexibility)
  payoutDetailsJson: text("payout_details_json"),

  // Status
  isVerified: boolean("is_verified").default(false),
  verifiedAt: integer("verified_at"),

  // Timestamps
  createdAt: integer("created_at").notNull().default(nowUnix),
  updatedAt: integer("updated_at").notNull().default(nowUnix),
});

// Identity audit trail (hash-chained for tamper evidence)
export const identityAudit = pgTable("identity_audit", {
  id: serial("id").primaryKey(),

  // Event timing
  at: integer("at").notNull().default(nowUnix),

  // User context
  userId: integer("user_id"),
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
  actorAdminId: integer("actor_admin_id"),
  actorType: text("actor_type"),
  actorUserId: integer("actor_user_id"),
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
