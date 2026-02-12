import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { getCommunicationSettings, listNotificationsForUser, markNotificationsReadForUser } from "../services/messaging";

const markReadSchema = z
  .object({
    ids: z.array(z.number().int().positive()).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.all || (Array.isArray(data.ids) && data.ids.length > 0), {
    message: "Either ids or all=true is required",
    path: ["ids"],
  });

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(n)));
}

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  const userId = Number(req.session.userId);
  const limit = parsePositiveInt(req.query.limit, 30, 100);

  try {
    const payload = await listNotificationsForUser(userId, limit);
    return res.json(payload);
  } catch (error) {
    console.error("[notifications] list failed", error);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

notificationsRouter.get("/config", async (_req, res) => {
  try {
    const settings = await getCommunicationSettings();
    return res.json({
      notificationsEnabled: settings.notificationsEnabled,
      notificationRealtimeEnabled: settings.notificationRealtimeEnabled,
      notificationSoundDefaultEnabled: settings.notificationSoundDefaultEnabled,
      notificationE2eeEnabled: settings.notificationE2eeEnabled,
      notificationE2eeRequired: settings.notificationE2eeRequired,
      notificationTradePendingFillEnabled: settings.notificationTradePendingFillEnabled,
      notificationTradeTakeProfitEnabled: settings.notificationTradeTakeProfitEnabled,
      notificationTradeStopLossEnabled: settings.notificationTradeStopLossEnabled,
      notificationTradeMaxHoldEnabled: settings.notificationTradeMaxHoldEnabled,
      notificationAccountFreezeEnabled: settings.notificationAccountFreezeEnabled,
      notificationAccountUnfreezeEnabled: settings.notificationAccountUnfreezeEnabled,
      notificationKycUpdatesEnabled: settings.notificationKycUpdatesEnabled,
      notificationChallengeEnabled: settings.notificationChallengeEnabled,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error("[notifications] config fetch failed", error);
    return res.status(500).json({ message: "Failed to fetch notification config" });
  }
});

notificationsRouter.post("/mark-read", async (req, res) => {
  const userId = Number(req.session.userId);
  const parsed = markReadSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid payload",
      issues: parsed.error.flatten(),
    });
  }

  try {
    const result = await markNotificationsReadForUser({
      userId,
      ids: parsed.data.ids,
      markAll: Boolean(parsed.data.all),
    });

    return res.json({ ok: true, updated: result.updated });
  } catch (error) {
    console.error("[notifications] mark-read failed", error);
    return res.status(500).json({ message: "Failed to mark notifications as read" });
  }
});
