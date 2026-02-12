import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, dbClient } from "@db";
import { destroyStoredSession } from "../services/sessionStore";
import { userSessions, userLoginHistory } from "@shared/schema";
import geoip from "geoip-lite";
import tzlookup from "@photostructure/tz-lookup";
import { UAParser } from "ua-parser-js";
import { normalizeIpKey } from "../grift/griftIpAsn";
import { getTrustedProxyCountryIso2, getTrustedProxyHeaderValue } from "./proxyHeaders";
import {
  IDENTITY_HEADER_CLIENT_LANG,
  IDENTITY_HEADER_CLIENT_TZ,
  IDENTITY_HEADER_DEVICE_FP,
  IDENTITY_HEADER_DEVICE_INSTALL_ID,
  readIdentityHeader,
} from "@shared/identity/headers";
import { getClientIpFromRequest, getUserAgentFromRequest } from "@shared/security/requestIdentity";

export type GeoContext = {
  countryCode?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  inferredTz?: string;
};

export type DeviceContext = {
  deviceType?: string;
  browser?: string;
  os?: string;
};

const nowUnix = () => Math.floor(Date.now() / 1000);

function cleanString(value: string | undefined, maxLen: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function parseHeaderNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCountryCode(value: string | undefined): string | undefined {
  const trimmed = cleanString(value, 8);
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : undefined;
}

export function extractGeoHints(req: any): Partial<GeoContext> {
  const countryCode = normalizeCountryCode(getTrustedProxyCountryIso2(req));
  const region = cleanString(
    getTrustedProxyHeaderValue(req, ["cf-region", "x-vercel-ip-country-region", "x-appengine-region"]),
    128
  );
  const city = cleanString(
    getTrustedProxyHeaderValue(req, ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city"]),
    128
  );
  const latitude = parseHeaderNumber(
    getTrustedProxyHeaderValue(req, ["cf-iplat", "x-vercel-ip-latitude"])
  );
  const longitude = parseHeaderNumber(
    getTrustedProxyHeaderValue(req, ["cf-iplon", "x-vercel-ip-longitude"])
  );

  return {
    countryCode,
    region,
    city,
    latitude,
    longitude,
  };
}

export function getClientIp(req: any): string {
  return getClientIpFromRequest(req as any) ?? "0.0.0.0";
}

export function getUserAgent(req: any): string {
  return getUserAgentFromRequest(req as any) ?? "unknown";
}

export function parseDevice(userAgent: string): DeviceContext {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  
  let deviceType = "desktop";
  if (result.device.type === "mobile") deviceType = "mobile";
  else if (result.device.type === "tablet") deviceType = "tablet";
  
  return {
    deviceType,
    browser: result.browser.name || "Unknown",
    os: result.os.name ? `${result.os.name} ${result.os.version || ""}`.trim() : "Unknown",
  };
}

export function buildGeoContext(ip: string, hints?: Partial<GeoContext>): GeoContext {
  const ipKey = normalizeIpKey(ip) ?? ip;
  const g = ipKey ? geoip.lookup(ipKey) : null;

  const baseLat = Array.isArray(g?.ll) ? Number(g?.ll?.[0]) : undefined;
  const baseLon = Array.isArray(g?.ll) ? Number(g?.ll?.[1]) : undefined;

  const latitude = hints?.latitude ?? baseLat;
  const longitude = hints?.longitude ?? baseLon;
  let inferredTz = hints?.inferredTz;

  if (!inferredTz && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    try {
      inferredTz = tzlookup(latitude!, longitude!);
    } catch {
      inferredTz = undefined;
    }
  }

  return {
    countryCode: hints?.countryCode ?? g?.country,
    region: hints?.region ?? g?.region,
    city: hints?.city ?? g?.city,
    latitude,
    longitude,
    inferredTz,
  };
}

export type ClientIdentityContext = {
  deviceFp?: string;
  deviceInstallId?: string;
  clientTz?: string;
  clientLang?: string;
};

export function extractClientIdentity(req: any): ClientIdentityContext {
  return {
    deviceFp: cleanString(readIdentityHeader(req.headers ?? {}, IDENTITY_HEADER_DEVICE_FP) ?? undefined, 256),
    deviceInstallId: cleanString(
      readIdentityHeader(req.headers ?? {}, IDENTITY_HEADER_DEVICE_INSTALL_ID) ?? undefined,
      128,
    ),
    clientTz: cleanString(readIdentityHeader(req.headers ?? {}, IDENTITY_HEADER_CLIENT_TZ) ?? undefined, 64),
    clientLang: cleanString(readIdentityHeader(req.headers ?? {}, IDENTITY_HEADER_CLIENT_LANG) ?? undefined, 32),
  };
}

export async function createUserSession(args: {
  sessionId: string;
  userId: number;
  email: string;
  ip: string;
  userAgent: string;
  identity?: ClientIdentityContext;
  geo?: GeoContext;
}): Promise<{ geo: GeoContext; device: DeviceContext }> {
  const nowSec = nowUnix();
  const geo = args.geo ?? buildGeoContext(args.ip);
  const device = parseDevice(args.userAgent);
  const identity = args.identity || {};

  await db.insert(userSessions).values({
    sessionId: args.sessionId,
    userId: args.userId,
    createdAt: nowSec,
    lastActiveAt: nowSec,
    ip: args.ip,
    userAgent: args.userAgent,
    deviceType: device.deviceType,
    browser: device.browser,
    os: device.os,
    isCurrent: true,
    deviceFp: identity.deviceFp || null,
    deviceInstallId: identity.deviceInstallId || null,
    clientTz: identity.clientTz || null,
    clientLang: identity.clientLang || null,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    inferredTz: geo.inferredTz || null,
  }).onConflictDoUpdate({
    target: userSessions.sessionId,
    set: {
      lastActiveAt: nowSec,
      ip: args.ip,
      userAgent: args.userAgent,
      deviceType: device.deviceType,
      browser: device.browser,
      os: device.os,
      deviceFp: identity.deviceFp || null,
      deviceInstallId: identity.deviceInstallId || null,
      clientTz: identity.clientTz || null,
      clientLang: identity.clientLang || null,
      countryCode: geo.countryCode || null,
      region: geo.region || null,
      city: geo.city || null,
      latitude: geo.latitude ?? null,
      longitude: geo.longitude ?? null,
      inferredTz: geo.inferredTz || null,
    },
  });

  await db.insert(userLoginHistory).values({
    userId: args.userId,
    email: args.email,
    ip: args.ip,
    userAgent: args.userAgent,
    success: true,
    createdAt: nowSec,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    sessionId: args.sessionId,
    eventType: "LOGIN_SUCCESS",
    deviceFp: identity.deviceFp || null,
    deviceInstallId: identity.deviceInstallId || null,
    clientTz: identity.clientTz || null,
    clientLang: identity.clientLang || null,
  });

  return { geo, device };
}

export async function recordLoginAttempt(args: {
  userId?: number;
  email: string;
  ip: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  sessionId?: string;
  identity?: ClientIdentityContext;
  geo?: GeoContext;
}): Promise<void> {
  const nowSec = nowUnix();
  const geo = args.geo ?? buildGeoContext(args.ip);
  const identity = args.identity || {};

  await db.insert(userLoginHistory).values({
    userId: args.userId || null,
    email: args.email,
    ip: args.ip,
    userAgent: args.userAgent,
    success: args.success,
    failureReason: args.failureReason || null,
    createdAt: nowSec,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null,
    latitude: geo.latitude ?? null,
    longitude: geo.longitude ?? null,
    sessionId: args.sessionId || null,
    eventType: args.success ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
    deviceFp: identity.deviceFp || null,
    deviceInstallId: identity.deviceInstallId || null,
    clientTz: identity.clientTz || null,
    clientLang: identity.clientLang || null,
  });
}

export async function touchSession(sessionId: string): Promise<void> {
  await db.update(userSessions)
    .set({ lastActiveAt: nowUnix() })
    .where(and(eq(userSessions.sessionId, sessionId), isNull(userSessions.revokedAt)));
}

export async function endSession(args: {
  userId: number;
  sessionId: string;
  ip?: string;
  userAgent?: string;
  geo?: GeoContext;
}): Promise<void> {
  const nowSec = nowUnix();
  const [session] = await db.select().from(userSessions)
    .where(eq(userSessions.sessionId, args.sessionId))
    .limit(1);

  if (session) {
    const createdAtSec = typeof session.createdAt === "number"
      ? session.createdAt
      : Math.floor(new Date(session.createdAt as any).getTime() / 1000);
    const sessionLengthSec = createdAtSec ? Math.max(0, nowSec - createdAtSec) : null;

    await db.update(userLoginHistory)
      .set({ 
        logoutAt: nowSec,
        sessionLengthSec,
      })
      .where(and(
        eq(userLoginHistory.sessionId, args.sessionId),
        eq(userLoginHistory.eventType, "LOGIN_SUCCESS")
      ));
  }

  await db.delete(userSessions)
    .where(and(eq(userSessions.sessionId, args.sessionId), eq(userSessions.userId, args.userId)))
    ;

  const geo = args.geo ?? (args.ip ? buildGeoContext(args.ip) : {});
  await db.insert(userLoginHistory).values({
    userId: args.userId,
    email: "",
    ip: args.ip || null,
    userAgent: args.userAgent || null,
    success: true,
    createdAt: nowSec,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null,
    sessionId: args.sessionId,
    eventType: "LOGOUT",
  });
}

export async function revokeSession(args: {
  actorUserId: number;
  targetUserId: number;
  sessionId: string;
  reason?: string;
}): Promise<void> {
  const nowSec = nowUnix();

  await db.update(userSessions)
    .set({
      revokedAt: nowSec,
      revokedByUserId: args.actorUserId,
      revokeReason: args.reason || "revoked",
    })
    .where(and(eq(userSessions.sessionId, args.sessionId), eq(userSessions.userId, args.targetUserId)))
    ;

  await db.insert(userLoginHistory).values({
    userId: args.targetUserId,
    email: "",
    ip: null,
    userAgent: null,
    success: true,
    createdAt: nowSec,
    sessionId: args.sessionId,
    eventType: "SESSION_REVOKED",
  });

  try {
    await destroyStoredSession(String(args.sessionId));
  } catch (e) {
    console.error("Failed to delete session from session store:", e);
  }
}

export async function revokeAllSessionsForUser(args: {
  actorUserId: number;
  targetUserId: number;
  reason?: string;
}): Promise<{ revoked: number }> {
  const sessions = await db
    .select({ sessionId: userSessions.sessionId })
    .from(userSessions)
    .where(and(eq(userSessions.userId, args.targetUserId), isNull(userSessions.revokedAt)));

  for (const s of sessions) {
    try {
      await revokeSession({
        actorUserId: args.actorUserId,
        targetUserId: args.targetUserId,
        sessionId: s.sessionId,
        reason: args.reason,
      });
    } catch (e) {
      console.error("Failed to revoke session:", e);
    }
  }

  return { revoked: sessions.length };
}

export async function getRecentLoginActivity(args: { userId: number; limit: number }) {
  return await db
    .select({
      id: userLoginHistory.id,
      eventType: userLoginHistory.eventType,
      eventAt: userLoginHistory.createdAt,
      ip: userLoginHistory.ip,
      userAgent: userLoginHistory.userAgent,
      countryCode: userLoginHistory.countryCode,
      region: userLoginHistory.region,
      city: userLoginHistory.city,
      sessionId: userLoginHistory.sessionId,
      success: userLoginHistory.success,
      failureReason: userLoginHistory.failureReason,
    })
    .from(userLoginHistory)
    .where(eq(userLoginHistory.userId, args.userId))
    .orderBy(desc(userLoginHistory.createdAt))
    .limit(args.limit);
}

export async function getActiveSessions(args: { userId: number; limit: number }) {
  return await db
    .select({
      id: userSessions.id,
      sessionId: userSessions.sessionId,
      createdAt: userSessions.createdAt,
      lastActiveAt: userSessions.lastActiveAt,
      ip: userSessions.ip,
      userAgent: userSessions.userAgent,
      deviceType: userSessions.deviceType,
      browser: userSessions.browser,
      os: userSessions.os,
      countryCode: userSessions.countryCode,
      region: userSessions.region,
      city: userSessions.city,
      inferredTz: userSessions.inferredTz,
      isCurrent: userSessions.isCurrent,
      revokedAt: userSessions.revokedAt,
    })
    .from(userSessions)
    .where(and(eq(userSessions.userId, args.userId), isNull(userSessions.revokedAt)))
    .orderBy(desc(userSessions.lastActiveAt))
    .limit(args.limit);
}

export async function getAllSessions(args: { userId: number; limit: number; includeRevoked?: boolean }) {
  const whereClause = args.includeRevoked
    ? eq(userSessions.userId, args.userId)
    : and(eq(userSessions.userId, args.userId), isNull(userSessions.revokedAt));

  return await db
    .select({
      id: userSessions.id,
      sessionId: userSessions.sessionId,
      createdAt: userSessions.createdAt,
      lastActiveAt: userSessions.lastActiveAt,
      ip: userSessions.ip,
      userAgent: userSessions.userAgent,
      deviceType: userSessions.deviceType,
      browser: userSessions.browser,
      os: userSessions.os,
      countryCode: userSessions.countryCode,
      region: userSessions.region,
      city: userSessions.city,
      inferredTz: userSessions.inferredTz,
      isCurrent: userSessions.isCurrent,
      revokedAt: userSessions.revokedAt,
      revokedByUserId: userSessions.revokedByUserId,
      revokeReason: userSessions.revokeReason,
    })
    .from(userSessions)
    .where(whereClause)
    .orderBy(desc(userSessions.lastActiveAt))
    .limit(args.limit);
}

export function formatLocation(row: { city?: string | null; region?: string | null; countryCode?: string | null }): string {
  const parts = [row.city, row.region, row.countryCode].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown";
}
