import type Database from "better-sqlite3";
import { storage } from "../storage";
import { appendAuditEntry } from "./griftAdminAudit";
import { getConfig } from "./griftEngine";
import type { AuditContext } from "./griftTypes";

const SYSTEM_ADMIN_ID = 0;

type EnforcementState = {
  frozenAt: number | null;
  disabledAt: number | null;
  notes: string | null;
};

export type AutoEnforcementOutcome =
  | { action: "NONE"; applied: false; scoreCurrent: number | null }
  | {
      action: "AUTO_FREEZE" | "AUTO_DISABLE";
      applied: boolean;
      scoreCurrent: number;
      threshold: number;
      oldStatus: "ACTIVE" | "FROZEN" | "DISABLED";
      newStatus: "ACTIVE" | "FROZEN" | "DISABLED";
      reason: string;
    };

function getEnforcementState(db: Database.Database, userId: number): EnforcementState {
  const row = db
    .prepare(
      `
      SELECT frozen_at as frozenAt, disabled_at as disabledAt, notes
      FROM grift_user_enforcements
      WHERE user_id = ?
    `
    )
    .get(userId) as { frozenAt?: number | null; disabledAt?: number | null; notes?: string | null } | undefined;

  return {
    frozenAt: row?.frozenAt ?? null,
    disabledAt: row?.disabledAt ?? null,
    notes: row?.notes ?? null,
  };
}

function statusFromState(state: EnforcementState): "ACTIVE" | "FROZEN" | "DISABLED" {
  if (state.disabledAt) return "DISABLED";
  if (state.frozenAt) return "FROZEN";
  return "ACTIVE";
}

export async function maybeApplyAutoEnforcement(
  db: Database.Database,
  ctx: Pick<AuditContext, "userId" | "sessionId" | "ip" | "userAgent"> | undefined
): Promise<AutoEnforcementOutcome> {
  const userId = ctx?.userId;
  if (!userId) return { action: "NONE", applied: false, scoreCurrent: null };

  const cfg = getConfig(db);
  if (!cfg.enabled) return { action: "NONE", applied: false, scoreCurrent: null };

  const scoreRow = db
    .prepare(`SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?`)
    .get(userId) as { scoreCurrent?: number } | undefined;

  const scoreCurrent = typeof scoreRow?.scoreCurrent === "number" ? Number(scoreRow.scoreCurrent) : null;
  if (scoreCurrent == null) return { action: "NONE", applied: false, scoreCurrent: null };

  const wantsDisable = cfg.enforcementAutoDisable === 1 && scoreCurrent >= cfg.enforcementDisableThreshold;
  const wantsFreeze = cfg.enforcementAutoFreeze === 1 && scoreCurrent >= cfg.enforcementFreezeThreshold;

  let desired: "DISABLE" | "FREEZE" | null = null;
  let threshold = 0;
  if (wantsDisable) {
    desired = "DISABLE";
    threshold = cfg.enforcementDisableThreshold;
  } else if (wantsFreeze) {
    desired = "FREEZE";
    threshold = cfg.enforcementFreezeThreshold;
  }

  if (!desired) return { action: "NONE", applied: false, scoreCurrent };

  const existing = getEnforcementState(db, userId);
  const oldStatus = statusFromState(existing);
  if (oldStatus === "DISABLED") return { action: "NONE", applied: false, scoreCurrent };
  if (desired === "FREEZE" && oldStatus === "FROZEN") return { action: "NONE", applied: false, scoreCurrent };

  const now = Date.now();
  const reason = `${desired === "DISABLE" ? "Auto-disabled" : "Auto-frozen"} by Grift: score ${scoreCurrent} >= ${threshold}`;

  let newStatus: "ACTIVE" | "FROZEN" | "DISABLED" = oldStatus;

  if (desired === "FREEZE") {
    db.prepare(
      `
      INSERT INTO grift_user_enforcements (user_id, frozen_at, frozen_by_admin_id, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        frozen_at = excluded.frozen_at,
        frozen_by_admin_id = excluded.frozen_by_admin_id,
        notes = COALESCE(excluded.notes, notes)
    `
    ).run(userId, now, SYSTEM_ADMIN_ID, reason);
    newStatus = "FROZEN";

    db.prepare(
      `
      INSERT INTO grift_enforcement_log (
        user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(userId, "AUTO_FREEZE", oldStatus, newStatus, SYSTEM_ADMIN_ID, reason, scoreCurrent, now);

    appendAuditEntry(db, SYSTEM_ADMIN_ID, "ENFORCEMENT_FREEZE", "user", userId, {
      mode: "AUTO",
      scoreCurrent,
      threshold,
      oldStatus,
      newStatus,
      reason,
    });

    await storage.freezeUserAccount({
      userId,
      adminId: SYSTEM_ADMIN_ID,
      reasonCode: "GRIFT_AUTO_ENFORCEMENT",
      reasonText: reason,
      provenance: {
        actorType: "SYSTEM",
        actorUserId: SYSTEM_ADMIN_ID,
        sessionId: ctx.sessionId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } else {
    db.prepare(
      `
      INSERT INTO grift_user_enforcements (user_id, disabled_at, disabled_by_admin_id, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        disabled_at = excluded.disabled_at,
        disabled_by_admin_id = excluded.disabled_by_admin_id,
        notes = COALESCE(excluded.notes, notes)
    `
    ).run(userId, now, SYSTEM_ADMIN_ID, reason);
    newStatus = "DISABLED";

    db.prepare(
      `
      INSERT INTO grift_enforcement_log (
        user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(userId, "AUTO_DISABLE", oldStatus, newStatus, SYSTEM_ADMIN_ID, reason, scoreCurrent, now);

    appendAuditEntry(db, SYSTEM_ADMIN_ID, "ENFORCEMENT_DISABLE", "user", userId, {
      mode: "AUTO",
      scoreCurrent,
      threshold,
      oldStatus,
      newStatus,
      reason,
    });

    await storage.setUserDisabled(
      userId,
      true,
      SYSTEM_ADMIN_ID,
      {
        actorType: "SYSTEM",
        actorUserId: SYSTEM_ADMIN_ID,
        sessionId: ctx.sessionId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      }
    );
  }

  return {
    action: desired === "DISABLE" ? "AUTO_DISABLE" : "AUTO_FREEZE",
    applied: true,
    scoreCurrent,
    threshold,
    oldStatus,
    newStatus,
    reason,
  };
}

