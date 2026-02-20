import type { Request, Response, Router } from "express";
import { storage } from "../../storage";

export function registerSymbolsRoute(router: Router) {
  // Symbol configuration endpoint
  router.get("/config/symbols", async (req: Request, res: Response) => {
    try {
      const symbols = await storage.getSymbolConfigs();
      res.json(symbols);
    } catch (error) {
      console.error("Get symbols error:", error);
      res.status(500).json({ message: "Failed to fetch symbols" });
    }
  });
}
