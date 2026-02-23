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
  incTradeOpenRejectedQuoteRevalidationTotal,
} from "../metricsState";
import type { TraderRouterDeps } from "./types";

export function registerTradeOpenRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
router.post(
  "/api/trades",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy((req) => {
    const orderType = String((req.body as any)?.orderType ?? "Market").toLowerCase();
    return orderType.includes("limit") || orderType.includes("stop")
      ? "TRADE_PLACE_PENDING"
      : "TRADE_OPEN_OR_INCREASE";
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const sessionUserId = Number((req.session as SessionData).userId);
    const bg = await botGuard(req, res, {
      action: "TRADE",
      userId: Number.isInteger(sessionUserId) && sessionUserId > 0 ? sessionUserId : undefined,
    });
    if (!bg.allowed) return;
    next();
  },
  riskMiddleware,
  async (req: Request, res: Response) => {
    const correlationId = generateCorrelationId();
    const auditCtx = buildAuditContext(req);
    auditCtx.correlationId = correlationId;
    const receivedAtMs = Date.now();
    const session = req.session as SessionData;
    const userId = Number(session.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      // Handle either lots or size parameter from the request
      const { symbol, type, lots, size, orderType, limitPrice, stopPrice } = req.body;
      const orderSize = size ?? lots;

      if (typeof orderSize !== "number") {
        return res.status(400).json({ message: "size (lots) must be numeric" });
      }

      // Validate request data
      const data = insertTradeSchema.parse({
        ...req.body,
        userId: userId,
        openedAt: Math.floor(Date.now() / 1000),
        lots: orderSize, // Use the unified size parameter
      });
      const tradeSideRaw = String(data.type ?? req.body.type ?? "").toUpperCase();
      if (tradeSideRaw !== "BUY" && tradeSideRaw !== "SELL") {
        return res.status(400).json({ message: "Invalid trade side. Expected BUY or SELL." });
      }
      const tradeSide: "BUY" | "SELL" = tradeSideRaw;

      // Get current symbol price from our memory-based quotes
      // First, get the symbol config to get the symbol string
      const symbolConfig = await storage.getSymbolConfigById(data.symbolId);
      if (!symbolConfig) {
        return res.status(404).json({ message: "Symbol configuration not found" });
      }

      const executionQuote = await getExecutionQuote(symbolConfig.symbol, tradeSide, "OPEN");
      const quote = {
        symbol: executionQuote.symbol,
        bid: executionQuote.bid,
        ask: executionQuote.ask,
        mid: executionQuote.mid,
        price: executionQuote.mid,
        isStale: executionQuote.isStale,
        lastApiUpdate: executionQuote.quoteTs.getTime(),
        source: executionQuote.source,
      };

      const quoteTs = executionQuote.quoteTs ?? null;
      const quoteSource = executionQuote.source ?? "quote_service";

      // AUDIT: Write ORDER_RECEIVED event immediately after we have quote context
      try {
        await writeOrderIntentAudit({
          correlationId,
          eventCode: "ORDER_RECEIVED",
          ctx: auditCtx,
          userId: userId,
          symbol: symbolConfig.symbol,
          side: tradeSide,
          orderType: orderType ?? "Market",
          qtyLots: orderSize,
          requestedPrice: parseFloat(String(req.body.limitPrice ?? req.body.stopPrice ?? quote.price)),
          limitPrice: req.body.limitPrice ? parseFloat(String(req.body.limitPrice)) : null,
          stopPrice: req.body.stopPrice ? parseFloat(String(req.body.stopPrice)) : null,
          takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
          stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
          quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
          quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
          quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
          quoteTs,
          quoteIsStale: quote.isStale ?? false,
          payload: { rawBody: req.body, receivedAtMs, quoteSource },
        });
      } catch (auditErr) {
        console.error("Error writing ORDER_RECEIVED audit:", auditErr);
      }

      // OPTION 1: Block trade open on stale quote
      if (quote.isStale === true) {
        // AUDIT: Write DECISION REJECT for stale quote
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: orderSize,
            requestedPrice: parseFloat(String(req.body.limitPrice ?? req.body.stopPrice ?? quote.price)),
            quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
            quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
            quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
            quoteTs,
            quoteIsStale: true,
            riskLimit: {},
            riskObserved: {},
            payload: { rejectReason: "STALE_QUOTE", latencyMs: Date.now() - receivedAtMs, quoteSource },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
        return res.status(503).json({
          code: "QUOTE_STALE",
          message: "Quote is stale. Cannot open trade until fresh quotes are available.",
          symbol: symbolConfig.symbol,
          isStale: true
        });
      }

      // Use the appropriate price based on trade type
      // For a realistic trading experience with spreads
      let entryPrice;

      if (tradeSide === 'BUY') {
        entryPrice = quote.ask !== undefined ?
          parseFloat(String(quote.ask)) :
          parseFloat(String(quote.price));
      } else {
        entryPrice = quote.bid !== undefined ?
          parseFloat(String(quote.bid)) :
          parseFloat(String(quote.price));
      }

      // Handle either lots or size parameter, ensuring numeric type
      let tradeLots = 1; // Default to 1 lot

      if (data.lots !== undefined) {
        // Ensure lots is a number (could be a string from the client)
        tradeLots = typeof data.lots === 'string' ? parseInt(data.lots, 10) : Number(data.lots);
      } else if (data.size) {
        // Calculate lots from size
        tradeLots = Math.floor(Number(data.size) / 100000);
      }

      // Validate lots are within acceptable range (1-50)
      if (isNaN(tradeLots) || tradeLots < 1 || tradeLots > 50) {
        // AUDIT: Write DECISION REJECT for invalid lots
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            riskLimit: { minLots: 1, maxLots: 50 },
            riskObserved: { requestedLots: tradeLots },
            payload: { rejectReason: "INVALID_LOTS", latencyMs: Date.now() - receivedAtMs },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
        return res.status(400).json({
          message: "Invalid input data",
          errors: [
            { code: "custom", message: "Lots must be between 1 and 50", path: ["lots"] },
            { code: "too_big", maximum: 50, type: "number", inclusive: true, message: "Lots must be less than or equal to 50", path: ["lots"] }
          ]
        });
      }

      // Calculate position size from lots (1 lot = $100,000)
      const CONTRACT_SIZE = 100000;
      const positionSize = tradeLots * CONTRACT_SIZE;
      const openCostSummary = computeOpenSideCosts({
        category: (symbolConfig as any).category,
        notionalUsd: positionSize,
        lots: tradeLots,
        size: positionSize,
        positionSide: tradeSide,
      });

      // Enforce global maxPositionSize limit
      const gs = await getGlobalSettingsCached();
      const maxPositionSize = Number(gs?.maxPositionSize ?? 5000000);
      const minPriceDistancePips = sanitizeMinPriceDistancePips(gs?.minPriceDistancePips);
      if (positionSize > maxPositionSize) {
        // AUDIT: Write DECISION REJECT for position size exceeded
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            riskLimit: { maxPositionSize },
            riskObserved: { positionSize },
            payload: { rejectReason: "POSITION_SIZE_EXCEEDED", latencyMs: Date.now() - receivedAtMs },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
        return res.status(400).json({
          code: "MAX_POSITION_SIZE",
          message: `Position size $${positionSize.toLocaleString()} exceeds maximum allowed ($${maxPositionSize.toLocaleString()}).`,
          positionSize,
          maxPositionSize,
          suggestedMaxLots: Math.floor(maxPositionSize / CONTRACT_SIZE)
        });
      }

      // Ensure the account numbers are fresh
      await recalcAccount(userId);

      // Pull the updated user
      const updatedUser = await storage.getUserById(userId);
      if (!updatedUser) return res.status(404).json({ message: "User not found" });

      // Determine order type and status (handle both "LIMIT" and "limit" formats)
      const normalizedOrderType = String(orderType ?? "Market").toUpperCase();
      const isLimitOrder = normalizedOrderType === "LIMIT" || normalizedOrderType === "BUY_LIMIT" || normalizedOrderType === "SELL_LIMIT";
      const isStopOrder = normalizedOrderType === "STOP" || normalizedOrderType === "BUY_STOP" || normalizedOrderType === "SELL_STOP";
      const isPendingOrder = isLimitOrder || isStopOrder;

      const orderId = generateOrderId();
      const positionId = generatePositionId();
      const openExecutionId = isPendingOrder ? null : generateExecutionId();

      // Helper for writing DECISION REJECT audit
      const writeDecisionReject = async (rejectReason: string, riskLimit: any = {}, riskObserved: any = {}) => {
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            riskLimit,
            riskObserved,
            payload: { rejectReason, latencyMs: Date.now() - receivedAtMs },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
      };

      // Validate Limit/Stop orders have required prices
      if (isLimitOrder && (limitPrice === undefined || limitPrice === null)) {
        await writeDecisionReject("LIMIT_PRICE_MISSING");
        return res.status(400).json({ message: "Limit orders require a limitPrice" });
      }
      if (isStopOrder && (stopPrice === undefined || stopPrice === null)) {
        await writeDecisionReject("STOP_PRICE_MISSING");
        return res.status(400).json({ message: "Stop orders require a stopPrice" });
      }

      // MT5-style placement validation for Limit/Stop orders
      if (isPendingOrder) {
        const pipSize = getPipSize({
          symbol: symbolConfig.symbol,
          category: (symbolConfig as any).category,
          quoteCurrency: (symbolConfig as any).quoteCurrency,
          pipDecimals: (symbolConfig as any).pipDecimals,
          quoteDecimals: (symbolConfig as any).quoteDecimals,
        });
        const priceDecimals = getQuoteDecimals({
          symbol: symbolConfig.symbol,
          category: (symbolConfig as any).category,
          quoteCurrency: (symbolConfig as any).quoteCurrency,
          pipDecimals: (symbolConfig as any).pipDecimals,
          quoteDecimals: (symbolConfig as any).quoteDecimals,
        });
        const minDist = minPriceDistancePips * pipSize;
        const bid = quote.bid !== undefined ? parseFloat(String(quote.bid)) : entryPrice;
        const ask = quote.ask !== undefined ? parseFloat(String(quote.ask)) : entryPrice;

        if (isLimitOrder) {
          const reqPrice = parseFloat(String(limitPrice));
          const maxBuyLimit = ask - minDist;
          const minSellLimit = bid + minDist;
          // Use precision-aware comparison for limit orders
          if (tradeSide === "BUY" && priceGreaterThan(reqPrice, maxBuyLimit, priceDecimals)) {
            await writeDecisionReject("BUY_LIMIT_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `BUY LIMIT must be at least ${minPriceDistancePips} pips below current ask (${ask.toFixed(priceDecimals)}). Maximum: ${maxBuyLimit.toFixed(priceDecimals)}`
            });
          }
          if (tradeSide === "SELL" && priceLessThan(reqPrice, minSellLimit, priceDecimals)) {
            await writeDecisionReject("SELL_LIMIT_TOO_CLOSE", { minDistPips: minPriceDistancePips, bid }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `SELL LIMIT must be at least ${minPriceDistancePips} pips above current bid (${bid.toFixed(priceDecimals)}). Minimum: ${minSellLimit.toFixed(priceDecimals)}`
            });
          }
        }

        if (isStopOrder) {
          const reqPrice = parseFloat(String(stopPrice));
          const minBuyStop = ask + minDist;
          const maxSellStop = bid - minDist;
          // Use precision-aware comparison for stop orders
          if (tradeSide === "BUY" && priceLessThan(reqPrice, minBuyStop, priceDecimals)) {
            await writeDecisionReject("BUY_STOP_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `BUY STOP must be at least ${minPriceDistancePips} pips above current ask (${ask.toFixed(priceDecimals)}). Minimum: ${minBuyStop.toFixed(priceDecimals)}`
            });
          }
          if (tradeSide === "SELL" && priceGreaterThan(reqPrice, maxSellStop, priceDecimals)) {
            await writeDecisionReject("SELL_STOP_TOO_CLOSE", { minDistPips: minPriceDistancePips, bid }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `SELL STOP must be at least ${minPriceDistancePips} pips below current bid (${bid.toFixed(priceDecimals)}). Maximum: ${maxSellStop.toFixed(priceDecimals)}`
            });
          }
        }

        // TP/SL validation for pending orders using precision-aware comparison
        // This handles truncated decimals correctly (e.g., 0.67 = 0.6700 > 0.6698)
        const intendedEntry = isLimitOrder ? parseFloat(String(limitPrice)) : parseFloat(String(stopPrice));
        const tp = req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null;
        const sl = req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null;
        const minTpSl = intendedEntry + minDist; // Minimum distance for TP (BUY) or SL (SELL)
        const maxTpSl = intendedEntry - minDist; // Maximum for SL (BUY) or TP (SELL)

        if (tradeSide === "BUY") {
          // BUY TP must be >= entry + minPriceDistancePips
          if (tp !== null && priceLessThan(tp, minTpSl, priceDecimals)) {
            await writeDecisionReject("BUY_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { tp });
            return res.status(400).json({ message: `BUY TP must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
          }
          // BUY SL must be <= entry - minPriceDistancePips
          if (sl !== null && priceGreaterThan(sl, maxTpSl, priceDecimals)) {
            await writeDecisionReject("BUY_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { sl });
            return res.status(400).json({ message: `BUY SL must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
          }
        } else {
          // SELL TP must be <= entry - minPriceDistancePips
          if (tp !== null && priceGreaterThan(tp, maxTpSl, priceDecimals)) {
            await writeDecisionReject("SELL_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { tp });
            return res.status(400).json({ message: `SELL TP must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
          }
          // SELL SL must be >= entry + minPriceDistancePips
          if (sl !== null && priceLessThan(sl, minTpSl, priceDecimals)) {
            await writeDecisionReject("SELL_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, intendedEntry }, { sl });
            return res.status(400).json({ message: `SELL SL must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
          }
        }
      }
      // TP/SL validation for market orders using the same minimum distance rule.
      // This prevents "instant-hit" targets and keeps behavior consistent with pending orders and edits.
      if (!isPendingOrder) {
        const pipSize = getPipSize({
          symbol: symbolConfig.symbol,
          category: (symbolConfig as any).category,
          quoteCurrency: (symbolConfig as any).quoteCurrency,
          pipDecimals: (symbolConfig as any).pipDecimals,
          quoteDecimals: (symbolConfig as any).quoteDecimals,
        });
        const priceDecimals = getQuoteDecimals({
          symbol: symbolConfig.symbol,
          category: (symbolConfig as any).category,
          quoteCurrency: (symbolConfig as any).quoteCurrency,
          pipDecimals: (symbolConfig as any).pipDecimals,
          quoteDecimals: (symbolConfig as any).quoteDecimals,
        });
        const minDist = minPriceDistancePips * pipSize;
        const tp = req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null;
        const sl = req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null;
        const minTpSl = entryPrice + minDist;
        const maxTpSl = entryPrice - minDist;

        if (tradeSide === "BUY") {
          if (tp !== null && priceLessThan(tp, minTpSl, priceDecimals)) {
            await writeDecisionReject("BUY_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { tp });
            return res.status(400).json({ message: `BUY TP must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
          }
          if (sl !== null && priceGreaterThan(sl, maxTpSl, priceDecimals)) {
            await writeDecisionReject("BUY_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { sl });
            return res.status(400).json({ message: `BUY SL must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
          }
        } else {
          if (tp !== null && priceGreaterThan(tp, maxTpSl, priceDecimals)) {
            await writeDecisionReject("SELL_TP_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { tp });
            return res.status(400).json({ message: `SELL TP must be at least ${minPriceDistancePips} pips below entry. Maximum: ${maxTpSl.toFixed(priceDecimals)}` });
          }
          if (sl !== null && priceLessThan(sl, minTpSl, priceDecimals)) {
            await writeDecisionReject("SELL_SL_TOO_CLOSE", { minDistPips: minPriceDistancePips, entryPrice }, { sl });
            return res.status(400).json({ message: `SELL SL must be at least ${minPriceDistancePips} pips above entry. Minimum: ${minTpSl.toFixed(priceDecimals)}` });
          }
        }
      }

      // For pending orders, use the requested price for margin calculation
      const priceForMargin = isPendingOrder
        ? parseFloat(String(limitPrice ?? stopPrice ?? entryPrice))
        : entryPrice;

      // Get global settings for leverage cascade
      const globalDefaultLeverage = Number(gs?.defaultLeverage ?? 50);

      // Effective leverage: user override takes precedence over global
      const challengeTradeConstraints = await getActiveTradeConstraintsForUser(userId);
      const challengeLeverageMultiplier = Math.max(
        0.01,
        Number(challengeTradeConstraints?.leverageMultiplier ?? 1),
      );
      const effectiveLeverage = Math.max(
        0.01,
        Number(updatedUser.leverage ?? globalDefaultLeverage) * challengeLeverageMultiplier,
      );

      // How much margin will this order need?
      const neededMargin = requiredMargin(
        symbolConfig.symbol,
        tradeLots,
        priceForMargin,
        effectiveLeverage,
      );

      // Stop the order if free margin isn't enough
      if (Number(updatedUser.freeMargin) < neededMargin) {
        // AUDIT: Write DECISION REJECT for margin denial
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            riskLimit: { marginRequired: neededMargin },
            riskObserved: { freeMargin: Number(updatedUser.freeMargin) },
            payload: { rejectReason: "INSUFFICIENT_MARGIN", latencyMs: Date.now() - receivedAtMs },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
        return res.status(400).json({ message: "Not enough margin available" });
      }

      // Check max concurrent lots limit (includes both OPEN and PENDING orders)
      const userSettingsData = await storage.getUserSettingsById(userId);
      const globalMaxConcurrentLots = Number(gs?.maxConcurrentLots ?? 50);
      // Effective max lots: user override takes precedence over global (can exceed)
      const effectiveMaxConcurrentLots = Number(userSettingsData?.maxConcurrentLots ?? globalMaxConcurrentLots);

      // Create trade with appropriate price and status based on order type
      // Market orders: OPEN immediately at current price
      // Limit/Stop orders: PENDING, waiting for price trigger
      const nowSec = Math.floor(Date.now() / 1000);
      const tradeResult = await db.transaction(async (tx) => {
        // Serialize trade placement per user to avoid TOC/TOU races on maxConcurrentLots.
        // (Only supported on Postgres; other dialects rely on their transaction semantics.)
        if (isPostgres) {
          await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`);
        }

        const [openRow] = await tx
          .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
          .from(trades)
          .where(and(eq(trades.userId, userId), eq(trades.status, "OPEN")))
          .limit(1);
        const [pendingRow] = await tx
          .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
          .from(trades)
          .where(and(eq(trades.userId, userId), eq(trades.status, "PENDING")))
          .limit(1);

        const openLots = Number((openRow as any)?.lots ?? 0);
        const pendingLots = Number((pendingRow as any)?.lots ?? 0);
        const currentTotalLots = openLots + pendingLots;

        if (currentTotalLots + tradeLots > effectiveMaxConcurrentLots) {
          return { trade: null, rejectReason: "MAX_CONCURRENT_LOTS" as const, openLots, pendingLots, currentTotalLots };
        }

        if (!isPendingOrder) {
          const quoteRevalidation = await validateExecutionQuoteAtCommit({
            symbol: symbolConfig.symbol,
            side: tradeSide,
            action: "OPEN",
            expectedQuoteTs: quoteTs ?? new Date(),
            expectedExecPrice: entryPrice,
          });
          if (!quoteRevalidation.ok) {
            return {
              trade: null,
              rejectReason: "QUOTE_REVALIDATION_FAILED" as const,
              quoteRevalidation,
              openLots,
              pendingLots,
              currentTotalLots,
            };
          }
        }

        if (!isPendingOrder) {
          const reserve = await reserveUserMargin(tx, { userId: userId, marginUsd: neededMargin });
          if (!reserve.reserved) {
            return { trade: null, rejectReason: "INSUFFICIENT_MARGIN_AT_COMMIT" as const, openLots, pendingLots, currentTotalLots };
          }
          await applyUserBalanceDelta(tx, {
            userId: userId,
            deltaUsd: -openCostSummary.totalUsd,
          });
        }

        const [createdTrade] = await tx
          .insert(trades)
          .values({
            ...data,
            userId,
            type: tradeSide,
            openPrice: isPendingOrder ? priceForMargin : entryPrice, // Pending orders use limit/stop price as intended entry
            lots: tradeLots,
            size: positionSize,
            orderType: orderType ?? "Market",
            limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
            stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
            status: isPendingOrder ? "PENDING" : "OPEN",
            executedAt: isPendingOrder ? undefined : nowSec,
            intradayHigh: isPendingOrder ? null : entryPrice,
            intradayLow: isPendingOrder ? null : entryPrice,
            mae: null,
            mfe: null,
            correlationId: correlationId,
            orderId,
            positionId,
            notionalUsd: openCostSummary.notionalUsd,
            categorySnapshot: openCostSummary.categorySnapshot,
            costModelVersion: openCostSummary.costModelVersion,
            openCommissionUsd: isPendingOrder ? 0 : openCostSummary.commissionUsd,
            openOtherFeesUsd: isPendingOrder ? 0 : openCostSummary.otherFeesUsd,
            totalCostsUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
            lastExecutionId: openExecutionId,
            lastActorUserId: userId,
            lastActorSessionId: auditCtx.sessionId,
            lastActorIp: auditCtx.ip,
            lastActorUserAgent: auditCtx.userAgent,
            lastActorType: auditCtx.actorType,
          })
          .returning();

        if (!createdTrade) throw new Error("Failed to create trade");
        return { trade: createdTrade, rejectReason: null, openLots, pendingLots, currentTotalLots };
      });

      const openLots = tradeResult.openLots;
      const pendingLots = tradeResult.pendingLots;
      const currentTotalLots = tradeResult.currentTotalLots;

      if (tradeResult.rejectReason === "MAX_CONCURRENT_LOTS") {
        // AUDIT: Write DECISION REJECT for max concurrent lots exceeded
        try {
          await writeOrderIntentAudit({
            correlationId,
            eventCode: "DECISION",
            ctx: auditCtx,
            userId: userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: orderType ?? "Market",
            qtyLots: tradeLots,
            riskLimit: { maxConcurrentLots: effectiveMaxConcurrentLots },
            riskObserved: { currentLots: currentTotalLots, requestedLots: tradeLots },
            payload: { rejectReason: "MAX_CONCURRENT_LOTS_EXCEEDED", openLots, pendingLots, latencyMs: Date.now() - receivedAtMs },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
        return res.status(409).json({
          code: "MAX_CONCURRENT_LOTS",
          message: `Maximum concurrent lots exceeded. Open: ${openLots}, Pending: ${pendingLots}, Requested: ${tradeLots}, Limit: ${effectiveMaxConcurrentLots}`,
          openLots,
          pendingLots,
          currentLots: currentTotalLots,
          requestedLots: tradeLots,
          maxLots: effectiveMaxConcurrentLots,
          limit: effectiveMaxConcurrentLots
        });
      }

      if (tradeResult.rejectReason === "QUOTE_REVALIDATION_FAILED") {
        const quoteRevalidation = (tradeResult as any).quoteRevalidation ?? {};
        incTradeOpenRejectedQuoteRevalidationTotal();
        await writeDecisionReject(
          "QUOTE_REVALIDATION_FAILED",
          {
            maxAgeMs: Number(process.env.QUOTE_REVALIDATE_MAX_AGE_MS ?? process.env.QUOTE_STALE_AFTER_MS ?? 300000),
            maxExecPriceDriftBps: Number(process.env.QUOTE_REVALIDATE_MAX_EXEC_PRICE_DRIFT_BPS ?? 150),
          },
          {
            code: quoteRevalidation.code,
            latestQuoteTsMs: quoteRevalidation.latestQuoteTsMs,
            expectedQuoteTsMs: quoteRevalidation.expectedQuoteTsMs,
            ageMs: quoteRevalidation.ageMs,
            latestExecPrice: quoteRevalidation.latestExecPrice,
            expectedExecPrice: quoteRevalidation.expectedExecPrice,
            driftAbs: quoteRevalidation.driftAbs,
            driftBps: quoteRevalidation.driftBps,
          },
        );
        res.setHeader("Retry-After", "1");
        return res.status(409).json({
          code: "QUOTE_REVALIDATION_FAILED",
          reasonCode: String(quoteRevalidation.code ?? "UNKNOWN"),
          message: "Quote changed during commit. Please retry with the latest market price.",
          details: quoteRevalidation,
        });
      }

      const trade = tradeResult.trade;
      if (!trade) {
        await writeDecisionReject("INSUFFICIENT_MARGIN_AT_COMMIT", { marginRequired: neededMargin }, {});
        return res.status(400).json({ message: "Not enough margin available" });
      }

      if (!isPendingOrder) {
        initTradeExcursion(Number(trade.id), entryPrice);
      }

      // AUDIT: Write DECISION event (PASS) after successful trade creation
      const latencyMs = Date.now() - receivedAtMs;
      try {
        await writeOrderIntentAudit({
          correlationId,
          eventCode: "DECISION",
          ctx: auditCtx,
          userId: userId,
          decision: "PASS",
          symbol: symbolConfig.symbol,
          side: tradeSide,
          orderType: orderType ?? "Market",
          qtyLots: tradeLots,
          requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
          limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
          stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
          takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
          stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
          quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
          quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
          quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
          quoteTs,
          quoteIsStale: quote.isStale ?? false,
          riskLimit: { maxConcurrentLots: effectiveMaxConcurrentLots, marginRequired: neededMargin },
          riskObserved: { currentLots: currentTotalLots, freeMargin: Number(updatedUser.freeMargin) },
          payload: {
            tradeId: trade.id,
            latencyMs,
            status: trade.status,
            quoteSource,
            costModelVersion: openCostSummary.costModelVersion,
            categorySnapshot: openCostSummary.categorySnapshot,
            notionalUsd: openCostSummary.notionalUsd,
            openCostEstimatedUsd: openCostSummary.totalUsd,
            openCommissionEstimatedUsd: openCostSummary.commissionUsd,
            openOtherFeesEstimatedUsd: openCostSummary.otherFeesUsd,
            openCostChargedNowUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
          },
        });

        await writeTradeAudit({
          tradeId: trade.id,
          eventType: "ORDER_PLACED",
          eventCategory: "ORDER",
          ctx: auditCtx,
          orderId,
          positionId,
          symbol: symbolConfig.symbol,
          side: tradeSide,
          orderType: orderType ?? "Market",
          qtyLots: tradeLots,
          requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
          limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
          stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
          quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
          quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
          quoteMid: quote.mid ? parseFloat(String(quote.mid)) : quote.price ? parseFloat(String(quote.price)) : null,
          quoteTs,
          quoteSource,
          riskResult: "PASS",
          note: isPendingOrder ? `Pending ${normalizedOrderType}` : "Market order placed",
          payload: {
            normalizedOrderType,
            limitPrice: isLimitOrder ? parseFloat(String(limitPrice)) : null,
            stopPrice: isStopOrder ? parseFloat(String(stopPrice)) : null,
            takeProfit: req.body.takeProfit ? parseFloat(String(req.body.takeProfit)) : null,
            stopLoss: req.body.stopLoss ? parseFloat(String(req.body.stopLoss)) : null,
            status: trade.status,
            costModelVersion: openCostSummary.costModelVersion,
            categorySnapshot: openCostSummary.categorySnapshot,
            notionalUsd: openCostSummary.notionalUsd,
            openCostEstimatedUsd: openCostSummary.totalUsd,
            openCommissionEstimatedUsd: openCostSummary.commissionUsd,
            openOtherFeesEstimatedUsd: openCostSummary.otherFeesUsd,
            openCostChargedNowUsd: isPendingOrder ? 0 : openCostSummary.totalUsd,
          },
        });

        // For market orders, also write ORDER_FILLED to trade_audit
        if (!isPendingOrder) {
          const spread = quote.ask && quote.bid ? parseFloat(String(quote.ask)) - parseFloat(String(quote.bid)) : 0;
          const requestedPrice = tradeSide === "BUY"
            ? (quote.ask ? parseFloat(String(quote.ask)) : entryPrice)
            : (quote.bid ? parseFloat(String(quote.bid)) : entryPrice);
          const slippagePoints = Math.abs(entryPrice - requestedPrice);

          await writeTradeAudit({
            tradeId: trade.id,
            eventType: "ORDER_FILLED",
            eventCategory: "TRADE",
            ctx: auditCtx,
            orderId,
            positionId,
            executionId: openExecutionId ?? undefined,
            symbol: symbolConfig.symbol,
            side: tradeSide,
            orderType: "Market",
            qtyLots: tradeLots,
            requestedPrice,
            fillPrice: entryPrice,
            avgFillPrice: entryPrice,
            quoteBid: quote.bid ? parseFloat(String(quote.bid)) : null,
            quoteAsk: quote.ask ? parseFloat(String(quote.ask)) : null,
            quoteMid: quote.mid ? parseFloat(String(quote.mid)) : null,
            quoteSpread: spread,
            spreadPips: calculateSpreadPips(symbolConfig.symbol, spread, symbolConfig.pipDecimals),
            quoteTs,
            quoteSource,
            slippage: slippagePoints,
            slippagePips: calculateSlippagePips(symbolConfig.symbol, slippagePoints, symbolConfig.pipDecimals),
            slippageReference: "market",
            latencyMs,
            riskResult: "PASS",
            note: `Market order filled at ${entryPrice}, openCost=${openCostSummary.totalUsd.toFixed(2)}`,
            payload: {
              costModelVersion: openCostSummary.costModelVersion,
              categorySnapshot: openCostSummary.categorySnapshot,
              notionalUsd: openCostSummary.notionalUsd,
              openCommissionUsd: openCostSummary.commissionUsd,
              openOtherFeesUsd: openCostSummary.otherFeesUsd,
              openCostChargedUsd: openCostSummary.totalUsd,
            },
          });
        }
      } catch (auditErr) {
        console.error("Error writing DECISION/ORDER_FILLED audit:", auditErr);
      }

      // Recalculate margin metrics after order placement (market orders affect margin immediately)
      try {
        await recalcAccount(userId, {
          emit: true,
          reason: isPendingOrder ? "PENDING_ORDER_PLACED" : "MARKET_ORDER_PLACED",
        });
      } catch (accountError) {
        console.error("Failed to update account after trade placement:", accountError);
      }

      // Notify ALL browser sessions for this user that trades changed (multi-device sync)
      // Include userId in payload so clients can filter, but also send to unauth'd clients
      const targetUserId = userId;
      broadcast(
        { type: WS_MSG_TRADES_UPDATED, userId: targetUserId },
        (client) => client.userId === targetUserId || client.userId === undefined
      );

      // Grift detection: Record trade observation and check for coordinated hedging
      if (isPostgres) {
        try {
          const griftCtx = extractGriftContext(req);
          await withGriftClient(async (griftDb) => {
            const griftAuditCtx: GriftAuditContext = {
              ts: Date.now(),
              userId: userId,
              sessionId: req.sessionID,
              deviceId: griftCtx.deviceId ?? undefined,
              deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
              deviceFp: griftCtx.deviceFp ?? undefined,
              deviceInstallId: griftCtx.deviceInstallId ?? undefined,
              clientTz: griftCtx.clientTz ?? undefined,
              clientLang: griftCtx.clientLang ?? undefined,
              eventType: "TRADE_SUBMIT",
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

            await onTradeSubmit(
              griftDb,
              trade.id,
              symbolConfig.symbol,
              tradeSide,
              tradeLots,
              griftAuditCtx
            );

            try {
              await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
            } catch (enfErr) {
              console.error("[Grift] Auto-enforcement failed (trade submit):", enfErr);
            }
          });
        } catch (griftErr) {
          console.error("Error in grift detection onTradeSubmit:", griftErr);
        }
      }

      res.status(201).json(trade);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input data", errors: error.issues });
      }
      console.error("Create trade error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
