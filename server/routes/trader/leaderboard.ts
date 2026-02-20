// @ts-nocheck
import type { Router, NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { insertTradeSchema, systemConfig, trades, users } from "@shared/schema";
import { getPipSize, getQuoteDecimals } from "@shared/pips";
import type { AuditContext as GriftAuditContext } from "../../grift/griftTypes";
import { storage } from "../../storage";
import { riskMiddleware, getEffectiveMinHoldSec } from "../../risk";
import { requirePolicy } from "../../middleware/requirePolicy";
import { recalcAccount } from "../../recalcAccount";
import { requiredMargin } from "../../lib/margin";
import { getExecutionQuote } from "../../services/quoteService";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "../../services/tradeAtomic";
import { realizedPnlUsd } from "../../lib/realizedPnl";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "../../services/tradeCosts";
import { clearTradeExcursion, initTradeExcursion, resolveTradeExcursionForClose } from "../../trades/excursionTracking";
import { buildAuditContext, type AuditContext } from "../../lib/auditContext";
import {
  calculateSlippagePips,
  calculateSpreadPips,
  generateCorrelationId,
  generateExecutionId,
  generateOrderId,
  generatePositionId,
  writeOrderIntentAudit,
  writeTradeAudit,
} from "../../lib/auditWriter";
import { getActiveTradeConstraintsForUser } from "../../recruitment/challengesV4/challengeService";
import {
  getGlobalSettingsCached,
  getMinPriceDistancePips,
  sanitizeMinPriceDistancePips,
} from "../../services/globalSettings";
import { botGuard } from "../../security/botGuard";
import { isPostgres } from "@db/config";
import { extractGriftContext } from "../../grift/griftGeo";
import { withGriftClient } from "../../grift/griftDb";
import { maybeApplyAutoEnforcement } from "../../grift/griftAutoEnforcement";
import { onSessionActivity, onTradeSubmit } from "../../grift/griftEngine";
import {
  priceGreaterThan,
  priceGreaterThanOrEqual,
  priceLessThan,
  priceLessThanOrEqual,
  ticksToPrice,
  toTicks,
} from "../../lib/priceUtils";
import { WS_MSG_TRADES_UPDATED } from "@shared/ws/protocol";
import {
  incTradeCloseRejectedQuoteStaleTotal,
  incTradeTargetsRejectedQuoteStaleTotal,
} from "../metricsState";
import type { TraderRouterDeps } from "./types";

export function registerLeaderboardRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
router.get("/api/leaderboard", async (req: Request, res: Response) => {
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
