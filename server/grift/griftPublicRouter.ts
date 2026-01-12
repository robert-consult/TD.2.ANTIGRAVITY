// server/grift/griftPublicRouter.ts
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth";
import { extractGriftContext } from "./griftGeo";
import { onSessionActivity } from "./griftEngine";
import { maybeApplyAutoEnforcement } from "./griftAutoEnforcement";
import type { AuditContext } from "./griftTypes";
import { withGriftClient } from "./griftDb";

export const griftPublicRouter = Router();

griftPublicRouter.post("/ping", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const now = Date.now();

    const griftCtx = extractGriftContext(req);

    const auditCtx: AuditContext = {
      ts: now,
      userId,
      sessionId: griftCtx.sessionId ?? undefined,
      deviceId: griftCtx.deviceId ?? undefined,
      deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
      deviceFp: griftCtx.deviceFp ?? undefined,
      deviceInstallId: griftCtx.deviceInstallId ?? undefined,
      clientTz: griftCtx.clientTz ?? undefined,
      clientLang: griftCtx.clientLang ?? undefined,
      eventType: "SESSION_PING",
      ip: griftCtx.ip ?? undefined,
      userAgent: griftCtx.userAgent ?? undefined,
      geoCountry: griftCtx.geoCountry ?? undefined,
      geoRegion: griftCtx.geoRegion ?? undefined,
      geoCity: griftCtx.geoCity ?? undefined,
      latitude: griftCtx.latitude ?? undefined,
      longitude: griftCtx.longitude ?? undefined,
      asn: griftCtx.asn ?? undefined,
      org: griftCtx.org ?? undefined,
    };

    await withGriftClient(async (db) => {
      await onSessionActivity(db, auditCtx);

      try {
        await maybeApplyAutoEnforcement(db, auditCtx);
      } catch (enfErr) {
        console.error("[Grift] Auto-enforcement failed (ping):", enfErr);
      }
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[Grift] Ping error:", error);
    res.status(500).json({ message: "Failed to record session ping" });
  }
});
