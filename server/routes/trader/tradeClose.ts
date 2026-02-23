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
import { getExecutionQuote, validateExecutionQuoteAtCommit } from "../../services/quoteService";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "../../services/tradeAtomic";
import { realizedPnlUsd } from "../../lib/realizedPnl";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "../../services/tradeCosts";
import { clearTradeExcursion, initTradeExcursion, resolveTradeExcursionForCloseDurable } from "../../trades/excursionTracking";
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
  incTradeCloseRejectedQuoteRevalidationTotal,
  incTradeTargetsRejectedQuoteStaleTotal,
} from "../metricsState";
import type { TraderRouterDeps } from "./types";

export function registerTradeCloseRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
router.post(
  "/api/trades/:id/close",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy("TRADE_CLOSE_OR_REDUCE"),
  async (req: Request, res: Response, next: NextFunction) => {
    const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
    if (!bg.allowed) return;
    next();
  },
  async (req: Request, res: Response) => {
    const tradeId = parseInt(req.params.id);
    if (isNaN(tradeId)) {
      return res.status(400).json({ message: "Invalid trade ID" });
    }

    try {
      // Get the trade
      const trade = await storage.getTradeById(tradeId);

      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }

      if (trade.userId !== req.session.userId) {
        return res.status(403).json({ message: "Not authorized to close this trade" });
      }

      if (trade.status === "CLOSED") {
        return res.status(400).json({ message: "Trade is already closed" });
      }

      // Check minimum hold time enforcement
      const minHoldSec = await getEffectiveMinHoldSec(req.session.userId);
      if (minHoldSec > 0 && trade.openedAt) {
        let openedAtMs: number;
        if (typeof trade.openedAt === 'number') {
          openedAtMs = trade.openedAt < 1e12 ? trade.openedAt * 1000 : trade.openedAt;
        } else {
          // Handle various string formats - add 'Z' if no timezone to ensure UTC parsing
          const dateStr = String(trade.openedAt);
          const normalizedStr = dateStr.includes('Z') || dateStr.includes('+') || dateStr.includes('-', 10)
            ? dateStr
            : dateStr.replace(' ', 'T') + 'Z';
          openedAtMs = new Date(normalizedStr).getTime();
        }

        // Guard against invalid dates
        if (!isNaN(openedAtMs)) {
          const holdDurationSec = (Date.now() - openedAtMs) / 1000;

          if (holdDurationSec < minHoldSec) {
            const remainingSec = Math.ceil(minHoldSec - holdDurationSec);
            return res.status(403).json({
              code: "MIN_HOLD_TIME",
              message: `Trade must be held for at least ${minHoldSec} seconds. ${remainingSec} seconds remaining.`,
              minHoldSec,
              holdDurationSec: Math.floor(holdDurationSec),
              remainingSec,
            });
          }
        }
      }

      // Get symbol config for the trade
      const symbolConfig = await storage.getSymbolConfigById(trade.symbolId);
      if (!symbolConfig) {
        return res.status(404).json({ message: "Symbol configuration not found" });
      }

      // Use server-authoritative quote service - NEVER accept client-supplied closePrice
      let q;
      try {
        q = await getExecutionQuote(symbolConfig.symbol, trade.type as "BUY" | "SELL", "CLOSE");
      } catch (quoteError) {
        return res.status(503).json({ message: "Live price unavailable. Try again shortly." });
      }

      // Reject if market is closed
      if (!q.marketOpen) {
        return res.status(409).json({ message: "Market is closed. Try again when market re-opens." });
      }

      // Institutional: Never execute manual closes on stale quotes. Require a fresh server-authoritative quote.
      if (q.isStale) {
        const quoteAgeMs = Math.max(0, Date.now() - q.quoteTs.getTime());
        const closeAuditCtx = buildAuditContext(req);
        const correlationId = (trade as any).correlationId || generateCorrelationId();
        const orderId = (trade as any).orderId || generateOrderId();
        const positionId = (trade as any).positionId || generatePositionId();

        closeAuditCtx.correlationId = correlationId;

        incTradeCloseRejectedQuoteStaleTotal();

        try {
          await db.update(trades)
            .set({
              correlationId,
              orderId,
              positionId,
              lastActorUserId: req.session.userId,
              lastActorSessionId: closeAuditCtx.sessionId,
              lastActorIp: closeAuditCtx.ip,
              lastActorUserAgent: closeAuditCtx.userAgent,
              lastActorType: closeAuditCtx.actorType,
            })
            .where(eq(trades.id, tradeId));

          await writeTradeAudit({
            tradeId,
            eventType: "POSITION_CLOSE_REJECTED",
            eventCategory: "TRADE",
            ctx: closeAuditCtx,
            orderId,
            positionId,
            symbol: q.symbol,
            side: trade.type as string,
            requestedPrice: q.execPrice,
            quoteBid: q.bid,
            quoteAsk: q.ask,
            quoteMid: q.mid,
            quoteSpread: q.spread,
            quoteTs: q.quoteTs,
            quoteSource: `stale:${q.source}`,
            riskResult: "REJECT",
            reasonCode: "QUOTE_STALE",
            note: `Rejected manual close due to stale quote (ageMs=${quoteAgeMs})`,
            payload: { quoteAgeMs },
          });
        } catch (auditErr) {
          console.error("Error writing POSITION_CLOSE_REJECTED audit:", auditErr);
        }

        res.setHeader("Retry-After", "1");
        return res.status(409).json({
          code: "QUOTE_STALE_CLOSE",
          message: `Cannot close trade: quote data for ${q.symbol} is stale. Please wait for fresh market data.`,
          symbol: q.symbol,
          quoteTs: Math.floor(q.quoteTs.getTime() / 1000),
          quoteAgeMs,
        });
      }

      const closePrice = q.execPrice;
      const openPrice = parseFloat(String(trade.openPrice));
      const lots = typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1);
      const excursion = await resolveTradeExcursionForCloseDurable({
        tradeId,
        side: trade.type as "BUY" | "SELL",
        openPrice,
        closePrice,
        intradayHigh: (trade as any).intradayHigh,
        intradayLow: (trade as any).intradayLow,
      });

      // Use proper P/L calculation that handles JPY and cross pairs correctly
      const pnlUsd = await realizedPnlUsd({
        symbol: q.symbol,
        side: trade.type as "BUY" | "SELL",
        lots,
        openPrice,
        closePrice,
      });
      const closeCostSummary = await computeCloseSettlementCosts({
        category: (trade as any).categorySnapshot ?? (trade as any).symbol?.category ?? (symbolConfig as any).category,
        positionSide: trade.type as "BUY" | "SELL",
        notionalUsd: (trade as any).notionalUsd,
        size: Number((trade as any).size ?? lots * 100000),
        lots,
        openedAt: trade.openedAt,
        executedAt: (trade as any).executedAt,
        closedAtMs: q.quoteTs.getTime(),
        openCommissionUsd: (trade as any).openCommissionUsd,
        openOtherFeesUsd: (trade as any).openOtherFeesUsd,
      });
      const grossProfitUsd = pnlUsd;
      const netProfitUsd = grossProfitUsd - closeCostSummary.totalCostsUsd;
      const closeSettlementUsd = grossProfitUsd - closeCostSummary.closingChargesUsd;

      // Build audit context for this close request
      const closeAuditCtx = buildAuditContext(req);
      const correlationId = (trade as any).correlationId || generateCorrelationId();
      const orderId = (trade as any).orderId || generateOrderId();
      const positionId = (trade as any).positionId || generatePositionId();
      const executionId = generateExecutionId();

      closeAuditCtx.correlationId = correlationId;

      const closeSource = q.isStale ? `stale:${q.source}` : q.source;
      const closeResult = await db.transaction(async (tx) => {
        const tradeLock = await tx.execute(sql`
          select id
          from trades
          where id = ${tradeId} and user_id = ${req.session.userId} and status = 'OPEN'
          for update
        `);
        if (!tradeLock.rows.length) return { action: "ALREADY_CLOSED" as const };

        const quoteRevalidation = await validateExecutionQuoteAtCommit({
          symbol: q.symbol,
          side: trade.type as "BUY" | "SELL",
          action: "CLOSE",
          expectedQuoteTs: q.quoteTs,
          expectedExecPrice: closePrice,
        });
        if (!quoteRevalidation.ok) {
          return { action: "QUOTE_REVALIDATION_FAILED" as const, quoteRevalidation };
        }

        const userRowRes = await tx.execute(sql`
          select id, leverage
          from users
          where id = ${req.session.userId}
          for update
        `);
        const leverageNow = Number((userRowRes.rows[0] as any)?.leverage ?? 5);
        const marginToRelease = requiredMargin(q.symbol, lots, closePrice, leverageNow);

        const closedRows = await tx.update(trades)
          .set({
            status: "CLOSED",
            closePrice,
            profit: netProfitUsd.toFixed(2),
            grossProfitUsd,
            netProfitUsd,
            intradayHigh: excursion.intradayHigh,
            intradayLow: excursion.intradayLow,
            mae: excursion.mae,
            mfe: excursion.mfe,
            notionalUsd: closeCostSummary.notionalUsd,
            totalCostsUsd: closeCostSummary.totalCostsUsd,
            closeCommissionUsd: closeCostSummary.closeCommissionUsd,
            closeOtherFeesUsd: closeCostSummary.closeOtherFeesUsd,
            financingAccruedUsd: closeCostSummary.financingAccruedUsd,
            swapAccruedUsd: closeCostSummary.swapAccruedUsd,
            overnightDays: closeCostSummary.overnightDays,
            categorySnapshot: closeCostSummary.categorySnapshot,
            costModelVersion: closeCostSummary.costModelVersion,
            closeReason: "MANUAL",
            closedAt: Math.floor(Date.now() / 1000),
            closeQuoteTs: Math.floor(q.quoteTs.getTime() / 1000),
            closeSource,
            closeBid: q.bid,
            closeAsk: q.ask,
            closeMid: q.mid,
            closeSpread: q.spread,
            correlationId,
            orderId,
            positionId,
            lastExecutionId: executionId,
            lastActorUserId: req.session.userId,
            lastActorSessionId: closeAuditCtx.sessionId,
            lastActorIp: closeAuditCtx.ip,
            lastActorUserAgent: closeAuditCtx.userAgent,
            lastActorType: closeAuditCtx.actorType,
          })
          .where(and(eq(trades.id, tradeId), eq(trades.userId, req.session.userId), eq(trades.status, "OPEN")))
          .returning();

        const closedTrade = closedRows[0];
        if (!closedTrade) return { action: "ALREADY_CLOSED" as const };

        await applyUserBalanceDelta(tx, { userId: req.session.userId, deltaUsd: closeSettlementUsd });
        await releaseUserMargin(tx, { userId: req.session.userId, marginUsd: marginToRelease });

        const slippagePoints = 0; // No slippage on manual close
        await writeTradeAudit({
          tradeId,
          eventType: "POSITION_CLOSED",
          eventCategory: "TRADE",
          ctx: closeAuditCtx,
          orderId,
          positionId,
          executionId,
          symbol: q.symbol,
          side: trade.type as string,
          qtyLots: lots,
          requestedPrice: closePrice,
          fillPrice: closePrice,
          avgFillPrice: closePrice,
          quoteBid: q.bid,
          quoteAsk: q.ask,
          quoteMid: q.mid,
          quoteSpread: q.spread,
          quoteTs: q.quoteTs,
          quoteSource: closeSource,
          spreadPips: calculateSpreadPips(q.symbol, q.spread, (trade as any).symbol?.pipDecimals),
          slippage: slippagePoints,
          slippagePips: 0,
          slippageReference: "manual_close",
          riskResult: "PASS",
          reasonCode: "MANUAL",
          note: `Manual close at ${closePrice}, gross=${grossProfitUsd.toFixed(2)}, net=${netProfitUsd.toFixed(2)}`,
          payload: {
            closeReason: "MANUAL",
            openPrice,
            grossProfitUsd: grossProfitUsd.toFixed(2),
            netProfitUsd: netProfitUsd.toFixed(2),
            balanceDeltaUsd: closeSettlementUsd.toFixed(2),
            costModelVersion: closeCostSummary.costModelVersion,
            categorySnapshot: closeCostSummary.categorySnapshot,
            notionalUsd: closeCostSummary.notionalUsd,
            openCommissionUsd: closeCostSummary.openCommissionUsd,
            openOtherFeesUsd: closeCostSummary.openOtherFeesUsd,
            closeCommissionUsd: closeCostSummary.closeCommissionUsd,
            closeOtherFeesUsd: closeCostSummary.closeOtherFeesUsd,
            financingAccruedUsd: closeCostSummary.financingAccruedUsd,
            swapAccruedUsd: closeCostSummary.swapAccruedUsd,
            overnightDays: closeCostSummary.overnightDays,
            holdDays: closeCostSummary.holdDays,
            totalCostsUsd: closeCostSummary.totalCostsUsd,
          },
        }, { db: tx });

        return { action: "CLOSED" as const, trade: closedTrade };
      });

      if (closeResult.action === "QUOTE_REVALIDATION_FAILED") {
        const quoteRevalidation = (closeResult as any).quoteRevalidation ?? {};
        incTradeCloseRejectedQuoteRevalidationTotal();
        try {
          await db.update(trades)
            .set({
              correlationId,
              orderId,
              positionId,
              lastActorUserId: req.session.userId,
              lastActorSessionId: closeAuditCtx.sessionId,
              lastActorIp: closeAuditCtx.ip,
              lastActorUserAgent: closeAuditCtx.userAgent,
              lastActorType: closeAuditCtx.actorType,
            })
            .where(eq(trades.id, tradeId));

          await writeTradeAudit({
            tradeId,
            eventType: "POSITION_CLOSE_REJECTED",
            eventCategory: "TRADE",
            ctx: closeAuditCtx,
            orderId,
            positionId,
            symbol: q.symbol,
            side: trade.type as string,
            requestedPrice: closePrice,
            quoteBid: q.bid,
            quoteAsk: q.ask,
            quoteMid: q.mid,
            quoteSpread: q.spread,
            quoteTs: q.quoteTs,
            quoteSource: `revalidation:${q.source}`,
            riskResult: "REJECT",
            reasonCode: String(quoteRevalidation.code ?? "QUOTE_REVALIDATION_FAILED"),
            note: "Rejected manual close due to quote commit revalidation failure",
            payload: quoteRevalidation,
          });
        } catch (auditErr) {
          console.error("Error writing POSITION_CLOSE_REJECTED revalidation audit:", auditErr);
        }

        res.setHeader("Retry-After", "1");
        return res.status(409).json({
          code: "QUOTE_REVALIDATION_FAILED",
          reasonCode: String(quoteRevalidation.code ?? "UNKNOWN"),
          message: "Quote changed during close commit. Please retry with the latest market quote.",
          details: quoteRevalidation,
        });
      }

      if (closeResult.action !== "CLOSED") {
        clearTradeExcursion(tradeId);
        return res.status(409).json({ message: "Trade is already closed" });
      }

      clearTradeExcursion(tradeId);

      try {
        await recalcAccount(req.session.userId, { emit: true, reason: "TRADE_CLOSED" });
      } catch (accountError) {
        console.error("Failed to update account after closing trade:", accountError);
      }

      // Notify ALL browser sessions for this user that trades changed (multi-device sync)
      // Include userId in payload so clients can filter, but also send to unauth'd clients
      const targetUserId = req.session.userId;
      broadcast(
        { type: WS_MSG_TRADES_UPDATED, userId: targetUserId },
        (client) => client.userId === targetUserId || client.userId === undefined
      );

      // Grift detection: record close activity (supports churn/concurrency + identity linking)
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId: req.session.userId,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "TRADE_CLOSE",
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
              console.error("[Grift] Auto-enforcement failed (trade close):", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("Error in grift detection on trade close:", griftErr);
        }
      }

      res.json(closeResult.trade);
    } catch (error) {
      console.error("Close trade error:", error);
      res.status(500).json({ message: "Failed to close trade" });
    }
  });

}
