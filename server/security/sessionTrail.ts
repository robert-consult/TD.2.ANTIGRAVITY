import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@db";
import { userSessions, userLoginHistory } from "@shared/schema";
import geoip from "geoip-lite";
import tzlookup from "@photostructure/tz-lookup";
import { UAParser } from "ua-parser-js";
import BetterSQLite3 from "better-sqlite3";

const sessionsDb = new BetterSQLite3("./sessions.db");
try {
  sessionsDb.pragma("journal_mode = WAL");
} catch {}
try {
  sessionsDb.pragma("busy_timeout = 5000");
} catch {}

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

export function getClientIp(req: any): string {
  const readHeader = (name: string): string | undefined => {
    const v = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
    if (!v) return undefined;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return String(v);
  };

  const cfIp = readHeader("cf-connecting-ip");
  if (cfIp) return cfIp;

  const xff = readHeader("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const xRealIp = readHeader("x-real-ip");
  if (xRealIp) return xRealIp;

  return req.ip || req.socket?.remoteAddress || "0.0.0.0";
}

export function getUserAgent(req: any): string {
  return String(req.headers?.["user-agent"] || "unknown");
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

export function buildGeoContext(ip: string): GeoContext {
  const g = geoip.lookup(ip);
  if (!g) return {};

  const latitude = Array.isArray(g.ll) ? Number(g.ll[0]) : undefined;
  const longitude = Array.isArray(g.ll) ? Number(g.ll[1]) : undefined;

  let inferredTz: string | undefined;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    try {
      inferredTz = tzlookup(latitude!, longitude!);
    } catch {
      inferredTz = undefined;
    }
  }

  return {
    countryCode: g.country,
    region: g.region,
    city: g.city,
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
  const readHeader = (name: string): string | undefined => {
    const v = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
    if (!v) return undefined;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return String(v);
  };
  return {
    deviceFp: readHeader("x-device-fp"),
    deviceInstallId: readHeader("x-device-install-id"),
    clientTz: readHeader("x-client-tz"),
    clientLang: readHeader("x-client-lang"),
  };
}

export function createUserSession(args: {
  sessionId: string;
  userId: number;
  email: string;
  ip: string;
  userAgent: string;
  identity?: ClientIdentityContext;
}): { geo: GeoContext; device: DeviceContext } {
  const now = new Date();
  const geo = buildGeoContext(args.ip);
  const device = parseDevice(args.userAgent);
  const identity = args.identity || {};

  db.insert(userSessions).values({
    sessionId: args.sessionId,
    userId: args.userId,
    createdAt: now,
    lastActiveAt: now,
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
      lastActiveAt: now,
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
  }).run();

  db.insert(userLoginHistory).values({
    userId: args.userId,
    email: args.email,
    ip: args.ip,
    userAgent: args.userAgent,
    success: true,
    createdAt: now,
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
  }).run();

  return { geo, device };
}

export function recordLoginAttempt(args: {
  userId?: number;
  email: string;
  ip: string;
  userAgent: string;
  success: boolean;
  failureReason?: string;
  sessionId?: string;
  identity?: ClientIdentityContext;
}): void {
  const now = new Date();
  const geo = buildGeoContext(args.ip);
  const identity = args.identity || {};

  db.insert(userLoginHistory).values({
    userId: args.userId || null,
    email: args.email,
    ip: args.ip,
    userAgent: args.userAgent,
    success: args.success,
    failureReason: args.failureReason || null,
    createdAt: now,
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
  }).run();
}

export function touchSession(sessionId: string): void {
  db.update(userSessions)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(userSessions.sessionId, sessionId), isNull(userSessions.revokedAt)))
    .run();
}

export function endSession(args: {
  userId: number;
  sessionId: string;
  ip?: string;
  userAgent?: string;
}): void {
  const now = new Date();
  const session = db.select().from(userSessions)
    .where(eq(userSessions.sessionId, args.sessionId))
    .get();

  if (session) {
    const sessionLengthSec = session.createdAt 
      ? Math.floor((now.getTime() - new Date(session.createdAt).getTime()) / 1000)
      : null;

    db.update(userLoginHistory)
      .set({ 
        logoutAt: now,
        sessionLengthSec,
      })
      .where(and(
        eq(userLoginHistory.sessionId, args.sessionId),
        eq(userLoginHistory.eventType, "LOGIN_SUCCESS")
      ))
      .run();
  }

  db.delete(userSessions)
    .where(and(eq(userSessions.sessionId, args.sessionId), eq(userSessions.userId, args.userId)))
    .run();

  const geo = args.ip ? buildGeoContext(args.ip) : {};
  db.insert(userLoginHistory).values({
    userId: args.userId,
    email: "",
    ip: args.ip || null,
    userAgent: args.userAgent || null,
    success: true,
    createdAt: now,
    countryCode: geo.countryCode || null,
    region: geo.region || null,
    city: geo.city || null,
    sessionId: args.sessionId,
    eventType: "LOGOUT",
  }).run();
}

export function revokeSession(args: {
  actorUserId: number;
  targetUserId: number;
  sessionId: string;
  reason?: string;
}): void {
  const now = new Date();

  db.update(userSessions)
    .set({
      revokedAt: now,
      revokedByUserId: args.actorUserId,
      revokeReason: args.reason || "revoked",
    })
    .where(and(eq(userSessions.sessionId, args.sessionId), eq(userSessions.userId, args.targetUserId)))
    .run();

  db.insert(userLoginHistory).values({
    userId: args.targetUserId,
    email: "",
    ip: null,
    userAgent: null,
    success: true,
    createdAt: now,
    sessionId: args.sessionId,
    eventType: "SESSION_REVOKED",
  }).run();

  try {
    sessionsDb.prepare("DELETE FROM sessions WHERE sid = ?").run(args.sessionId);
  } catch (e) {
    console.error("Failed to delete session from session store:", e);
  }
}

export function revokeAllSessionsForUser(args: {
  actorUserId: number;
  targetUserId: number;
  reason?: string;
}): { revoked: number } {
  const sessions = db
    .select({ sessionId: userSessions.sessionId })
    .from(userSessions)
    .where(and(eq(userSessions.userId, args.targetUserId), isNull(userSessions.revokedAt)))
    .all();

  for (const s of sessions) {
    try {
      revokeSession({
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

export function getRecentLoginActivity(args: { userId: number; limit: number }) {
  return db
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
    .limit(args.limit)
    .all();
}

export function getActiveSessions(args: { userId: number; limit: number }) {
  return db
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
    .limit(args.limit)
    .all();
}

export function getAllSessions(args: { userId: number; limit: number; includeRevoked?: boolean }) {
  const whereClause = args.includeRevoked
    ? eq(userSessions.userId, args.userId)
    : and(eq(userSessions.userId, args.userId), isNull(userSessions.revokedAt));

  return db
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
    .limit(args.limit)
    .all();
}

export function formatLocation(row: { city?: string | null; region?: string | null; countryCode?: string | null }): string {
  const parts = [row.city, row.region, row.countryCode].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown";
}
