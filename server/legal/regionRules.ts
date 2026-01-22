/**
 * Region rules for legal document resolution
 * Maps ISO country codes to region keys for document assembly
 * Based on the RENDER_ENGINE specification with 4-part key structure
 * 
 * IMPORTANT: Countries with dedicated addenda are NOT in this map.
 * They resolve via COUNTRY/{ISO2} first, then fall to DEFAULT/ROW only.
 * This map is ONLY for regional fallback for countries WITHOUT dedicated addenda.
 */

import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { eq } from "drizzle-orm";
import { onLiveEvent } from "../services/liveBus";

// Region definitions matching database addenda jurisdiction_key values
// NOTE: Single-country "regions" like JAPAN, SOUTH_KOREA, PAKISTAN are removed
// because those countries should have COUNTRY/{ISO2} addenda, not REGION addenda
export const REGIONS = {
  MIDDLE_EAST: 'MIDDLE_EAST',
  NORTH_AFRICA: 'NORTH_AFRICA',
  WEST_AFRICA: 'WEST_AFRICA',
  EAST_AFRICA: 'EAST_AFRICA',
  SOUTHERN_AFRICA: 'SOUTHERN_AFRICA',
  CENTRAL_AFRICA: 'CENTRAL_AFRICA',
  SE_ASIA: 'SE_ASIA',
  WEST_EUROPE: 'WEST_EUROPE',
  EAST_EUROPE: 'EAST_EUROPE',
  NORTH_AMERICA: 'NORTH_AMERICA',
  CENTRAL_AMERICA: 'CENTRAL_AMERICA',
  SOUTH_AMERICA: 'SOUTH_AMERICA',
  CENTRAL_ASIA: 'CENTRAL_ASIA',
  AUSTRALASIA: 'AUSTRALASIA',
  PACIFIC_ISLANDS: 'PACIFIC_ISLANDS',
  INDIAN_OCEAN_ISLANDS: 'INDIAN_OCEAN_ISLANDS',
  ROW: 'ROW',
} as const;

export type RegionKey = typeof REGIONS[keyof typeof REGIONS];

// Countries with dedicated COUNTRY addenda - these are NOT in COUNTRY_TO_REGION
// They resolve: COUNTRY/{ISO2} → DEFAULT/ROW (no regional fallback)
const COUNTRIES_WITH_DEDICATED_ADDENDA = new Set([
  'US', 'GB', 'AE', 'IN', 'KE', 'NG', 'BD', 'TH', 'PH', 'SG', 'HK', 'CN',
  'BR', 'AR', 'CO', 'MX', 'ET', 'GH', 'AO', 'ZA', 'UG', 'TZ', 'RU', 'UA',
  'JP', 'KR', 'PK',
]);

// Country to region mapping - ONLY for countries WITHOUT dedicated addenda
// These countries fall back: COUNTRY/{ISO2} → REGION/{region} → DEFAULT/ROW
const COUNTRY_TO_REGION: Record<string, RegionKey> = {
  // Middle East (AE has dedicated addendum)
  BH: 'MIDDLE_EAST', IQ: 'MIDDLE_EAST', IL: 'MIDDLE_EAST', JO: 'MIDDLE_EAST',
  KW: 'MIDDLE_EAST', LB: 'MIDDLE_EAST', OM: 'MIDDLE_EAST', PS: 'MIDDLE_EAST',
  QA: 'MIDDLE_EAST', SA: 'MIDDLE_EAST', TR: 'MIDDLE_EAST', YE: 'MIDDLE_EAST',
  // Note: IR and SY are restricted countries
  
  // North Africa
  DZ: 'NORTH_AFRICA', EG: 'NORTH_AFRICA', LY: 'NORTH_AFRICA', MA: 'NORTH_AFRICA',
  SD: 'NORTH_AFRICA', SS: 'NORTH_AFRICA', TN: 'NORTH_AFRICA', EH: 'NORTH_AFRICA',
  
  // West Africa (NG, GH have dedicated addenda)
  BJ: 'WEST_AFRICA', BF: 'WEST_AFRICA', CV: 'WEST_AFRICA', CI: 'WEST_AFRICA',
  GM: 'WEST_AFRICA', GN: 'WEST_AFRICA', GW: 'WEST_AFRICA', LR: 'WEST_AFRICA',
  ML: 'WEST_AFRICA', MR: 'WEST_AFRICA', NE: 'WEST_AFRICA', SH: 'WEST_AFRICA',
  SL: 'WEST_AFRICA', SN: 'WEST_AFRICA', TG: 'WEST_AFRICA',
  
  // East Africa (KE, ET, UG, TZ have dedicated addenda)
  BI: 'EAST_AFRICA', DJ: 'EAST_AFRICA', ER: 'EAST_AFRICA', KM: 'EAST_AFRICA',
  MG: 'EAST_AFRICA', MW: 'EAST_AFRICA', MZ: 'EAST_AFRICA', RE: 'EAST_AFRICA',
  RW: 'EAST_AFRICA', SC: 'EAST_AFRICA', SO: 'EAST_AFRICA', YT: 'EAST_AFRICA',
  ZM: 'EAST_AFRICA', ZW: 'EAST_AFRICA',
  
  // Southern Africa (ZA, AO have dedicated addenda)
  BW: 'SOUTHERN_AFRICA', LS: 'SOUTHERN_AFRICA', NA: 'SOUTHERN_AFRICA', SZ: 'SOUTHERN_AFRICA',
  
  // Central Africa
  CF: 'CENTRAL_AFRICA', CG: 'CENTRAL_AFRICA', CD: 'CENTRAL_AFRICA', CM: 'CENTRAL_AFRICA',
  GQ: 'CENTRAL_AFRICA', GA: 'CENTRAL_AFRICA', ST: 'CENTRAL_AFRICA', TD: 'CENTRAL_AFRICA',
  
  // Southeast Asia (SG, TH, PH, CN, HK have dedicated addenda)
  BN: 'SE_ASIA', KH: 'SE_ASIA', ID: 'SE_ASIA', LA: 'SE_ASIA',
  MM: 'SE_ASIA', MY: 'SE_ASIA', TL: 'SE_ASIA', VN: 'SE_ASIA',
  TW: 'SE_ASIA', MO: 'SE_ASIA',
  
  // West Europe (GB has dedicated addendum)
  AT: 'WEST_EUROPE', BE: 'WEST_EUROPE', CH: 'WEST_EUROPE', DE: 'WEST_EUROPE', DK: 'WEST_EUROPE',
  ES: 'WEST_EUROPE', FI: 'WEST_EUROPE', FR: 'WEST_EUROPE', IE: 'WEST_EUROPE', IS: 'WEST_EUROPE',
  IT: 'WEST_EUROPE', LI: 'WEST_EUROPE', LU: 'WEST_EUROPE', MC: 'WEST_EUROPE', NL: 'WEST_EUROPE',
  NO: 'WEST_EUROPE', PT: 'WEST_EUROPE', SE: 'WEST_EUROPE',
  
  // East Europe (RU, UA have dedicated addenda)
  AL: 'EAST_EUROPE', BA: 'EAST_EUROPE', BG: 'EAST_EUROPE', BY: 'EAST_EUROPE', CZ: 'EAST_EUROPE',
  EE: 'EAST_EUROPE', GR: 'EAST_EUROPE', HR: 'EAST_EUROPE', HU: 'EAST_EUROPE', LT: 'EAST_EUROPE',
  LV: 'EAST_EUROPE', MD: 'EAST_EUROPE', ME: 'EAST_EUROPE', MK: 'EAST_EUROPE', PL: 'EAST_EUROPE',
  RO: 'EAST_EUROPE', RS: 'EAST_EUROPE', SI: 'EAST_EUROPE', SK: 'EAST_EUROPE', XK: 'EAST_EUROPE',
  
  // North America (US has dedicated addendum)
  CA: 'NORTH_AMERICA', GL: 'NORTH_AMERICA', PM: 'NORTH_AMERICA', BM: 'NORTH_AMERICA',
  
  // Central America (MX has dedicated addendum)
  BZ: 'CENTRAL_AMERICA', CR: 'CENTRAL_AMERICA', GT: 'CENTRAL_AMERICA', HN: 'CENTRAL_AMERICA',
  NI: 'CENTRAL_AMERICA', PA: 'CENTRAL_AMERICA', SV: 'CENTRAL_AMERICA',
  
  // South America (BR, AR, CO have dedicated addenda)
  BO: 'SOUTH_AMERICA', CL: 'SOUTH_AMERICA', EC: 'SOUTH_AMERICA', GF: 'SOUTH_AMERICA',
  GY: 'SOUTH_AMERICA', PE: 'SOUTH_AMERICA', PY: 'SOUTH_AMERICA', SR: 'SOUTH_AMERICA',
  UY: 'SOUTH_AMERICA', VE: 'SOUTH_AMERICA',
  
  // Central Asia
  KZ: 'CENTRAL_ASIA', KG: 'CENTRAL_ASIA', TJ: 'CENTRAL_ASIA', TM: 'CENTRAL_ASIA',
  UZ: 'CENTRAL_ASIA', AF: 'CENTRAL_ASIA',
  
  // Australasia
  AU: 'AUSTRALASIA', NZ: 'AUSTRALASIA',
  
  // Pacific Islands
  FJ: 'PACIFIC_ISLANDS', FM: 'PACIFIC_ISLANDS', KI: 'PACIFIC_ISLANDS', MH: 'PACIFIC_ISLANDS',
  NR: 'PACIFIC_ISLANDS', NU: 'PACIFIC_ISLANDS', PF: 'PACIFIC_ISLANDS', PG: 'PACIFIC_ISLANDS',
  PW: 'PACIFIC_ISLANDS', SB: 'PACIFIC_ISLANDS', TO: 'PACIFIC_ISLANDS', TV: 'PACIFIC_ISLANDS',
  VU: 'PACIFIC_ISLANDS', WS: 'PACIFIC_ISLANDS', CK: 'PACIFIC_ISLANDS',
  
  // Indian Ocean Islands
  MU: 'INDIAN_OCEAN_ISLANDS', MV: 'INDIAN_OCEAN_ISLANDS', IO: 'INDIAN_OCEAN_ISLANDS',
};

/**
 * Check if a country has a dedicated COUNTRY addendum
 */
export function hasCountryAddendum(countryCode: string): boolean {
  return COUNTRIES_WITH_DEDICATED_ADDENDA.has(countryCode.toUpperCase());
}

/**
 * Get region key for a country
 * Returns the region for fallback document resolution
 * Countries with dedicated addenda return ROW (no regional fallback)
 */
export function getRegionForCountry(countryCode: string): RegionKey {
  const normalized = countryCode.toUpperCase();
  if (COUNTRIES_WITH_DEDICATED_ADDENDA.has(normalized)) {
    return 'ROW';
  }
  return COUNTRY_TO_REGION[normalized] || 'ROW';
}

/**
 * Get all countries in a region
 */
export function getCountriesInRegion(region: RegionKey): string[] {
  return Object.entries(COUNTRY_TO_REGION)
    .filter(([_, r]) => r === region)
    .map(([country]) => country);
}

/**
 * Build scope keys for document resolution in precedence order
 * Countries with dedicated addenda: [COUNTRY/{ISO2}, DEFAULT/ROW]
 * Countries without: [COUNTRY/{ISO2}, REGION/{region}, DEFAULT/ROW]
 */
export function buildScopeKeys(countryCode: string): string[] {
  const normalized = countryCode.toUpperCase();
  const keys: string[] = [];
  
  keys.push(`COUNTRY/${normalized}`);
  
  if (!COUNTRIES_WITH_DEDICATED_ADDENDA.has(normalized)) {
    const region = COUNTRY_TO_REGION[normalized];
    if (region) {
      keys.push(`REGION/${region}`);
    }
  }
  
  keys.push('DEFAULT/ROW');
  
  return keys;
}

/**
 * Check if a country is restricted (cannot use platform)
 * Based on OFAC/sanctions lists
 */
const DEFAULT_RESTRICTED_ISO2 = ["KP", "IR", "CU", "SY"];
const DEFAULT_RESTRICTED_MESSAGE = "This jurisdiction is not supported due to regulatory restrictions.";
const RESTRICTED_CONFIG_CACHE_TTL_MS = 60_000;

export type JurisdictionRestrictionPolicy = {
  countries: string[];
  message: string;
  jurisdictionBlockSignup: boolean;
  jurisdictionBlockLogin: boolean;
  jurisdictionEnforceByIpGeo: boolean;
  jurisdictionEnforceBySignupCountry: boolean;
};

let cachedJurisdictionPolicy: (JurisdictionRestrictionPolicy & { fetchedAtMs: number }) | null = null;
let refreshPolicyPromise: Promise<JurisdictionRestrictionPolicy> | null = null;

export function invalidateJurisdictionRestrictionPolicyCache() {
  cachedJurisdictionPolicy = null;
  refreshPolicyPromise = null;
}

// Multi-node: invalidate cached policy across all instances when admin updates system config.
onLiveEvent((event) => {
  if (!event || typeof event !== "object") return;
  if (event.type === "jurisdiction-policy:invalidate" || event.type === "system-config:updated") {
    invalidateJurisdictionRestrictionPolicyCache();
  }
});

export function parseRestrictedCountriesCsv(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_RESTRICTED_ISO2];
  const parts = String(raw)
    .split(/[,;\n\r\t ]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const codes: string[] = [];
  for (const part of parts) {
    const code = part.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) continue;
    codes.push(code);
  }

  return Array.from(new Set(codes));
}

async function loadJurisdictionRestrictionPolicy(): Promise<JurisdictionRestrictionPolicy> {
  const row = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });
  const countries = parseRestrictedCountriesCsv((row as any)?.jurisdictionRestrictedIso2Csv);
  const message = String((row as any)?.jurisdictionRestrictedMessage ?? DEFAULT_RESTRICTED_MESSAGE);

  return {
    countries,
    message,
    jurisdictionBlockSignup: Boolean((row as any)?.jurisdictionBlockSignup ?? true),
    jurisdictionBlockLogin: Boolean((row as any)?.jurisdictionBlockLogin ?? true),
    jurisdictionEnforceByIpGeo: Boolean((row as any)?.jurisdictionEnforceByIpGeo ?? false),
    jurisdictionEnforceBySignupCountry: Boolean((row as any)?.jurisdictionEnforceBySignupCountry ?? true),
  };
}

export function getJurisdictionRestrictionPolicy(): JurisdictionRestrictionPolicy {
  const now = Date.now();
  if (cachedJurisdictionPolicy && now - cachedJurisdictionPolicy.fetchedAtMs < RESTRICTED_CONFIG_CACHE_TTL_MS) {
    const { fetchedAtMs, ...rest } = cachedJurisdictionPolicy;
    return rest;
  }

  void refreshJurisdictionRestrictionPolicy();
  if (cachedJurisdictionPolicy) {
    const { fetchedAtMs, ...rest } = cachedJurisdictionPolicy;
    return rest;
  }

  return {
    countries: [...DEFAULT_RESTRICTED_ISO2],
    message: DEFAULT_RESTRICTED_MESSAGE,
    jurisdictionBlockSignup: true,
    jurisdictionBlockLogin: true,
    jurisdictionEnforceByIpGeo: false,
    jurisdictionEnforceBySignupCountry: true,
  };
}

export async function refreshJurisdictionRestrictionPolicy(): Promise<JurisdictionRestrictionPolicy> {
  if (!refreshPolicyPromise) {
    refreshPolicyPromise = loadJurisdictionRestrictionPolicy()
      .then((policy) => {
        cachedJurisdictionPolicy = { ...policy, fetchedAtMs: Date.now() };
        return policy;
      })
      .finally(() => {
        refreshPolicyPromise = null;
      });
  }
  return refreshPolicyPromise;
}

export function getRestrictedCountryPolicy(): { countries: string[]; message: string } {
  const p = getJurisdictionRestrictionPolicy();
  return { countries: p.countries, message: p.message };
}

export function isRestrictedCountry(countryCode: string): boolean {
  const { countries } = getRestrictedCountryPolicy();
  return countries.includes(countryCode.toUpperCase());
}

export const REGION_RULES_IN_ORDER = Object.entries(COUNTRY_TO_REGION).map(([iso, region]) => ({
  regionKey: region,
  countryIso2: iso
})).sort((a, b) => a.countryIso2.localeCompare(b.countryIso2));
