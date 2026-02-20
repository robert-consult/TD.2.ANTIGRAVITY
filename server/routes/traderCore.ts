// @ts-nocheck
import type { Express, NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { insertTradeSchema, systemConfig, trades, users } from "@shared/schema";
import { getPipSize, getQuoteDecimals } from "@shared/pips";
import type { AuditContext as GriftAuditContext } from "../grift/griftTypes";
import { storage } from "../storage";
import { riskMiddleware, getEffectiveMinHoldSec } from "../risk";
import { requirePolicy } from "../middleware/requirePolicy";
import { recalcAccount } from "../recalcAccount";
import { requiredMargin } from "../lib/margin";
import { getExecutionQuote } from "../services/quoteService";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "../services/tradeAtomic";
import { realizedPnlUsd } from "../lib/realizedPnl";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "../services/tradeCosts";
import { clearTradeExcursion, initTradeExcursion, resolveTradeExcursionForClose } from "../trades/excursionTracking";
import { buildAuditContext, type AuditContext } from "../lib/auditContext";
import {
  calculateSlippagePips,
  calculateSpreadPips,
  generateCorrelationId,
  generateExecutionId,
  generateOrderId,
  generatePositionId,
  writeOrderIntentAudit,
  writeTradeAudit,
} from "../lib/auditWriter";
import { getActiveTradeConstraintsForUser } from "../recruitment/challengesV4/challengeService";
import {
  getGlobalSettingsCached,
  getMinPriceDistancePips,
  sanitizeMinPriceDistancePips,
} from "../services/globalSettings";
import { botGuard } from "../security/botGuard";
import { isPostgres } from "@db/config";
import { extractGriftContext } from "../grift/griftGeo";
import { withGriftClient } from "../grift/griftDb";
import { maybeApplyAutoEnforcement } from "../grift/griftAutoEnforcement";
import { onSessionActivity, onTradeSubmit } from "../grift/griftEngine";
import {
  priceGreaterThan,
  priceGreaterThanOrEqual,
  priceLessThan,
  priceLessThanOrEqual,
  ticksToPrice,
  toTicks,
} from "../lib/priceUtils";
import { WS_MSG_TRADES_UPDATED } from "@shared/ws/protocol";
import {
  incTradeCloseRejectedQuoteStaleTotal,
  incTradeTargetsRejectedQuoteStaleTotal,
} from "./metricsState";

export type WsBroadcast = (event: any, filter?: (client: any) => boolean) => void;

interface TraderCoreDeps {
  ensureAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  ensureDoc1TermsAccepted: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  broadcast: WsBroadcast;
}

export function registerTraderCoreRoutes(app: Express, deps: TraderCoreDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;

// Trades endpoints
app.post(
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
    const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
    if (!bg.allowed) return;
    next();
  },
  riskMiddleware,
  async (req: Request, res: Response) => {
    const correlationId = generateCorrelationId();
    const auditCtx = buildAuditContext(req);
    auditCtx.correlationId = correlationId;
    const receivedAtMs = Date.now();

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
        userId: req.session.userId,
        openedAt: Math.floor(Date.now() / 1000),
        lots: orderSize, // Use the unified size parameter
      });

      // Get current symbol price from our memory-based quotes
      // First, get the symbol config to get the symbol string
      const symbolConfig = await storage.getSymbolConfigById(data.symbolId);
      if (!symbolConfig) {
        return res.status(404).json({ message: "Symbol configuration not found" });
      }

      const executionQuote = await getExecutionQuote(symbolConfig.symbol, data.type, "OPEN");
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
          userId: req.session.userId,
          symbol: symbolConfig.symbol,
          side: data.type,
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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

      if (data.type === 'BUY') {
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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
        positionSide: data.type,
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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
      await recalcAccount(req.session.userId);

      // Pull the updated user
      const updatedUser = await storage.getUserById(req.session.userId);
      if (!updatedUser) return res.status(404).json({ message: "User not found" });

      // Determine order type and status (handle both "LIMIT" and "limit" formats)
      const normalizedOrderType = String(orderType ?? "Market").toUpperCase();
      const isLimitOrder = normalizedOrderType === "LIMIT" || normalizedOrderType === "BUY_LIMIT" || normalizedOrderType === "SELL_LIMIT";
      const isStopOrder = (normalizedOrderType === "STOP" || normalizedOrderType === "BUY_STOP" || normalizedOrderType === "SELL_STOP") && normalizedOrderType !== "STOPLOSS";
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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
          if (data.type === "BUY" && priceGreaterThan(reqPrice, maxBuyLimit, priceDecimals)) {
            await writeDecisionReject("BUY_LIMIT_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `BUY LIMIT must be at least ${minPriceDistancePips} pips below current ask (${ask.toFixed(priceDecimals)}). Maximum: ${maxBuyLimit.toFixed(priceDecimals)}`
            });
          }
          if (data.type === "SELL" && priceLessThan(reqPrice, minSellLimit, priceDecimals)) {
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
          if (data.type === "BUY" && priceLessThan(reqPrice, minBuyStop, priceDecimals)) {
            await writeDecisionReject("BUY_STOP_TOO_CLOSE", { minDistPips: minPriceDistancePips, ask }, { requestedPrice: reqPrice });
            return res.status(400).json({
              message: `BUY STOP must be at least ${minPriceDistancePips} pips above current ask (${ask.toFixed(priceDecimals)}). Minimum: ${minBuyStop.toFixed(priceDecimals)}`
            });
          }
          if (data.type === "SELL" && priceGreaterThan(reqPrice, maxSellStop, priceDecimals)) {
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

        if (data.type === "BUY") {
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

        if (data.type === "BUY") {
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
      const challengeTradeConstraints = await getActiveTradeConstraintsForUser(req.session.userId);
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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
      const userSettingsData = await storage.getUserSettingsById(req.session.userId);
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
          await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${req.session.userId} FOR UPDATE`);
        }

        const [openRow] = await tx
          .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
          .from(trades)
          .where(and(eq(trades.userId, req.session.userId), eq(trades.status, "OPEN")))
          .limit(1);
        const [pendingRow] = await tx
          .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
          .from(trades)
          .where(and(eq(trades.userId, req.session.userId), eq(trades.status, "PENDING")))
          .limit(1);

        const openLots = Number((openRow as any)?.lots ?? 0);
        const pendingLots = Number((pendingRow as any)?.lots ?? 0);
        const currentTotalLots = openLots + pendingLots;

        if (currentTotalLots + tradeLots > effectiveMaxConcurrentLots) {
          return { trade: null, rejectReason: "MAX_CONCURRENT_LOTS" as const, openLots, pendingLots, currentTotalLots };
        }

        if (!isPendingOrder) {
          const reserve = await reserveUserMargin(tx, { userId: req.session.userId, marginUsd: neededMargin });
          if (!reserve.reserved) {
            return { trade: null, rejectReason: "INSUFFICIENT_MARGIN_AT_COMMIT" as const, openLots, pendingLots, currentTotalLots };
          }
          await applyUserBalanceDelta(tx, {
            userId: req.session.userId,
            deltaUsd: -openCostSummary.totalUsd,
          });
        }

        const [createdTrade] = await tx
          .insert(trades)
          .values({
            ...data,
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
            lastActorUserId: req.session.userId,
            lastActorSessionId: auditCtx.sessionId,
            lastActorIp: auditCtx.ip,
            lastActorUserAgent: auditCtx.userAgent,
            lastActorType: auditCtx.actorType,
          })
          .returning();

        if (!createdTrade) throw new Error("Failed to create trade");
        return { trade: createdTrade, rejectReason: null as const, openLots, pendingLots, currentTotalLots };
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
            userId: req.session.userId,
            decision: "REJECT",
            symbol: symbolConfig.symbol,
            side: data.type,
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
          userId: req.session.userId,
          decision: "PASS",
          symbol: symbolConfig.symbol,
          side: data.type,
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
          side: data.type,
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
          const requestedPrice = data.type === "BUY"
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
            side: data.type,
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
        await recalcAccount(req.session.userId, {
          emit: true,
          reason: isPendingOrder ? "PENDING_ORDER_PLACED" : "MARKET_ORDER_PLACED",
        });
      } catch (accountError) {
        console.error("Failed to update account after trade placement:", accountError);
      }

      // Notify ALL browser sessions for this user that trades changed (multi-device sync)
      // Include userId in payload so clients can filter, but also send to unauth'd clients
      const targetUserId = req.session.userId;
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
              userId: req.session.userId,
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
              data.type,
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
        return res.status(400).json({ message: "Invalid input data", errors: error.errors });
      }
      console.error("Create trade error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

app.get("/api/trades", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getTradesByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get trades error:", error);
    res.status(500).json({ message: "Failed to fetch trades" });
  }
});

app.get("/api/trades/history", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getTradeHistoryByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get trade history error:", error);
    res.status(500).json({ message: "Failed to fetch trade history" });
  }
});

app.get("/api/trades/open", ensureAuth, async (req: Request, res: Response) => {

  try {
    const trades = await storage.getOpenTradesByUserId(req.session.userId);
    res.json(trades);
  } catch (error) {
    console.error("Get open trades error:", error);
    res.status(500).json({ message: "Failed to fetch open trades" });
  }
});

app.post(
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
      const excursion = resolveTradeExcursionForClose({
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
        if (!tradeLock.rows.length) return null;

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
        if (!closedTrade) return null;

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

        return closedTrade;
      });

      if (!closeResult) {
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

      res.json(closeResult);
    } catch (error) {
      console.error("Close trade error:", error);
      res.status(500).json({ message: "Failed to close trade" });
    }
  });

// Update take profit and stop loss for an open trade
app.patch(
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

      const tradeId = parseInt(req.params.id);
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
      let symbolConfig = (trade as any).symbol ? (trade as any).symbol : null;
      if (!symbolConfig) symbolConfig = await storage.getSymbolConfigById(trade.symbolId);
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

// Cancel a pending trade
app.patch(
  "/api/trades/:id/cancel",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy("TRADE_CANCEL_PENDING"),
  async (req: Request, res: Response, next: NextFunction) => {
    const bg = await botGuard(req, res, { action: "TRADE", userId: (req.session as any).userId });
    if (!bg.allowed) return;
    next();
  },
  async (req: Request, res: Response) => {
    try {
      const session = req.session as SessionData;

      const tradeId = parseInt(req.params.id);
      const trade = await storage.getTradeById(tradeId);

      if (!trade) {
        return res.status(404).json({ message: "Trade not found" });
      }

      if (trade.userId !== session.userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      if (trade.status !== "PENDING") {
        return res.status(400).json({ message: "Trade is not pending" });
      }

      // Build audit context
      const cancelAuditCtx = buildAuditContext(req);
      const correlationId = (trade as any).correlationId || generateCorrelationId();
      const orderId = (trade as any).orderId || generateOrderId();
      const positionId = (trade as any).positionId || generatePositionId();

      await db.update(trades)
        .set({
          correlationId,
          orderId,
          positionId,
          lastActorUserId: session.userId,
          lastActorSessionId: cancelAuditCtx.sessionId,
          lastActorIp: cancelAuditCtx.ip,
          lastActorUserAgent: cancelAuditCtx.userAgent,
          lastActorType: cancelAuditCtx.actorType,
        })
        .where(eq(trades.id, tradeId));

      cancelAuditCtx.correlationId = correlationId;

      const symbol = (trade as any).symbol?.symbol ?? null;
      let q = null;
      if (symbol) {
        try {
          q = await getExecutionQuote(symbol, trade.type as "BUY" | "SELL", "OPEN");
        } catch { }
      }

      const canceledTrade = await storage.cancelTrade(tradeId);

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
            qtyLots: typeof trade.lots === "string" ? Number(trade.lots) : Number(trade.lots ?? 1),
            limitPrice: trade.limitPrice ? parseFloat(String(trade.limitPrice)) : null,
            stopPrice: trade.stopPrice ? parseFloat(String(trade.stopPrice)) : null,
            quoteBid: q?.bid ?? null,
            quoteAsk: q?.ask ?? null,
            quoteMid: q?.mid ?? null,
            quoteSpread: q?.spread ?? null,
            spreadPips: q ? calculateSpreadPips(symbol || "", q.spread, (trade as any).symbol?.pipDecimals) : null,
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
      const targetUserId = session.userId;
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
              userId: session.userId,
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

      res.json(canceledTrade);
    } catch (error) {
      console.error("Error canceling trade:", error);
      res.status(500).json({ message: "Failed to cancel trade" });
    }
  });

// Get pending trades for current user
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

app.get("/api/leaderboard", async (req: Request, res: Response) => {
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

// ====== TRADER JOURNAL API ======

const VALID_MOODS = ["confident", "calm", "anxious", "frustrated", "fearful", "greedy", "neutral"];

// Get journal entries for current user
app.get("/api/journal", ensureAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 200), 500);
    const entries = await storage.getJournalEntries(req.session.userId!, limit);
    res.json(entries);
  } catch (error) {
    console.error("Get journal error:", error);
    res.status(500).json({ message: "Failed to fetch journal entries" });
  }
});

// Create a new journal entry
app.post("/api/journal", ensureAuth, async (req: Request, res: Response) => {
  try {
    const { tradeId, tradeIds, note, mood, tags, attachmentUrl } = req.body;

    // Validate note
    const noteClean = String(note || "").trim();
    if (!noteClean || noteClean.length < 3) {
      return res.status(400).json({ message: "Note must be at least 3 characters" });
    }
    if (noteClean.length > 10000) {
      return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
    }

    // Validate mood if provided
    const moodClean = mood ? String(mood).trim().toLowerCase() : null;
    if (moodClean && !VALID_MOODS.includes(moodClean)) {
      return res.status(400).json({ message: `Invalid mood. Valid options: ${VALID_MOODS.join(", ")}` });
    }

    // Validate tradeIds array if provided - all must belong to user
    let validatedTradeIds: number[] | null = null;
    if (tradeIds !== undefined && tradeIds !== null && Array.isArray(tradeIds) && tradeIds.length > 0) {
      validatedTradeIds = [];
      for (const tid of tradeIds.slice(0, 20)) { // Limit to 20 trades
        const tradeIdNum = parseInt(tid);
        if (isNaN(tradeIdNum)) continue;
        const trade = await storage.getTradeById(tradeIdNum);
        if (trade && trade.userId === req.session.userId) {
          validatedTradeIds.push(tradeIdNum);
        }
      }
      if (validatedTradeIds.length === 0) validatedTradeIds = null;
    }

    // Legacy: Validate single tradeId if provided (backward compatibility)
    let validatedTradeId: number | null = null;
    if (!validatedTradeIds && tradeId !== undefined && tradeId !== null && tradeId !== "") {
      const tradeIdNum = parseInt(tradeId);
      if (!isNaN(tradeIdNum)) {
        const trade = await storage.getTradeById(tradeIdNum);
        if (trade && trade.userId === req.session.userId) {
          validatedTradeId = tradeIdNum;
        }
      }
    }

    // Validate tags - must be array of strings
    let validatedTags: string[] | null = null;
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) {
        return res.status(400).json({ message: "Tags must be an array" });
      }
      validatedTags = tags
        .filter((t: any) => typeof t === "string" && t.trim().length > 0)
        .map((t: string) => t.trim().toLowerCase().slice(0, 50))
        .slice(0, 20);
    }

    const entry = await storage.createJournalEntry({
      userId: req.session.userId!,
      tradeId: validatedTradeId,
      tradeIds: validatedTradeIds,
      note: noteClean,
      mood: moodClean,
      tags: validatedTags,
      attachmentUrl: attachmentUrl ? String(attachmentUrl).slice(0, 2000) : null,
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error("Create journal entry error:", error);
    res.status(500).json({ message: "Failed to create journal entry" });
  }
});

// Update a journal entry (only owner can update - enforced in storage layer via userId WHERE clause)
app.put("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
  try {
    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }

    const { note, mood, tags, attachmentUrl, tradeId, tradeIds } = req.body;
    const noteClean = note !== undefined ? String(note || "").trim() : undefined;
    const moodClean =
      mood !== undefined ? (mood ? String(mood).trim().toLowerCase() : null) : undefined;

    // Validate note if provided
    if (noteClean !== undefined) {
      if (!noteClean || noteClean.length < 3) {
        return res.status(400).json({ message: "Note must be at least 3 characters" });
      }
      if (noteClean.length > 10000) {
        return res.status(400).json({ message: "Note too long (max 10,000 characters)" });
      }
    }

    // Validate mood if provided
    if (moodClean !== undefined && moodClean !== null) {
      if (moodClean && !VALID_MOODS.includes(moodClean)) {
        return res.status(400).json({ message: `Invalid mood. Valid options: ${VALID_MOODS.join(", ")}` });
      }
    }

    let tradeIdsInput: unknown = tradeIds;
    if (typeof tradeIdsInput === "string") {
      const trimmed = tradeIdsInput.trim();
      if (!trimmed) {
        tradeIdsInput = [];
      } else {
        try {
          tradeIdsInput = JSON.parse(trimmed);
        } catch {
          tradeIdsInput = trimmed.split(",").map((v) => v.trim()).filter(Boolean);
        }
      }
    }

    let tagsInput: unknown = tags;
    if (typeof tagsInput === "string") {
      const trimmed = tagsInput.trim();
      if (!trimmed) {
        tagsInput = [];
      } else {
        try {
          tagsInput = JSON.parse(trimmed);
        } catch {
          tagsInput = trimmed.split(",").map((v) => v.trim()).filter(Boolean);
        }
      }
    }

    // Validate tradeIds array if provided - all must belong to user
    let validatedTradeIds: number[] | null | undefined = undefined;
    if (tradeIdsInput !== undefined) {
      if (tradeIdsInput === null || (Array.isArray(tradeIdsInput) && tradeIdsInput.length === 0)) {
        validatedTradeIds = null;
      } else if (Array.isArray(tradeIdsInput)) {
        validatedTradeIds = [];
        for (const tid of tradeIdsInput.slice(0, 20)) {
          const tradeIdNum = parseInt(tid);
          if (isNaN(tradeIdNum)) continue;
          const trade = await storage.getTradeById(tradeIdNum);
          if (trade && trade.userId === req.session.userId) {
            validatedTradeIds.push(tradeIdNum);
          }
        }
        if (validatedTradeIds.length === 0) validatedTradeIds = null;
      }
    }

    // Legacy: Validate single tradeId if provided (backward compatibility)
    let validatedTradeId: number | null | undefined = undefined;
    if (validatedTradeIds === undefined && tradeId !== undefined) {
      if (tradeId === null) {
        validatedTradeId = null;
      } else {
        const parsedTradeId = parseInt(tradeId);
        if (!isNaN(parsedTradeId)) {
          const trade = await storage.getTradeById(parsedTradeId);
          if (trade && trade.userId === req.session.userId!) {
            validatedTradeId = parsedTradeId;
          }
        }
      }
    }

    // Validate tags if provided
    let validatedTags: string[] | undefined = undefined;
    if (tagsInput !== undefined) {
      if (tagsInput === null) {
        validatedTags = [];
      } else if (!Array.isArray(tagsInput)) {
        return res.status(400).json({ message: "Tags must be an array" });
      } else {
        validatedTags = tagsInput
          .filter((t: any) => typeof t === "string" && t.trim().length > 0)
          .map((t: string) => t.trim().toLowerCase().slice(0, 50))
          .slice(0, 20);
      }
    }

    // Storage layer ensures only entries belonging to req.session.userId can be updated
    const updated = await storage.updateJournalEntry(entryId, req.session.userId!, {
      note: noteClean,
      mood: moodClean,
      tags: validatedTags,
      attachmentUrl: attachmentUrl !== undefined ? (attachmentUrl ? String(attachmentUrl).slice(0, 2000) : null) : undefined,
      tradeId: validatedTradeId,
      tradeIds: validatedTradeIds,
    });

    if (!updated) {
      return res.status(404).json({ message: "Entry not found or access denied" });
    }

    res.json(updated);
  } catch (error) {
    const body = req.body ?? {};
    console.error("Update journal entry error:", {
      entryId: req.params.id,
      userId: req.session.userId ?? null,
      bodyKeys: Object.keys(body),
      noteLen: typeof body.note === "string" ? body.note.trim().length : null,
      tagsType: Array.isArray(body.tags) ? "array" : body.tags === null ? "null" : typeof body.tags,
      tradeIdsType: Array.isArray(body.tradeIds) ? "array" : body.tradeIds === null ? "null" : typeof body.tradeIds,
      error,
    });
    const message = "Failed to update journal entry";
    const detail =
      process.env.NODE_ENV !== "production"
        ? (error instanceof Error ? error.message : String(error))
        : undefined;
    res.status(500).json(detail ? { message, detail } : { message });
  }
});

// Delete a journal entry (only owner can delete - enforced in storage layer via userId WHERE clause)
app.delete("/api/journal/:id", ensureAuth, async (req: Request, res: Response) => {
  try {
    const entryId = parseInt(req.params.id);
    if (isNaN(entryId)) {
      return res.status(400).json({ message: "Invalid entry ID" });
    }

    // Storage layer ensures only entries belonging to req.session.userId can be deleted
    const deleted = await storage.deleteJournalEntry(entryId, req.session.userId!);

    if (!deleted) {
      return res.status(404).json({ message: "Entry not found or access denied" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete journal entry error:", error);
    res.status(500).json({ message: "Failed to delete journal entry" });
  }
});
}
