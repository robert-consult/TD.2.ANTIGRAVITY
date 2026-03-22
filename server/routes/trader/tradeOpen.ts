import type { Router, NextFunction, Request, Response } from "express";
import type { SessionData } from "express-session";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { insertTradeSchema, systemConfig, trades, users } from "@shared/schema";
import { getPipSize, getQuoteDecimals } from "@shared/pips";
import { nowSec as nowUnixSec, toFiniteNumber } from "@shared/scalars";
import {
  MARKET_TIME_IN_FORCE_VALUES,
  PENDING_TIME_IN_FORCE_VALUES,
  parseTimeInForce,
  requiresExplicitExpiry,
  resolvePendingOrderExpirySec,
} from "@shared/trading/timeInForce";
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
import {
  resolveEffectiveTradeLeverage,
  resolveTradeConcurrencyLimits,
  resolveTradingRiskConfig,
} from "../../services/runtimeConfig/tradingRisk";

export function registerTradeOpenRoute(router: Router, deps: TraderRouterDeps) {
  const { ensureAuth, ensureDoc1TermsAccepted, broadcast } = deps;
  const marketTimeInForceValues = new Set<string>(MARKET_TIME_IN_FORCE_VALUES);
  const pendingTimeInForceValues = new Set<string>(PENDING_TIME_IN_FORCE_VALUES);
  router.post(
  "/api/trades",
  ensureAuth,
  ensureDoc1TermsAccepted,
  requirePolicy((req) => {
    const body = req.body as { orderType?: unknown } | undefined;
    const orderType = String(body?.orderType ?? "Market").toLowerCase();
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
      const {
        symbol,
        type,
        lots,
        size,
        orderType,
        limitPrice,
        stopPrice,
        timeInForce: rawTimeInForce,
        expiresAt: rawExpiresAt,
      } = req.body;
      const orderSize = size ?? lots;

      if (typeof orderSize !== "number") {
        return res.status(400).json({ message: "size (lots) must be numeric" });
      }

      const parsedTimeInForce = parseTimeInForce(rawTimeInForce);
      if (
        rawTimeInForce !== undefined &&
        rawTimeInForce !== null &&
        String(rawTimeInForce).trim() !== "" &&
        parsedTimeInForce == null
      ) {
        return res.status(400).json({
          message: `timeInForce must be one of ${[...MARKET_TIME_IN_FORCE_VALUES, "DAY", "GTD"].join(", ")}`,
        });
      }
      const timeInForce = parsedTimeInForce ?? "GTC";

      const normalizedOrderType = String(orderType ?? "Market").toUpperCase();
      const isLimitOrder =
        normalizedOrderType === "LIMIT" ||
        normalizedOrderType === "BUY_LIMIT" ||
        normalizedOrderType === "SELL_LIMIT";
      const isStopOrder =
        normalizedOrderType === "STOP" ||
        normalizedOrderType === "BUY_STOP" ||
        normalizedOrderType === "SELL_STOP";
      const isPendingOrder = isLimitOrder || isStopOrder;
      const expiresAt = resolvePendingOrderExpirySec({
        timeInForce,
        expiresAt: rawExpiresAt,
        nowMs: receivedAtMs,
      });

      // Validate request data
      const data = insertTradeSchema.parse({
        ...req.body,
        userId,
        openedAt: nowUnixSec(),
        lots: orderSize,
        timeInForce,
        expiresAt,
      });
      const tradeSideRaw = String(data.type ?? req.body.type ?? "").toUpperCase();
      if (tradeSideRaw !== "BUY" && tradeSideRaw !== "SELL") {
        return res.status(400).json({ message: "Invalid trade side. Expected BUY or SELL." });
      }
      const tradeSide: "BUY" | "SELL" = tradeSideRaw;

      let tradeLots = 1;
      if (data.lots !== undefined) {
        tradeLots = typeof data.lots === "string" ? Number.parseInt(data.lots, 10) : Number(data.lots);
      } else if (data.size) {
        tradeLots = Math.floor(Number(data.size) / 100000);
      }

      // Get current symbol price from our memory-based quotes
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
      const limitPriceValue = toFiniteNumber(limitPrice);
      const stopPriceValue = toFiniteNumber(stopPrice);
      const takeProfitValue = toFiniteNumber(req.body.takeProfit);
      const stopLossValue = toFiniteNumber(req.body.stopLoss);
      const quoteBid = toFiniteNumber(quote.bid);
      const quoteAsk = toFiniteNumber(quote.ask);
      const quoteMid = toFiniteNumber(quote.mid ?? quote.price);
      const requestedPrice = limitPriceValue ?? stopPriceValue ?? quoteMid;

      const commonOrderIntentAudit = {
        correlationId,
        ctx: auditCtx,
        userId,
        symbol: symbolConfig.symbol,
        side: tradeSide,
        orderType: orderType ?? "Market",
        timeInForce,
        qtyLots: tradeLots,
        requestedPrice,
        limitPrice: limitPriceValue,
        stopPrice: stopPriceValue,
        takeProfit: takeProfitValue,
        stopLoss: stopLossValue,
        quoteBid,
        quoteAsk,
        quoteMid,
        quoteTs,
        quoteIsStale: quote.isStale ?? false,
      } as const;

      const writeDecisionReject = async (
        rejectReason: string,
        riskLimit: Record<string, unknown> = {},
        riskObserved: Record<string, unknown> = {},
        extraPayload: Record<string, unknown> = {},
      ) => {
        try {
          await writeOrderIntentAudit({
            ...commonOrderIntentAudit,
            eventCode: "DECISION",
            decision: "REJECT",
            rejectReason,
            riskLimit,
            riskObserved,
            payload: {
              rejectReason,
              latencyMs: Date.now() - receivedAtMs,
              quoteSource,
              ...extraPayload,
            },
          });
        } catch (auditErr) {
          console.error("Error writing DECISION REJECT audit:", auditErr);
        }
      };

      if (isPendingOrder) {
        if (!pendingTimeInForceValues.has(timeInForce)) {
          await writeDecisionReject(
            "INVALID_PENDING_TIME_IN_FORCE",
            { allowedTimeInForce: PENDING_TIME_IN_FORCE_VALUES },
            { timeInForce },
          );
          return res.status(400).json({
            message: `Pending orders support ${PENDING_TIME_IN_FORCE_VALUES.join(", ")} timeInForce values`,
          });
        }
        if (requiresExplicitExpiry(timeInForce) && expiresAt == null) {
          await writeDecisionReject("GTD_EXPIRY_REQUIRED", {}, { timeInForce });
          return res.status(400).json({ message: "GTD pending orders require an expiresAt value" });
        }
        if (expiresAt != null && expiresAt <= nowUnixSec()) {
          await writeDecisionReject("INVALID_PENDING_EXPIRY", {}, { timeInForce, expiresAt });
          return res.status(400).json({ message: "expiresAt must be in the future" });
        }
      } else if (!marketTimeInForceValues.has(timeInForce)) {
        await writeDecisionReject(
          "INVALID_MARKET_TIME_IN_FORCE",
          { allowedTimeInForce: MARKET_TIME_IN_FORCE_VALUES },
          { timeInForce },
        );
        return res.status(400).json({
          message: `Market orders support ${MARKET_TIME_IN_FORCE_VALUES.join(", ")} timeInForce values`,
        });
      }

      try {
        await writeOrderIntentAudit({
          ...commonOrderIntentAudit,
          eventCode: "ORDER_RECEIVED",
          payload: { rawBody: req.body, receivedAtMs, quoteSource, expiresAt },
        });
      } catch (auditErr) {
        console.error("Error writing ORDER_RECEIVED audit:", auditErr);
      }

      if (quote.isStale === true) {
        await writeDecisionReject("STALE_QUOTE", {}, {}, { quoteSource });
        return res.status(503).json({
          code: "QUOTE_STALE",
          message: "Quote is stale. Cannot open trade until fresh quotes are available.",
          symbol: symbolConfig.symbol,
          isStale: true,
        });
      }

      let entryPrice;
      if (tradeSide === "BUY") {
        entryPrice = quote.ask !== undefined ? Number(quote.ask) : Number(quote.price);
      } else {
        entryPrice = quote.bid !== undefined ? Number(quote.bid) : Number(quote.price);
      }

      if (isNaN(tradeLots) || tradeLots < 1 || tradeLots > 50) {
        await writeDecisionReject("INVALID_LOTS", { minLots: 1, maxLots: 50 }, { requestedLots: tradeLots });
        return res.status(400).json({
          message: "Invalid input data",
          errors: [
            { code: "custom", message: "Lots must be between 1 and 50", path: ["lots"] },
            { code: "too_big", maximum: 50, type: "number", inclusive: true, message: "Lots must be less than or equal to 50", path: ["lots"] },
          ],
        });
      }

      // Calculate position size from lots (1 lot = $100,000)
      const CONTRACT_SIZE = 100000;
      const positionSize = tradeLots * CONTRACT_SIZE;
      const openCostSummary = computeOpenSideCosts({
        category: symbolConfig.category,
        notionalUsd: positionSize,
        lots: tradeLots,
        size: positionSize,
        positionSide: tradeSide,
      });

      // Enforce global maxPositionSize limit
      const gs = await getGlobalSettingsCached();
      const tradingRisk = resolveTradingRiskConfig(gs);
      const maxPositionSize = tradingRisk.maxPositionSize;
      const minPriceDistancePips = tradingRisk.minPriceDistancePips;
      if (positionSize > maxPositionSize) {
        await writeDecisionReject("POSITION_SIZE_EXCEEDED", { maxPositionSize }, { positionSize });
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

      const orderId = generateOrderId();
      const positionId = generatePositionId();
      const openExecutionId = isPendingOrder ? null : generateExecutionId();

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
          category: symbolConfig.category,
          quoteCurrency: symbolConfig.quoteCurrency,
          pipDecimals: symbolConfig.pipDecimals,
          quoteDecimals: symbolConfig.quoteDecimals,
        });
        const priceDecimals = getQuoteDecimals({
          symbol: symbolConfig.symbol,
          category: symbolConfig.category,
          quoteCurrency: symbolConfig.quoteCurrency,
          pipDecimals: symbolConfig.pipDecimals,
          quoteDecimals: symbolConfig.quoteDecimals,
        });
        const minDist = minPriceDistancePips * pipSize;
        const bid = quote.bid !== undefined ? parseFloat(String(quote.bid)) : entryPrice;
        const ask = quote.ask !== undefined ? parseFloat(String(quote.ask)) : entryPrice;

        if (isLimitOrder) {
          const reqPrice = limitPriceValue!;
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
          const reqPrice = stopPriceValue!;
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
        const intendedEntry = isLimitOrder ? limitPriceValue! : stopPriceValue!;
        const tp = takeProfitValue;
        const sl = stopLossValue;
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
          category: symbolConfig.category,
          quoteCurrency: symbolConfig.quoteCurrency,
          pipDecimals: symbolConfig.pipDecimals,
          quoteDecimals: symbolConfig.quoteDecimals,
        });
        const priceDecimals = getQuoteDecimals({
          symbol: symbolConfig.symbol,
          category: symbolConfig.category,
          quoteCurrency: symbolConfig.quoteCurrency,
          pipDecimals: symbolConfig.pipDecimals,
          quoteDecimals: symbolConfig.quoteDecimals,
        });
        const minDist = minPriceDistancePips * pipSize;
        const tp = takeProfitValue;
        const sl = stopLossValue;
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
        ? (limitPriceValue ?? stopPriceValue ?? entryPrice)
        : entryPrice;

      // Get global settings for leverage cascade
      // Effective leverage: user override takes precedence over global
      const challengeTradeConstraints = await getActiveTradeConstraintsForUser(userId);
      const effectiveLeverage = resolveEffectiveTradeLeverage(
        tradingRisk,
        updatedUser.leverage,
        challengeTradeConstraints?.leverageMultiplier,
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
        await writeDecisionReject(
          "INSUFFICIENT_MARGIN",
          { marginRequired: neededMargin },
          { freeMargin: Number(updatedUser.freeMargin) },
        );
        return res.status(400).json({ message: "Not enough margin available" });
      }

      // Check max concurrent lots limit (includes both OPEN and PENDING orders)
      const userSettingsData = await storage.getUserSettingsById(userId);
      const effectiveMaxConcurrentLots = resolveTradeConcurrencyLimits(
        tradingRisk,
        userSettingsData ?? null,
      ).maxConcurrentLots;

      // Create trade with appropriate price and status based on order type
      // Market orders: OPEN immediately at current price
      // Limit/Stop orders: PENDING, waiting for price trigger
      const createdAtSec = nowUnixSec();
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
            timeInForce,
            expiresAt,
            limitPrice: isLimitOrder ? limitPriceValue : null,
            stopPrice: isStopOrder ? stopPriceValue : null,
            status: isPendingOrder ? "PENDING" : "OPEN",
            executedAt: isPendingOrder ? undefined : createdAtSec,
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
        await writeDecisionReject(
          "MAX_CONCURRENT_LOTS_EXCEEDED",
          { maxConcurrentLots: effectiveMaxConcurrentLots },
          { currentLots: currentTotalLots, requestedLots: tradeLots },
          { openLots, pendingLots },
        );
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
          ...commonOrderIntentAudit,
          eventCode: "DECISION",
          decision: "PASS",
          requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
          riskLimit: { maxConcurrentLots: effectiveMaxConcurrentLots, marginRequired: neededMargin },
          riskObserved: { currentLots: currentTotalLots, freeMargin: Number(updatedUser.freeMargin) },
          payload: {
            tradeId: trade.id,
            latencyMs,
            status: trade.status,
            quoteSource,
            expiresAt,
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
          timeInForce,
          qtyLots: tradeLots,
          requestedPrice: isPendingOrder ? priceForMargin : entryPrice,
          limitPrice: isLimitOrder ? limitPriceValue : null,
          stopPrice: isStopOrder ? stopPriceValue : null,
          quoteBid,
          quoteAsk,
          quoteMid,
          quoteTs,
          quoteSource,
          latencyMs,
          riskResult: "PASS",
          note: isPendingOrder ? `Pending ${normalizedOrderType}` : "Market order placed",
          payload: {
            normalizedOrderType,
            timeInForce,
            expiresAt,
            limitPrice: isLimitOrder ? limitPriceValue : null,
            stopPrice: isStopOrder ? stopPriceValue : null,
            takeProfit: takeProfitValue,
            stopLoss: stopLossValue,
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
            timeInForce,
            qtyLots: tradeLots,
            requestedPrice,
            fillPrice: entryPrice,
            avgFillPrice: entryPrice,
            quoteBid,
            quoteAsk,
            quoteMid,
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
              timeInForce,
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
