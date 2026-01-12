// @ts-nocheck
/**
 * Coverage Gate - Controls whether signup is blocked when terms unavailable
 * Uses Drizzle ORM with correct 4-part key structure
 */

import { and, eq, desc } from "drizzle-orm";
import { db } from "@db";
import { legalDocuments, legalDocPointers, systemConfig } from "../../shared/schema";
import { getJurisdictionRestrictionPolicy, getRegionForCountry, getCountriesInRegion, REGIONS } from "./regionRules";

export interface CoverageCheckResult {
  allowed: boolean;
  reason: string;
  countryCode: string;
  scopeKey: string | null;
  enforced: boolean;
  restricted: boolean;
  fallbackAvailable: boolean;
}

export interface CoverageStats {
  totalCountriesCovered: number;
  regionsCovered: string[];
  countriesWithExplicitTerms: string[];
  enforcementEnabled: boolean;
}

/**
 * Get enforcement toggle from systemConfig
 */
export async function isEnforcementEnabled(): Promise<boolean> {
  try {
    const [config] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    return !!config?.legalCoverageEnforce;
  } catch {
    return false;
  }
}

/**
 * Set enforcement toggle in systemConfig
 */
export async function setEnforcementEnabled(enabled: boolean): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  await db.update(systemConfig)
    .set({
      legalCoverageEnforce: enabled,
      updatedAt: nowSec,
    })
    .where(eq(systemConfig.id, 1));
}

/**
 * Check if an active target exists for a 4-part key
 */
async function hasActiveTarget(docSet: string, docType: string, jurisdictionType: string, jurisdictionKey: string): Promise<boolean> {
  const [pointer] = await db
    .select()
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, docSet),
        eq(legalDocPointers.docType, docType),
        eq(legalDocPointers.jurisdictionType, jurisdictionType),
        eq(legalDocPointers.jurisdictionKey, jurisdictionKey)
      )
    )
    .limit(1);

  if (!pointer?.activeDocumentId) return false;

  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, pointer.activeDocumentId)).limit(1);
  return !!doc;
}

/**
 * Check terms availability using precedence: COUNTRY → REGION → DEFAULT/ROW
 * 
 * NOTE: COUNTRY and REGION addenda are both considered "jurisdiction-specific" terms.
 * Only DEFAULT/ROW is considered a "fallback" because it's a generic global document.
 * This distinction matters for the UI: COUNTRY/REGION show "Jurisdiction Verified",
 * while DEFAULT/ROW shows "Using Global Terms".
 */
async function checkTermsAvailabilityInternal(countryCode: string): Promise<{
  available: boolean;
  scopeKey: string | null;
  fallback: boolean;
}> {
  const normalized = countryCode.toUpperCase();
  const regionKey = getRegionForCountry(normalized);

  // Check COUNTRY/{ISO2} first - jurisdiction-specific
  if (await hasActiveTarget("DOC1", "ADDENDUM", "COUNTRY", normalized)) {
    return { available: true, scopeKey: `COUNTRY/${normalized}`, fallback: false };
  }

  // Check REGION/{regionKey} if not ROW - also jurisdiction-specific (NOT a fallback)
  if (regionKey !== "ROW" && await hasActiveTarget("DOC1", "ADDENDUM", "REGION", regionKey)) {
    return { available: true, scopeKey: `REGION/${regionKey}`, fallback: false };
  }

  // Check DEFAULT/ROW as fallback - this IS a true fallback (generic global terms)
  if (await hasActiveTarget("DOC1", "ADDENDUM", "DEFAULT", "ROW")) {
    return { available: true, scopeKey: "DEFAULT/ROW", fallback: true };
  }

  return { available: false, scopeKey: null, fallback: false };
}

/**
 * Check if signup is allowed for a country
 */
export async function checkCoverage(countryCode: string): Promise<CoverageCheckResult> {
  const normalized = countryCode.toUpperCase();

  // Block restricted jurisdictions only when enabled in system config
  const jp = getJurisdictionRestrictionPolicy();
  if (jp.jurisdictionBlockSignup && jp.jurisdictionEnforceBySignupCountry && jp.countries.includes(normalized)) {
    return {
      allowed: false,
      reason: jp.message,
      countryCode: normalized,
      scopeKey: null,
      enforced: true,
      restricted: true,
      fallbackAvailable: false,
    };
  }

  // GLOBAL_MASTER is always required - check if it exists with active target
  const hasGlobal = await hasActiveTarget("DOC1", "GLOBAL_MASTER", "DEFAULT", "GLOBAL");
  const enforced = await isEnforcementEnabled();
  
  // Always require GLOBAL_MASTER, regardless of enforcement mode
  if (!hasGlobal) {
    return {
      allowed: false,
      reason: "Terms of service are not yet configured. Please check back later.",
      countryCode: normalized,
      scopeKey: null,
      enforced,
      restricted: false,
      fallbackAvailable: false,
    };
  }

  const availability = await checkTermsAvailabilityInternal(normalized);

  if (availability.available) {
    return {
      allowed: true,
      reason: availability.fallback
        ? "Using fallback terms for your jurisdiction."
        : "Terms available for your jurisdiction.",
      countryCode: normalized,
      scopeKey: availability.scopeKey,
      enforced,
      restricted: false,
      fallbackAvailable: availability.fallback,
    };
  }

  // Terms not available - check enforcement mode
  if (enforced) {
    return {
      allowed: false,
      reason: "Terms of service are not yet available for your jurisdiction. Please check back later.",
      countryCode: normalized,
      scopeKey: null,
      enforced: true,
      restricted: false,
      fallbackAvailable: false,
    };
  }

  // Not enforced - check if any documents exist at all before allowing
  // This prevents signup without any terms when enforcement is off
  const hasAnyGlobal = await hasActiveTarget("DOC1", "GLOBAL_MASTER", "DEFAULT", "GLOBAL");
  if (!hasAnyGlobal) {
    return {
      allowed: false,
      reason: "Terms of service are not yet configured. Please check back later.",
      countryCode: normalized,
      scopeKey: null,
      enforced: false,
      restricted: false,
      fallbackAvailable: false,
    };
  }
  
  // Global exists but no addendum - allow with warning (fallback to global only)
  return {
    allowed: true,
    reason: "Using global terms only. Region-specific terms may be added later.",
    countryCode: normalized,
    scopeKey: "DEFAULT/GLOBAL",
    enforced: false,
    restricted: false,
    fallbackAvailable: true,
  };
}

/**
 * Get coverage statistics for admin dashboard
 */
export async function getCoverageStats(): Promise<CoverageStats> {
  // Get all active pointers for DOC1 ADDENDUM
  const pointers = await db
    .select()
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, "DOC1"),
        eq(legalDocPointers.docType, "ADDENDUM")
      )
    )
    .filter((p) => p.activeDocumentId != null);

  const regionsCovered: string[] = [];
  const countriesWithExplicit: string[] = [];

  for (const p of pointers) {
    if (p.jurisdictionType === "REGION") {
      regionsCovered.push(p.jurisdictionKey);
    } else if (p.jurisdictionType === "COUNTRY") {
      countriesWithExplicit.push(p.jurisdictionKey);
    }
  }

  // Calculate total countries (explicit + region-covered)
  const regionCountries = regionsCovered.flatMap((r) => getCountriesInRegion(r as keyof typeof REGIONS));
  const allCountries = new Set([...countriesWithExplicit, ...regionCountries]);

  return {
    totalCountriesCovered: allCountries.size,
    regionsCovered,
    countriesWithExplicitTerms: countriesWithExplicit,
    enforcementEnabled: await isEnforcementEnabled(),
  };
}
