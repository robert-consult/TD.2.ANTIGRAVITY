/**
 * Audit Context Helper
 * Extracts user provenance from Express requests for institutional-grade audit logging
 */

import crypto from "crypto";
import type { Request } from "express";
import { normalizeIpKey } from "../grift/griftIpAsn";

export type ActorType = "USER" | "ADMIN" | "SYSTEM";

export interface AuditContext {
  correlationId: string;
  actorType: ActorType;
  actorUserId: number | null;
  userId: number | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
}

function readHeader(req: Request, name: string): string | undefined {
  const v = req.headers?.[name as keyof typeof req.headers] ?? req.headers?.[name.toLowerCase() as keyof typeof req.headers];
  if (!v) return undefined;
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function cleanString(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function isPrivateIp(ip: string): boolean {
  const key = normalizeIpKey(ip) ?? ip;
  if (!key) return true;
  if (key === "::1") return true;
  if (key.startsWith("fe80:")) return true;
  if (key.startsWith("fc") || key.startsWith("fd")) return true;

  const m = key.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function parseForwardedFor(value: string | undefined): string[] {
  if (!value) return [];
  const forMatches = value.match(/for=([^;,\s]+)/gi);
  if (!forMatches) return [];
  return forMatches
    .map((part) => part.replace(/for=/i, "").replace(/"/g, "").trim())
    .filter(Boolean);
}

export function getClientIp(req: Request): string | null {
  const candidates: string[] = [];
  const cfIp = readHeader(req, "cf-connecting-ip");
  if (cfIp) candidates.push(cfIp);

  const trueClientIp = readHeader(req, "true-client-ip") ?? readHeader(req, "x-client-ip");
  if (trueClientIp) candidates.push(trueClientIp);

  const xff = readHeader(req, "x-forwarded-for");
  if (xff) {
    candidates.push(
      ...xff
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    );
  }

  const forwarded = readHeader(req, "forwarded");
  if (forwarded) candidates.push(...parseForwardedFor(forwarded));

  const xRealIp = readHeader(req, "x-real-ip");
  if (xRealIp) candidates.push(xRealIp);

  if (req.ip) candidates.push(String(req.ip));
  if (req.socket?.remoteAddress) candidates.push(String(req.socket.remoteAddress));

  const normalized = candidates
    .map((ip) => normalizeIpKey(ip))
    .filter(Boolean) as string[];

  if (normalized.length === 0) return candidates[0] ?? null;
  const publicIp = normalized.find((ip) => !isPrivateIp(ip));
  return publicIp || normalized[0] || candidates[0] || null;
}

export function getUserAgent(req: Request): string | null {
  const ua = cleanString(readHeader(req, "user-agent"), 512);
  if (ua) return ua;
  const chUa = cleanString(readHeader(req, "sec-ch-ua"), 512);
  const platform = cleanString(readHeader(req, "sec-ch-ua-platform"), 128);
  const mobile = cleanString(readHeader(req, "sec-ch-ua-mobile"), 16);
  const fallback = [chUa, platform ? `platform=${platform}` : null, mobile ? `mobile=${mobile}` : null]
    .filter(Boolean)
    .join(" ");
  return fallback || null;
}

export function getSessionId(req: any): string | null {
  return req.sessionID || req.session?.id || req.headers["x-session-id"] || null;
}

export function inferActorType(req: any): ActorType {
  const isAdmin = req.session?.isAdmin === true;
  if (isAdmin) return "ADMIN";
  if (req.session?.userId) return "USER";
  return "SYSTEM";
}

export function getOrCreateCorrelationId(req?: Request): string {
  if (!req) return crypto.randomUUID();
  const h = req.header?.("x-correlation-id");
  const b = (req.body as any)?.correlationId || (req.body as any)?.correlation_id;
  const existing = (h || b || "").toString().trim();
  return existing || crypto.randomUUID();
}

export function buildAuditContext(req: any, overrides?: Partial<AuditContext>): AuditContext {
  const base: AuditContext = {
    correlationId: getOrCreateCorrelationId(req),
    actorType: inferActorType(req),
    actorUserId: req.session?.userId ? Number(req.session.userId) : null,
    userId: req.session?.userId ? Number(req.session.userId) : null,
    sessionId: getSessionId(req),
    ip: getClientIp(req),
    userAgent: (req.headers?.["user-agent"] as string | undefined) || null,
  };
  return { ...base, ...(overrides || {}) };
}

export function buildSystemContext(correlationId?: string): AuditContext {
  return {
    correlationId: correlationId || crypto.randomUUID(),
    actorType: "SYSTEM",
    actorUserId: null,
    userId: null,
    sessionId: null,
    ip: null,
    userAgent: null,
  };
}
