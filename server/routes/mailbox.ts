import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/requireAdmin";
import { appendIdentityAudit } from "../services/identityAudit";
import {
  createMailboxThreadWithMessage,
  getMailboxPublicKeyForUser,
  getCommunicationSettings,
  getMailboxThreadMessages,
  listAdminReplyThreads,
  listAdminSentThreads,
  listMailboxThreadsForUser,
  replyToMailboxThread,
  resolveMailboxRecipientsWithKeys,
  resolveMailboxRecipientIds,
  searchMailboxTargetUsers,
  upsertMailboxPublicKeyForUser,
  updateCommunicationSettings,
} from "../services/messaging";

const recipientSelectorSchema = z.object({
  mode: z.enum(["ALL", "USER_IDS", "TIER", "ACTIVE_DAYS"]),
  userIds: z.array(z.number().int().positive()).optional(),
  tier: z.enum(["CANDIDATE", "PERFORMER", "SELECTED"]).optional(),
  activeWithinDays: z.number().int().min(1).max(365).optional(),
  includeAdmins: z.boolean().optional(),
});

const composeSchema = z.object({
  recipients: recipientSelectorSchema,
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(8000),
  contentFormat: z.enum(["PLAINTEXT", "MARKDOWN"]).optional(),
  allowReply: z.boolean().optional(),
  category: z.enum(["SYSTEM", "SUPPORT", "ANNOUNCEMENT", "CHALLENGES"]).optional(),
  confirmLargeTarget: z.boolean().optional(),
  e2eeEnvelope: z.string().max(1500000).optional(),
  e2eeSenderKeyFingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  bodyDigestSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
});

const replySchema = z.object({
  body: z.string().min(1).max(8000),
  contentFormat: z.enum(["PLAINTEXT", "MARKDOWN"]).optional(),
  e2eeEnvelope: z.string().max(1500000).optional(),
  e2eeSenderKeyFingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  bodyDigestSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
});

const publicKeyUpdateSchema = z.object({
  publicKeyPem: z.string().min(32).max(10000),
  keyAlgorithm: z.enum(["RSA_OAEP_256_V1"]).optional(),
  fingerprint: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
});

const resolveRecipientsSchema = z.object({
  recipients: recipientSelectorSchema,
});

const communicationSettingsUpdateSchema = z
  .object({
    messagingEnabled: z.boolean().optional(),
    messagingAllowReplyByDefault: z.boolean().optional(),
    messagingAllowBroadcastReplies: z.boolean().optional(),
    messagingLargeTargetThreshold: z.number().int().min(1).max(20000).optional(),
    messagingMaxRecipientsPerSend: z.number().int().min(1).max(200000).optional(),
    messagingAsyncFanoutThreshold: z.number().int().min(1).max(50000).optional(),
    messagingFanoutBatchSize: z.number().int().min(50).max(5000).optional(),
    messagingAutoWelcomeEnabled: z.boolean().optional(),
    messagingAccountStatusMailboxEnabled: z.boolean().optional(),
    messagingKycMailboxEnabled: z.boolean().optional(),
    messagingE2eeEnabled: z.boolean().optional(),
    messagingE2eeRequired: z.boolean().optional(),
    notificationsEnabled: z.boolean().optional(),
    notificationRealtimeEnabled: z.boolean().optional(),
    notificationSoundDefaultEnabled: z.boolean().optional(),
    notificationE2eeEnabled: z.boolean().optional(),
    notificationE2eeRequired: z.boolean().optional(),
    notificationTradePendingFillEnabled: z.boolean().optional(),
    notificationTradeTakeProfitEnabled: z.boolean().optional(),
    notificationTradeStopLossEnabled: z.boolean().optional(),
    notificationTradeMaxHoldEnabled: z.boolean().optional(),
    notificationAccountFreezeEnabled: z.boolean().optional(),
    notificationAccountUnfreezeEnabled: z.boolean().optional(),
    notificationKycUpdatesEnabled: z.boolean().optional(),
    notificationChallengeEnabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one setting field is required",
    path: [],
  });

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

function parseOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function parseThreadId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeSha256Fingerprint(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(text)) return text;
  return null;
}

type RateLimitEntry = {
  count: number;
  resetAtMs: number;
};

const MAILBOX_REPLY_RATE_WINDOW_MS = 60 * 1000;
const MAILBOX_REPLY_RATE_LIMIT_USER = 30;
const MAILBOX_REPLY_RATE_LIMIT_ADMIN = 120;
const MAILBOX_E2EE_KEY_UPDATE_RATE_WINDOW_MS = 60 * 60 * 1000;
const MAILBOX_E2EE_KEY_UPDATE_RATE_LIMIT = 12;
const replyRateLimitByUser = new Map<number, RateLimitEntry>();
const e2eeKeyUpdateRateLimitByUser = new Map<number, RateLimitEntry>();

function cleanupRateLimitMap(store: Map<number, RateLimitEntry>): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.resetAtMs <= now) {
      store.delete(key);
    }
  }
}

function consumeRateLimit(
  store: Map<number, RateLimitEntry>,
  key: number,
  maxPerWindow: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (current.count >= maxPerWindow) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAtMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

const mailboxRateLimitCleanupHandle = setInterval(() => {
  cleanupRateLimitMap(replyRateLimitByUser);
  cleanupRateLimitMap(e2eeKeyUpdateRateLimitByUser);
}, 5 * 60 * 1000);
(mailboxRateLimitCleanupHandle as any)?.unref?.();

function filterE2eeEnvelopeForRecipient(rawEnvelope: string | undefined, recipientUserId: number): string | undefined {
  if (!rawEnvelope || !rawEnvelope.trim()) return undefined;
  try {
    const parsed = JSON.parse(rawEnvelope);
    if (!parsed || typeof parsed !== "object" || !parsed.recipients || typeof parsed.recipients !== "object") {
      return rawEnvelope;
    }
    const recipientKey = (parsed.recipients as Record<string, unknown>)[String(recipientUserId)];
    if (!recipientKey) return rawEnvelope;
    return JSON.stringify({
      ...parsed,
      recipients: {
        [String(recipientUserId)]: recipientKey,
      },
    });
  } catch {
    return rawEnvelope;
  }
}

function errorResponse(res: any, error: unknown) {
  const code = String((error as any)?.message ?? "INTERNAL_ERROR");

  if (code === "THREAD_ACCESS_DENIED") return res.status(403).json({ message: code });
  if (code === "REPLY_DISABLED") return res.status(403).json({ message: code });
  if (code === "MESSAGING_DISABLED") return res.status(409).json({ message: code });
  if (code === "RECIPIENTS_LIMIT_EXCEEDED") return res.status(400).json({ message: code });
  if (code === "REPLY_ENABLED_BROADCAST_DISABLED") return res.status(400).json({ message: code });
  if (code === "E2EE_DISABLED" || code === "E2EE_REQUIRED") return res.status(409).json({ message: code });
  if (code.startsWith("E2EE_ENVELOPE_")) return res.status(400).json({ message: code });
  if (code === "THREAD_NOT_FOUND") return res.status(404).json({ message: code });
  if (code.startsWith("INVALID_") || code.endsWith("_REQUIRED") || code.endsWith("_TOO_LONG")) {
    return res.status(400).json({ message: code });
  }
  return res.status(500).json({ message: "Failed to process mailbox request" });
}

export const mailboxRouter = Router();
mailboxRouter.use(requireAuth);

mailboxRouter.get("/config", async (_req, res) => {
  try {
    const settings = await getCommunicationSettings();
    return res.json({
      messagingEnabled: settings.messagingEnabled,
      messagingAllowReplyByDefault: settings.messagingAllowReplyByDefault,
      messagingE2eeEnabled: settings.messagingE2eeEnabled,
      messagingE2eeRequired: settings.messagingE2eeRequired,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error("[mailbox] config fetch failed", error);
    return res.status(500).json({ message: "Failed to fetch mailbox config" });
  }
});

mailboxRouter.get("/e2ee/key", async (req, res) => {
  const userId = Number(req.session.userId);
  try {
    const keyInfo = await getMailboxPublicKeyForUser(userId);
    return res.json({
      userId,
      key: keyInfo
        ? {
            publicKeyPem: keyInfo.mailboxPublicKey,
            keyAlgorithm: keyInfo.mailboxPublicKeyAlgo,
            fingerprint: keyInfo.mailboxPublicKeyFingerprint,
            updatedAt: keyInfo.mailboxPublicKeyUpdatedAt,
          }
        : null,
    });
  } catch (error) {
    console.error("[mailbox] e2ee key fetch failed", error);
    return res.status(500).json({ message: "Failed to fetch E2EE key" });
  }
});

mailboxRouter.put("/e2ee/key", async (req, res) => {
  const userId = Number(req.session.userId);
  const actorType = req.session.isAdmin ? "ADMIN" : "USER";
  const actorEmail = typeof req.session.email === "string" ? req.session.email : null;
  const actorUsername = typeof (req.session as any).username === "string" ? (req.session as any).username : null;
  const rateLimit = consumeRateLimit(
    e2eeKeyUpdateRateLimitByUser,
    userId,
    MAILBOX_E2EE_KEY_UPDATE_RATE_LIMIT,
    MAILBOX_E2EE_KEY_UPDATE_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION_DENIED",
      title: "Mailbox E2EE key update blocked by rate limit",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_E2EE_KEY_UPDATE",
        deny: { code: "MAILBOX_E2EE_KEY_RATE_LIMIT" },
        retryAfterSec: rateLimit.retryAfterSec,
      },
    });
    res.setHeader("Retry-After", String(rateLimit.retryAfterSec));
    return res.status(429).json({
      message: "MAILBOX_E2EE_KEY_RATE_LIMIT",
      retryAfterSec: rateLimit.retryAfterSec,
    });
  }

  const parsed = publicKeyUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION_DENIED",
      title: "Mailbox E2EE key update denied due to invalid payload",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_E2EE_KEY_UPDATE",
        deny: { code: "INVALID_PAYLOAD" },
      },
    });
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const saved = await upsertMailboxPublicKeyForUser({
      userId,
      publicKeyPem: parsed.data.publicKeyPem,
      keyAlgorithm: parsed.data.keyAlgorithm,
      fingerprint: parsed.data.fingerprint,
    });
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION",
      title: "Mailbox E2EE key updated",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_E2EE_KEY_UPDATE",
        keyAlgorithm: saved.mailboxPublicKeyAlgo,
        fingerprint: saved.mailboxPublicKeyFingerprint,
        updatedAt: saved.mailboxPublicKeyUpdatedAt,
      },
    });
    return res.json({
      ok: true,
      key: {
        publicKeyPem: saved.mailboxPublicKey,
        keyAlgorithm: saved.mailboxPublicKeyAlgo,
        fingerprint: saved.mailboxPublicKeyFingerprint,
        updatedAt: saved.mailboxPublicKeyUpdatedAt,
      },
    });
  } catch (error: any) {
    const code = String(error?.message ?? "");
    if (code.startsWith("INVALID_") || code.startsWith("E2EE_")) {
      appendIdentityAudit({
        userId,
        email: actorEmail,
        username: actorUsername,
        category: "SECURITY",
        type: "ACCOUNT_ACTION_DENIED",
        title: "Mailbox E2EE key update denied",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
        actorType,
        actorUserId: userId,
        sessionId: req.sessionID ?? null,
        data: {
          action: "MAILBOX_E2EE_KEY_UPDATE",
          deny: { code },
        },
      });
      return res.status(400).json({ message: code });
    }
    console.error("[mailbox] e2ee key update failed", error);
    return res.status(500).json({ message: "Failed to save E2EE key" });
  }
});

mailboxRouter.get("/admin/targets", requireAdmin, async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const tier = typeof req.query.tier === "string" ? req.query.tier : "";
    const limit = parsePositiveInt(req.query.limit, 50, 200);

    const data = await searchMailboxTargetUsers({ q, tier, limit });
    return res.json(data);
  } catch (error) {
    console.error("[mailbox] target search failed", error);
    return res.status(500).json({ message: "Failed to search target users" });
  }
});

mailboxRouter.post("/admin/resolve-recipients", requireAdmin, async (req, res) => {
  const parsed = resolveRecipientsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const resolved = await resolveMailboxRecipientsWithKeys({
      selector: {
        ...parsed.data.recipients,
        includeAdmins: false,
      },
      includeAdmins: false,
    });
    return res.json({
      recipientCount: resolved.recipientUserIds.length,
      keyCount: resolved.keyRows.length,
      missingKeyCount: resolved.missingKeyUserIds.length,
      missingKeyUserIds: resolved.missingKeyUserIds,
      rows: resolved.keyRows.map((row) => ({
        id: row.userId,
        email: row.email,
        username: row.username,
        userTier: row.userTier,
        mailboxPublicKey: row.mailboxPublicKey,
        mailboxPublicKeyAlgo: row.mailboxPublicKeyAlgo,
        mailboxPublicKeyFingerprint: row.mailboxPublicKeyFingerprint,
      })),
    });
  } catch (error) {
    console.error("[mailbox] resolve recipients failed", error);
    return res.status(500).json({ message: "Failed to resolve recipients" });
  }
});

mailboxRouter.get("/admin/replies", requireAdmin, async (req, res) => {
  const adminId = Number(req.session.userId);
  const limit = parsePositiveInt(req.query.limit, 50, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const data = await listAdminReplyThreads({ adminId, limit, offset });
    return res.json(data);
  } catch (error) {
    console.error("[mailbox] admin replies failed", error);
    return res.status(500).json({ message: "Failed to fetch admin inbox replies" });
  }
});

mailboxRouter.get("/admin/sent", requireAdmin, async (req, res) => {
  const adminId = Number(req.session.userId);
  const limit = parsePositiveInt(req.query.limit, 50, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const data = await listAdminSentThreads({ adminId, limit, offset });
    return res.json(data);
  } catch (error) {
    console.error("[mailbox] admin sent failed", error);
    return res.status(500).json({ message: "Failed to fetch sent mailbox threads" });
  }
});

mailboxRouter.get("/admin/config", requireAdmin, async (_req, res) => {
  try {
    const settings = await getCommunicationSettings();
    return res.json(settings);
  } catch (error) {
    console.error("[mailbox] admin config fetch failed", error);
    return res.status(500).json({ message: "Failed to fetch communication settings" });
  }
});

mailboxRouter.put("/admin/config", requireAdmin, async (req, res) => {
  const parsed = communicationSettingsUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const actor =
      typeof req.session.email === "string" && req.session.email.trim().length > 0
        ? req.session.email.trim()
        : `admin:${String(req.session.userId ?? "unknown")}`;
    const settings = await updateCommunicationSettings({
      patch: parsed.data,
      updatedBy: actor,
    });
    return res.json({ ok: true, settings });
  } catch (error) {
    console.error("[mailbox] admin config update failed", error);
    return res.status(500).json({ message: "Failed to update communication settings" });
  }
});

mailboxRouter.post("/", requireAdmin, async (req, res) => {
  const adminId = Number(req.session.userId);
  if (!Number.isInteger(adminId) || adminId <= 0) {
    return res.status(401).json({ message: "Admin session missing" });
  }

  const parsed = composeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  const { recipients, subject, body, category = "SUPPORT", confirmLargeTarget = false } = parsed.data;

  try {
    if (parsed.data.e2eeEnvelope && !parsed.data.e2eeSenderKeyFingerprint) {
      return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_REQUIRED" });
    }
    const settings = await getCommunicationSettings();
    if (!settings.messagingEnabled) {
      return res.status(409).json({ message: "MESSAGING_DISABLED" });
    }
    const allowReply = parsed.data.allowReply ?? settings.messagingAllowReplyByDefault;

    const recipientUserIds = await resolveMailboxRecipientIds({
      ...recipients,
      includeAdmins: false,
    });

    if (!recipientUserIds.length) {
      return res.status(400).json({ message: "No matching recipients" });
    }

    if (recipientUserIds.length > settings.messagingMaxRecipientsPerSend) {
      return res.status(400).json({
        message: "RECIPIENTS_LIMIT_EXCEEDED",
        recipientCount: recipientUserIds.length,
        maxRecipients: settings.messagingMaxRecipientsPerSend,
      });
    }

    if (recipientUserIds.length > settings.messagingLargeTargetThreshold && !confirmLargeTarget) {
      return res.status(409).json({
        message: "LARGE_TARGET_CONFIRMATION_REQUIRED",
        recipientCount: recipientUserIds.length,
      });
    }

    if (allowReply && recipientUserIds.length > 1 && !settings.messagingAllowBroadcastReplies) {
      return res.status(400).json({
        message: "REPLY_ENABLED_BROADCAST_DISABLED",
        recipientCount: recipientUserIds.length,
      });
    }

    const senderFingerprint = normalizeSha256Fingerprint(parsed.data.e2eeSenderKeyFingerprint);
    if (parsed.data.e2eeSenderKeyFingerprint && !senderFingerprint) {
      return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_INVALID" });
    }
    if (senderFingerprint) {
      const senderKey = await getMailboxPublicKeyForUser(adminId);
      const currentFingerprint = normalizeSha256Fingerprint(senderKey?.mailboxPublicKeyFingerprint);
      if (!currentFingerprint) {
        return res.status(400).json({ message: "E2EE_SENDER_KEY_UNREGISTERED" });
      }
      if (currentFingerprint !== senderFingerprint) {
        return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_MISMATCH" });
      }
    }

    if (allowReply && recipientUserIds.length > 1) {
      const results: Array<{ threadId: number; messageId: number; queued: boolean }> = [];
      for (const recipientUserId of recipientUserIds) {
        const created = await createMailboxThreadWithMessage({
          createdByUserId: adminId,
          senderUserId: adminId,
          recipientUserIds: [recipientUserId],
          subject,
          body,
          contentFormat: parsed.data.contentFormat,
          allowReply: true,
          category,
          isBroadcast: false,
          messageType: "DIRECT",
          e2eeEnvelope: filterE2eeEnvelopeForRecipient(parsed.data.e2eeEnvelope, recipientUserId),
          e2eeSenderKeyFingerprint: parsed.data.e2eeSenderKeyFingerprint,
          bodyDigestSha256: parsed.data.bodyDigestSha256,
          audit: {
            actorUserId: adminId,
            actorRole: "ADMIN",
            ip: req.ip,
            userAgent: req.get("user-agent") ?? null,
          },
          allowAsyncFanout: false,
        });
        results.push({
          threadId: created.threadId,
          messageId: created.messageId,
          queued: created.queued,
        });
      }

      return res.status(201).json({
        ok: true,
        recipientCount: recipientUserIds.length,
        threadCount: results.length,
        rows: results,
        queued: false,
      });
    }

    const created = await createMailboxThreadWithMessage({
      createdByUserId: adminId,
      senderUserId: adminId,
      recipientUserIds,
      subject,
      body,
      contentFormat: parsed.data.contentFormat,
      allowReply,
      category,
      isBroadcast: recipientUserIds.length > 1,
      messageType: recipientUserIds.length > 1 ? "BROADCAST" : "DIRECT",
      e2eeEnvelope: parsed.data.e2eeEnvelope,
      e2eeSenderKeyFingerprint: parsed.data.e2eeSenderKeyFingerprint,
      bodyDigestSha256: parsed.data.bodyDigestSha256,
      audit: {
        actorUserId: adminId,
        actorRole: "ADMIN",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
      allowAsyncFanout: true,
    });

    return res.status(201).json({
      ok: true,
      recipientCount: recipientUserIds.length,
      ...created,
    });
  } catch (error) {
    console.error("[mailbox] compose failed", error);
    return errorResponse(res, error);
  }
});

mailboxRouter.get("/", async (req, res) => {
  const userId = Number(req.session.userId);
  const limit = parsePositiveInt(req.query.limit, 30, 100);
  const offset = parseOffset(req.query.offset);

  try {
    const payload = await listMailboxThreadsForUser({ userId, limit, offset });
    return res.json(payload);
  } catch (error) {
    console.error("[mailbox] list failed", error);
    return res.status(500).json({ message: "Failed to list mailbox threads" });
  }
});

mailboxRouter.get("/:threadId", async (req, res) => {
  const userId = Number(req.session.userId);
  const threadId = parseThreadId(req.params.threadId);
  if (!threadId) {
    return res.status(400).json({ message: "Invalid threadId" });
  }

  const limit = parsePositiveInt(req.query.limit, 80, 200);
  const beforeMessageId = parseThreadId(req.query.beforeMessageId);

  try {
    const payload = await getMailboxThreadMessages({
      userId,
      threadId,
      limit,
      beforeMessageId,
      audit: {
        actorUserId: userId,
        actorRole: req.session.isAdmin ? "ADMIN" : "USER",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
    });
    return res.json(payload);
  } catch (error) {
    console.error("[mailbox] thread fetch failed", error);
    return errorResponse(res, error);
  }
});

mailboxRouter.post("/:threadId/reply", async (req, res) => {
  const userId = Number(req.session.userId);
  const senderIsAdmin = Boolean(req.session.isAdmin);
  const actorType = senderIsAdmin ? "ADMIN" : "USER";
  const actorEmail = typeof req.session.email === "string" ? req.session.email : null;
  const actorUsername = typeof (req.session as any).username === "string" ? (req.session as any).username : null;
  const threadId = parseThreadId(req.params.threadId);
  if (!threadId) {
    return res.status(400).json({ message: "Invalid threadId" });
  }

  const rateLimit = consumeRateLimit(
    replyRateLimitByUser,
    userId,
    senderIsAdmin ? MAILBOX_REPLY_RATE_LIMIT_ADMIN : MAILBOX_REPLY_RATE_LIMIT_USER,
    MAILBOX_REPLY_RATE_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION_DENIED",
      title: "Mailbox reply blocked by rate limit",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_REPLY",
        threadId,
        deny: { code: "MAILBOX_REPLY_RATE_LIMIT" },
        retryAfterSec: rateLimit.retryAfterSec,
      },
    });
    res.setHeader("Retry-After", String(rateLimit.retryAfterSec));
    return res.status(429).json({
      message: "MAILBOX_REPLY_RATE_LIMIT",
      retryAfterSec: rateLimit.retryAfterSec,
    });
  }

  const parsed = replySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION_DENIED",
      title: "Mailbox reply denied due to invalid payload",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_REPLY",
        threadId,
        deny: { code: "INVALID_PAYLOAD" },
      },
    });
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    if (parsed.data.e2eeEnvelope && !parsed.data.e2eeSenderKeyFingerprint) {
      return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_REQUIRED" });
    }
    const senderFingerprint = normalizeSha256Fingerprint(parsed.data.e2eeSenderKeyFingerprint);
    if (parsed.data.e2eeSenderKeyFingerprint && !senderFingerprint) {
      return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_INVALID" });
    }
    if (senderFingerprint) {
      const senderKey = await getMailboxPublicKeyForUser(userId);
      const currentFingerprint = normalizeSha256Fingerprint(senderKey?.mailboxPublicKeyFingerprint);
      if (!currentFingerprint) {
        return res.status(400).json({ message: "E2EE_SENDER_KEY_UNREGISTERED" });
      }
      if (currentFingerprint !== senderFingerprint) {
        return res.status(400).json({ message: "E2EE_SENDER_KEY_FINGERPRINT_MISMATCH" });
      }
    }

    const payload = await replyToMailboxThread({
      threadId,
      senderUserId: userId,
      senderIsAdmin,
      body: parsed.data.body,
      contentFormat: parsed.data.contentFormat,
      e2eeEnvelope: parsed.data.e2eeEnvelope,
      e2eeSenderKeyFingerprint: parsed.data.e2eeSenderKeyFingerprint,
      bodyDigestSha256: parsed.data.bodyDigestSha256,
      audit: {
        actorUserId: userId,
        actorRole: senderIsAdmin ? "ADMIN" : "USER",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
      },
    });
    appendIdentityAudit({
      userId,
      email: actorEmail,
      username: actorUsername,
      category: "SECURITY",
      type: "ACCOUNT_ACTION",
      title: "Mailbox reply sent",
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
      actorType,
      actorUserId: userId,
      sessionId: req.sessionID ?? null,
      data: {
        action: "MAILBOX_REPLY",
        threadId,
        messageId: Number((payload as any)?.messageId ?? 0) || null,
        senderIsAdmin,
        hasE2eeEnvelope: Boolean(parsed.data.e2eeEnvelope),
        contentFormat: parsed.data.contentFormat ?? "PLAINTEXT",
      },
    });
    return res.status(201).json({ ok: true, ...payload });
  } catch (error) {
    console.error("[mailbox] reply failed", error);
    const code = String((error as any)?.message ?? "MAILBOX_REPLY_FAILED");
    if (
      code === "REPLY_DISABLED" ||
      code === "THREAD_ACCESS_DENIED" ||
      code === "THREAD_NOT_FOUND" ||
      code === "E2EE_DISABLED" ||
      code === "E2EE_REQUIRED" ||
      code.startsWith("E2EE_ENVELOPE_") ||
      code.startsWith("INVALID_")
    ) {
      appendIdentityAudit({
        userId,
        email: actorEmail,
        username: actorUsername,
        category: "SECURITY",
        type: "ACCOUNT_ACTION_DENIED",
        title: "Mailbox reply denied",
        ip: req.ip,
        userAgent: req.get("user-agent") ?? null,
        actorType,
        actorUserId: userId,
        sessionId: req.sessionID ?? null,
        data: {
          action: "MAILBOX_REPLY",
          threadId,
          deny: { code },
        },
      });
    }
    return errorResponse(res, error);
  }
});
