import { db, dbClient } from "@db";
import {
  mailboxMessageAudit,
  mailboxMessages,
  mailboxParticipants,
  mailboxThreads,
  notifications,
  userSessions,
  users,
} from "@shared/schema";
import {
  E2EE_DATA_ALGO_AES_256_GCM,
  E2EE_KEY_ALGO_RSA_OAEP_256_V1,
  normalizeHexSha256,
  parseAndValidateE2eeEnvelope,
} from "@shared/e2ee/envelope";
import { clampIntOr, nowSec } from "@shared/scalars";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { publishLiveEvent } from "./liveBus";
import { decryptString, encryptString, sha256Hex } from "./crypto";
import {
  getCommunicationSettings,
  invalidateCommunicationSettingsCache,
  type CommunicationSettingsPatch,
  type CommunicationSettingsResolved,
  updateCommunicationSettings,
} from "./messagingSettings";
import crypto from "crypto";

export {
  getCommunicationSettings,
  invalidateCommunicationSettingsCache,
  updateCommunicationSettings,
};
export type {
  CommunicationSettingsPatch,
  CommunicationSettingsResolved,
};

export type MailboxCategory = "SYSTEM" | "SUPPORT" | "ANNOUNCEMENT" | "CHALLENGES";
export type NotificationType = "TRADE" | "SYSTEM" | "ACCOUNT" | "SECURITY" | "KYC" | "CHALLENGE";
export type NotificationSeverity = "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
export type RecipientMode = "ALL" | "USER_IDS" | "TIER" | "ACTIVE_DAYS";

const VALID_MAILBOX_CATEGORIES = new Set<MailboxCategory>(["SYSTEM", "SUPPORT", "ANNOUNCEMENT", "CHALLENGES"]);
const VALID_NOTIFICATION_TYPES = new Set<NotificationType>(["TRADE", "SYSTEM", "ACCOUNT", "SECURITY", "KYC", "CHALLENGE"]);
const VALID_NOTIFICATION_SEVERITIES = new Set<NotificationSeverity>(["INFO", "SUCCESS", "WARNING", "CRITICAL"]);

const MAX_SUBJECT_LEN = 160;
const MAX_MESSAGE_LEN = 8000;
const FANOUT_BATCH_MIN = 50;
const FANOUT_BATCH_MAX = 5000;

const MAILBOX_BODY_ENCODING_PLAINTEXT = "PLAINTEXT_V0";
const MAILBOX_BODY_ENCODING_AT_REST = "ATREST_AES256GCM_V1";
const MAILBOX_BODY_ENCODING_E2EE = "E2EE_ENVELOPE_V1";
const ENCRYPTED_BODY_PLACEHOLDER = "[Encrypted message]";

const NOTIFICATION_CONTENT_ENCODING_PLAINTEXT = "PLAINTEXT_V0";
const NOTIFICATION_CONTENT_ENCODING_AT_REST = "ATREST_AES256GCM_V1";
const NOTIFICATION_CONTENT_ENCODING_E2EE = "E2EE_ENVELOPE_V1";
const ENCRYPTED_NOTIFICATION_PLACEHOLDER = "Encrypted notification";
const MAILBOX_CONTENT_FORMAT_PLAINTEXT = "PLAINTEXT";
const MAILBOX_CONTENT_FORMAT_MARKDOWN = "MARKDOWN";
const E2EE_KEY_ALGO_FALLBACK = E2EE_KEY_ALGO_RSA_OAEP_256_V1;
const MAILBOX_PUBLIC_KEY_MODULUS_MIN_BITS = 2048;
const MAILBOX_PUBLIC_KEY_MODULUS_MAX_BITS = 8192;

type BroadcastFanoutJob = {
  threadId: number;
  messageId: number;
  userIds: number[];
  batchSize: number;
};

const broadcastFanoutQueue: BroadcastFanoutJob[] = [];
let broadcastFanoutRunning = false;
let metricMailboxFanoutEnqueuedTotal = 0;
let metricMailboxFanoutProcessedTotal = 0;
let metricMailboxFanoutFailedTotal = 0;

function normalizeSubject(value: unknown): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "Message";
  return text.slice(0, MAX_SUBJECT_LEN);
}

function normalizeBody(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("MESSAGE_BODY_REQUIRED");
  if (text.length > MAX_MESSAGE_LEN) throw new Error("MESSAGE_BODY_TOO_LONG");
  return text;
}

function normalizeCategory(value: unknown): MailboxCategory {
  const candidate = String(value ?? "SUPPORT").trim().toUpperCase() as MailboxCategory;
  return VALID_MAILBOX_CATEGORIES.has(candidate) ? candidate : "SUPPORT";
}

function normalizeNotificationType(value: unknown): NotificationType {
  const candidate = String(value ?? "SYSTEM").trim().toUpperCase() as NotificationType;
  return VALID_NOTIFICATION_TYPES.has(candidate) ? candidate : "SYSTEM";
}

function normalizeNotificationSeverity(value: unknown): NotificationSeverity {
  const candidate = String(value ?? "INFO").trim().toUpperCase() as NotificationSeverity;
  return VALID_NOTIFICATION_SEVERITIES.has(candidate) ? candidate : "INFO";
}

function normalizeMailboxContentFormat(value: unknown): string {
  const candidate = String(value ?? MAILBOX_CONTENT_FORMAT_PLAINTEXT)
    .trim()
    .toUpperCase();
  if (candidate === MAILBOX_CONTENT_FORMAT_MARKDOWN) return MAILBOX_CONTENT_FORMAT_MARKDOWN;
  return MAILBOX_CONTENT_FORMAT_PLAINTEXT;
}

function normalizeMailboxPublicKeyPem(value: unknown): string | null {
  const keyText = String(value ?? "").trim();
  if (!keyText) return null;
  if (!keyText.includes("BEGIN PUBLIC KEY")) return null;
  try {
    const keyObject = crypto.createPublicKey({
      key: keyText,
      format: "pem",
      type: "spki",
    });
    if (keyObject.asymmetricKeyType !== "rsa") return null;
    const details = (keyObject.asymmetricKeyDetails ?? {}) as { modulusLength?: number };
    const modulusLength = Number(details.modulusLength ?? 0);
    if (!Number.isInteger(modulusLength)) return null;
    if (modulusLength < MAILBOX_PUBLIC_KEY_MODULUS_MIN_BITS) return null;
    if (modulusLength > MAILBOX_PUBLIC_KEY_MODULUS_MAX_BITS) return null;

    const exported = keyObject.export({
      type: "spki",
      format: "pem",
    });
    return String(exported ?? "")
      .trim()
      .replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function normalizeE2eeKeyAlgo(value: unknown): string {
  const candidate = String(value ?? E2EE_KEY_ALGO_FALLBACK).trim().toUpperCase();
  if (candidate === E2EE_KEY_ALGO_RSA_OAEP_256_V1) return candidate;
  return E2EE_KEY_ALGO_FALLBACK;
}

function normalizeSenderKeyFingerprint(value: unknown): string | null {
  return normalizeHexSha256(value);
}

function normalizePublicKeyFingerprint(value: unknown): string | null {
  return normalizeHexSha256(value);
}

function parseAndValidateMailboxE2eeEnvelope(rawEnvelope: string, recipientUserIds: number[]): string {
  return parseAndValidateE2eeEnvelope(rawEnvelope, recipientUserIds, nowSec());
}

type MailboxBodyStorage = {
  body: string;
  bodyEncrypted: string | null;
  bodyEncoding: string;
  encryptionVersion: number;
  bodyDigestSha256: string;
  e2eeEnvelope: string | null;
  e2eeSenderKeyFingerprint: string | null;
  contentFormat: string;
};

type NotificationContentStorage = {
  title: string;
  message: string;
  titleEncrypted: string | null;
  messageEncrypted: string | null;
  contentEncoding: string;
  encryptionVersion: number;
  contentDigestSha256: string;
  e2eeEnvelope: string | null;
};

function encodeMailboxBodyForStorage(input: {
  plaintextBody: string;
  contentFormat?: unknown;
}): MailboxBodyStorage {
  return {
    body: ENCRYPTED_BODY_PLACEHOLDER,
    bodyEncrypted: encryptString(input.plaintextBody),
    bodyEncoding: MAILBOX_BODY_ENCODING_AT_REST,
    encryptionVersion: 1,
    bodyDigestSha256: sha256Hex(input.plaintextBody),
    e2eeEnvelope: null,
    e2eeSenderKeyFingerprint: null,
    contentFormat: normalizeMailboxContentFormat(input.contentFormat),
  };
}

function encodeMailboxBodyForE2eeStorage(input: {
  envelope: string;
  recipientUserIds: number[];
  senderKeyFingerprint?: unknown;
  bodyDigestSha256?: unknown;
  contentFormat?: unknown;
}): MailboxBodyStorage {
  const envelope = parseAndValidateMailboxE2eeEnvelope(input.envelope, input.recipientUserIds);
  const digest = normalizeHexSha256(input.bodyDigestSha256) ?? sha256Hex(envelope);
  return {
    body: ENCRYPTED_BODY_PLACEHOLDER,
    bodyEncrypted: null,
    bodyEncoding: MAILBOX_BODY_ENCODING_E2EE,
    encryptionVersion: 1,
    bodyDigestSha256: digest,
    e2eeEnvelope: envelope,
    e2eeSenderKeyFingerprint: normalizeSenderKeyFingerprint(input.senderKeyFingerprint),
    contentFormat: normalizeMailboxContentFormat(input.contentFormat),
  };
}

function decodeMailboxBodyFromRow(
  row: {
    body?: unknown;
    bodyEncrypted?: unknown;
    bodyEncoding?: unknown;
  } | null | undefined,
): string {
  const body = typeof row?.body === "string" ? row.body : "";
  const bodyEncrypted = typeof row?.bodyEncrypted === "string" ? row.bodyEncrypted : "";
  const bodyEncoding =
    typeof row?.bodyEncoding === "string" && row.bodyEncoding.trim()
      ? row.bodyEncoding.trim()
      : MAILBOX_BODY_ENCODING_PLAINTEXT;

  if (bodyEncoding === MAILBOX_BODY_ENCODING_E2EE) {
    return ENCRYPTED_BODY_PLACEHOLDER;
  }

  if (bodyEncoding === MAILBOX_BODY_ENCODING_AT_REST) {
    if (!bodyEncrypted) return ENCRYPTED_BODY_PLACEHOLDER;
    try {
      return decryptString(bodyEncrypted);
    } catch (error) {
      console.warn("[mailbox] failed to decrypt mailbox message; returning placeholder", error);
      return ENCRYPTED_BODY_PLACEHOLDER;
    }
  }

  return body;
}

function encodeNotificationContentForStorage(input: {
  title: string;
  message: string;
}): NotificationContentStorage {
  return {
    title: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
    message: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
    titleEncrypted: encryptString(input.title),
    messageEncrypted: encryptString(input.message),
    contentEncoding: NOTIFICATION_CONTENT_ENCODING_AT_REST,
    encryptionVersion: 1,
    contentDigestSha256: sha256Hex(`${input.title}\n${input.message}`),
    e2eeEnvelope: null,
  };
}

function encodeNotificationContentForE2eeStorage(input: {
  title: string;
  message: string;
  recipientUserId: number;
  recipientPublicKeyPem: string;
}): NotificationContentStorage {
  const plaintext = JSON.stringify({
    title: input.title,
    message: input.message,
  });
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const encryptedKey = crypto.publicEncrypt(
    {
      key: input.recipientPublicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    key,
  );

  const envelope = JSON.stringify({
    version: 1,
    keyAlgorithm: E2EE_KEY_ALGO_RSA_OAEP_256_V1,
    dataAlgorithm: E2EE_DATA_ALGO_AES_256_GCM,
    recipients: {
      [String(input.recipientUserId)]: {
        keyAlgorithm: E2EE_KEY_ALGO_RSA_OAEP_256_V1,
        encryptedKey: encryptedKey.toString("base64"),
      },
    },
    // Legacy single-recipient fields are retained for backward compatibility.
    recipientUserId: Number(input.recipientUserId),
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    createdAt: nowSec(),
  });

  return {
    title: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
    message: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
    titleEncrypted: null,
    messageEncrypted: null,
    contentEncoding: NOTIFICATION_CONTENT_ENCODING_E2EE,
    encryptionVersion: 1,
    contentDigestSha256: sha256Hex(`${input.title}\n${input.message}`),
    e2eeEnvelope: envelope,
  };
}

function decodeNotificationContentFromRow(
  row: {
    title?: unknown;
    message?: unknown;
    titleEncrypted?: unknown;
    messageEncrypted?: unknown;
    contentEncoding?: unknown;
  } | null | undefined,
): { title: string; message: string } {
  const title = typeof row?.title === "string" ? row.title : "";
  const message = typeof row?.message === "string" ? row.message : "";
  const titleEncrypted = typeof row?.titleEncrypted === "string" ? row.titleEncrypted : "";
  const messageEncrypted = typeof row?.messageEncrypted === "string" ? row.messageEncrypted : "";
  const contentEncoding =
    typeof row?.contentEncoding === "string" && row.contentEncoding.trim()
      ? row.contentEncoding.trim()
      : NOTIFICATION_CONTENT_ENCODING_PLAINTEXT;

  if (contentEncoding === NOTIFICATION_CONTENT_ENCODING_E2EE) {
    return {
      title: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
      message: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
    };
  }

  if (contentEncoding === NOTIFICATION_CONTENT_ENCODING_AT_REST) {
    try {
      return {
        title: titleEncrypted ? decryptString(titleEncrypted) : ENCRYPTED_NOTIFICATION_PLACEHOLDER,
        message: messageEncrypted ? decryptString(messageEncrypted) : ENCRYPTED_NOTIFICATION_PLACEHOLDER,
      };
    } catch (error) {
      console.warn("[notifications] failed to decrypt notification content; returning placeholder", error);
      return {
        title: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
        message: ENCRYPTED_NOTIFICATION_PLACEHOLDER,
      };
    }
  }

  return { title, message };
}

function dedupePositiveInts(values: number[]): number[] {
  const set = new Set<number>();
  for (const raw of values) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) continue;
    set.add(n);
  }
  return Array.from(set.values());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return items.length ? [items] : [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type MailboxAuditContext = {
  actorUserId?: number | null;
  actorRole?: "USER" | "ADMIN" | "SYSTEM";
  ip?: string | null;
  userAgent?: string | null;
};

type MailboxPublicKeyRow = {
  userId: number;
  mailboxPublicKey: string;
  mailboxPublicKeyAlgo: string;
  mailboxPublicKeyFingerprint: string | null;
  mailboxPublicKeyUpdatedAt: number | null;
  email: string | null;
  username: string | null;
  userTier: string | null;
};

type MailboxAuditAppender = any;

async function appendMailboxAuditEntry(
  appender: MailboxAuditAppender,
  input: {
    threadId: number;
    messageId?: number | null;
    action: string;
    actorUserId?: number | null;
    actorRole?: "USER" | "ADMIN" | "SYSTEM";
    ip?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  const threadId = Number(input.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) return;
  const action = String(input.action ?? "").trim().toUpperCase();
  if (!action) return;
  const actorRole =
    input.actorRole === "USER" || input.actorRole === "ADMIN" || input.actorRole === "SYSTEM"
      ? input.actorRole
      : "SYSTEM";
  const actorUserId =
    Number.isInteger(Number(input.actorUserId)) && Number(input.actorUserId) > 0
      ? Number(input.actorUserId)
      : null;

  const [prev] = await appender
    .select({ eventHash: mailboxMessageAudit.eventHash })
    .from(mailboxMessageAudit)
    .where(eq(mailboxMessageAudit.threadId, threadId))
    .orderBy(desc(mailboxMessageAudit.id))
    .limit(1);

  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const metadataJson = JSON.stringify(metadata);
  const createdAt = nowSec();
  const prevHash = prev?.eventHash ?? null;
  const eventHash = sha256Hex(
    JSON.stringify({
      threadId,
      messageId: input.messageId ?? null,
      action,
      actorUserId,
      actorRole,
      ip: input.ip ? String(input.ip).slice(0, 160) : null,
      userAgent: input.userAgent ? String(input.userAgent).slice(0, 512) : null,
      metadata: metadataJson,
      createdAt,
      prevHash: prevHash ?? "GENESIS",
    }),
  );

  await appender.insert(mailboxMessageAudit).values({
    threadId,
    messageId:
      Number.isInteger(Number(input.messageId)) && Number(input.messageId) > 0
        ? Number(input.messageId)
        : null,
    actorUserId,
    actorRole,
    action,
    ip: input.ip ? String(input.ip).slice(0, 160) : null,
    userAgent: input.userAgent ? String(input.userAgent).slice(0, 512) : null,
    metadata: metadataJson,
    createdAt,
    prevHash,
    eventHash,
  });
}

export async function getMailboxPublicKeyForUser(userId: number): Promise<MailboxPublicKeyRow | null> {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return null;
  const [row] = await db
    .select({
      userId: users.id,
      mailboxPublicKey: users.mailboxPublicKey,
      mailboxPublicKeyAlgo: users.mailboxPublicKeyAlgo,
      mailboxPublicKeyFingerprint: users.mailboxPublicKeyFingerprint,
      mailboxPublicKeyUpdatedAt: users.mailboxPublicKeyUpdatedAt,
      email: users.email,
      username: users.username,
      userTier: users.userTier,
    })
    .from(users)
    .where(and(eq(users.id, uid), eq(users.isDeleted, false)))
    .limit(1);
  if (!row || !row.mailboxPublicKey) return null;
  const normalizedKey = normalizeMailboxPublicKeyPem(row.mailboxPublicKey);
  if (!normalizedKey) return null;
  return {
    userId: Number(row.userId),
    mailboxPublicKey: normalizedKey,
    mailboxPublicKeyAlgo: normalizeE2eeKeyAlgo(row.mailboxPublicKeyAlgo),
    mailboxPublicKeyFingerprint:
      normalizePublicKeyFingerprint(row.mailboxPublicKeyFingerprint) ?? sha256Hex(normalizedKey),
    mailboxPublicKeyUpdatedAt:
      Number.isInteger(Number(row.mailboxPublicKeyUpdatedAt)) && Number(row.mailboxPublicKeyUpdatedAt) > 0
        ? Number(row.mailboxPublicKeyUpdatedAt)
        : null,
    email: row.email ?? null,
    username: row.username ?? null,
    userTier: row.userTier ?? null,
  };
}

export async function upsertMailboxPublicKeyForUser(input: {
  userId: number;
  publicKeyPem: string;
  keyAlgorithm?: string | null;
  fingerprint?: string | null;
}) {
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("INVALID_USER_ID");
  const publicKeyPem = normalizeMailboxPublicKeyPem(input.publicKeyPem);
  if (!publicKeyPem) throw new Error("E2EE_PUBLIC_KEY_INVALID");
  const keyAlgorithm = normalizeE2eeKeyAlgo(input.keyAlgorithm);
  const fingerprint = normalizePublicKeyFingerprint(input.fingerprint) ?? sha256Hex(publicKeyPem);
  const updatedAt = nowSec();

  const [saved] = await db
    .update(users)
    .set({
      mailboxPublicKey: publicKeyPem,
      mailboxPublicKeyAlgo: keyAlgorithm,
      mailboxPublicKeyFingerprint: fingerprint,
      mailboxPublicKeyUpdatedAt: updatedAt,
    })
    .where(eq(users.id, userId))
    .returning({
      userId: users.id,
      mailboxPublicKey: users.mailboxPublicKey,
      mailboxPublicKeyAlgo: users.mailboxPublicKeyAlgo,
      mailboxPublicKeyFingerprint: users.mailboxPublicKeyFingerprint,
      mailboxPublicKeyUpdatedAt: users.mailboxPublicKeyUpdatedAt,
      email: users.email,
      username: users.username,
      userTier: users.userTier,
    });

  if (!saved?.mailboxPublicKey) throw new Error("E2EE_PUBLIC_KEY_SAVE_FAILED");
  return {
    userId: Number(saved.userId),
    mailboxPublicKey: saved.mailboxPublicKey,
    mailboxPublicKeyAlgo: normalizeE2eeKeyAlgo(saved.mailboxPublicKeyAlgo),
    mailboxPublicKeyFingerprint:
      normalizePublicKeyFingerprint(saved.mailboxPublicKeyFingerprint) ?? sha256Hex(saved.mailboxPublicKey),
    mailboxPublicKeyUpdatedAt: Number(saved.mailboxPublicKeyUpdatedAt ?? updatedAt),
    email: saved.email ?? null,
    username: saved.username ?? null,
    userTier: saved.userTier ?? null,
  } as MailboxPublicKeyRow;
}

export async function listMailboxPublicKeysForUsers(userIds: number[]): Promise<MailboxPublicKeyRow[]> {
  const ids = dedupePositiveInts(userIds || []);
  if (!ids.length) return [];

  const rows = await db
    .select({
      userId: users.id,
      mailboxPublicKey: users.mailboxPublicKey,
      mailboxPublicKeyAlgo: users.mailboxPublicKeyAlgo,
      mailboxPublicKeyFingerprint: users.mailboxPublicKeyFingerprint,
      mailboxPublicKeyUpdatedAt: users.mailboxPublicKeyUpdatedAt,
      email: users.email,
      username: users.username,
      userTier: users.userTier,
    })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isDeleted, false), eq(users.isDisabled, false)));

  const result: MailboxPublicKeyRow[] = [];
  for (const row of rows) {
    const publicKey = normalizeMailboxPublicKeyPem(row.mailboxPublicKey);
    if (!publicKey) continue;
    result.push({
      userId: Number(row.userId),
      mailboxPublicKey: publicKey,
      mailboxPublicKeyAlgo: normalizeE2eeKeyAlgo(row.mailboxPublicKeyAlgo),
      mailboxPublicKeyFingerprint:
        normalizePublicKeyFingerprint(row.mailboxPublicKeyFingerprint) ?? sha256Hex(publicKey),
      mailboxPublicKeyUpdatedAt:
        Number.isInteger(Number(row.mailboxPublicKeyUpdatedAt)) && Number(row.mailboxPublicKeyUpdatedAt) > 0
          ? Number(row.mailboxPublicKeyUpdatedAt)
          : null,
      email: row.email ?? null,
      username: row.username ?? null,
      userTier: row.userTier ?? null,
    });
  }
  return result;
}

function enqueueBroadcastFanout(job: BroadcastFanoutJob) {
  if (!job.userIds.length) return;
  metricMailboxFanoutEnqueuedTotal += job.userIds.length;
  broadcastFanoutQueue.push(job);
  if (!broadcastFanoutRunning) {
    void processBroadcastFanoutQueue();
  }
}

async function processBroadcastFanoutQueue() {
  if (broadcastFanoutRunning) return;
  broadcastFanoutRunning = true;

  try {
    while (broadcastFanoutQueue.length) {
      const job = broadcastFanoutQueue.shift();
      if (!job) continue;

      const timestamp = nowSec();
      const batchSize = clampIntOr(job.batchSize, 500, FANOUT_BATCH_MIN, FANOUT_BATCH_MAX);
      const chunks = chunkArray(job.userIds, batchSize);
      for (const chunk of chunks) {
        if (!chunk.length) continue;

        try {
          await db
            .insert(mailboxParticipants)
            .values(
              chunk.map((userId) => ({
                threadId: job.threadId,
                userId,
                createdAt: timestamp,
                updatedAt: timestamp,
              })),
            )
            .onConflictDoNothing();
          metricMailboxFanoutProcessedTotal += chunk.length;

          for (const userId of chunk) {
            publishLiveEvent({
              type: "mailbox:new",
              userId,
              payload: {
                threadId: job.threadId,
                messageId: job.messageId,
              },
            });
          }
        } catch (error) {
          metricMailboxFanoutFailedTotal += chunk.length;
          console.error("[mailbox] fanout chunk failed:", error);
        }

        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  } finally {
    broadcastFanoutRunning = false;
  }
}

export type MailboxRecipientSelector = {
  mode: RecipientMode;
  userIds?: number[];
  tier?: string;
  activeWithinDays?: number;
  includeAdmins?: boolean;
};

export async function resolveMailboxRecipientIds(
  selector: MailboxRecipientSelector,
): Promise<number[]> {
  const includeAdmins = Boolean(selector.includeAdmins);
  const mode = String(selector.mode || "USER_IDS").toUpperCase() as RecipientMode;

  if (mode === "USER_IDS") {
    const requested = dedupePositiveInts(Array.isArray(selector.userIds) ? selector.userIds : []);
    if (!requested.length) return [];
    const conditions = [
      inArray(users.id, requested),
      eq(users.isDeleted, false),
      eq(users.isDisabled, false),
    ];
    if (!includeAdmins) {
      conditions.push(eq(users.isAdmin, false));
    }
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(...conditions));
    return rows.map((row) => Number(row.id));
  }

  if (mode === "TIER") {
    const tier = String(selector.tier ?? "").trim().toUpperCase();
    if (!tier) return [];
    const conditions = [
      eq(users.userTier, tier),
      eq(users.isDeleted, false),
      eq(users.isDisabled, false),
    ];
    if (!includeAdmins) {
      conditions.push(eq(users.isAdmin, false));
    }
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(...conditions));
    return rows.map((row) => Number(row.id));
  }

  if (mode === "ACTIVE_DAYS") {
    const days = Math.max(1, Math.min(365, Number(selector.activeWithinDays ?? 7)));
    const cutoff = nowSec() - days * 24 * 60 * 60;
    const conditions = [
      eq(users.isDeleted, false),
      eq(users.isDisabled, false),
      isNull(userSessions.revokedAt),
      sql`${userSessions.lastActiveAt} >= ${cutoff}`,
    ];
    if (!includeAdmins) {
      conditions.push(eq(users.isAdmin, false));
    }
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userSessions, eq(userSessions.userId, users.id))
      .where(and(...conditions));
    return rows.map((row) => Number(row.id));
  }

  const conditions = [eq(users.isDeleted, false), eq(users.isDisabled, false)];
  if (!includeAdmins) {
    conditions.push(eq(users.isAdmin, false));
  }
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(...conditions));
  return rows.map((row) => Number(row.id));
}

export async function resolveMailboxRecipientsWithKeys(input: {
  selector: MailboxRecipientSelector;
  includeAdmins?: boolean;
}) {
  const recipientUserIds = await resolveMailboxRecipientIds({
    ...input.selector,
    includeAdmins: Boolean(input.includeAdmins ?? input.selector.includeAdmins),
  });
  const keyRows = await listMailboxPublicKeysForUsers(recipientUserIds);
  const keyUserIds = new Set(keyRows.map((row) => Number(row.userId)));
  const missingKeyUserIds = recipientUserIds.filter((userId) => !keyUserIds.has(userId));
  return {
    recipientUserIds,
    keyRows,
    missingKeyUserIds,
  };
}

function sourceEventStartsWith(sourceEvent: string | null | undefined, prefix: string): boolean {
  const normalized = String(sourceEvent ?? "").trim().toUpperCase();
  return normalized.startsWith(prefix);
}

function isNotificationEnabledForEvent(
  settings: CommunicationSettingsResolved,
  input: {
    type?: NotificationType | string;
    sourceEvent?: string | null;
  },
): boolean {
  if (!settings.notificationsEnabled) return false;

  const type = normalizeNotificationType(input.type);
  if (type === "TRADE") {
    if (sourceEventStartsWith(input.sourceEvent, "PENDING_ORDER_FILLED")) {
      return settings.notificationTradePendingFillEnabled;
    }
    if (sourceEventStartsWith(input.sourceEvent, "TAKE_PROFIT_HIT")) {
      return settings.notificationTradeTakeProfitEnabled;
    }
    if (sourceEventStartsWith(input.sourceEvent, "STOP_LOSS_HIT")) {
      return settings.notificationTradeStopLossEnabled;
    }
    if (sourceEventStartsWith(input.sourceEvent, "MAX_HOLD_TIME")) {
      return settings.notificationTradeMaxHoldEnabled;
    }
    return true;
  }

  if (type === "ACCOUNT") {
    if (sourceEventStartsWith(input.sourceEvent, "ACCOUNT_FREEZE")) {
      return settings.notificationAccountFreezeEnabled;
    }
    if (sourceEventStartsWith(input.sourceEvent, "ACCOUNT_UNFREEZE")) {
      return settings.notificationAccountUnfreezeEnabled;
    }
    return true;
  }

  if (type === "KYC" || sourceEventStartsWith(input.sourceEvent, "KYC_")) {
    return settings.notificationKycUpdatesEnabled;
  }

  if (type === "CHALLENGE" || sourceEventStartsWith(input.sourceEvent, "CHALLENGE_")) {
    return settings.notificationChallengeEnabled;
  }

  return true;
}

export async function createNotification(input: {
  userId: number;
  type?: NotificationType | string;
  severity?: NotificationSeverity | string;
  title: string;
  message: string;
  link?: string | null;
  sourceEvent?: string | null;
  playSound?: boolean;
}): Promise<any | null> {
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("INVALID_USER_ID");
  }

  const title = String(input.title ?? "").trim().slice(0, 180);
  const message = String(input.message ?? "").trim();
  if (!title) throw new Error("NOTIFICATION_TITLE_REQUIRED");
  if (!message) throw new Error("NOTIFICATION_MESSAGE_REQUIRED");
  const settings = await getCommunicationSettings();
  if (!isNotificationEnabledForEvent(settings, input)) {
    return null;
  }

  const normalizedMessage = message.slice(0, MAX_MESSAGE_LEN);
  let storedContent: NotificationContentStorage | null = null;

  if (settings.notificationE2eeEnabled) {
    const recipientKey = await getMailboxPublicKeyForUser(userId);
    if (recipientKey?.mailboxPublicKey && recipientKey.mailboxPublicKeyAlgo === E2EE_KEY_ALGO_RSA_OAEP_256_V1) {
      try {
        storedContent = encodeNotificationContentForE2eeStorage({
          title,
          message: normalizedMessage,
          recipientUserId: userId,
          recipientPublicKeyPem: recipientKey.mailboxPublicKey,
        });
      } catch (error) {
        if (settings.notificationE2eeRequired) {
          console.warn(
            `[notifications] skipped notification due to E2EE encryption failure for user=${userId}`,
            error,
          );
          return null;
        }
      }
    } else if (settings.notificationE2eeRequired) {
      console.warn(
        `[notifications] skipped notification due to missing/unsupported E2EE key for user=${userId}`,
      );
      return null;
    }
  }

  if (!storedContent) {
    storedContent = encodeNotificationContentForStorage({
      title,
      message: normalizedMessage,
    });
  }

  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      type: normalizeNotificationType(input.type),
      severity: normalizeNotificationSeverity(input.severity),
      title: storedContent.title,
      message: storedContent.message,
      titleEncrypted: storedContent.titleEncrypted,
      messageEncrypted: storedContent.messageEncrypted,
      contentEncoding: storedContent.contentEncoding,
      encryptionVersion: storedContent.encryptionVersion,
      contentDigestSha256: storedContent.contentDigestSha256,
      e2eeEnvelope: storedContent.e2eeEnvelope,
      link: input.link ? String(input.link).slice(0, 500) : null,
      sourceEvent: input.sourceEvent ? String(input.sourceEvent).slice(0, 160) : null,
      createdAt: nowSec(),
    })
    .returning();

  const contentDecoded = decodeNotificationContentFromRow(row as any);

  if (settings.notificationRealtimeEnabled) {
    publishLiveEvent({
      type: "notifications:new",
      userId,
      payload: {
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: contentDecoded.title,
        message: contentDecoded.message,
        createdAt: row.createdAt,
        link: row.link,
        contentEncoding: row.contentEncoding,
        e2eeEnvelope: row.e2eeEnvelope,
        playSound: settings.notificationSoundDefaultEnabled && (input.playSound ?? true),
      },
    });
  }

  return {
    ...row,
    title: contentDecoded.title,
    message: contentDecoded.message,
  };
}

export async function listNotificationsForUser(userId: number, limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return { rows: [], unreadCount: 0 };

  const [rows, unreadCountRes] = await Promise.all([
    db
      .select({
        id: notifications.id,
        type: notifications.type,
        severity: notifications.severity,
        title: notifications.title,
        titleEncrypted: notifications.titleEncrypted,
        message: notifications.message,
        messageEncrypted: notifications.messageEncrypted,
        contentEncoding: notifications.contentEncoding,
        e2eeEnvelope: notifications.e2eeEnvelope,
        isRead: notifications.isRead,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
        link: notifications.link,
      })
      .from(notifications)
      .where(eq(notifications.userId, uid))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(safeLimit),
    db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(notifications)
      .where(and(eq(notifications.userId, uid), eq(notifications.isRead, false)))
      .limit(1),
  ]);

  return {
    rows: rows.map((row: any) => {
      const content = decodeNotificationContentFromRow(row as any);
      const {
        titleEncrypted: _titleEncrypted,
        messageEncrypted: _messageEncrypted,
        contentEncoding,
        e2eeEnvelope,
        ...rest
      } = row;
      return {
        ...rest,
        title: content.title,
        message: content.message,
        contentEncoding,
        e2eeEnvelope,
      };
    }),
    unreadCount: Number(unreadCountRes[0]?.count ?? 0),
  };
}

export async function markNotificationsReadForUser(input: {
  userId: number;
  ids?: number[];
  markAll?: boolean;
}) {
  const uid = Number(input.userId);
  if (!Number.isInteger(uid) || uid <= 0) return { updated: 0 };

  const now = nowSec();
  if (input.markAll) {
    const rows = await db
      .update(notifications)
      .set({ isRead: true, readAt: now })
      .where(and(eq(notifications.userId, uid), eq(notifications.isRead, false)))
      .returning({ id: notifications.id });

    publishLiveEvent({
      type: "notifications:updated",
      userId: uid,
      payload: { markAll: true, ids: rows.map((row) => row.id) },
    });
    return { updated: rows.length };
  }

  const ids = dedupePositiveInts(Array.isArray(input.ids) ? input.ids : []);
  if (!ids.length) return { updated: 0 };

  const rows = await db
    .update(notifications)
    .set({ isRead: true, readAt: now })
    .where(and(eq(notifications.userId, uid), inArray(notifications.id, ids), eq(notifications.isRead, false)))
    .returning({ id: notifications.id });

  publishLiveEvent({
    type: "notifications:updated",
    userId: uid,
    payload: { ids: rows.map((row) => row.id) },
  });

  return { updated: rows.length };
}

async function assertThreadParticipant(threadId: number, userId: number): Promise<void> {
  const [participant] = await db
    .select({ threadId: mailboxParticipants.threadId })
    .from(mailboxParticipants)
    .where(and(eq(mailboxParticipants.threadId, threadId), eq(mailboxParticipants.userId, userId)))
    .limit(1);

  if (!participant) {
    throw new Error("THREAD_ACCESS_DENIED");
  }
}

async function publishMailboxThreadEvents(userIds: number[], payload: Record<string, unknown>) {
  for (const userId of userIds) {
    publishLiveEvent({
      type: "mailbox:new",
      userId,
      payload,
    });
  }
}

export async function createMailboxThreadWithMessage(input: {
  createdByUserId: number | null;
  senderUserId: number | null;
  recipientUserIds: number[];
  subject: string;
  body: string;
  contentFormat?: string;
  allowReply?: boolean;
  category?: MailboxCategory | string;
  isBroadcast?: boolean;
  messageType?: string;
  metadata?: Record<string, unknown> | null;
  e2eeEnvelope?: string | null;
  e2eeSenderKeyFingerprint?: string | null;
  bodyDigestSha256?: string | null;
  audit?: MailboxAuditContext;
  allowAsyncFanout?: boolean;
}) {
  const messagingSettings = await getCommunicationSettings();
  if (!messagingSettings.messagingEnabled) throw new Error("MESSAGING_DISABLED");

  const recipientUserIds = dedupePositiveInts(input.recipientUserIds || []);
  if (!recipientUserIds.length) throw new Error("RECIPIENTS_REQUIRED");
  if (recipientUserIds.length > messagingSettings.messagingMaxRecipientsPerSend) {
    throw new Error("RECIPIENTS_LIMIT_EXCEEDED");
  }

  const senderUserId =
    Number.isInteger(Number(input.senderUserId)) && Number(input.senderUserId) > 0
      ? Number(input.senderUserId)
      : null;
  const createdByUserId =
    Number.isInteger(Number(input.createdByUserId)) && Number(input.createdByUserId) > 0
      ? Number(input.createdByUserId)
      : null;
  const timestamp = nowSec();

  const subject = normalizeSubject(input.subject);
  const body = normalizeBody(input.body);
  const hasE2eeEnvelope = typeof input.e2eeEnvelope === "string" && input.e2eeEnvelope.trim().length > 0;
  if (hasE2eeEnvelope && !messagingSettings.messagingE2eeEnabled) {
    throw new Error("E2EE_DISABLED");
  }
  const e2eeRequiredForMessage = messagingSettings.messagingE2eeRequired && senderUserId !== null;
  if (!hasE2eeEnvelope && e2eeRequiredForMessage) {
    throw new Error("E2EE_REQUIRED");
  }
  const storedBody = hasE2eeEnvelope
    ? encodeMailboxBodyForE2eeStorage({
        envelope: String(input.e2eeEnvelope),
        recipientUserIds,
        senderKeyFingerprint: input.e2eeSenderKeyFingerprint,
        bodyDigestSha256: input.bodyDigestSha256,
        contentFormat: input.contentFormat,
      })
    : encodeMailboxBodyForStorage({
        plaintextBody: body,
        contentFormat: input.contentFormat,
      });
  const category = normalizeCategory(input.category);
  const isBroadcast = Boolean(input.isBroadcast);
  const allowReply =
    typeof input.allowReply === "boolean"
      ? input.allowReply
      : messagingSettings.messagingAllowReplyByDefault;
  if (allowReply && recipientUserIds.length > 1 && !messagingSettings.messagingAllowBroadcastReplies) {
    throw new Error("REPLY_ENABLED_BROADCAST_DISABLED");
  }
  const messageType = String(input.messageType ?? (isBroadcast ? "BROADCAST" : "DIRECT")).slice(0, 40);
  const metadata = input.metadata && typeof input.metadata === "object" ? JSON.stringify(input.metadata) : "{}";

  const shouldQueueFanout =
    Boolean(input.allowAsyncFanout) &&
    recipientUserIds.length > messagingSettings.messagingAsyncFanoutThreshold;
  const initialParticipants = shouldQueueFanout ? [] : recipientUserIds;
  const senderAsParticipant =
    senderUserId && !recipientUserIds.includes(senderUserId) ? [senderUserId] : [];

  const result = await db.transaction(async (tx) => {
    const [thread] = await tx
      .insert(mailboxThreads)
      .values({
        subject,
        createdBy: createdByUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
        isBroadcast,
        category,
      })
      .returning({ id: mailboxThreads.id });

    const [message] = await tx
      .insert(mailboxMessages)
      .values({
        threadId: thread.id,
        senderId: senderUserId,
        body: storedBody.body,
        bodyEncrypted: storedBody.bodyEncrypted,
        bodyEncoding: storedBody.bodyEncoding,
        encryptionVersion: storedBody.encryptionVersion,
        bodyDigestSha256: storedBody.bodyDigestSha256,
        e2eeEnvelope: storedBody.e2eeEnvelope,
        e2eeSenderKeyFingerprint: storedBody.e2eeSenderKeyFingerprint,
        contentFormat: storedBody.contentFormat,
        createdAt: timestamp,
        allowReply,
        messageType,
        metadata,
      })
      .returning({ id: mailboxMessages.id });

    const participants = dedupePositiveInts([...initialParticipants, ...senderAsParticipant]);
    if (participants.length) {
      await tx
        .insert(mailboxParticipants)
        .values(
          participants.map((userId) => ({
            threadId: thread.id,
            userId,
            lastReadMessageId: senderUserId === userId ? message.id : null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        )
        .onConflictDoNothing();
    }

    await appendMailboxAuditEntry(tx as any, {
      threadId: thread.id,
      messageId: message.id,
      action: "MESSAGE_CREATED",
      actorUserId: input.audit?.actorUserId ?? senderUserId ?? createdByUserId,
      actorRole: input.audit?.actorRole ?? (senderUserId ? "USER" : "SYSTEM"),
      ip: input.audit?.ip ?? null,
      userAgent: input.audit?.userAgent ?? null,
      metadata: {
        category,
        allowReply,
        isBroadcast,
        messageType,
        queuedFanout: shouldQueueFanout,
        contentFormat: storedBody.contentFormat,
        bodyEncoding: storedBody.bodyEncoding,
      },
    });

    return {
      threadId: thread.id,
      messageId: message.id,
      queued: shouldQueueFanout,
      participants: dedupePositiveInts([...participants, ...recipientUserIds]),
    };
  });

  if (shouldQueueFanout) {
    enqueueBroadcastFanout({
      threadId: result.threadId,
      messageId: result.messageId,
      userIds: recipientUserIds,
      batchSize: messagingSettings.messagingFanoutBatchSize,
    });
  }

  const recipientsToNotify = shouldQueueFanout ? senderAsParticipant : result.participants;
  await publishMailboxThreadEvents(recipientsToNotify, {
    threadId: result.threadId,
    messageId: result.messageId,
  });

  return result;
}

export async function replyToMailboxThread(input: {
  threadId: number;
  senderUserId: number;
  senderIsAdmin: boolean;
  body: string;
  contentFormat?: string;
  e2eeEnvelope?: string | null;
  e2eeSenderKeyFingerprint?: string | null;
  bodyDigestSha256?: string | null;
  audit?: MailboxAuditContext;
}) {
  const settings = await getCommunicationSettings();
  if (!settings.messagingEnabled) throw new Error("MESSAGING_DISABLED");

  const threadId = Number(input.threadId);
  const senderUserId = Number(input.senderUserId);
  if (!Number.isInteger(threadId) || threadId <= 0) throw new Error("INVALID_THREAD_ID");
  if (!Number.isInteger(senderUserId) || senderUserId <= 0) throw new Error("INVALID_USER_ID");

  await assertThreadParticipant(threadId, senderUserId);

  const body = normalizeBody(input.body);
  const hasE2eeEnvelope = typeof input.e2eeEnvelope === "string" && input.e2eeEnvelope.trim().length > 0;
  if (hasE2eeEnvelope && !settings.messagingE2eeEnabled) {
    throw new Error("E2EE_DISABLED");
  }
  if (!hasE2eeEnvelope && settings.messagingE2eeRequired) {
    throw new Error("E2EE_REQUIRED");
  }
  const participantRows = await db
    .select({ userId: mailboxParticipants.userId })
    .from(mailboxParticipants)
    .where(eq(mailboxParticipants.threadId, threadId));
  const threadParticipantIds = participantRows.map((row) => Number(row.userId));
  const storedBody = hasE2eeEnvelope
    ? encodeMailboxBodyForE2eeStorage({
        envelope: String(input.e2eeEnvelope),
        recipientUserIds: threadParticipantIds.filter((id) => id !== senderUserId),
        senderKeyFingerprint: input.e2eeSenderKeyFingerprint,
        bodyDigestSha256: input.bodyDigestSha256,
        contentFormat: input.contentFormat,
      })
    : encodeMailboxBodyForStorage({
        plaintextBody: body,
        contentFormat: input.contentFormat,
      });
  const now = nowSec();

  const [latestMessage] = await db
    .select({
      id: mailboxMessages.id,
      allowReply: mailboxMessages.allowReply,
    })
    .from(mailboxMessages)
    .where(eq(mailboxMessages.threadId, threadId))
    .orderBy(desc(mailboxMessages.id))
    .limit(1);

  if (!latestMessage) throw new Error("THREAD_EMPTY");
  if (!input.senderIsAdmin && !latestMessage.allowReply) throw new Error("REPLY_DISABLED");

  const [created] = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(mailboxMessages)
      .values({
        threadId,
        senderId: senderUserId,
        body: storedBody.body,
        bodyEncrypted: storedBody.bodyEncrypted,
        bodyEncoding: storedBody.bodyEncoding,
        encryptionVersion: storedBody.encryptionVersion,
        bodyDigestSha256: storedBody.bodyDigestSha256,
        e2eeEnvelope: storedBody.e2eeEnvelope,
        e2eeSenderKeyFingerprint: storedBody.e2eeSenderKeyFingerprint,
        contentFormat: storedBody.contentFormat,
        allowReply: input.senderIsAdmin,
        createdAt: now,
        messageType: "REPLY",
      })
      .returning({
        id: mailboxMessages.id,
      });

    await tx
      .update(mailboxThreads)
      .set({ updatedAt: now })
      .where(eq(mailboxThreads.id, threadId));

    await tx
      .update(mailboxParticipants)
      .set({ lastReadMessageId: message.id, updatedAt: now })
      .where(and(eq(mailboxParticipants.threadId, threadId), eq(mailboxParticipants.userId, senderUserId)));

    await appendMailboxAuditEntry(tx as any, {
      threadId,
      messageId: message.id,
      action: "MESSAGE_REPLIED",
      actorUserId: input.audit?.actorUserId ?? senderUserId,
      actorRole: input.audit?.actorRole ?? (input.senderIsAdmin ? "ADMIN" : "USER"),
      ip: input.audit?.ip ?? null,
      userAgent: input.audit?.userAgent ?? null,
      metadata: {
        contentFormat: storedBody.contentFormat,
        bodyEncoding: storedBody.bodyEncoding,
      },
    });

    return [message];
  });

  const recipientIds = threadParticipantIds.filter(
    (userId) => Number.isInteger(userId) && userId > 0 && userId !== senderUserId,
  );

  await publishMailboxThreadEvents(recipientIds, {
    threadId,
    messageId: created.id,
    reply: true,
  });

  publishLiveEvent({
    type: "mailbox:updated",
    userId: senderUserId,
    payload: { threadId, messageId: created.id },
  });

  return { threadId, messageId: created.id };
}

export async function listMailboxThreadsForUser(input: {
  userId: number;
  limit?: number;
  offset?: number;
}) {
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) return { rows: [], unreadCount: 0 };

  const limit = Math.max(1, Math.min(100, Number(input.limit) || 30));
  const offset = Math.max(0, Number(input.offset) || 0);

  const listRes = await dbClient.query(
    `
      SELECT
        t.id AS "threadId",
        t.subject AS "subject",
        t.category AS "category",
        t.is_broadcast AS "isBroadcast",
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        p.is_pinned AS "isPinned",
        p.last_read_message_id AS "lastReadMessageId",
        lm.id AS "latestMessageId",
        lm.body AS "latestBody",
        lm.body_encrypted AS "latestBodyEncrypted",
        lm.body_encoding AS "latestBodyEncoding",
        lm.content_format AS "latestContentFormat",
        lm.created_at AS "latestCreatedAt",
        lm.sender_id AS "latestSenderId",
        lm.allow_reply AS "latestAllowReply",
        su.email AS "latestSenderEmail",
        su.username AS "latestSenderUsername",
        (
          (p.last_read_message_id IS NULL OR lm.id > p.last_read_message_id)
          AND COALESCE(lm.sender_id, 0) <> $1
        ) AS "hasUnread"
      FROM mailbox_participants p
      INNER JOIN mailbox_threads t
        ON t.id = p.thread_id
      INNER JOIN LATERAL (
        SELECT
          m.id,
          m.body,
          m.body_encrypted,
          m.body_encoding,
          m.content_format,
          m.created_at,
          m.sender_id,
          m.allow_reply
        FROM mailbox_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.id DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN users su
        ON su.id = lm.sender_id
      WHERE p.user_id = $1
        AND p.is_archived = FALSE
      ORDER BY
        CASE WHEN p.is_pinned THEN 0 ELSE 1 END ASC,
        t.updated_at DESC,
        t.id DESC
      LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset],
  );

  const unreadRes = await dbClient.query(
    `
      SELECT CAST(COUNT(*) AS int) AS "count"
      FROM mailbox_participants p
      INNER JOIN mailbox_threads t ON t.id = p.thread_id
      INNER JOIN LATERAL (
        SELECT m.id, m.sender_id
        FROM mailbox_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.id DESC
        LIMIT 1
      ) lm ON TRUE
      WHERE p.user_id = $1
        AND p.is_archived = FALSE
        AND (p.last_read_message_id IS NULL OR lm.id > p.last_read_message_id)
        AND COALESCE(lm.sender_id, 0) <> $1
    `,
    [userId],
  );

  return {
    rows: listRes.rows.map((row: any) => {
      const decodedBody = decodeMailboxBodyFromRow({
        body: row.latestBody,
        bodyEncrypted: row.latestBodyEncrypted,
        bodyEncoding: row.latestBodyEncoding,
      });
      const { latestBodyEncrypted: _encrypted, latestBodyEncoding: _encoding, ...rest } = row;
      return {
        ...rest,
        latestBody: decodedBody,
      };
    }),
    unreadCount: Number(unreadRes.rows[0]?.count ?? 0),
  };
}

export async function getMailboxThreadMessages(input: {
  userId: number;
  threadId: number;
  limit?: number;
  beforeMessageId?: number | null;
  audit?: MailboxAuditContext;
}) {
  const userId = Number(input.userId);
  const threadId = Number(input.threadId);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("INVALID_USER_ID");
  if (!Number.isInteger(threadId) || threadId <= 0) throw new Error("INVALID_THREAD_ID");

  await assertThreadParticipant(threadId, userId);

  const limit = Math.max(1, Math.min(200, Number(input.limit) || 80));
  const beforeMessageId =
    Number.isInteger(Number(input.beforeMessageId)) && Number(input.beforeMessageId) > 0
      ? Number(input.beforeMessageId)
      : null;

  const threadRes = await dbClient.query(
    `
      SELECT
        t.id AS "threadId",
        t.subject AS "subject",
        t.category AS "category",
        t.is_broadcast AS "isBroadcast",
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt"
      FROM mailbox_threads t
      WHERE t.id = $1
      LIMIT 1
    `,
    [threadId],
  );
  const thread = threadRes.rows[0];
  if (!thread) throw new Error("THREAD_NOT_FOUND");

  const messagesRes = await dbClient.query(
    `
      SELECT
        m.id AS "id",
        m.thread_id AS "threadId",
        m.sender_id AS "senderId",
        m.body AS "body",
        m.body_encrypted AS "bodyEncrypted",
        m.body_encoding AS "bodyEncoding",
        m.e2ee_envelope AS "e2eeEnvelope",
        m.e2ee_sender_key_fingerprint AS "e2eeSenderKeyFingerprint",
        m.content_format AS "contentFormat",
        m.created_at AS "createdAt",
        m.allow_reply AS "allowReply",
        m.message_type AS "messageType",
        m.metadata AS "metadata",
        su.username AS "senderUsername",
        su.email AS "senderEmail",
        su.is_admin AS "senderIsAdmin"
      FROM mailbox_messages m
      LEFT JOIN users su ON su.id = m.sender_id
      WHERE m.thread_id = $1
        AND ($2::int IS NULL OR m.id < $2::int)
      ORDER BY m.id DESC
      LIMIT $3
    `,
    [threadId, beforeMessageId, limit],
  );

  const participantsRes = await dbClient.query(
    `
      SELECT
        mp.user_id AS "userId",
        mp.last_read_message_id AS "lastReadMessageId",
        u.email AS "email",
        u.username AS "username",
        u.is_admin AS "isAdmin",
        u.mailbox_public_key AS "mailboxPublicKey",
        u.mailbox_public_key_algo AS "mailboxPublicKeyAlgo",
        u.mailbox_public_key_fingerprint AS "mailboxPublicKeyFingerprint",
        u.mailbox_public_key_updated_at AS "mailboxPublicKeyUpdatedAt"
      FROM mailbox_participants mp
      INNER JOIN users u ON u.id = mp.user_id
      WHERE mp.thread_id = $1
      ORDER BY mp.user_id ASC
    `,
    [threadId],
  );

  const rows = [...messagesRes.rows]
    .reverse()
    .map((row: any) => {
      const { bodyEncrypted: _encrypted, ...rest } = row;
      return {
        ...rest,
        body: decodeMailboxBodyFromRow({
          body: row.body,
          bodyEncrypted: row.bodyEncrypted,
          bodyEncoding: row.bodyEncoding,
        }),
      };
    });
  const latestReadId = rows.length ? Number(rows[rows.length - 1].id) : null;

  if (latestReadId) {
    await db
      .update(mailboxParticipants)
      .set({
        // Prevent pagination calls from moving the read cursor backwards.
        lastReadMessageId: sql`GREATEST(COALESCE(${mailboxParticipants.lastReadMessageId}, 0), ${latestReadId})`,
        updatedAt: nowSec(),
      })
      .where(and(eq(mailboxParticipants.threadId, threadId), eq(mailboxParticipants.userId, userId)));
    await appendMailboxAuditEntry(db as any, {
      threadId,
      messageId: latestReadId,
      action: "THREAD_READ",
      actorUserId: input.audit?.actorUserId ?? userId,
      actorRole: input.audit?.actorRole ?? "USER",
      ip: input.audit?.ip ?? null,
      userAgent: input.audit?.userAgent ?? null,
      metadata: {
        readThroughMessageId: latestReadId,
      },
    });
    publishLiveEvent({
      type: "mailbox:updated",
      userId,
      payload: { threadId, readThroughMessageId: latestReadId },
    });
  }

  return {
    thread,
    messages: rows,
    participants: participantsRes.rows.map((row: any) => ({
      userId: Number(row.userId),
      lastReadMessageId:
        Number.isFinite(Number(row.lastReadMessageId)) && Number(row.lastReadMessageId) > 0
          ? Number(row.lastReadMessageId)
          : null,
      email: row.email ?? null,
      username: row.username ?? null,
      isAdmin: Boolean(row.isAdmin),
      mailboxPublicKey: normalizeMailboxPublicKeyPem(row.mailboxPublicKey),
      mailboxPublicKeyAlgo: normalizeE2eeKeyAlgo(row.mailboxPublicKeyAlgo),
      mailboxPublicKeyFingerprint: normalizePublicKeyFingerprint(row.mailboxPublicKeyFingerprint),
      mailboxPublicKeyUpdatedAt:
        Number.isFinite(Number(row.mailboxPublicKeyUpdatedAt)) && Number(row.mailboxPublicKeyUpdatedAt) > 0
          ? Number(row.mailboxPublicKeyUpdatedAt)
          : null,
    })),
  };
}

export async function listAdminReplyThreads(input: {
  adminId: number;
  limit?: number;
  offset?: number;
}) {
  const adminId = Number(input.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) return { rows: [] };
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);

  const res = await dbClient.query(
    `
      SELECT
        t.id AS "threadId",
        t.subject AS "subject",
        t.category AS "category",
        t.updated_at AS "updatedAt",
        lm.id AS "latestMessageId",
        lm.body AS "latestBody",
        lm.body_encrypted AS "latestBodyEncrypted",
        lm.body_encoding AS "latestBodyEncoding",
        lm.content_format AS "latestContentFormat",
        lm.created_at AS "latestCreatedAt",
        lm.sender_id AS "latestSenderId",
        su.email AS "latestSenderEmail",
        su.username AS "latestSenderUsername",
        (pa.last_read_message_id IS NULL OR lm.id > pa.last_read_message_id) AS "isUnreadByAdmin",
        (
          SELECT CAST(COUNT(*) AS int)
          FROM mailbox_messages um
          LEFT JOIN users uu ON uu.id = um.sender_id
          WHERE um.thread_id = t.id
            AND COALESCE(uu.is_admin, FALSE) = FALSE
            AND (pa.last_read_message_id IS NULL OR um.id > pa.last_read_message_id)
        ) AS "unreadUserReplyCount",
        (
          SELECT MAX(um.created_at)
          FROM mailbox_messages um
          LEFT JOIN users uu ON uu.id = um.sender_id
          WHERE um.thread_id = t.id
            AND COALESCE(uu.is_admin, FALSE) = FALSE
        ) AS "latestUserReplyAt"
      FROM mailbox_threads t
      INNER JOIN mailbox_participants pa
        ON pa.thread_id = t.id
       AND pa.user_id = $1
      INNER JOIN LATERAL (
        SELECT m.id, m.body, m.body_encrypted, m.body_encoding, m.content_format, m.created_at, m.sender_id
        FROM mailbox_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.id DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN users su ON su.id = lm.sender_id
      WHERE lm.sender_id IS NOT NULL
        AND COALESCE(su.is_admin, FALSE) = FALSE
      ORDER BY t.updated_at DESC
      LIMIT $2 OFFSET $3
    `,
    [adminId, limit, offset],
  );

  return {
    rows: res.rows.map((row: any) => {
      const decodedBody = decodeMailboxBodyFromRow({
        body: row.latestBody,
        bodyEncrypted: row.latestBodyEncrypted,
        bodyEncoding: row.latestBodyEncoding,
      });
      const { latestBodyEncrypted: _encrypted, latestBodyEncoding: _encoding, ...rest } = row;
      return {
        ...rest,
        latestBody: decodedBody,
        unreadUserReplyCount: Number(row.unreadUserReplyCount ?? 0),
        latestUserReplyAt:
          Number.isFinite(Number(row.latestUserReplyAt)) && Number(row.latestUserReplyAt) > 0
            ? Number(row.latestUserReplyAt)
            : null,
      };
    }),
  };
}

export async function listAdminSentThreads(input: {
  adminId: number;
  limit?: number;
  offset?: number;
}) {
  const adminId = Number(input.adminId);
  if (!Number.isInteger(adminId) || adminId <= 0) return { rows: [] };
  const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
  const offset = Math.max(0, Number(input.offset) || 0);

  const res = await dbClient.query(
    `
      SELECT
        t.id AS "threadId",
        t.subject AS "subject",
        t.category AS "category",
        t.is_broadcast AS "isBroadcast",
        t.created_at AS "createdAt",
        t.updated_at AS "updatedAt",
        lm.id AS "latestMessageId",
        lm.body AS "latestBody",
        lm.body_encrypted AS "latestBodyEncrypted",
        lm.body_encoding AS "latestBodyEncoding",
        lm.content_format AS "latestContentFormat",
        lm.created_at AS "latestCreatedAt",
        lm.allow_reply AS "latestAllowReply",
        (
          SELECT CAST(COUNT(*) AS int)
          FROM mailbox_participants mp
          WHERE mp.thread_id = t.id
            AND mp.user_id <> $1
        ) AS "recipientCount"
      FROM mailbox_threads t
      INNER JOIN LATERAL (
        SELECT m.id, m.body, m.body_encrypted, m.body_encoding, m.content_format, m.created_at, m.allow_reply
        FROM mailbox_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.id DESC
        LIMIT 1
      ) lm ON TRUE
      WHERE t.created_by = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3
    `,
    [adminId, limit, offset],
  );

  return {
    rows: res.rows.map((row: any) => {
      const decodedBody = decodeMailboxBodyFromRow({
        body: row.latestBody,
        bodyEncrypted: row.latestBodyEncrypted,
        bodyEncoding: row.latestBodyEncoding,
      });
      const { latestBodyEncrypted: _encrypted, latestBodyEncoding: _encoding, ...rest } = row;
      return {
        ...rest,
        latestBody: decodedBody,
      };
    }),
  };
}

export async function searchMailboxTargetUsers(input: {
  q?: string;
  tier?: string;
  limit?: number;
}) {
  const q = String(input.q ?? "").trim();
  const tier = String(input.tier ?? "").trim().toUpperCase();
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 50));

  const clauses: string[] = ['u.is_deleted = FALSE', 'u.is_disabled = FALSE', 'u.is_admin = FALSE'];
  const values: any[] = [];
  let idx = 1;

  if (q) {
    values.push(`%${q}%`);
    clauses.push(`(u.email ILIKE $${idx} OR u.username ILIKE $${idx})`);
    idx += 1;
  }
  if (tier) {
    values.push(tier);
    clauses.push(`u.user_tier = $${idx}`);
    idx += 1;
  }
  values.push(limit);

  const sqlText = `
    SELECT
      u.id AS "id",
      u.email AS "email",
      u.username AS "username",
      u.user_tier AS "userTier",
      MAX(s.last_active_at) AS "lastActiveAt"
    FROM users u
    LEFT JOIN user_sessions s
      ON s.user_id = u.id
     AND s.revoked_at IS NULL
    WHERE ${clauses.join(" AND ")}
    GROUP BY u.id, u.email, u.username, u.user_tier
    ORDER BY COALESCE(MAX(s.last_active_at), 0) DESC, u.id DESC
    LIMIT $${idx}
  `;

  const res = await dbClient.query(sqlText, values);
  return { rows: res.rows };
}

export async function sendWelcomeMailboxMessage(userId: number) {
  const settings = await getCommunicationSettings();
  if (!settings.messagingEnabled || !settings.messagingAutoWelcomeEnabled) return;

  await createMailboxThreadWithMessage({
    createdByUserId: null,
    senderUserId: null,
    recipientUserIds: [userId],
    subject: "Welcome to TradeQuip",
    body: "Welcome aboard. Your internal mailbox is now active for platform and account updates.",
    allowReply: true,
    category: "SYSTEM",
    isBroadcast: false,
    messageType: "WELCOME",
  });
}

export async function sendFreezeMailboxMessage(input: {
  userId: number;
  reasonCode: string;
  reasonText?: string | null;
}) {
  const settings = await getCommunicationSettings();
  if (!settings.messagingEnabled || !settings.messagingAccountStatusMailboxEnabled) return;

  const reason = input.reasonText ? `${input.reasonCode}: ${input.reasonText}` : input.reasonCode;
  await createMailboxThreadWithMessage({
    createdByUserId: null,
    senderUserId: null,
    recipientUserIds: [input.userId],
    subject: "Account status update",
    body: `Your account has been frozen. Reason: ${reason}. Reply in this thread if you need assistance.`,
    allowReply: true,
    category: "SYSTEM",
    isBroadcast: false,
    messageType: "ACCOUNT",
  });
}

export async function sendUnfreezeMailboxMessage(input: { userId: number; reason?: string | null }) {
  const settings = await getCommunicationSettings();
  if (!settings.messagingEnabled || !settings.messagingAccountStatusMailboxEnabled) return;

  await createMailboxThreadWithMessage({
    createdByUserId: null,
    senderUserId: null,
    recipientUserIds: [input.userId],
    subject: "Account access restored",
    body: input.reason
      ? `Your account freeze has been lifted. Note: ${input.reason}.`
      : "Your account freeze has been lifted. Trading access has been restored.",
    allowReply: true,
    category: "SYSTEM",
    isBroadcast: false,
    messageType: "ACCOUNT",
  });
}

export async function sendKycMailboxMessage(input: {
  userId: number;
  actorAdminId?: number | null;
  subject: string;
  body: string;
}) {
  const settings = await getCommunicationSettings();
  if (!settings.messagingEnabled || !settings.messagingKycMailboxEnabled) return;

  await createMailboxThreadWithMessage({
    createdByUserId: Number.isInteger(Number(input.actorAdminId)) ? Number(input.actorAdminId) : null,
    senderUserId: Number.isInteger(Number(input.actorAdminId)) ? Number(input.actorAdminId) : null,
    recipientUserIds: [input.userId],
    subject: input.subject,
    body: input.body,
    allowReply: true,
    category: "SYSTEM",
    isBroadcast: false,
    messageType: "KYC",
    audit: {
      actorUserId: Number.isInteger(Number(input.actorAdminId)) ? Number(input.actorAdminId) : null,
      actorRole: Number.isInteger(Number(input.actorAdminId)) ? "ADMIN" : "SYSTEM",
    },
  });
}

export function getMessagingMetrics() {
  return {
    mailboxFanoutQueueDepth: broadcastFanoutQueue.length,
    mailboxFanoutRunning: broadcastFanoutRunning ? 1 : 0,
    mailboxFanoutEnqueuedTotal: metricMailboxFanoutEnqueuedTotal,
    mailboxFanoutProcessedTotal: metricMailboxFanoutProcessedTotal,
    mailboxFanoutFailedTotal: metricMailboxFanoutFailedTotal,
  };
}
