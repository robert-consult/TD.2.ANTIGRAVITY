import { and, eq } from "drizzle-orm";
import { db } from "@db";
import { systemConfig, users } from "@shared/schema";

const DEFAULT_INQUIRY_INBOX_ALIAS = "inquiries@";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function normalizeInboxAlias(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_INQUIRY_INBOX_ALIAS;
  return raw.slice(0, 160);
}

function normalizeEmailList(input: unknown): string[] {
  const source = Array.isArray(input)
    ? input
    : String(input ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 200) break;
  }
  return out;
}

function toCsv(values: string[]): string {
  return values.join(",");
}

export type PartnerInquiryRoutingConfig = {
  inboxAlias: string;
  routeAdminEmails: string[];
  viewerAdminEmails: string[];
};

export type PartnerInquiryAdminRecipient = {
  userId: number;
  email: string;
  username: string | null;
  name: string | null;
  mailboxPublicKey: string | null;
  mailboxPublicKeyAlgo: string | null;
};

export type ResolvedPartnerInquiryRouting = {
  config: PartnerInquiryRoutingConfig;
  routeAdmins: PartnerInquiryAdminRecipient[];
  viewerAdmins: PartnerInquiryAdminRecipient[];
  participantAdmins: PartnerInquiryAdminRecipient[];
  unresolvedRouteEmails: string[];
  unresolvedViewerEmails: string[];
  missingKeyAdminIds: number[];
};

export async function getPartnerInquiryRoutingConfig(): Promise<PartnerInquiryRoutingConfig> {
  const [cfg] = await db
    .select({
      inboxAlias: systemConfig.partnerInquiryInboxAlias,
      routeAdminEmailsCsv: systemConfig.partnerInquiryRouteAdminEmailsCsv,
      viewerAdminEmailsCsv: systemConfig.partnerInquiryViewerAdminEmailsCsv,
    })
    .from(systemConfig)
    .where(eq(systemConfig.id, 1))
    .limit(1);

  return {
    inboxAlias: normalizeInboxAlias(cfg?.inboxAlias),
    routeAdminEmails: normalizeEmailList(cfg?.routeAdminEmailsCsv ?? ""),
    viewerAdminEmails: normalizeEmailList(cfg?.viewerAdminEmailsCsv ?? ""),
  };
}

export async function upsertPartnerInquiryRoutingConfig(input: {
  inboxAlias?: unknown;
  routeAdminEmails?: unknown;
  viewerAdminEmails?: unknown;
  updatedBy?: string | null;
}): Promise<PartnerInquiryRoutingConfig> {
  const current = await getPartnerInquiryRoutingConfig();
  const inboxAlias =
    input.inboxAlias === undefined ? current.inboxAlias : normalizeInboxAlias(input.inboxAlias);
  const routeAdminEmails =
    input.routeAdminEmails === undefined
      ? current.routeAdminEmails
      : normalizeEmailList(input.routeAdminEmails);
  const viewerAdminEmails =
    input.viewerAdminEmails === undefined
      ? current.viewerAdminEmails
      : normalizeEmailList(input.viewerAdminEmails);

  const [existing] = await db.select({ id: systemConfig.id }).from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
  if (!existing) {
    await db.insert(systemConfig).values({ id: 1 });
  }

  await db
    .update(systemConfig)
    .set({
      partnerInquiryInboxAlias: inboxAlias,
      partnerInquiryRouteAdminEmailsCsv: toCsv(routeAdminEmails),
      partnerInquiryViewerAdminEmailsCsv: toCsv(viewerAdminEmails),
      updatedAt: nowSec(),
      updatedBy: String(input.updatedBy ?? "admin"),
    })
    .where(eq(systemConfig.id, 1));

  return {
    inboxAlias,
    routeAdminEmails,
    viewerAdminEmails,
  };
}

export async function resolvePartnerInquiryRouting(): Promise<ResolvedPartnerInquiryRouting> {
  const config = await getPartnerInquiryRoutingConfig();

  const adminRows = await db
    .select({
      userId: users.id,
      email: users.email,
      username: users.username,
      name: users.name,
      mailboxPublicKey: users.mailboxPublicKey,
      mailboxPublicKeyAlgo: users.mailboxPublicKeyAlgo,
    })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.isDisabled, false), eq(users.isDeleted, false)));

  const admins: PartnerInquiryAdminRecipient[] = adminRows
    .map((row) => ({
      userId: Number(row.userId),
      email: String(row.email || "").trim().toLowerCase(),
      username: row.username ?? null,
      name: row.name ?? null,
      mailboxPublicKey: row.mailboxPublicKey ? String(row.mailboxPublicKey) : null,
      mailboxPublicKeyAlgo: row.mailboxPublicKeyAlgo ? String(row.mailboxPublicKeyAlgo) : null,
    }))
    .filter((row) => Number.isInteger(row.userId) && row.userId > 0 && row.email.length > 0);

  const byEmail = new Map<string, PartnerInquiryAdminRecipient>();
  for (const admin of admins) {
    if (!byEmail.has(admin.email)) byEmail.set(admin.email, admin);
  }

  const configuredRouteAdmins: PartnerInquiryAdminRecipient[] = [];
  const unresolvedRouteEmails: string[] = [];
  for (const email of config.routeAdminEmails) {
    const hit = byEmail.get(email);
    if (!hit) {
      unresolvedRouteEmails.push(email);
      continue;
    }
    configuredRouteAdmins.push(hit);
  }

  const fallbackRouteAdmins = admins.filter(
    (row) => String(row.mailboxPublicKey || "").trim().length > 0,
  );
  const routeAdmins = configuredRouteAdmins.length
    ? configuredRouteAdmins
    : fallbackRouteAdmins.length
      ? fallbackRouteAdmins
      : admins;

  const viewerAdmins: PartnerInquiryAdminRecipient[] = [];
  const unresolvedViewerEmails: string[] = [];
  for (const email of config.viewerAdminEmails) {
    const hit = byEmail.get(email);
    if (!hit) {
      unresolvedViewerEmails.push(email);
      continue;
    }
    viewerAdmins.push(hit);
  }

  const participantAdmins: PartnerInquiryAdminRecipient[] = [];
  const seenParticipantIds = new Set<number>();
  for (const row of [...routeAdmins, ...viewerAdmins]) {
    if (seenParticipantIds.has(row.userId)) continue;
    seenParticipantIds.add(row.userId);
    participantAdmins.push(row);
  }

  const missingKeyAdminIds = participantAdmins
    .filter((row) => String(row.mailboxPublicKey || "").trim().length === 0)
    .map((row) => row.userId)
    .sort((a, b) => a - b);

  return {
    config,
    routeAdmins,
    viewerAdmins,
    participantAdmins,
    unresolvedRouteEmails,
    unresolvedViewerEmails,
    missingKeyAdminIds,
  };
}
