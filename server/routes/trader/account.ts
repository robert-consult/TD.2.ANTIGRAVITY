// @ts-nocheck
import type { Router, Request, Response } from "express";
import type { TraderRouterDeps } from "./types";

export function registerAccountSummaryRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth } = deps;

  // Real-time account summary endpoint - returns fresh MT5-style metrics
  router.get("/api/account/summary", ensureAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId;

      // Import and run recalcAccount to get fresh metrics with stale detection
      const { recalcAccount } = await import("../../recalcAccount");
      const metrics = await recalcAccount(userId);

      if (!metrics) {
        return res.status(404).json({ message: "User not found" });
      }

      // Return MT5-style account summary with stale pricing indicators
      res.json({
        startingBalance: metrics.startingBalance,
        balance: metrics.balance,
        equity: metrics.equity,
        floatingPnl: metrics.floatingPnl,
        usedMargin: metrics.usedMargin,
        freeMargin: metrics.freeMargin,
        marginLevel: metrics.marginLevel, // null when no margin used (not 0)
        openPositions: metrics.openPositions,
        pricingStale: metrics.pricingStale,
        staleSymbols: metrics.staleSymbols,
        asOf: metrics.asOf.toISOString(),
      });
    } catch (error) {
      console.error("Get account summary error:", error);
      res.status(500).json({ message: "Failed to get account summary" });
    }
  });
}
