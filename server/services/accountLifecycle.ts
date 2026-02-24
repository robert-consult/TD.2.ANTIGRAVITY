import bcrypt from "bcryptjs";
import { db, dbClient } from "@db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  adminActions,
  botRiskAssessments,
  emailVerificationTokens,
  rememberMeTokens,
  signupFingerprints,
  smsOtpTokens,
  systemConfig,
  traderJournal,
  userAccountEvents,
  userAdminNotes,
  userDeletionQueue,
  userLoginHistory,
  userMfa,
  userSessions,
  userSettings,
  users,
  userVerification,
} from "@shared/schema";
import { randomToken } from "./crypto";
import { revokeAllSessionsForUser } from "../security/sessionTrail";

export type ActivityConfig = {
  inactivityThresholdDays: number;
  deletionGraceDays: number;
  botScoreThreshold: number;
  autoQueueInactive: boolean;
  autoSoftDelete: boolean;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null) return fallback;
  return Boolean(v);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

const MAX_ACTIVITY_MUTATION_USER_IDS = 500;
const DEFAULT_ACTIVITY_LIST_LIMIT = 200;
const MAX_ACTIVITY_LIST_LIMIT = 500;
const DEFAULT_ACTIVITY_LIST_BATCH_SIZE = 250;
const DEFAULT_ACTIVITY_LIST_SCAN_LIMIT = 5000;
const DEFAULT_SWEEP_BATCH_SIZE = 500;
const DEFAULT_SWEEP_SCAN_LIMIT = 5000;
const MAX_ACTIVITY_SCAN_LIMIT = 50000;

type LockedUserState = {
  userId: number;
  email: string;
  isAdmin: boolean;
  isDeleted: boolean;
  deletionExempt: boolean;
  createdAt: number;
};

function clampEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

function normalizeMutationUserIds(userIds: number[]): number[] {
  const ids = Array.from(new Set(userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  if (ids.length > MAX_ACTIVITY_MUTATION_USER_IDS) {
    throw new Error(`MAX_USER_IDS_EXCEEDED:${MAX_ACTIVITY_MUTATION_USER_IDS}`);
  }
  return ids;
}

function chunkNumbers(values: number[], size: number): number[][] {
  if (!Array.isArray(values) || values.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

async function loadLastActiveByUserIds(userIds: number[]): Promise<Map<number, number>> {
  const ids = Array.from(new Set(userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  if (ids.length === 0) return new Map();

  const { rows } = await dbClient.query(
    `
      WITH
      sess AS (
        SELECT user_id, MAX(last_active_at) AS last_seen_at
        FROM user_sessions
        WHERE user_id = ANY($1::int[])
        GROUP BY user_id
      ),
      logins AS (
        SELECT user_id, MAX(created_at) AS last_login_at
        FROM user_login_history
        WHERE user_id = ANY($1::int[]) AND success = TRUE
        GROUP BY user_id
      ),
      trades_last AS (
        SELECT user_id, MAX(COALESCE(closed_at, opened_at)) AS last_trade_at
        FROM trades
        WHERE user_id = ANY($1::int[])
        GROUP BY user_id
      )
      SELECT
        u.id AS "userId",
        u.created_at AS "createdAt",
        GREATEST(
          COALESCE(sess.last_seen_at, 0),
          COALESCE(logins.last_login_at, 0),
          COALESCE(trades_last.last_trade_at, 0),
          u.created_at
        ) AS "lastActiveAt"
      FROM users u
      LEFT JOIN sess ON sess.user_id = u.id
      LEFT JOIN logins ON logins.user_id = u.id
      LEFT JOIN trades_last ON trades_last.user_id = u.id
      WHERE u.id = ANY($1::int[]);
    `,
    [ids],
  );

  const out = new Map<number, number>();
  for (const row of rows as any[]) {
    const userId = num(row.userId);
    if (userId <= 0) continue;
    const createdAt = num(row.createdAt, 0);
    const lastActiveAt = Math.max(0, Math.trunc(num(row.lastActiveAt, createdAt)));
    out.set(userId, lastActiveAt);
  }
  return out;
}

async function lockUserForUpdate(tx: any, userId: number): Promise<LockedUserState | null> {
  const result = await tx.execute(sql`
    SELECT
      id AS "userId",
      email,
      is_admin AS "isAdmin",
      is_deleted AS "isDeleted",
      deletion_exempt AS "deletionExempt",
      created_at AS "createdAt"
    FROM users
    WHERE id = ${userId}
    FOR UPDATE
  `);
  const row = (result.rows?.[0] ?? null) as any;
  if (!row) return null;

  return {
    userId: num(row.userId),
    email: String(row.email ?? ""),
    isAdmin: Boolean(row.isAdmin),
    isDeleted: Boolean(row.isDeleted),
    deletionExempt: Boolean(row.deletionExempt),
    createdAt: num(row.createdAt, 0),
  };
}

async function computeLastActiveAtSecTx(tx: any, userId: number, fallbackCreatedAt = 0): Promise<number> {
  const result = await tx.execute(sql`
    WITH
    sess AS (
      SELECT MAX(last_active_at) AS last_seen_at
      FROM user_sessions
      WHERE user_id = ${userId}
    ),
    logins AS (
      SELECT MAX(created_at) AS last_login_at
      FROM user_login_history
      WHERE user_id = ${userId} AND success = TRUE
    ),
    trades_last AS (
      SELECT MAX(COALESCE(closed_at, opened_at)) AS last_trade_at
      FROM trades
      WHERE user_id = ${userId}
    )
    SELECT
      u.created_at AS "createdAt",
      GREATEST(
        COALESCE(sess.last_seen_at, 0),
        COALESCE(logins.last_login_at, 0),
        COALESCE(trades_last.last_trade_at, 0),
        u.created_at
      ) AS "lastActiveAt"
    FROM users u
    LEFT JOIN sess ON TRUE
    LEFT JOIN logins ON TRUE
    LEFT JOIN trades_last ON TRUE
    WHERE u.id = ${userId}
    LIMIT 1
  `);
  const row = (result.rows?.[0] ?? null) as any;
  const createdAt = num(row?.createdAt, fallbackCreatedAt);
  const last = num(row?.lastActiveAt, createdAt);
  return Math.max(0, Math.trunc(last));
}

export async function getActivityConfig(): Promise<ActivityConfig> {
  const row = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
  if (!row) {
    return {
      inactivityThresholdDays: 90,
      deletionGraceDays: 30,
      botScoreThreshold: 40,
      autoQueueInactive: true,
      autoSoftDelete: false,
    };
  }

  return {
    inactivityThresholdDays: toInt((row as any).inactivityThresholdDays, 90),
    deletionGraceDays: toInt((row as any).deletionGraceDays, 30),
    botScoreThreshold: toInt((row as any).botScoreThreshold, 40),
    autoQueueInactive: toBool((row as any).activityAutoQueueInactive, true),
    autoSoftDelete: toBool((row as any).activityAutoSoftDelete, false),
  };
}

export type AdminActivityRow = {
  userId: number;
  email: string;
  username: string;
  isDisabled: boolean;
  isDeleted: boolean;
  deletionExempt: boolean;
  createdAt: number;
  lastActiveAt: number;
  inactiveDays: number;
  botScore: number;
  botLabel: string;
  queueStatus?: string;
  queueReason?: string;
  graceExpiresAt?: number;
  queuedAt?: number;
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export async function listAdminActivity(opts: {
  minInactiveDays: number;
  includeDeleted?: boolean;
  inactiveOnly?: boolean;
  botsOnly?: boolean;
  limit?: number;
}): Promise<{ cfg: ActivityConfig; rows: AdminActivityRow[] }> {
  const cfg = await getActivityConfig();
  const now = nowSec();
  const includeDeleted = Boolean(opts.includeDeleted);
  const inactiveOnly = Boolean(opts.inactiveOnly);
  const botsOnly = Boolean(opts.botsOnly);
  const limit = Math.max(1, Math.min(MAX_ACTIVITY_LIST_LIMIT, toInt(opts.limit, DEFAULT_ACTIVITY_LIST_LIMIT)));
  const minInactiveDays = Math.max(0, toInt(opts.minInactiveDays, 0));
  const batchSize = clampEnvInt("ACTIVITY_LIST_BATCH_SIZE", DEFAULT_ACTIVITY_LIST_BATCH_SIZE, 25, 1000);
  const scanLimit = clampEnvInt(
    "ACTIVITY_LIST_SCAN_LIMIT",
    Math.max(DEFAULT_ACTIVITY_LIST_SCAN_LIMIT, limit * 10),
    limit,
    MAX_ACTIVITY_SCAN_LIMIT,
  );

  let scanned = 0;
  let cursorCreatedAt = -1;
  let cursorUserId = 0;
  const rows: AdminActivityRow[] = [];

  while (scanned < scanLimit && rows.length < limit) {
    const take = Math.min(batchSize, scanLimit - scanned);
    const { rows: baseRows } = await dbClient.query(
      `
        SELECT
          u.id AS "userId",
          u.email AS email,
          u.username AS username,
          u.is_disabled AS "isDisabled",
          u.is_deleted AS "isDeleted",
          u.deletion_exempt AS "deletionExempt",
          u.created_at AS "createdAt",
          COALESCE(b.score, 0) AS "botScore",
          COALESCE(b.label, 'OK') AS "botLabel",
          dq.status AS "queueStatus",
          dq.reason AS "queueReason",
          dq.marked_at AS "queuedAt",
          dq.grace_expires_at AS "graceExpiresAt"
        FROM users u
        LEFT JOIN bot_risk_assessments b ON b.user_id = u.id
        LEFT JOIN user_deletion_queue dq ON dq.user_id = u.id
        WHERE
          u.is_admin = FALSE
          AND ($1::int = 1 OR u.is_deleted = FALSE)
          AND (u.created_at > $2 OR (u.created_at = $2 AND u.id > $3))
        ORDER BY u.created_at ASC, u.id ASC
        LIMIT $4
      `,
      [includeDeleted ? 1 : 0, cursorCreatedAt, cursorUserId, take],
    );

    const batch = baseRows as any[];
    if (batch.length === 0) break;

    scanned += batch.length;
    const tail = batch[batch.length - 1] as any;
    cursorCreatedAt = num(tail.createdAt, cursorCreatedAt);
    cursorUserId = num(tail.userId, cursorUserId);

    const userIds = batch.map((r) => num(r.userId)).filter((x) => x > 0);
    const lastActiveByUserId = await loadLastActiveByUserIds(userIds);

    for (const r of batch) {
      const userId = num(r.userId);
      if (userId <= 0) continue;
      const createdAt = num(r.createdAt);
      const lastActiveAt = lastActiveByUserId.get(userId) ?? createdAt;
      const inactiveDays = Math.floor((now - lastActiveAt) / 86400);
      const row: AdminActivityRow = {
        userId,
        email: String(r.email ?? ""),
        username: String(r.username ?? ""),
        isDisabled: Boolean(r.isDisabled),
        isDeleted: Boolean(r.isDeleted),
        deletionExempt: Boolean(r.deletionExempt),
        createdAt,
        lastActiveAt,
        inactiveDays,
        botScore: num(r.botScore),
        botLabel: String(r.botLabel ?? "OK"),
        queueStatus: r.queueStatus ? String(r.queueStatus) : undefined,
        queueReason: r.queueReason ? String(r.queueReason) : undefined,
        queuedAt: r.queuedAt ? num(r.queuedAt) : undefined,
        graceExpiresAt: r.graceExpiresAt ? num(r.graceExpiresAt) : undefined,
      };

      if (row.inactiveDays < minInactiveDays) continue;
      if (inactiveOnly && row.inactiveDays < cfg.inactivityThresholdDays) continue;
      if (botsOnly && row.botScore < cfg.botScoreThreshold) continue;

      rows.push(row);
      if (rows.length >= limit) break;
    }
  }

  rows.sort((a, b) => a.lastActiveAt - b.lastActiveAt || a.userId - b.userId);
  return { cfg, rows: rows.slice(0, limit) };
}

function anonymizeEmail(userId: number) {
  return `deleted+${userId}@deleted.local`;
}

function anonymizeUsername(userId: number) {
  return `deleted_user_${userId}`;
}

export async function enqueueForDeletion(args: {
  userIds: number[];
  reason: "INACTIVE" | "BOT" | "ADMIN";
  note?: string;
  actorAdminId?: number | null;
}): Promise<{ queued: number }> {
  const cfg = await getActivityConfig();
  const now = nowSec();
  const graceExpiresAt = now + cfg.deletionGraceDays * 86400;
  const actor = typeof args.actorAdminId === "number" && Number.isFinite(args.actorAdminId) ? args.actorAdminId : 0;

  const ids = normalizeMutationUserIds(args.userIds);
  if (ids.length === 0) return { queued: 0 };

  let queued = 0;
  for (const userId of ids) {
    let queuedThisUser = false;
    let lastActiveAt = 0;

    await db.transaction(async (tx) => {
      const user = await lockUserForUpdate(tx, userId);
      if (!user || user.isAdmin || user.isDeleted || user.deletionExempt) return;

      lastActiveAt = await computeLastActiveAtSecTx(tx, userId, user.createdAt);

      await tx
        .insert(userDeletionQueue)
        .values({
          userId,
          status: "GRACE",
          reason: args.reason,
          markedAt: now,
          graceExpiresAt,
          lastActiveAt,
          note: args.note || null,
        } as any)
        .onConflictDoUpdate({
          target: userDeletionQueue.userId,
          set: {
            status: "GRACE",
            reason: args.reason,
            markedAt: now,
            graceExpiresAt,
            lastActiveAt,
            executedAt: null,
            executedByAdminId: null,
            note: args.note || null,
          } as any,
        });

      await tx
        .update(users)
        .set({
          isDisabled: true,
          inactivatedAt: now,
        } as any)
        .where(eq(users.id, userId));

      await tx.insert(userAccountEvents).values({
        userId,
        adminId: actor || null,
        eventType: "DELETION_QUEUED",
        title: "Account queued for deletion",
        description: `Reason: ${args.reason}; grace expires at ${new Date(graceExpiresAt * 1000).toISOString()}`,
        reasonCode: args.reason,
        reasonText: args.note || null,
        metadata: JSON.stringify({ graceExpiresAt, lastActiveAt }),
        createdAt: now,
      } as any);

      queuedThisUser = true;
    });

    if (!queuedThisUser) continue;

    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `queued_for_deletion:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for queued user:", userId, e);
    }

    queued += 1;
  }

  return { queued };
}

export async function softDeleteUsers(args: {
  userIds: number[];
  actorAdminId?: number | null;
  reason: string;
}): Promise<{ deleted: number }> {
  const now = nowSec();
  const actor = typeof args.actorAdminId === "number" && Number.isFinite(args.actorAdminId) ? args.actorAdminId : 0;
  const ids = normalizeMutationUserIds(args.userIds);
  if (ids.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (const userId of ids) {
    const newPwHash = await bcrypt.hash(randomToken(32), 10);
    const email = anonymizeEmail(userId);
    const username = anonymizeUsername(userId);

    let deletedThisUser = false;
    await db.transaction(async (tx) => {
      const user = await lockUserForUpdate(tx, userId);
      if (!user || user.isAdmin || user.isDeleted) return;

      await tx
        .update(users)
        .set({
          isDisabled: true,
          isDeleted: true,
          inactivatedAt: now,
          deletedAt: now,
          deletedMode: "SOFT",
          deletedReason: args.reason,
          deletedByAdminId: actor || null,
          email,
          username,
          passwordHash: newPwHash,
          name: null,
          firstName: null,
          lastName: null,
          displayName: null,
          phone: null,
        } as any)
        .where(eq(users.id, userId));

      await tx
        .update(userDeletionQueue)
        .set({
          status: "EXECUTED_SOFT",
          executedAt: now,
          executedByAdminId: actor || null,
        } as any)
        .where(eq(userDeletionQueue.userId, userId));

      await tx.insert(userAccountEvents).values({
        userId,
        adminId: actor || null,
        eventType: "ACCOUNT_SOFT_DELETED",
        title: "Account soft-deleted",
        description: `Reason: ${args.reason}`,
        reasonCode: "SOFT_DELETE",
        reasonText: args.reason,
        metadata: JSON.stringify({ deletedAt: now }),
        createdAt: now,
      } as any);

      deletedThisUser = true;
    });

    if (!deletedThisUser) continue;

    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `soft_delete:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for soft-deleted user:", userId, e);
    }

    deleted += 1;
  }

  return { deleted };
}

export async function hardDeleteUsers(args: {
  userIds: number[];
  actorAdminId?: number | null;
  reason: string;
}): Promise<{ deleted: number }> {
  const now = nowSec();
  const actor = typeof args.actorAdminId === "number" && Number.isFinite(args.actorAdminId) ? args.actorAdminId : 0;
  const ids = normalizeMutationUserIds(args.userIds);
  if (ids.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (const userId of ids) {
    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `hard_delete:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for hard-deleted user:", userId, e);
    }

    const newPwHash = await bcrypt.hash(randomToken(32), 10);
    const email = anonymizeEmail(userId);
    const username = anonymizeUsername(userId);
    let deletedThisUser = false;

    try {
      await db.transaction(async (tx) => {
        const user = await lockUserForUpdate(tx, userId);
        if (!user || user.isAdmin) return;
        const priorEmail = user.email;
        const lastActiveAt = await computeLastActiveAtSecTx(tx, userId, user.createdAt);

        // Purge non-ledger / non-essential tables first
        await tx.delete(botRiskAssessments).where(eq(botRiskAssessments.userId, userId));
        await tx.delete(userSessions).where(eq(userSessions.userId, userId));
        await tx.execute(sql`
          DELETE FROM "session"
          WHERE (sess::jsonb ? 'userId')
            AND (sess->>'userId') ~ '^[0-9]+$'
            AND (sess->>'userId')::int = ${userId}
        `);
        await tx.delete(rememberMeTokens).where(eq(rememberMeTokens.userId, userId));
        await tx.delete(userLoginHistory).where(eq(userLoginHistory.userId, userId));
        if (priorEmail) {
          await tx.delete(userLoginHistory).where(eq(userLoginHistory.email, priorEmail));
        }
        await tx.delete(userAdminNotes).where(eq(userAdminNotes.userId, userId));
        await tx.delete(traderJournal).where(eq(traderJournal.userId, userId));
        await tx.delete(userSettings).where(eq(userSettings.userId, userId));
        await tx.delete(userVerification).where(eq(userVerification.userId, userId));
        await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));
        await tx.delete(smsOtpTokens).where(eq(smsOtpTokens.userId, userId));
        await tx.delete(userMfa).where(eq(userMfa.userId, userId));
        await tx.delete(signupFingerprints).where(eq(signupFingerprints.userId, userId));

        // Account events and notes are PII-heavy; remove them in hard delete.
        await tx.delete(userAccountEvents).where(eq(userAccountEvents.userId, userId));

        // Update/insert queue record to reflect execution.
        await tx
          .insert(userDeletionQueue)
          .values({
            userId,
            status: "EXECUTED_HARD",
            reason: "ADMIN",
            markedAt: now,
            graceExpiresAt: now,
            lastActiveAt,
            executedAt: now,
            executedByAdminId: actor || null,
            note: args.reason,
          } as any)
          .onConflictDoUpdate({
            target: userDeletionQueue.userId,
            set: {
              status: "EXECUTED_HARD",
              executedAt: now,
              executedByAdminId: actor || null,
              note: args.reason,
            } as any,
          });

        // Keep the user row (tombstone) to preserve immutable ledgers (trades/legal acceptances).
        await tx
          .update(users)
          .set({
            isDisabled: true,
            isDeleted: true,
            isFrozen: false,
            freezeReasonCode: null,
            freezeReasonText: null,
            frozenAt: null,
            frozenBy: null,
            inactivatedAt: now,
            deletedAt: now,
            deletedMode: "HARD",
            deletedReason: args.reason,
            deletedByAdminId: actor || null,
            email,
            username,
            passwordHash: newPwHash,
            name: null,
            firstName: null,
            lastName: null,
            displayName: null,
            phone: null,
            timezone: null,
            language: null,
            country: null,
            countryIso2: null,
            regionKey: null,
            kycStatus: "none",
            kycVerifiedAt: null,
            kycExpiresAt: null,
            signupIp: null,
            signupIpHash: null,
            signupUserAgent: null,
            signupCountryCode: null,
            signupRegion: null,
            signupCity: null,
            signupLatitude: null,
            signupLongitude: null,
            signupDeviceType: null,
            signupBrowser: null,
            signupOs: null,
            signupClientTz: null,
            signupInferredTz: null,
            signupDeviceFp: null,
            signupDeviceInstallId: null,
            signupClientLang: null,
          } as any)
          .where(eq(users.id, userId));

        // Minimal admin audit trail (does not depend on user row being active).
        await tx.insert(adminActions).values({
          adminId: actor || 0,
          userId,
          actionType: "ACCOUNT_HARD_DELETED",
          metadata: JSON.stringify({ reason: args.reason }),
          ip: null,
          userAgent: null,
          createdAt: now,
        } as any);

        deletedThisUser = true;
      });
    } catch (e) {
      console.error("Hard delete transaction failed:", userId, e);
      continue;
    }

    if (!deletedThisUser) continue;
    deleted += 1;
  }

  return { deleted };
}

export async function cancelDeletionQueue(args: {
  userIds: number[];
  actorAdminId?: number | null;
  note?: string;
}): Promise<{ cancelled: number }> {
  const now = nowSec();
  const actor = typeof args.actorAdminId === "number" && Number.isFinite(args.actorAdminId) ? args.actorAdminId : 0;
  const ids = normalizeMutationUserIds(args.userIds);
  if (ids.length === 0) return { cancelled: 0 };

  await db
    .update(userDeletionQueue)
    .set({
      status: "CANCELLED",
      note: args.note || null,
    } as any)
    .where(inArray(userDeletionQueue.userId, ids));

  for (const userId of ids) {
    await db.insert(userAccountEvents).values({
      userId,
      adminId: actor || null,
      eventType: "DELETION_CANCELLED",
      title: "Deletion cancelled",
      description: args.note || "Deletion queue cancelled",
      reasonCode: "CANCELLED",
      reasonText: args.note || null,
      metadata: JSON.stringify({ cancelledAt: now }),
      createdAt: now,
    } as any);
  }

  return { cancelled: ids.length };
}

export async function setDeletionExempt(args: {
  userIds: number[];
  exempt: boolean;
  actorAdminId?: number | null;
  note?: string;
}): Promise<{ updated: number }> {
  const ids = normalizeMutationUserIds(args.userIds);
  if (ids.length === 0) return { updated: 0 };

  await db
    .update(users)
    .set({ deletionExempt: args.exempt } as any)
    .where(and(inArray(users.id, ids), eq(users.isAdmin, false)));

  if (args.exempt) {
    await cancelDeletionQueue({ userIds: ids, actorAdminId: args.actorAdminId, note: args.note || "Marked deletion-exempt" });
  }

  return { updated: ids.length };
}

export async function runInactivitySweep(args: {
  dryRun: boolean;
  actorAdminId?: number | null;
}): Promise<{
  inactivityThresholdDays: number;
  deletionGraceDays: number;
  foundInactive: number;
  foundDue: number;
  applied: boolean;
  autoQueueInactive: boolean;
  autoSoftDelete: boolean;
}> {
  const cfg = await getActivityConfig();
  const now = nowSec();
  const thresholdSec = cfg.inactivityThresholdDays * 86400;
  const sweepBatchSize = clampEnvInt("ACTIVITY_SWEEP_BATCH_SIZE", DEFAULT_SWEEP_BATCH_SIZE, 25, 1000);
  const sweepScanLimit = clampEnvInt(
    "ACTIVITY_SWEEP_SCAN_LIMIT",
    DEFAULT_SWEEP_SCAN_LIMIT,
    sweepBatchSize,
    MAX_ACTIVITY_SCAN_LIMIT,
  );
  const dueScanLimit = clampEnvInt("ACTIVITY_SWEEP_DUE_LIMIT", sweepScanLimit, 25, MAX_ACTIVITY_SCAN_LIMIT);
  const inactivityCutoff = now - thresholdSec;

  let scanned = 0;
  let cursorCreatedAt = -1;
  let cursorUserId = 0;
  const inactiveIds: number[] = [];

  while (scanned < sweepScanLimit) {
    const take = Math.min(sweepBatchSize, sweepScanLimit - scanned);
    const candidateRowsResult = await dbClient.query(
      `
        SELECT
          u.id AS "userId",
          u.created_at AS "createdAt"
        FROM users u
        WHERE
          u.is_admin IS FALSE
          AND u.is_deleted IS FALSE
          AND u.deletion_exempt IS FALSE
          AND u.created_at <= $1
          AND (u.created_at > $2 OR (u.created_at = $2 AND u.id > $3))
        ORDER BY u.created_at ASC, u.id ASC
        LIMIT $4
      `,
      [inactivityCutoff, cursorCreatedAt, cursorUserId, take],
    );

    const candidateRows = candidateRowsResult.rows as any[];
    if (candidateRows.length === 0) break;

    scanned += candidateRows.length;
    const tail = candidateRows[candidateRows.length - 1] as any;
    cursorCreatedAt = num(tail.createdAt, cursorCreatedAt);
    cursorUserId = num(tail.userId, cursorUserId);

    const candidateIds = candidateRows.map((r) => num(r.userId)).filter((x) => x > 0);
    const lastActiveByUserId = await loadLastActiveByUserIds(candidateIds);
    for (const row of candidateRows) {
      const userId = num(row.userId);
      if (userId <= 0) continue;
      const createdAt = num(row.createdAt, 0);
      const lastActiveAt = lastActiveByUserId.get(userId) ?? createdAt;
      if (now - lastActiveAt >= thresholdSec) {
        inactiveIds.push(userId);
      }
    }
  }

  const dueRowsResult = await dbClient.query(
    `
      SELECT user_id AS "userId"
      FROM user_deletion_queue
      WHERE status='GRACE' AND grace_expires_at <= $1
      ORDER BY grace_expires_at ASC, user_id ASC
      LIMIT $2
    `,
    [now, dueScanLimit]
  );

  const dueRows = dueRowsResult.rows as any[];
  const dueIds = Array.from(new Set(dueRows.map((d) => num(d.userId)).filter((x) => x > 0)));

  if (!args.dryRun) {
    if (cfg.autoQueueInactive && inactiveIds.length) {
      const alreadyQueued = new Set<number>();
      for (const idChunk of chunkNumbers(inactiveIds, MAX_ACTIVITY_MUTATION_USER_IDS)) {
        const existing = await db
          .select({ userId: userDeletionQueue.userId })
          .from(userDeletionQueue)
          .where(inArray(userDeletionQueue.userId, idChunk));
        for (const row of existing) {
          const existingId = Number(row.userId);
          if (Number.isFinite(existingId) && existingId > 0) {
            alreadyQueued.add(existingId);
          }
        }
      }

      const queueIds = inactiveIds.filter((id) => !alreadyQueued.has(id));

      for (const idChunk of chunkNumbers(queueIds, MAX_ACTIVITY_MUTATION_USER_IDS)) {
        await enqueueForDeletion({
          userIds: idChunk,
          reason: "INACTIVE",
          note: "auto-sweep",
          actorAdminId: args.actorAdminId,
        });
      }
    }
    if (cfg.autoSoftDelete && dueIds.length) {
      for (const idChunk of chunkNumbers(dueIds, MAX_ACTIVITY_MUTATION_USER_IDS)) {
        await softDeleteUsers({ userIds: idChunk, actorAdminId: args.actorAdminId, reason: "auto-grace-expired" });
      }
    }
  }

  return {
    inactivityThresholdDays: cfg.inactivityThresholdDays,
    deletionGraceDays: cfg.deletionGraceDays,
    foundInactive: inactiveIds.length,
    foundDue: dueIds.length,
    applied: !args.dryRun,
    autoQueueInactive: cfg.autoQueueInactive,
    autoSoftDelete: cfg.autoSoftDelete,
  };
}
