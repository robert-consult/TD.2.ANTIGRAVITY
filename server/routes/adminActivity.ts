// @ts-nocheck
import { Router } from "express";
import { db } from "@db";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  cancelDeletionQueue,
  enqueueForDeletion,
  getActivityConfig,
  hardDeleteUsers,
  listAdminActivity,
  runInactivitySweep,
  setDeletionExempt,
  softDeleteUsers,
} from "../services/accountLifecycle";

export const adminActivityRouter = Router();
adminActivityRouter.use(requireAdmin);

function toInt(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number) {
  const n = toInt(v, fallback);
  return Math.max(lo, Math.min(hi, n));
}

function toBool(v: unknown, fallback: boolean) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }
  return fallback;
}

adminActivityRouter.get("/config", async (_req, res) => {
  try {
    const sc = await db.query.systemConfig.findFirst({ where: eq(systemConfig.id, 1) });
    return res.json({
      inactivityThresholdDays: sc?.inactivityThresholdDays ?? 90,
      deletionGraceDays: sc?.deletionGraceDays ?? 30,
      botScoreThreshold: sc?.botScoreThreshold ?? 40,
      botPowEnabled: sc?.botPowEnabled ?? true,
      botPowEnforceSignup: sc?.botPowEnforceSignup ?? true,
      botPowEnforceLogin: sc?.botPowEnforceLogin ?? false,
      botPowChallengeScore: sc?.botPowChallengeScore ?? 25,
      botPowBaseDifficulty: sc?.botPowBaseDifficulty ?? 14,
      botPowMaxDifficulty: sc?.botPowMaxDifficulty ?? 20,
      botPowTtlSec: sc?.botPowTtlSec ?? 120,
      botValkeyEnabled: sc?.botValkeyEnabled ?? true,
      activityAutoQueueInactive: sc?.activityAutoQueueInactive ?? true,
      activityAutoSoftDelete: sc?.activityAutoSoftDelete ?? false,
      updatedAt: sc?.updatedAt ?? null,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

adminActivityRouter.put("/config", async (req, res) => {
  try {
    const body = req.body ?? {};
    const inactivityThresholdDays = clampInt(body.inactivityThresholdDays, 1, 3650, 90);
    const deletionGraceDays = clampInt(body.deletionGraceDays, 0, 3650, 30);
    const botScoreThreshold = clampInt(body.botScoreThreshold, 0, 100, 40);

    const botPowEnabled = toBool(body.botPowEnabled, true);
    const botPowEnforceSignup = toBool(body.botPowEnforceSignup, true);
    const botPowEnforceLogin = toBool(body.botPowEnforceLogin, false);
    const botPowChallengeScore = clampInt(body.botPowChallengeScore, 0, 100, 25);
    const botPowBaseDifficulty = clampInt(body.botPowBaseDifficulty, 1, 32, 14);
    const botPowMaxDifficulty = Math.max(botPowBaseDifficulty, clampInt(body.botPowMaxDifficulty, 1, 32, 20));
    const botPowTtlSec = clampInt(body.botPowTtlSec, 10, 3600, 120);
    const botValkeyEnabled = toBool(body.botValkeyEnabled, true);

    const activityAutoQueueInactive = toBool(body.activityAutoQueueInactive, true);
    const activityAutoSoftDelete = toBool(body.activityAutoSoftDelete, false);

    await db
      .update(systemConfig)
      .set({
        inactivityThresholdDays,
        deletionGraceDays,
        botScoreThreshold,
        botPowEnabled,
        botPowEnforceSignup,
        botPowEnforceLogin,
        botPowChallengeScore,
        botPowBaseDifficulty,
        botPowMaxDifficulty,
        botPowTtlSec,
        botValkeyEnabled,
        activityAutoQueueInactive,
        activityAutoSoftDelete,
        updatedAt: new Date(),
      } as any)
      .where(eq(systemConfig.id, 1))
      .run();
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to set config." });
  }
});

adminActivityRouter.get("/users", async (req, res) => {
  try {
    const days = Math.max(0, Math.min(3650, Number(req.query.days ?? 30)));
    const inactiveOnly = String(req.query.inactiveOnly ?? "0") === "1";
    const botsOnly = String(req.query.botsOnly ?? "0") === "1";
    const includeDeleted = String(req.query.includeDeleted ?? "0") === "1";
    const limit = Math.max(1, Math.min(5000, Number(req.query.limit ?? 2000)));

    const { cfg, rows } = await listAdminActivity({
      minInactiveDays: days,
      inactiveOnly,
      botsOnly,
      includeDeleted,
      limit,
    });
    return res.json({ days, cfg, rows });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to list users." });
  }
});

adminActivityRouter.post("/sweep", async (req, res) => {
  try {
    const dryRun = Boolean(req.body?.dryRun ?? true);
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await runInactivitySweep({ dryRun, actorAdminId });
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to run sweep." });
  }
});

adminActivityRouter.post("/queue", async (req, res) => {
  try {
    const userIds = (req.body?.userIds ?? []) as number[];
    const reason = String(req.body?.reason ?? "ADMIN").toUpperCase() as "INACTIVE" | "BOT" | "ADMIN";
    const note = typeof req.body?.note === "string" ? String(req.body.note) : undefined;
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await enqueueForDeletion({ userIds, reason, note, actorAdminId });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to queue deletion." });
  }
});

adminActivityRouter.post("/cancel", async (req, res) => {
  try {
    const userIds = (req.body?.userIds ?? []) as number[];
    const note = typeof req.body?.note === "string" ? String(req.body.note) : undefined;
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await cancelDeletionQueue({ userIds, actorAdminId, note });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to cancel queue." });
  }
});

adminActivityRouter.post("/exempt", async (req, res) => {
  try {
    const userIds = (req.body?.userIds ?? []) as number[];
    const exempt = Boolean(req.body?.exempt ?? true);
    const note = typeof req.body?.note === "string" ? String(req.body.note) : undefined;
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await setDeletionExempt({ userIds, exempt, actorAdminId, note });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to update exemption." });
  }
});

adminActivityRouter.post("/soft-delete", async (req, res) => {
  try {
    const userIds = (req.body?.userIds ?? []) as number[];
    const reason = typeof req.body?.reason === "string" ? String(req.body.reason) : "admin-soft-delete";
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await softDeleteUsers({ userIds, actorAdminId, reason });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to soft delete." });
  }
});

adminActivityRouter.post("/hard-delete", async (req, res) => {
  const allowHardDelete =
    String(process.env.ALLOW_ADMIN_HARD_DELETE ?? "").toLowerCase() === "true" ||
    String(process.env.ALLOW_ADMIN_HARD_DELETE ?? "") === "1" ||
    String(process.env.NODE_ENV ?? "development") !== "production";

  if (!allowHardDelete) {
    return res.status(403).json({ ok: false, error: "HARD_DELETE_DISABLED" });
  }

  try {
    const userIds = (req.body?.userIds ?? []) as number[];
    const reason = typeof req.body?.reason === "string" ? String(req.body.reason) : "admin-hard-delete";
    const actorAdminId = Number((req.session as any).userId || 0) || null;
    const out = await hardDeleteUsers({ userIds, actorAdminId, reason });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to hard delete." });
  }
});
