import { db } from "@db";
import { signupJurisdictionBlocks } from "@shared/schema";
import { getJurisdictionRestrictionPolicy } from "../legal/regionRules";

export type JurisdictionBlockReasonCode =
  | "JURISDICTION_RESTRICTED_IP_GEO"
  | "JURISDICTION_RESTRICTED_SELECTED"
  | "JURISDICTION_RESTRICTED_BOTH";

export type JurisdictionDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "JURISDICTION_RESTRICTED";
      httpStatus: 403;
      message: string;
      reasonCode: JurisdictionBlockReasonCode;
      blockedBy: Array<"IP_GEO" | "COUNTRY_SELECTED">;
      ipCountryIso2?: string;
      selectedCountryIso2?: string;
    };

function normIso2(v: unknown): string | undefined {
  const s = String(v ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

export function evaluateSignupJurisdiction(args: {
  ipCountryIso2?: string | null;
  selectedCountryIso2?: string | null;
}): JurisdictionDecision {
  const policy = getJurisdictionRestrictionPolicy();
  if (!policy.jurisdictionBlockSignup) return { allowed: true };

  const restricted = new Set(policy.countries.map((c) => String(c).trim().toUpperCase()));
  const blockedBy: Array<"IP_GEO" | "COUNTRY_SELECTED"> = [];

  const ip = normIso2(args.ipCountryIso2);
  const sel = normIso2(args.selectedCountryIso2);

  if (policy.jurisdictionEnforceByIpGeo && ip && restricted.has(ip)) blockedBy.push("IP_GEO");
  if (policy.jurisdictionEnforceBySignupCountry && sel && restricted.has(sel)) blockedBy.push("COUNTRY_SELECTED");

  if (!blockedBy.length) return { allowed: true };

  const reasonCode: JurisdictionBlockReasonCode =
    blockedBy.length === 2
      ? "JURISDICTION_RESTRICTED_BOTH"
      : blockedBy[0] === "IP_GEO"
        ? "JURISDICTION_RESTRICTED_IP_GEO"
        : "JURISDICTION_RESTRICTED_SELECTED";

  return {
    allowed: false,
    code: "JURISDICTION_RESTRICTED",
    httpStatus: 403,
    message: policy.message,
    reasonCode,
    blockedBy,
    ipCountryIso2: ip,
    selectedCountryIso2: sel,
  };
}

export function evaluateLoginJurisdiction(args: {
  ipCountryIso2?: string | null;
  userCountryIso2?: string | null;
}): JurisdictionDecision {
  const policy = getJurisdictionRestrictionPolicy();
  if (!policy.jurisdictionBlockLogin) return { allowed: true };

  const restricted = new Set(policy.countries.map((c) => String(c).trim().toUpperCase()));
  const blockedBy: Array<"IP_GEO" | "COUNTRY_SELECTED"> = [];

  const ip = normIso2(args.ipCountryIso2);
  const usr = normIso2(args.userCountryIso2);

  if (policy.jurisdictionEnforceByIpGeo && ip && restricted.has(ip)) blockedBy.push("IP_GEO");
  if (policy.jurisdictionEnforceBySignupCountry && usr && restricted.has(usr)) blockedBy.push("COUNTRY_SELECTED");

  if (!blockedBy.length) return { allowed: true };

  const reasonCode: JurisdictionBlockReasonCode =
    blockedBy.length === 2
      ? "JURISDICTION_RESTRICTED_BOTH"
      : blockedBy[0] === "IP_GEO"
        ? "JURISDICTION_RESTRICTED_IP_GEO"
        : "JURISDICTION_RESTRICTED_SELECTED";

  return {
    allowed: false,
    code: "JURISDICTION_RESTRICTED",
    httpStatus: 403,
    message: policy.message,
    reasonCode,
    blockedBy,
    ipCountryIso2: ip,
    selectedCountryIso2: usr,
  };
}

export async function recordSignupJurisdictionBlock(args: {
  email?: string | null;
  username?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  ipCountryIso2?: string | null;
  selectedCountryIso2?: string | null;
  reasonCode: JurisdictionBlockReasonCode;
  policySnapshot?: any;
  createdAtSec: number;
}) {
  try {
    const email = args.email ? String(args.email) : null;

    await db.insert(signupJurisdictionBlocks).values({
      email,
      emailLower: email ? email.toLowerCase() : null,
      username: args.username ? String(args.username) : null,
      ip: args.ip ? String(args.ip) : null,
      userAgent: args.userAgent ? String(args.userAgent) : null,
      ipCountryIso2: normIso2(args.ipCountryIso2) ?? null,
      selectedCountryIso2: normIso2(args.selectedCountryIso2) ?? null,
      reasonCode: args.reasonCode,
      policySnapshotJson: args.policySnapshot != null ? JSON.stringify(args.policySnapshot) : null,
      createdAt: args.createdAtSec,
    });
  } catch (e) {
    console.warn("[Jurisdiction] Failed to record signup jurisdiction block:", e);
  }
}
