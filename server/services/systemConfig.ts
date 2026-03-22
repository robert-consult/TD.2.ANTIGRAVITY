import type { Request } from "express";
import { db } from "@db";
import { DEFAULT_POLICY_CONFIG, type PolicyConfig } from "@shared/policyDecision";
import { systemConfig } from "@shared/schema";
import type { ControlledReloadStatus } from "@shared/runtimeConfig";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { invalidateJurisdictionRestrictionPolicyCache, parseRestrictedCountriesCsv } from "../legal/regionRules";
import { buildAuditContext, type AuditContext } from "../lib/auditContext";
import { invalidatePolicyConfigCache } from "../policy/getPolicyConfig";
import { appendIdentityAudit } from "./identityAudit";
import { publishLiveEvent } from "./liveBus";
import { invalidateRememberMeConfigCache } from "./rememberMe";

export const SYSTEM_CONFIG_SINGLETON_ID = 1;
export const DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY = "twelvedata";
export const DEFAULT_SYSTEM_CONFIG_FALLBACK_PROVIDER_KEYS_CSV = "";

const DEFAULT_MAINTENANCE_MESSAGE = "System is under maintenance. Trading will resume shortly.";
const DEFAULT_JURISDICTION_RESTRICTED_ISO2_CSV = "KP,IR,CU,SY";
const DEFAULT_JURISDICTION_RESTRICTED_MESSAGE = "This jurisdiction is not supported due to regulatory restrictions.";
const DEFAULT_SIGNUP_FREEZE_MESSAGE = "Signups are temporarily paused due to capacity. Existing users can still log in.";
const DEFAULT_SIGNUP_WAITLIST_INVITE_SENDER = "TradeQuip <noreply@tradequip.com>";
const DEFAULT_SIGNUP_WAITLIST_INVITE_SUBJECT = "Signup slots are open again";
const DEFAULT_SIGNUP_WAITLIST_INVITE_BODY_TEXT =
  "Hello {{name}},\n\nSignup slots are open again. Please register here: {{signup_link}}\n\nIf you did not request an invite, you can ignore this message.";
const DEFAULT_SIGNUP_WAITLIST_POLICY_VERSION = "1";
const DEFAULT_SIGNUP_WAITLIST_POLICY_CONTENT =
  "WAITLIST COMMUNICATIONS & PRIVACY NOTICE\n\nBy requesting an invite, you consent to receive an email when signup slots reopen.\n\nWhat we collect:\n- Your name and email address\n- Basic client metadata (IP address and user agent)\n\nHow we use it:\n- To notify you when signup slots open\n- We do not sell your data\n\nRetention:\n- We retain waitlist records until you are invited or you opt out\n\nOpt-out:\n- You can opt out by replying to an invite email or contacting support.";

type SystemConfigSource = Partial<typeof systemConfig.$inferSelect> | null | undefined;
type SystemConfigRow = typeof systemConfig.$inferSelect;
type SystemConfigWritePatch = Partial<typeof systemConfig.$inferInsert>;

export type SystemConfigMutationScope =
  | "LEGAL_COVERAGE"
  | "JURISDICTION_RESTRICTIONS"
  | "POLICY"
  | "SYSTEM_CONFIG";

export type SystemConfigMutationActor = {
  adminUser: string;
  adminUserId: number | null;
  auditCtx: AuditContext;
};

type SystemConfigPolicyUpdatePatch = Partial<
  Pick<
    typeof systemConfig.$inferInsert,
    | "policyContenderPath1MinAgeDays"
    | "policyContenderPath1MinTradesLifetime"
    | "policyContenderPath1MinBalancePct"
    | "policyContenderPath2MinAgeDays"
    | "policyContenderPath2MinTradesLast90"
    | "policyContenderPath2MinReturnLast90"
    | "policyContenderPath2MaxDaysSinceLastTrade"
    | "policyAutoPromotePerformer"
    | "policyEmailResendCooldownSec"
    | "policyEmailDailySendCap"
    | "policySmsDailySendCap"
    | "policySmsResendCooldownSec"
    | "policyOtpMaxAttempts"
    | "policyOtpLockMinutes"
  >
>;

type ParsedPolicyUpdateInput =
  | { ok: true; expectedUpdatedAt: number | undefined; next: SystemConfigPolicyUpdatePatch }
  | { ok: false; message: string };

type ParsedJurisdictionRestrictionsUpdateInput =
  | {
      ok: true;
      next: Partial<
        Pick<typeof systemConfig.$inferInsert, "jurisdictionRestrictedIso2Csv" | "jurisdictionRestrictedMessage">
      >;
    }
  | { ok: false; message: string };

export class SystemConfigValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "SystemConfigValidationError";
  }
}

export class SystemConfigConflictError extends Error {
  readonly status = 409;
  readonly currentUpdatedAt: number | null;

  constructor(message: string, currentUpdatedAt: number | null) {
    super(message);
    this.name = "SystemConfigConflictError";
    this.currentUpdatedAt = currentUpdatedAt;
  }
}

const POLICY_UPDATE_INPUT_SCHEMA = z.object({
  expectedUpdatedAt: coerceOptionalNumber(z.number().int().nonnegative()),
  policyContenderPath1MinAgeDays: coerceOptionalNumber(z.number().int().min(1).max(36_500)),
  policyContenderPath1MinTradesLifetime: coerceOptionalNumber(z.number().int().min(1).max(1_000_000)),
  policyContenderPath1MinBalancePct: coerceOptionalNumber(z.number().gt(0).max(1_000)),
  policyContenderPath2MinAgeDays: coerceOptionalNumber(z.number().int().min(1).max(36_500)),
  policyContenderPath2MinTradesLast90: coerceOptionalNumber(z.number().int().min(1).max(1_000_000)),
  policyContenderPath2MinReturnLast90: coerceOptionalNumber(z.number().gt(0).max(1_000)),
  policyContenderPath2MaxDaysSinceLastTrade: coerceOptionalNumber(z.number().int().min(1).max(36_500)),
  policyAutoPromotePerformer: coerceOptionalBoolean(),
  policyEmailResendCooldownSec: coerceOptionalNumber(z.number().int().min(1).max(86_400)),
  policyEmailDailySendCap: coerceOptionalNumber(z.number().int().min(1).max(10_000)),
  policySmsDailySendCap: coerceOptionalNumber(z.number().int().min(1).max(10_000)),
  policySmsResendCooldownSec: coerceOptionalNumber(z.number().int().min(1).max(86_400)),
  policyOtpMaxAttempts: coerceOptionalNumber(z.number().int().min(1).max(1_000)),
  policyOtpLockMinutes: coerceOptionalNumber(z.number().int().min(1).max(525_600)),
});

const JURISDICTION_RESTRICTIONS_INPUT_SCHEMA = z.object({
  restrictedCountriesCsv: z.preprocess(
    (value) => (value === undefined || value === null ? undefined : value),
    z.string().optional(),
  ),
  restrictedMessage: z.preprocess(
    (value) => (value === undefined || value === null ? undefined : value),
    z.string().optional(),
  ),
});

export const SYSTEM_CONFIG_BOOTSTRAP_VALUES = {
  id: SYSTEM_CONFIG_SINGLETON_ID,
  marketDataActiveProviderKey: DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY,
  marketDataFallbackProviderKeysCsv: DEFAULT_SYSTEM_CONFIG_FALLBACK_PROVIDER_KEYS_CSV,
} as const;

function coerceOptionalNumber(schema: z.ZodNumber) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      return Number(trimmed);
    }
    return Number.NaN;
  }, schema.optional());
}

function coerceOptionalBoolean() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return value;
  }, z.boolean().optional());
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function toOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid system config payload";
  const path = issue.path.length > 0 ? `${issue.path.join(".")} ` : "";
  return `${path}${issue.message}`.trim();
}

function removeUndefined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function getCurrentUpdatedAt(row: SystemConfigSource): number | null {
  return typeof (row as { updatedAt?: unknown } | null | undefined)?.updatedAt === "number"
    ? Math.trunc(Number((row as { updatedAt: number }).updatedAt))
    : null;
}

function buildUpdatedAtWhereClause(currentUpdatedAt: number | null) {
  return currentUpdatedAt === null
    ? and(eq(systemConfig.id, SYSTEM_CONFIG_SINGLETON_ID), isNull(systemConfig.updatedAt))
    : and(eq(systemConfig.id, SYSTEM_CONFIG_SINGLETON_ID), eq(systemConfig.updatedAt, currentUpdatedAt));
}

function normalizeSnapshotForDiff(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSnapshotForDiff(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "updatedAt" || key === "updatedBy") continue;
    out[key] = normalizeSnapshotForDiff(entry);
  }
  return out;
}

function hasSnapshotChanged(previous: unknown, next: unknown): boolean {
  return JSON.stringify(normalizeSnapshotForDiff(previous)) !== JSON.stringify(normalizeSnapshotForDiff(next));
}

export function buildSystemConfigMutationActor(req: Request | any): SystemConfigMutationActor {
  const auditCtx = buildAuditContext(req);
  const adminUserId = Number(req?.session?.userId ?? 0);
  return {
    adminUser: String(req?.session?.email || "admin"),
    adminUserId: Number.isFinite(adminUserId) && adminUserId > 0 ? adminUserId : null,
    auditCtx,
  };
}

export function isSystemConfigValidationError(error: unknown): error is SystemConfigValidationError {
  return error instanceof SystemConfigValidationError;
}

export function isSystemConfigConflictError(error: unknown): error is SystemConfigConflictError {
  return error instanceof SystemConfigConflictError;
}

export function parseSystemConfigPolicyUpdateInput(bodyRaw: unknown): ParsedPolicyUpdateInput {
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};

  const parsed = POLICY_UPDATE_INPUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) };
  }

  const { expectedUpdatedAt, ...rawPatch } = parsed.data;
  const next = removeUndefined(rawPatch) as SystemConfigPolicyUpdatePatch;
  if (Object.keys(next).length === 0) {
    return { ok: false, message: "No policy config updates provided." };
  }

  return {
    ok: true,
    expectedUpdatedAt,
    next,
  };
}

export function parseSystemConfigJurisdictionRestrictionsUpdateInput(
  bodyRaw: unknown,
): ParsedJurisdictionRestrictionsUpdateInput {
  const body =
    bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};

  const parsed = JURISDICTION_RESTRICTIONS_INPUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: formatZodError(parsed.error) };
  }

  const next: Partial<
    Pick<typeof systemConfig.$inferInsert, "jurisdictionRestrictedIso2Csv" | "jurisdictionRestrictedMessage">
  > = {};
  let hasAnyField = false;

  if (parsed.data.restrictedCountriesCsv !== undefined) {
    hasAnyField = true;
    const countries = parseRestrictedCountriesCsv(parsed.data.restrictedCountriesCsv);
    if (countries.length === 0) {
      return { ok: false, message: "restrictedCountriesCsv must include at least one valid ISO2 country code." };
    }
    next.jurisdictionRestrictedIso2Csv = countries.join(",");
  }

  if (parsed.data.restrictedMessage !== undefined) {
    hasAnyField = true;
    next.jurisdictionRestrictedMessage =
      parsed.data.restrictedMessage.trim() || DEFAULT_JURISDICTION_RESTRICTED_MESSAGE;
  }

  if (!hasAnyField) {
    return { ok: false, message: "No jurisdiction restriction updates provided." };
  }

  return { ok: true, next };
}

export async function getSystemConfigRow(): Promise<typeof systemConfig.$inferSelect | null> {
  return (
    (await db.query.systemConfig.findFirst({
      where: eq(systemConfig.id, SYSTEM_CONFIG_SINGLETON_ID),
    })) ?? null
  );
}

export async function ensureSystemConfigRow(): Promise<typeof systemConfig.$inferSelect> {
  await db.insert(systemConfig).values(SYSTEM_CONFIG_BOOTSTRAP_VALUES as any).onConflictDoNothing();
  const row = await getSystemConfigRow();
  if (!row) {
    throw new Error("SYSTEM_CONFIG_BOOTSTRAP_FAILED");
  }
  return row;
}

export function buildSystemConfigAdminSnapshot(source: SystemConfigSource) {
  const row = (source ?? {}) as Record<string, unknown>;
  return {
    ...(source ?? {}),
    id: SYSTEM_CONFIG_SINGLETON_ID,
    maintenanceMode: toBool(row.maintenanceMode, false),
    tradingHalt: toBool(row.tradingHalt, false),
    closeOnlyMode: toBool(row.closeOnlyMode, false),
    blockOpenOnStaleQuotes: toBool(row.blockOpenOnStaleQuotes, true),
    maintenanceMessage: toText(row.maintenanceMessage, DEFAULT_MAINTENANCE_MESSAGE),
    quoteRefreshMs: toNumber(row.quoteRefreshMs, 870),
    feedPollMs: toNumber(row.feedPollMs, 870),
    staleThresholdMs: toNumber(row.staleThresholdMs, 30000),
    marketDataActiveProviderKey: toText(
      row.marketDataActiveProviderKey,
      DEFAULT_SYSTEM_CONFIG_ACTIVE_PROVIDER_KEY,
    ),
    marketDataFallbackProviderKeysCsv: toText(
      row.marketDataFallbackProviderKeysCsv,
      DEFAULT_SYSTEM_CONFIG_FALLBACK_PROVIDER_KEYS_CSV,
    ),
    fxRolloverTz: toText(row.fxRolloverTz, "America/New_York"),
    fxRolloverTime: toText(row.fxRolloverTime, "17:00"),
    signupCaptchaEnforce: toBool(row.signupCaptchaEnforce, true),
    captchaProvider: toText(row.captchaProvider, "SLIDER"),
    signupPhoneEnforce: toBool(row.signupPhoneEnforce, true),
    legalCoverageEnforce: toBool(row.legalCoverageEnforce, false),
    jurisdictionRestrictedIso2Csv: toText(
      row.jurisdictionRestrictedIso2Csv,
      DEFAULT_JURISDICTION_RESTRICTED_ISO2_CSV,
    ),
    jurisdictionRestrictedMessage: toText(
      row.jurisdictionRestrictedMessage,
      DEFAULT_JURISDICTION_RESTRICTED_MESSAGE,
    ),
    jurisdictionEnforceByIpGeo: toBool(row.jurisdictionEnforceByIpGeo, false),
    jurisdictionEnforceBySignupCountry: toBool(row.jurisdictionEnforceBySignupCountry, true),
    jurisdictionBlockSignup: toBool(row.jurisdictionBlockSignup, true),
    jurisdictionBlockLogin: toBool(row.jurisdictionBlockLogin, true),
    signupFreeze: toBool(row.signupFreeze, false),
    signupFreezeMessage: toText(row.signupFreezeMessage, DEFAULT_SIGNUP_FREEZE_MESSAGE),
    signupWaitlistEnabled: toBool(row.signupWaitlistEnabled, true),
    signupWaitlistInviteSender: toText(row.signupWaitlistInviteSender, DEFAULT_SIGNUP_WAITLIST_INVITE_SENDER),
    signupWaitlistInviteSubject: toText(row.signupWaitlistInviteSubject, DEFAULT_SIGNUP_WAITLIST_INVITE_SUBJECT),
    signupWaitlistInviteBodyText: toText(row.signupWaitlistInviteBodyText, DEFAULT_SIGNUP_WAITLIST_INVITE_BODY_TEXT),
    signupWaitlistAutoInviteOnUnfreeze: toBool(row.signupWaitlistAutoInviteOnUnfreeze, false),
    signupWaitlistInviteBatchCap: toNumber(row.signupWaitlistInviteBatchCap, 200),
    signupWaitlistPolicyVersion: toText(row.signupWaitlistPolicyVersion, DEFAULT_SIGNUP_WAITLIST_POLICY_VERSION),
    signupWaitlistPolicyContent: toText(row.signupWaitlistPolicyContent, DEFAULT_SIGNUP_WAITLIST_POLICY_CONTENT),
    rememberMeEnabled: toBool(row.rememberMeEnabled, true),
    rememberMeMaxAgeDays: toNumber(row.rememberMeMaxAgeDays, 30),
    rememberMeMaxDevicesPerUser: toNumber(row.rememberMeMaxDevicesPerUser, 10),
    rememberMeReauthAfterAbsenceDays: toNumber(row.rememberMeReauthAfterAbsenceDays, 7),
    rememberMeTokenRotationEnabled: toBool(row.rememberMeTokenRotationEnabled, true),
    rememberMeTheftAutoRevokeAll: toBool(row.rememberMeTheftAutoRevokeAll, true),
    sessionCookieMaxAgeHours: toNumber(row.sessionCookieMaxAgeHours, 24),
    sessionIdleTimeoutMinutes: toNumber(row.sessionIdleTimeoutMinutes, 0),
    logoutClearAllDeviceTokens: toBool(row.logoutClearAllDeviceTokens, false),
    allowUserTimezoneEdit: toBool(row.allowUserTimezoneEdit, true),
    scoutTabEnabled: toBool(row.scoutTabEnabled, true),
    migrationChunkingEnabled: toBool(row.migrationChunkingEnabled, false),
    migrationChunkSizeMb: toNumber(row.migrationChunkSizeMb, 51200),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
    updatedBy: toOptionalText(row.updatedBy),
  };
}

export function buildSystemConfigPolicySnapshot(source: SystemConfigSource): PolicyConfig & {
  policyContenderPath1MinAgeDays: number;
  policyContenderPath1MinTradesLifetime: number;
  policyContenderPath1MinBalancePct: number;
  policyContenderPath2MinAgeDays: number;
  policyContenderPath2MinTradesLast90: number;
  policyContenderPath2MinReturnLast90: number;
  policyContenderPath2MaxDaysSinceLastTrade: number;
  policyAutoPromotePerformer: boolean;
  policyEmailResendCooldownSec: number;
  policyEmailDailySendCap: number;
  policySmsDailySendCap: number;
  policySmsResendCooldownSec: number;
  policyOtpMaxAttempts: number;
  policyOtpLockMinutes: number;
  updatedAt: number | null;
} {
  const row = (source ?? {}) as Record<string, unknown>;
  const policyConfig: PolicyConfig = {
    ...DEFAULT_POLICY_CONFIG,
    contenderMinAgeDays: toNumber(row.policyContenderPath1MinAgeDays, DEFAULT_POLICY_CONFIG.contenderMinAgeDays),
    contenderMinTradesLifetime: toNumber(
      row.policyContenderPath1MinTradesLifetime,
      DEFAULT_POLICY_CONFIG.contenderMinTradesLifetime,
    ),
    contenderMinBalancePct: toNumber(
      row.policyContenderPath1MinBalancePct,
      DEFAULT_POLICY_CONFIG.contenderMinBalancePct,
    ),
    contenderPath2MinAgeDays: toNumber(
      row.policyContenderPath2MinAgeDays,
      DEFAULT_POLICY_CONFIG.contenderPath2MinAgeDays,
    ),
    contenderPath2MinTradesLast90: toNumber(
      row.policyContenderPath2MinTradesLast90,
      DEFAULT_POLICY_CONFIG.contenderPath2MinTradesLast90,
    ),
    contenderPath2MinReturnLast90: toNumber(
      row.policyContenderPath2MinReturnLast90,
      DEFAULT_POLICY_CONFIG.contenderPath2MinReturnLast90,
    ),
    contenderPath2MaxDaysSinceLastTrade: toNumber(
      row.policyContenderPath2MaxDaysSinceLastTrade,
      DEFAULT_POLICY_CONFIG.contenderPath2MaxDaysSinceLastTrade,
    ),
    autoPromotePerformer: toBool(row.policyAutoPromotePerformer, DEFAULT_POLICY_CONFIG.autoPromotePerformer),
    emailResendCooldownSec: toNumber(
      row.policyEmailResendCooldownSec,
      DEFAULT_POLICY_CONFIG.emailResendCooldownSec,
    ),
    emailDailySendCap: toNumber(row.policyEmailDailySendCap, DEFAULT_POLICY_CONFIG.emailDailySendCap),
    smsDailySendCap: toNumber(row.policySmsDailySendCap, DEFAULT_POLICY_CONFIG.smsDailySendCap),
    smsResendCooldownSec: toNumber(
      row.policySmsResendCooldownSec,
      DEFAULT_POLICY_CONFIG.smsResendCooldownSec,
    ),
    otpMaxAttempts: toNumber(row.policyOtpMaxAttempts, DEFAULT_POLICY_CONFIG.otpMaxAttempts),
    otpLockMinutes: toNumber(row.policyOtpLockMinutes, DEFAULT_POLICY_CONFIG.otpLockMinutes),
  };

  return {
    ...policyConfig,
    policyContenderPath1MinAgeDays: toNumber(
      row.policyContenderPath1MinAgeDays,
      DEFAULT_POLICY_CONFIG.contenderMinAgeDays,
    ),
    policyContenderPath1MinTradesLifetime: toNumber(
      row.policyContenderPath1MinTradesLifetime,
      DEFAULT_POLICY_CONFIG.contenderMinTradesLifetime,
    ),
    policyContenderPath1MinBalancePct: toNumber(
      row.policyContenderPath1MinBalancePct,
      DEFAULT_POLICY_CONFIG.contenderMinBalancePct,
    ),
    policyContenderPath2MinAgeDays: toNumber(
      row.policyContenderPath2MinAgeDays,
      DEFAULT_POLICY_CONFIG.contenderPath2MinAgeDays,
    ),
    policyContenderPath2MinTradesLast90: toNumber(
      row.policyContenderPath2MinTradesLast90,
      DEFAULT_POLICY_CONFIG.contenderPath2MinTradesLast90,
    ),
    policyContenderPath2MinReturnLast90: toNumber(
      row.policyContenderPath2MinReturnLast90,
      DEFAULT_POLICY_CONFIG.contenderPath2MinReturnLast90,
    ),
    policyContenderPath2MaxDaysSinceLastTrade: toNumber(
      row.policyContenderPath2MaxDaysSinceLastTrade,
      DEFAULT_POLICY_CONFIG.contenderPath2MaxDaysSinceLastTrade,
    ),
    policyAutoPromotePerformer: toBool(row.policyAutoPromotePerformer, DEFAULT_POLICY_CONFIG.autoPromotePerformer),
    policyEmailResendCooldownSec: toNumber(
      row.policyEmailResendCooldownSec,
      DEFAULT_POLICY_CONFIG.emailResendCooldownSec,
    ),
    policyEmailDailySendCap: toNumber(row.policyEmailDailySendCap, DEFAULT_POLICY_CONFIG.emailDailySendCap),
    policySmsDailySendCap: toNumber(row.policySmsDailySendCap, DEFAULT_POLICY_CONFIG.smsDailySendCap),
    policySmsResendCooldownSec: toNumber(
      row.policySmsResendCooldownSec,
      DEFAULT_POLICY_CONFIG.smsResendCooldownSec,
    ),
    policyOtpMaxAttempts: toNumber(row.policyOtpMaxAttempts, DEFAULT_POLICY_CONFIG.otpMaxAttempts),
    policyOtpLockMinutes: toNumber(row.policyOtpLockMinutes, DEFAULT_POLICY_CONFIG.otpLockMinutes),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
  };
}

export function buildSystemConfigJurisdictionRestrictionsSnapshot(source: SystemConfigSource) {
  const row = (source ?? {}) as Record<string, unknown>;
  return {
    restrictedCountriesCsv: toText(
      row.jurisdictionRestrictedIso2Csv,
      DEFAULT_JURISDICTION_RESTRICTED_ISO2_CSV,
    ),
    restrictedMessage: toText(
      row.jurisdictionRestrictedMessage,
      DEFAULT_JURISDICTION_RESTRICTED_MESSAGE,
    ),
  };
}

export function buildSystemConfigLegalCoverageSnapshot(source: SystemConfigSource) {
  const row = (source ?? {}) as Record<string, unknown>;
  return {
    legalCoverageEnforce: toBool(row.legalCoverageEnforce, false),
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
  };
}

export function buildSystemConfigAllSnapshot(source: SystemConfigSource) {
  const admin = buildSystemConfigAdminSnapshot(source);
  const policy = buildSystemConfigPolicySnapshot(source);
  return {
    maintenanceMode: admin.maintenanceMode,
    tradingHalt: admin.tradingHalt,
    closeOnlyMode: admin.closeOnlyMode,
    blockOpenOnStaleQuotes: admin.blockOpenOnStaleQuotes,
    maintenanceMessage: admin.maintenanceMessage,
    quoteRefreshMs: admin.quoteRefreshMs,
    feedPollMs: admin.feedPollMs,
    staleThresholdMs: admin.staleThresholdMs,
    legalCoverageEnforce: admin.legalCoverageEnforce,
    policyContenderPath1MinAgeDays: policy.policyContenderPath1MinAgeDays,
    policyContenderPath1MinTradesLifetime: policy.policyContenderPath1MinTradesLifetime,
    policyContenderPath1MinBalancePct: policy.policyContenderPath1MinBalancePct,
    policyContenderPath2MinAgeDays: policy.policyContenderPath2MinAgeDays,
    policyContenderPath2MinTradesLast90: policy.policyContenderPath2MinTradesLast90,
    policyContenderPath2MinReturnLast90: policy.policyContenderPath2MinReturnLast90,
    policyContenderPath2MaxDaysSinceLastTrade: policy.policyContenderPath2MaxDaysSinceLastTrade,
    policyAutoPromotePerformer: policy.policyAutoPromotePerformer,
    policyEmailResendCooldownSec: policy.policyEmailResendCooldownSec,
    policyEmailDailySendCap: policy.policyEmailDailySendCap,
    policySmsDailySendCap: policy.policySmsDailySendCap,
    policySmsResendCooldownSec: policy.policySmsResendCooldownSec,
    policyOtpMaxAttempts: policy.policyOtpMaxAttempts,
    policyOtpLockMinutes: policy.policyOtpLockMinutes,
    updatedAt: admin.updatedAt,
  };
}

type UpdateSystemConfigWithAuditArgs<TSnapshot> = {
  actor: SystemConfigMutationActor;
  patch: SystemConfigWritePatch;
  snapshotBuilder: (row: SystemConfigRow) => TSnapshot;
  auditType: string;
  auditTitle: string;
  auditDescription: string;
  expectedUpdatedAt?: number;
  requireExpectedUpdatedAt?: boolean;
};

type UpdateSystemConfigWithAuditResult<TSnapshot> = {
  previous: SystemConfigRow;
  updated: SystemConfigRow;
  updatedAt: number;
  snapshot: TSnapshot;
};

export async function updateSystemConfigWithAudit<TSnapshot>(
  args: UpdateSystemConfigWithAuditArgs<TSnapshot>,
): Promise<UpdateSystemConfigWithAuditResult<TSnapshot>> {
  const existing = await ensureSystemConfigRow();
  const currentUpdatedAt = getCurrentUpdatedAt(existing);

  if (args.requireExpectedUpdatedAt && args.expectedUpdatedAt === undefined) {
    throw new SystemConfigConflictError("System config is stale. Refresh before saving.", currentUpdatedAt);
  }

  if (args.expectedUpdatedAt !== undefined && currentUpdatedAt !== args.expectedUpdatedAt) {
    throw new SystemConfigConflictError(
      "System config changed by another admin. Refresh and retry.",
      currentUpdatedAt,
    );
  }

  const updatedAt = Math.floor(Date.now() / 1000);
  const write = removeUndefined({
    ...args.patch,
    updatedAt,
    updatedBy: args.actor.adminUser,
  }) as SystemConfigWritePatch;

  const whereClause =
    args.expectedUpdatedAt !== undefined || args.requireExpectedUpdatedAt
      ? buildUpdatedAtWhereClause(currentUpdatedAt)
      : eq(systemConfig.id, SYSTEM_CONFIG_SINGLETON_ID);

  const updatedRows = await db
    .update(systemConfig)
    .set(write)
    .where(whereClause)
    .returning();

  if (!updatedRows[0]) {
    const latest = await ensureSystemConfigRow();
    throw new SystemConfigConflictError(
      "System config changed by another admin. Refresh and retry.",
      getCurrentUpdatedAt(latest),
    );
  }

  const previousSnapshot = args.snapshotBuilder(existing);
  const snapshot = args.snapshotBuilder(updatedRows[0]);

  if (hasSnapshotChanged(previousSnapshot, snapshot)) {
    appendIdentityAudit({
      userId: args.actor.adminUserId,
      category: "admin",
      type: args.auditType,
      title: args.auditTitle,
      description: args.auditDescription,
      ip: args.actor.auditCtx.ip,
      userAgent: args.actor.auditCtx.userAgent,
      actorAdminId: args.actor.adminUserId,
      actorType: "ADMIN",
      actorUserId: args.actor.adminUserId,
      sessionId: args.actor.auditCtx.sessionId,
      correlationId: args.actor.auditCtx.correlationId,
      data: {
        previous: previousSnapshot,
        next: snapshot,
      },
    });
  }

  return {
    previous: existing,
    updated: updatedRows[0],
    updatedAt,
    snapshot,
  };
}

export function emitSystemConfigMutationEffects(args: {
  updatedAt: number;
  scope?: SystemConfigMutationScope;
  invalidatePolicy?: boolean;
  invalidateJurisdiction?: boolean;
  invalidateRememberMe?: boolean;
  publishJurisdictionPolicyInvalidate?: boolean;
  feedReloadStatus?: ControlledReloadStatus | null;
  changedKeys?: string[];
  adminUser?: string | null;
}): void {
  if (args.invalidatePolicy) {
    try {
      invalidatePolicyConfigCache();
    } catch {}
  }

  if (args.invalidateJurisdiction) {
    try {
      invalidateJurisdictionRestrictionPolicyCache();
    } catch {}
  }

  if (args.invalidateRememberMe) {
    try {
      invalidateRememberMeConfigCache();
    } catch {}
  }

  try {
    publishLiveEvent({
      type: "system-config:updated",
      payload: {
        updatedAt: args.updatedAt,
        ...(args.scope ? { scope: args.scope } : {}),
      },
    });

    if (args.publishJurisdictionPolicyInvalidate) {
      publishLiveEvent({
        type: "jurisdiction-policy:invalidate",
        payload: { updatedAt: args.updatedAt },
      });
    }

    if (args.feedReloadStatus) {
      publishLiveEvent({
        type: "feed:config-updated",
        payload: {
          domain: "quotes.transport.feed",
          version: args.feedReloadStatus.requestedVersion,
          updatedAt: args.updatedAt,
          updatedBy: args.adminUser ?? null,
          changedKeys: args.changedKeys ?? [],
          requiredScope: args.feedReloadStatus.requiredScope,
        },
      });
    }
  } catch {}
}

export async function updateSystemConfigPolicy(args: {
  actor: SystemConfigMutationActor;
  bodyRaw: unknown;
}) {
  const parsed = parseSystemConfigPolicyUpdateInput(args.bodyRaw);
  if (!parsed.ok) {
    throw new SystemConfigValidationError(parsed.message);
  }

  const result = await updateSystemConfigWithAudit({
    actor: args.actor,
    patch: parsed.next,
    snapshotBuilder: buildSystemConfigPolicySnapshot,
    auditType: "SYSTEM_CONFIG_POLICY_UPDATED",
    auditTitle: "System policy config updated",
    auditDescription: "Updated contender thresholds, promotion controls, and verification rate limits.",
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    requireExpectedUpdatedAt: true,
  });

  emitSystemConfigMutationEffects({
    updatedAt: result.updatedAt,
    scope: "POLICY",
    invalidatePolicy: true,
  });

  return result;
}

export async function updateSystemConfigJurisdictionRestrictions(args: {
  actor: SystemConfigMutationActor;
  bodyRaw: unknown;
}) {
  const parsed = parseSystemConfigJurisdictionRestrictionsUpdateInput(args.bodyRaw);
  if (!parsed.ok) {
    throw new SystemConfigValidationError(parsed.message);
  }

  const result = await updateSystemConfigWithAudit({
    actor: args.actor,
    patch: parsed.next,
    snapshotBuilder: buildSystemConfigJurisdictionRestrictionsSnapshot,
    auditType: "SYSTEM_CONFIG_JURISDICTION_RESTRICTIONS_UPDATED",
    auditTitle: "Jurisdiction restrictions updated",
    auditDescription: "Updated restricted-country login and signup enforcement rules.",
  });

  emitSystemConfigMutationEffects({
    updatedAt: result.updatedAt,
    scope: "JURISDICTION_RESTRICTIONS",
    invalidateJurisdiction: true,
    publishJurisdictionPolicyInvalidate: true,
  });

  return result;
}

export async function updateSystemConfigLegalCoverage(args: {
  actor: SystemConfigMutationActor;
  enforce: unknown;
}) {
  const result = await updateSystemConfigWithAudit({
    actor: args.actor,
    patch: {
      legalCoverageEnforce: Boolean(args.enforce),
    },
    snapshotBuilder: buildSystemConfigLegalCoverageSnapshot,
    auditType: "SYSTEM_CONFIG_LEGAL_COVERAGE_UPDATED",
    auditTitle: "Legal coverage enforcement updated",
    auditDescription: "Updated legal coverage enforcement for signup and acceptance flows.",
  });

  emitSystemConfigMutationEffects({
    updatedAt: result.updatedAt,
    scope: "LEGAL_COVERAGE",
  });

  return result;
}
