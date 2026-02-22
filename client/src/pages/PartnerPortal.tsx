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

            {onboardingBlockedReason ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
                <span>Gating: {onboardingBlockedReason}. Complete onboarding steps to unlock restricted actions.</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300/40"
                  onClick={() => openTraderAccessTab("comms")}
                >
                  Inquire with Admin
                </Button>
              </div>
            ) : null}

            <Tabs
              value={onboardingPanelTab}
              onValueChange={(value) => {
                if (value === "identity" || value === "legal" || value === "trader-access") {
                  setOnboardingPanelTab(value);
                }
              }}
              className="space-y-0"
            >
              <TabsList className="grid grid-cols-3 h-auto w-full border border-neutral-700 bg-neutral-950/90 p-1">
                <TabsTrigger
                  value="identity"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Identity & Institutional Profile
                </TabsTrigger>
                <TabsTrigger
                  value="legal"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <Scale className="h-3.5 w-3.5" />
                  Legal & Approval
                </TabsTrigger>
                <TabsTrigger
                  value="trader-access"
                  className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:text-sm"
                >
                  <FolderKanban className="h-3.5 w-3.5" />
                  Trader Access
                </TabsTrigger>
              </TabsList>

              <TabsContent value="identity" className="mt-3">
                <div
                  ref={profileSectionRef}
                  className="max-h-[72vh] space-y-4 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-950/60 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-blue-200">
                        Identity & Institutional Profile
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        Complete all profile zones for legal, access, and allocation gating.
                      </div>
                    </div>
                  </div>

                  <section className="relative overflow-hidden rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-blue-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-blue-400/30 bg-blue-500/10 p-1 text-blue-200">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-blue-100">Core Identity</div>
                        <div className="text-[11px] text-blue-200/80">Who the institution is.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        placeholder="Fund name"
                        value={profileDraft.fundName}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, fundName: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Fund logo URL (optional)"
                        value={profileDraft.fundLogoUrl}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, fundLogoUrl: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Legal entity name"
                        value={institutionDraft.legalEntityName || ""}
                        onChange={(e) => setInstitutionField("legalEntityName", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Trading name / DBA"
                        value={institutionDraft.tradingName || ""}
                        onChange={(e) => setInstitutionField("tradingName", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <select
                        value={institutionDraft.entityType || ""}
                        onChange={(e) => setInstitutionField("entityType", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Entity type</option>
                        {PARTNER_ENTITY_TYPE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-amber-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-amber-400/30 bg-amber-500/10 p-1 text-amber-200">
                        <TrendingUp className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-amber-100">Operations & Strategy</div>
                        <div className="text-[11px] text-amber-200/80">Mandate, scale, and operating profile.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        placeholder="AUM range (e.g. $10M-$50M)"
                        value={profileDraft.aumRange}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, aumRange: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Strategy tags CSV"
                        value={profileDraft.strategyTagsCsv}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, strategyTagsCsv: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Base currency (e.g. USD)"
                        value={institutionDraft.baseCurrency || ""}
                        onChange={(e) => setInstitutionField("baseCurrency", e.target.value.toUpperCase())}
                        className="border-neutral-600 bg-neutral-900"
                        maxLength={3}
                      />
                      <Input
                        placeholder="Primary timezone (IANA)"
                        value={institutionDraft.primaryTimezone || ""}
                        onChange={(e) => setInstitutionField("primaryTimezone", e.target.value || null)}
                        className="border-neutral-600 bg-neutral-900"
                      />
                    </div>
                    <Textarea
                      placeholder="Business description, mandate, and operating scope"
                      value={institutionDraft.businessDescription || ""}
                      onChange={(e) => setInstitutionField("businessDescription", e.target.value || null)}
                      className="mt-2 min-h-[88px] border-neutral-600 bg-neutral-900"
                    />
                    <div className="mt-2 grid gap-2 rounded border border-amber-500/20 bg-neutral-900/70 p-2 md:grid-cols-4">
                      <Input
                        placeholder="Inception year"
                        value={institutionDraft.operations.inceptionYear?.toString() || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: {
                              ...prev.operations,
                              inceptionYear: e.target.value ? Number(e.target.value) : null,
                            },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                        inputMode="numeric"
                      />
                      <select
                        value={institutionDraft.operations.employeeCountRange || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, employeeCountRange: e.target.value || null },
                          }))
                        }
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Employee count range</option>
                        {PARTNER_EMPLOYEE_COUNT_RANGE_OPTIONS.map((option) => (
                          <option key={`emp-${option}`} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <Input
                        placeholder="Business days (e.g. Mon-Fri)"
                        value={institutionDraft.operations.businessDays || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, businessDays: e.target.value || null },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <Input
                        placeholder="Business hours (e.g. 09:00-17:00 ET)"
                        value={institutionDraft.operations.businessHours || ""}
                        onChange={(e) =>
                          setInstitutionDraft((prev) => ({
                            ...prev,
                            operations: { ...prev.operations, businessHours: e.target.value || null },
                          }))
                        }
                        className="border-neutral-600 bg-neutral-900"
                      />
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-teal-500/30 bg-teal-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-teal-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-teal-400/30 bg-teal-500/10 p-1 text-teal-200">
                        <MapPinned className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-teal-100">Location & Jurisdiction</div>
                        <div className="text-[11px] text-teal-200/80">Domicile, registration footprint, and addresses.</div>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <Input
                        placeholder="HQ location"
                        value={profileDraft.hqLocation}
                        onChange={(e) => setProfileDraft((prev) => ({ ...prev, hqLocation: e.target.value }))}
                        className="border-neutral-600 bg-neutral-900"
                      />
                      <select
                        value={institutionDraft.domicileCountryIso2 || ""}
                        onChange={(e) => setInstitutionField("domicileCountryIso2", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Domicile country</option>
                        {countryRows.map((row) => (
                          <option key={`dom-${row.code}`} value={row.code}>
                            {row.name} ({row.code})
                          </option>
                        ))}
                      </select>
                      <select
                        value={institutionDraft.incorporationCountryIso2 || ""}
                        onChange={(e) => setInstitutionField("incorporationCountryIso2", e.target.value || null)}
                        className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                      >
                        <option value="">Incorporation country</option>
                        {countryRows.map((row) => (
                          <option key={`inc-${row.code}`} value={row.code}>
                            {row.name} ({row.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-teal-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-teal-100">Registration countries (ISO2)</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-teal-400/30 text-teal-100 hover:bg-teal-500/10"
                          onClick={() => addInstitutionStringListItem("registrationCountriesIso2")}
                        >
                          Add Country
                        </Button>
                      </div>
                      {(institutionDraft.registrationCountriesIso2 || []).map((code, index) => (
                        <div key={`reg-country-${index}`} className="flex gap-2">
                          <select
                            value={code || ""}
                            onChange={(e) =>
                              updateInstitutionStringList(
                                "registrationCountriesIso2",
                                index,
                                normalizeIso2Input(e.target.value),
                              )
                            }
                            className="h-10 flex-1 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                          >
                            <option value="">Select country</option>
                            {countryRows.map((row) => (
                              <option key={`reg-iso2-${row.code}`} value={row.code}>
                                {row.name} ({row.code})
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            onClick={() => removeInstitutionStringListItem("registrationCountriesIso2", index)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      {(institutionDraft.registrationCountriesIso2 || []).length === 0 && (
                        <div className="text-[11px] text-neutral-400">
                          Add all jurisdictions where this entity is registered.
                        </div>
                      )}
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-teal-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-teal-100">Addresses</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-teal-400/30 text-teal-100 hover:bg-teal-500/10"
                          onClick={() => addAddressEntry(institutionDraft.domicileCountryIso2 || "US")}
                        >
                          Add Address
                        </Button>
                      </div>
                      {(institutionDraft.addresses || []).map((entry, index) => (
                        <div key={`address-${index}`} className="space-y-2 rounded border border-neutral-700 p-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <select
                              value={entry.kind}
                              onChange={(e) =>
                                updateAddressEntry(index, {
                                  kind: (e.target.value as (typeof PARTNER_ADDRESS_KIND_OPTIONS)[number]) || "OTHER",
                                })
                              }
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              {PARTNER_ADDRESS_KIND_OPTIONS.map((kind) => (
                                <option key={`addr-kind-${kind}`} value={kind}>
                                  {kind}
                                </option>
                              ))}
                            </select>
                            <Input
                              placeholder="Line 1"
                              value={entry.line1}
                              onChange={(e) => updateAddressEntry(index, { line1: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Line 2"
                              value={entry.line2 || ""}
                              onChange={(e) => updateAddressEntry(index, { line2: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeAddressEntry(index)}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              placeholder="City"
                              value={entry.city}
                              onChange={(e) => updateAddressEntry(index, { city: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="State / Region"
                              value={entry.stateRegion || ""}
                              onChange={(e) => updateAddressEntry(index, { stateRegion: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Postal code"
                              value={entry.postalCode || ""}
                              onChange={(e) => updateAddressEntry(index, { postalCode: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <select
                              value={entry.countryIso2 || ""}
                              onChange={(e) => updateAddressEntry(index, { countryIso2: e.target.value })}
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              <option value="">Country</option>
                              {countryRows.map((row) => (
                                <option key={`addr-country-${row.code}`} value={row.code}>
                                  {row.name} ({row.code})
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-indigo-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-indigo-400/30 bg-indigo-500/10 p-1 text-indigo-200">
                        <Globe2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-indigo-100">Digital & Communication</div>
                        <div className="text-[11px] text-indigo-200/80">
                          Website, contact channels, and operational points of contact.
                        </div>
                      </div>
                    </div>
                    <Input
                      placeholder="Website URL"
                      value={institutionDraft.websiteUrl || ""}
                      onChange={(e) => setInstitutionField("websiteUrl", e.target.value || null)}
                      className="mb-2 border-neutral-600 bg-neutral-900"
                    />

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-indigo-100">General email addresses</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                            onClick={() => addInstitutionStringListItem("generalEmails")}
                          >
                            Add Email
                          </Button>
                        </div>
                        {(institutionDraft.generalEmails || []).map((email, index) => (
                          <div key={`gen-email-${index}`} className="flex gap-2">
                            <Input
                              placeholder="ops@fund.com"
                              value={email}
                              onChange={(e) => updateInstitutionStringList("generalEmails", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeInstitutionStringListItem("generalEmails", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        {(institutionDraft.generalEmails || []).length === 0 && (
                          <div className="text-[11px] text-neutral-400">
                            Capture operations, compliance, and treasury mailboxes.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-indigo-100">Social / web profiles</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                            onClick={() => addInstitutionStringListItem("socialProfiles")}
                          >
                            Add URL
                          </Button>
                        </div>
                        {(institutionDraft.socialProfiles || []).map((url, index) => (
                          <div key={`social-${index}`} className="flex gap-2">
                            <Input
                              placeholder="https://www.linkedin.com/company/..."
                              value={url}
                              onChange={(e) => updateInstitutionStringList("socialProfiles", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeInstitutionStringListItem("socialProfiles", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        {(institutionDraft.socialProfiles || []).length === 0 && (
                          <div className="text-[11px] text-neutral-400">
                            Optional public profiles for due diligence cross-checks.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {(["phoneNumbers", "faxNumbers"] as const).map((field) => (
                        <div key={field} className="space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-indigo-100">
                              {field === "phoneNumbers" ? "Phone numbers" : "Fax numbers"}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                              onClick={() => addPhoneEntry(field, institutionDraft.domicileCountryIso2 || "US")}
                            >
                              Add {field === "phoneNumbers" ? "Phone" : "Fax"}
                            </Button>
                          </div>
                          {(institutionDraft[field] || []).map((entry, index) => (
                            <div
                              key={`${field}-${index}`}
                              className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4"
                            >
                              <Input
                                placeholder="Label"
                                value={entry.label || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { label: e.target.value || null })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.countryIso2 || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`${field}-iso2-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.numberE164 || ""}
                                onChange={(e) => updatePhoneEntry(field, index, { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <div className="flex gap-2">
                                <Input
                                  placeholder="Ext"
                                  value={entry.extension || ""}
                                  onChange={(e) => updatePhoneEntry(field, index, { extension: e.target.value || null })}
                                  className="border-neutral-600 bg-neutral-900"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-neutral-600"
                                  onClick={() => removePhoneEntry(field, index)}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 space-y-2 rounded border border-indigo-500/20 bg-neutral-900/70 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-indigo-100">Points of contact</div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-indigo-400/30 text-indigo-100 hover:bg-indigo-500/10"
                          onClick={() => addPointOfContact(institutionDraft.domicileCountryIso2 || "US")}
                        >
                          Add Contact
                        </Button>
                      </div>
                      {(institutionDraft.pointsOfContact || []).map((entry, index) => (
                        <div key={`poc-${index}`} className="space-y-2 rounded border border-neutral-700 p-2">
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              placeholder="Full name"
                              value={entry.fullName}
                              onChange={(e) => updatePointOfContact(index, { fullName: e.target.value })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Title"
                              value={entry.title || ""}
                              onChange={(e) => updatePointOfContact(index, { title: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Department"
                              value={entry.department || ""}
                              onChange={(e) => updatePointOfContact(index, { department: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-xs text-indigo-100">
                                <input
                                  type="checkbox"
                                  checked={Boolean(entry.isPrimary)}
                                  onChange={(e) => updatePointOfContact(index, { isPrimary: e.target.checked })}
                                />
                                Primary
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-neutral-600"
                                onClick={() => removePointOfContact(index)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                          <div className="grid gap-2 md:grid-cols-4">
                            <Input
                              type="email"
                              placeholder="Email"
                              value={entry.email || ""}
                              onChange={(e) => updatePointOfContact(index, { email: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Input
                              placeholder="Location"
                              value={entry.location || ""}
                              onChange={(e) => updatePointOfContact(index, { location: e.target.value || null })}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <select
                              value={entry.preferredChannel || "EMAIL"}
                              onChange={(e) =>
                                updatePointOfContact(index, {
                                  preferredChannel:
                                    (e.target.value as (typeof PARTNER_CONTACT_CHANNEL_OPTIONS)[number]) || "EMAIL",
                                })
                              }
                              className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                            >
                              {PARTNER_CONTACT_CHANNEL_OPTIONS.map((channel) => (
                                <option key={`poc-channel-${channel}`} value={channel}>
                                  {channel}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4">
                              <Input
                                placeholder="Phone label"
                                value={entry.phone?.label || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "phone", { label: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.phone?.countryIso2 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "phone", { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`poc-phone-country-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.phone?.numberE164 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "phone", { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <Input
                                placeholder="Ext"
                                value={entry.phone?.extension || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "phone", { extension: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                            </div>
                            <div className="grid gap-2 rounded border border-neutral-700 p-2 md:grid-cols-4">
                              <Input
                                placeholder="Fax label"
                                value={entry.fax?.label || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "fax", { label: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <select
                                value={entry.fax?.countryIso2 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "fax", { countryIso2: e.target.value })}
                                className="h-10 rounded-md border border-neutral-600 bg-neutral-900 px-3 text-sm"
                              >
                                <option value="">ISO2</option>
                                {countryRows.map((row) => (
                                  <option key={`poc-fax-country-${row.code}`} value={row.code}>
                                    {row.code}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder="+12125550111"
                                value={entry.fax?.numberE164 || ""}
                                onChange={(e) => updatePointOfContactPhone(index, "fax", { numberE164: e.target.value })}
                                className="border-neutral-600 bg-neutral-900"
                              />
                              <Input
                                placeholder="Ext"
                                value={entry.fax?.extension || ""}
                                onChange={(e) =>
                                  updatePointOfContactPhone(index, "fax", { extension: e.target.value || null })
                                }
                                className="border-neutral-600 bg-neutral-900"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="relative overflow-hidden rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 pl-5">
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500" />
                    <div className="mb-3 flex items-center gap-2">
                      <div className="rounded border border-rose-400/30 bg-rose-500/10 p-1 text-rose-200">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-rose-100">Regulatory & Service Providers</div>
                        <div className="text-[11px] text-rose-200/80">Compliance lineage and institutional trust data.</div>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center gap-1.5 text-xs text-rose-100">
                          <Landmark className="h-3.5 w-3.5" />
                          Service providers
                        </div>
                        <Input
                          placeholder="Prime broker"
                          value={institutionDraft.serviceProviders.primeBroker || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, primeBroker: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Fund administrator"
                          value={institutionDraft.serviceProviders.fundAdministrator || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, fundAdministrator: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Auditor"
                          value={institutionDraft.serviceProviders.auditor || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, auditor: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Custodian"
                          value={institutionDraft.serviceProviders.custodian || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, custodian: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Legal counsel"
                          value={institutionDraft.serviceProviders.legalCounsel || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, legalCounsel: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Banking partner"
                          value={institutionDraft.serviceProviders.bankingPartner || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              serviceProviders: { ...prev.serviceProviders, bankingPartner: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                      </div>

                      <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-rose-100">Regulators</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-400/30 text-rose-100 hover:bg-rose-500/10"
                            onClick={() => addRegulatoryStringListItem("regulatorNames")}
                          >
                            Add Regulator
                          </Button>
                        </div>
                        {(institutionDraft.regulatory.regulatorNames || []).map((name, index) => (
                          <div key={`regulator-${index}`} className="flex gap-2">
                            <Input
                              placeholder="SEC, FCA, CFTC..."
                              value={name}
                              onChange={(e) => updateRegulatoryStringList("regulatorNames", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeRegulatoryStringListItem("regulatorNames", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Input
                          placeholder="SEC file number"
                          value={institutionDraft.regulatory.secFileNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, secFileNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="SEC exempt file number"
                          value={institutionDraft.regulatory.secExemptFileNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, secExemptFileNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="CRD number"
                          value={institutionDraft.regulatory.crdNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, crdNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-rose-100">CIK numbers</div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-rose-400/30 text-rose-100 hover:bg-rose-500/10"
                            onClick={() => addRegulatoryStringListItem("cikNumbers")}
                          >
                            Add CIK
                          </Button>
                        </div>
                        {(institutionDraft.regulatory.cikNumbers || []).map((cik, index) => (
                          <div key={`cik-${index}`} className="flex gap-2">
                            <Input
                              placeholder="0001234567"
                              value={cik}
                              onChange={(e) => updateRegulatoryStringList("cikNumbers", index, e.target.value)}
                              className="border-neutral-600 bg-neutral-900"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => removeRegulatoryStringListItem("cikNumbers", index)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Input
                          placeholder="NFA ID"
                          value={institutionDraft.regulatory.nfaId || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, nfaId: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Registration number"
                          value={institutionDraft.regulatory.registrationNumber || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, registrationNumber: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="Tax ID / EIN"
                          value={institutionDraft.regulatory.taxId || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, taxId: e.target.value || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                        <Input
                          placeholder="LEI"
                          value={institutionDraft.regulatory.lei || ""}
                          onChange={(e) =>
                            setInstitutionDraft((prev) => ({
                              ...prev,
                              regulatory: { ...prev.regulatory, lei: e.target.value.toUpperCase() || null },
                            }))
                          }
                          className="border-neutral-600 bg-neutral-900"
                        />
                      </div>
                    </div>
                  </section>

                  <div className="flex justify-end">
                    <LockedActionButton
                      size="sm"
                      className="border border-blue-400/50 bg-blue-500/20 text-blue-50 hover:bg-blue-500/30"
                      onClick={() => submitOnboardingProfile.mutate()}
                      disabled={saveIdentityDisabled}
                      lockReason={saveIdentityDisabledReason}
                    >
                      {submitOnboardingProfile.isPending ? "Saving..." : "Save Identity"}
                    </LockedActionButton>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="legal" className="mt-3">
                <div
                  ref={legalSectionRef}
                  className="relative space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 pl-5"
                >
                  <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500" />
                  <div className="flex items-center gap-2">
                    <div className="rounded border border-rose-400/30 bg-rose-500/10 p-1 text-rose-200">
                      <FileCheck2 className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-rose-100">Legal & Approval</div>
                      <div className="text-[11px] text-rose-200/80">KYB package and binding attestations.</div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded border border-rose-500/20 bg-neutral-900/70 p-2">
                    <div className="text-xs text-rose-100">Compliance document</div>
                    <Input
                      placeholder="KYB document URL"
                      value={legalDraft.kybDocUrl}
                      onChange={(e) => setLegalDraft((prev) => ({ ...prev, kybDocUrl: e.target.value }))}
                      className="border-neutral-600 bg-neutral-900"
                    />
                  </div>

                  <div className="space-y-2 rounded border border-rose-500/20 bg-rose-500/10 p-2">
                    <div className="text-xs text-rose-100">Attestations</div>
                    <label className="flex items-center gap-2 text-xs text-rose-100">
                      <input
                        type="checkbox"
                        checked={legalDraft.agreedToAllocation}
                        onChange={(e) => setLegalDraft((prev) => ({ ...prev, agreedToAllocation: e.target.checked }))}
                      />
                      I agree to Master Allocation Agreement
                    </label>
                    <label className="flex items-center gap-2 text-xs text-rose-100">
                      <input
                        type="checkbox"
                        checked={legalDraft.agreedToNda}
                        onChange={(e) => setLegalDraft((prev) => ({ ...prev, agreedToNda: e.target.checked }))}
                      />
                      I agree to NDA terms
                    </label>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    <LockedActionButton
                      size="sm"
                      variant="outline"
                      className="border-rose-300/40 text-rose-100 hover:bg-rose-500/10"
                      onClick={() => requestContactAccess.mutate()}
                      disabled={!keyReady || requestContactAccess.isPending}
                      lockReason={
                        !keyReady
                          ? "Connect with a valid partner API key before requesting direct contact access."
                          : requestContactAccess.isPending
                            ? "Contact request is in progress."
                            : null
                      }
                    >
                      {requestContactAccess.isPending ? "Requesting..." : "Request Contact Access"}
                    </LockedActionButton>
                    <LockedActionButton
                      size="sm"
                      className="border border-rose-300/40 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30"
                      onClick={() => submitOnboardingLegal.mutate()}
                      disabled={legalSubmitDisabled}
                      lockReason={legalSubmitDisabledReason}
                    >
                      {submitOnboardingLegal.isPending ? "Submitting..." : "Submit Legal"}
                    </LockedActionButton>
                  </div>
                  {isPendingApproval ? (
                    <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
                      Pending admin approval: allocations/direct contact remain locked until approved.
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="trader-access" className="mt-3">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-100">
                  Trader access controls are below as mini-tabs. Select Data Room, Simulations, Allocations, or
                  Comms to continue.
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {showTraderAccessMiniTabs && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid h-auto w-full grid-cols-4 border border-neutral-700 bg-neutral-950/90 p-1">
              <TabsTrigger
                value="data-room"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-sky-500/15 data-[state=active]:text-sky-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <FolderKanban className="h-3.5 w-3.5" />
                Data Room
              </TabsTrigger>
              <TabsTrigger
                value="simulations"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <Beaker className="h-3.5 w-3.5" />
                Simulations
              </TabsTrigger>
              <TabsTrigger
                value="allocations"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <WalletCards className="h-3.5 w-3.5" />
                Allocations
              </TabsTrigger>
              <TabsTrigger
                value="comms"
                className="gap-1.5 py-2 text-xs text-slate-200 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-100 data-[state=active]:shadow-none sm:text-sm"
              >
                <MessageSquareLock className="h-3.5 w-3.5" />
                Comms
              </TabsTrigger>
            </TabsList>

          <TabsContent value="data-room" className="mt-3">
            {!gateViewDataRoom ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Data room access is currently gated. Complete onboarding requirements to unlock this section.</span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <div
                  className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3"
                  data-testid="partner-data-room-table"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-100">
                    <FolderKanban className="h-4 w-4" />
                    Anonymized Candidates
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="border-b border-sky-500/20 text-sky-100">
                        <tr>
                          <th className="py-2 text-left">Trader</th>
                          <th className="py-2 text-right">Score</th>
                          <th className="py-2 text-right">Sharpe</th>
                          <th className="py-2 text-right">P/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dataRoomQuery.data?.results ?? []).map((row) => (
                          <tr
                            key={row.hashId}
                            className={`cursor-pointer border-b border-neutral-800 ${
                              selectedHashId === row.hashId ? "bg-sky-500/15" : "hover:bg-sky-500/10"
                            }`}
                            onClick={() => setSelectedHashId(row.hashId)}
                          >
                            <td className="py-2">
                              <div className="font-medium">{row.hashId}</div>
                              <div className="text-[11px] text-gray-400">{row.styleCluster || "Unclassified"}</div>
                            </td>
                            <td className="py-2 text-right">{row.metrics.compositeScore?.toFixed(2) ?? "-"}</td>
                            <td className="py-2 text-right">{row.metrics.sharpeRatio?.toFixed(2) ?? "-"}</td>
                            <td className="py-2 text-right">
                              <span className={row.performance.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                                {row.performance.netProfit >= 0 ? "+" : "-"}${fmtUsd(Math.abs(row.performance.netProfit))}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {!dataRoomQuery.isLoading && (dataRoomQuery.data?.results ?? []).length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-gray-400">
                              No candidates visible for this partner key.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div
                  className="rounded-lg border border-sky-500/30 bg-neutral-900/80 p-3"
                  data-testid="partner-tear-sheet"
                >
                  <div className="mb-2 text-sm font-semibold text-sky-100">Tear Sheet</div>
                  {!selectedHashId ? (
                    <div className="text-xs text-gray-400">Select a candidate to load the tear sheet.</div>
                  ) : tearSheetQuery.isLoading ? (
                    <div className="text-xs text-gray-400">Loading tear sheet…</div>
                  ) : tearSheetQuery.data ? (
                    <div className="space-y-3 text-xs">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Trades</div>
                          <div className="text-white">{tearSheetQuery.data.summary.trades}</div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Win Rate</div>
                          <div className="text-white">{fmtPct(tearSheetQuery.data.summary.winRate)}</div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Net Profit</div>
                          <div className={tearSheetQuery.data.summary.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {tearSheetQuery.data.summary.netProfit >= 0 ? "+" : "-"}$
                            {fmtUsd(Math.abs(tearSheetQuery.data.summary.netProfit))}
                          </div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400">Composite</div>
                          <div className="text-white">{tearSheetQuery.data.metrics?.compositeScore?.toFixed(2) ?? "-"}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400 mb-1">Top Trades</div>
                          <div className="space-y-1">
                            {(tearSheetQuery.data.topTrades ?? []).slice(0, 5).map((t) => (
                              <div key={t.id} className="flex items-center justify-between">
                                <span>{t.symbol || "?"}</span>
                                <span className="text-emerald-400">+${fmtUsd(t.pnlUsd)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="rounded border border-sky-500/20 p-2">
                          <div className="text-gray-400 mb-1">Bottom Trades</div>
                          <div className="space-y-1">
                            {(tearSheetQuery.data.bottomTrades ?? []).slice(0, 5).map((t) => (
                              <div key={t.id} className="flex items-center justify-between">
                                <span>{t.symbol || "?"}</span>
                                <span className="text-red-400">-${fmtUsd(Math.abs(t.pnlUsd))}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">No tear sheet loaded.</div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="simulations" className="mt-3 space-y-3">
            {!gateRunSimulations ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Simulation actions are locked until the required onboarding gate is reached. Current reason:{" "}
                    {onboardingState?.gateEval?.runSimulations?.reason || "PARTNER_GATE_BLOCKED"}.
                  </span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-100">
                <Beaker className="h-4 w-4" />
                Run Simulation Preview
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="User hashId"
                  value={simulationDraft.userHashId}
                  onChange={(e) => setSimulationDraft((prev) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Notional USD"
                  value={simulationDraft.notionalUsd}
                  onChange={(e) => setSimulationDraft((prev) => ({ ...prev, notionalUsd: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                  inputMode="decimal"
                />
                <Input
                  placeholder="Horizon days"
                  value={simulationDraft.horizonDays}
                  onChange={(e) => setSimulationDraft((prev) => ({ ...prev, horizonDays: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                  inputMode="numeric"
                />
                <LockedActionButton
                  className="border border-violet-300/40 bg-violet-500/20 text-violet-50 hover:bg-violet-500/30"
                  onClick={() => previewSimulation.mutate()}
                  disabled={simulationPreviewDisabled}
                  lockReason={simulationPreviewDisabledReason}
                >
                  {previewSimulation.isPending ? "Simulating..." : "Run Preview"}
                </LockedActionButton>
              </div>
            </div>

            <div className="rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-emerald-500/5 p-3">
              <div className="mb-2 text-sm font-semibold text-violet-100">Simulation Result</div>
              {simulationPreview ? (
                <div className="grid gap-3 md:grid-cols-3 text-xs">
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Projected P/L</div>
                    <div className={simulationPreview.scenario.projectedPnlUsd >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {simulationPreview.scenario.projectedPnlUsd >= 0 ? "+" : "-"}$
                      {Math.abs(simulationPreview.scenario.projectedPnlUsd).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                    <div className="text-gray-400">{fmtPct(simulationPreview.scenario.projectedPnlPct)}</div>
                  </div>
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Risk / Confidence</div>
                    <div className="text-white">
                      {simulationPreview.scenario.riskBand} /{" "}
                      {(simulationPreview.scenario.confidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-gray-400">{simulationPreview.scenario.modelVersion}</div>
                  </div>
                  <div className="rounded border border-violet-500/20 p-2">
                    <div className="text-gray-400">Historical Basis</div>
                    <div className="text-white">
                      {simulationPreview.historical.trades} trades | win {fmtPct(simulationPreview.historical.winRate)}
                    </div>
                    <div className="text-gray-400">
                      Sharpe:{" "}
                      {simulationPreview.historical.sharpeRatio == null
                        ? "-"
                        : simulationPreview.historical.sharpeRatio.toFixed(2)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-400">
                  Select a candidate and run preview to generate simulated P/L and risk profile.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="allocations" className="mt-3 space-y-3">
            {!gateRequestAllocation ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Allocation actions are locked until compliance/legal onboarding is completed and approved.</span>
                  <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                    Inquire with Admin
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-100">
                <WalletCards className="h-4 w-4" />
                Create Allocation
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="User hashId"
                  value={allocationDraft.userHashId}
                  onChange={(e) => setAllocationDraft((prev) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Capital USD"
                  value={allocationDraft.capitalUsd}
                  onChange={(e) => setAllocationDraft((prev) => ({ ...prev, capitalUsd: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Shadow stop (0.03)"
                  value={allocationDraft.shadowStopPct}
                  onChange={(e) => setAllocationDraft((prev) => ({ ...prev, shadowStopPct: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <LockedActionButton
                  className="border border-emerald-300/40 bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/30"
                  onClick={() => createAllocation.mutate()}
                  disabled={createAllocationDisabled}
                  lockReason={createAllocationDisabledReason}
                >
                  {createAllocation.isPending ? "Submitting..." : "Allocate"}
                </LockedActionButton>
              </div>
            </div>

            <div
              className="rounded-lg border border-emerald-500/30 bg-neutral-900/80 p-3"
              data-testid="partner-allocations-table"
            >
              <div className="mb-2 text-sm font-semibold text-emerald-100">Allocations</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-emerald-500/20 text-emerald-100">
                    <tr>
                      <th className="py-2 text-left">Trader</th>
                      <th className="py-2 text-right">Capital</th>
                      <th className="py-2 text-right">PnL</th>
                      <th className="py-2 text-right">Status</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(allocationsQuery.data?.rows ?? []).map((row) => {
                      const nextStatus = row.status === "ACTIVE" ? "STOPPED" : "ACTIVE";
                      return (
                        <tr key={row.id} className="border-b border-neutral-800">
                          <td className="py-2">{row.userHashId}</td>
                          <td className="py-2 text-right">${fmtUsd(row.capitalUsd)}</td>
                          <td className="py-2 text-right">${fmtUsd(row.currentPnlUsd ?? 0)}</td>
                          <td className="py-2 text-right">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                                row.status === "ACTIVE"
                                  ? "border border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                                  : row.status === "STOPPED"
                                    ? "border border-amber-400/40 bg-amber-500/20 text-amber-100"
                                    : "border border-neutral-500/40 bg-neutral-700/40 text-neutral-200"
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 text-right">
                            <LockedActionButton
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() => updateAllocation.mutate({ id: row.id, status: nextStatus })}
                              disabled={!keyReady || updateAllocation.isPending || !gateRequestAllocation}
                              lockReason={
                                !keyReady
                                  ? "Connect with a valid partner API key before updating allocations."
                                  : !gateRequestAllocation
                                    ? `Allocation gate is locked (${onboardingState?.gateEval?.requestAllocation?.reason || "PARTNER_GATE_BLOCKED"}).`
                                    : updateAllocation.isPending
                                      ? "Allocation status update is in progress."
                                      : null
                              }
                            >
                              Set {nextStatus}
                            </LockedActionButton>
                          </td>
                        </tr>
                      );
                    })}
                    {!allocationsQuery.isLoading && (allocationsQuery.data?.rows ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-400">
                          No allocations for this partner key.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comms" className="mt-3 space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100">
                <MessageSquareLock className="h-4 w-4" />
                Submit Inquiry
              </div>
              <div className="mb-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
                Inbox: <span className="font-semibold">{inquiryInboxAlias}</span> | recipients:{" "}
                {inquiryRecipientsQuery.data?.participantCount ?? 0} | route:{" "}
                {inquiryRecipientsQuery.data?.routeAdminCount ?? 0} | viewers:{" "}
                {inquiryRecipientsQuery.data?.viewerAdminCount ?? 0}
                {inquiryMissingKeyCount > 0 ? (
                  <span className="text-amber-200">
                    {" "}
                    | missing mailbox keys: {inquiryMissingKeyCount} (ask admins to open Communications and complete
                    E2EE bootstrap)
                  </span>
                ) : null}
              </div>
              {!gateDirectContact ? (
                <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Direct trader contact remains locked until admin approval. This inquiry channel is the secure
                      fallback and uses client-side E2EE envelopes over HTTPS transport.
                    </span>
                    <Button size="sm" variant="outline" className="border-amber-300/40" onClick={() => openTraderAccessTab("comms")}>
                      Inquire with Admin
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <Input
                  placeholder="Optional hashId (User-...)"
                  value={inquiryDraft.userHashId}
                  onChange={(e) => setInquiryDraft((prev) => ({ ...prev, userHashId: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Sender name (optional)"
                  value={inquiryDraft.senderName}
                  onChange={(e) => setInquiryDraft((prev) => ({ ...prev, senderName: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  type="email"
                  placeholder="Sender email"
                  value={inquiryDraft.senderEmail}
                  onChange={(e) => setInquiryDraft((prev) => ({ ...prev, senderEmail: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Input
                  placeholder="Subject"
                  value={inquiryDraft.subject}
                  onChange={(e) => setInquiryDraft((prev) => ({ ...prev, subject: e.target.value }))}
                  className="border-neutral-600 bg-neutral-900"
                />
                <Textarea
                  placeholder="Inquiry body"
                  value={inquiryDraft.body}
                  onChange={(e) => setInquiryDraft((prev) => ({ ...prev, body: e.target.value }))}
                  className="min-h-[120px] border-neutral-600 bg-neutral-900"
                />
                <div className="flex justify-end">
                  <LockedActionButton
                    className="border border-amber-300/40 bg-amber-500/20 text-amber-50 hover:bg-amber-500/30"
                    onClick={() => createInquiry.mutate()}
                    disabled={inquirySendDisabled}
                    lockReason={inquirySendDisabledReason}
                  >
                    {createInquiry.isPending ? "Submitting..." : "Send Inquiry"}
                  </LockedActionButton>
                </div>
              </div>
            </div>

            <div
              className="rounded-lg border border-amber-500/30 bg-neutral-900/80 p-3"
              data-testid="partner-inquiries-table"
            >
              <div className="mb-2 text-sm font-semibold text-amber-100">Inquiry History</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-amber-500/20 text-amber-100">
                    <tr>
                      <th className="py-2 text-left">Subject</th>
                      <th className="py-2 text-left">Hash</th>
                      <th className="py-2 text-right">Status</th>
                      <th className="py-2 text-right">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(inquiriesQuery.data?.rows ?? []).map((row) => (
                      <tr key={row.id} className="border-b border-neutral-800">
                        <td className="py-2">
                          <div className="font-medium">{row.subject}</div>
                          <div className="text-[11px] text-gray-400 line-clamp-2">{row.body}</div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            {row.senderName || "Sender"} {row.senderEmail ? `(${row.senderEmail})` : ""}
                          </div>
                        </td>
                        <td className="py-2">{row.userHashId || "-"}</td>
                        <td className="py-2 text-right">{row.status}</td>
                        <td className="py-2 text-right">{fmtWhen(row.createdAt)}</td>
                      </tr>
                    ))}
                    {!inquiriesQuery.isLoading && (inquiriesQuery.data?.rows ?? []).length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400">
                          No inquiries yet for this partner key.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
          </Tabs>
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
