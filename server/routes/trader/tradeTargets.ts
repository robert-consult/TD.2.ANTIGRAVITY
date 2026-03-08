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

export function registerTradeTargetsRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
router.patch(
  "/api/trades/:id/targets",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy("TRADE_MODIFY_SLTP"),
  async (req: Request, res: Response, next: NextFunction) => {
    const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
    if (!bg.allowed) return;
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const session = req.session as SessionData;

      const tradeIdRaw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const tradeId = parseInt(tradeIdRaw, 10);
      const { takeProfit, stopLoss } = req.body;
      const tpNext =
        takeProfit === null || takeProfit === undefined || takeProfit === ""
          ? null
          : Number(takeProfit);
      const slNext =
        stopLoss === null || stopLoss === undefined || stopLoss === ""
          ? null
          : Number(stopLoss);

      if (tpNext !== null && !Number.isFinite(tpNext)) {
        return res.status(400).json({ code: "TAKE_PROFIT_INVALID", message: "Invalid takeProfit value" });
      }
      if (slNext !== null && !Number.isFinite(slNext)) {
        return res.status(400).json({ code: "STOP_LOSS_INVALID", message: "Invalid stopLoss value" });
      }

      const trade = await storage.getTradeById(tradeId);
      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }

      if (trade.userId !== session.userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (trade.status !== "OPEN" && trade.status !== "PENDING") {
        return res.status(400).json({ message: "Trade is not open or pending" });
      }

      // Store previous values for audit
      const prevTp = trade.takeProfit ? parseFloat(String(trade.takeProfit)) : null;
      const prevSl = trade.stopLoss ? parseFloat(String(trade.stopLoss)) : null;

      // Server-side TP/SL validation using authoritative prices.
      // For PENDING orders, validate relative to intended entry; for OPEN positions, validate relative to the current close-side price (BUY=bid, SELL=ask).
      let symbolConfig = trade.symbol ?? null;
      if (!symbolConfig) symbolConfig = (await storage.getSymbolConfigById(trade.symbolId)) ?? null;
      const symbol = symbolConfig?.symbol ? String(symbolConfig.symbol) : null;

      if (!symbol) {
        return res.status(404).json({ message: "Symbol configuration not found" });
      }

      const side = String(trade.type ?? "").toUpperCase() as "BUY" | "SELL";
      const pipSize = getPipSize({
        symbol,
        category: symbolConfig?.category,
        quoteCurrency: symbolConfig?.quoteCurrency,
        pipDecimals: symbolConfig?.pipDecimals,
        quoteDecimals: symbolConfig?.quoteDecimals,
      });
      const priceDecimals = getQuoteDecimals({
        symbol,
        category: symbolConfig?.category,
        quoteCurrency: symbolConfig?.quoteCurrency,
        pipDecimals: symbolConfig?.pipDecimals,
        quoteDecimals: symbolConfig?.quoteDecimals,
      });
      const minPips = await getMinPriceDistancePips();
      const minDist = minPips * pipSize;

      let refPrice: number | null = null;
      let q: any | null = null;

      if (trade.status === "PENDING") {
        const ot = String((trade as any).orderType ?? "").trim().toUpperCase();
        const intendedEntryRaw =
          ot === "LIMIT"
            ? (trade as any).limitPrice
            : ot === "STOP"
              ? (trade as any).stopPrice
              : (trade as any).limitPrice ?? (trade as any).stopPrice ?? (trade as any).openPrice;
        const intendedEntry = intendedEntryRaw == null ? null : Number(intendedEntryRaw);
        if (intendedEntry !== null && Number.isFinite(intendedEntry)) {
          refPrice = intendedEntry;
        }
        if (refPrice === null) {
          return res.status(400).json({
            code: "ORDER_PRICE_MISSING",
            message: "Cannot update targets: pending order has no valid reference price.",
            symbol,
          });
        }
      } else if (trade.status === "OPEN") {
        try {
          q = await getExecutionQuote(symbol, side, "CLOSE");
        } catch {
          return res.status(503).json({
            code: "QUOTE_UNAVAILABLE",
            message: "Live price unavailable. Try again shortly.",
            symbol,
          });
        }

        // Only enforce stale-quote blocking while the market is open.
        if (q.marketOpen && q.isStale) {
          const quoteAgeMs = Math.max(0, Date.now() - q.quoteTs.getTime());
          const targetsAuditCtx = buildAuditContext(req);
          const correlationId = (trade as any).correlationId || generateCorrelationId();
          const orderId = (trade as any).orderId || generateOrderId();
          const positionId = (trade as any).positionId || generatePositionId();

          targetsAuditCtx.correlationId = correlationId;

          incTradeTargetsRejectedQuoteStaleTotal();

          try {
            await db.update(trades)
              .set({
                correlationId,
                orderId,
                positionId,
                lastActorUserId: session.userId,
                lastActorSessionId: targetsAuditCtx.sessionId,
                lastActorIp: targetsAuditCtx.ip,
                lastActorUserAgent: targetsAuditCtx.userAgent,
                lastActorType: targetsAuditCtx.actorType,
              })
              .where(eq(trades.id, tradeId));

            await writeTradeAudit({
              tradeId,
              eventType: "TARGETS_UPDATE_REJECTED",
              eventCategory: "MODIFICATION",
              ctx: targetsAuditCtx,
              orderId,
              positionId,
              symbol,
              side: trade.type as string,
              stopPrice: slNext,
              limitPrice: tpNext,
              quoteBid: q.bid,
              quoteAsk: q.ask,
              quoteMid: q.mid,
              quoteSpread: q.spread,
              spreadPips: calculateSpreadPips(symbol, q.spread, symbolConfig?.pipDecimals),
              quoteTs: q.quoteTs,
              quoteSource: `stale:${q.source}`,
              riskResult: "REJECT",
              reasonCode: "QUOTE_STALE",
              note: `Rejected targets update due to stale quote (ageMs=${quoteAgeMs})`,
              payload: { quoteAgeMs, previousTakeProfit: prevTp, previousStopLoss: prevSl, newTakeProfit: tpNext, newStopLoss: slNext },
            });
          } catch (auditErr) {
            console.error("Error writing TARGETS_UPDATE_REJECTED audit:", auditErr);
          }

          res.setHeader("Retry-After", "1");
          return res.status(409).json({
            code: "QUOTE_STALE_MODIFY",
            message: `Cannot update targets: quote data for ${symbol} is stale. Please wait for fresh market data.`,
            symbol,
            quoteTs: Math.floor(q.quoteTs.getTime() / 1000),
            quoteAgeMs,
          });
        }

        refPrice = q.execPrice;
      }

      if (refPrice !== null && Number.isFinite(refPrice)) {
        if (side === "BUY") {
          if (slNext !== null && priceGreaterThan(slNext, refPrice - minDist, priceDecimals)) {
            return res.status(400).json({
              code: "STOP_LOSS_TOO_CLOSE",
              message: `BUY SL must be at least ${minPips} pips below reference price. Maximum: ${(refPrice - minDist).toFixed(priceDecimals)}`,
              symbol,
              minPips,
              minPoints: minPips,
            });
          }
          if (tpNext !== null && priceLessThan(tpNext, refPrice + minDist, priceDecimals)) {
            return res.status(400).json({
              code: "TAKE_PROFIT_TOO_CLOSE",
              message: `BUY TP must be at least ${minPips} pips above reference price. Minimum: ${(refPrice + minDist).toFixed(priceDecimals)}`,
              symbol,
              minPips,
              minPoints: minPips,
            });
          }
        } else if (side === "SELL") {
          if (slNext !== null && priceLessThan(slNext, refPrice + minDist, priceDecimals)) {
            return res.status(400).json({
              code: "STOP_LOSS_TOO_CLOSE",
              message: `SELL SL must be at least ${minPips} pips above reference price. Minimum: ${(refPrice + minDist).toFixed(priceDecimals)}`,
              symbol,
              minPips,
              minPoints: minPips,
            });
          }
          if (tpNext !== null && priceGreaterThan(tpNext, refPrice - minDist, priceDecimals)) {
            return res.status(400).json({
              code: "TAKE_PROFIT_TOO_CLOSE",
              message: `SELL TP must be at least ${minPips} pips below reference price. Maximum: ${(refPrice - minDist).toFixed(priceDecimals)}`,
              symbol,
              minPips,
              minPoints: minPips,
            });
          }
        }
      }

      const updatedTrade = await storage.updateTradeTargets(tradeId, tpNext, slNext);
      if (!updatedTrade) {
        return res.status(409).json({ message: "Trade is no longer open or pending" });
      }

      // AUDIT: Write TARGETS_UPDATED event
      try {
        const targetsAuditCtx = buildAuditContext(req);
        const correlationId = (trade as any).correlationId || generateCorrelationId();
        const orderId = (trade as any).orderId || generateOrderId();
        const positionId = (trade as any).positionId || generatePositionId();

        await db.update(trades)
          .set({
            correlationId,
            orderId,
            positionId,
            lastActorUserId: session.userId,
            lastActorSessionId: targetsAuditCtx.sessionId,
            lastActorIp: targetsAuditCtx.ip,
            lastActorUserAgent: targetsAuditCtx.userAgent,
            lastActorType: targetsAuditCtx.actorType,
          })
          .where(eq(trades.id, tradeId));

        targetsAuditCtx.correlationId = correlationId;

        const symbolForAudit = symbol;
        let q = null;
        if (symbolForAudit) {
          try {
            q = await getExecutionQuote(symbolForAudit, trade.type as "BUY" | "SELL", "CLOSE");
          } catch { }
        }

        await writeTradeAudit({
          tradeId,
          eventType: "TARGETS_UPDATED",
          eventCategory: "MODIFICATION",
          ctx: targetsAuditCtx,
          orderId,
          positionId,
          symbol: symbolForAudit,
          side: trade.type as string,
          stopPrice: slNext,
          quoteBid: q?.bid ?? null,
          quoteAsk: q?.ask ?? null,
          quoteMid: q?.mid ?? null,
          quoteSpread: q?.spread ?? null,
          spreadPips: q ? calculateSpreadPips(symbolForAudit || "", q.spread, symbolConfig?.pipDecimals) : null,
          quoteTs: q?.quoteTs ?? null,
          quoteSource: q?.source ?? null,
          note: `TP: ${prevTp ?? 'none'} → ${tpNext ?? 'none'}, SL: ${prevSl ?? 'none'} → ${slNext ?? 'none'}`,
          payload: {
            previousTakeProfit: prevTp,
            previousStopLoss: prevSl,
            newTakeProfit: tpNext,
            newStopLoss: slNext,
          },
        });
      } catch (auditErr) {
        console.error("Error writing TARGETS_UPDATED audit:", auditErr);
      }

      // Notify ALL browser sessions for this user that trades changed (multi-device sync)
      const targetUserId = session.userId;
      broadcast(
        { type: WS_MSG_TRADES_UPDATED, userId: targetUserId },
        (client) => client.userId === targetUserId || client.userId === undefined
      );

      // Grift detection: record modification activity (supports churn/concurrency + identity linking)
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId: session.userId,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "TRADE_TARGETS_UPDATE",
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
              console.error("[Grift] Auto-enforcement failed (trade targets update):", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("Error in grift detection on trade targets update:", griftErr);
        }
      }

      res.json(updatedTrade);
    } catch (error) {
      console.error("Error updating trade targets:", error);
      res.status(500).json({ message: "Failed to update trade targets" });
    }
  });

}
