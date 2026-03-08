import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useMailboxE2eeBootstrap } from "@/hooks/use-mailbox";
import { ensureMailboxE2eeKey, encryptTextForMailboxRecipients } from "@/lib/e2ee";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PartnerProfileWizard from "@/components/partner/PartnerProfileWizard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FeatureErrorBoundary } from "@/components/app/FeatureErrorBoundary";
import { PartnerPortalTabs } from "@/pages/partner-portal/PartnerPortalTabs";
import {
  DEFAULT_PARTNER_INSTITUTION_PROFILE,
  E164_PHONE_REGEX,
  ISO2_COUNTRY_REGEX,
  PARTNER_ADDRESS_KIND_OPTIONS,
  PARTNER_CONTACT_CHANNEL_OPTIONS,
  PARTNER_EMPLOYEE_COUNT_RANGE_OPTIONS,
  PARTNER_ENTITY_TYPE_OPTIONS,
  createEmptyPartnerAddressEntry,
  createEmptyPartnerPhoneEntry,
  createEmptyPartnerPointOfContact,
  type PartnerAddressEntry,
  type PartnerInstitutionProfile,
  type PartnerPhoneEntry,
  type PartnerPointOfContact,
} from "@shared/partnerProfile";
import {
  Beaker,
  Building2,
  FileCheck2,
  FolderKanban,
  Globe2,
  Landmark,
  MapPinned,
  MessageSquareLock,
  Scale,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { formatUnixSecondsToLocaleString } from "@shared/time/format";

type PartnerConfigResp = {
  ok: boolean;
  config?: {
    partnerPortalEnabled?: boolean;
    partnerAllocationsEnabled?: boolean;
  };
};

type CountriesResp = {
  rows: Array<{ code: string; name: string }>;
};

type DataRoomRow = {
  hashId: string;
  styleCluster: string | null;
  metrics: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    equityCurveR2: number | null;
    avgMae: number | null;
    avgMfe: number | null;
    compositeScore: number | null;
    calculatedAt: number | null;
  };
  performance: {
    trades: number;
    netProfit: number;
    winRate: number;
  };
};

type DataRoomResp = {
  ok: boolean;
  total: number;
  hasMore: boolean;
  results: DataRoomRow[];
};

type TearSheetResp = {
  ok: boolean;
  hashId: string;
  days: number;
  summary: {
    trades: number;
    netProfit: number;
    winRate: number;
  };
  metrics: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    calmarRatio: number | null;
    equityCurveR2: number | null;
    avgMae: number | null;
    avgMfe: number | null;
    styleCluster: string | null;
    compositeScore: number | null;
    calculatedAt: number | null;
  } | null;
  topTrades: Array<{ id: number; symbol: string | null; pnlUsd: number; returnPct: number | null }>;
  bottomTrades: Array<{ id: number; symbol: string | null; pnlUsd: number; returnPct: number | null }>;
};

type AllocationRow = {
  id: number;
  userHashId: string;
  capitalUsd: number;
  shadowStopPct: number | null;
  status: "ACTIVE" | "STOPPED" | "CLOSED";
  currentPnlUsd: number | null;
  createdAt: number;
  updatedAt: number;
};

type AllocationResp = {
  ok: boolean;
  total: number;
  rows: AllocationRow[];
};

type InquiryRow = {
  id: number;
  userHashId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  subject: string;
  body: string;
  status: string;
  mailboxThreadId: number | null;
  createdAt: number;
};

type InquiryResp = {
  ok: boolean;
  total: number;
  rows: InquiryRow[];
};

type InquiryRecipientRow = {
  userId: number;
  mailboxPublicKey: string | null;
  mailboxPublicKeyAlgo: string | null;
  routeRecipient: boolean;
  viewerRecipient: boolean;
};

type InquiryRecipientResp = {
  ok: boolean;
  inboxAlias: string;
  routeAdminCount: number;
  viewerAdminCount: number;
  participantCount: number;
  missingKeyCount: number;
  missingKeyAdminIds: number[];
  rows: InquiryRecipientRow[];
};

type PartnerGateEval = {
  allowed: boolean;
  reason: string | null;
  requiredLevel: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
  currentLevel: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
};

type PartnerOnboardingResp = {
  ok: boolean;
  state: {
    partnerId: number;
    partnerName: string;
    contactEmail: string | null;
    contactUsername: string | null;
    inviteStatus: string;
    onboardingStep: "PROFILE" | "IDENTITY" | "LEGAL" | "WAITING_APPROVAL" | "COMPLETED";
    inviteExpiresAt: number | null;
    isInviteExpired: boolean;
    profileData: {
      fundName: string | null;
      aumRange: string | null;
      hqLocation: string | null;
      strategyTags: string[];
      institutionProfile?: PartnerInstitutionProfile | null;
    };
    fundLogoUrl: string | null;
    kybDocUrl: string | null;
    agreementsSignedAt: number | null;
    contactAccessRequestedAt: number | null;
    approvedAt: number | null;
    adminNotes: string | null;
    loginCount: number;
    passwordRotatedAt: number | null;
    progressPct: number;
    gates: {
      viewDataRoom: boolean;
      runSimulations: boolean;
      requestAllocation: boolean;
      directContact: boolean;
    };
    gateEval: {
      viewDataRoom: PartnerGateEval;
      runSimulations: PartnerGateEval;
      requestAllocation: PartnerGateEval;
      directContact: PartnerGateEval;
    };
    gateConfig: {
      viewDataRoom: string;
      runSimulations: string;
      requestAllocation: string;
      directContact: string;
    };
    passwordPolicy: {
      rotationDays: number;
      reminderLogins: number;
    };
  };
};

type SimulationPreviewResp = {
  ok: boolean;
  preview: {
    userHashId: string;
    horizonDays: number;
    inputNotionalUsd: number;
    historical: {
      trades: number;
      netProfitUsd: number;
      winRate: number;
      avgReturnPct: number;
      sharpeRatio: number | null;
      sortinoRatio: number | null;
      calmarRatio: number | null;
      avgMae: number | null;
      compositeScore: number | null;
      calculatedAt: number | null;
    };
    scenario: {
      projectedPnlUsd: number;
      projectedPnlPct: number;
      confidence: number;
      riskBand: "LOW" | "MEDIUM" | "HIGH";
      modelVersion: string;
    };
  };
};

const partnerGateEvalSchema: z.ZodType<PartnerGateEval> = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  requiredLevel: z.enum(["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"]),
  currentLevel: z.enum(["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"]),
});

const partnerConfigRespSchema: z.ZodType<PartnerConfigResp> = z.object({
  ok: z.boolean(),
  config: z
    .object({
      partnerPortalEnabled: z.boolean().optional(),
      partnerAllocationsEnabled: z.boolean().optional(),
    })
    .optional(),
});

const countriesRespSchema: z.ZodType<CountriesResp> = z.object({
  rows: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
    }),
  ),
});

const dataRoomRowSchema: z.ZodType<DataRoomRow> = z.object({
  hashId: z.string(),
  styleCluster: z.string().nullable(),
  metrics: z.object({
    sharpeRatio: z.number().nullable(),
    sortinoRatio: z.number().nullable(),
    calmarRatio: z.number().nullable(),
    equityCurveR2: z.number().nullable(),
    avgMae: z.number().nullable(),
    avgMfe: z.number().nullable(),
    compositeScore: z.number().nullable(),
    calculatedAt: z.number().nullable(),
  }),
  performance: z.object({
    trades: z.number(),
    netProfit: z.number(),
    winRate: z.number(),
  }),
});

const dataRoomRespSchema: z.ZodType<DataRoomResp> = z.object({
  ok: z.boolean(),
  total: z.number(),
  hasMore: z.boolean(),
  results: z.array(dataRoomRowSchema),
});

const tearSheetRespSchema: z.ZodType<TearSheetResp> = z.object({
  ok: z.boolean(),
  hashId: z.string(),
  days: z.number(),
  summary: z.object({
    trades: z.number(),
    netProfit: z.number(),
    winRate: z.number(),
  }),
  metrics: z
    .object({
      sharpeRatio: z.number().nullable(),
      sortinoRatio: z.number().nullable(),
      calmarRatio: z.number().nullable(),
      equityCurveR2: z.number().nullable(),
      avgMae: z.number().nullable(),
      avgMfe: z.number().nullable(),
      styleCluster: z.string().nullable(),
      compositeScore: z.number().nullable(),
      calculatedAt: z.number().nullable(),
    })
    .nullable(),
  topTrades: z.array(
    z.object({
      id: z.number(),
      symbol: z.string().nullable(),
      pnlUsd: z.number(),
      returnPct: z.number().nullable(),
    }),
  ),
  bottomTrades: z.array(
    z.object({
      id: z.number(),
      symbol: z.string().nullable(),
      pnlUsd: z.number(),
      returnPct: z.number().nullable(),
    }),
  ),
});

const allocationRespSchema: z.ZodType<AllocationResp> = z.object({
  ok: z.boolean(),
  total: z.number(),
  rows: z.array(
    z.object({
      id: z.number(),
      userHashId: z.string(),
      capitalUsd: z.number(),
      shadowStopPct: z.number().nullable(),
      status: z.enum(["ACTIVE", "STOPPED", "CLOSED"]),
      currentPnlUsd: z.number().nullable(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
});

const inquiryRespSchema: z.ZodType<InquiryResp> = z.object({
  ok: z.boolean(),
  total: z.number(),
  rows: z.array(
    z.object({
      id: z.number(),
      userHashId: z.string().nullable(),
      senderName: z.string().nullable(),
      senderEmail: z.string().nullable(),
      subject: z.string(),
      body: z.string(),
      status: z.string(),
      mailboxThreadId: z.number().nullable(),
      createdAt: z.number(),
    }),
  ),
});

const inquiryRecipientRespSchema: z.ZodType<InquiryRecipientResp> = z.object({
  ok: z.boolean(),
  inboxAlias: z.string(),
  routeAdminCount: z.number(),
  viewerAdminCount: z.number(),
  participantCount: z.number(),
  missingKeyCount: z.number(),
  missingKeyAdminIds: z.array(z.number()),
  rows: z.array(
    z.object({
      userId: z.number(),
      mailboxPublicKey: z.string().nullable(),
      mailboxPublicKeyAlgo: z.string().nullable(),
      routeRecipient: z.boolean(),
      viewerRecipient: z.boolean(),
    }),
  ),
});

const partnerOnboardingRespSchema: z.ZodType<PartnerOnboardingResp> = z.object({
  ok: z.boolean(),
  state: z.object({
    partnerId: z.number(),
    partnerName: z.string(),
    contactEmail: z.string().nullable(),
    contactUsername: z.string().nullable(),
    inviteStatus: z.string(),
    onboardingStep: z.enum(["PROFILE", "IDENTITY", "LEGAL", "WAITING_APPROVAL", "COMPLETED"]),
    inviteExpiresAt: z.number().nullable(),
    isInviteExpired: z.boolean(),
    profileData: z.object({
      fundName: z.string().nullable(),
      aumRange: z.string().nullable(),
      hqLocation: z.string().nullable(),
      strategyTags: z.array(z.string()),
      institutionProfile: z
        .custom<PartnerInstitutionProfile | null | undefined>(
          (value) => value == null || (typeof value === "object" && !Array.isArray(value)),
        )
        .optional(),
    }),
    fundLogoUrl: z.string().nullable(),
    kybDocUrl: z.string().nullable(),
    agreementsSignedAt: z.number().nullable(),
    contactAccessRequestedAt: z.number().nullable(),
    approvedAt: z.number().nullable(),
    adminNotes: z.string().nullable(),
    loginCount: z.number(),
    passwordRotatedAt: z.number().nullable(),
    progressPct: z.number(),
    gates: z.object({
      viewDataRoom: z.boolean(),
      runSimulations: z.boolean(),
      requestAllocation: z.boolean(),
      directContact: z.boolean(),
    }),
    gateEval: z.object({
      viewDataRoom: partnerGateEvalSchema,
      runSimulations: partnerGateEvalSchema,
      requestAllocation: partnerGateEvalSchema,
      directContact: partnerGateEvalSchema,
    }),
    gateConfig: z.object({
      viewDataRoom: z.string(),
      runSimulations: z.string(),
      requestAllocation: z.string(),
      directContact: z.string(),
    }),
    passwordPolicy: z.object({
      rotationDays: z.number(),
      reminderLogins: z.number(),
    }),
  }),
});

const simulationPreviewRespSchema: z.ZodType<SimulationPreviewResp> = z.object({
  ok: z.boolean(),
  preview: z.object({
    userHashId: z.string(),
    horizonDays: z.number(),
    inputNotionalUsd: z.number(),
    historical: z.object({
      trades: z.number(),
      netProfitUsd: z.number(),
      winRate: z.number(),
      avgReturnPct: z.number(),
      sharpeRatio: z.number().nullable(),
      sortinoRatio: z.number().nullable(),
      calmarRatio: z.number().nullable(),
      avgMae: z.number().nullable(),
      compositeScore: z.number().nullable(),
      calculatedAt: z.number().nullable(),
    }),
    scenario: z.object({
      projectedPnlUsd: z.number(),
      projectedPnlPct: z.number(),
      confidence: z.number(),
      riskBand: z.enum(["LOW", "MEDIUM", "HIGH"]),
      modelVersion: z.string(),
    }),
  }),
});

const inviteRedeemRespSchema = z.object({
  ok: z.boolean(),
  partnerName: z.string(),
  apiKey: z.string().min(1),
  warning: z.string().optional(),
});

function parseApiPayload<T>(schema: z.ZodType<T>, data: unknown, messageCode: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new Error(messageCode);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWhen(utcSec: number | null | undefined): string {
  return formatUnixSecondsToLocaleString(utcSec);
}

function readApiErrorCode(error: unknown): string | null {
  if (!error) return null;
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.message;
    if (typeof code === "string" && code.trim().length > 0) return code.trim();
    if (typeof error.message === "string" && error.message.trim().length > 0) return error.message.trim();
    return null;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return null;
}

function trimToNull(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length ? normalized : null;
}

function normalizeIso2Input(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ISO2_COUNTRY_REGEX.test(normalized) ? normalized : "";
}

function normalizeListValues(values: string[], opts?: { lowercase?: boolean }): string[] {
  const out: string[] = [];
  for (const value of values) {
    let next = String(value ?? "").trim();
    if (!next) continue;
    if (opts?.lowercase) next = next.toLowerCase();
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

function clonePhoneEntry(entry: PartnerPhoneEntry): PartnerPhoneEntry {
  return {
    label: entry.label ?? null,
    countryIso2: normalizeIso2Input(entry.countryIso2) || "US",
    numberE164: String(entry.numberE164 ?? "").trim(),
    extension: entry.extension ?? null,
  };
}

function cloneAddressEntry(entry: PartnerAddressEntry): PartnerAddressEntry {
  return {
    kind: PARTNER_ADDRESS_KIND_OPTIONS.includes(entry.kind) ? entry.kind : "HEAD_OFFICE",
    line1: String(entry.line1 ?? ""),
    line2: entry.line2 ?? null,
    city: String(entry.city ?? ""),
    stateRegion: entry.stateRegion ?? null,
    postalCode: entry.postalCode ?? null,
    countryIso2: normalizeIso2Input(entry.countryIso2) || "US",
  };
}

function clonePointOfContact(entry: PartnerPointOfContact): PartnerPointOfContact {
  return {
    fullName: String(entry.fullName ?? ""),
    title: entry.title ?? null,
    department: entry.department ?? null,
    email: entry.email ?? null,
    phone: entry.phone ? clonePhoneEntry(entry.phone) : createEmptyPartnerPhoneEntry("US"),
    fax: entry.fax ? clonePhoneEntry(entry.fax) : createEmptyPartnerPhoneEntry("US"),
    location: entry.location ?? null,
    preferredChannel: entry.preferredChannel ?? "EMAIL",
    isPrimary: Boolean(entry.isPrimary),
  };
}

function cloneInstitutionProfile(profile: PartnerInstitutionProfile | null | undefined): PartnerInstitutionProfile {
  const src = profile ?? DEFAULT_PARTNER_INSTITUTION_PROFILE;
  return {
    legalEntityName: src.legalEntityName ?? null,
    tradingName: src.tradingName ?? null,
    entityType: src.entityType ?? null,
    domicileCountryIso2: src.domicileCountryIso2 ?? null,
    incorporationCountryIso2: src.incorporationCountryIso2 ?? null,
    registrationCountriesIso2: [...(src.registrationCountriesIso2 ?? [])],
    websiteUrl: src.websiteUrl ?? null,
    socialProfiles: [...(src.socialProfiles ?? [])],
    businessDescription: src.businessDescription ?? null,
    baseCurrency: src.baseCurrency ?? null,
    primaryTimezone: src.primaryTimezone ?? null,
    generalEmails: [...(src.generalEmails ?? [])],
    phoneNumbers: (src.phoneNumbers ?? []).map((entry) => clonePhoneEntry(entry)),
    faxNumbers: (src.faxNumbers ?? []).map((entry) => clonePhoneEntry(entry)),
    addresses: (src.addresses ?? []).map((entry) => cloneAddressEntry(entry)),
    pointsOfContact: (src.pointsOfContact ?? []).map((entry) => clonePointOfContact(entry)),
    serviceProviders: {
      primeBroker: src.serviceProviders?.primeBroker ?? null,
      fundAdministrator: src.serviceProviders?.fundAdministrator ?? null,
      auditor: src.serviceProviders?.auditor ?? null,
      custodian: src.serviceProviders?.custodian ?? null,
      legalCounsel: src.serviceProviders?.legalCounsel ?? null,
      bankingPartner: src.serviceProviders?.bankingPartner ?? null,
    },
    regulatory: {
      regulatorNames: [...(src.regulatory?.regulatorNames ?? [])],
      secFileNumber: src.regulatory?.secFileNumber ?? null,
      secExemptFileNumber: src.regulatory?.secExemptFileNumber ?? null,
      crdNumber: src.regulatory?.crdNumber ?? null,
      cikNumbers: [...(src.regulatory?.cikNumbers ?? [])],
      nfaId: src.regulatory?.nfaId ?? null,
      registrationNumber: src.regulatory?.registrationNumber ?? null,
      taxId: src.regulatory?.taxId ?? null,
      lei: src.regulatory?.lei ?? null,
    },
    operations: {
      inceptionYear: src.operations?.inceptionYear ?? null,
      employeeCountRange: src.operations?.employeeCountRange ?? null,
      businessDays: src.operations?.businessDays ?? null,
      businessHours: src.operations?.businessHours ?? null,
    },
  };
}

function normalizePhoneEntriesForSubmit(entries: PartnerPhoneEntry[]): PartnerPhoneEntry[] {
  return entries
    .map((entry) => ({
      label: trimToNull(entry.label),
      countryIso2: normalizeIso2Input(entry.countryIso2),
      numberE164: String(entry.numberE164 ?? "").trim(),
      extension: trimToNull(entry.extension),
    }))
    .filter((entry) => entry.countryIso2 && entry.numberE164)
    .filter((entry) => E164_PHONE_REGEX.test(entry.numberE164))
    .map((entry) => ({
      ...entry,
      extension: entry.extension && /^\d{1,12}$/.test(entry.extension) ? entry.extension : null,
    }));
}

function normalizeAddressesForSubmit(entries: PartnerAddressEntry[]): PartnerAddressEntry[] {
  return entries
    .map((entry) => ({
      kind: PARTNER_ADDRESS_KIND_OPTIONS.includes(entry.kind) ? entry.kind : "OTHER",
      line1: String(entry.line1 ?? "").trim(),
      line2: trimToNull(entry.line2),
      city: String(entry.city ?? "").trim(),
      stateRegion: trimToNull(entry.stateRegion),
      postalCode: trimToNull(entry.postalCode),
      countryIso2: normalizeIso2Input(entry.countryIso2),
    }))
    .filter((entry) => entry.line1 && entry.city && entry.countryIso2);
}

function normalizeContactsForSubmit(entries: PartnerPointOfContact[]): PartnerPointOfContact[] {
  const prepared = entries
    .map((entry) => {
      const phone = normalizePhoneEntriesForSubmit([entry.phone || createEmptyPartnerPhoneEntry("US")])[0] || null;
      const fax = normalizePhoneEntriesForSubmit([entry.fax || createEmptyPartnerPhoneEntry("US")])[0] || null;
      const preferredChannel = PARTNER_CONTACT_CHANNEL_OPTIONS.includes(
        (entry.preferredChannel || "EMAIL") as (typeof PARTNER_CONTACT_CHANNEL_OPTIONS)[number],
      )
        ? entry.preferredChannel
        : "EMAIL";
      return {
        fullName: String(entry.fullName ?? "").trim(),
        title: trimToNull(entry.title),
        department: trimToNull(entry.department),
        email: trimToNull(entry.email)?.toLowerCase() ?? null,
        phone,
        fax,
        location: trimToNull(entry.location),
        preferredChannel,
        isPrimary: Boolean(entry.isPrimary),
      };
    })
    .filter((entry) => entry.fullName.length > 0);

  const primaryIndex = prepared.findIndex((entry) => entry.isPrimary);
  if (prepared.length > 0) {
    if (primaryIndex === -1) {
      prepared[0].isPrimary = true;
    } else {
      prepared.forEach((entry, idx) => {
        entry.isPrimary = idx === primaryIndex;
      });
    }
  }
  return prepared;
}

function prepareInstitutionProfileForSubmit(input: PartnerInstitutionProfile): PartnerInstitutionProfile {
  const socialProfiles = normalizeListValues(input.socialProfiles ?? []).filter((entry) => {
    try {
      const url = new URL(entry);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  });

  return {
    legalEntityName: trimToNull(input.legalEntityName),
    tradingName: trimToNull(input.tradingName),
    entityType: trimToNull(input.entityType),
    domicileCountryIso2: normalizeIso2Input(input.domicileCountryIso2) || null,
    incorporationCountryIso2: normalizeIso2Input(input.incorporationCountryIso2) || null,
    registrationCountriesIso2: normalizeListValues(
      (input.registrationCountriesIso2 ?? []).map((entry) => normalizeIso2Input(entry)),
    ).filter((entry) => ISO2_COUNTRY_REGEX.test(entry)),
    websiteUrl: trimToNull(input.websiteUrl),
    socialProfiles,
    businessDescription: trimToNull(input.businessDescription),
    baseCurrency: trimToNull(input.baseCurrency)?.toUpperCase() ?? null,
    primaryTimezone: trimToNull(input.primaryTimezone),
    generalEmails: normalizeListValues(input.generalEmails ?? [], { lowercase: true }).filter((entry) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry),
    ),
    phoneNumbers: normalizePhoneEntriesForSubmit(input.phoneNumbers ?? []),
    faxNumbers: normalizePhoneEntriesForSubmit(input.faxNumbers ?? []),
    addresses: normalizeAddressesForSubmit(input.addresses ?? []),
    pointsOfContact: normalizeContactsForSubmit(input.pointsOfContact ?? []),
    serviceProviders: {
      primeBroker: trimToNull(input.serviceProviders?.primeBroker),
      fundAdministrator: trimToNull(input.serviceProviders?.fundAdministrator),
      auditor: trimToNull(input.serviceProviders?.auditor),
      custodian: trimToNull(input.serviceProviders?.custodian),
      legalCounsel: trimToNull(input.serviceProviders?.legalCounsel),
      bankingPartner: trimToNull(input.serviceProviders?.bankingPartner),
    },
    regulatory: {
      regulatorNames: normalizeListValues(input.regulatory?.regulatorNames ?? []),
      secFileNumber: trimToNull(input.regulatory?.secFileNumber),
      secExemptFileNumber: trimToNull(input.regulatory?.secExemptFileNumber),
      crdNumber: trimToNull(input.regulatory?.crdNumber),
      cikNumbers: normalizeListValues(input.regulatory?.cikNumbers ?? []),
      nfaId: trimToNull(input.regulatory?.nfaId),
      registrationNumber: trimToNull(input.regulatory?.registrationNumber),
      taxId: trimToNull(input.regulatory?.taxId),
      lei: trimToNull(input.regulatory?.lei)?.toUpperCase() ?? null,
    },
    operations: {
      inceptionYear: Number.isInteger(Number(input.operations?.inceptionYear))
        ? Number(input.operations?.inceptionYear)
        : null,
      employeeCountRange: trimToNull(input.operations?.employeeCountRange),
      businessDays: trimToNull(input.operations?.businessDays),
      businessHours: trimToNull(input.operations?.businessHours),
    },
  };
}

function LockedActionButton({
  lockReason,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { lockReason?: string | null }) {
  const button = (
    <Button {...props} disabled={disabled}>
      {children}
    </Button>
  );

  if (!disabled || !lockReason) return button;

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-not-allowed">{button}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {lockReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PartnerPortalContent() {
  const { user } = useAuth();
  useMailboxE2eeBootstrap();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const redeemInvite = useMutation({
    mutationFn: async (token: string) =>
      axios
        .post("/api/partner/invite/redeem", { token })
        .then((r) => parseApiPayload(inviteRedeemRespSchema, r.data, "INVITE_REDEEM_SCHEMA_INVALID")),
    onSuccess: (data) => {
      setPartnerKeyInput(data.apiKey);
      setPartnerKey(data.apiKey);
      toast({
        title: "Invite redeemed",
        description: data.warning || "You are now connected.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Invite redemption failed",
        description: readApiErrorCode(error) || "Invalid or expired invite token",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || params.get("invite");
    if (token) {
      redeemInvite.mutate(token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const [activeTab, setActiveTab] = useState("data-room");
  const [onboardingPanelTab, setOnboardingPanelTab] = useState<"identity" | "legal" | "trader-access">("identity");
  const [partnerKeyInput, setPartnerKeyInput] = useState("");
  const [partnerKey, setPartnerKey] = useState("");
  const [selectedHashId, setSelectedHashId] = useState<string>("");
  const [showPasswordReminder, setShowPasswordReminder] = useState(false);
  const [simulationPreview, setSimulationPreview] = useState<SimulationPreviewResp["preview"] | null>(null);
  const [simulationDraft, setSimulationDraft] = useState({
    userHashId: "",
    notionalUsd: "100000",
    horizonDays: "30",
  });
  const [allocationDraft, setAllocationDraft] = useState({
    userHashId: "",
    capitalUsd: "100000",
    shadowStopPct: "0.03",
  });
  const [inquiryDraft, setInquiryDraft] = useState({
    userHashId: "",
    senderName: "",
    senderEmail: "",
    subject: "",
    body: "",
  });
  const [profileDraft, setProfileDraft] = useState({
    fundName: "",
    fundLogoUrl: "",
    aumRange: "",
    hqLocation: "",
    strategyTagsCsv: "",
  });
  const [institutionDraft, setInstitutionDraft] = useState<PartnerInstitutionProfile>(() =>
    cloneInstitutionProfile(DEFAULT_PARTNER_INSTITUTION_PROFILE),
  );
  const [legalDraft, setLegalDraft] = useState({
    kybDocUrl: "",
    agreedToAllocation: false,
    agreedToNda: false,
  });
  const profileSectionRef = useRef<HTMLDivElement | null>(null);
  const legalSectionRef = useRef<HTMLDivElement | null>(null);

  const keyReady = partnerKey.trim().length >= 12;
  const partnerHeaders = useMemo(() => {
    const key = partnerKey.trim();
    return key ? { "x-partner-key": key } : {};
  }, [partnerKey]);

  const configQuery = useQuery<PartnerConfigResp>({
    queryKey: ["/api/admin/scout/config"],
    queryFn: () =>
      axios
        .get("/api/admin/scout/config")
        .then((r) => parseApiPayload(partnerConfigRespSchema, r.data, "SCOUT_CONFIG_SCHEMA_INVALID")),
    refetchOnWindowFocus: false,
  });

  const partnerPortalEnabled = Boolean(configQuery.data?.config?.partnerPortalEnabled ?? false);
  const partnerAllocationsEnabled = Boolean(configQuery.data?.config?.partnerAllocationsEnabled ?? false);

  const countriesQuery = useQuery<CountriesResp>({
    queryKey: ["/api/meta/countries"],
    queryFn: () =>
      axios
        .get("/api/meta/countries")
        .then((r) => parseApiPayload(countriesRespSchema, r.data, "COUNTRIES_SCHEMA_INVALID")),
    enabled: partnerPortalEnabled,
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const countryRows = useMemo(() => {
    const rows = countriesQuery.data?.rows ?? [];
    return rows
      .map((row) => ({
        code: normalizeIso2Input(row.code),
        name: String(row.name ?? "").trim() || String(row.code ?? "").trim().toUpperCase(),
      }))
      .filter((row) => row.code.length === 2)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [countriesQuery.data?.rows]);

  const onboardingQuery = useQuery<PartnerOnboardingResp>({
    queryKey: ["/api/partner/onboarding/state", partnerKey],
    queryFn: () =>
      axios
        .get("/api/partner/onboarding/state", { headers: partnerHeaders })
        .then((r) => parseApiPayload(partnerOnboardingRespSchema, r.data, "ONBOARDING_STATE_SCHEMA_INVALID")),
    enabled: keyReady && partnerPortalEnabled,
    refetchOnWindowFocus: false,
  });

  const dataRoomQuery = useQuery<DataRoomResp>({
    queryKey: ["/api/partner/data-room", partnerKey],
    queryFn: () =>
      axios
        .get("/api/partner/data-room?limit=25", { headers: partnerHeaders })
        .then((r) => parseApiPayload(dataRoomRespSchema, r.data, "DATA_ROOM_SCHEMA_INVALID")),
    enabled: keyReady && partnerPortalEnabled && Boolean(onboardingQuery.data?.state?.gates.viewDataRoom ?? true),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const rows = dataRoomQuery.data?.results ?? [];
    if (!rows.length) {
      setSelectedHashId("");
      return;
    }
    if (!rows.some((r) => r.hashId === selectedHashId)) {
      setSelectedHashId(rows[0].hashId);
    }
  }, [dataRoomQuery.data?.results, selectedHashId]);

  useEffect(() => {
    if (!selectedHashId) return;
    setSimulationDraft((prev) =>
      prev.userHashId === selectedHashId ? prev : { ...prev, userHashId: selectedHashId },
    );
  }, [selectedHashId]);

  const tearSheetQuery = useQuery<TearSheetResp>({
    queryKey: ["/api/partner/tear-sheet", partnerKey, selectedHashId],
    queryFn: () =>
      axios
        .get(`/api/partner/tear-sheet/${selectedHashId}`, { headers: partnerHeaders })
        .then((r) => parseApiPayload(tearSheetRespSchema, r.data, "TEAR_SHEET_SCHEMA_INVALID")),
    enabled:
      keyReady &&
      !!selectedHashId &&
      Boolean(onboardingQuery.data?.state?.gates.viewDataRoom ?? true),
    refetchOnWindowFocus: false,
  });

  const allocationsQuery = useQuery<AllocationResp>({
    queryKey: ["/api/partner/allocations", partnerKey],
    queryFn: () =>
      axios
        .get("/api/partner/allocations?limit=50", { headers: partnerHeaders })
        .then((r) => parseApiPayload(allocationRespSchema, r.data, "ALLOCATIONS_SCHEMA_INVALID")),
    enabled:
      keyReady &&
      partnerPortalEnabled &&
      partnerAllocationsEnabled &&
      Boolean(onboardingQuery.data?.state?.gates.requestAllocation ?? false),
    refetchOnWindowFocus: false,
  });

  const inquiriesQuery = useQuery<InquiryResp>({
    queryKey: ["/api/partner/inquiries", partnerKey],
    queryFn: () =>
      axios
        .get("/api/partner/inquiries?limit=50", { headers: partnerHeaders })
        .then((r) => parseApiPayload(inquiryRespSchema, r.data, "INQUIRIES_SCHEMA_INVALID")),
    enabled: keyReady && partnerPortalEnabled,
    refetchOnWindowFocus: false,
  });

  const inquiryRecipientsQuery = useQuery<InquiryRecipientResp>({
    queryKey: ["/api/partner/inquiries/recipients", partnerKey],
    queryFn: () =>
      axios
        .get("/api/partner/inquiries/recipients", { headers: partnerHeaders })
        .then((r) => parseApiPayload(inquiryRecipientRespSchema, r.data, "INQUIRY_RECIPIENTS_SCHEMA_INVALID")),
    enabled: keyReady && partnerPortalEnabled,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setInquiryDraft((prev) => {
      const nextName = prev.senderName || String(user?.name || "").trim();
      const nextEmail =
        prev.senderEmail ||
        String(user?.email || onboardingQuery.data?.state?.contactEmail || "").trim().toLowerCase();
      if (nextName === prev.senderName && nextEmail === prev.senderEmail) return prev;
      return {
        ...prev,
        senderName: nextName,
        senderEmail: nextEmail,
      };
    });
  }, [user?.email, user?.name, onboardingQuery.data?.state?.contactEmail]);

  useEffect(() => {
    const state = onboardingQuery.data?.state;
    if (!state) return;
    setProfileDraft((prev) => ({
      fundName: prev.fundName || state.profileData.fundName || state.partnerName || "",
      fundLogoUrl: prev.fundLogoUrl || state.fundLogoUrl || "",
      aumRange: prev.aumRange || state.profileData.aumRange || "",
      hqLocation: prev.hqLocation || state.profileData.hqLocation || "",
      strategyTagsCsv:
        prev.strategyTagsCsv || (state.profileData.strategyTags || []).join(", "),
    }));
    setInstitutionDraft(
      cloneInstitutionProfile(state.profileData.institutionProfile || DEFAULT_PARTNER_INSTITUTION_PROFILE),
    );
    setLegalDraft((prev) => ({
      kybDocUrl: prev.kybDocUrl || state.kybDocUrl || "",
      agreedToAllocation: prev.agreedToAllocation || Boolean(state.agreementsSignedAt),
      agreedToNda: prev.agreedToNda || Boolean(state.agreementsSignedAt),
    }));
  }, [onboardingQuery.data?.state]);

  const submitOnboardingProfile = useMutation({
    mutationFn: async () => {
      const strategyTags = profileDraft.strategyTagsCsv
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 25);
      const institutionProfile = prepareInstitutionProfileForSubmit(institutionDraft);
      return axios
        .post(
          "/api/partner/onboarding/profile",
          {
            fundName: profileDraft.fundName.trim(),
            fundLogoUrl: profileDraft.fundLogoUrl.trim() || null,
            aumRange: profileDraft.aumRange.trim(),
            hqLocation: profileDraft.hqLocation.trim() || null,
            strategyTags,
            institutionProfile,
          },
          { headers: partnerHeaders },
        )
        .then((r) => r.data);
    },
    onSuccess: () => {
      toast({ title: "Profile saved", description: "Simulation gate is now evaluated from your identity state." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/onboarding/state", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Profile save failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const submitOnboardingLegal = useMutation({
    mutationFn: async () =>
      axios
        .post(
          "/api/partner/onboarding/legal",
          {
            kybDocUrl: legalDraft.kybDocUrl.trim(),
            agreedToAllocation: legalDraft.agreedToAllocation,
            agreedToNda: legalDraft.agreedToNda,
          },
          { headers: partnerHeaders },
        )
        .then((r) => r.data),
    onSuccess: () => {
      toast({ title: "Legal package submitted", description: "Partner access is now pending admin approval." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/onboarding/state", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Legal submission failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const requestContactAccess = useMutation({
    mutationFn: async () =>
      axios
        .post(
          "/api/partner/onboarding/request-contact",
          {},
          {
            headers: partnerHeaders,
          },
        )
        .then((r) => r.data),
    onSuccess: () => {
      toast({ title: "Contact access requested", description: "Admin review is required before direct contact unlocks." });
      queryClient.invalidateQueries({ queryKey: ["/api/partner/onboarding/state", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Contact access request failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const createAllocation = useMutation({
    mutationFn: async () => {
      const capitalUsd = Number(allocationDraft.capitalUsd);
      const shadowStopPctRaw = String(allocationDraft.shadowStopPct || "").trim();
      const shadowStopPct = shadowStopPctRaw ? Number(shadowStopPctRaw) : null;
      return axios
        .post(
          "/api/partner/allocations",
          {
            userHashId: allocationDraft.userHashId.trim(),
            capitalUsd,
            shadowStopPct,
          },
          { headers: partnerHeaders },
        )
        .then((r) => r.data);
    },
    onSuccess: () => {
      toast({ title: "Allocation created" });
      setAllocationDraft((prev) => ({ ...prev, userHashId: "" }));
      queryClient.invalidateQueries({ queryKey: ["/api/partner/allocations", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Allocation create failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const previewSimulation = useMutation({
    mutationFn: async () => {
      const notionalUsd = Number(simulationDraft.notionalUsd);
      const horizonDays = Number(simulationDraft.horizonDays);
      return axios
        .post(
          "/api/partner/simulations/preview",
          {
            userHashId: simulationDraft.userHashId.trim(),
            notionalUsd,
            horizonDays: Number.isFinite(horizonDays) ? horizonDays : undefined,
          },
          { headers: partnerHeaders },
        )
        .then((r) => parseApiPayload(simulationPreviewRespSchema, r.data, "SIMULATION_PREVIEW_SCHEMA_INVALID"));
    },
    onSuccess: (data) => {
      setSimulationPreview(data.preview);
      toast({
        title: "Simulation updated",
        description: `Risk band: ${data.preview.scenario.riskBand} | confidence ${(data.preview.scenario.confidence * 100).toFixed(0)}%`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Simulation preview failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const updateAllocation = useMutation({
    mutationFn: async (payload: { id: number; status: string }) =>
      axios
        .put(`/api/partner/allocations/${payload.id}`, { status: payload.status }, { headers: partnerHeaders })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/allocations", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Allocation update failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });

  const createInquiry = useMutation({
    mutationFn: async () => {
      const senderName = inquiryDraft.senderName.trim();
      const senderEmail = inquiryDraft.senderEmail.trim().toLowerCase();
      const subject = inquiryDraft.subject.trim();
      const body = inquiryDraft.body.trim();
      const recipientPayload = inquiryRecipientsQuery.data;
      const recipientRows = recipientPayload?.rows ?? [];

      if (!recipientRows.length) {
        throw new Error("INQUIRY_RECIPIENTS_UNAVAILABLE");
      }
      if ((recipientPayload?.missingKeyCount ?? 0) > 0) {
        throw new Error("INQUIRY_RECIPIENT_KEYS_MISSING");
      }

      const recipientsWithKeys = recipientRows
        .map((row) => ({
          userId: Number(row.userId),
          publicKeyPem: String(row.mailboxPublicKey || "").trim(),
          keyAlgorithm: row.mailboxPublicKeyAlgo,
        }))
        .filter((row) => Number.isInteger(row.userId) && row.userId > 0 && row.publicKeyPem.length > 0);

      if (!recipientsWithKeys.length) {
        throw new Error("INQUIRY_RECIPIENT_KEYS_MISSING");
      }

      const senderUserId = Number(user?.id ?? 0);
      const senderKey =
        Number.isInteger(senderUserId) && senderUserId > 0 ? await ensureMailboxE2eeKey(senderUserId) : null;
      const encrypted = await encryptTextForMailboxRecipients(body, recipientsWithKeys);

      return axios
        .post(
          "/api/partner/inquiries",
          {
            userHashId: inquiryDraft.userHashId.trim() || null,
            senderName: senderName || null,
            senderEmail,
            subject,
            body,
            e2eeEnvelope: encrypted.envelope,
            e2eeSenderKeyFingerprint: senderKey?.fingerprint ?? undefined,
            bodyDigestSha256: encrypted.bodyDigestSha256,
          },
          { headers: partnerHeaders },
        )
        .then((r) => r.data);
    },
    onSuccess: () => {
      toast({ title: "Inquiry submitted" });
      setInquiryDraft((prev) => ({
        userHashId: "",
        senderName: prev.senderName,
        senderEmail: prev.senderEmail,
        subject: "",
        body: "",
      }));
      queryClient.invalidateQueries({ queryKey: ["/api/partner/inquiries", partnerKey] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Inquiry submit failed",
        description: readApiErrorCode(error) || "Request failed",
        variant: "destructive",
      });
    },
  });



  const inquiryRecipientRows = inquiryRecipientsQuery.data?.rows ?? [];
  const inquiryMissingKeyCount = Number(inquiryRecipientsQuery.data?.missingKeyCount ?? 0);
  const inquiryInboxAlias = String(inquiryRecipientsQuery.data?.inboxAlias || "inquiries@");
  const onboardingState = onboardingQuery.data?.state;
  const onboardingErrorCode = readApiErrorCode(onboardingQuery.error);
  const onboardingLoadErrorCode =
    !onboardingState && onboardingQuery.isError ? onboardingErrorCode || "FAILED_TO_FETCH_ONBOARDING_STATE" : null;
  const onboardingLoadErrorMessage = onboardingLoadErrorCode
    ? onboardingLoadErrorCode === "PARTNER_AUTH_FAILED"
      ? "Partner key was rejected. Reconnect with a valid key."
      : onboardingLoadErrorCode === "PARTNER_KEY_REQUIRED"
        ? "Partner key is missing. Connect with a valid key first."
        : onboardingLoadErrorCode === "PARTNER_INVITE_EXPIRED"
          ? "Partner invite has expired. Ask admin to refresh the invite."
          : onboardingLoadErrorCode === "PARTNER_REVOKED"
            ? "Partner access was revoked. Contact admin for reactivation."
            : onboardingLoadErrorCode === "PARTNER_IP_NOT_ALLOWED"
              ? "Current IP is not in the partner whitelist. Contact admin."
              : onboardingLoadErrorCode === "PARTNER_PORTAL_DISABLED"
                ? "Partner portal is currently disabled in admin settings."
                : onboardingLoadErrorCode === "PARTNER_HTTPS_REQUIRED"
                  ? "HTTPS is required for partner access in this environment."
                  : onboardingLoadErrorCode === "PARTNER_NOT_FOUND"
                    ? "Partner record is unavailable for this key."
                    : onboardingLoadErrorCode === "FAILED_TO_FETCH_ONBOARDING_STATE"
                      ? "Unable to load onboarding state right now. Retry in a moment."
                      : `Onboarding request failed (${onboardingLoadErrorCode}).`
    : null;
  const gateViewDataRoom = Boolean(onboardingState?.gates.viewDataRoom ?? true);
  const gateRunSimulations = Boolean(onboardingState?.gates.runSimulations ?? false);
  const gateRequestAllocation = Boolean(onboardingState?.gates.requestAllocation ?? false);
  const gateDirectContact = Boolean(onboardingState?.gates.directContact ?? false);
  const onboardingBlockedReason =
    onboardingState?.gateEval?.requestAllocation?.reason ||
    onboardingState?.gateEval?.viewDataRoom?.reason ||
    null;
  const isPendingApproval = onboardingState?.onboardingStep === "WAITING_APPROVAL";
  const inquirySendDisabled =
    !keyReady ||
    createInquiry.isPending ||
    !inquiryDraft.senderEmail.trim() ||
    !inquiryDraft.subject.trim() ||
    !inquiryDraft.body.trim() ||
    inquiryRecipientsQuery.isLoading ||
    inquiryMissingKeyCount > 0 ||
    inquiryRecipientRows.length === 0;
  const saveIdentityDisabled =
    submitOnboardingProfile.isPending ||
    !keyReady ||
    !profileDraft.fundName.trim() ||
    !profileDraft.aumRange.trim();
  const saveIdentityDisabledReason = !keyReady
    ? "Connect with a valid partner API key before saving identity details."
    : !profileDraft.fundName.trim()
      ? "Fund name is required."
      : !profileDraft.aumRange.trim()
        ? "AUM range is required."
        : submitOnboardingProfile.isPending
          ? "Identity save is currently in progress."
          : null;
  const legalSubmitDisabled =
    submitOnboardingLegal.isPending ||
    !keyReady ||
    !legalDraft.kybDocUrl.trim() ||
    !legalDraft.agreedToAllocation ||
    !legalDraft.agreedToNda;
  const legalSubmitDisabledReason = !keyReady
    ? "Connect with a valid partner API key before legal submission."
    : !legalDraft.kybDocUrl.trim()
      ? "KYB document URL is required."
      : !legalDraft.agreedToAllocation || !legalDraft.agreedToNda
        ? "All legal attestations must be accepted."
        : submitOnboardingLegal.isPending
          ? "Legal submission is currently in progress."
          : null;
  const simulationPreviewDisabled =
    !gateRunSimulations ||
    previewSimulation.isPending ||
    !keyReady ||
    !simulationDraft.userHashId.trim();
  const simulationPreviewDisabledReason = !keyReady
    ? "Connect with a valid partner API key before running simulations."
    : !gateRunSimulations
      ? `Simulation is locked (${onboardingState?.gateEval?.runSimulations?.reason || "PARTNER_GATE_BLOCKED"}).`
      : !simulationDraft.userHashId.trim()
        ? "Select or enter a trader hashId first."
        : previewSimulation.isPending
          ? "Simulation is currently running."
          : null;
  const createAllocationDisabled =
    !keyReady ||
    createAllocation.isPending ||
    !allocationDraft.userHashId.trim() ||
    !gateRequestAllocation;
  const createAllocationDisabledReason = !keyReady
    ? "Connect with a valid partner API key before creating allocations."
    : !gateRequestAllocation
      ? `Allocation gate is locked (${onboardingState?.gateEval?.requestAllocation?.reason || "PARTNER_GATE_BLOCKED"}).`
      : !allocationDraft.userHashId.trim()
        ? "Trader hashId is required for allocation."
        : createAllocation.isPending
          ? "Allocation request is in progress."
          : null;
  const inquirySendDisabledReason = !keyReady
    ? "Connect with a valid partner API key before sending inquiries."
    : !inquiryDraft.senderEmail.trim()
      ? "Sender email is required."
      : !inquiryDraft.subject.trim()
        ? "Subject is required."
        : !inquiryDraft.body.trim()
          ? "Inquiry body is required."
          : inquiryRecipientsQuery.isLoading
            ? "Loading inquiry recipients."
            : inquiryMissingKeyCount > 0
              ? "Some routed admins are missing mailbox encryption keys."
              : inquiryRecipientRows.length === 0
                ? "No inquiry recipients are configured by admin."
                : createInquiry.isPending
                  ? "Inquiry submission is in progress."
                  : null;
  const showOnboardingProfileTabs = Boolean(keyReady && partnerPortalEnabled);
  const showTraderAccessMiniTabs = !showOnboardingProfileTabs || onboardingPanelTab === "trader-access";

  const scrollToProfileStep = () => {
    setOnboardingPanelTab("identity");
    requestAnimationFrame(() => {
      profileSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const scrollToLegalStep = () => {
    setOnboardingPanelTab("legal");
    requestAnimationFrame(() => {
      legalSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const openTraderAccessTab = (miniTab: "data-room" | "simulations" | "allocations" | "comms" = "comms") => {
    setOnboardingPanelTab("trader-access");
    setActiveTab(miniTab);
  };

  const setInstitutionField = <K extends keyof PartnerInstitutionProfile>(
    field: K,
    value: PartnerInstitutionProfile[K],
  ) => {
    setInstitutionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateInstitutionStringList = (
    field: "generalEmails" | "socialProfiles" | "registrationCountriesIso2",
    index: number,
    value: string,
  ) => {
    setInstitutionDraft((prev) => {
      const next = [...(prev[field] || [])];
      next[index] = value;
      return { ...prev, [field]: next };
    });
  };

  const addInstitutionStringListItem = (
    field: "generalEmails" | "socialProfiles" | "registrationCountriesIso2",
    initialValue = "",
  ) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      [field]: [...(prev[field] || []), initialValue],
    }));
  };

  const removeInstitutionStringListItem = (
    field: "generalEmails" | "socialProfiles" | "registrationCountriesIso2",
    index: number,
  ) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      [field]: (prev[field] || []).filter((_row: string, rowIndex: number) => rowIndex !== index),
    }));
  };

  const updateRegulatoryStringList = (field: "regulatorNames" | "cikNumbers", index: number, value: string) => {
    setInstitutionDraft((prev) => {
      const next = [...(prev.regulatory?.[field] || [])];
      next[index] = value;
      return {
        ...prev,
        regulatory: {
          ...prev.regulatory,
          [field]: next,
        },
      };
    });
  };

  const addRegulatoryStringListItem = (field: "regulatorNames" | "cikNumbers", initialValue = "") => {
    setInstitutionDraft((prev) => ({
      ...prev,
      regulatory: {
        ...prev.regulatory,
        [field]: [...(prev.regulatory?.[field] || []), initialValue],
      },
    }));
  };

  const removeRegulatoryStringListItem = (field: "regulatorNames" | "cikNumbers", index: number) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      regulatory: {
        ...prev.regulatory,
        [field]: (prev.regulatory?.[field] || []).filter(
          (_row: string, rowIndex: number) => rowIndex !== index,
        ),
      },
    }));
  };

  const updatePhoneEntry = (field: "phoneNumbers" | "faxNumbers", index: number, patch: Partial<PartnerPhoneEntry>) => {
    setInstitutionDraft((prev) => {
      const rows = [...(prev[field] || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, [field]: rows };
    });
  };

  const addPhoneEntry = (field: "phoneNumbers" | "faxNumbers", countryIso2 = "US") => {
    setInstitutionDraft((prev) => ({
      ...prev,
      [field]: [...(prev[field] || []), createEmptyPartnerPhoneEntry(countryIso2)],
    }));
  };

  const removePhoneEntry = (field: "phoneNumbers" | "faxNumbers", index: number) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      [field]: (prev[field] || []).filter((_entry: PartnerPhoneEntry, rowIndex: number) => rowIndex !== index),
    }));
  };

  const updateAddressEntry = (index: number, patch: Partial<PartnerAddressEntry>) => {
    setInstitutionDraft((prev) => {
      const rows = [...(prev.addresses || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, addresses: rows };
    });
  };

  const addAddressEntry = (countryIso2 = "US") => {
    setInstitutionDraft((prev) => ({
      ...prev,
      addresses: [...(prev.addresses || []), createEmptyPartnerAddressEntry(countryIso2)],
    }));
  };

  const removeAddressEntry = (index: number) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      addresses: (prev.addresses || []).filter((_entry, rowIndex) => rowIndex !== index),
    }));
  };

  const updatePointOfContact = (index: number, patch: Partial<PartnerPointOfContact>) => {
    setInstitutionDraft((prev) => {
      const rows = [...(prev.pointsOfContact || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, pointsOfContact: rows };
    });
  };

  const updatePointOfContactPhone = (
    index: number,
    field: "phone" | "fax",
    patch: Partial<PartnerPhoneEntry>,
  ) => {
    setInstitutionDraft((prev) => {
      const rows = [...(prev.pointsOfContact || [])];
      const current = rows[index] || createEmptyPartnerPointOfContact("US");
      const currentPhone = current[field] || createEmptyPartnerPhoneEntry("US");
      rows[index] = {
        ...current,
        [field]: {
          ...currentPhone,
          ...patch,
        },
      };
      return { ...prev, pointsOfContact: rows };
    });
  };

  const addPointOfContact = (countryIso2 = "US") => {
    setInstitutionDraft((prev) => ({
      ...prev,
      pointsOfContact: [...(prev.pointsOfContact || []), createEmptyPartnerPointOfContact(countryIso2)],
    }));
  };

  const removePointOfContact = (index: number) => {
    setInstitutionDraft((prev) => ({
      ...prev,
      pointsOfContact: (prev.pointsOfContact || []).filter((_entry, rowIndex) => rowIndex !== index),
    }));
  };

  useEffect(() => {
    const state = onboardingState;
    if (!state || !keyReady) {
      setShowPasswordReminder(false);
      return;
    }
    const reminderLogins = Math.max(1, Number(state.passwordPolicy?.reminderLogins || 3));
    const rotationDays = Math.max(7, Number(state.passwordPolicy?.rotationDays || 90));
    const stale =
      !state.passwordRotatedAt ||
      Date.now() / 1000 - Number(state.passwordRotatedAt) >= rotationDays * 86400;
    if (!stale || Number(state.loginCount || 0) < reminderLogins) {
      setShowPasswordReminder(false);
      return;
    }

    const dismissKey = `partner-password-reminder:${state.partnerId}:${state.passwordRotatedAt || 0}:${rotationDays}`;
    try {
      const dismissed = sessionStorage.getItem(dismissKey) === "1";
      setShowPasswordReminder(!dismissed);
    } catch {
      setShowPasswordReminder(true);
    }
  }, [onboardingState, keyReady]);

  const dismissPasswordReminder = () => {
    const state = onboardingState;
    if (!state) {
      setShowPasswordReminder(false);
      return;
    }
    const rotationDays = Math.max(7, Number(state.passwordPolicy?.rotationDays || 90));
    const dismissKey = `partner-password-reminder:${state.partnerId}:${state.passwordRotatedAt || 0}:${rotationDays}`;
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      // Ignore storage write failures; modal dismissal still applies in-memory.
    }
    setShowPasswordReminder(false);
  };

  if (!user?.isAdmin) {
    return (
      <div className="page-pad min-h-screen min-h-dvh bg-neutral-900 text-white">
        <div className="max-w-4xl mx-auto rounded border border-neutral-700 bg-neutral-800 p-6">
          <h1 className="text-xl font-semibold">Partner Portal</h1>
          <p className="text-sm text-gray-300 mt-2">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="page-pad min-h-screen min-h-dvh bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_40%),radial-gradient(circle_at_bottom_right,_rgba(217,70,239,0.08),_transparent_35%),#171717] text-white"
      data-testid="partner-portal-page"
    >
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="rounded-lg border border-neutral-700 bg-neutral-900/80 p-4 shadow-[0_0_0_1px_rgba(82,82,91,0.4)]">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1">
              <div className="mb-1 text-xs text-sky-100">Partner API key</div>
              <Input
                value={partnerKeyInput}
                onChange={(e) => setPartnerKeyInput(e.target.value)}
                placeholder="tp_..."
                className="border-neutral-600 bg-neutral-950"
                data-testid="partner-key-input"
              />
            </div>
            <Button
              className="border border-sky-300/40 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30"
              onClick={() => {
                setPartnerKey(partnerKeyInput.trim());
                setOnboardingPanelTab("identity");
              }}
              disabled={!partnerKeyInput.trim()}
              data-testid="partner-key-connect"
            >
              Connect
            </Button>
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Partner portal toggle:{" "}
            <span className={partnerPortalEnabled ? "text-emerald-400" : "text-amber-300"}>
              {partnerPortalEnabled ? "enabled" : "disabled"}
            </span>
            {" | "}
            allocations:{" "}
            <span className={partnerAllocationsEnabled ? "text-emerald-400" : "text-amber-300"}>
              {partnerAllocationsEnabled ? "enabled" : "disabled"}
            </span>
          </div>
          {!keyReady && (
            <div className="mt-2 text-xs text-gray-400">Enter a partner API key to load the portal datasets.</div>
          )}
        </div>

        {keyReady && partnerPortalEnabled && (
          <div className="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900/80 p-4">
            {onboardingState ? (
              <PartnerProfileWizard
                state={onboardingState}
                onOpenComms={() => openTraderAccessTab("comms")}
                onScrollToProfile={scrollToProfileStep}
                onScrollToLegal={scrollToLegalStep}
              />
            ) : onboardingLoadErrorMessage ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                <div className="font-semibold">Unable to load onboarding wizard.</div>
                <div className="mt-1">{onboardingLoadErrorMessage}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-300/40 text-amber-100 hover:bg-amber-500/10"
                    onClick={() => {
                      void onboardingQuery.refetch();
                    }}
                  >
                    Retry
                  </Button>
                  <span className="text-[11px] text-amber-200/90">Code: {onboardingLoadErrorCode}</span>
                </div>
              </div>
            ) : (
              <div className="rounded border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-gray-400">
                Loading onboarding wizard…
              </div>
            )}

            <PartnerPortalTabs
              {...{
                onboardingBlockedReason,
                openTraderAccessTab,
                onboardingPanelTab,
                setOnboardingPanelTab,
                profileSectionRef,
                legalSectionRef,
                profileDraft,
                setProfileDraft,
                institutionDraft,
                setInstitutionField,
                setInstitutionDraft,
                countryRows,
                addInstitutionStringListItem,
                updateInstitutionStringList,
                removeInstitutionStringListItem,
                normalizeIso2Input,
                addAddressEntry,
                updateAddressEntry,
                removeAddressEntry,
                addPhoneEntry,
                updatePhoneEntry,
                removePhoneEntry,
                addPointOfContact,
                updatePointOfContact,
                updatePointOfContactPhone,
                removePointOfContact,
                addRegulatoryStringListItem,
                updateRegulatoryStringList,
                removeRegulatoryStringListItem,
                legalDraft,
                setLegalDraft,
                keyReady,
                showOnboardingProfileTabs,
                saveIdentityDisabled,
                saveIdentityDisabledReason,
                submitOnboardingProfile,
                requestContactAccess,
                legalSubmitDisabled,
                legalSubmitDisabledReason,
                submitOnboardingLegal,
                showTraderAccessMiniTabs,
                activeTab,
                setActiveTab,
                gateViewDataRoom,
                gateRunSimulations,
                gateRequestAllocation,
                gateDirectContact,
                onboardingState,
                dataRoomQuery,
                selectedHashId,
                setSelectedHashId,
                tearSheetQuery,
                fmtUsd,
                fmtPct,
                simulationDraft,
                setSimulationDraft,
                previewSimulation,
                simulationPreviewDisabled,
                simulationPreviewDisabledReason,
                simulationPreview,
                allocationDraft,
                setAllocationDraft,
                createAllocation,
                createAllocationDisabled,
                createAllocationDisabledReason,
                allocationsQuery,
                updateAllocation,
                inquiryInboxAlias,
                inquiryRecipientsQuery,
                inquiryMissingKeyCount,
                inquiryDraft,
                setInquiryDraft,
                createInquiry,
                inquirySendDisabled,
                inquirySendDisabledReason,
                inquiriesQuery,
                fmtWhen,
                isPendingApproval,
                LockedActionButton,
              }}
            />
          </div>
        )}
      </div>

      <Dialog
        modal={false}
        open={showPasswordReminder}
        onOpenChange={(open) => (!open ? dismissPasswordReminder() : setShowPasswordReminder(true))}
      >
        <DialogContent className="max-w-md bg-neutral-900 border-neutral-700 text-white">
          <DialogHeader>
            <DialogTitle>Partner Credential Rotation Reminder</DialogTitle>
            <DialogDescription className="text-gray-300">
              This partner access key/session has crossed the configured reminder threshold. Rotate partner credentials
              in Scout to reduce exposure.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs text-gray-300">
            Logins observed: <span className="text-white">{onboardingState?.loginCount ?? 0}</span> | Rotation policy:{" "}
            <span className="text-white">{onboardingState?.passwordPolicy?.rotationDays ?? 90} days</span> | Last rotated:{" "}
            <span className="text-white">
              {onboardingState?.passwordRotatedAt ? fmtWhen(onboardingState.passwordRotatedAt) : "never"}
            </span>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              className="border-neutral-600"
              onClick={() => dismissPasswordReminder()}
            >
              Remind Later
            </Button>
            <div className="text-xs text-amber-200 bg-amber-900/40 p-2 rounded">
              Contact your administrator to rotate your credentials securely.
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PartnerPortal() {
  return (
    <FeatureErrorBoundary featureName="Partner Portal">
      <PartnerPortalContent />
    </FeatureErrorBoundary>
  );
}
