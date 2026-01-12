/**
 * Order Engine - Processes pending orders and SL/TP for open positions
 * This engine consumes bid/ask quotes and triggers orders/stops professionally
 */

import { db } from "@db";
import { and, eq, desc, sql } from "drizzle-orm";
import { trades, users, userSettings, symbolConfigs, globalSettings } from "@shared/schema";
import { requiredMargin } from "../lib/margin";
import { recalcAccount } from "../recalcAccount";
import { publishLiveEvent } from "../services/liveBus";
import { realizedPnlUsd } from "../lib/realizedPnl";
import { appendIdentityAudit } from "../services/identityAudit";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { decidePolicy } from "@shared/policyDecision";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { 
  writeTradeAudit, 
  generateCorrelationId, 
  generateOrderId, 
  generateExecutionId, 
  generatePositionId,
  calculateSlippagePips,
  calculateSpreadPips,
  type AuditContext 
} from "../lib/auditWriter";

const DEFAULT_QUOTE_SOURCE = process.env.QUOTE_SOURCE ?? (process.env.FORGE_KEY ? "1forge" : "quotes_db");

async function getGlobalLimits() {
  const gs = await db.query.globalSettings.findFirst({
    where: eq(globalSettings.id, 1),
  });
  return {
    maxTradesPerUser: Number(gs?.maxTradesPerUser ?? 10),
    maxTradesPerInstrument: Number(gs?.maxTradesPerInstrument ?? 3),
    maxConcurrentLots: Number(gs?.maxConcurrentLots ?? 50),
    defaultLeverage: Number(gs?.defaultLeverage ?? 50),
  };
}

type Quote = {
  symbol: string;
  price?: number;
  bid?: number | null;
  ask?: number | null;
  isStale?: boolean;
  lastUpdated?: number;
};

let running = false;

function n(v: any): number | null {
  // Handle null/undefined explicitly - don't convert to 0
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function getBidAsk(q: Quote): { bid: number; ask: number; mid: number; spread: number } | null {
  const bid = n(q.bid ?? q.price);
  const ask = n(q.ask ?? q.price);
  if (bid === null || ask === null) return null;
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  return { bid, ask, mid, spread };
}

function adverseSlippage(side: "BUY" | "SELL", requested: number, fill: number): number {
  return side === "BUY" ? (fill - requested) : (requested - fill);
}

// Default system context for order engine (no user session available)
function getSystemAuditContext(
  correlationId?: string,
  provenance?: { sessionId?: string | null; ip?: string | null; userAgent?: string | null }
): AuditContext {
  return {
    correlationId,
    actorType: "SYSTEM",
    actorUserId: null,
    sessionId: provenance?.sessionId ?? null,
    ip: provenance?.ip ?? null,
    userAgent: provenance?.userAgent ?? null,
  };
}

// Institutional-grade audit for order rejections
async function auditRejection(params: {
  tradeId: number;
  correlationId: string;
  orderId: string;
  symbol: string;
  side: string;
  orderType: string;
  qtyLots: number;
  requestedPrice: number | null;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  riskCheckName: string;
  riskLimitValue: number;
  riskObservedValue: number;
  reasonCode: string;
  note: string;
}) {
  try {
    const ctx = getSystemAuditContext(params.correlationId, {
      sessionId: params.sessionId,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    await writeTradeAudit({
      tradeId: params.tradeId,
      eventType: "ORDER_REJECTED",
      eventCategory: "RISK",
      ctx,
      orderId: params.orderId,
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      qtyLots: params.qtyLots,
      requestedPrice: params.requestedPrice,
      quoteBid: params.quoteBid,
      quoteAsk: params.quoteAsk,
      quoteMid: params.quoteMid,
      quoteSpread: params.quoteSpread,
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      riskCheckName: params.riskCheckName,
      riskLimitValue: params.riskLimitValue,
      riskObservedValue: params.riskObservedValue,
      riskResult: "FAIL",
      reasonCode: params.reasonCode,
      note: params.note,
    });
  } catch (e) {
    console.error("Error writing rejection audit:", e);
  }
}

// Institutional-grade audit for order fills
async function auditFill(params: {
  tradeId: number;
  correlationId: string;
  orderId: string;
  executionId: string;
  positionId: string;
  symbol: string;
  side: string;
  orderType: string;
  qtyLots: number;
  requestedPrice: number | null;
  triggerPrice: number;
  fillPrice: number;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  latencyMs?: number;
  note?: string;
}) {
  try {
    const ctx = getSystemAuditContext(params.correlationId, {
      sessionId: params.sessionId,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const slippage = params.requestedPrice !== null 
      ? adverseSlippage(params.side as "BUY" | "SELL", params.requestedPrice, params.fillPrice) 
      : null;
    const slippagePips = slippage !== null ? calculateSlippagePips(params.symbol, slippage) : null;
    
    await writeTradeAudit({
      tradeId: params.tradeId,
      eventType: "ORDER_FILLED",
      eventCategory: "EXECUTION",
      ctx,
      orderId: params.orderId,
      executionId: params.executionId,
      positionId: params.positionId,
      symbol: params.symbol,
      side: params.side,
      orderType: params.orderType,
      qtyLots: params.qtyLots,
      requestedPrice: params.requestedPrice,
      triggerPrice: params.triggerPrice,
      fillPrice: params.fillPrice,
      avgFillPrice: params.fillPrice,
      slippage,
      slippagePips,
      slippageReference: "REQUESTED",
      latencyMs: params.latencyMs,
      quoteBid: params.quoteBid,
      quoteAsk: params.quoteAsk,
      quoteMid: params.quoteMid,
      quoteSpread: params.quoteSpread,
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      riskResult: "PASS",
      note: params.note,
    });
  } catch (e) {
    console.error("Error writing fill audit:", e);
  }
}

// Canonical close reason codes (hedge-fund grade)
import type { CloseReasonCode } from "@shared/closeReasons";

// Institutional-grade audit for position closes (SL/TP)
async function auditClose(params: {
  tradeId: number;
  correlationId: string;
  orderId: string;
  positionId: string;
  executionId: string;
  symbol: string;
  side: string;
  qtyLots: number;
  openPrice: number;
  closePrice: number;
  closeReason: CloseReasonCode;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  profit: number;
}) {
  try {
    const ctx = getSystemAuditContext(params.correlationId, {
      sessionId: params.sessionId,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const eventType = params.closeReason === "STOP_LOSS_HIT" ? "SL_TRIGGERED" 
      : params.closeReason === "TAKE_PROFIT_HIT" ? "TP_TRIGGERED" 
      : "POSITION_CLOSED";
    
    await writeTradeAudit({
      tradeId: params.tradeId,
      eventType,
      eventCategory: "POSITION",
      ctx,
      orderId: params.orderId,
      positionId: params.positionId,
      executionId: params.executionId,
      symbol: params.symbol,
      side: params.side,
      qtyLots: params.qtyLots,
      requestedPrice: params.closeReason === "STOP_LOSS_HIT" || params.closeReason === "TAKE_PROFIT_HIT" ? null : params.closePrice,
      fillPrice: params.closePrice,
      avgFillPrice: params.closePrice,
      quoteBid: params.quoteBid,
      quoteAsk: params.quoteAsk,
      quoteMid: params.quoteMid,
      quoteSpread: params.quoteSpread,
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      reasonCode: params.closeReason,
      note: `closeReason=${params.closeReason}, profit=${params.profit.toFixed(2)}`,
    });
  } catch (e) {
    console.error("Error writing close audit:", e);
  }
}

async function processPendingForSymbol(symbol: string, q: Quote) {
  const policyConfig = await loadPolicyConfig();
  const ba = getBidAsk(q);
  if (!ba) return;

  const rows = await db
    .select({
      t: trades,
      u: users,
      s: userSettings,
      sym: symbolConfigs,
    })
    .from(trades)
    .leftJoin(users, eq(trades.userId, users.id))
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
    .where(and(eq(trades.status, "PENDING"), eq(symbolConfigs.symbol, symbol)))
    .orderBy(desc(trades.openedAt));

  for (const r of rows) {
    const t = r.t;
    const u = r.u;
    if (!u) continue;

    const side = t.type as "BUY" | "SELL";
    const orderType = String(t.orderType ?? "Market");
    const orderTypeLower = orderType.toLowerCase();
    const lots = Number(t.lots ?? 1);
    const quoteTs = q.lastUpdated ? new Date(q.lastUpdated) : new Date();
    
    // Use stored correlationId for correlation continuity (hedge-fund compliance)
    const correlationId = (t as any).correlationId || generateCorrelationId();
    const orderId = (t as any).orderId || generateOrderId();
    const quoteSource = DEFAULT_QUOTE_SOURCE;
    const tradeProvenance = {
      sessionId: (t as any).lastActorSessionId ?? null,
      ip: (t as any).lastActorIp ?? null,
      userAgent: (t as any).lastActorUserAgent ?? null,
    };

    if (!(t as any).correlationId || !(t as any).orderId) {
      await db.update(trades)
        .set({ correlationId, orderId })
        .where(eq(trades.id, t.id));
    }

    const requested =
      orderTypeLower.includes("limit") ? n(t.limitPrice) :
      orderTypeLower.includes("stop") ? n(t.stopPrice) :
      null;

    if (requested === null) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: null,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "ORDER_VALIDATION",
        riskLimitValue: 0,
        riskObservedValue: 0,
        reasonCode: "MISSING_PRICE",
        note: "Missing limitPrice/stopPrice",
      });
      continue;
    }

    let triggered = false;
    let triggerPrice: number = 0;

    if (orderTypeLower.includes("limit")) {
      if (side === "BUY") { triggered = ba.ask <= requested; triggerPrice = ba.ask; }
      else { triggered = ba.bid >= requested; triggerPrice = ba.bid; }
    } else if (orderTypeLower.includes("stop")) {
      if (side === "BUY") { triggered = ba.ask >= requested; triggerPrice = ba.ask; }
      else { triggered = ba.bid <= requested; triggerPrice = ba.bid; }
    } else {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: requested,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "ORDER_VALIDATION",
        riskLimitValue: 0,
        riskObservedValue: 0,
        reasonCode: "UNKNOWN_ORDER_TYPE",
        note: `Unknown orderType=${t.orderType}`,
      });
      continue;
    }

      if (!triggered) continue;

      // Policy enforcement for pending execution (prevents exposure increase while locked/suspended)
      const policyCtx = await buildDecisionContext({
        userId: u.id,
        nowMs: Date.now(),
        request: {
          correlationId,
          actorType: "SYSTEM",
          actorUserId: null,
        },
        policyConfig,
      });
      const policyDecision = decidePolicy("TRADE_OPEN_OR_INCREASE", policyCtx, policyConfig);
      if (!policyDecision.allowed) {
        await db.update(trades)
          .set({ status: "CANCELED", closeReason: "POLICY_DENIED", closedAt: new Date() })
          .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));

        try {
          appendIdentityAudit({
            userId: u.id,
            email: u.email ?? undefined,
            category: "POLICY",
            type: "ACCOUNT_ACTION_DENIED",
            title: "Pending order blocked by policy",
            description: `Deny code: ${policyDecision.deny?.code ?? policyDecision.deny_code}`,
            actorType: "SYSTEM",
            actorUserId: null,
            correlationId,
            data: {
              action: "TRADE_OPEN_OR_INCREASE",
              deny: policyDecision.deny ?? null,
              derived: policyDecision.derived ?? null,
            },
          });
        } catch (auditErr) {
          console.error("Error writing policy deny audit (order engine):", auditErr);
        }

        await auditRejection({
          tradeId: t.id,
          correlationId,
          orderId,
          symbol,
          side,
          orderType,
          qtyLots: lots,
          requestedPrice: requested,
          quoteBid: ba.bid,
          quoteAsk: ba.ask,
          quoteMid: ba.mid,
          quoteSpread: ba.spread,
          quoteTs,
          quoteSource,
          ...tradeProvenance,
          riskCheckName: "POLICY",
          riskLimitValue: 0,
          riskObservedValue: 0,
          reasonCode: policyDecision.deny?.code ?? "POLICY_DENIED",
          note: "Order blocked by policy engine at execution time",
        });
        continue;
      }

      const fillPrice = side === "BUY" ? ba.ask : ba.bid;
    
    // Get global limits dynamically
    const globalLimits = await getGlobalLimits();
    
    // Leverage: user override takes precedence over global (can exceed)
    const effectiveLeverage = Number(u.leverage ?? globalLimits.defaultLeverage);
    const neededMargin = requiredMargin(symbol, lots, fillPrice, effectiveLeverage);

    // Check max concurrent trades using global limits (user can be stricter)
    const openCount = await db.select({ c: trades.id })
      .from(trades)
      .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN")));

    // User override takes precedence over global (can exceed)
    const effectiveMaxConcurrent = Number(r.s?.maxConcurrent ?? globalLimits.maxTradesPerUser);
    if (openCount.length >= effectiveMaxConcurrent) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: requested,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "MAX_CONCURRENT_TRADES",
        riskLimitValue: effectiveMaxConcurrent,
        riskObservedValue: openCount.length,
        reasonCode: "MAX_TRADES_EXCEEDED",
        note: `Max concurrent open trades exceeded (limit=${effectiveMaxConcurrent})`,
      });
      continue;
    }

    // Check max concurrent lots using global limits (user can be stricter)
    const openTrades = await db.select({ lots: trades.lots })
      .from(trades)
      .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN")));
    
    const currentOpenLots = openTrades.reduce((sum, ot) => sum + Number(ot.lots || 0), 0);
    // User override takes precedence over global (can exceed)
    const effectiveMaxConcurrentLots = Number(r.s?.maxConcurrentLots ?? globalLimits.maxConcurrentLots);
    
    if (currentOpenLots + lots > effectiveMaxConcurrentLots) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: requested,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "MAX_CONCURRENT_LOTS",
        riskLimitValue: effectiveMaxConcurrentLots,
        riskObservedValue: currentOpenLots + lots,
        reasonCode: "MAX_LOTS_EXCEEDED",
        note: `Max concurrent lots exceeded. Open: ${currentOpenLots}, Requested: ${lots}, Limit: ${effectiveMaxConcurrentLots}`,
      });
      console.log(`[OrderEngine] Canceled pending order ${t.id}: would exceed max concurrent lots (${currentOpenLots} + ${lots} > ${effectiveMaxConcurrentLots})`);
      continue;
    }

    // Check per-instrument cap (count OPEN + other PENDING trades for this symbol)
    const openPerSymbol = await db.select({ c: trades.id })
      .from(trades)
      .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
      .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN"), eq(symbolConfigs.symbol, symbol)));
    
    // Also count other pending orders for this symbol (excluding the current one being processed)
    const pendingPerSymbol = await db.select({ c: trades.id })
      .from(trades)
      .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
      .where(and(
        eq(trades.userId, u.id), 
        eq(trades.status, "PENDING"), 
        eq(symbolConfigs.symbol, symbol),
        sql`${trades.id} != ${t.id}` // Exclude current pending order
      ));

    // Total active per symbol = OPEN + other PENDING (current order will become OPEN if filled)
    const activePerSymbol = openPerSymbol.length + pendingPerSymbol.length;

    // User override takes precedence over global (can exceed)
    const effectiveMaxTradesPerInstrument = Number(r.s?.maxConcurrentPerInstrument ?? globalLimits.maxTradesPerInstrument);

    // If filling this order would exceed the limit, reject it
    if (activePerSymbol >= effectiveMaxTradesPerInstrument) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: requested,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "MAX_TRADES_PER_INSTRUMENT",
        riskLimitValue: effectiveMaxTradesPerInstrument,
        riskObservedValue: activePerSymbol,
        reasonCode: "MAX_PER_INSTRUMENT_EXCEEDED",
        note: `Max trades per instrument exceeded (OPEN=${openPerSymbol.length}, PENDING=${pendingPerSymbol.length}, limit=${effectiveMaxTradesPerInstrument})`,
      });
      continue;
    }

    // Margin check
    const freeMargin = Number(u.freeMargin ?? 0);
    if (freeMargin < neededMargin) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: new Date() })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        side,
        orderType,
        qtyLots: lots,
        requestedPrice: requested,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        riskCheckName: "MARGIN_CHECK",
        riskLimitValue: neededMargin,
        riskObservedValue: freeMargin,
        reasonCode: "INSUFFICIENT_MARGIN",
        note: "Insufficient free margin at execution",
      });
      continue;
    }

    const executionId = generateExecutionId();
    const positionId = (t as any).positionId || generatePositionId();
    const now = new Date();

    // Fill the order
    const updated = await db.update(trades)
      .set({
        status: "OPEN",
        executedAt: now,
        openPrice: fillPrice,
        correlationId,
        orderId,
        positionId,
        lastExecutionId: executionId,
        lastActorType: "SYSTEM",
        lastActorUserId: null,
        lastActorSessionId: null,
        lastActorIp: null,
        lastActorUserAgent: null,
      })
      .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")))
      .returning();

    if (updated.length === 0) continue;

    await auditFill({
      tradeId: t.id,
      correlationId,
      orderId,
      executionId,
      positionId,
      symbol,
      side,
      orderType,
      qtyLots: lots,
      requestedPrice: requested,
      triggerPrice,
      fillPrice,
      quoteBid: ba.bid,
      quoteAsk: ba.ask,
      quoteMid: ba.mid,
      quoteSpread: ba.spread,
      quoteTs,
      quoteSource,
      ...tradeProvenance,
      note: `orderType=${t.orderType}`,
    });

    await recalcAccount(u.id, { emit: true, reason: "PENDING_ORDER_FILLED" });
    publishLiveEvent({
      type: "trades:updated",
      userId: u.id,
      payload: { reason: "PENDING_ORDER_FILLED", tradeId: t.id },
    });
    console.log(`[OrderEngine] Filled pending order: trade=${t.id} type=${t.orderType} fillPrice=${fillPrice}`);
  }
}

async function processStopsForOpenTrades(symbol: string, q: Quote) {
  const ba = getBidAsk(q);
  if (!ba) return;

  const openRows = await db
    .select({ t: trades, u: users, sym: symbolConfigs })
    .from(trades)
    .leftJoin(users, eq(trades.userId, users.id))
    .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
    .where(and(eq(trades.status, "OPEN"), eq(symbolConfigs.symbol, symbol)));

  for (const r of openRows) {
    const t = r.t;
    const u = r.u;
    if (!u) continue;

    const side = t.type as "BUY" | "SELL";
    const sl = n(t.stopLoss);
    const tp = n(t.takeProfit);

    // Close price: BUY closes at bid, SELL closes at ask
    const closePx = side === "BUY" ? ba.bid : ba.ask;

    let reason: CloseReasonCode | null = null;

    if (side === "BUY") {
      if (sl !== null && ba.bid <= sl) reason = "STOP_LOSS_HIT";
      else if (tp !== null && ba.bid >= tp) reason = "TAKE_PROFIT_HIT";
    } else {
      if (sl !== null && ba.ask >= sl) reason = "STOP_LOSS_HIT";
      else if (tp !== null && ba.ask <= tp) reason = "TAKE_PROFIT_HIT";
    }

    if (!reason) continue;

    const lots = Number(t.lots ?? 1);
    const openPx = Number(t.openPrice);
    const quoteTs = q.lastUpdated ? new Date(q.lastUpdated) : new Date();
    const quoteSource = DEFAULT_QUOTE_SOURCE;
    const tradeProvenance = {
      sessionId: (t as any).lastActorSessionId ?? null,
      ip: (t as any).lastActorIp ?? null,
      userAgent: (t as any).lastActorUserAgent ?? null,
    };

    // Use proper P/L calculation
    const pnlUsd = await realizedPnlUsd({
      symbol,
      side,
      lots,
      openPrice: openPx,
      closePrice: closePx,
    });
    const profitNum = pnlUsd;
    const profit = profitNum.toFixed(2);

    const correlationId = (t as any).correlationId || generateCorrelationId();
    const orderId = (t as any).orderId || generateOrderId();
    const positionId = (t as any).positionId || generatePositionId();
    const executionId = generateExecutionId();
    const closedAt = new Date();

    const closed = await db.update(trades)
      .set({
        status: "CLOSED",
        closePrice: closePx,
        profit,
        closeReason: reason,
        closedAt,
        correlationId,
        orderId,
        positionId,
        lastExecutionId: executionId,
        lastActorType: "SYSTEM",
        lastActorUserId: null,
        lastActorSessionId: null,
        lastActorIp: null,
        lastActorUserAgent: null,
      })
      .where(and(eq(trades.id, t.id), eq(trades.status, "OPEN")))
      .returning();

    if (closed.length === 0) continue;

    // Update balance
    const newBalance = (Number(u.balance) + Number(profit)).toFixed(2);
    await db.update(users).set({ balance: newBalance }).where(eq(users.id, u.id));

    await auditClose({
      tradeId: t.id,
      correlationId,
      orderId,
      positionId,
      executionId,
      symbol,
      side,
      qtyLots: lots,
      openPrice: openPx,
      closePrice: closePx,
      closeReason: reason,
      quoteBid: ba.bid,
      quoteAsk: ba.ask,
      quoteMid: ba.mid,
      quoteSpread: ba.spread,
      quoteTs,
      quoteSource,
      ...tradeProvenance,
      profit: profitNum,
    });

    await recalcAccount(u.id, { emit: true, reason: reason ?? "STOP_TAKE_PROFIT" });
    publishLiveEvent({
      type: "trades:updated",
      userId: u.id,
      payload: { reason: reason ?? "STOP_TAKE_PROFIT", tradeId: t.id },
    });
    console.log(`[OrderEngine] Closed position via ${reason}: trade=${t.id} profit=${profit}`);
  }
}

export async function onQuotesUpdated(quotes: Quote[]) {
  if (running) return;
  running = true;
  try {
    for (const q of quotes) {
      if (!q?.symbol) continue;
      if (q.isStale) continue;

      const symbol = String(q.symbol).toUpperCase();
      await processPendingForSymbol(symbol, q);
      await processStopsForOpenTrades(symbol, q);
    }
  } finally {
    running = false;
  }
}
