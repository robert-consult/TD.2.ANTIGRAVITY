import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";
import { db, dbClient } from "@db";
import { nowSec } from "@shared/scalars";
import {
  partners,
  partnerAllocations,
  partnerInquiries,
  partnerInvites,
  scoutMetricsSnapshot,
  systemConfig,
} from "@shared/schema";
import { requirePartner } from "../middleware/requirePartner";
import { requirePartnerGate } from "../middleware/requirePartnerGate";
import { anonymizeUserId, resolveUserIdFromHash } from "../partner/anonymizeUser";
import {
  normalizeAllocationStatus,
  normalizeCapitalUsd,
  normalizePaging,
  normalizeShadowStopPct,
} from "../partner/allocationEngine";
import { getPartnerEligibilityUserIds } from "../recruitment/pipelineService";
import { listPartnerDataRoomCandidates } from "../scout/scoutService";
import { forwardPartnerInquiryToAdmins } from "../partner/inquiryBridge";
import { getCommunicationSettings } from "../services/messaging";
import { resolvePartnerInquiryRouting } from "../partner/inquiryRouting";
import { appendIdentityAudit, appendIdentityAuditAwaitable } from "../services/identityAudit";
import { buildAuditContext } from "../lib/auditContext";
import {
  PARTNER_GATE_KEYS,
  resolvePartnerOnboardingState,
} from "../partner/onboarding";
import { randomToken, sha256Hex } from "../services/crypto";
import {
  CURRENCY_CODE_REGEX,
  E164_PHONE_REGEX,
  GENERIC_IDENTIFIER_REGEX,
  ISO2_COUNTRY_REGEX,
  LEI_CODE_REGEX,
  PARTNER_ADDRESS_KIND_OPTIONS,
  PARTNER_CONTACT_CHANNEL_OPTIONS,
  normalizePartnerInstitutionProfile,
} from "@shared/partnerProfile";
import { MAX_E2EE_ENVELOPE_BYTES, normalizeHexSha256 } from "@shared/e2ee/envelope";

const partnerAuthRouter = Router();

function buildPartnerApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `tp_${randomToken(24)}`;
  const hash = sha256Hex(raw);
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

type RateLimitEntry = { count: number; resetAtMs: number };

const INVITE_REDEEM_WINDOW_MS = 15 * 60 * 1000;
const INVITE_REDEEM_IP_LIMIT = 5;
const INVITE_REDEEM_TOKEN_LIMIT = 8;
const inviteRedeemRateByIp = new Map<string, RateLimitEntry>();
const inviteRedeemRateByTokenHash = new Map<string, RateLimitEntry>();

const TEAR_SHEET_CACHE_TTL_MS = 10_000;
const TEAR_SHEET_CACHE_MAX_ENTRIES = 256;
const tearSheetResponseCache = new Map<string, { expiresAtMs: number; payload: any }>();
const tearSheetInflight = new Map<string, Promise<any>>();

function cleanupRateLimitMap<K>(store: Map<K, RateLimitEntry>) {
  const now = Date.now();
  for (const [key, value] of Array.from(store.entries())) {
    if (value.resetAtMs <= now) store.delete(key);
  }
}

function consumeRateLimit<K>(
  store: Map<K, RateLimitEntry>,
  key: K,
  limit: number,
  windowMs = INVITE_REDEEM_WINDOW_MS,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function trimTearSheetCache() {
  while (tearSheetResponseCache.size > TEAR_SHEET_CACHE_MAX_ENTRIES) {
    const oldestKey = tearSheetResponseCache.keys().next().value;
    if (!oldestKey) return;
    tearSheetResponseCache.delete(oldestKey);
  }
}

function getCachedTearSheetPayload(cacheKey: string): any | null {
  const entry = tearSheetResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    tearSheetResponseCache.delete(cacheKey);
    return null;
  }
  tearSheetResponseCache.delete(cacheKey);
  tearSheetResponseCache.set(cacheKey, entry);
  return entry.payload;
}

function setCachedTearSheetPayload(cacheKey: string, payload: any): void {
  tearSheetResponseCache.set(cacheKey, {
    expiresAtMs: Date.now() + TEAR_SHEET_CACHE_TTL_MS,
    payload,
  });
  trimTearSheetCache();
}

const partnerPortalLimiterCleanupHandle = setInterval(() => {
  cleanupRateLimitMap(inviteRedeemRateByIp);
  cleanupRateLimitMap(inviteRedeemRateByTokenHash);
}, 5 * 60 * 1000);
(partnerPortalLimiterCleanupHandle as any)?.unref?.();

partnerAuthRouter.post("/invite/redeem", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production" && !isSecurePartnerTransport(req) && !isLoopbackHost(req)) {
      return res.status(426).json({ message: "PARTNER_HTTPS_REQUIRED" });
    }

    const ipKey = String(req.ip || "unknown");
    const ipRate = consumeRateLimit(inviteRedeemRateByIp, ipKey, INVITE_REDEEM_IP_LIMIT);
    if (!ipRate.allowed) {
      res.setHeader("Retry-After", String(ipRate.retryAfterSec));
      return res.status(429).json({ message: "INVITE_REDEEM_RATE_LIMITED", retryAfterSec: ipRate.retryAfterSec });
    }

    const token = String(req.body.token || "").trim();
    if (!token) {
      return res.status(400).json({ message: "TOKEN_REQUIRED" });
    }

    const hash = sha256Hex(token);
    const tokenRate = consumeRateLimit(inviteRedeemRateByTokenHash, hash, INVITE_REDEEM_TOKEN_LIMIT);
    if (!tokenRate.allowed) {
      res.setHeader("Retry-After", String(tokenRate.retryAfterSec));
      return res.status(429).json({ message: "INVITE_REDEEM_RATE_LIMITED", retryAfterSec: tokenRate.retryAfterSec });
    }

    const ts = nowSec();

    const [invite] = await db
      .select({
        id: partnerInvites.id,
        partnerId: partnerInvites.partnerId,
        partnerEmail: partnerInvites.partnerEmail,
        expiresInDays: partnerInvites.expiresInDays,
        invitedAt: partnerInvites.invitedAt,
      })
      .from(partnerInvites)
      .where(eq(partnerInvites.inviteTokenHash, hash))
      .limit(1);

    if (!invite) {
      // Return generic error to avoid enumeration
      return res.status(404).json({ message: "INVITE_INVALID" });
    }

    if (ts > invite.invitedAt + invite.expiresInDays * 86400) {
      return res.status(410).json({ message: "INVITE_EXPIRED" });
    }

    const [partner] = await db
      .select()
      .from(partners)
      .where(eq(partners.id, invite.partnerId))
      .limit(1);

    if (!partner) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    if (partner.inviteStatus === "REVOKED") {
      return res.status(403).json({ message: "INVITE_REVOKED" });
    }

    // Generate new API key
    const apiKey = buildPartnerApiKey();

    // Update partner with new key and set active
    await db
      .update(partners)
      .set({
        apiKeyHash: apiKey.hash,
        apiKeyPrefix: apiKey.prefix,
        inviteStatus: "ACTIVE",
        lastKeyRotatedAt: ts,
        updatedAt: ts,
      })
      .where(eq(partners.id, partner.id));

    // Invalidate the invite token to prevent reuse
    await db
      .update(partnerInvites)
      .set({
        inviteTokenHash: null,
        emailStatus: "OPENED", // Mark as opened/used
        emailStatusDetail: "Redeemed via portal",
      })
      .where(eq(partnerInvites.id, invite.id));


    await appendIdentityAudit({
      userId: null,
      email: invite.partnerEmail,
      category: "PARTNER",
      type: "INVITE_REDEEMED",
      data: { partnerId: partner.id, inviteId: invite.id },
      ip: String(req.ip),
      userAgent: String(req.headers["user-agent"]),
    });

    return res.json({
      ok: true,
      partnerName: partner.name,
      apiKey: apiKey.raw,
      warning: "Store this key securely. It will not be shown again."
    });
  } catch (error) {
    console.error("[partner-auth] redeem error:", error);
    return res.status(500).json({ message: "FAILED_TO_REDEEM_INVITE" });
  }
});

const partnerPortalRouter = Router();
partnerPortalRouter.use(requirePartner);

function netProfitSqlAlias(alias: string): string {
  return `COALESCE(
    ${alias}.net_profit_usd::numeric,
    CASE
      WHEN ${alias}.profit IS NULL OR btrim(${alias}.profit) = '' THEN 0::numeric
      WHEN ${alias}.profit ~ '^-?\\d+(\\.\\d+)?$' THEN ${alias}.profit::numeric
      ELSE 0::numeric
    END
  )`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_EXTENSION_PATTERN = /^\d{1,12}$/;
const TZ_PATTERN = /^[A-Za-z0-9_+\-./]{3,80}$/;

const iso2RequiredSchema = z.preprocess(
  (value) => String(value ?? "").trim().toUpperCase(),
  z.string().regex(ISO2_COUNTRY_REGEX, "COUNTRY_ISO2_INVALID"),
);

const iso2OptionalSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized.length ? normalized : null;
}, z.string().regex(ISO2_COUNTRY_REGEX, "COUNTRY_ISO2_INVALID").nullable());

const optionalText = (max: number) =>
  z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().max(max).nullable());

const optionalIdentifier = (max = 80) =>
  z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().max(max).regex(GENERIC_IDENTIFIER_REGEX, "IDENTIFIER_INVALID").nullable());

const partnerPhoneSchema = z
  .object({
  label: optionalText(80).optional().default(null),
  countryIso2: iso2RequiredSchema,
  numberE164: z.string().trim().regex(E164_PHONE_REGEX, "PHONE_E164_INVALID"),
  extension: z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().regex(PHONE_EXTENSION_PATTERN, "PHONE_EXTENSION_INVALID").nullable()).optional().default(null),
  })
  .strict();

const partnerAddressSchema = z
  .object({
  kind: z.enum(PARTNER_ADDRESS_KIND_OPTIONS).default("HEAD_OFFICE"),
  line1: z.string().trim().min(1).max(160),
  line2: optionalText(160).optional().default(null),
  city: z.string().trim().min(1).max(120),
  stateRegion: optionalText(120).optional().default(null),
  postalCode: z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().max(20).nullable()).optional().default(null),
  countryIso2: iso2RequiredSchema,
  })
  .strict();

const partnerPointOfContactSchema = z
  .object({
  fullName: z.string().trim().min(1).max(120),
  title: optionalText(120).optional().default(null),
  department: optionalText(120).optional().default(null),
  email: z.preprocess((value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized.length ? normalized : null;
  }, z.string().email("EMAIL_INVALID").max(254).nullable()).optional().default(null),
  phone: partnerPhoneSchema.nullable().optional().default(null),
  fax: partnerPhoneSchema.nullable().optional().default(null),
  location: optionalText(120).optional().default(null),
  preferredChannel: z.enum(PARTNER_CONTACT_CHANNEL_OPTIONS).nullable().optional().default(null),
  isPrimary: z.boolean().optional().default(false),
  })
  .strict();

const partnerInstitutionProfileSchema = z
  .object({
  legalEntityName: optionalText(160).optional().default(null),
  tradingName: optionalText(160).optional().default(null),
  entityType: optionalText(80).optional().default(null),
  domicileCountryIso2: iso2OptionalSchema.optional().default(null),
  incorporationCountryIso2: iso2OptionalSchema.optional().default(null),
  registrationCountriesIso2: z.array(iso2RequiredSchema).max(20).default([]),
  websiteUrl: z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().url("WEBSITE_URL_INVALID").max(500).nullable()).optional().default(null),
  socialProfiles: z.array(z.string().trim().url("SOCIAL_URL_INVALID").max(500)).max(20).default([]),
  businessDescription: optionalText(1000).optional().default(null),
  baseCurrency: z.preprocess((value) => {
    const normalized = String(value ?? "").trim().toUpperCase();
    return normalized.length ? normalized : null;
  }, z.string().regex(CURRENCY_CODE_REGEX, "CURRENCY_INVALID").nullable()).optional().default(null),
  primaryTimezone: z.preprocess((value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length ? normalized : null;
  }, z.string().regex(TZ_PATTERN, "TIMEZONE_INVALID").max(80).nullable()).optional().default(null),
  generalEmails: z.array(
    z
      .preprocess((value) => String(value ?? "").trim().toLowerCase(), z.string().email("EMAIL_INVALID"))
      .pipe(z.string().max(254)),
  ).max(30).default([]),
  phoneNumbers: z.array(partnerPhoneSchema).max(20).default([]),
  faxNumbers: z.array(partnerPhoneSchema).max(10).default([]),
  addresses: z.array(partnerAddressSchema).max(15).default([]),
  pointsOfContact: z.array(partnerPointOfContactSchema).max(25).default([]),
  serviceProviders: z
    .object({
      primeBroker: optionalText(120).optional().default(null),
      fundAdministrator: optionalText(120).optional().default(null),
      auditor: optionalText(120).optional().default(null),
      custodian: optionalText(120).optional().default(null),
      legalCounsel: optionalText(120).optional().default(null),
      bankingPartner: optionalText(120).optional().default(null),
    })
    .strict()
    .default({
      primeBroker: null,
      fundAdministrator: null,
      auditor: null,
      custodian: null,
      legalCounsel: null,
      bankingPartner: null,
    }),
  regulatory: z
    .object({
      regulatorNames: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
      secFileNumber: optionalIdentifier(64).optional().default(null),
      secExemptFileNumber: optionalIdentifier(64).optional().default(null),
      crdNumber: optionalIdentifier(64).optional().default(null),
      cikNumbers: z.array(z.string().trim().regex(/^\d{1,12}$/)).max(10).default([]),
      nfaId: optionalIdentifier(64).optional().default(null),
      registrationNumber: optionalIdentifier(64).optional().default(null),
      taxId: optionalIdentifier(64).optional().default(null),
      lei: z.preprocess((value) => {
        const normalized = String(value ?? "").trim().toUpperCase();
        return normalized.length ? normalized : null;
      }, z.string().regex(LEI_CODE_REGEX, "LEI_INVALID").nullable()).optional().default(null),
    })
    .strict()
    .default({
      regulatorNames: [],
      secFileNumber: null,
      secExemptFileNumber: null,
      crdNumber: null,
      cikNumbers: [],
      nfaId: null,
      registrationNumber: null,
      taxId: null,
      lei: null,
    }),
  operations: z
    .object({
      inceptionYear: z.number().int().min(1900).max(2100).nullable().optional().default(null),
      employeeCountRange: optionalText(40).optional().default(null),
      businessDays: optionalText(64).optional().default(null),
      businessHours: optionalText(64).optional().default(null),
    })
    .strict()
    .default({
      inceptionYear: null,
      employeeCountRange: null,
      businessDays: null,
      businessHours: null,
    }),
  })
  .strict();

const partnerProfileSchema = z
  .object({
  fundName: z.string().trim().min(2).max(120),
  fundLogoUrl: z.string().trim().max(1000).optional().nullable(),
  aumRange: z.string().trim().min(1).max(80),
  hqLocation: z.string().trim().max(120).optional().nullable(),
  strategyTags: z.array(z.string().trim().min(1).max(60)).max(25).default([]),
  institutionProfile: partnerInstitutionProfileSchema.optional(),
  })
  .strict();

const partnerLegalSchema = z
  .object({
  kybDocUrl: z.string().trim().min(1).max(1000),
  agreedToAllocation: z.boolean(),
  agreedToNda: z.boolean(),
  })
  .strict();

const partnerSimulationPreviewSchema = z
  .object({
  userHashId: z.string().trim().min(6).max(64),
  notionalUsd: z.number().positive().max(1_000_000_000),
  horizonDays: z.number().int().min(7).max(365).optional(),
  })
  .strict();

function safeJsonParseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function normalizePhoneEntryForStorage(entry: any, path: string) {
  const countryIso2 = String(entry?.countryIso2 || "").trim().toUpperCase();
  const phoneRaw = String(entry?.numberE164 || "").trim();
  const parsed = parsePhoneNumberFromString(phoneRaw, countryIso2 as any);
  if (!parsed || !parsed.isValid()) {
    throw new Error(`${path}.numberE164:PHONE_INVALID`);
  }
  const parsedCountry = String(parsed.country || "").trim().toUpperCase();
  if (parsedCountry && parsedCountry !== countryIso2) {
    throw new Error(`${path}.countryIso2:PHONE_COUNTRY_MISMATCH`);
  }
  return {
    label: entry?.label ?? null,
    countryIso2,
    numberE164: parsed.format("E.164"),
    extension: entry?.extension ?? null,
  };
}

function normalizeInstitutionProfileForStorage(raw: unknown) {
  const normalized = normalizePartnerInstitutionProfile(raw);
  const phoneNumbers = (normalized.phoneNumbers || []).map((row, idx) =>
    normalizePhoneEntryForStorage(row, `institutionProfile.phoneNumbers[${idx}]`),
  );
  const faxNumbers = (normalized.faxNumbers || []).map((row, idx) =>
    normalizePhoneEntryForStorage(row, `institutionProfile.faxNumbers[${idx}]`),
  );
  const pointsOfContact = (normalized.pointsOfContact || []).map((row, idx) => ({
    ...row,
    phone: row.phone
      ? normalizePhoneEntryForStorage(row.phone, `institutionProfile.pointsOfContact[${idx}].phone`)
      : null,
    fax: row.fax
      ? normalizePhoneEntryForStorage(row.fax, `institutionProfile.pointsOfContact[${idx}].fax`)
      : null,
  }));

  return {
    ...normalized,
    phoneNumbers,
    faxNumbers,
    pointsOfContact,
  };
}

function isValidEmailAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function isSecurePartnerTransport(req: any): boolean {
  if (req?.secure === true) return true;
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").toLowerCase();
  return proto === "https";
}

function isLoopbackHost(req: any): boolean {
  const host = String(req?.hostname || req?.headers?.host || "")
    .trim()
    .toLowerCase();
  if (!host) return false;
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("::1") ||
    host.startsWith("[::1]")
  );
}

async function appendPartnerReadAudit(req: any, type: string, data: Record<string, unknown>) {
  try {
    const auditCtx = buildAuditContext(req);
    const partner = (req as any).partner as { id: number; name: string };
    appendIdentityAudit({
      userId: null,
      category: "RECRUITMENT",
      type,
      actorType: "SYSTEM",
      actorUserId: null,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent,
      data: {
        partnerId: partner?.id,
        partnerName: partner?.name,
        ...data,
      },
    });
  } catch (error) {
    console.error("[partner-portal] audit append failed:", error);
  }
}

async function resolveEligibleUserIdFromHash(hashId: string): Promise<number | null> {
  const eligible = await getPartnerEligibilityUserIds();
  if (!eligible.length) return null;
  return resolveUserIdFromHash(hashId, eligible);
}

function toOnboardingResponse(state: Awaited<ReturnType<typeof resolvePartnerOnboardingState>>) {
  if (!state) return null;
  const gates = PARTNER_GATE_KEYS.reduce((acc, key) => {
    acc[key] = state.gateEval[key].allowed;
    return acc;
  }, {} as Record<(typeof PARTNER_GATE_KEYS)[number], boolean>);
  return {
    ok: true,
    state: {
      partnerId: state.partnerId,
      partnerName: state.partnerName,
      contactEmail: state.contactEmail,
      contactUsername: state.contactUsername,
      inviteStatus: state.inviteStatus,
      onboardingStep: state.onboardingStep,
      inviteExpiresAt: state.inviteExpiresAt,
      isInviteExpired: state.isInviteExpired,
      profileData: state.profileData,
      fundLogoUrl: state.fundLogoUrl,
      kybDocUrl: state.kybDocUrl,
      agreementsSignedAt: state.agreementsSignedAt,
      contactAccessRequestedAt: state.contactAccessRequestedAt,
      approvedAt: state.approvedAt,
      adminNotes: state.adminNotes,
      loginCount: state.loginCount,
      passwordRotatedAt: state.passwordRotatedAt,
      progressPct: state.progressPct,
      passwordPolicy: state.passwordPolicy,
      gates,
      gateConfig: state.gateConfig,
      gateEval: state.gateEval,
    },
  };
}

partnerPortalRouter.get("/onboarding/state", async (req, res) => {
  try {
    const partner = (req as any).partner as { id: number };
    const state = await resolvePartnerOnboardingState(Number(partner.id));
    if (!state) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    return res.json(toOnboardingResponse(state));
  } catch (error) {
    console.error("[partner-portal] onboarding state error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ONBOARDING_STATE" });
  }
});



partnerPortalRouter.post("/onboarding/profile", async (req, res) => {
  try {
    const partner = (req as any).partner as { id: number };
    const parsed = partnerProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const state = await resolvePartnerOnboardingState(Number(partner.id));
    if (!state) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    if (state.inviteStatus === "REVOKED") return res.status(403).json({ message: "PARTNER_REVOKED" });
    if (state.isInviteExpired) return res.status(403).json({ message: "PARTNER_INVITE_EXPIRED" });

    const ts = nowSec();
    const existingProfile = safeJsonParseObject(state.profileData);
    const existingInstitutionProfile = normalizePartnerInstitutionProfile(
      existingProfile.institutionProfile ?? existingProfile,
    );
    let institutionProfile = existingInstitutionProfile;

    if (parsed.data.institutionProfile) {
      try {
        institutionProfile = normalizeInstitutionProfileForStorage(parsed.data.institutionProfile);
      } catch (error: any) {
        return res.status(400).json({
          message: "INVALID_INSTITUTION_PROFILE",
          detail: String(error?.message || "INVALID_PROFILE_FIELD"),
        });
      }
    }

    const nextProfile = {
      ...existingProfile,
      fundName: parsed.data.fundName,
      aumRange: parsed.data.aumRange,
      hqLocation: parsed.data.hqLocation ?? null,
      strategyTags: parsed.data.strategyTags ?? [],
      institutionProfile,
    };

    await db
      .update(partners)
      .set({
        profileData: JSON.stringify(nextProfile),
        fundLogoUrl: parsed.data.fundLogoUrl ?? null,
        aumRange: parsed.data.aumRange,
        hqLocation: parsed.data.hqLocation ?? null,
        strategyTags: JSON.stringify(parsed.data.strategyTags ?? []),
        inviteStatus: state.inviteStatus === "INVITED" ? "ACTIVE" : state.inviteStatus,
        onboardingStep: "IDENTITY",
        updatedAt: ts,
      })
      .where(eq(partners.id, Number(partner.id)));

    await appendPartnerReadAudit(req, "PARTNER_ONBOARDING_PROFILE_SUBMIT", {
      partnerId: Number(partner.id),
      hasFundLogo: Boolean(parsed.data.fundLogoUrl),
      strategyTagCount: parsed.data.strategyTags.length,
      generalEmailCount: institutionProfile.generalEmails.length,
      phoneCount: institutionProfile.phoneNumbers.length,
      faxCount: institutionProfile.faxNumbers.length,
      addressCount: institutionProfile.addresses.length,
      pointOfContactCount: institutionProfile.pointsOfContact.length,
    });

    const nextState = await resolvePartnerOnboardingState(Number(partner.id));
    if (!nextState) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    return res.json(toOnboardingResponse(nextState));
  } catch (error) {
    console.error("[partner-portal] onboarding profile update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_ONBOARDING_PROFILE" });
  }
});

partnerPortalRouter.post("/onboarding/legal", async (req, res) => {
  try {
    const partner = (req as any).partner as { id: number };
    const parsed = partnerLegalSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (!parsed.data.agreedToAllocation || !parsed.data.agreedToNda) {
      return res.status(400).json({ message: "LEGAL_AGREEMENTS_REQUIRED" });
    }

    const state = await resolvePartnerOnboardingState(Number(partner.id));
    if (!state) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    if (state.inviteStatus === "REVOKED") return res.status(403).json({ message: "PARTNER_REVOKED" });
    if (state.isInviteExpired) return res.status(403).json({ message: "PARTNER_INVITE_EXPIRED" });

    const allowedSteps = new Set(["IDENTITY", "LEGAL", "WAITING_APPROVAL", "COMPLETED"]);
    if (!allowedSteps.has(state.onboardingStep)) {
      return res.status(409).json({
        message: "ONBOARDING_STEP_INVALID_FOR_LEGAL",
        onboardingStep: state.onboardingStep,
      });
    }

    const ts = nowSec();
    const auditCtx = buildAuditContext(req);
    await db.transaction(async (tx) => {
      await tx
        .update(partners)
        .set({
          kybDocUrl: parsed.data.kybDocUrl,
          agreementsSignedAt: ts,
          contactAccessRequestedAt: ts,
          inviteStatus: state.inviteStatus === "INVITED" ? "ACTIVE" : state.inviteStatus,
          onboardingStep: state.onboardingStep === "COMPLETED" ? "COMPLETED" : "WAITING_APPROVAL",
          updatedAt: ts,
        })
        .where(eq(partners.id, Number(partner.id)));

      await appendIdentityAuditAwaitable(
        {
          userId: null,
          category: "RECRUITMENT",
          type: "PARTNER_ONBOARDING_LEGAL_SUBMIT",
          actorType: "SYSTEM",
          actorUserId: null,
          sessionId: auditCtx.sessionId,
          correlationId: auditCtx.correlationId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
          data: {
            partnerId: Number(partner.id),
            partnerName: state.partnerName,
            kybDocUrl: parsed.data.kybDocUrl,
          },
        },
        tx,
      );
    });

    const nextState = await resolvePartnerOnboardingState(Number(partner.id));
    if (!nextState) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    return res.json(toOnboardingResponse(nextState));
  } catch (error) {
    console.error("[partner-portal] onboarding legal update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_ONBOARDING_LEGAL" });
  }
});

partnerPortalRouter.post("/onboarding/request-contact", async (req, res) => {
  try {
    const partner = (req as any).partner as { id: number };
    const state = await resolvePartnerOnboardingState(Number(partner.id));
    if (!state) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    if (state.inviteStatus === "REVOKED") return res.status(403).json({ message: "PARTNER_REVOKED" });
    if (state.isInviteExpired) return res.status(403).json({ message: "PARTNER_INVITE_EXPIRED" });

    const ts = nowSec();
    await db
      .update(partners)
      .set({
        contactAccessRequestedAt: ts,
        onboardingStep: state.onboardingStep === "COMPLETED" ? "COMPLETED" : "WAITING_APPROVAL",
        updatedAt: ts,
      })
      .where(eq(partners.id, Number(partner.id)));

    await appendPartnerReadAudit(req, "PARTNER_ONBOARDING_CONTACT_REQUEST", {
      partnerId: Number(partner.id),
    });

    const nextState = await resolvePartnerOnboardingState(Number(partner.id));
    if (!nextState) return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    return res.json(toOnboardingResponse(nextState));
  } catch (error) {
    console.error("[partner-portal] onboarding request contact error:", error);
    return res.status(500).json({ message: "FAILED_TO_REQUEST_CONTACT_ACCESS" });
  }
});

partnerPortalRouter.get("/data-room", requirePartnerGate("viewDataRoom"), async (req, res) => {
  try {
    const paging = normalizePaging({
      limit: req.query.limit,
      offset: req.query.offset,
      defaultLimit: 25,
      maxLimit: 100,
    });

    const daysRaw = Number(req.query.days);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, Math.trunc(daysRaw))) : 90;
    const cutoffSec = nowSec() - days * 86400;

    const minSharpeRaw = req.query.minSharpe == null ? null : Number(req.query.minSharpe);
    const minScoreRaw = req.query.minScore == null ? null : Number(req.query.minScore);
    const minSharpe = Number.isFinite(minSharpeRaw) ? minSharpeRaw : null;
    const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : null;

    const out = await listPartnerDataRoomCandidates({
      limit: paging.limit,
      offset: paging.offset,
      minSharpe,
      minScore,
      cutoffSec,
    });

    await appendPartnerReadAudit(req, "PARTNER_DATA_ROOM_READ", {
      rowsReturned: out.rows.length,
      total: out.total,
      limit: paging.limit,
      offset: paging.offset,
    });

    return res.json({
      ok: true,
      limit: paging.limit,
      offset: paging.offset,
      total: out.total,
      hasMore: out.hasMore,
      results: out.rows,
    });
  } catch (error) {
    console.error("[partner-portal] data-room error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_DATA_ROOM" });
  }
});

partnerPortalRouter.get("/tear-sheet/:hashId", requirePartnerGate("viewDataRoom"), async (req, res) => {
  let inflightCacheKey: string | null = null;
  let rejectInflightTask: ((error: unknown) => void) | null = null;
  try {
    const partner = (req as any).partner as { id: number };
    const hashId = String(req.params.hashId || "").trim();
    if (!hashId) return res.status(400).json({ message: "INVALID_HASH_ID" });

    const userId = await resolveEligibleUserIdFromHash(hashId);
    if (!userId) {
      return res.status(404).json({ message: "CANDIDATE_NOT_FOUND" });
    }

    const daysRaw = Number(req.query.days);
    const days = Number.isFinite(daysRaw) ? Math.max(7, Math.min(365, Math.trunc(daysRaw))) : 180;
    const cutoffSec = nowSec() - days * 86400;
    const cacheKey = `${Number(partner?.id || 0)}:${hashId}:${days}`;
    inflightCacheKey = cacheKey;

    const cachedPayload = getCachedTearSheetPayload(cacheKey);
    if (cachedPayload) {
      await appendPartnerReadAudit(req, "PARTNER_TEAR_SHEET_READ", {
        hashId,
        days,
        trades: Number(cachedPayload?.summary?.trades ?? 0),
        cacheHit: true,
      });
      return res.json(cachedPayload);
    }

    const inflightPayload = tearSheetInflight.get(cacheKey);
    if (inflightPayload) {
      const payload = await inflightPayload;
      await appendPartnerReadAudit(req, "PARTNER_TEAR_SHEET_READ", {
        hashId,
        days,
        trades: Number(payload?.summary?.trades ?? 0),
        deduped: true,
      });
      return res.json(payload);
    }

    let resolveInflight: (payload: any) => void = () => undefined;
    let rejectInflight: (error: unknown) => void = () => undefined;
    const task = new Promise<any>((resolve, reject) => {
      resolveInflight = resolve;
      rejectInflight = reject;
    });
    void task.catch(() => undefined);
    rejectInflightTask = rejectInflight;
    tearSheetInflight.set(cacheKey, task);

    const netProfitSql = netProfitSqlAlias("t");

    const summaryRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            t.id,
            t.user_id,
            t.symbol_id,
            t.type,
            t.open_price,
            t.close_price,
            t.opened_at,
            t.closed_at,
            ${netProfitSql}::float8 AS net_profit
          FROM trades t
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT
          COUNT(*)::int AS trades,
          COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
        FROM src
      `,
      [userId, cutoffSec],
    );

    const summary = summaryRes.rows?.[0] ?? { trades: 0, net_profit: 0, win_rate: 0 };

    const [metricsRow] = await db
      .select()
      .from(scoutMetricsSnapshot)
      .where(eq(scoutMetricsSnapshot.userId, userId))
      .limit(1);

    const breakdownRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            CASE
              WHEN sc.category IS NULL OR btrim(sc.category) = '' THEN 'unknown'
              ELSE lower(sc.category)
            END AS category,
            ${netProfitSql}::float8 AS net_profit
          FROM trades t
          LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT
          category,
          COUNT(*)::int AS trades,
          COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate
        FROM src
        GROUP BY category
        ORDER BY net_profit DESC, trades DESC
        LIMIT 20
      `,
      [userId, cutoffSec],
    );

    const extremesRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            t.id,
            sc.symbol,
            t.type,
            t.open_price,
            t.close_price,
            t.opened_at,
            t.closed_at,
            ${netProfitSql}::float8 AS net_profit,
            CASE
              WHEN t.open_price IS NULL OR t.open_price = 0 OR t.close_price IS NULL THEN NULL
              WHEN t.type = 'BUY' THEN (t.close_price - t.open_price) / t.open_price
              WHEN t.type = 'SELL' THEN (t.open_price - t.close_price) / t.open_price
              ELSE NULL
            END AS return_pct
          FROM trades t
          LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT 'top' AS bucket, *
        FROM (SELECT * FROM src ORDER BY net_profit DESC, closed_at DESC LIMIT 10) a
        UNION ALL
        SELECT 'bottom' AS bucket, *
        FROM (SELECT * FROM src ORDER BY net_profit ASC, closed_at DESC LIMIT 10) b
      `,
      [userId, cutoffSec],
    );

    const topTrades: any[] = [];
    const bottomTrades: any[] = [];
    for (const row of extremesRes.rows ?? []) {
      const item = {
        id: Number(row.id),
        symbol: row.symbol ?? null,
        side:
          String(row.type || "").toUpperCase() === "BUY"
            ? "buy"
            : String(row.type || "").toUpperCase() === "SELL"
              ? "sell"
              : null,
        openedAt: row.opened_at == null ? null : Number(row.opened_at),
        closedAt: row.closed_at == null ? null : Number(row.closed_at),
        holdSec:
          row.closed_at != null && row.opened_at != null
            ? Number(row.closed_at) - Number(row.opened_at)
            : null,
        pnlUsd: Number(row.net_profit ?? 0),
        returnPct: row.return_pct == null ? null : Number(row.return_pct),
      };
      if (row.bucket === "top") topTrades.push(item);
      else bottomTrades.push(item);
    }

    const challengeRes = await db.execute(sql`
      SELECT
        e.id AS enrollment_id,
        e.challenge_id,
        c.name,
        c.slug,
        e.status,
        e.current_phase,
        e.attempt_number,
        e.enrolled_at,
        e.completed_at,
        e.current_pnl_pct,
        e.trading_days,
        e.max_daily_loss_hit,
        e.max_total_loss_hit,
        c.prize_pool_enabled,
        c.badges_enabled,
        c.certificate_enabled,
        c.selection_boost_enabled,
        COALESCE((
          SELECT SUM(p.prize_amount_usd)
          FROM challenge_prize_awards p
          WHERE p.enrollment_id = e.id
            AND p.status IN ('PENDING', 'APPROVED', 'PAID')
        ), 0)::float8 AS prize_amount_usd,
        COALESCE((
          SELECT COUNT(*)
          FROM challenge_badge_awards b
          WHERE b.enrollment_id = e.id
        ), 0)::int AS badge_count,
        EXISTS(
          SELECT 1
          FROM challenge_certificates cc
          WHERE cc.enrollment_id = e.id
        ) AS has_certificate,
        COALESCE((
          SELECT SUM(sb.points)
          FROM challenge_selection_boosts sb
          WHERE sb.enrollment_id = e.id
        ), 0)::float8 AS selection_boost_points,
        (
          SELECT s.rank
          FROM challenge_leaderboard_snapshot s
          WHERE s.challenge_id = e.challenge_id
            AND s.user_id = e.user_id
          ORDER BY s.calculated_at DESC
          LIMIT 1
        )::int AS leaderboard_rank
      FROM challenge_enrollments e
      INNER JOIN challenges c ON c.id = e.challenge_id
      WHERE e.user_id = ${userId}
      ORDER BY e.id DESC
      LIMIT 50
    `);

    const payload = {
      ok: true,
      hashId,
      days,
      summary: {
        trades: Number(summary.trades ?? 0),
        netProfit: Number(summary.net_profit ?? 0),
        winRate: Number(summary.win_rate ?? 0),
      },
      metrics: metricsRow
        ? {
          sharpeRatio: metricsRow.sharpeRatio,
          sortinoRatio: metricsRow.sortinoRatio,
          calmarRatio: metricsRow.calmarRatio,
          equityCurveR2: metricsRow.equityCurveR2,
          avgMae: metricsRow.avgMae,
          avgMfe: metricsRow.avgMfe,
          styleCluster: metricsRow.styleCluster,
          compositeScore: metricsRow.compositeScore,
          calculatedAt: metricsRow.calculatedAt,
        }
        : null,
      breakdown: (breakdownRes.rows ?? []).map((r: any) => ({
        category: r.category,
        trades: Number(r.trades ?? 0),
        netProfit: Number(r.net_profit ?? 0),
        winRate: Number(r.win_rate ?? 0),
      })),
      topTrades,
      bottomTrades,
      challenges: ((challengeRes as any).rows ?? []).map((r: any) => ({
        enrollmentId: Number(r.enrollment_id),
        challengeId: Number(r.challenge_id),
        name: r.name,
        slug: r.slug,
        status: r.status,
        currentPhase: Number(r.current_phase ?? 1),
        attemptNumber: Number(r.attempt_number ?? 1),
        enrolledAt: Number(r.enrolled_at),
        completedAt: r.completed_at == null ? null : Number(r.completed_at),
        currentPnlPct: Number(r.current_pnl_pct ?? 0),
        tradingDays: Number(r.trading_days ?? 0),
        maxDailyLossHit: r.max_daily_loss_hit == null ? null : Number(r.max_daily_loss_hit),
        maxTotalLossHit: r.max_total_loss_hit == null ? null : Number(r.max_total_loss_hit),
        rewardSummary: {
          prizePoolEnabled: Boolean(r.prize_pool_enabled),
          badgesEnabled: Boolean(r.badges_enabled),
          certificateEnabled: Boolean(r.certificate_enabled),
          selectionBoostEnabled: Boolean(r.selection_boost_enabled),
          prizeAmountUsd: Number(r.prize_amount_usd ?? 0),
          badgeCount: Number(r.badge_count ?? 0),
          hasCertificate: Boolean(r.has_certificate),
          selectionBoostPoints: Number(r.selection_boost_points ?? 0),
        },
        leaderboardRank: r.leaderboard_rank == null ? null : Number(r.leaderboard_rank),
      })),
    };

    setCachedTearSheetPayload(cacheKey, payload);
    resolveInflight(payload);
    tearSheetInflight.delete(cacheKey);
    rejectInflightTask = null;
    inflightCacheKey = null;

    await appendPartnerReadAudit(req, "PARTNER_TEAR_SHEET_READ", {
      hashId,
      days,
      trades: Number(summary.trades ?? 0),
      cacheHit: false,
    });

    return res.json(payload);
  } catch (error) {
    rejectInflightTask?.(error);
    if (inflightCacheKey) {
      tearSheetInflight.delete(inflightCacheKey);
    }
    console.error("[partner-portal] tear-sheet error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_TEAR_SHEET" });
  }
});

partnerPortalRouter.post("/simulations/preview", requirePartnerGate("runSimulations"), async (req, res) => {
  try {
    const parsed = partnerSimulationPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const userHashId = String(parsed.data.userHashId || "").trim();
    const userId = await resolveEligibleUserIdFromHash(userHashId);
    if (!userId) {
      return res.status(404).json({ message: "CANDIDATE_NOT_FOUND" });
    }

    const horizonDays = Math.max(7, Math.min(365, Number(parsed.data.horizonDays ?? 30)));
    const cutoffSec = nowSec() - horizonDays * 86400;

    const netProfitSql = netProfitSqlAlias("t");
    const perfRes = await dbClient.query(
      `
        WITH src AS (
          SELECT
            ${netProfitSql}::float8 AS net_profit,
            CASE
              WHEN t.open_price IS NULL OR t.open_price = 0 OR t.close_price IS NULL THEN NULL
              WHEN t.type = 'BUY' THEN (t.close_price - t.open_price) / t.open_price
              WHEN t.type = 'SELL' THEN (t.open_price - t.close_price) / t.open_price
              ELSE NULL
            END::float8 AS return_pct
          FROM trades t
          WHERE t.user_id = $1::int
            AND t.status = 'CLOSED'
            AND t.closed_at IS NOT NULL
            AND t.closed_at >= $2::int
        )
        SELECT
          COUNT(*)::int AS trades,
          COALESCE(SUM(net_profit), 0)::float8 AS net_profit,
          COALESCE(SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END)::float8 / NULLIF(COUNT(*), 0), 0)::float8 AS win_rate,
          COALESCE(AVG(return_pct), 0)::float8 AS avg_return_pct
        FROM src
      `,
      [userId, cutoffSec],
    );

    const perf = perfRes.rows?.[0] ?? {
      trades: 0,
      net_profit: 0,
      win_rate: 0,
      avg_return_pct: 0,
    };

    const [metrics] = await db
      .select({
        sharpeRatio: scoutMetricsSnapshot.sharpeRatio,
        sortinoRatio: scoutMetricsSnapshot.sortinoRatio,
        calmarRatio: scoutMetricsSnapshot.calmarRatio,
        avgMae: scoutMetricsSnapshot.avgMae,
        compositeScore: scoutMetricsSnapshot.compositeScore,
        calculatedAt: scoutMetricsSnapshot.calculatedAt,
      })
      .from(scoutMetricsSnapshot)
      .where(eq(scoutMetricsSnapshot.userId, userId))
      .limit(1);

    const trades = Math.max(0, Number(perf.trades || 0));
    const winRate = Math.max(0, Math.min(1, Number(perf.win_rate || 0)));
    const avgReturnPct = Number(perf.avg_return_pct || 0);
    const scaledTradeCount = Math.max(0.25, Math.min(2.5, trades / 30));
    const projectedPnlPct = Math.max(-0.95, Math.min(2, avgReturnPct * trades * scaledTradeCount));
    const projectedPnlUsd = projectedPnlPct * Number(parsed.data.notionalUsd);
    const sharpe = Number(metrics?.sharpeRatio || 0);
    const confidence = Math.max(
      0,
      Math.min(1, (Math.min(trades, 80) / 80 + Math.max(0, Math.min(3, sharpe)) / 3) / 2),
    );

    const riskBand =
      sharpe >= 2 && winRate >= 0.55 ? "LOW" : sharpe >= 1 && winRate >= 0.5 ? "MEDIUM" : "HIGH";

    await appendPartnerReadAudit(req, "PARTNER_SIMULATION_PREVIEW", {
      userHashId,
      horizonDays,
      trades,
      notionalUsd: Number(parsed.data.notionalUsd),
    });

    return res.json({
      ok: true,
      preview: {
        userHashId,
        horizonDays,
        inputNotionalUsd: Number(parsed.data.notionalUsd),
        historical: {
          trades,
          netProfitUsd: Number(perf.net_profit || 0),
          winRate,
          avgReturnPct,
          sharpeRatio: metrics?.sharpeRatio == null ? null : Number(metrics.sharpeRatio),
          sortinoRatio: metrics?.sortinoRatio == null ? null : Number(metrics.sortinoRatio),
          calmarRatio: metrics?.calmarRatio == null ? null : Number(metrics.calmarRatio),
          avgMae: metrics?.avgMae == null ? null : Number(metrics.avgMae),
          compositeScore: metrics?.compositeScore == null ? null : Number(metrics.compositeScore),
          calculatedAt: metrics?.calculatedAt == null ? null : Number(metrics.calculatedAt),
        },
        scenario: {
          projectedPnlUsd,
          projectedPnlPct,
          confidence,
          riskBand,
          modelVersion: "SIM_PREVIEW_V1",
        },
      },
    });
  } catch (error) {
    console.error("[partner-portal] simulation preview error:", error);
    return res.status(500).json({ message: "FAILED_TO_GENERATE_SIMULATION_PREVIEW" });
  }
});

partnerPortalRouter.get("/allocations", requirePartnerGate("requestAllocation"), async (req, res) => {
  try {
    const partner = (req as any).partner;
    const paging = normalizePaging({
      limit: req.query.limit,
      offset: req.query.offset,
      defaultLimit: 50,
      maxLimit: 200,
    });

    const [cfg] = await db
      .select({ partnerAllocationsEnabled: systemConfig.partnerAllocationsEnabled })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    if (!cfg?.partnerAllocationsEnabled) {
      return res.status(403).json({ message: "PARTNER_ALLOCATIONS_DISABLED" });
    }

    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM partner_allocations
      WHERE partner_id = ${Number(partner.id)}
    `);
    const total = Number((countRes as any).rows?.[0]?.total ?? 0);

    const rows = await db
      .select({
        id: partnerAllocations.id,
        userHashId: partnerAllocations.userHashId,
        capitalUsd: partnerAllocations.capitalUsd,
        shadowStopPct: partnerAllocations.shadowStopPct,
        status: partnerAllocations.status,
        currentPnlUsd: partnerAllocations.currentPnlUsd,
        createdAt: partnerAllocations.createdAt,
        updatedAt: partnerAllocations.updatedAt,
      })
      .from(partnerAllocations)
      .where(eq(partnerAllocations.partnerId, Number(partner.id)))
      .orderBy(sql`${partnerAllocations.createdAt} DESC`, sql`${partnerAllocations.id} DESC`)
      .limit(paging.limit)
      .offset(paging.offset);

    await appendPartnerReadAudit(req, "PARTNER_ALLOCATIONS_LIST", {
      rowsReturned: rows.length,
      limit: paging.limit,
      offset: paging.offset,
      total,
    });

    return res.json({ ok: true, limit: paging.limit, offset: paging.offset, total, rows });
  } catch (error) {
    console.error("[partner-portal] allocations list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_ALLOCATIONS" });
  }
});

partnerPortalRouter.post("/allocations", requirePartnerGate("requestAllocation"), async (req, res) => {
  try {
    const partner = (req as any).partner;

    const [cfg] = await db
      .select({ partnerAllocationsEnabled: systemConfig.partnerAllocationsEnabled })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    if (!cfg?.partnerAllocationsEnabled) {
      return res.status(403).json({ message: "PARTNER_ALLOCATIONS_DISABLED" });
    }

    const userHashIdInput = String(req.body?.userHashId || "").trim();
    if (!userHashIdInput) return res.status(400).json({ message: "USER_HASH_ID_REQUIRED" });

    const userId = await resolveEligibleUserIdFromHash(userHashIdInput);
    if (!userId) return res.status(404).json({ message: "CANDIDATE_NOT_FOUND" });
    const userHashId = anonymizeUserId(userId);

    const capitalUsd = normalizeCapitalUsd(req.body?.capitalUsd);
    if (capitalUsd == null) return res.status(400).json({ message: "INVALID_CAPITAL_USD" });

    const shadowStopPct = normalizeShadowStopPct(req.body?.shadowStopPct);
    if (req.body?.shadowStopPct != null && shadowStopPct == null) {
      return res.status(400).json({ message: "INVALID_SHADOW_STOP_PCT" });
    }

    const ts = nowSec();
    const [created] = await db
      .insert(partnerAllocations)
      .values({
        partnerId: Number(partner.id),
        userId,
        userHashId,
        capitalUsd,
        shadowStopPct,
        status: "ACTIVE",
        currentPnlUsd: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({
        id: partnerAllocations.id,
        userHashId: partnerAllocations.userHashId,
        capitalUsd: partnerAllocations.capitalUsd,
        shadowStopPct: partnerAllocations.shadowStopPct,
        status: partnerAllocations.status,
        currentPnlUsd: partnerAllocations.currentPnlUsd,
        createdAt: partnerAllocations.createdAt,
        updatedAt: partnerAllocations.updatedAt,
      });

    await appendPartnerReadAudit(req, "PARTNER_ALLOCATION_CREATE", {
      allocationId: created.id,
      hashId: userHashId,
      capitalUsd,
    });

    return res.status(201).json({ ok: true, row: created });
  } catch (error) {
    console.error("[partner-portal] allocation create error:", error);
    return res.status(500).json({ message: "FAILED_TO_CREATE_ALLOCATION" });
  }
});

partnerPortalRouter.put("/allocations/:id", requirePartnerGate("requestAllocation"), async (req, res) => {
  try {
    const partner = (req as any).partner;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "INVALID_ALLOCATION_ID" });

    const status =
      req.body?.status === undefined || req.body?.status === null
        ? undefined
        : normalizeAllocationStatus(req.body.status);
    if (req.body?.status != null && !status) {
      return res.status(400).json({ message: "INVALID_ALLOCATION_STATUS" });
    }

    const shadowStopPct =
      req.body?.shadowStopPct === undefined
        ? undefined
        : req.body?.shadowStopPct === null
          ? null
          : normalizeShadowStopPct(req.body?.shadowStopPct);

    if (req.body?.shadowStopPct !== undefined && req.body?.shadowStopPct !== null && shadowStopPct == null) {
      return res.status(400).json({ message: "INVALID_SHADOW_STOP_PCT" });
    }

    const [updated] = await db
      .update(partnerAllocations)
      .set({
        status: status ?? undefined,
        shadowStopPct,
        updatedAt: nowSec(),
      })
      .where(and(eq(partnerAllocations.id, id), eq(partnerAllocations.partnerId, Number(partner.id))))
      .returning({
        id: partnerAllocations.id,
        userHashId: partnerAllocations.userHashId,
        capitalUsd: partnerAllocations.capitalUsd,
        shadowStopPct: partnerAllocations.shadowStopPct,
        status: partnerAllocations.status,
        currentPnlUsd: partnerAllocations.currentPnlUsd,
        createdAt: partnerAllocations.createdAt,
        updatedAt: partnerAllocations.updatedAt,
      });

    if (!updated) return res.status(404).json({ message: "ALLOCATION_NOT_FOUND" });

    await appendPartnerReadAudit(req, "PARTNER_ALLOCATION_UPDATE", {
      allocationId: id,
      status,
    });

    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[partner-portal] allocation update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_ALLOCATION" });
  }
});

partnerPortalRouter.get("/inquiries", async (req, res) => {
  try {
    const partner = (req as any).partner;
    const paging = normalizePaging({
      limit: req.query.limit,
      offset: req.query.offset,
      defaultLimit: 50,
      maxLimit: 200,
    });

    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM partner_inquiries
      WHERE partner_id = ${Number(partner.id)}
    `);
    const total = Number((countRes as any).rows?.[0]?.total ?? 0);

    const rows = await db
      .select({
        id: partnerInquiries.id,
        userHashId: partnerInquiries.userHashId,
        senderName: partnerInquiries.senderName,
        senderEmail: partnerInquiries.senderEmail,
        subject: partnerInquiries.subject,
        body: partnerInquiries.body,
        status: partnerInquiries.status,
        mailboxThreadId: partnerInquiries.mailboxThreadId,
        createdAt: partnerInquiries.createdAt,
        updatedAt: partnerInquiries.updatedAt,
      })
      .from(partnerInquiries)
      .where(eq(partnerInquiries.partnerId, Number(partner.id)))
      .orderBy(sql`${partnerInquiries.createdAt} DESC`, sql`${partnerInquiries.id} DESC`)
      .limit(paging.limit)
      .offset(paging.offset);

    await appendPartnerReadAudit(req, "PARTNER_INQUIRIES_LIST", {
      rowsReturned: rows.length,
      limit: paging.limit,
      offset: paging.offset,
      total,
    });

    return res.json({ ok: true, limit: paging.limit, offset: paging.offset, total, rows });
  } catch (error) {
    console.error("[partner-portal] inquiries list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_INQUIRIES" });
  }
});

partnerPortalRouter.get("/inquiries/recipients", async (req, res) => {
  try {
    const routing = await resolvePartnerInquiryRouting();

    await appendPartnerReadAudit(req, "PARTNER_INQUIRY_RECIPIENTS_READ", {
      routeAdminCount: routing.routeAdmins.length,
      viewerAdminCount: routing.viewerAdmins.length,
      participantCount: routing.participantAdmins.length,
      missingKeyCount: routing.missingKeyAdminIds.length,
    });

    const routeAdminIdSet = new Set(routing.routeAdmins.map((row) => row.userId));
    const viewerAdminIdSet = new Set(routing.viewerAdmins.map((row) => row.userId));
    return res.json({
      ok: true,
      inboxAlias: routing.config.inboxAlias,
      routeAdminCount: routing.routeAdmins.length,
      viewerAdminCount: routing.viewerAdmins.length,
      participantCount: routing.participantAdmins.length,
      missingKeyCount: routing.missingKeyAdminIds.length,
      missingKeyAdminIds: routing.missingKeyAdminIds,
      rows: routing.participantAdmins.map((row) => ({
        userId: row.userId,
        mailboxPublicKey: row.mailboxPublicKey,
        mailboxPublicKeyAlgo: row.mailboxPublicKeyAlgo,
        routeRecipient: routeAdminIdSet.has(row.userId),
        viewerRecipient: viewerAdminIdSet.has(row.userId),
      })),
    });
  } catch (error) {
    console.error("[partner-portal] inquiry recipient list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_INQUIRY_RECIPIENTS" });
  }
});

partnerPortalRouter.post("/inquiries", async (req, res) => {
  try {
    const partner = (req as any).partner as { id: number; name: string };
    if (process.env.NODE_ENV === "production" && !isSecurePartnerTransport(req) && !isLoopbackHost(req)) {
      return res.status(426).json({ message: "HTTPS_REQUIRED_FOR_PARTNER_INQUIRIES" });
    }

    const subject = String(req.body?.subject || "").trim();
    const body = String(req.body?.body || "").trim();
    const senderName = String(req.body?.senderName || "").trim();
    const senderEmail = String(req.body?.senderEmail || "").trim().toLowerCase();
    const e2eeEnvelopeRaw = req.body?.e2eeEnvelope;
    const e2eeEnvelope = e2eeEnvelopeRaw == null ? "" : String(e2eeEnvelopeRaw).trim();
    const e2eeSenderKeyFingerprintRaw = req.body?.e2eeSenderKeyFingerprint;
    const e2eeSenderKeyFingerprint =
      e2eeSenderKeyFingerprintRaw == null ? "" : String(e2eeSenderKeyFingerprintRaw).trim();
    const bodyDigestSha256Raw = req.body?.bodyDigestSha256;
    const bodyDigestSha256 = bodyDigestSha256Raw == null ? "" : String(bodyDigestSha256Raw).trim();
    const userHashIdRaw = req.body?.userHashId;
    const userHashIdInput = userHashIdRaw == null ? null : String(userHashIdRaw).trim();

    if (!subject || subject.length > 160) {
      return res.status(400).json({ message: "INVALID_SUBJECT" });
    }
    if (!body || body.length > 8000) {
      return res.status(400).json({ message: "INVALID_BODY" });
    }
    if (senderName.length > 120) {
      return res.status(400).json({ message: "INVALID_SENDER_NAME" });
    }
    if (!senderEmail || senderEmail.length > 254 || !isValidEmailAddress(senderEmail)) {
      return res.status(400).json({ message: "INVALID_SENDER_EMAIL" });
    }
    if (!e2eeEnvelope || e2eeEnvelope.length > MAX_E2EE_ENVELOPE_BYTES) {
      return res.status(409).json({ message: "INQUIRY_E2EE_REQUIRED" });
    }
    if (e2eeSenderKeyFingerprint && !normalizeHexSha256(e2eeSenderKeyFingerprint)) {
      return res.status(400).json({ message: "INVALID_E2EE_SENDER_FINGERPRINT" });
    }
    if (bodyDigestSha256 && !normalizeHexSha256(bodyDigestSha256)) {
      return res.status(400).json({ message: "INVALID_BODY_DIGEST" });
    }

    const userHashId = userHashIdInput ? String(userHashIdInput) : null;
    if (userHashIdInput) {
      const resolved = await resolveEligibleUserIdFromHash(userHashIdInput);
      if (!resolved) {
        return res.status(404).json({ message: "CANDIDATE_NOT_FOUND" });
      }
      const canonicalHash = anonymizeUserId(resolved);
      if (canonicalHash !== userHashIdInput) {
        // Keep a canonical hash format in stored records for deterministic joins.
        (req as any)._canonicalInquiryHash = canonicalHash;
      }
    }

    const messaging = await getCommunicationSettings();
    if (!messaging.messagingEnabled) {
      return res.status(409).json({ message: "MESSAGING_DISABLED" });
    }
    if (!messaging.messagingE2eeEnabled) {
      return res.status(409).json({ message: "INQUIRY_E2EE_NOT_ENABLED" });
    }

    const routing = await resolvePartnerInquiryRouting();
    if (!routing.routeAdmins.length) {
      return res.status(409).json({ message: "NO_ADMIN_RECIPIENTS" });
    }
    if (routing.missingKeyAdminIds.length > 0) {
      return res.status(409).json({
        message: "INQUIRY_RECIPIENT_KEYS_MISSING",
        missingKeyAdminIds: routing.missingKeyAdminIds,
      });
    }

    const thread = await forwardPartnerInquiryToAdmins({
      partnerId: Number(partner.id),
      partnerName: String(partner.name || "Partner"),
      inboxAlias: routing.config.inboxAlias,
      userHashId: (req as any)._canonicalInquiryHash ?? userHashId,
      senderName: senderName || null,
      senderEmail,
      subject,
      body,
      recipientAdminUserIds: routing.routeAdmins.map((row) => row.userId),
      viewerAdminUserIds: routing.viewerAdmins.map((row) => row.userId),
      e2eeEnvelope,
      e2eeSenderKeyFingerprint: e2eeSenderKeyFingerprint || null,
      bodyDigestSha256: bodyDigestSha256 || null,
      ip: String(req.ip || "") || null,
      userAgent: String(req.headers?.["user-agent"] || "") || null,
    });

    const ts = nowSec();
    const [created] = await db
      .insert(partnerInquiries)
      .values({
        partnerId: Number(partner.id),
        userHashId: ((req as any)._canonicalInquiryHash ?? userHashId) || null,
        senderName: senderName || null,
        senderEmail,
        subject,
        body,
        status: "FORWARDED",
        mailboxThreadId: Number(thread.threadId),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({
        id: partnerInquiries.id,
        userHashId: partnerInquiries.userHashId,
        senderName: partnerInquiries.senderName,
        senderEmail: partnerInquiries.senderEmail,
        subject: partnerInquiries.subject,
        body: partnerInquiries.body,
        status: partnerInquiries.status,
        mailboxThreadId: partnerInquiries.mailboxThreadId,
        createdAt: partnerInquiries.createdAt,
        updatedAt: partnerInquiries.updatedAt,
      });

    await appendPartnerReadAudit(req, "PARTNER_INQUIRY_CREATE", {
      inquiryId: created.id,
      mailboxThreadId: created.mailboxThreadId,
      userHashId,
      senderEmail,
      routeAdminCount: routing.routeAdmins.length,
      viewerAdminCount: routing.viewerAdmins.length,
      participantCount: thread.participantRecipientIds.length,
      inboxAlias: routing.config.inboxAlias,
    });

    return res.status(201).json({ ok: true, row: created, inboxAlias: routing.config.inboxAlias });
  } catch (error: any) {
    console.error("[partner-portal] inquiry create error:", error);
    const code = String(error?.message || "");
    if (code === "NO_ADMIN_RECIPIENTS") {
      return res.status(409).json({ message: "NO_ADMIN_RECIPIENTS" });
    }
    if (code === "INQUIRY_BODY_REQUIRED") {
      return res.status(400).json({ message: "INVALID_BODY" });
    }
    if (
      code === "MESSAGING_DISABLED" ||
      code === "INQUIRY_E2EE_REQUIRED" ||
      code === "INQUIRY_E2EE_NOT_ENABLED" ||
      code === "INQUIRY_RECIPIENT_KEYS_MISSING"
    ) {
      return res.status(409).json({ message: code });
    }
    return res.status(500).json({ message: "FAILED_TO_CREATE_INQUIRY" });
  }
});

export { partnerPortalRouter, partnerAuthRouter };
