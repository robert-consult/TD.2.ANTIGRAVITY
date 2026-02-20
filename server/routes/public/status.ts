import type { Request, Response, Router } from "express";

export function registerStatusRoute(router: Router) {
  // API status endpoint - moved from root to not conflict with frontend
  router.get("/status", (_req: Request, res: Response) => {
    res.json({ message: "TradeQuip API" });
  });
}
