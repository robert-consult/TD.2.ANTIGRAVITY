import crypto from "crypto";
import type { Request, Response } from "express";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "@db";
import { clampIntOr } from "@shared/scalars";
import { rememberMeTokens, systemConfig } from "@shared/schema";
import { sha256Hex } from "./crypto";
import {
  buildGeoContext,
  extractClientIdentity,
  extractGeoHints,
  getClientIp,
  getUserAgent,
  parseDevice,
} from "../security/sessionTrail";

export const REMEMBER_ME_COOKIE_NAME = "tq_rm";

const SELECTOR_BYTES = 16;
const VALIDATOR_BYTES = 32;
const SELECTOR_HEX_LEN = SELECTOR_BYTES * 2;
const VALIDATOR_HEX_LEN = VALIDATOR_BYTES * 2;

const SELECTOR_PATTERN = /^[a-f0-9]{32}$/;
const VALIDATOR_PATTERN = /^[a-f0-9]{64}$/;

const DEFAULT_REMEMBER_ME_CONFIG = {
  enabled: true,
  maxAgeDays: 30,
  maxDevicesPerUser: 10,
  reauthAfterAbsenceDays: 7,
  tokenRotationEnabled: true,
  theftAutoRevokeAll: true,
  sessionCookieMaxAgeHours: 24,
  sessionIdleTimeoutMinutes: 0,
  logoutClearAllDeviceTokens: false,
} as const;

const CONFIG_CACHE_TTL_MS = 15_000;
let cachedRememberMeConfig:
  | {
      value: RememberMeConfig;
      expiresAtMs: number;
    }
  | null = null;

export function invalidateRememberMeConfigCache(): void {
  cachedRememberMeConfig = null;
}

export type RememberMeConfig = {
  enabled: boolean;
  maxAgeDays: number;
  maxDevicesPerUser: number;
  reauthAfterAbsenceDays: number;
  tokenRotationEnabled: boolean;
  theftAutoRevokeAll: boolean;
  sessionCookieMaxAgeHours: number;
  sessionIdleTimeoutMinutes: number;
  logoutClearAllDeviceTokens: boolean;
};

export type RememberMeTokenRecord = typeof rememberMeTokens.$inferSelect;

export type RememberMeVerificationResult =
  | { status: "MALFORMED" }
  | { status: "NOT_FOUND" }
  | { status: "EXPIRED"; token: RememberMeTokenRecord }
  | { status: "THEFT_DETECTED"; token: RememberMeTokenRecord; userId: number }
  | { status: "ABSENCE_REAUTH_REQUIRED"; token: RememberMeTokenRecord; userId: number }
  | { status: "VALID"; token: RememberMeTokenRecord; userId: number };

function parseCookieMap(req: Request): Record<string, string> {
  const rawCookieHeader = req.headers.cookie;
  if (!rawCookieHeader) return {};

  const map: Record<string, string> = {};
  const pieces = String(rawCookieHeader).split(";");
  for (const piece of pieces) {
    const [k, ...rest] = piece.trim().split("=");
    if (!k || rest.length === 0) continue;
    const raw = rest.join("=");
    try {
      map[k] = decodeURIComponent(raw);
    } catch {
      map[k] = raw;
    }
  }
  return map;
}

export function readRememberMeCookie(req: Request): string | null {
  const value = parseCookieMap(req)[REMEMBER_ME_COOKIE_NAME];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveCookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function resolveCookieSameSite(): "lax" | "strict" | "none" {
  const configured = String(process.env.COOKIE_SAMESITE ?? "").trim().toLowerCase();
  if (configured === "strict") return "strict";
  if (configured === "none") return "none";
  return "lax";
}

export function buildRememberMeCookieOptions(maxAgeDays: number) {
  return {
    httpOnly: true,
    secure: resolveCookieSecure(),
    sameSite: resolveCookieSameSite() as "lax" | "strict" | "none",
    path: "/",
    maxAge: Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000,
  };
}

export function clearRememberMeCookie(res: Response): void {
  res.clearCookie(REMEMBER_ME_COOKIE_NAME, {
    httpOnly: true,
    secure: resolveCookieSecure(),
    sameSite: resolveCookieSameSite(),
    path: "/",
  });
}

export function generateSelector(): string {
  return crypto.randomBytes(SELECTOR_BYTES).toString("hex");
}

export function generateValidator(): string {
  return crypto.randomBytes(VALIDATOR_BYTES).toString("hex");
}

export function hashValidator(validator: string): string {
  return sha256Hex(validator);
}

export function encodeRememberMeCookie(selector: string, validator: string): string {
  return Buffer.from(`${selector}:${validator}`, "utf8").toString("base64url");
}

export function decodeRememberMeCookie(encoded: string): { selector: string; validator: string } | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep <= 0) return null;
    const selector = decoded.slice(0, sep);
    const validator = decoded.slice(sep + 1);
    if (selector.length !== SELECTOR_HEX_LEN || validator.length !== VALIDATOR_HEX_LEN) return null;
    if (!SELECTOR_PATTERN.test(selector) || !VALIDATOR_PATTERN.test(validator)) return null;
    return { selector, validator };
  } catch {
    return null;
  }
}

export function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    const aa = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (aa.length !== bb.length || aa.length === 0) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export async function getRememberMeConfig(opts?: { forceRefresh?: boolean }): Promise<RememberMeConfig> {
  const nowMs = Date.now();
  if (!opts?.forceRefresh && cachedRememberMeConfig && cachedRememberMeConfig.expiresAtMs > nowMs) {
    return cachedRememberMeConfig.value;
  }

  const row = await db.query.systemConfig.findFirst({
    where: eq(systemConfig.id, 1),
  });

  const config: RememberMeConfig = {
    enabled: Boolean(row?.rememberMeEnabled ?? DEFAULT_REMEMBER_ME_CONFIG.enabled),
    maxAgeDays: clampIntOr(row?.rememberMeMaxAgeDays, DEFAULT_REMEMBER_ME_CONFIG.maxAgeDays, 1, 90),
    maxDevicesPerUser: clampIntOr(row?.rememberMeMaxDevicesPerUser, DEFAULT_REMEMBER_ME_CONFIG.maxDevicesPerUser, 1, 25),
    reauthAfterAbsenceDays: clampIntOr(
      row?.rememberMeReauthAfterAbsenceDays,
      DEFAULT_REMEMBER_ME_CONFIG.reauthAfterAbsenceDays,
      0,
      90,
    ),
    tokenRotationEnabled: Boolean(
      row?.rememberMeTokenRotationEnabled ?? DEFAULT_REMEMBER_ME_CONFIG.tokenRotationEnabled,
    ),
    theftAutoRevokeAll: Boolean(
      row?.rememberMeTheftAutoRevokeAll ?? DEFAULT_REMEMBER_ME_CONFIG.theftAutoRevokeAll,
    ),
    sessionCookieMaxAgeHours: clampIntOr(
      row?.sessionCookieMaxAgeHours,
      DEFAULT_REMEMBER_ME_CONFIG.sessionCookieMaxAgeHours,
      1,
      24 * 14,
    ),
    sessionIdleTimeoutMinutes: clampIntOr(
      row?.sessionIdleTimeoutMinutes,
      DEFAULT_REMEMBER_ME_CONFIG.sessionIdleTimeoutMinutes,
      0,
      24 * 60,
    ),
    logoutClearAllDeviceTokens: Boolean(
      row?.logoutClearAllDeviceTokens ?? DEFAULT_REMEMBER_ME_CONFIG.logoutClearAllDeviceTokens,
    ),
  };

  cachedRememberMeConfig = {
    value: config,
    expiresAtMs: nowMs + CONFIG_CACHE_TTL_MS,
  };

  return config;
}

export async function issueRememberMeToken(args: {
  userId: number;
  maxAgeDays: number;
  req: Request;
}): Promise<{ tokenId: number; cookieValue: string; expiresAt: number }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const selector = generateSelector();
  const validator = generateValidator();
  const validatorHash = hashValidator(validator);
  const expiresAt = nowSec + Math.max(1, args.maxAgeDays) * 86400;

  const ip = getClientIp(args.req);
  const userAgent = getUserAgent(args.req);
  const device = parseDevice(userAgent);
  const identity = extractClientIdentity(args.req);
  const geo = buildGeoContext(ip, extractGeoHints(args.req));

  const [inserted] = await db
    .insert(rememberMeTokens)
    .values({
      userId: args.userId,
      selector,
      validatorHash,
      expiresAt,
      lastUsedAt: nowSec,
      createdAt: nowSec,
      userAgent,
      ip,
      deviceType: device.deviceType || null,
      browser: device.browser || null,
      os: device.os || null,
      deviceFp: identity.deviceFp || null,
      deviceInstallId: identity.deviceInstallId || null,
      countryCode: geo.countryCode || null,
      city: geo.city || null,
    })
    .returning({ id: rememberMeTokens.id });

  return {
    tokenId: inserted.id,
    cookieValue: encodeRememberMeCookie(selector, validator),
    expiresAt,
  };
}

export async function verifyRememberMeToken(
  encodedCookieValue: string,
  config: RememberMeConfig,
): Promise<RememberMeVerificationResult> {
  const parsed = decodeRememberMeCookie(encodedCookieValue);
  if (!parsed) return { status: "MALFORMED" };

  const [token] = await db
    .select()
    .from(rememberMeTokens)
    .where(eq(rememberMeTokens.selector, parsed.selector))
    .limit(1);

  if (!token) return { status: "NOT_FOUND" };

  const nowSec = Math.floor(Date.now() / 1000);
  if (token.expiresAt < nowSec) {
    await db.delete(rememberMeTokens).where(eq(rememberMeTokens.id, token.id));
    return { status: "EXPIRED", token };
  }

  const incomingHash = hashValidator(parsed.validator);
  if (!safeCompareHex(incomingHash, token.validatorHash)) {
    return { status: "THEFT_DETECTED", token, userId: token.userId };
  }

  if (config.reauthAfterAbsenceDays > 0) {
    const lastUsedAt = Number(token.lastUsedAt || token.createdAt || nowSec);
    const absenceSeconds = nowSec - lastUsedAt;
    const thresholdSeconds = config.reauthAfterAbsenceDays * 86400;
    if (absenceSeconds > thresholdSeconds) {
      return { status: "ABSENCE_REAUTH_REQUIRED", token, userId: token.userId };
    }
  }

  return { status: "VALID", token, userId: token.userId };
}

export async function rotateRememberMeToken(args: {
  oldTokenId: number;
  userId: number;
  maxAgeDays: number;
  req: Request;
}): Promise<{ tokenId: number; cookieValue: string; expiresAt: number }> {
  return db.transaction(async (tx) => {
    await tx.delete(rememberMeTokens).where(eq(rememberMeTokens.id, args.oldTokenId));

    const nowSec = Math.floor(Date.now() / 1000);
    const selector = generateSelector();
    const validator = generateValidator();
    const validatorHash = hashValidator(validator);
    const expiresAt = nowSec + Math.max(1, args.maxAgeDays) * 86400;

    const ip = getClientIp(args.req);
    const userAgent = getUserAgent(args.req);
    const device = parseDevice(userAgent);
    const identity = extractClientIdentity(args.req);
    const geo = buildGeoContext(ip, extractGeoHints(args.req));

    const [inserted] = await tx
      .insert(rememberMeTokens)
      .values({
        userId: args.userId,
        selector,
        validatorHash,
        expiresAt,
        lastUsedAt: nowSec,
        createdAt: nowSec,
        userAgent,
        ip,
        deviceType: device.deviceType || null,
        browser: device.browser || null,
        os: device.os || null,
        deviceFp: identity.deviceFp || null,
        deviceInstallId: identity.deviceInstallId || null,
        countryCode: geo.countryCode || null,
        city: geo.city || null,
      })
      .returning({ id: rememberMeTokens.id });

    return {
      tokenId: inserted.id,
      cookieValue: encodeRememberMeCookie(selector, validator),
      expiresAt,
    };
  });
}

export async function touchRememberMeToken(tokenId: number): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  await db
    .update(rememberMeTokens)
    .set({ lastUsedAt: nowSec })
    .where(eq(rememberMeTokens.id, tokenId));
}

export async function revokeRememberMeTokenById(tokenId: number, userId: number): Promise<void> {
  await db
    .delete(rememberMeTokens)
    .where(and(eq(rememberMeTokens.id, tokenId), eq(rememberMeTokens.userId, userId)));
}

export async function revokeRememberMeTokenBySelector(selector: string, userId?: number): Promise<void> {
  if (!SELECTOR_PATTERN.test(selector)) return;
  if (Number.isInteger(userId) && Number(userId) > 0) {
    await db
      .delete(rememberMeTokens)
      .where(and(eq(rememberMeTokens.selector, selector), eq(rememberMeTokens.userId, Number(userId))));
    return;
  }
  await db.delete(rememberMeTokens).where(eq(rememberMeTokens.selector, selector));
}

export async function revokeAllRememberMeTokensForUser(userId: number): Promise<void> {
  await db.delete(rememberMeTokens).where(eq(rememberMeTokens.userId, userId));
}

export async function revokeOtherRememberMeTokensForUser(
  userId: number,
  keepSelector?: string | null,
): Promise<void> {
  const normalizedSelector = String(keepSelector ?? "").trim().toLowerCase();
  if (normalizedSelector && SELECTOR_PATTERN.test(normalizedSelector)) {
    await db
      .delete(rememberMeTokens)
      .where(and(eq(rememberMeTokens.userId, userId), ne(rememberMeTokens.selector, normalizedSelector)));
    return;
  }
  await revokeAllRememberMeTokensForUser(userId);
}

export async function purgeExpiredRememberMeTokens(): Promise<number> {
  const nowSec = Math.floor(Date.now() / 1000);
  const deleted = await db
    .delete(rememberMeTokens)
    .where(lt(rememberMeTokens.expiresAt, nowSec))
    .returning({ id: rememberMeTokens.id });
  return deleted.length;
}

export async function enforceRememberMeDeviceLimit(userId: number, maxDevices: number): Promise<void> {
  const limit = Math.max(1, Math.trunc(maxDevices));
  const rows = await db
    .select({ id: rememberMeTokens.id })
    .from(rememberMeTokens)
    .where(eq(rememberMeTokens.userId, userId))
    .orderBy(desc(rememberMeTokens.lastUsedAt), desc(rememberMeTokens.createdAt));

  if (rows.length <= limit) return;
  const overflow = rows.slice(limit);
  for (const row of overflow) {
    await db.delete(rememberMeTokens).where(eq(rememberMeTokens.id, row.id));
  }
}

export async function listRememberMeDevices(userId: number): Promise<
  Array<{
    id: number;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    lastUsedAt: number;
    createdAt: number;
    countryCode: string | null;
    city: string | null;
    ip: string | null;
  }>
> {
  return db
    .select({
      id: rememberMeTokens.id,
      deviceType: rememberMeTokens.deviceType,
      browser: rememberMeTokens.browser,
      os: rememberMeTokens.os,
      lastUsedAt: rememberMeTokens.lastUsedAt,
      createdAt: rememberMeTokens.createdAt,
      countryCode: rememberMeTokens.countryCode,
      city: rememberMeTokens.city,
      ip: rememberMeTokens.ip,
    })
    .from(rememberMeTokens)
    .where(eq(rememberMeTokens.userId, userId))
    .orderBy(desc(rememberMeTokens.lastUsedAt), desc(rememberMeTokens.createdAt));
}
