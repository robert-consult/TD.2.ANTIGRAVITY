import { db } from "@db";
import { normalizeChallengeMailboxCategory } from "@shared/challenges/mailbox";
export { normalizeChallengeMailboxCategory } from "@shared/challenges/mailbox";
import { clampIntOr, nowSec as sharedNowSec, toFiniteNumberOr } from "@shared/scalars";
import { eq } from "drizzle-orm";
import {
  challengeEnrollments,
  users,
} from "@shared/schema";
import { appendIdentityAudit } from "../../services/identityAudit";
import { buildAuditContext } from "../../lib/auditContext";
import { decryptString, encryptString, randomToken, sha256Hex } from "../../services/crypto";
import {
  PIPELINE_STAGES,
  parseOptionalPipelineStage,
} from "../../recruitment/pipelineService";
import { appendChallengeEvent } from "../../recruitment/challengesV4/challengeEvents";
import { getSystemChallengeConfig } from "../../recruitment/challengesV4/challengeConfig";
import { createMailboxThreadWithMessage, createNotification } from "../../services/messaging";
import { publishLiveEvent } from "../../services/liveBus";
import { PARTNER_INVITE_EMAIL_STATUSES } from "./validation";

export const nowSec = sharedNowSec;

function encryptChallengeAdminNote(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    return encryptString(text);
  } catch (error) {
    console.error("[admin-scout] failed to encrypt challenge admin note:", error);
    return text;
  }
}

export function decryptChallengeAdminNote(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  if (!text) return null;
  try {
    return decryptString(text);
  } catch {
    return text;
  }
}

export function parseBooleanQuery(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function driftAbs(a: unknown, b: unknown): number {
  return Math.abs(toFiniteNumberOr(a, 0) - toFiniteNumberOr(b, 0));
}

export function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  return clampIntOr(raw, fallback, 1, max);
}

const MAX_SCOUT_OFFSET = 10_000;

export function parseOffset(raw: unknown, max = MAX_SCOUT_OFFSET): number {
  return clampIntOr(raw, 0, 0, Math.max(0, Math.trunc(max) || MAX_SCOUT_OFFSET));
}

export function parseOptionalFloat(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseOptionalStage(raw: unknown): (typeof PIPELINE_STAGES)[number] | null {
  return parseOptionalPipelineStage(raw);
}

export function parseJsonObjectSafe(raw: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return fallback;
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return clampIntOr(value, fallback, min, max);
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  return toFiniteNumberOr(value, fallback);
}

export type AdminScopedResource = "challenge" | "prize" | "partner";

const ADMIN_RESOURCE_SCOPE_KEYS: Record<AdminScopedResource, string[]> = {
  challenge: ["challenges", "challengeIds", "managedChallengeIds"],
  prize: ["prizes", "prizeIds", "managedPrizeIds"],
  partner: ["partners", "partnerIds", "managedPartnerIds"],
};

function parseScopeSet(value: unknown): Set<number> | "ALL" | null {
  if (value == null) return null;
  if (value === "*" || value === "ALL") return "ALL";
  if (!Array.isArray(value)) return null;
  const out = new Set<number>();
  for (const raw of value) {
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0) out.add(id);
  }
  return out;
}

function resolveScopedIds(req: any, resource: AdminScopedResource): Set<number> | "ALL" | null {
  const session = (req as any)?.session ?? {};
  const scopes = session?.adminResourceScopes;
  const keys = ADMIN_RESOURCE_SCOPE_KEYS[resource];

  for (const key of keys) {
    const scoped = parseScopeSet(scopes?.[key]);
    if (scoped) return scoped;
    const sessionScoped = parseScopeSet(session?.[key]);
    if (sessionScoped) return sessionScoped;
  }
  return null;
}

function hasGlobalAdminScope(req: any): boolean {
  const session = (req as any)?.session ?? {};
  const scopes = session?.adminResourceScopes;
  return session?.isSuperAdmin === true || scopes?.all === true || scopes?.all === "*" || scopes?.all === "ALL";
}

export function enforceAdminResourceScope(
  req: any,
  res: any,
  resource: AdminScopedResource,
  resourceId: number,
): boolean {
  if (!Number.isInteger(resourceId) || resourceId <= 0) return false;
  if (hasGlobalAdminScope(req)) return true;

  const scopedIds = resolveScopedIds(req, resource);
  if (!scopedIds) return true;
  if (scopedIds === "ALL" || scopedIds.has(resourceId)) return true;

  res.status(403).json({
    message: "ADMIN_RESOURCE_SCOPE_FORBIDDEN",
    resource,
    resourceId,
  });
  return false;
}

export async function notifyChallengeTrader(input: {
  userId: number;
  challengeId: number;
  enrollmentId: number;
  title: string;
  message: string;
  sourceEvent: string;
  severity?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  mailboxRecommended?: boolean;
}) {
  try {
    const cfg = await getSystemChallengeConfig();
    if (!cfg.challengeNotifyOnAdminAction) return;

    await createNotification({
      userId: input.userId,
      type: "CHALLENGE",
      severity: input.severity ?? "INFO",
      title: input.title,
      message: input.message,
      sourceEvent: input.sourceEvent,
      link: `/compete/enrollment/${input.enrollmentId}`,
    });

    if (cfg.challengeNotifyViaMailbox && input.mailboxRecommended) {
      const category = normalizeChallengeMailboxCategory(cfg.challengeMailboxCategory);
      await createMailboxThreadWithMessage({
        createdByUserId: null,
        senderUserId: null,
        recipientUserIds: [input.userId],
        subject: input.title,
        body: input.message,
        category,
        allowReply: false,
        messageType: "CHALLENGE_ADMIN_ACTION",
        metadata: {
          sourceEvent: input.sourceEvent,
          challengeId: input.challengeId,
          enrollmentId: input.enrollmentId,
        },
      });
    }
  } catch (error) {
    console.error("[admin-scout] challenge trader notification failed:", error);
  }
}

async function getEnrollmentById(enrollmentId: number) {
  const [enrollment] = await db
    .select()
    .from(challengeEnrollments)
    .where(eq(challengeEnrollments.id, enrollmentId))
    .limit(1);
  return enrollment ?? null;
}

export async function applyChallengeEnrollmentAdminAction(input: {
  enrollmentId: number;
  action: "ADVANCE_PHASE" | "RESET_PHASE" | "DISQUALIFY" | "WITHDRAW" | "ADD_NOTE" | "OVERRIDE" | "EXTEND_PHASE";
  note?: string | null;
  actorUserId: number | null;
  overrideStatus?: "ACTIVE" | "PASSED" | "FAILED" | "WITHDRAWN" | "REVIEW_REQUIRED";
  overrideCompletedAt?: number | null;
  overrideCurrentPhase?: number;
  extendDays?: number;
}) {
  const enrollment = await getEnrollmentById(input.enrollmentId);
  if (!enrollment) throw new Error("ENROLLMENT_NOT_FOUND");

  const ts = nowSec();
  const next: Record<string, unknown> = {
    updatedAt: ts,
  };

  if (input.action === "WITHDRAW") {
    next.status = "WITHDRAWN";
    next.completedAt = ts;
  } else if (input.action === "DISQUALIFY") {
    next.status = "FAILED";
    next.completedAt = ts;
  } else if (input.action === "ADVANCE_PHASE") {
    next.currentPhase = Math.max(1, Number(enrollment.currentPhase ?? 1) + 1);
    next.phaseStartedAt = ts;
    next.status = "ACTIVE";
    next.completedAt = null;
    next.lastWarningEvent = null;
    next.lastWarningAt = null;
  } else if (input.action === "RESET_PHASE") {
    next.status = "ACTIVE";
    next.completedAt = null;
    next.currentPhase = 1;
    next.phaseStartedAt = ts;
    next.currentPnlPct = 0;
    next.maxDailyLossHit = null;
    next.maxTotalLossHit = null;
    next.tradingDays = 0;
    next.lastWarningEvent = null;
    next.lastWarningAt = null;
  } else if (input.action === "OVERRIDE") {
    next.status = input.overrideStatus;
    next.completedAt =
      input.overrideCompletedAt === undefined
        ? input.overrideStatus === "ACTIVE"
          ? null
          : ts
        : input.overrideCompletedAt;
    if (input.overrideCurrentPhase != null) {
      next.currentPhase = Math.max(1, Math.trunc(input.overrideCurrentPhase));
    }
  } else if (input.action === "EXTEND_PHASE") {
    const extendDays = Math.max(1, Math.trunc(Number(input.extendDays ?? 0)));
    const phaseStartedAt = Number(enrollment.phaseStartedAt ?? enrollment.enrolledAt ?? ts);
    next.phaseStartedAt = Math.max(0, phaseStartedAt - extendDays * 86400);
  }

  if (input.note !== undefined) {
    next.adminNotes = encryptChallengeAdminNote(input.note ?? null);
  }

  const [updated] = await db
    .update(challengeEnrollments)
    .set(next as any)
    .where(eq(challengeEnrollments.id, input.enrollmentId))
    .returning();

  const details: Record<string, unknown> = {
    note: input.note ?? null,
  };
  if (input.action === "OVERRIDE") {
    details.overrideStatus = input.overrideStatus ?? null;
    details.overrideCurrentPhase = input.overrideCurrentPhase ?? null;
    details.overrideCompletedAt = input.overrideCompletedAt ?? null;
  }
  if (input.action === "EXTEND_PHASE") {
    details.extendDays = input.extendDays ?? null;
  }

  await appendChallengeEvent({
    enrollmentId: input.enrollmentId,
    eventType: `ADMIN_${input.action}`,
    eventAt: ts,
    actorType: "ADMIN",
    actorUserId: input.actorUserId,
    phaseNumber: Number((updated as any)?.currentPhase ?? enrollment.currentPhase ?? 1),
    details,
    note: input.note ?? null,
  });

  return { enrollment, updated };
}

export function netProfitSqlAlias(alias: string): string {
  return `COALESCE(
    ${alias}.net_profit_usd::numeric,
    CASE
      WHEN ${alias}.profit IS NULL OR btrim(${alias}.profit) = '' THEN 0::numeric
      WHEN ${alias}.profit ~ '^-?\\d+(\\.\\d+)?$' THEN ${alias}.profit::numeric
      ELSE 0::numeric
    END
  )`;
}

export async function appendRecruitmentAudit(req: any, type: string, data: Record<string, unknown>) {
  try {
    const auditCtx = buildAuditContext(req);
    appendIdentityAudit({
      userId: auditCtx.actorUserId,
      category: "RECRUITMENT",
      type,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      correlationId: auditCtx.correlationId,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent,
      data,
    });
  } catch (error) {
    console.error("[admin-scout] audit append failed:", error);
  }
}

export function publishChallengesUpdated(payload: Record<string, unknown>) {
  publishLiveEvent({
    type: "challenges:updated",
    payload: {
      ...payload,
      at: Date.now(),
    },
  });
}

export function computeMaxDrawdownFromEquitySeries(equitySeries: number[]): number {
  if (!equitySeries.length) return 0;
  let peak = equitySeries[0];
  let maxDd = 0;
  for (const value of equitySeries) {
    if (!Number.isFinite(value)) continue;
    if (value > peak) peak = value;
    if (peak <= 0) continue;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return Number(maxDd.toFixed(6));
}

export async function getTraderUser(userId: number): Promise<{ id: number; isAdmin: boolean; isDeleted: boolean } | null> {
  const [row] = await db
    .select({ id: users.id, isAdmin: users.isAdmin, isDeleted: users.isDeleted })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

export function sanitizePartnerIpWhitelist(raw: string | undefined): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  return input
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 50)
    .join(",");
}

export function normalizeEmailArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const email = String(value || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= 200) break;
  }
  return out;
}

export function buildPartnerApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `tp_${randomToken(24)}`;
  const hash = sha256Hex(raw);
  const prefix = raw.slice(0, 10);
  return { raw, hash, prefix };
}

export function normalizePartnerEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function buildPartnerUsername(email: string): string {
  const local = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);
  const suffix = randomToken(4).slice(0, 6).toLowerCase();
  const prefix = local || "partner";
  return `${prefix}_${suffix}`;
}

export function buildPartnerTempPassword(): string {
  return `TQ!${randomToken(8)}aA1`;
}

export function buildPartnerInviteDeepLink(opts: { username: string; token: string }): string {
  const portalBase =
    String(process.env.PARTNER_PORTAL_BASE_URL || process.env.APP_BASE_URL || "http://localhost:5000").trim() ||
    "http://localhost:5000";
  const safeBase = portalBase.replace(/\/+$/, "");
  const u = encodeURIComponent(opts.username);
  const t = encodeURIComponent(opts.token);
  return `${safeBase}/partner?u=${u}&t=${t}`;
}

export async function sendPartnerInviteEmail(input: {
  to: string;
  username: string;
  tempPassword: string;
  apiKey: string;
  deepLink: string;
  expiresInDays: number;
}): Promise<{ status: (typeof PARTNER_INVITE_EMAIL_STATUSES)[number]; messageId?: string; detail?: string }> {
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!resendApiKey) {
    return {
      status: "SKIPPED",
      detail: "RESEND_API_KEY_NOT_CONFIGURED",
    };
  }

  const from = String(process.env.RESEND_FROM || "TradeQuip <noreply@tradequip.com>").trim();
  const subject = "Access Granted: TradeQuip Institutional Portal";
  const textBody = [
    "Hello,",
    "",
    "You have been invited to view our curated pool of top-performing traders.",
    "",
    "YOUR CREDENTIALS:",
    `  Username: ${input.username}`,
    `  Password: ${input.tempPassword}`,
    `  API Key:  ${input.apiKey}`,
    "",
    `Access Portal: ${input.deepLink}`,
    "",
    `This link expires in ${input.expiresInDays} day(s).`,
    "",
    "Best regards,",
    "The TradeQuip Team",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.4;color:#111">
      <p>Hello,</p>
      <p>You have been invited to view our curated pool of top-performing traders.</p>
      <p><strong>YOUR CREDENTIALS</strong><br/>
      Username: <code>${input.username}</code><br/>
      Password: <code>${input.tempPassword}</code><br/>
      API Key: <code>${input.apiKey}</code></p>
      <p><a href="${input.deepLink}">Access Portal Now</a></p>
      <p>This link expires in ${input.expiresInDays} day(s).</p>
      <p>Best regards,<br/>The TradeQuip Team</p>
    </div>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "FAILED",
        detail: String((payload as any)?.message || (payload as any)?.error || `RESEND_HTTP_${response.status}`),
      };
    }

    return {
      status: "SENT",
      messageId: String((payload as any)?.id || ""),
      detail: String((payload as any)?.id ? "RESEND_ACCEPTED" : "RESEND_ACCEPTED_NO_ID"),
    };
  } catch (error: any) {
    return {
      status: "FAILED",
      detail: String(error?.message || "RESEND_REQUEST_FAILED"),
    };
  }
}

type RateLimitEntry = { count: number; resetAtMs: number };
export const partnerInviteRateByAdmin = new Map<number, RateLimitEntry>();
export const partnerInviteRateByIp = new Map<string, RateLimitEntry>();
export const PARTNER_INVITE_ADMIN_LIMIT = 5;
export const PARTNER_INVITE_IP_LIMIT = 20;
const PARTNER_INVITE_WINDOW_MS = 60 * 60 * 1000;
const challengeActionRateByAdmin = new Map<string, RateLimitEntry>();
const CHALLENGE_ACTION_WINDOW_MS = 60 * 1000;
const CHALLENGE_ACTION_LIMIT = 60;
const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 5_000;
const IDEMPOTENCY_IN_FLIGHT_GRACE_MS = 30 * 1000;
const adminMutationIdempotencyStore = new Map<
  string,
  { fingerprint: string; status: number; payload: unknown; expiresAtMs: number; inFlight: boolean }
>();

function cleanupRateLimitMap<K>(store: Map<K, RateLimitEntry>) {
  const now = Date.now();
  for (const [key, value] of Array.from(store.entries())) {
    if (value.resetAtMs <= now) store.delete(key);
  }
}

export function consumeRateLimit<K>(
  store: Map<K, RateLimitEntry>,
  key: K,
  limit: number,
  windowMs = PARTNER_INVITE_WINDOW_MS,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (current.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function cleanupIdempotencyStore() {
  const now = Date.now();
  for (const [key, value] of Array.from(adminMutationIdempotencyStore.entries())) {
    if (value.expiresAtMs <= now) adminMutationIdempotencyStore.delete(key);
  }
}

function trimIdempotencyStore() {
  while (adminMutationIdempotencyStore.size > IDEMPOTENCY_MAX_ENTRIES) {
    const oldestKey = adminMutationIdempotencyStore.keys().next().value;
    if (!oldestKey) return;
    adminMutationIdempotencyStore.delete(oldestKey);
  }
}

function buildIdempotencyFingerprint(req: any): string {
  const method = String(req.method || "").toUpperCase();
  const routePath = String(req.path || req.originalUrl || "");
  const bodyRaw = (() => {
    try {
      return JSON.stringify(req.body ?? null);
    } catch {
      return "UNSERIALIZABLE_BODY";
    }
  })();
  return sha256Hex(`${method}:${routePath}:${bodyRaw}`);
}

export function beginIdempotentMutation(
  req: any,
  res: any,
  scope: string,
): { storeKey: string; fingerprint: string } | null {
  cleanupIdempotencyStore();

  const key = String(req.header(IDEMPOTENCY_KEY_HEADER) || "").trim();
  if (!key) {
    res.status(400).json({ message: "IDEMPOTENCY_KEY_REQUIRED" });
    return null;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    res.status(400).json({ message: "INVALID_IDEMPOTENCY_KEY" });
    return null;
  }

  const actorId = Number(req.session?.userId || 0);
  const storeKey = `${scope}:${actorId}:${key}`;
  const fingerprint = buildIdempotencyFingerprint(req);

  const existing = adminMutationIdempotencyStore.get(storeKey);
  if (existing && existing.expiresAtMs > Date.now()) {
    if (existing.fingerprint !== fingerprint) {
      res.status(409).json({ message: "IDEMPOTENCY_KEY_CONFLICT" });
      return null;
    }
    if (existing.inFlight) {
      res.status(409).json({ message: "IDEMPOTENCY_KEY_IN_PROGRESS" });
      return null;
    }
    res.setHeader("X-Idempotent-Replay", "1");
    res.status(existing.status).json(existing.payload);
    return null;
  }

  adminMutationIdempotencyStore.delete(storeKey);
  adminMutationIdempotencyStore.set(storeKey, {
    fingerprint,
    status: 0,
    payload: null,
    expiresAtMs: Date.now() + IDEMPOTENCY_IN_FLIGHT_GRACE_MS,
    inFlight: true,
  });
  trimIdempotencyStore();
  return { storeKey, fingerprint };
}

export function commitIdempotentMutation(
  context: { storeKey: string; fingerprint: string } | null,
  status: number,
  payload: unknown,
) {
  if (!context) return;
  adminMutationIdempotencyStore.set(context.storeKey, {
    fingerprint: context.fingerprint,
    status,
    payload,
    expiresAtMs: Date.now() + IDEMPOTENCY_TTL_MS,
    inFlight: false,
  });
  trimIdempotencyStore();
}

export function releaseIdempotentMutation(context: { storeKey: string; fingerprint: string } | null): void {
  if (!context) return;
  const existing = adminMutationIdempotencyStore.get(context.storeKey);
  if (!existing) return;
  if (existing.fingerprint !== context.fingerprint) return;
  if (!existing.inFlight) return;
  adminMutationIdempotencyStore.delete(context.storeKey);
}

export function enforceChallengeAdminActionRateLimit(
  req: any,
  res: any,
  actionKey: string,
  limit = CHALLENGE_ACTION_LIMIT,
): boolean {
  const adminId = Number(req.session?.userId || 0);
  const rate = consumeRateLimit(
    challengeActionRateByAdmin,
    `challenge-action:${adminId}:${actionKey}`,
    limit,
    CHALLENGE_ACTION_WINDOW_MS,
  );
  if (rate.allowed) return true;
  res.setHeader("Retry-After", String(rate.retryAfterSec));
  res.status(429).json({
    message: "RATE_LIMITED",
    code: "CHALLENGE_ADMIN_ACTION_RATE_LIMIT",
    retryAfterSec: rate.retryAfterSec,
  });
  return false;
}

const partnerInviteLimiterCleanupHandle = setInterval(() => {
  cleanupRateLimitMap(partnerInviteRateByAdmin);
  cleanupRateLimitMap(partnerInviteRateByIp);
  cleanupRateLimitMap(challengeActionRateByAdmin);
  cleanupIdempotencyStore();
}, 5 * 60 * 1000);

(partnerInviteLimiterCleanupHandle as any)?.unref?.();
