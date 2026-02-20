import type { Request, Response, Router } from "express";
import { desc } from "drizzle-orm";
import { db } from "@db";
import { quotes } from "@shared/schema";

export function registerDiagnosticsRoute(router: Router) {
  // API diagnostic endpoint - check 1Forge API status and cache state
  router.get("/diagnostics/price-feed", async (_req: Request, res: Response) => {
    try {
      const forgeKeyPresent = Boolean(process.env.FORGE_KEY);
      const forgeKeyLength = process.env.FORGE_KEY?.length || 0;

      // Try to get cache stats from quote feed module
      let cacheStats = { cacheSize: 0, lastSuccessfulApiCall: 0, consecutiveApiFailures: 0, staleCount: 0 };
      try {
        const { getCacheStats } = await import("../../feeds/quoteFeed");
        cacheStats = getCacheStats();
      } catch (e) {
        console.error("Error getting cache stats:", e);
      }

      // Get current quotes from database
      let quotesInfo = { count: 0, latestUpdate: null as number | null, symbols: [] as string[] };

      try {
        const quoteRows = await db
          .select({
            symbol: quotes.symbol,
            updatedAt: quotes.updatedAt,
          })
          .from(quotes)
          .orderBy(desc(quotes.updatedAt));

        quotesInfo = {
          count: quoteRows.length,
          latestUpdate: quoteRows[0]?.updatedAt ?? null,
          symbols: quoteRows.map((q) => q.symbol),
        };
      } catch (e) {
        console.error("Error getting quotes info:", e);
      }

      // Calculate time since last API update
      const now = Date.now();
      const timeSinceLastUpdate =
        cacheStats.lastSuccessfulApiCall > 0
          ? Math.round((now - cacheStats.lastSuccessfulApiCall) / 1000)
          : null;

      res.json({
        status: forgeKeyPresent ? "configured" : "missing_api_key",
        apiKeyPresent: forgeKeyPresent,
        apiKeyLength: forgeKeyLength,
        environment: process.env.NODE_ENV || "development",
        cache: {
          ...cacheStats,
          timeSinceLastUpdateSeconds: timeSinceLastUpdate,
        },
        database: quotesInfo,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({
        status: "error",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
