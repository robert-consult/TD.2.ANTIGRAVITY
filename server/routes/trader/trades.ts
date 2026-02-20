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

export function registerTradesRoutes(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
router.get("/api/trades", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getTradesByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get trades error:", error);
    res.status(500).json({ message: "Failed to fetch trades" });
  }
});

router.get("/api/trades/history", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getTradeHistoryByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get trade history error:", error);
    res.status(500).json({ message: "Failed to fetch trade history" });
  }
});

router.get("/api/trades/open", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getOpenTradesByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get open trades error:", error);
    res.status(500).json({ message: "Failed to fetch open trades" });
  }
});
router.get("/api/trades/pending", async (req: Request, res: Response) => {
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
}
