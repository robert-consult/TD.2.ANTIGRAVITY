import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useMailboxE2eeBootstrap } from "@/hooks/use-mailbox";
import ScoutChallengesPanel from "@/components/admin/ScoutChallengesPanel";
import { FeatureErrorBoundary } from "@/components/app/FeatureErrorBoundary";

export const PIPELINE_STAGES = [
  "DETECTED",
  "WATCHLIST",
  "CONTACTED",
  "VETTED_EMAIL",
  "VETTED_SMS",
  "PERFORMER",
  "SELECTED_KYC",
  "PARTNER_READY",
] as const;

export const LEADERBOARD_MODES = ["PUBLIC", "TOP_10", "DISABLED"] as const;
export const PARTNER_GATE_LEVEL_OPTIONS = ["INVITED", "IDENTITY", "COMPLIANT", "ADMIN_APPROVED"] as const;
export type PartnerGateLevel = (typeof PARTNER_GATE_LEVEL_OPTIONS)[number];
export type PartnerGateDraft = {
  viewDataRoom: PartnerGateLevel;
  runSimulations: PartnerGateLevel;
  requestAllocation: PartnerGateLevel;
  directContact: PartnerGateLevel;
};

export type CandidateRow = {
  userId: number;
  username: string | null;
  email: string | null;
  name: string | null;
  userTier: string | null;
  kycStatus: string | null;
  stage: string;
  isPartnerVisible: boolean;
  performance: {
    trades: number;
    netProfit: number;
    winRate: number;
  };
  metrics: {
    sharpeRatio: number | null;
    compositeScore: number | null;
    styleCluster: string | null;
  };
  watchlist: {
    id: number;
    tier: string;
    notes: string | null;
  } | null;
};

export type CandidateDetailRow = {
  userId: number;
  email: string | null;
  username: string | null;
  name: string | null;
  userTier: string | null;
  kycStatus: string | null;
  createdAt: number | null;
  countryIso2: string | null;
  regionKey: string | null;
  verification: {
    emailVerifiedAt: number | null;
    smsVerifiedAt: number | null;
    contenderTier: string | null;
  };
  pipeline: {
    stage: string;
    assignedAdminId: number | null;
    lastContactedAt: number | null;
    notes: string | null;
    isPartnerVisible: boolean;
    updatedAt: number | null;
  };
  watchlist: {
    id: number;
    tier: string;
    notes: string | null;
  } | null;
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
  };
  performance: {
    days: number;
    trades: number;
    netProfit: number;
    winRate: number;
    avgHoldSec: number;
    grossProfit: number;
    grossLoss: number;
    maxDrawdown: number;
  };
  equityCurve: Array<{ day: string; equity: number; pnl: number }>;
  attributionBySymbol: Array<{
    symbol: string;
    category: string;
    trades: number;
    netProfit: number;
    winRate: number;
  }>;
  attributionByHourUtc: Array<{
    hourUtc: number;
    trades: number;
    netProfit: number;
    winRate: number;
  }>;
};

export type ScoutConfig = {
  scoutTabEnabled: boolean;
  partnerPortalEnabled: boolean;
  traderProProfilesEnabled: boolean;
  traderCompeteEnabled: boolean;
  traderCommunityEnabled: boolean;
  partnerAllocationsEnabled: boolean;
  partnerGatingConfig: {
    viewDataRoom: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
    runSimulations: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
    requestAllocation: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
    directContact: "INVITED" | "IDENTITY" | "COMPLIANT" | "ADMIN_APPROVED";
  };
  partnerPasswordRotationDays: number;
  partnerPasswordReminderLogins: number;
  partnerInviteDefaultExpiryDays: number;
  leaderboardMode: (typeof LEADERBOARD_MODES)[number];
  scoutMinSharpeAlert: number;
};

export type WatchlistRow = {
  id: number;
  userId: number;
  tier: string;
  notes: string | null;
  user: {
    username: string | null;
    email: string | null;
    name: string | null;
  };
  pipeline: {
    stage: string;
    isPartnerVisible: boolean;
  };
  metrics: {
    sharpeRatio: number | null;
    compositeScore: number | null;
    styleCluster: string | null;
  };
};

export type PartnerRow = {
  id: number;
  name: string;
  api_key_prefix: string | null;
  ip_whitelist: string;
  is_active: boolean;
  contact_email: string | null;
  contact_username: string | null;
  invite_status: string | null;
  onboarding_step: string | null;
  invite_expires_at: number | null;
  approved_at: number | null;
  gating_overrides: string | null;
  latest_invite_email_status: string | null;
  allocation_count: number;
  inquiry_count: number;
  updated_at: number;
};

export type InquiryRoutingAdminRow = {
  userId: number;
  email: string;
  username: string | null;
  name: string | null;
  routeRecipient: boolean;
  viewerRecipient: boolean;
  hasMailboxKey: boolean;
  mailboxPublicKeyUpdatedAt: number | null;
};

export type InquiryRoutingResp = {
  ok: boolean;
  config: {
    inboxAlias: string;
    routeAdminEmails: string[];
    viewerAdminEmails: string[];
  };
  resolved: {
    routeAdminCount: number;
    viewerAdminCount: number;
    participantAdminCount: number;
    unresolvedRouteEmails: string[];
    unresolvedViewerEmails: string[];
    missingKeyAdminIds: number[];
  };
  messaging: {
    messagingEnabled: boolean;
    messagingE2eeEnabled: boolean;
    messagingE2eeRequired: boolean;
  };
  availableAdmins: InquiryRoutingAdminRow[];
};

export type ScoutInquiryRow = {
  id: number;
  partnerId: number;
  partnerName: string | null;
  userHashId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  subject: string | null;
  body: string | null;
  status: string | null;
  mailboxThreadId: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export type ScoutInquiryListResp = {
  ok: boolean;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  rows: ScoutInquiryRow[];
};

export type ScoutMailboxMessage = {
  id: number;
  senderIsAdmin: boolean | null;
  senderUsername: string | null;
  senderEmail: string | null;
  body: string;
  createdAt: number;
};

export type ScoutMailboxThreadResp = {
  thread: { threadId: number; subject: string };
  messages: ScoutMailboxMessage[];
};

export type InquiryRoutingDraft = {
  inboxAlias: string;
  routeAdminEmails: string[];
  viewerAdminEmails: string[];
};

export type CrmDraft = {
  stage: string;
  isPartnerVisible: boolean;
  tier: string;
  notes: string;
};

export const candidateRowSchema: z.ZodType<CandidateRow> = z.object({
  userId: z.number(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  userTier: z.string().nullable(),
  kycStatus: z.string().nullable(),
  stage: z.string(),
  isPartnerVisible: z.boolean(),
  performance: z.object({
    trades: z.number(),
    netProfit: z.number(),
    winRate: z.number(),
  }),
  metrics: z.object({
    sharpeRatio: z.number().nullable(),
    compositeScore: z.number().nullable(),
    styleCluster: z.string().nullable(),
  }),
  watchlist: z
    .object({
      id: z.number(),
      tier: z.string(),
      notes: z.string().nullable(),
    })
    .nullable(),
});

export const watchlistRowSchema: z.ZodType<WatchlistRow> = z.object({
  id: z.number(),
  userId: z.number(),
  tier: z.string(),
  notes: z.string().nullable(),
  user: z.object({
    username: z.string().nullable(),
    email: z.string().nullable(),
    name: z.string().nullable(),
  }),
  pipeline: z.object({
    stage: z.string(),
    isPartnerVisible: z.boolean(),
  }),
  metrics: z.object({
    sharpeRatio: z.number().nullable(),
    compositeScore: z.number().nullable(),
    styleCluster: z.string().nullable(),
  }),
});

export const candidateDetailRowSchema: z.ZodType<CandidateDetailRow> = z.object({
  userId: z.number(),
  email: z.string().nullable(),
  username: z.string().nullable(),
  name: z.string().nullable(),
  userTier: z.string().nullable(),
  kycStatus: z.string().nullable(),
  createdAt: z.number().nullable(),
  countryIso2: z.string().nullable(),
  regionKey: z.string().nullable(),
  verification: z.object({
    emailVerifiedAt: z.number().nullable(),
    smsVerifiedAt: z.number().nullable(),
    contenderTier: z.string().nullable(),
  }),
  pipeline: z.object({
    stage: z.string(),
    assignedAdminId: z.number().nullable(),
    lastContactedAt: z.number().nullable(),
    notes: z.string().nullable(),
    isPartnerVisible: z.boolean(),
    updatedAt: z.number().nullable(),
  }),
  watchlist: z
    .object({
      id: z.number(),
      tier: z.string(),
      notes: z.string().nullable(),
    })
    .nullable(),
  metrics: z.object({
    sharpeRatio: z.number().nullable(),
    sortinoRatio: z.number().nullable(),
    calmarRatio: z.number().nullable(),
    equityCurveR2: z.number().nullable(),
    avgMae: z.number().nullable(),
    avgMfe: z.number().nullable(),
    styleCluster: z.string().nullable(),
    compositeScore: z.number().nullable(),
    calculatedAt: z.number().nullable(),
  }),
  performance: z.object({
    days: z.number(),
    trades: z.number(),
    netProfit: z.number(),
    winRate: z.number(),
    avgHoldSec: z.number(),
    grossProfit: z.number(),
    grossLoss: z.number(),
    maxDrawdown: z.number(),
  }),
  equityCurve: z.array(
    z.object({
      day: z.string(),
      equity: z.number(),
      pnl: z.number(),
    }),
  ),
  attributionBySymbol: z.array(
    z.object({
      symbol: z.string(),
      category: z.string(),
      trades: z.number(),
      netProfit: z.number(),
      winRate: z.number(),
    }),
  ),
  attributionByHourUtc: z.array(
    z.object({
      hourUtc: z.number(),
      trades: z.number(),
      netProfit: z.number(),
      winRate: z.number(),
    }),
  ),
});

export const scoutConfigSchema: z.ZodType<ScoutConfig> = z.object({
  scoutTabEnabled: z.boolean(),
  partnerPortalEnabled: z.boolean(),
  traderProProfilesEnabled: z.boolean(),
  traderCompeteEnabled: z.boolean(),
  traderCommunityEnabled: z.boolean(),
  partnerAllocationsEnabled: z.boolean(),
  partnerGatingConfig: z.object({
    viewDataRoom: z.enum(PARTNER_GATE_LEVEL_OPTIONS),
    runSimulations: z.enum(PARTNER_GATE_LEVEL_OPTIONS),
    requestAllocation: z.enum(PARTNER_GATE_LEVEL_OPTIONS),
    directContact: z.enum(PARTNER_GATE_LEVEL_OPTIONS),
  }),
  partnerPasswordRotationDays: z.number(),
  partnerPasswordReminderLogins: z.number(),
  partnerInviteDefaultExpiryDays: z.number(),
  leaderboardMode: z.enum(LEADERBOARD_MODES),
  scoutMinSharpeAlert: z.number(),
});

export const partnerRowSchema: z.ZodType<PartnerRow> = z.object({
  id: z.number(),
  name: z.string(),
  api_key_prefix: z.string().nullable(),
  ip_whitelist: z.string(),
  is_active: z.boolean(),
  contact_email: z.string().nullable(),
  contact_username: z.string().nullable(),
  invite_status: z.string().nullable(),
  onboarding_step: z.string().nullable(),
  invite_expires_at: z.number().nullable(),
  approved_at: z.number().nullable(),
  gating_overrides: z.string().nullable(),
  latest_invite_email_status: z.string().nullable(),
  allocation_count: z.number(),
  inquiry_count: z.number(),
  updated_at: z.number(),
});

export const inquiryRoutingRespSchema: z.ZodType<InquiryRoutingResp> = z.object({
  ok: z.boolean(),
  config: z.object({
    inboxAlias: z.string(),
    routeAdminEmails: z.array(z.string()),
    viewerAdminEmails: z.array(z.string()),
  }),
  resolved: z.object({
    routeAdminCount: z.number(),
    viewerAdminCount: z.number(),
    participantAdminCount: z.number(),
    unresolvedRouteEmails: z.array(z.string()),
    unresolvedViewerEmails: z.array(z.string()),
    missingKeyAdminIds: z.array(z.number()),
  }),
  messaging: z.object({
    messagingEnabled: z.boolean(),
    messagingE2eeEnabled: z.boolean(),
    messagingE2eeRequired: z.boolean(),
  }),
  availableAdmins: z.array(
    z.object({
      userId: z.number(),
      email: z.string(),
      username: z.string().nullable(),
      name: z.string().nullable(),
      routeRecipient: z.boolean(),
      viewerRecipient: z.boolean(),
      hasMailboxKey: z.boolean(),
      mailboxPublicKeyUpdatedAt: z.number().nullable(),
    }),
  ),
});

export const scoutInquiryListRespSchema: z.ZodType<ScoutInquiryListResp> = z.object({
  ok: z.boolean(),
  limit: z.number(),
  offset: z.number(),
  total: z.number(),
  hasMore: z.boolean(),
  rows: z.array(
    z.object({
      id: z.number(),
      partnerId: z.number(),
      partnerName: z.string().nullable(),
      userHashId: z.string().nullable(),
      senderName: z.string().nullable(),
      senderEmail: z.string().nullable(),
      subject: z.string().nullable(),
      body: z.string().nullable(),
      status: z.string().nullable(),
      mailboxThreadId: z.number().nullable(),
      createdAt: z.number().nullable(),
      updatedAt: z.number().nullable(),
    }),
  ),
});

export const scoutMailboxThreadRespSchema: z.ZodType<ScoutMailboxThreadResp> = z.object({
  thread: z.object({
    threadId: z.number(),
    subject: z.string(),
  }),
  messages: z.array(
    z.object({
      id: z.number(),
      senderIsAdmin: z.boolean().nullable(),
      senderUsername: z.string().nullable(),
      senderEmail: z.string().nullable(),
      body: z.string(),
      createdAt: z.number(),
    }),
  ),
});

export const candidatesRespSchema = z.object({
  results: z.array(candidateRowSchema),
  total: z.number(),
});

export const watchlistRespSchema = z.object({
  rows: z.array(watchlistRowSchema),
});

export const candidateDetailRespSchema = z.object({
  row: candidateDetailRowSchema,
});

export const configRespSchema = z.object({
  config: scoutConfigSchema,
});

export const partnersRespSchema = z.object({
  rows: z.array(partnerRowSchema),
});

export const partnerCreateRespSchema = z.object({
  ok: z.boolean(),
  apiKey: z.string().optional(),
});

export const partnerInviteRespSchema = z.object({
  ok: z.boolean(),
  invite: z
    .object({
      emailStatus: z.string().optional(),
    })
    .optional(),
  credentials: z
    .object({
      username: z.string().optional(),
      tempPassword: z.string().optional(),
      apiKey: z.string().optional(),
    })
    .optional(),
});

export const partnerPatchRespSchema = z.object({
  ok: z.boolean(),
  apiKey: z.string().optional(),
});

export const genericMutationRespSchema = z.object({
  ok: z.boolean().optional(),
});

export function parseApiPayload<T>(schema: z.ZodType<T>, data: unknown, messageCode: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  throw new Error(messageCode);
}

export function readApiErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (axios.isAxiosError(error)) {
    const apiMessage = error.response?.data?.message;
    if (typeof apiMessage === "string" && apiMessage.trim().length > 0) return apiMessage.trim();
    if (typeof error.message === "string" && error.message.trim().length > 0) return error.message.trim();
    return null;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return null;
}

export function createIdempotencyKey(scope: string): string {
  const prefix = String(scope || "mutation").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-") || "mutation";
  try {
    const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}:${uuid}`;
  } catch {
    return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "$0";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString()}`;
}

export function formatWhen(utcSec: number | null | undefined): string {
  if (!utcSec || !Number.isFinite(utcSec)) return "-";
  return new Date(utcSec * 1000).toLocaleString();
}

export function clampInviteExpiryDays(value: unknown, fallback = 7): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.min(180, Number(fallback) || 7));
  return Math.max(1, Math.min(180, Math.trunc(parsed)));
}

export const DEFAULT_PARTNER_GATE_DRAFT: PartnerGateDraft = {
  viewDataRoom: "INVITED",
  runSimulations: "IDENTITY",
  requestAllocation: "COMPLIANT",
  directContact: "ADMIN_APPROVED",
};

export function parsePartnerGateDraft(raw: unknown, fallback: PartnerGateDraft): PartnerGateDraft {
  const base = { ...fallback };
  if (!raw) return base;
  let input: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      return base;
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    input = raw as Record<string, unknown>;
  } else {
    return base;
  }

  const normalize = (value: unknown, defaultValue: PartnerGateLevel): PartnerGateLevel => {
    const upper = String(value || "").trim().toUpperCase();
    return (PARTNER_GATE_LEVEL_OPTIONS as readonly string[]).includes(upper) ? (upper as PartnerGateLevel) : defaultValue;
  };

  return {
    viewDataRoom: normalize(input.viewDataRoom, base.viewDataRoom),
    runSimulations: normalize(input.runSimulations, base.runSimulations),
    requestAllocation: normalize(input.requestAllocation, base.requestAllocation),
    directContact: normalize(input.directContact, base.directContact),
  };
}

