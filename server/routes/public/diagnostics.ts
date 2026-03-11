import type { Request, Response, Router } from "express";
import { buildPriceFeedDiagnostics } from "../../services/priceFeedDiagnostics";

export function registerDiagnosticsRoute(router: Router) {
  // API diagnostic endpoint for active provider health and quote cache state.
  router.get("/diagnostics/price-feed", async (_req: Request, res: Response) => {
    try {
      res.json(await buildPriceFeedDiagnostics());
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
