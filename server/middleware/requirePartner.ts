import type { NextFunction, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { partners, systemConfig } from "@shared/schema";
import { sha256Hex } from "../services/crypto";
import { getClientIp } from "../security/sessionTrail";

type PartnerAuthContext = {
  id: number;
  name: string;
  ipWhitelist: string;
  isActive: boolean;
  inviteStatus: string;
  onboardingStep: string;
  inviteExpiresAt: number | null;
  contactEmail: string | null;
  contactUsername: string | null;
};

function readPartnerKey(req: Request): string | null {
  const fromHeader = String(req.header("x-partner-key") || "").trim();
  if (fromHeader) return fromHeader;
  const auth = String(req.header("authorization") || "").trim();
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeIp(value: string | null | undefined): string {
  const ip = String(value || "").trim();
  if (!ip) return "";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function isIpAllowed(ipWhitelistCsv: string, requestIpRaw: string | null | undefined): boolean {
  const raw = String(ipWhitelistCsv || "").trim();
  if (!raw) return true;
  const list = raw
    .split(",")
    .map((v) => normalizeIp(v))
    .filter(Boolean);
  if (!list.length) return true;
  if (list.includes("*")) return true;
  const requestIp = normalizeIp(requestIpRaw);
  return list.includes(requestIp);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isSecurePartnerTransport(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.header("x-forwarded-proto") || "").trim().toLowerCase();
  return proto === "https";
}

function isLoopbackHost(req: Request): boolean {
  const host = String(req.hostname || req.header("host") || "")
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

export async function requirePartner(req: Request, res: Response, next: NextFunction) {
  try {
    const partnerKey = readPartnerKey(req);
    if (!partnerKey) {
      return res.status(401).json({ message: "PARTNER_KEY_REQUIRED" });
    }

    const [cfg] = await db
      .select({ partnerPortalEnabled: systemConfig.partnerPortalEnabled })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    if (!cfg?.partnerPortalEnabled) {
      return res.status(403).json({ message: "PARTNER_PORTAL_DISABLED" });
    }

    if (process.env.NODE_ENV === "production" && !isSecurePartnerTransport(req) && !isLoopbackHost(req)) {
      return res.status(426).json({ message: "PARTNER_HTTPS_REQUIRED" });
    }

    const apiKeyHash = sha256Hex(partnerKey);
    const [partner] = await db
      .select({
        id: partners.id,
        name: partners.name,
        ipWhitelist: partners.ipWhitelist,
        isActive: partners.isActive,
        inviteStatus: partners.inviteStatus,
        onboardingStep: partners.onboardingStep,
        inviteExpiresAt: partners.inviteExpiresAt,
        contactEmail: partners.contactEmail,
        contactUsername: partners.contactUsername,
        loginCount: partners.loginCount,
      })
      .from(partners)
      .where(and(eq(partners.apiKeyHash, apiKeyHash), eq(partners.isActive, true)))
      .limit(1);

    if (!partner) {
      return res.status(401).json({ message: "PARTNER_AUTH_FAILED" });
    }

    const requestIp = getClientIp(req);
    if (!isIpAllowed(String(partner.ipWhitelist || ""), requestIp)) {
      return res.status(403).json({ message: "PARTNER_IP_NOT_ALLOWED" });
    }

    const inviteStatus = String(partner.inviteStatus || "ACTIVE").trim().toUpperCase();
    if (inviteStatus === "REVOKED") {
      return res.status(403).json({ message: "PARTNER_REVOKED" });
    }
    const inviteExpiresAt = partner.inviteExpiresAt == null ? null : Number(partner.inviteExpiresAt);
    if (inviteStatus === "INVITED" && inviteExpiresAt != null && inviteExpiresAt < nowSec()) {
      return res.status(403).json({ message: "PARTNER_INVITE_EXPIRED" });
    }

    // Best-effort telemetry for partner key activity and password reminder logic.
    void db
      .update(partners)
      .set({
        loginCount: sql`${partners.loginCount} + 1`,
        updatedAt: nowSec(),
      } as any)
      .where(eq(partners.id, Number(partner.id)))
      .catch(() => undefined);

    (req as any).partner = {
      id: Number(partner.id),
      name: String(partner.name || ""),
      ipWhitelist: String(partner.ipWhitelist || ""),
      isActive: Boolean(partner.isActive),
      inviteStatus,
      onboardingStep: String(partner.onboardingStep || "PROFILE").trim().toUpperCase(),
      inviteExpiresAt,
      contactEmail: String(partner.contactEmail || "").trim() || null,
      contactUsername: String(partner.contactUsername || "").trim() || null,
    } satisfies PartnerAuthContext;

    return next();
  } catch (error) {
    console.error("[partner-auth] middleware failure:", error);
    return res.status(500).json({ message: "PARTNER_AUTH_INTERNAL_ERROR" });
  }
}
