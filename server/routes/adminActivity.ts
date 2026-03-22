import type { Request, Response } from "express";
import { Router } from "express";
import { db } from "@db";
import { clampIntOr } from "@shared/scalars";
import { eq } from "drizzle-orm";
import { systemConfig } from "@shared/schema";
import { z } from "zod";
import { requireAdmin } from "../middleware/requireAdmin";
import { ensureSystemConfigRow } from "../services/systemConfig";
import {
  buildActivityConfigWrite,
  getActivityAdminConfig,
  getActivityEffectiveState,
  invalidateActivityAdminConfigCache,
} from "../services/runtimeConfig/botConfig";
import { publishLiveEvent } from "../services/liveBus";
import {
  cancelDeletionQueue,
  enqueueForDeletion,
  hardDeleteUsers,
  listAdminActivity,
  runInactivitySweep,
  setDeletionExempt,
  softDeleteUsers,
} from "../services/accountLifecycle";

export const adminActivityRouter = Router();
adminActivityRouter.use(requireAdmin);

const MAX_ACTIVITY_USER_IDS = 500;
const MAX_ACTIVITY_NOTE_LEN = 500;
const MAX_ACTIVITY_REASON_LEN = 120;
const MAX_ACTIVITY_LIST_LIMIT = 500;
const ACTIVITY_RATE_WINDOW_MS = 60_000;
const ACTIVITY_SWEEP_RATE_LIMIT = 6;
const ACTIVITY_MUTATION_RATE_LIMIT = 30;

type RateEntry = { count: number; resetAtMs: number };
const activityRateByActor = new Map<string, RateEntry>();

function toInt(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number) {
  return clampIntOr(v, fallback, lo, hi);
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

function consumeRateLimit(store: Map<string, RateEntry>, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (current.count >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)) };
  }

  current.count += 1;
  store.set(key, current);
  return { allowed: true, retryAfterSec: Math.max(1, Math.ceil((current.resetAtMs - now) / 1000)) };
}

function getActorAdminId(req: Request): number | null {
  const parsed = Number((req.session as any)?.userId ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalText(v: string | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toBoolLike(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  }
  return undefined;
}

function enforceActivityRateLimit(req: Request, res: Response, kind: "sweep" | "mutation"): boolean {
  const adminId = getActorAdminId(req) ?? 0;
  const rate = consumeRateLimit(
    activityRateByActor,
    `${kind}:${adminId}:${String(req.ip ?? "unknown")}`,
    kind === "sweep" ? ACTIVITY_SWEEP_RATE_LIMIT : ACTIVITY_MUTATION_RATE_LIMIT,
    ACTIVITY_RATE_WINDOW_MS,
  );
  if (rate.allowed) return true;
  res.setHeader("Retry-After", String(rate.retryAfterSec));
  res.status(429).json({
    ok: false,
    error: kind === "sweep" ? "ACTIVITY_SWEEP_RATE_LIMIT" : "ACTIVITY_MUTATION_RATE_LIMIT",
    retryAfterSec: rate.retryAfterSec,
  });
  return false;
}

function badRequest(res: Response, error: string, details?: unknown) {
  return res.status(400).json({ ok: false, error, details });
}

const noteSchema = z
  .string()
  .trim()
  .max(MAX_ACTIVITY_NOTE_LEN)
  .optional()
  .transform((v) => normalizeOptionalText(v));

const reasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ACTIVITY_REASON_LEN)
  .optional()
  .transform((v) => normalizeOptionalText(v));

const userIdsSchema = z.array(z.coerce.number().int().positive()).min(1).max(MAX_ACTIVITY_USER_IDS);

const usersQuerySchema = z.object({
  days: z.coerce.number().int().min(0).max(3650).default(30),
  inactiveOnly: z.preprocess((v) => toBoolLike(v) ?? false, z.boolean()),
  botsOnly: z.preprocess((v) => toBoolLike(v) ?? false, z.boolean()),
  includeDeleted: z.preprocess((v) => toBoolLike(v) ?? false, z.boolean()),
  limit: z.coerce.number().int().min(1).max(MAX_ACTIVITY_LIST_LIMIT).default(200),
});

const sweepBodySchema = z
  .object({
    dryRun: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
  })
  .strict();

const queueBodySchema = z
  .object({
    userIds: userIdsSchema,
    reason: z.enum(["INACTIVE", "BOT", "ADMIN"]).default("ADMIN"),
    note: noteSchema,
  })
  .strict();

const cancelBodySchema = z
  .object({
    userIds: userIdsSchema,
    note: noteSchema,
  })
  .strict();

const exemptBodySchema = z
  .object({
    userIds: userIdsSchema,
    exempt: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
    note: noteSchema,
  })
  .strict();

const softDeleteBodySchema = z
  .object({
    userIds: userIdsSchema,
    reason: reasonSchema,
  })
  .strict();

const hardDeleteBodySchema = z
  .object({
    userIds: userIdsSchema,
    reason: reasonSchema,
  })
  .strict();

const configBodySchema = z
  .object({
    inactivityThresholdDays: z.coerce.number().int().min(1).max(3650).default(90),
    deletionGraceDays: z.coerce.number().int().min(0).max(3650).default(30),
    botScoreThreshold: z.coerce.number().int().min(0).max(100).default(40),
    botPowEnabled: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
    botPowEnforceSignup: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
    botPowEnforceLogin: z.preprocess((v) => toBoolLike(v) ?? false, z.boolean()).default(false),
    botPowChallengeScore: z.coerce.number().int().min(0).max(100).default(25),
    botPowBaseDifficulty: z.coerce.number().int().min(1).max(32).default(14),
    botPowMaxDifficulty: z.coerce.number().int().min(1).max(32).default(20),
    botPowTtlSec: z.coerce.number().int().min(10).max(3600).default(120),
    botValkeyEnabled: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
    activityAutoQueueInactive: z.preprocess((v) => toBoolLike(v) ?? true, z.boolean()).default(true),
    activityAutoSoftDelete: z.preprocess((v) => toBoolLike(v) ?? false, z.boolean()).default(false),
  })
  .strict();

adminActivityRouter.get("/config", async (_req, res) => {
  try {
    const config = await getActivityAdminConfig();
    const effective = await getActivityEffectiveState();
    return res.json({ ...config, effective });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

adminActivityRouter.get("/config/effective", async (_req, res) => {
  try {
    const effective = await getActivityEffectiveState();
    return res.json({ ok: true, ...effective });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get effective config." });
  }
});

adminActivityRouter.put("/config", async (req, res) => {
  const parsed = configBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_CONFIG_PAYLOAD", parsed.error.issues);
  }

  try {
    const writePatch = buildActivityConfigWrite(parsed.data);

    await ensureSystemConfigRow();
    await db
      .update(systemConfig)
      .set({
        ...writePatch,
        updatedAt: Math.floor(Date.now() / 1000),
      } as any)
      .where(eq(systemConfig.id, 1));
    invalidateActivityAdminConfigCache();
    publishLiveEvent({
      type: "activity-config:updated",
      payload: {
        updatedAt: Math.floor(Date.now() / 1000),
        patchKeys: Object.keys(writePatch),
      },
    });
    const config = await getActivityAdminConfig();
    const effective = await getActivityEffectiveState();
    return res.json({ ok: true, config, effective });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to set config." });
  }
});

adminActivityRouter.get("/users", async (req, res) => {
  const parsed = usersQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_QUERY", parsed.error.issues);
  }

  try {
    const { days, inactiveOnly, botsOnly, includeDeleted, limit } = parsed.data;

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
  if (!enforceActivityRateLimit(req, res, "sweep")) return;
  const parsed = sweepBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const dryRun = parsed.data.dryRun;
    const actorAdminId = getActorAdminId(req);
    const out = await runInactivitySweep({ dryRun, actorAdminId });
    return res.json(out);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to run sweep." });
  }
});

adminActivityRouter.post("/queue", async (req, res) => {
  if (!enforceActivityRateLimit(req, res, "mutation")) return;
  const parsed = queueBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const { userIds, reason, note } = parsed.data;
    const actorAdminId = getActorAdminId(req);
    const out = await enqueueForDeletion({ userIds, reason, note, actorAdminId });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to queue deletion." });
  }
});

adminActivityRouter.post("/cancel", async (req, res) => {
  if (!enforceActivityRateLimit(req, res, "mutation")) return;
  const parsed = cancelBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const { userIds, note } = parsed.data;
    const actorAdminId = getActorAdminId(req);
    const out = await cancelDeletionQueue({ userIds, actorAdminId, note });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to cancel queue." });
  }
});

adminActivityRouter.post("/exempt", async (req, res) => {
  if (!enforceActivityRateLimit(req, res, "mutation")) return;
  const parsed = exemptBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const { userIds, exempt, note } = parsed.data;
    const actorAdminId = getActorAdminId(req);
    const out = await setDeletionExempt({ userIds, exempt, actorAdminId, note });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to update exemption." });
  }
});

adminActivityRouter.post("/soft-delete", async (req, res) => {
  if (!enforceActivityRateLimit(req, res, "mutation")) return;
  const parsed = softDeleteBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const { userIds, reason } = parsed.data;
    const actorAdminId = getActorAdminId(req);
    const out = await softDeleteUsers({ userIds, actorAdminId, reason: reason ?? "admin-soft-delete" });
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

  if (!enforceActivityRateLimit(req, res, "mutation")) return;
  const parsed = hardDeleteBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return badRequest(res, "INVALID_PAYLOAD", parsed.error.issues);
  }

  try {
    const { userIds, reason } = parsed.data;
    const actorAdminId = getActorAdminId(req);
    const out = await hardDeleteUsers({ userIds, actorAdminId, reason: reason ?? "admin-hard-delete" });
    return res.json({ ok: true, ...out });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to hard delete." });
  }
});
