import type { Request, Response, Router } from "express";
import { buildPublicGlobalSettingsPayload } from "./globalSettingsPayload";

export function registerGlobalSettingsRoute(router: Router) {
  // Public global settings endpoint (returns lot settings for order form)
  router.get("/global-settings", async (_req: Request, res: Response) => {
    try {
      res.json(await buildPublicGlobalSettingsPayload());
    } catch (error: any) {
      console.error("[GlobalSettings] Failed to fetch:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });
}
