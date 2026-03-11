/**
 * Order Engine - Processes pending orders and SL/TP for open positions
 * This engine consumes bid/ask quotes and triggers orders/stops professionally
 */

import { db } from "@db";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { trades, users, userSettings, symbolConfigs, globalSettings } from "@shared/schema";
import { nowSec as nowUnixSec, toFiniteNumber } from "@shared/scalars";
import { normalizeTimeInForce } from "@shared/trading/timeInForce";
import { requiredMargin } from "../lib/margin";
import { recalcAccount } from "../recalcAccount";
import { publishLiveEvent } from "../services/liveBus";
import { realizedPnlUsd } from "../lib/realizedPnl";
import { appendIdentityAudit } from "../services/identityAudit";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { decidePolicy } from "@shared/policyDecision";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { applyUserBalanceDelta, releaseUserMargin, reserveUserMargin } from "../services/tradeAtomic";
import { computeCloseSettlementCosts, computeOpenSideCosts } from "../services/tradeCosts";
import { createNotification } from "../services/messaging";
import {
  clearTradeExcursion,
  initTradeExcursion,
  resolveTradeExcursionForCloseDurable,
  trackTradeExcursion,
} from "../trades/excursionTracking";
import { getActiveTradeConstraintsForUser } from "../recruitment/challengesV4/challengeService";
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

const DEFAULT_QUOTE_SOURCE = process.env.QUOTE_SOURCE ?? "quote_feed";

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
  source?: string;
};

let running = false;
let lastPendingExpirySweepSec = 0;

export function resetOrderEngineForTests(): void {
  running = false;
  lastPendingExpirySweepSec = 0;
}

function n(v: any): number | null {
  return toFiniteNumber(v);
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
  pipDecimals?: number | null;
  side: string;
  orderType: string;
  timeInForce?: string | null;
  qtyLots: number;
  requestedPrice: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: number | Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  latencyMs?: number;
  riskCheckName: string;
  riskLimitValue: number;
  riskObservedValue: number;
  reasonCode: string;
  note: string;
}, opts?: { db?: any }) {
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
      timeInForce: params.timeInForce ?? null,
      qtyLots: params.qtyLots,
      requestedPrice: params.requestedPrice,
      limitPrice: params.limitPrice ?? null,
      stopPrice: params.stopPrice ?? null,
      latencyMs: params.latencyMs ?? null,
      quoteBid: params.quoteBid,
      quoteAsk: params.quoteAsk,
      quoteMid: params.quoteMid,
      quoteSpread: params.quoteSpread,
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread, params.pipDecimals),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      riskCheckName: params.riskCheckName,
      riskLimitValue: params.riskLimitValue,
      riskObservedValue: params.riskObservedValue,
      riskResult: "FAIL",
      reasonCode: params.reasonCode,
      note: params.note,
    }, opts);
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
  pipDecimals?: number | null;
  side: string;
  orderType: string;
  timeInForce?: string | null;
  qtyLots: number;
  requestedPrice: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  triggerPrice: number;
  fillPrice: number;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: number | Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  latencyMs?: number;
  note?: string;
  payload?: any;
}, opts?: { db?: any }) {
  try {
    const ctx = getSystemAuditContext(params.correlationId, {
      sessionId: params.sessionId,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    const slippage = params.requestedPrice !== null 
      ? adverseSlippage(params.side as "BUY" | "SELL", params.requestedPrice, params.fillPrice) 
      : null;
    const slippagePips = slippage !== null ? calculateSlippagePips(params.symbol, slippage, params.pipDecimals) : null;
    
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
      timeInForce: params.timeInForce ?? null,
      qtyLots: params.qtyLots,
      requestedPrice: params.requestedPrice,
      limitPrice: params.limitPrice ?? null,
      stopPrice: params.stopPrice ?? null,
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
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread, params.pipDecimals),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      riskResult: "PASS",
      note: params.note,
      payload: params.payload ?? null,
    }, opts);
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
  pipDecimals?: number | null;
  side: string;
  qtyLots: number;
  openPrice: number;
  closePrice: number;
  closeReason: CloseReasonCode;
  quoteBid: number;
  quoteAsk: number;
  quoteMid: number;
  quoteSpread: number;
  quoteTs: number | Date;
  quoteSource?: string;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  profit: number;
  payload?: any;
}, opts?: { db?: any }) {
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
      spreadPips: calculateSpreadPips(params.symbol, params.quoteSpread, params.pipDecimals),
      quoteTs: params.quoteTs,
      quoteSource: params.quoteSource ?? DEFAULT_QUOTE_SOURCE,
      reasonCode: params.closeReason,
      note: `closeReason=${params.closeReason}, profit=${params.profit.toFixed(2)}`,
      payload: params.payload ?? null,
    }, opts);
  } catch (e) {
    console.error("Error writing close audit:", e);
  }
}

async function expirePendingOrders(nowSec: number) {
  const rows = await db
    .select({ t: trades, u: users, sym: symbolConfigs })
    .from(trades)
    .leftJoin(users, eq(trades.userId, users.id))
    .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
    .where(and(eq(trades.status, "PENDING"), lte(trades.expiresAt, nowSec)));

  for (const row of rows) {
    const t = row.t;
    const u = row.u;
    if (!u) continue;

    const symbol = row.sym?.symbol ?? "UNKNOWN";
    const side = String(t.type ?? "");
    const orderType = String(t.orderType ?? "Market");
    const orderTypeLower = orderType.toLowerCase();
    const correlationId = (t as any).correlationId || generateCorrelationId();
    const orderId = (t as any).orderId || generateOrderId();
    const requestedPrice =
      orderTypeLower.includes("limit") ? n(t.limitPrice)
      : orderTypeLower.includes("stop") ? n(t.stopPrice)
      : n(t.openPrice);
    const limitPrice = n(t.limitPrice);
    const stopPrice = n(t.stopPrice);
    const timeInForce = normalizeTimeInForce((t as any).timeInForce, "GTC");
    const openedAtSec = Number(t.openedAt ?? 0);
    const latencyMs = Number.isFinite(openedAtSec) && openedAtSec > 0
      ? Math.max(0, Date.now() - openedAtSec * 1000)
      : null;
    const positionId = (t as any).positionId ? String((t as any).positionId) : undefined;
    const provenance = {
      sessionId: (t as any).lastActorSessionId ?? null,
      ip: (t as any).lastActorIp ?? null,
      userAgent: (t as any).lastActorUserAgent ?? null,
    };

    const expired = await db.update(trades)
      .set({
        status: "CANCELED",
        closeReason: "EXPIRED_PENDING_ORDER",
        closedAt: nowSec,
        correlationId,
        orderId,
      })
      .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")))
      .returning({ id: trades.id });

    if (!expired.length) continue;

    try {
      await writeTradeAudit({
        tradeId: t.id,
        eventType: "ORDER_CANCELED",
        eventCategory: "ORDER",
        ctx: getSystemAuditContext(correlationId, provenance),
        orderId,
        positionId,
        symbol,
        side,
        orderType,
        timeInForce,
        qtyLots: Number(t.lots ?? 1),
        requestedPrice,
        limitPrice,
        stopPrice,
        latencyMs,
        reasonCode: "EXPIRED_PENDING_ORDER",
        note: `Pending ${orderType} expired before fill`,
        payload: {
          expiresAt: (t as any).expiresAt ?? null,
          timeInForce,
        },
      });
    } catch (auditErr) {
      console.error("Error writing pending-order expiry audit:", auditErr);
    }

    publishLiveEvent({
      type: "trades:updated",
      userId: u.id,
      payload: { reason: "PENDING_ORDER_EXPIRED", tradeId: t.id },
    });
    void createNotification({
      userId: u.id,
      type: "TRADE",
      severity: "WARNING",
      title: "Pending order expired",
      message: `Pending ${orderType} for ${symbol} expired before execution.`,
      sourceEvent: `PENDING_ORDER_EXPIRED:${t.id}:${nowSec}`,
      link: "/",
      playSound: false,
    }).catch((err) => {
      console.error("[notifications] failed to create pending-expiry notification:", err);
    });
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
    const nowSec = Math.floor(Date.now() / 1000);

    const side = t.type as "BUY" | "SELL";
    const orderType = String(t.orderType ?? "Market");
    const orderTypeLower = orderType.toLowerCase();
    const lots = Number(t.lots ?? 1);
    const quoteTs = q.lastUpdated ? new Date(q.lastUpdated) : new Date();
    const pipDecimals = r.sym?.pipDecimals ?? null;
    const timeInForce = normalizeTimeInForce((t as any).timeInForce, "GTC");
    const limitPrice = n(t.limitPrice);
    const stopPrice = n(t.stopPrice);
    const openedAtSec = Number(t.openedAt ?? 0);
    const latencyMs =
      Number.isFinite(openedAtSec) && openedAtSec > 0
        ? Math.max(0, Date.now() - openedAtSec * 1000)
        : undefined;
    
    // Use stored correlationId for correlation continuity (hedge-fund compliance)
    const correlationId = (t as any).correlationId || generateCorrelationId();
    const orderId = (t as any).orderId || generateOrderId();
    const quoteSource = typeof q.source === "string" && q.source.trim() ? q.source.trim() : DEFAULT_QUOTE_SOURCE;
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
      orderTypeLower.includes("limit") ? limitPrice :
      orderTypeLower.includes("stop") ? stopPrice :
      null;

    if (requested === null) {
      await db.update(trades)
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: nowSec })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        pipDecimals,
        side,
        orderType,
        timeInForce,
        qtyLots: lots,
        requestedPrice: null,
        limitPrice,
        stopPrice,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        latencyMs,
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
        .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: nowSec })
        .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")));
      await auditRejection({
        tradeId: t.id,
        correlationId,
        orderId,
        symbol,
        pipDecimals,
        side,
        orderType,
        timeInForce,
        qtyLots: lots,
        requestedPrice: requested,
        limitPrice,
        stopPrice,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        latencyMs,
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
          .set({ status: "CANCELED", closeReason: "POLICY_DENIED", closedAt: nowSec })
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
          pipDecimals,
          side,
          orderType,
          timeInForce,
          qtyLots: lots,
          requestedPrice: requested,
          limitPrice,
          stopPrice,
          quoteBid: ba.bid,
          quoteAsk: ba.ask,
          quoteMid: ba.mid,
          quoteSpread: ba.spread,
          quoteTs,
          quoteSource,
          ...tradeProvenance,
          latencyMs,
          riskCheckName: "POLICY",
          riskLimitValue: 0,
          riskObservedValue: 0,
          reasonCode: policyDecision.deny?.code ?? "POLICY_DENIED",
          note: "Order blocked by policy engine at execution time",
        });
        continue;
      }

      const fillPrice = side === "BUY" ? ba.ask : ba.bid;
      const openCostSummary = computeOpenSideCosts({
        category: (t as any).categorySnapshot ?? r.sym?.category,
        notionalUsd: (t as any).notionalUsd,
        size: Number((t as any).size ?? lots * 100000),
        lots,
        positionSide: side,
      });

    // Get global limits dynamically
    const globalLimits = await getGlobalLimits();
    // User override takes precedence over global (can exceed)
    const effectiveMaxConcurrent = Number(r.s?.maxConcurrent ?? globalLimits.maxTradesPerUser);
    const effectiveMaxConcurrentLots = Number(r.s?.maxConcurrentLots ?? globalLimits.maxConcurrentLots);
    const effectiveMaxTradesPerInstrument = Number(r.s?.maxConcurrentPerInstrument ?? globalLimits.maxTradesPerInstrument);
    const challengeConstraints = await getActiveTradeConstraintsForUser(u.id);
    const challengeLeverageMultiplier = Math.max(0.01, Number(challengeConstraints?.leverageMultiplier ?? 1));
    // Leverage: user override takes precedence over global (can exceed)
    const effectiveLeverage = Math.max(
      0.01,
      Number(u.leverage ?? globalLimits.defaultLeverage) * challengeLeverageMultiplier,
    );

    const executionId = generateExecutionId();
    const positionId = (t as any).positionId || generatePositionId();

    const fillResult = await db.transaction(async (tx) => {
      const tradeLock = await tx.execute(sql`
        select id
        from trades
        where id = ${t.id} and status = 'PENDING'
        for update
      `);
      if (!tradeLock.rows.length) return { action: "SKIP" as const };

      const userRowRes = await tx.execute(sql`
        select id, free_margin, leverage
        from users
        where id = ${u.id}
        for update
      `);
      const userRow = userRowRes.rows[0] as any;
      const freeMargin = Number(userRow?.free_margin ?? 0);
      const leverageNow = Number(userRow?.leverage ?? effectiveLeverage);
      const neededMarginNow = requiredMargin(symbol, lots, fillPrice, leverageNow);

      const cancelPendingWithAudit = async (params: {
        riskCheckName: string;
        riskLimitValue: number;
        riskObservedValue: number;
        reasonCode: string;
        note: string;
      }) => {
        const canceled = await tx.update(trades)
          .set({ status: "CANCELED", closeReason: "ORDER_REJECTED", closedAt: nowSec, correlationId, orderId })
          .where(and(eq(trades.id, t.id), eq(trades.status, "PENDING")))
          .returning({ id: trades.id });
        if (!canceled.length) return false;

        await auditRejection({
          tradeId: t.id,
          correlationId,
          orderId,
          symbol,
          pipDecimals,
          side,
          orderType,
          timeInForce,
          qtyLots: lots,
          requestedPrice: requested,
          limitPrice,
          stopPrice,
          quoteBid: ba.bid,
          quoteAsk: ba.ask,
          quoteMid: ba.mid,
          quoteSpread: ba.spread,
          quoteTs,
          quoteSource,
          ...tradeProvenance,
          latencyMs,
          riskCheckName: params.riskCheckName,
          riskLimitValue: params.riskLimitValue,
          riskObservedValue: params.riskObservedValue,
          reasonCode: params.reasonCode,
          note: params.note,
        }, { db: tx });
        return true;
      };

      // Under user lock, recompute limits to avoid TOC/TOU races with market-order placement.
      const openCountRows = await tx
        .select({ c: trades.id })
        .from(trades)
        .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN")));
      const openCount = openCountRows.length;

      if (challengeConstraints?.maxLotSize != null && lots > challengeConstraints.maxLotSize) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "CHALLENGE_MAX_LOT_SIZE",
          riskLimitValue: challengeConstraints.maxLotSize,
          riskObservedValue: lots,
          reasonCode: "CHALLENGE_MAX_LOT_SIZE",
          note: `Challenge max lot size exceeded (requested=${lots}, limit=${challengeConstraints.maxLotSize})`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      if (challengeConstraints?.restrictedSymbols?.has(symbol)) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "CHALLENGE_RESTRICTED_SYMBOL",
          riskLimitValue: 1,
          riskObservedValue: 1,
          reasonCode: "CHALLENGE_RESTRICTED_SYMBOL",
          note: `Challenge restricted symbol blocked execution for ${symbol}`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      if (
        challengeConstraints?.maxConcurrentPositions != null &&
        openCount >= challengeConstraints.maxConcurrentPositions
      ) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "CHALLENGE_MAX_CONCURRENT_POSITIONS",
          riskLimitValue: challengeConstraints.maxConcurrentPositions,
          riskObservedValue: openCount,
          reasonCode: "CHALLENGE_MAX_CONCURRENT_POSITIONS",
          note: `Challenge max concurrent positions exceeded (open=${openCount}, limit=${challengeConstraints.maxConcurrentPositions})`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      if (openCount >= effectiveMaxConcurrent) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "MAX_CONCURRENT_TRADES",
          riskLimitValue: effectiveMaxConcurrent,
          riskObservedValue: openCount,
          reasonCode: "MAX_TRADES_EXCEEDED",
          note: `Max concurrent open trades exceeded (limit=${effectiveMaxConcurrent})`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      const [openLotsRow] = await tx
        .select({ lots: sql`COALESCE(SUM(${trades.lots}), 0)` })
        .from(trades)
        .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN")))
        .limit(1);
      const currentOpenLots = Number((openLotsRow as any)?.lots ?? 0);
      if (currentOpenLots + lots > effectiveMaxConcurrentLots) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "MAX_CONCURRENT_LOTS",
          riskLimitValue: effectiveMaxConcurrentLots,
          riskObservedValue: currentOpenLots + lots,
          reasonCode: "MAX_LOTS_EXCEEDED",
          note: `Max concurrent lots exceeded. Open: ${currentOpenLots}, Requested: ${lots}, Limit: ${effectiveMaxConcurrentLots}`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      const openPerSymbolRows = await tx.select({ c: trades.id })
        .from(trades)
        .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
        .where(and(eq(trades.userId, u.id), eq(trades.status, "OPEN"), eq(symbolConfigs.symbol, symbol)));

      const pendingPerSymbolRows = await tx.select({ c: trades.id })
        .from(trades)
        .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id))
        .where(and(
          eq(trades.userId, u.id),
          eq(trades.status, "PENDING"),
          eq(symbolConfigs.symbol, symbol),
          sql`${trades.id} != ${t.id}`
        ));

      const activePerSymbol = openPerSymbolRows.length + pendingPerSymbolRows.length;
      if (activePerSymbol >= effectiveMaxTradesPerInstrument) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "MAX_TRADES_PER_INSTRUMENT",
          riskLimitValue: effectiveMaxTradesPerInstrument,
          riskObservedValue: activePerSymbol,
          reasonCode: "MAX_PER_INSTRUMENT_EXCEEDED",
          note: `Max trades per instrument exceeded (OPEN=${openPerSymbolRows.length}, PENDING=${pendingPerSymbolRows.length}, limit=${effectiveMaxTradesPerInstrument})`,
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      const reserve = await reserveUserMargin(tx, { userId: u.id, marginUsd: neededMarginNow });
      if (!reserve.reserved) {
        const canceled = await cancelPendingWithAudit({
          riskCheckName: "MARGIN_CHECK",
          riskLimitValue: neededMarginNow,
          riskObservedValue: freeMargin,
          reasonCode: "INSUFFICIENT_MARGIN",
          note: "Insufficient free margin at execution",
        });
        return canceled ? { action: "CANCELED" as const } : { action: "SKIP" as const };
      }

      const updated = await tx.update(trades)
        .set({
          status: "OPEN",
          executedAt: nowSec,
          openPrice: fillPrice,
          intradayHigh: fillPrice,
          intradayLow: fillPrice,
          mae: null,
          mfe: null,
          notionalUsd: openCostSummary.notionalUsd,
          categorySnapshot: openCostSummary.categorySnapshot,
          costModelVersion: openCostSummary.costModelVersion,
          openCommissionUsd: openCostSummary.commissionUsd,
          openOtherFeesUsd: openCostSummary.otherFeesUsd,
          totalCostsUsd: openCostSummary.totalUsd,
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
        .returning({ id: trades.id });

      if (updated.length === 0) {
        await releaseUserMargin(tx, { userId: u.id, marginUsd: neededMarginNow });
        return { action: "SKIP" as const };
      }
      await applyUserBalanceDelta(tx, { userId: u.id, deltaUsd: -openCostSummary.totalUsd });

      await auditFill({
        tradeId: t.id,
        correlationId,
        orderId,
        executionId,
        positionId,
        symbol,
        pipDecimals,
        side,
        orderType,
        timeInForce,
        qtyLots: lots,
        requestedPrice: requested,
        limitPrice,
        stopPrice,
        triggerPrice,
        fillPrice,
        quoteBid: ba.bid,
        quoteAsk: ba.ask,
        quoteMid: ba.mid,
        quoteSpread: ba.spread,
        quoteTs,
        quoteSource,
        ...tradeProvenance,
        latencyMs,
        note: `orderType=${t.orderType}, openCost=${openCostSummary.totalUsd.toFixed(2)}`,
        payload: {
          timeInForce,
          costModelVersion: openCostSummary.costModelVersion,
          categorySnapshot: openCostSummary.categorySnapshot,
          notionalUsd: openCostSummary.notionalUsd,
          openCommissionUsd: openCostSummary.commissionUsd,
          openOtherFeesUsd: openCostSummary.otherFeesUsd,
          openCostChargedUsd: openCostSummary.totalUsd,
        },
      }, { db: tx });

      return { action: "FILLED" as const };
    });

    if (fillResult.action !== "FILLED") continue;

    initTradeExcursion(t.id, fillPrice);

    await recalcAccount(u.id, { emit: true, reason: "PENDING_ORDER_FILLED" });
    publishLiveEvent({
      type: "trades:updated",
      userId: u.id,
      payload: { reason: "PENDING_ORDER_FILLED", tradeId: t.id },
    });
    void createNotification({
      userId: u.id,
      type: "TRADE",
      severity: "INFO",
      title: "Pending order filled",
      message: `Pending ${String(t.orderType || "order")} for ${symbol} filled at ${fillPrice.toFixed(5)}.`,
      sourceEvent: `PENDING_ORDER_FILLED:${t.id}:${Math.floor(Date.now() / 1000)}`,
      link: "/",
      playSound: true,
    }).catch((err) => {
      console.error("[notifications] failed to create pending-fill notification:", err);
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
    trackTradeExcursion({
      tradeId: t.id,
      openPrice: t.openPrice,
      markPrice: closePx,
      intradayHigh: (t as any).intradayHigh,
      intradayLow: (t as any).intradayLow,
    });

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
    const quoteSource = typeof q.source === "string" && q.source.trim() ? q.source.trim() : DEFAULT_QUOTE_SOURCE;
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
    const closeCostSummary = await computeCloseSettlementCosts({
      category: (t as any).categorySnapshot ?? r.sym?.category,
      positionSide: side,
      notionalUsd: (t as any).notionalUsd,
      size: Number((t as any).size ?? lots * 100000),
      lots,
      openedAt: t.openedAt,
      executedAt: (t as any).executedAt,
      closedAtMs: quoteTs.getTime(),
      openCommissionUsd: (t as any).openCommissionUsd,
      openOtherFeesUsd: (t as any).openOtherFeesUsd,
    });
    const grossProfitUsd = pnlUsd;
    const netProfitUsd = grossProfitUsd - closeCostSummary.totalCostsUsd;
    const closeSettlementUsd = grossProfitUsd - closeCostSummary.closingChargesUsd;
    const profit = netProfitUsd.toFixed(2);
    const excursion = await resolveTradeExcursionForCloseDurable({
      tradeId: t.id,
      side,
      openPrice: openPx,
      closePrice: closePx,
      intradayHigh: (t as any).intradayHigh,
      intradayLow: (t as any).intradayLow,
    });

    const correlationId = (t as any).correlationId || generateCorrelationId();
    const orderId = (t as any).orderId || generateOrderId();
    const positionId = (t as any).positionId || generatePositionId();
    const executionId = generateExecutionId();
    const closedAt = Math.floor(Date.now() / 1000);

    const closeResult = await db.transaction(async (tx) => {
      const tradeLock = await tx.execute(sql`
        select id, intraday_high as "intradayHigh", intraday_low as "intradayLow"
        from trades
        where id = ${t.id} and status = 'OPEN'
        for update
      `);
      if (!tradeLock.rows.length) return { action: "SKIP" as const };
      const lockedTrade = tradeLock.rows[0] as any;
      const persistedHigh = n(lockedTrade?.intradayHigh);
      const persistedLow = n(lockedTrade?.intradayLow);
      const mergedIntradayHigh =
        excursion.intradayHigh == null
          ? persistedHigh
          : persistedHigh == null
            ? excursion.intradayHigh
            : Math.max(excursion.intradayHigh, persistedHigh);
      const mergedIntradayLow =
        excursion.intradayLow == null
          ? persistedLow
          : persistedLow == null
            ? excursion.intradayLow
            : Math.min(excursion.intradayLow, persistedLow);

      const userRowRes = await tx.execute(sql`
        select id, leverage
        from users
        where id = ${u.id}
        for update
      `);
      const leverageNow = Number((userRowRes.rows[0] as any)?.leverage ?? 5);
      const marginToRelease = requiredMargin(symbol, lots, closePx, leverageNow);

      const closed = await tx.update(trades)
        .set({
          status: "CLOSED",
          closePrice: closePx,
          profit,
          grossProfitUsd,
          netProfitUsd,
          intradayHigh: mergedIntradayHigh,
          intradayLow: mergedIntradayLow,
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
          closeReason: reason,
          closedAt,
          closeQuoteTs: Math.floor(quoteTs.getTime() / 1000),
          closeSource: quoteSource,
          closeBid: ba.bid,
          closeAsk: ba.ask,
          closeMid: ba.mid,
          closeSpread: ba.spread,
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
        .returning({ id: trades.id });

      if (closed.length === 0) return { action: "SKIP" as const };

      await applyUserBalanceDelta(tx, { userId: u.id, deltaUsd: closeSettlementUsd });
      await releaseUserMargin(tx, { userId: u.id, marginUsd: marginToRelease });

      await auditClose({
        tradeId: t.id,
        correlationId,
        orderId,
        positionId,
        executionId,
        symbol,
        pipDecimals: r.sym?.pipDecimals ?? null,
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
        profit: netProfitUsd,
        payload: {
          grossProfitUsd,
          netProfitUsd,
          balanceDeltaUsd: closeSettlementUsd,
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

      return { action: "CLOSED" as const };
    });

    if (closeResult.action !== "CLOSED") continue;

    clearTradeExcursion(t.id);

    await recalcAccount(u.id, { emit: true, reason: reason ?? "STOP_TAKE_PROFIT" });
    publishLiveEvent({
      type: "trades:updated",
      userId: u.id,
      payload: { reason: reason ?? "STOP_TAKE_PROFIT", tradeId: t.id },
    });
    if (reason === "STOP_LOSS_HIT" || reason === "TAKE_PROFIT_HIT") {
      const title = reason === "TAKE_PROFIT_HIT" ? "Take Profit hit" : "Stop Loss hit";
      const severity = reason === "TAKE_PROFIT_HIT" ? "SUCCESS" : "WARNING";
      void createNotification({
        userId: u.id,
        type: "TRADE",
        severity,
        title,
        message: `${title} for ${symbol} at ${closePx.toFixed(5)}. P/L ${profit}.`,
        sourceEvent: `${reason}:${t.id}:${closedAt}`,
        link: "/",
        playSound: true,
      }).catch((err) => {
        console.error("[notifications] failed to create SL/TP notification:", err);
      });
    }
    console.log(`[OrderEngine] Closed position via ${reason}: trade=${t.id} profit=${profit}`);
  }
}

export async function onQuotesUpdated(quotes: Quote[]) {
  if (running) return;
  running = true;
  try {
    const currentSec = nowUnixSec();
    if (currentSec - lastPendingExpirySweepSec >= 5) {
      lastPendingExpirySweepSec = currentSec;
      await expirePendingOrders(currentSec);
    }

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
