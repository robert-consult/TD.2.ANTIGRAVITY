import { db } from "@db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { pushDevices } from "@shared/schema";
import { sha256Hex } from "./crypto";

export type PushDeviceAppVariant = "native" | "wrapper";
export type PushDevicePlatform = "android" | "ios" | "web";
export type PushDeviceEnvironment = "development" | "staging" | "production";
export type PushProvider = "FCM" | "APNS";

export type UpsertPushDeviceInput = {
  userId: number;
  appVariant: PushDeviceAppVariant;
  platform: PushDevicePlatform;
  environment: PushDeviceEnvironment;
  pushProvider: PushProvider;
  token: string;
  deviceId?: string | null;
  deviceInstallId?: string | null;
  deviceFingerprint?: string | null;
  appVersion?: string | null;
  buildNumber?: string | null;
  locale?: string | null;
  timezone?: string | null;
  metadata?: Record<string, unknown> | null;
};

function clampText(value: unknown, maxLen: number): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(raw)) return null;
  return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

function normalizeToken(value: unknown): string {
  const token = clampText(value, 4096);
  if (!token || token.length < 16) {
    throw new Error("PUSH_TOKEN_INVALID");
  }
  return token;
}

function normalizeVariant(value: unknown): PushDeviceAppVariant {
  return String(value ?? "").trim().toLowerCase() === "wrapper" ? "wrapper" : "native";
}

function normalizePlatform(value: unknown): PushDevicePlatform {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "ios" || normalized === "web") return normalized;
  return "android";
}

function normalizeEnvironment(value: unknown): PushDeviceEnvironment {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "development" || normalized === "staging") return normalized;
  return "production";
}

function normalizeProvider(value: unknown, platform: PushDevicePlatform): PushProvider {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "APNS") return "APNS";
  if (platform === "ios" && normalized === "") return "FCM";
  return "FCM";
}

function sanitizeMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 4000 ? encoded.slice(0, 4000) : encoded;
  } catch {
    return null;
  }
}

function redactToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function mapRow(row: typeof pushDevices.$inferSelect) {
  return {
    id: row.id,
    appVariant: row.appVariant,
    platform: row.platform,
    environment: row.environment,
    pushProvider: row.pushProvider,
    tokenPreview: redactToken(row.token),
    deviceId: row.deviceId,
    deviceInstallId: row.deviceInstallId,
    appVersion: row.appVersion,
    buildNumber: row.buildNumber,
    locale: row.locale,
    timezone: row.timezone,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

export async function upsertPushDevice(input: UpsertPushDeviceInput) {
  const token = normalizeToken(input.token);
  const platform = normalizePlatform(input.platform);
  const tokenHash = sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  const [row] = await db
    .insert(pushDevices)
    .values({
      userId: input.userId,
      appVariant: normalizeVariant(input.appVariant),
      platform,
      environment: normalizeEnvironment(input.environment),
      pushProvider: normalizeProvider(input.pushProvider, platform),
      token,
      tokenHash,
      deviceId: clampText(input.deviceId, 256),
      deviceInstallId: clampText(input.deviceInstallId, 256),
      deviceFingerprint: clampText(input.deviceFingerprint, 512),
      appVersion: clampText(input.appVersion, 64),
      buildNumber: clampText(input.buildNumber, 64),
      locale: clampText(input.locale, 64),
      timezone: clampText(input.timezone, 128),
      metadataJson: sanitizeMetadata(input.metadata),
      lastSeenAt: now,
      updatedAt: now,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: pushDevices.tokenHash,
      set: {
        userId: input.userId,
        appVariant: normalizeVariant(input.appVariant),
        platform,
        environment: normalizeEnvironment(input.environment),
        pushProvider: normalizeProvider(input.pushProvider, platform),
        token,
        deviceId: clampText(input.deviceId, 256),
        deviceInstallId: clampText(input.deviceInstallId, 256),
        deviceFingerprint: clampText(input.deviceFingerprint, 512),
        appVersion: clampText(input.appVersion, 64),
        buildNumber: clampText(input.buildNumber, 64),
        locale: clampText(input.locale, 64),
        timezone: clampText(input.timezone, 128),
        metadataJson: sanitizeMetadata(input.metadata),
        lastSeenAt: now,
        updatedAt: now,
        revokedAt: null,
      },
    })
    .returning();

  return mapRow(row);
}

export async function listPushDevicesForUser(userId: number) {
  const rows = await db
    .select()
    .from(pushDevices)
    .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.revokedAt)))
    .orderBy(desc(pushDevices.updatedAt), desc(pushDevices.id));

  return rows.map(mapRow);
}

export async function revokePushDeviceById(userId: number, deviceId: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .update(pushDevices)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pushDevices.userId, userId),
        eq(pushDevices.id, deviceId),
        isNull(pushDevices.revokedAt),
      ),
    )
    .returning({ id: pushDevices.id });

  return rows.length > 0;
}

export async function revokePushDeviceByToken(userId: number, token: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .update(pushDevices)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pushDevices.userId, userId),
        eq(pushDevices.tokenHash, sha256Hex(normalizeToken(token))),
        isNull(pushDevices.revokedAt),
      ),
    )
    .returning({ id: pushDevices.id });

  return rows.length > 0;
}

export async function revokeAllPushDevicesForUser(userId: number): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .update(pushDevices)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(and(eq(pushDevices.userId, userId), isNull(pushDevices.revokedAt)))
    .returning({ id: pushDevices.id });

  return rows.length;
}
