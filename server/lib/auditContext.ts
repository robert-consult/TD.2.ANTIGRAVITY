/**
 * Audit Context Helper
 * Extracts user provenance from Express requests for institutional-grade audit logging
 */

import crypto from "crypto";
import type { Request } from "express";

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

export function getClientIp(req: Request): string | null {
  const xfwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return xfwd || req.ip || (req.socket?.remoteAddress ?? null);
}

export function getUserAgent(req: Request): string | null {
  return (req.headers?.["user-agent"] as string | undefined) || null;
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
