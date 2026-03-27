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
import { recordBusinessFlowStep, recordOperationFailure } from "../../observability/business";
import type { TraderRouterDeps } from "./types";

export function registerTradeCancelRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
  router.patch(
  "/api/trades/:id/cancel",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy("TRADE_CANCEL_PENDING"),
  async (req: Request, res: Response, next: NextFunction) => {
    const sessionUserId = Number((req.session as SessionData).userId);
    const bg = await botGuard(req, res, {
      action: "TRADE",
      userId: Number.isInteger(sessionUserId) && sessionUserId > 0 ? sessionUserId : undefined,
    });
    if (!bg.allowed) return;
    next();
  },
  async (req: Request, res: Response) => {
    const startedAtMs = Date.now();
    recordBusinessFlowStep({ flow: "trade_lifecycle", step: "cancel", outcome: "attempt" });
    try {
      const session = req.session as SessionData;
      const userId = Number(session.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        recordOperationFailure({
          operation: "trade.cancel",
          reason: "not_authenticated",
          flow: "trade_lifecycle",
          step: "cancel",
          startedAtMs,
        });
        return res.status(401).json({ message: "Not authenticated" });
      }

      const tradeIdRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const tradeId = Number.parseInt(String(tradeIdRaw ?? ""), 10);
      if (Number.isNaN(tradeId)) {
        recordOperationFailure({
          operation: "trade.cancel",
          reason: "invalid_trade_id",
          flow: "trade_lifecycle",
          step: "cancel",
          startedAtMs,
        });
        return res.status(400).json({ message: "Invalid trade ID" });
      }
      const trade = await storage.getTradeById(tradeId);

      if (!trade) {
        recordOperationFailure({
          operation: "trade.cancel",
          reason: "trade_not_found",
          flow: "trade_lifecycle",
          step: "cancel",
          startedAtMs,
        });
        return res.status(404).json({ message: "Trade not found" });
      }

      if (trade.userId !== userId) {
        recordOperationFailure({
          operation: "trade.cancel",
          reason: "not_authorized",
          flow: "trade_lifecycle",
          step: "cancel",
          startedAtMs,
        });
        return res.status(403).json({ message: "Not authorized" });
      }

      if (trade.status !== "PENDING") {
        recordOperationFailure({
          operation: "trade.cancel",
          reason: "trade_not_pending",
          flow: "trade_lifecycle",
          step: "cancel",
          startedAtMs,
        });
        return res.status(400).json({ message: "Trade is not pending" });
      }

      // Build audit context
      const cancelAuditCtx = buildAuditContext(req);
      const correlationId = trade.correlationId || generateCorrelationId();
      const orderId = trade.orderId || generateOrderId();
      const positionId = trade.positionId || generatePositionId();

      await db.update(trades)
        .set({
          correlationId,
          orderId,
          positionId,
          lastActorUserId: userId,
          lastActorSessionId: cancelAuditCtx.sessionId,
          lastActorIp: cancelAuditCtx.ip,
          lastActorUserAgent: cancelAuditCtx.userAgent,
          lastActorType: cancelAuditCtx.actorType,
        })
        .where(eq(trades.id, tradeId));

      cancelAuditCtx.correlationId = correlationId;

      const symbol = trade.symbol?.symbol ?? null;
      let q = null;
      if (symbol) {
        try {
          q = await getExecutionQuote(symbol, trade.type as "BUY" | "SELL", "OPEN");
        } catch { }
      }

      const canceledTrade = await storage.cancelTrade(tradeId);
      if (canceledTrade) {
        clearTradeExcursion(tradeId);
      }

      // AUDIT: Write ORDER_CANCELED with full provenance
      if (canceledTrade) {
        try {
          await writeTradeAudit({
            tradeId,
            eventType: "ORDER_CANCELED",
            eventCategory: "TRADE",
            ctx: cancelAuditCtx,
            orderId,
            positionId,
            symbol,
            side: trade.type as string,
            orderType: trade.orderType as string,
            timeInForce: trade.timeInForce ? String(trade.timeInForce) : null,
            qtyLots: typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1),
            limitPrice: trade.limitPrice ? parseFloat(String(trade.limitPrice)) : null,
            stopPrice: trade.stopPrice ? parseFloat(String(trade.stopPrice)) : null,
            quoteBid: q?.bid ?? null,
            quoteAsk: q?.ask ?? null,
            quoteMid: q?.mid ?? null,
            quoteSpread: q?.spread ?? null,
            spreadPips: q ? calculateSpreadPips(symbol || "", q.spread, trade.symbol?.pipDecimals) : null,
            quoteTs: q?.quoteTs ?? null,
            quoteSource: q?.source ?? null,
            reasonCode: "CANCELED_BY_USER",
            note: `User canceled pending ${trade.orderType} order`,
            payload: { originalOrderType: trade.orderType },
          });
        } catch (auditErr) {
          console.error("Error writing ORDER_CANCELED audit:", auditErr);
        }
      }

      // Notify ALL browser sessions for this user that trades changed (multi-device sync)
      const targetUserId = userId;
      broadcast(
        { type: WS_MSG_TRADES_UPDATED, userId: targetUserId },
        (client) => client.userId === targetUserId || client.userId === undefined
      );

      // Grift detection: record cancel activity (supports churn/concurrency + identity linking)
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "TRADE_CANCEL_PENDING",
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

            await onSessionActivity(griftDb, griftAuditCtx);

            try {
              await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
            } catch (enfErr) {
              console.error("[Grift] Auto-enforcement failed (trade cancel):", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("Error in grift detection on trade cancel:", griftErr);
        }
      }

      recordBusinessFlowStep({
        flow: "trade_lifecycle",
        step: "cancel",
        outcome: "success",
        startedAtMs,
      });
      res.json(canceledTrade);
    } catch (error) {
      console.error("Error canceling trade:", error);
      recordOperationFailure({
        operation: "trade.cancel",
        reason: "failed_to_cancel_trade",
        flow: "trade_lifecycle",
        step: "cancel",
        startedAtMs,
      });
      res.status(500).json({ message: "Failed to cancel trade" });
    }
  });

}
