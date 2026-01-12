import bcrypt from "bcryptjs";
import { db, dbClient } from "@db";
import { and, eq, inArray } from "drizzle-orm";
import {
  adminActions,
  botRiskAssessments,
  emailVerificationTokens,
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
  const limit = Math.max(1, Math.min(5000, Number(opts.limit ?? 2000)));

  const { rows: activityRows } = await dbClient.query(
    `
      WITH
      sess AS (
        SELECT user_id, MAX(last_active_at) AS last_seen_at
        FROM user_sessions
        GROUP BY user_id
      ),
      logins AS (
        SELECT user_id, MAX(created_at) AS last_login_at
        FROM user_login_history
        WHERE success = TRUE
        GROUP BY user_id
      ),
      trades_last AS (
        SELECT user_id, MAX(COALESCE(closed_at, opened_at)) AS last_trade_at
        FROM trades
        GROUP BY user_id
      )
      SELECT
        u.id AS "userId",
        u.email AS email,
        u.username AS username,
        u.is_disabled AS "isDisabled",
        u.is_deleted AS "isDeleted",
        u.deletion_exempt AS "deletionExempt",
        u.created_at AS "createdAt",
        GREATEST(
          COALESCE(sess.last_seen_at, 0),
          COALESCE(logins.last_login_at, 0),
          COALESCE(trades_last.last_trade_at, 0),
          u.created_at
        ) AS "lastActiveAt",
        COALESCE(b.score, 0) AS "botScore",
        COALESCE(b.label, 'OK') AS "botLabel",
        dq.status AS "queueStatus",
        dq.reason AS "queueReason",
        dq.marked_at AS "queuedAt",
        dq.grace_expires_at AS "graceExpiresAt"
      FROM users u
      LEFT JOIN sess ON sess.user_id = u.id
      LEFT JOIN logins ON logins.user_id = u.id
      LEFT JOIN trades_last ON trades_last.user_id = u.id
      LEFT JOIN bot_risk_assessments b ON b.user_id = u.id
      LEFT JOIN user_deletion_queue dq ON dq.user_id = u.id
      WHERE
        u.is_admin = FALSE
        AND ($1::int = 1 OR u.is_deleted = FALSE)
      ORDER BY "lastActiveAt" ASC
      LIMIT $2;
    `,
    [includeDeleted ? 1 : 0, limit]
  );

  const rowsRaw = activityRows as any[];

  const rows: AdminActivityRow[] = rowsRaw.map((r) => {
    const last = num(r.lastActiveAt, num(r.createdAt));
    const inactiveDays = Math.floor((now - last) / 86400);
    return {
      userId: num(r.userId),
      email: String(r.email ?? ""),
      username: String(r.username ?? ""),
      isDisabled: Boolean(r.isDisabled),
      isDeleted: Boolean(r.isDeleted),
      deletionExempt: Boolean(r.deletionExempt),
      createdAt: num(r.createdAt),
      lastActiveAt: last,
      inactiveDays,
      botScore: num(r.botScore),
      botLabel: String(r.botLabel ?? "OK"),
      queueStatus: r.queueStatus ? String(r.queueStatus) : undefined,
      queueReason: r.queueReason ? String(r.queueReason) : undefined,
      queuedAt: r.queuedAt ? num(r.queuedAt) : undefined,
      graceExpiresAt: r.graceExpiresAt ? num(r.graceExpiresAt) : undefined,
    };
  });

  let filtered = rows.filter((r) => r.inactiveDays >= Math.max(0, opts.minInactiveDays ?? 0));
  if (inactiveOnly) filtered = filtered.filter((r) => r.inactiveDays >= cfg.inactivityThresholdDays);
  if (botsOnly) filtered = filtered.filter((r) => r.botScore >= cfg.botScoreThreshold);

  return { cfg, rows: filtered };
}

function anonymizeEmail(userId: number) {
  return `deleted+${userId}@deleted.local`;
}

function anonymizeUsername(userId: number) {
  return `deleted_user_${userId}`;
}

async function computeLastActiveAtSec(userId: number): Promise<number> {
  const { rows } = await dbClient.query(
    `
      WITH
      sess AS (
        SELECT MAX(last_active_at) AS last_seen_at
        FROM user_sessions
        WHERE user_id = $1
      ),
      logins AS (
        SELECT MAX(created_at) AS last_login_at
        FROM user_login_history
        WHERE user_id = $1 AND success = TRUE
      ),
      trades_last AS (
        SELECT MAX(COALESCE(closed_at, opened_at)) AS last_trade_at
        FROM trades
        WHERE user_id = $1
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
      LEFT JOIN sess ON 1 = 1
      LEFT JOIN logins ON 1 = 1
      LEFT JOIN trades_last ON 1 = 1
      WHERE u.id = $1
      LIMIT 1;
    `,
    [userId]
  );

  const row = rows[0] as any;

  const last = num(row?.lastActiveAt, num(row?.createdAt, 0));
  return Math.max(0, Math.trunc(last));
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

  const ids = Array.from(new Set(args.userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  if (ids.length === 0) return { queued: 0 };

  let queued = 0;
  for (const userId of ids) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.isAdmin, false)),
    });
    if (!user) continue;
    if ((user as any).isDeleted) continue;
    if ((user as any).deletionExempt) continue;

    const lastActiveAt = await computeLastActiveAtSec(userId);

    await db
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

    await db
      .update(users)
      .set({
        isDisabled: true,
        inactivatedAt: now,
      } as any)
      .where(eq(users.id, userId));

    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `queued_for_deletion:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for queued user:", userId, e);
    }

    await db.insert(userAccountEvents).values({
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

    queued++;
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
  const ids = Array.from(new Set(args.userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  if (ids.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (const userId of ids) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.isAdmin, false)),
    });
    if (!user) continue;
    if ((user as any).isDeleted) continue;

    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `soft_delete:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for soft-deleted user:", userId, e);
    }

    const newPwHash = await bcrypt.hash(randomToken(32), 10);
    const email = anonymizeEmail(userId);
    const username = anonymizeUsername(userId);

    await db
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

    await db
      .update(userDeletionQueue)
      .set({
        status: "EXECUTED_SOFT",
        executedAt: now,
        executedByAdminId: actor || null,
      } as any)
      .where(eq(userDeletionQueue.userId, userId));

    await db.insert(userAccountEvents).values({
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

    deleted++;
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
  const ids = Array.from(new Set(args.userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
  if (ids.length === 0) return { deleted: 0 };

  let deleted = 0;
  for (const userId of ids) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.isAdmin, false)),
    });
    if (!user) continue;

    try {
      await revokeAllSessionsForUser({
        actorUserId: actor,
        targetUserId: userId,
        reason: `hard_delete:${args.reason}`,
      });
    } catch (e) {
      console.error("Failed to revoke sessions for hard-deleted user:", userId, e);
    }

    const lastActiveAt = await computeLastActiveAtSec(userId);
    const newPwHash = await bcrypt.hash(randomToken(32), 10);
    const email = anonymizeEmail(userId);
    const username = anonymizeUsername(userId);
    const priorEmail = String((user as any).email ?? "");

    try {
      await db.transaction(async (tx) => {
        const safeDelete = async (fn: () => Promise<unknown>) => {
          try {
            await fn();
          } catch {
            // tolerate missing tables/columns across schema versions
          }
        };

        // Purge non-ledger / non-essential tables first
        await safeDelete(() => tx.delete(botRiskAssessments).where(eq(botRiskAssessments.userId, userId)));
        await safeDelete(() => tx.delete(userSessions).where(eq(userSessions.userId, userId)));
        await safeDelete(() => tx.delete(userLoginHistory).where(eq(userLoginHistory.userId, userId)));
        if (priorEmail) {
          await safeDelete(() => tx.delete(userLoginHistory).where(eq(userLoginHistory.email, priorEmail)));
        }
        await safeDelete(() => tx.delete(userAdminNotes).where(eq(userAdminNotes.userId, userId)));
        await safeDelete(() => tx.delete(traderJournal).where(eq(traderJournal.userId, userId)));
        await safeDelete(() => tx.delete(userSettings).where(eq(userSettings.userId, userId)));
        await safeDelete(() => tx.delete(userVerification).where(eq(userVerification.userId, userId)));
        await safeDelete(() => tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId)));
        await safeDelete(() => tx.delete(smsOtpTokens).where(eq(smsOtpTokens.userId, userId)));
        await safeDelete(() => tx.delete(userMfa).where(eq(userMfa.userId, userId)));
        await safeDelete(() => tx.delete(signupFingerprints).where(eq(signupFingerprints.userId, userId)));

        // Account events and notes are PII-heavy; remove them in hard delete.
        await safeDelete(() => tx.delete(userAccountEvents).where(eq(userAccountEvents.userId, userId)));

        // Update/insert queue record to reflect execution.
        await safeDelete(() =>
          tx
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
            })
        );

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
        await safeDelete(() =>
          tx.insert(adminActions).values({
            adminId: actor || 0,
            userId,
            actionType: "ACCOUNT_HARD_DELETED",
            metadata: JSON.stringify({ reason: args.reason }),
            ip: null,
            userAgent: null,
            createdAt: now,
          } as any)
        );
      });
    } catch (e) {
      console.error("Hard delete transaction failed:", userId, e);
      continue;
    }

    deleted++;
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
  const ids = Array.from(new Set(args.userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
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
  const ids = Array.from(new Set(args.userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
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

  const rowsResult = await dbClient.query(
    `
      WITH
      sess AS (SELECT user_id, MAX(last_active_at) AS last_seen_at FROM user_sessions GROUP BY user_id),
      logins AS (SELECT user_id, MAX(created_at) AS last_login_at FROM user_login_history WHERE success=1 GROUP BY user_id),
      trades_last AS (SELECT user_id, MAX(COALESCE(closed_at, opened_at)) AS last_trade_at FROM trades GROUP BY user_id)
      SELECT
        u.id AS "userId",
        u.deletion_exempt AS "deletionExempt",
        GREATEST(
          COALESCE(sess.last_seen_at, 0),
          COALESCE(logins.last_login_at, 0),
          COALESCE(trades_last.last_trade_at, 0),
          u.created_at
        ) AS "lastActiveAt"
      FROM users u
      LEFT JOIN sess ON sess.user_id=u.id
      LEFT JOIN logins ON logins.user_id=u.id
      LEFT JOIN trades_last ON trades_last.user_id=u.id
      WHERE u.is_admin=0 AND u.is_deleted=0
    `
  );

  const rows = rowsResult.rows as any[];

  const inactiveIds = rows
    .filter((r) => !r.deletionExempt)
    .filter((r) => now - num(r.lastActiveAt) >= thresholdSec)
    .map((r) => num(r.userId))
    .filter((x) => x > 0);

  const dueRowsResult = await dbClient.query(
    `
      SELECT user_id AS "userId"
      FROM user_deletion_queue
      WHERE status='GRACE' AND grace_expires_at <= $1
    `,
    [now]
  );

  const dueRows = dueRowsResult.rows as any[];

  const dueIds = dueRows.map((d) => num(d.userId)).filter((x) => x > 0);

  if (!args.dryRun) {
    if (cfg.autoQueueInactive && inactiveIds.length) {
      const existing = await db
        .select({ userId: userDeletionQueue.userId })
        .from(userDeletionQueue)
        .where(inArray(userDeletionQueue.userId, inactiveIds));

      const alreadyQueued = new Set(existing.map((r) => Number(r.userId)).filter((x) => Number.isFinite(x) && x > 0));
      const queueIds = inactiveIds.filter((id) => !alreadyQueued.has(id));

      if (queueIds.length) {
        await enqueueForDeletion({ userIds: queueIds, reason: "INACTIVE", note: "auto-sweep", actorAdminId: args.actorAdminId });
      }
    }
    if (cfg.autoSoftDelete && dueIds.length) {
      await softDeleteUsers({ userIds: dueIds, actorAdminId: args.actorAdminId, reason: "auto-grace-expired" });
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
