import type { Express, Request, Response } from "express";
import type { SessionData } from "express-session";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { systemConfig } from "@shared/schema";
import { storage } from "../../storage";
import type { TraderCoreDeps } from "./shared";

export function registerTraderPrimaryReadRoutes(app: Express, deps: TraderCoreDeps) {
  const { ensureAuth } = deps;

  app.get("/api/trades", ensureAuth, async (req: Request, res: Response) => {
    try {
      const trades = await storage.getTradesByUserId(req.session.userId!);
      res.json(trades);
    } catch (error) {
      console.error("Get trades error:", error);
      res.status(500).json({ message: "Failed to fetch trades" });
    }
  });

  app.get("/api/trades/history", ensureAuth, async (req: Request, res: Response) => {
    try {
      const trades = await storage.getTradeHistoryByUserId(req.session.userId!);
      res.json(trades);
    } catch (error) {
      console.error("Get trade history error:", error);
      res.status(500).json({ message: "Failed to fetch trade history" });
    }
  });

  app.get("/api/trades/open", ensureAuth, async (req: Request, res: Response) => {
    try {
      const trades = await storage.getOpenTradesByUserId(req.session.userId!);
      res.json(trades);
    } catch (error) {
      console.error("Get open trades error:", error);
      res.status(500).json({ message: "Failed to fetch open trades" });
    }
  });
}

export function registerTraderSecondaryReadRoutes(app: Express) {
  app.get("/api/trades/pending", async (req: Request, res: Response) => {
    try {
      const session = req.session as SessionData;
      if (!session.userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const pendingTrades = await storage.getPendingTradesByUserId(session.userId);
      res.json(pendingTrades);
    } catch (error) {
      console.error("Error fetching pending trades:", error);
      res.status(500).json({ message: "Failed to fetch pending trades" });
    }
  });

  app.get("/api/leaderboard", async (_req: Request, res: Response) => {
    try {
      const [cfg] = await db
        .select({ leaderboardMode: systemConfig.leaderboardMode })
        .from(systemConfig)
        .where(eq(systemConfig.id, 1))
        .limit(1);

      const modeRaw = String(cfg?.leaderboardMode || "PUBLIC").toUpperCase();
      const mode = modeRaw === "TOP_10" || modeRaw === "DISABLED" ? modeRaw : "PUBLIC";

      if (mode === "DISABLED") {
        return res.json([]);
      }

      const limit = mode === "TOP_10" ? 10 : 100;
      const leaderboard = await storage.getLeaderboard(limit);
      res.json(leaderboard);
    } catch (error) {
      console.error("Get leaderboard error:", error);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });
}
