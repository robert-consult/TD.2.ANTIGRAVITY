import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { buildAuditContext } from "../lib/auditContext";
import type { AccountActionProvenance } from "../lib/accountEventMirror";
import { requireAdmin } from "../middleware/requireAdmin";
import { appendIdentityAudit } from "../services/identityAudit";
import { applyAdminScopeSession } from "../security/adminScopeSession";
import { storage } from "../storage";
import { appendAuditEntry } from "../grift/griftAdminAudit";
import { getGriftDb } from "../grift/griftDb";

const VIEW_AS_START_RATE_WINDOW_MS = 5 * 60 * 1000;
const VIEW_AS_START_RATE_LIMIT = 10;

type RateLimitEntry = { count: number; resetAtMs: number };

const viewAsStartRateByAdminId = new Map<number, RateLimitEntry>();

const viewAsStartSchema = z
  .object({
    userId: z.number().int().positive(),
  })
  .strict();

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function consumeViewAsStartRateLimit(adminId: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = viewAsStartRateByAdminId.get(adminId);
  if (!existing || existing.resetAtMs <= now) {
    viewAsStartRateByAdminId.set(adminId, {
      count: 1,
      resetAtMs: now + VIEW_AS_START_RATE_WINDOW_MS,
    });
    return {
      allowed: true,
      retryAfterSec: Math.max(1, Math.ceil(VIEW_AS_START_RATE_WINDOW_MS / 1000)),
    };
  }

  if (existing.count >= VIEW_AS_START_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
    };
  }

  existing.count += 1;
  viewAsStartRateByAdminId.set(adminId, existing);
  return {
    allowed: true,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
  };
}

const viewAsStartRateCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [adminId, entry] of viewAsStartRateByAdminId.entries()) {
    if (entry.resetAtMs <= now) {
      viewAsStartRateByAdminId.delete(adminId);
    }
  }
}, 2 * 60 * 1000);
viewAsStartRateCleanupTimer.unref?.();

function buildProvenance(req: Request, actorUserId?: number): AccountActionProvenance {
  const ctx = buildAuditContext(req);
  const resolvedActorUserId =
    typeof actorUserId === "number" && Number.isFinite(actorUserId)
      ? actorUserId
      : typeof ctx.actorUserId === "number" && Number.isFinite(ctx.actorUserId)
        ? ctx.actorUserId
        : undefined;
  return {
    actorType: ctx.actorType,
    actorUserId: resolvedActorUserId,
    sessionId: ctx.sessionId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  };
}

async function applyGriftEnforcementSyncWithDb(
  griftDb: ReturnType<typeof getGriftDb>,
  params: {
    userId: number;
    adminId: number;
    action: "FREEZE" | "UNFREEZE" | "DISABLE" | "ENABLE";
    reason?: string | null;
  },
): Promise<{ actionTaken: boolean; oldStatus: string; newStatus: string }> {
  const existing = (await griftDb
    .prepare(`
        SELECT frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        FROM grift_user_enforcements
        WHERE user_id = ?
      `)
    .get(params.userId)) as any;

  const wasFrozen = Boolean(existing?.frozen_at);
  const wasDisabled = Boolean(existing?.disabled_at);
  const oldStatus = wasDisabled ? "DISABLED" : wasFrozen ? "FROZEN" : "ACTIVE";

  const now = Date.now();
  let frozenAt = existing?.frozen_at ?? null;
  let frozenBy = existing?.frozen_by_admin_id ?? null;
  let disabledAt = existing?.disabled_at ?? null;
  let disabledBy = existing?.disabled_by_admin_id ?? null;
  let notes = existing?.notes ?? null;

  let statusChanged = false;
  if (params.action === "FREEZE") {
    if (!wasFrozen) {
      frozenAt = now;
      frozenBy = params.adminId;
      statusChanged = true;
    }
  } else if (params.action === "UNFREEZE") {
    if (wasFrozen) {
      frozenAt = null;
      frozenBy = null;
      statusChanged = true;
    }
  } else if (params.action === "DISABLE") {
    if (!wasDisabled) {
      disabledAt = now;
      disabledBy = params.adminId;
      statusChanged = true;
    }
  } else if (params.action === "ENABLE") {
    if (wasDisabled) {
      disabledAt = null;
      disabledBy = null;
      statusChanged = true;
    }
  }

  const normalizedReason = typeof params.reason === "string" ? params.reason.trim() : "";
  const notesChanged = normalizedReason.length > 0 && normalizedReason !== String(notes ?? "");
  if (notesChanged) notes = normalizedReason;

  const newStatus = disabledAt ? "DISABLED" : frozenAt ? "FROZEN" : "ACTIVE";
  const actionTaken = statusChanged || notesChanged;

  if (!actionTaken) {
    return { actionTaken: false, oldStatus, newStatus };
  }

  await griftDb
    .prepare(`
        INSERT INTO grift_user_enforcements (
          user_id, frozen_at, frozen_by_admin_id, disabled_at, disabled_by_admin_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          frozen_at = excluded.frozen_at,
          frozen_by_admin_id = excluded.frozen_by_admin_id,
          disabled_at = excluded.disabled_at,
          disabled_by_admin_id = excluded.disabled_by_admin_id,
          notes = excluded.notes
      `)
    .run(params.userId, frozenAt, frozenBy, disabledAt, disabledBy, notes);

  const riskScore =
    (
      (await griftDb
        .prepare(`
        SELECT score_current as scoreCurrent FROM grift_user_scores WHERE user_id = ?
      `)
        .get(params.userId)) as any
    )?.scoreCurrent ?? null;

  await griftDb
    .prepare(`
        INSERT INTO grift_enforcement_log (
          user_id, action, old_status, new_status, admin_id, reason, risk_score_at_action, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
    .run(params.userId, params.action, oldStatus, newStatus, params.adminId, normalizedReason || null, riskScore, now);

  await appendAuditEntry(griftDb, params.adminId, `ENFORCEMENT_${params.action}`, "user", params.userId, {
    source: "admin_users_endpoint",
    oldStatus,
    newStatus,
    riskScore,
    reason: normalizedReason || null,
  });

  return { actionTaken: true, oldStatus, newStatus };
}

async function applyGriftEnforcementSync(params: {
  userId: number;
  adminId: number;
  action: "FREEZE" | "UNFREEZE" | "DISABLE" | "ENABLE";
  reason?: string | null;
}): Promise<{ actionTaken: boolean; oldStatus: string; newStatus: string }> {
  const griftDb = getGriftDb();
  return await applyGriftEnforcementSyncWithDb(griftDb, params);
}

export const adminUsersRouter = Router();

adminUsersRouter.get("/users/full", requireAdmin, async (_req, res) => {
  try {
    const usersData = await storage.getAllUsersWithDetails();
    return res.json(usersData);
  } catch (error) {
    console.error("Error fetching users with details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/:id/toggle-status", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const { disabled } = req.body;
    const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
    const adminIdNum = Number(adminIdRaw);
    if (!Number.isFinite(adminIdNum)) {
      return res.status(401).json({ message: "Admin session missing" });
    }

    const user = await storage.setUserDisabled(userId, disabled, adminIdNum, buildProvenance(req, adminIdNum));

    try {
      await applyGriftEnforcementSync({
        userId,
        adminId: adminIdNum,
        action: disabled ? "DISABLE" : "ENABLE",
        reason: disabled ? "Admin toggle-status: disabled" : "Admin toggle-status: enabled",
      });
    } catch (griftErr) {
      console.error("[Grift] Failed to sync enforcement (toggle-status):", griftErr);
    }
    return res.json({ success: true, user });
  } catch (error) {
    console.error("Error toggling user status:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/:id/freeze", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const { reasonCode, reasonText } = req.body;
    const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
    const adminIdNum = Number(adminIdRaw);
    if (!Number.isFinite(adminIdNum)) {
      return res.status(401).json({ message: "Admin session missing" });
    }

    if (!reasonCode) {
      return res.status(400).json({ message: "Reason code is required" });
    }

    const user = await storage.freezeUserAccount({
      userId,
      adminId: adminIdNum,
      reasonCode,
      reasonText,
      provenance: buildProvenance(req, adminIdNum),
    });

    try {
      const reason = reasonText ? `${reasonCode}: ${reasonText}` : String(reasonCode);
      await applyGriftEnforcementSync({
        userId,
        adminId: adminIdNum,
        action: "FREEZE",
        reason,
      });
    } catch (griftErr) {
      console.error("[Grift] Failed to sync enforcement (freeze):", griftErr);
    }
    return res.json({ success: true, user });
  } catch (error: any) {
    console.error("Error freezing user account:", error);
    if (error.message?.includes("User not found")) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/:id/unfreeze", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const reason = typeof (req.body as any)?.reason === "string" ? String((req.body as any).reason) : undefined;
    const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
    const adminIdNum = Number(adminIdRaw);
    if (!Number.isFinite(adminIdNum)) {
      return res.status(401).json({ message: "Admin session missing" });
    }

    const user = await storage.unfreezeUserAccount({
      userId,
      adminId: adminIdNum,
      reason,
      provenance: buildProvenance(req, adminIdNum),
    });

    try {
      await applyGriftEnforcementSync({
        userId,
        adminId: adminIdNum,
        action: "UNFREEZE",
        reason: typeof reason === "string" ? reason : "Admin unfreeze",
      });
    } catch (griftErr) {
      console.error("[Grift] Failed to sync enforcement (unfreeze):", griftErr);
    }
    return res.json({ success: true, user });
  } catch (error: any) {
    console.error("Error unfreezing user account:", error);
    if (error.message?.includes("User not found")) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.get("/users/:id/timeline", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;

    const timeline = await storage.getUserTimeline(userId, limit);
    return res.json(timeline);
  } catch (error) {
    console.error("Error fetching user timeline:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.get("/users/:id/logins", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const logins = await storage.getUserLoginHistory(userId, limit);
    return res.json(logins);
  } catch (error) {
    console.error("Error fetching login history:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.get("/users/:id/notes", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const notes = await storage.getUserNotes(userId);
    return res.json(notes);
  } catch (error) {
    console.error("Error fetching user notes:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/:id/notes", requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const { type, severity, flagCode, content } = req.body;
    const adminId = (req as any).user?.id || req.session?.userId;

    if (!content) {
      return res.status(400).json({ message: "Content is required" });
    }

    const note = await storage.addUserNote({
      userId,
      adminId,
      type: type || "NOTE",
      severity: severity || "INFO",
      flagCode,
      content,
      provenance: buildProvenance(req, adminId),
    });
    return res.json({ success: true, note });
  } catch (error) {
    console.error("Error adding user note:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/notes/:id/resolve", requireAdmin, async (req, res) => {
  try {
    const noteId = parseInt(getParam(req.params.id), 10);
    const adminId = (req as any).user?.id || req.session?.userId;

    const note = await storage.resolveUserNote(noteId, adminId);
    return res.json({ success: true, note });
  } catch (error) {
    console.error("Error resolving note:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.get("/login-history", requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 200;
    const history = await storage.getAllLoginHistory(limit);
    return res.json(history);
  } catch (error) {
    console.error("Error fetching login history:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.get("/online-users", requireAdmin, async (_req, res) => {
  try {
    const data = await storage.getOnlineUsers();
    return res.json(data);
  } catch (error) {
    console.error("Error fetching online users:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/bulk/toggle-status", requireAdmin, async (req, res) => {
  try {
    const { userIds, disabled } = req.body;
    const adminIdRaw = (req as any).user?.id ?? req.session?.userId;
    const adminIdNum = Number(adminIdRaw);
    if (!Number.isFinite(adminIdNum)) {
      return res.status(401).json({ message: "Admin session missing" });
    }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "User IDs array is required" });
    }

    const count = await storage.bulkSetUsersDisabled(userIds, disabled, adminIdNum, buildProvenance(req, adminIdNum));

    try {
      const action: "DISABLE" | "ENABLE" = disabled ? "DISABLE" : "ENABLE";
      const reason =
        disabled
          ? `Admin bulk toggle-status: disabled ${userIds.length} users`
          : `Admin bulk toggle-status: enabled ${userIds.length} users`;
      const griftDb = getGriftDb();
      for (const rawId of userIds) {
        const userId = Number(rawId);
        if (!Number.isFinite(userId)) continue;
        await applyGriftEnforcementSyncWithDb(griftDb, {
          userId,
          adminId: adminIdNum,
          action,
          reason,
        });
      }
    } catch (griftErr) {
      console.error("[Grift] Failed to sync enforcement (bulk toggle-status):", griftErr);
    }
    return res.json({ success: true, affected: count });
  } catch (error) {
    console.error("Error bulk toggling user status:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/users/bulk/risk-profile", requireAdmin, async (req, res) => {
  try {
    const { userIds, settings } = req.body;
    const adminId = (req as any).user?.id || req.session?.userId;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "User IDs array is required" });
    }

    if (!settings || Object.keys(settings).length === 0) {
      return res.status(400).json({ message: "Settings object is required" });
    }

    const count = await storage.bulkApplyRiskProfile(userIds, settings, adminId, buildProvenance(req, adminId));
    return res.json({ success: true, affected: count });
  } catch (error) {
    console.error("Error bulk applying risk profile:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

adminUsersRouter.post("/view-as/start", requireAdmin, async (req, res) => {
  try {
    const realAdminId = Number(req.session.userId ?? 0);
    if (!Number.isFinite(realAdminId) || realAdminId <= 0) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const rate = consumeViewAsStartRateLimit(realAdminId);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      appendIdentityAudit({
        userId: null,
        email: req.session.email || null,
        category: "SECURITY",
        type: "IMPERSONATION_START_RATE_LIMITED",
        title: "View As start blocked by rate limit",
        description: `POST ${req.originalUrl || req.path}`,
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
        actorAdminId: realAdminId,
        actorType: "ADMIN",
        actorUserId: realAdminId,
        sessionId: req.sessionID,
        data: {
          limit: VIEW_AS_START_RATE_LIMIT,
          windowMs: VIEW_AS_START_RATE_WINDOW_MS,
          retryAfterSec: rate.retryAfterSec,
        },
      });
      return res.status(429).json({
        message: "VIEW_AS_RATE_LIMITED",
        code: "VIEW_AS_RATE_LIMITED",
        retryAfterSec: rate.retryAfterSec,
      });
    }

    const parsed = viewAsStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", code: "INVALID_PAYLOAD" });
    }
    const targetUserId = parsed.data.userId;

    if (targetUserId === req.session.userId) {
      return res.status(400).json({ message: "Cannot impersonate yourself" });
    }

    if (req.session.isImpersonating) {
      return res.status(400).json({ message: "Already impersonating a user. Stop current session first." });
    }

    const targetUser = await storage.getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.isAdmin) {
      return res.status(403).json({ message: "Cannot impersonate admin users" });
    }

    const realAdminEmail = String(req.session.email ?? "").trim();
    if (!realAdminEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await storage.logAdminAction({
      adminId: realAdminId,
      userId: targetUserId,
      actionType: "VIEW_AS_START",
      metadata: { targetEmail: targetUser.email },
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });

    req.session.isImpersonating = true;
    req.session.realAdminId = realAdminId;
    req.session.realAdminEmail = realAdminEmail;
    req.session.realAdminIsSuperAdmin = Boolean(req.session.isSuperAdmin);
    req.session.realAdminResourceScopes = req.session.adminResourceScopes ?? undefined;
    req.session.impersonatedUserId = targetUserId;
    req.session.impersonationStartedAt = Date.now();
    req.session.userId = targetUserId;
    req.session.email = targetUser.email;
    req.session.isAdmin = false;
    req.session.isSuperAdmin = false;
    req.session.adminResourceScopes = undefined;

    return res.json({
      success: true,
      message: `Now viewing as ${targetUser.email}`,
      impersonatedUser: {
        id: targetUser.id,
        email: targetUser.email,
        username: targetUser.username,
      },
    });
  } catch (error) {
    console.error("View As start error:", error);
    return res.status(500).json({ message: "Failed to start impersonation" });
  }
});

adminUsersRouter.post("/view-as/stop", async (req, res) => {
  try {
    if (!req.session.isImpersonating || !req.session.realAdminId) {
      return res.status(400).json({ message: "Not currently impersonating any user" });
    }

    const realAdminId = req.session.realAdminId;
    const impersonatedUserId = req.session.impersonatedUserId;

    const adminUser = await storage.getUserById(realAdminId);
    if (!adminUser) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Admin session invalid, please login again" });
    }

    await storage.logAdminAction({
      adminId: realAdminId,
      userId: impersonatedUserId || 0,
      actionType: "VIEW_AS_STOP",
      metadata: null,
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });

    req.session.userId = adminUser.id;
    req.session.email = adminUser.email;
    req.session.isAdmin = true;
    req.session.isSuperAdmin = Boolean(req.session.realAdminIsSuperAdmin);
    req.session.adminResourceScopes = req.session.realAdminResourceScopes ?? undefined;
    if (!req.session.adminResourceScopes) {
      applyAdminScopeSession(req.session, adminUser);
    }
    req.session.isImpersonating = false;
    req.session.realAdminId = undefined;
    req.session.realAdminEmail = undefined;
    req.session.realAdminIsSuperAdmin = undefined;
    req.session.realAdminResourceScopes = undefined;
    req.session.impersonatedUserId = undefined;
    req.session.impersonationStartedAt = undefined;

    return res.json({
      success: true,
      message: "Returned to admin session",
      adminUser: {
        id: adminUser.id,
        email: adminUser.email,
      },
    });
  } catch (error) {
    console.error("View As stop error:", error);
    return res.status(500).json({ message: "Failed to stop impersonation" });
  }
});

adminUsersRouter.get("/view-as/status", async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (req.session.isImpersonating && req.session.impersonatedUserId) {
      const impersonatedUser = await storage.getUserById(req.session.impersonatedUserId);
      return res.json({
        isImpersonating: true,
        realAdminId: req.session.realAdminId,
        realAdminEmail: req.session.realAdminEmail,
        impersonatedUser: impersonatedUser
          ? {
              id: impersonatedUser.id,
              email: impersonatedUser.email,
              username: impersonatedUser.username,
            }
          : null,
      });
    }

    return res.json({
      isImpersonating: false,
    });
  } catch (error) {
    console.error("View As status error:", error);
    return res.status(500).json({ message: "Failed to get impersonation status" });
  }
});

adminUsersRouter.get("/users/search", requireAdmin, async (req, res) => {
  try {
    const query = String(req.query.q || "").trim().toLowerCase();
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const allUsers = await storage.listUsersWithSettings();
    const matches = allUsers
      .filter(
        (user: { isAdmin: boolean; email: string; username: string | null; id: number }) =>
          !user.isAdmin &&
          (user.email.toLowerCase().includes(query) ||
            (user.username && user.username.toLowerCase().includes(query)) ||
            String(user.id).includes(query)),
      )
      .slice(0, 10)
      .map((user: { id: number; email: string; username: string | null; balance: string | null }) => ({
        id: user.id,
        email: user.email,
        username: user.username,
        balance: user.balance,
      }));

    return res.json(matches);
  } catch (error) {
    console.error("User search error:", error);
    return res.status(500).json({ message: "Failed to search users" });
  }
});
