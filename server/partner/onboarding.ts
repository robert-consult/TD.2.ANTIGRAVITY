import { and, eq } from "drizzle-orm";
import { db } from "@db";
import { nowSec } from "@shared/scalars";
import { partners, systemConfig } from "@shared/schema";
import {
  DEFAULT_PARTNER_INSTITUTION_PROFILE,
  normalizePartnerInstitutionProfile,
  type PartnerInstitutionProfile,
} from "@shared/partnerProfile";

export const PARTNER_GATE_LEVELS = ["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"] as const;
export type PartnerGateLevel = (typeof PARTNER_GATE_LEVELS)[number];

export const PARTNER_ONBOARDING_STEPS = [
  "PROFILE",
  "IDENTITY",
  "LEGAL",
  "WAITING_APPROVAL",
  "COMPLETED",
] as const;
export type PartnerOnboardingStep = (typeof PARTNER_ONBOARDING_STEPS)[number];

export const PARTNER_GATE_KEYS = [
  "viewDataRoom",
  "runSimulations",
  "requestAllocation",
  "directContact",
] as const;
export type PartnerGateKey = (typeof PARTNER_GATE_KEYS)[number];

export type PartnerGatingConfig = Record<PartnerGateKey, PartnerGateLevel>;

export const DEFAULT_PARTNER_GATING_CONFIG: PartnerGatingConfig = {
  viewDataRoom: "INVITED",
  runSimulations: "IDENTITY",
  requestAllocation: "COMPLIANT",
  directContact: "ADMIN_APPROVED",
};

export type PartnerGateEval = {
  allowed: boolean;
  reason: string | null;
  requiredLevel: PartnerGateLevel;
  currentLevel: PartnerGateLevel;
};

export type PartnerOnboardingState = {
  partnerId: number;
  partnerName: string;
  contactEmail: string | null;
  contactUsername: string | null;
  inviteStatus: string;
  onboardingStep: PartnerOnboardingStep;
  inviteExpiresAt: number | null;
  isInviteExpired: boolean;
  profileData: {
    fundName: string | null;
    aumRange: string | null;
    hqLocation: string | null;
    strategyTags: string[];
    institutionProfile: PartnerInstitutionProfile;
  };
  fundLogoUrl: string | null;
  kybDocUrl: string | null;
  agreementsSignedAt: number | null;
  contactAccessRequestedAt: number | null;
  approvedAt: number | null;
  adminNotes: string | null;
  loginCount: number;
  passwordRotatedAt: number | null;
  gateConfig: PartnerGatingConfig;
  gateOverrides: Partial<PartnerGatingConfig>;
  gateEval: Record<PartnerGateKey, PartnerGateEval>;
  progressPct: number;
  passwordPolicy: {
    rotationDays: number;
    reminderLogins: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeGateLevel(value: unknown, fallback: PartnerGateLevel): PartnerGateLevel {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (PARTNER_GATE_LEVELS.includes(candidate as PartnerGateLevel)) {
    return candidate as PartnerGateLevel;
  }
  return fallback;
}

function normalizeOnboardingStep(value: unknown): PartnerOnboardingStep {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (PARTNER_ONBOARDING_STEPS.includes(candidate as PartnerOnboardingStep)) {
    return candidate as PartnerOnboardingStep;
  }
  return "PROFILE";
}

export function normalizePartnerGatingConfig(value: unknown): PartnerGatingConfig {
  const input = asRecord(value);
  return {
    viewDataRoom: normalizeGateLevel(input.viewDataRoom, DEFAULT_PARTNER_GATING_CONFIG.viewDataRoom),
    runSimulations: normalizeGateLevel(input.runSimulations, DEFAULT_PARTNER_GATING_CONFIG.runSimulations),
    requestAllocation: normalizeGateLevel(input.requestAllocation, DEFAULT_PARTNER_GATING_CONFIG.requestAllocation),
    directContact: normalizeGateLevel(input.directContact, DEFAULT_PARTNER_GATING_CONFIG.directContact),
  };
}

export function normalizePartnerGatingOverrides(value: unknown): Partial<PartnerGatingConfig> {
  const input = asRecord(value);
  const out: Partial<PartnerGatingConfig> = {};
  for (const key of PARTNER_GATE_KEYS) {
    if (input[key] === undefined) continue;
    out[key] = normalizeGateLevel(input[key], DEFAULT_PARTNER_GATING_CONFIG[key]);
  }
  return out;
}

function mergePartnerGateConfig(
  globalConfig: PartnerGatingConfig,
  overrides: Partial<PartnerGatingConfig>,
): PartnerGatingConfig {
  return {
    viewDataRoom: overrides.viewDataRoom ?? globalConfig.viewDataRoom,
    runSimulations: overrides.runSimulations ?? globalConfig.runSimulations,
    requestAllocation: overrides.requestAllocation ?? globalConfig.requestAllocation,
    directContact: overrides.directContact ?? globalConfig.directContact,
  };
}

function deriveAccessLevel(step: PartnerOnboardingStep): PartnerGateLevel {
  if (step === "COMPLETED") return "ADMIN_APPROVED";
  if (step === "LEGAL" || step === "WAITING_APPROVAL") return "COMPLIANT";
  if (step === "IDENTITY") return "IDENTITY";
  return "INVITED";
}

function levelRank(level: PartnerGateLevel): number {
  switch (level) {
    case "INVITED":
      return 0;
    case "IDENTITY":
      return 1;
    case "COMPLIANT":
      return 2;
    case "ADMIN_APPROVED":
      return 3;
    default:
      return 0;
  }
}

function normalizeInviteStatus(value: unknown): string {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (candidate === "INVITED" || candidate === "ACTIVE" || candidate === "REVOKED") return candidate;
  return "ACTIVE";
}

function parseStrategyTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 25);
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0)
      .slice(0, 25);
  } catch {
    return [];
  }
}

function parseProfileData(raw: unknown): {
  fundName: string | null;
  aumRange: string | null;
  hqLocation: string | null;
  strategyTags: string[];
  institutionProfile: PartnerInstitutionProfile;
} {
  const input = asRecord(raw);
  const institutionRaw =
    input.institutionProfile && typeof input.institutionProfile === "object"
      ? input.institutionProfile
      : input;
  const institutionProfile =
    normalizePartnerInstitutionProfile(institutionRaw) ?? DEFAULT_PARTNER_INSTITUTION_PROFILE;
  return {
    fundName: String(input.fundName ?? "").trim() || null,
    aumRange: String(input.aumRange ?? "").trim() || null,
    hqLocation: String(input.hqLocation ?? "").trim() || null,
    strategyTags: parseStrategyTags(input.strategyTags),
    institutionProfile,
  };
}

function computeProgressPct(step: PartnerOnboardingStep): number {
  switch (step) {
    case "PROFILE":
      return 33;
    case "IDENTITY":
      return 66;
    case "LEGAL":
      return 80;
    case "WAITING_APPROVAL":
      return 90;
    case "COMPLETED":
      return 100;
    default:
      return 33;
  }
}

export function evaluatePartnerGate(input: {
  inviteStatus: string;
  onboardingStep: PartnerOnboardingStep;
  requiredLevel: PartnerGateLevel;
  inviteExpiresAt: number | null;
  now?: number;
}): PartnerGateEval {
  const now = Number.isFinite(input.now) ? Number(input.now) : nowSec();
  const inviteStatus = normalizeInviteStatus(input.inviteStatus);
  const step = normalizeOnboardingStep(input.onboardingStep);
  const currentLevel = deriveAccessLevel(step);
  const requiredLevel = normalizeGateLevel(input.requiredLevel, "INVITED");

  if (inviteStatus === "REVOKED") {
    return {
      allowed: false,
      reason: "PARTNER_REVOKED",
      requiredLevel,
      currentLevel,
    };
  }

  if (inviteStatus === "INVITED" && input.inviteExpiresAt != null && Number(input.inviteExpiresAt) < now) {
    return {
      allowed: false,
      reason: "PARTNER_INVITE_EXPIRED",
      requiredLevel,
      currentLevel,
    };
  }

  if (levelRank(currentLevel) < levelRank(requiredLevel)) {
    return {
      allowed: false,
      reason: "PARTNER_GATE_BLOCKED",
      requiredLevel,
      currentLevel,
    };
  }

  return {
    allowed: true,
    reason: null,
    requiredLevel,
    currentLevel,
  };
}

export async function resolvePartnerOnboardingState(partnerId: number): Promise<PartnerOnboardingState | null> {
  const id = Number(partnerId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await db
    .select({
      id: partners.id,
      name: partners.name,
      contactEmail: partners.contactEmail,
      contactUsername: partners.contactUsername,
      inviteStatus: partners.inviteStatus,
      onboardingStep: partners.onboardingStep,
      inviteExpiresAt: partners.inviteExpiresAt,
      profileData: partners.profileData,
      fundLogoUrl: partners.fundLogoUrl,
      aumRange: partners.aumRange,
      hqLocation: partners.hqLocation,
      strategyTags: partners.strategyTags,
      kybDocUrl: partners.kybDocUrl,
      agreementsSignedAt: partners.agreementsSignedAt,
      contactAccessRequestedAt: partners.contactAccessRequestedAt,
      approvedAt: partners.approvedAt,
      adminNotes: partners.adminNotes,
      loginCount: partners.loginCount,
      passwordRotatedAt: partners.passwordRotatedAt,
      gatingOverrides: partners.gatingOverrides,
      partnerGatingConfig: systemConfig.partnerGatingConfig,
      partnerPasswordRotationDays: systemConfig.partnerPasswordRotationDays,
      partnerPasswordReminderLogins: systemConfig.partnerPasswordReminderLogins,
    })
    .from(partners)
    .leftJoin(systemConfig, eq(systemConfig.id, 1))
    .where(and(eq(partners.id, id), eq(partners.isActive, true)))
    .limit(1);

  if (!row) return null;

  const inviteStatus = normalizeInviteStatus(row.inviteStatus);
  const onboardingStep = normalizeOnboardingStep(row.onboardingStep);
  const gateConfig = normalizePartnerGatingConfig(row.partnerGatingConfig);
  const gateOverrides = normalizePartnerGatingOverrides(row.gatingOverrides);
  const effectiveGateConfig = mergePartnerGateConfig(gateConfig, gateOverrides);
  const profileFromRow = parseProfileData(row.profileData);
  const strategyTags = parseStrategyTags(row.strategyTags);
  const profileData = {
    fundName: profileFromRow.fundName,
    aumRange: profileFromRow.aumRange ?? (String(row.aumRange || "").trim() || null),
    hqLocation: profileFromRow.hqLocation ?? (String(row.hqLocation || "").trim() || null),
    strategyTags: profileFromRow.strategyTags.length ? profileFromRow.strategyTags : strategyTags,
    institutionProfile: profileFromRow.institutionProfile,
  };

  const inviteExpiresAt = row.inviteExpiresAt == null ? null : Number(row.inviteExpiresAt);
  const isInviteExpired =
    inviteStatus === "INVITED" && inviteExpiresAt != null && inviteExpiresAt < nowSec();

  const gateEval = PARTNER_GATE_KEYS.reduce((acc, gate) => {
    acc[gate] = evaluatePartnerGate({
      inviteStatus,
      onboardingStep,
      requiredLevel: effectiveGateConfig[gate],
      inviteExpiresAt,
    });
    return acc;
  }, {} as Record<PartnerGateKey, PartnerGateEval>);

  const rotationDays = Math.max(7, Math.min(365, Number(row.partnerPasswordRotationDays ?? 90) || 90));
  const reminderLogins = Math.max(1, Math.min(20, Number(row.partnerPasswordReminderLogins ?? 3) || 3));

  return {
    partnerId: Number(row.id),
    partnerName: String(row.name || ""),
    contactEmail: String(row.contactEmail || "").trim() || null,
    contactUsername: String(row.contactUsername || "").trim() || null,
    inviteStatus,
    onboardingStep,
    inviteExpiresAt,
    isInviteExpired,
    profileData,
    fundLogoUrl: String(row.fundLogoUrl || "").trim() || null,
    kybDocUrl: String(row.kybDocUrl || "").trim() || null,
    agreementsSignedAt: row.agreementsSignedAt == null ? null : Number(row.agreementsSignedAt),
    contactAccessRequestedAt:
      row.contactAccessRequestedAt == null ? null : Number(row.contactAccessRequestedAt),
    approvedAt: row.approvedAt == null ? null : Number(row.approvedAt),
    adminNotes: String(row.adminNotes || "").trim() || null,
    loginCount: Math.max(0, Number(row.loginCount ?? 0) || 0),
    passwordRotatedAt: row.passwordRotatedAt == null ? null : Number(row.passwordRotatedAt),
    gateConfig: effectiveGateConfig,
    gateOverrides,
    gateEval,
    progressPct: computeProgressPct(onboardingStep),
    passwordPolicy: {
      rotationDays,
      reminderLogins,
    },
  };
}

export async function resolvePartnerGateAccess(
  partnerId: number,
  gate: PartnerGateKey,
): Promise<{
  state: PartnerOnboardingState | null;
  eval: PartnerGateEval | null;
}> {
  const state = await resolvePartnerOnboardingState(partnerId);
  if (!state) return { state: null, eval: null };
  return { state, eval: state.gateEval[gate] };
}
