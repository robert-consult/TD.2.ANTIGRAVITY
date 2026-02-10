export const ISO2_COUNTRY_REGEX = /^[A-Z]{2}$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
export const LEI_CODE_REGEX = /^[A-Z0-9]{18}[0-9]{2}$/;
export const GENERIC_IDENTIFIER_REGEX = /^[A-Za-z0-9][A-Za-z0-9 ._/\-]{1,79}$/;
export const POSTAL_CODE_REGEX = /^[A-Za-z0-9][A-Za-z0-9 \-]{1,19}$/;
export const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;

export const PARTNER_ADDRESS_KIND_OPTIONS = [
  "HEAD_OFFICE",
  "REGISTERED",
  "MAILING",
  "OPERATIONS",
  "OTHER",
] as const;
export type PartnerAddressKind = (typeof PARTNER_ADDRESS_KIND_OPTIONS)[number];

export const PARTNER_CONTACT_CHANNEL_OPTIONS = ["EMAIL", "PHONE", "FAX"] as const;
export type PartnerContactChannel = (typeof PARTNER_CONTACT_CHANNEL_OPTIONS)[number];

export const PARTNER_ENTITY_TYPE_OPTIONS = [
  "HEDGE_FUND",
  "PROP_FIRM",
  "FAMILY_OFFICE",
  "ASSET_MANAGER",
  "RIA",
  "BROKER_DEALER",
  "BANK",
  "PENSION",
  "ENDOWMENT",
  "SOVEREIGN",
  "OTHER",
] as const;

export const PARTNER_EMPLOYEE_COUNT_RANGE_OPTIONS = [
  "1-10",
  "11-25",
  "26-50",
  "51-100",
  "101-250",
  "251-500",
  "500+",
] as const;

export type PartnerPhoneEntry = {
  label: string | null;
  countryIso2: string;
  numberE164: string;
  extension: string | null;
};

export type PartnerAddressEntry = {
  kind: PartnerAddressKind;
  line1: string;
  line2: string | null;
  city: string;
  stateRegion: string | null;
  postalCode: string | null;
  countryIso2: string;
};

export type PartnerPointOfContact = {
  fullName: string;
  title: string | null;
  department: string | null;
  email: string | null;
  phone: PartnerPhoneEntry | null;
  fax: PartnerPhoneEntry | null;
  location: string | null;
  preferredChannel: PartnerContactChannel | null;
  isPrimary: boolean;
};

export type PartnerServiceProviders = {
  primeBroker: string | null;
  fundAdministrator: string | null;
  auditor: string | null;
  custodian: string | null;
  legalCounsel: string | null;
  bankingPartner: string | null;
};

export type PartnerRegulatoryProfile = {
  regulatorNames: string[];
  secFileNumber: string | null;
  secExemptFileNumber: string | null;
  crdNumber: string | null;
  cikNumbers: string[];
  nfaId: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  lei: string | null;
};

export type PartnerInstitutionProfile = {
  legalEntityName: string | null;
  tradingName: string | null;
  entityType: string | null;
  domicileCountryIso2: string | null;
  incorporationCountryIso2: string | null;
  registrationCountriesIso2: string[];
  websiteUrl: string | null;
  socialProfiles: string[];
  businessDescription: string | null;
  baseCurrency: string | null;
  primaryTimezone: string | null;
  generalEmails: string[];
  phoneNumbers: PartnerPhoneEntry[];
  faxNumbers: PartnerPhoneEntry[];
  addresses: PartnerAddressEntry[];
  pointsOfContact: PartnerPointOfContact[];
  serviceProviders: PartnerServiceProviders;
  regulatory: PartnerRegulatoryProfile;
  operations: {
    inceptionYear: number | null;
    employeeCountRange: string | null;
    businessDays: string | null;
    businessHours: string | null;
  };
};

export const DEFAULT_PARTNER_INSTITUTION_PROFILE: PartnerInstitutionProfile = {
  legalEntityName: null,
  tradingName: null,
  entityType: null,
  domicileCountryIso2: null,
  incorporationCountryIso2: null,
  registrationCountriesIso2: [],
  websiteUrl: null,
  socialProfiles: [],
  businessDescription: null,
  baseCurrency: null,
  primaryTimezone: null,
  generalEmails: [],
  phoneNumbers: [],
  faxNumbers: [],
  addresses: [],
  pointsOfContact: [],
  serviceProviders: {
    primeBroker: null,
    fundAdministrator: null,
    auditor: null,
    custodian: null,
    legalCounsel: null,
    bankingPartner: null,
  },
  regulatory: {
    regulatorNames: [],
    secFileNumber: null,
    secExemptFileNumber: null,
    crdNumber: null,
    cikNumbers: [],
    nfaId: null,
    registrationNumber: null,
    taxId: null,
    lei: null,
  },
  operations: {
    inceptionYear: null,
    employeeCountRange: null,
    businessDays: null,
    businessHours: null,
  },
};

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeOptionalString(value: unknown, maxLen: number): string | null {
  const next = String(value ?? "").trim();
  if (!next) return null;
  return next.slice(0, maxLen);
}

export function normalizeIso2(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ISO2_COUNTRY_REGEX.test(normalized) ? normalized : null;
}

function normalizeStringArray(
  value: unknown,
  opts: {
    maxItems: number;
    maxLen: number;
    pattern?: RegExp;
    uppercase?: boolean;
  },
): string[] {
  const out: string[] = [];
  for (const entry of toArray(value)) {
    let text = String(entry ?? "").trim();
    if (!text) continue;
    if (opts.uppercase) text = text.toUpperCase();
    if (text.length > opts.maxLen) continue;
    if (opts.pattern && !opts.pattern.test(text)) continue;
    out.push(text);
    if (out.length >= opts.maxItems) break;
  }
  return out;
}

function normalizeEmail(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || text.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return null;
  return text;
}

function normalizeUrl(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text || text.length > 500) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePhoneEntry(value: unknown): PartnerPhoneEntry | null {
  const input = toRecord(value);
  const countryIso2 = normalizeIso2(input.countryIso2);
  const numberE164 = String(input.numberE164 ?? "").trim();
  if (!countryIso2 || !E164_PHONE_REGEX.test(numberE164)) return null;

  const extensionRaw = normalizeOptionalString(input.extension, 12);
  const extension = extensionRaw && /^\d{1,12}$/.test(extensionRaw) ? extensionRaw : null;

  return {
    label: normalizeOptionalString(input.label, 80),
    countryIso2,
    numberE164,
    extension,
  };
}

function normalizeAddressEntry(value: unknown): PartnerAddressEntry | null {
  const input = toRecord(value);
  const line1 = normalizeOptionalString(input.line1, 160);
  const city = normalizeOptionalString(input.city, 120);
  const countryIso2 = normalizeIso2(input.countryIso2);
  if (!line1 || !city || !countryIso2) return null;

  const kindCandidate = String(input.kind ?? "").trim().toUpperCase();
  const kind = PARTNER_ADDRESS_KIND_OPTIONS.includes(kindCandidate as PartnerAddressKind)
    ? (kindCandidate as PartnerAddressKind)
    : "OTHER";

  const postalCodeRaw = normalizeOptionalString(input.postalCode, 20);
  const postalCode = postalCodeRaw && POSTAL_CODE_REGEX.test(postalCodeRaw) ? postalCodeRaw : null;

  return {
    kind,
    line1,
    line2: normalizeOptionalString(input.line2, 160),
    city,
    stateRegion: normalizeOptionalString(input.stateRegion, 120),
    postalCode,
    countryIso2,
  };
}

function normalizePointOfContact(value: unknown): PartnerPointOfContact | null {
  const input = toRecord(value);
  const fullName = normalizeOptionalString(input.fullName, 120);
  if (!fullName) return null;

  const preferredCandidate = String(input.preferredChannel ?? "").trim().toUpperCase();
  const preferredChannel = PARTNER_CONTACT_CHANNEL_OPTIONS.includes(
    preferredCandidate as PartnerContactChannel,
  )
    ? (preferredCandidate as PartnerContactChannel)
    : null;

  return {
    fullName,
    title: normalizeOptionalString(input.title, 120),
    department: normalizeOptionalString(input.department, 120),
    email: normalizeEmail(input.email),
    phone: normalizePhoneEntry(input.phone),
    fax: normalizePhoneEntry(input.fax),
    location: normalizeOptionalString(input.location, 120),
    preferredChannel,
    isPrimary: Boolean(input.isPrimary),
  };
}

function normalizeServiceProviders(value: unknown): PartnerServiceProviders {
  const input = toRecord(value);
  return {
    primeBroker: normalizeOptionalString(input.primeBroker, 120),
    fundAdministrator: normalizeOptionalString(input.fundAdministrator, 120),
    auditor: normalizeOptionalString(input.auditor, 120),
    custodian: normalizeOptionalString(input.custodian, 120),
    legalCounsel: normalizeOptionalString(input.legalCounsel, 120),
    bankingPartner: normalizeOptionalString(input.bankingPartner, 120),
  };
}

function normalizeRegulatory(value: unknown): PartnerRegulatoryProfile {
  const input = toRecord(value);
  return {
    regulatorNames: normalizeStringArray(input.regulatorNames, { maxItems: 20, maxLen: 80 }),
    secFileNumber: normalizeOptionalString(input.secFileNumber, 64),
    secExemptFileNumber: normalizeOptionalString(input.secExemptFileNumber, 64),
    crdNumber: normalizeOptionalString(input.crdNumber, 64),
    cikNumbers: normalizeStringArray(input.cikNumbers, {
      maxItems: 10,
      maxLen: 12,
      pattern: /^\d{1,12}$/,
    }),
    nfaId: normalizeOptionalString(input.nfaId, 64),
    registrationNumber: normalizeOptionalString(input.registrationNumber, 64),
    taxId: normalizeOptionalString(input.taxId, 64),
    lei: (() => {
      const lei = String(input.lei ?? "").trim().toUpperCase();
      return LEI_CODE_REGEX.test(lei) ? lei : null;
    })(),
  };
}

function normalizeOperations(value: unknown): PartnerInstitutionProfile["operations"] {
  const input = toRecord(value);
  const nowYear = new Date().getUTCFullYear() + 1;
  const inceptionYearRaw = Number(input.inceptionYear);
  const inceptionYear =
    Number.isInteger(inceptionYearRaw) && inceptionYearRaw >= 1900 && inceptionYearRaw <= nowYear
      ? inceptionYearRaw
      : null;

  const employeeCountRangeRaw = normalizeOptionalString(input.employeeCountRange, 40);
  const employeeCountRange = employeeCountRangeRaw
    ? employeeCountRangeRaw
    : null;

  return {
    inceptionYear,
    employeeCountRange,
    businessDays: normalizeOptionalString(input.businessDays, 64),
    businessHours: normalizeOptionalString(input.businessHours, 64),
  };
}

export function normalizePartnerInstitutionProfile(raw: unknown): PartnerInstitutionProfile {
  const input = toRecord(raw);

  const pointsOfContact = toArray(input.pointsOfContact)
    .map((entry) => normalizePointOfContact(entry))
    .filter((entry): entry is PartnerPointOfContact => Boolean(entry))
    .slice(0, 25)
    .map((entry) => ({ ...entry }));

  if (pointsOfContact.length > 0) {
    const primaryIndex = pointsOfContact.findIndex((entry) => entry.isPrimary);
    if (primaryIndex === -1) {
      pointsOfContact[0].isPrimary = true;
    } else {
      pointsOfContact.forEach((entry, idx) => {
        entry.isPrimary = idx === primaryIndex;
      });
    }
  }

  return {
    legalEntityName: normalizeOptionalString(input.legalEntityName, 160),
    tradingName: normalizeOptionalString(input.tradingName, 160),
    entityType: normalizeOptionalString(input.entityType, 80),
    domicileCountryIso2: normalizeIso2(input.domicileCountryIso2),
    incorporationCountryIso2: normalizeIso2(input.incorporationCountryIso2),
    registrationCountriesIso2: normalizeStringArray(input.registrationCountriesIso2, {
      maxItems: 20,
      maxLen: 2,
      pattern: ISO2_COUNTRY_REGEX,
      uppercase: true,
    }),
    websiteUrl: normalizeUrl(input.websiteUrl),
    socialProfiles: normalizeStringArray(input.socialProfiles, { maxItems: 20, maxLen: 500 })
      .map((entry) => normalizeUrl(entry))
      .filter((entry): entry is string => Boolean(entry)),
    businessDescription: normalizeOptionalString(input.businessDescription, 1000),
    baseCurrency: (() => {
      const currency = String(input.baseCurrency ?? "").trim().toUpperCase();
      return CURRENCY_CODE_REGEX.test(currency) ? currency : null;
    })(),
    primaryTimezone: normalizeOptionalString(input.primaryTimezone, 80),
    generalEmails: normalizeStringArray(input.generalEmails, { maxItems: 30, maxLen: 254 })
      .map((entry) => normalizeEmail(entry))
      .filter((entry): entry is string => Boolean(entry)),
    phoneNumbers: toArray(input.phoneNumbers)
      .map((entry) => normalizePhoneEntry(entry))
      .filter((entry): entry is PartnerPhoneEntry => Boolean(entry))
      .slice(0, 20),
    faxNumbers: toArray(input.faxNumbers)
      .map((entry) => normalizePhoneEntry(entry))
      .filter((entry): entry is PartnerPhoneEntry => Boolean(entry))
      .slice(0, 10),
    addresses: toArray(input.addresses)
      .map((entry) => normalizeAddressEntry(entry))
      .filter((entry): entry is PartnerAddressEntry => Boolean(entry))
      .slice(0, 15),
    pointsOfContact,
    serviceProviders: normalizeServiceProviders(input.serviceProviders),
    regulatory: normalizeRegulatory(input.regulatory),
    operations: normalizeOperations(input.operations),
  };
}

export function createEmptyPartnerPhoneEntry(countryIso2 = "US"): PartnerPhoneEntry {
  return {
    label: null,
    countryIso2: normalizeIso2(countryIso2) ?? "US",
    numberE164: "",
    extension: null,
  };
}

export function createEmptyPartnerAddressEntry(countryIso2 = "US"): PartnerAddressEntry {
  return {
    kind: "HEAD_OFFICE",
    line1: "",
    line2: null,
    city: "",
    stateRegion: null,
    postalCode: null,
    countryIso2: normalizeIso2(countryIso2) ?? "US",
  };
}

export function createEmptyPartnerPointOfContact(countryIso2 = "US"): PartnerPointOfContact {
  return {
    fullName: "",
    title: null,
    department: null,
    email: null,
    phone: createEmptyPartnerPhoneEntry(countryIso2),
    fax: createEmptyPartnerPhoneEntry(countryIso2),
    location: null,
    preferredChannel: "EMAIL",
    isPrimary: false,
  };
}
