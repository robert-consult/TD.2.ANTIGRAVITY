/**
 * Institutional-Grade Audit Writer
 * Provides tamper-evident hash-chained audit logging for trade events
 * Compliant with OATS specifications and hedge fund allocator requirements
 */

import crypto from "crypto";
import { db } from "@db";
import { tradeAudit, orderIntentAudit } from "@shared/schema";
import { eq, desc, inArray, asc } from "drizzle-orm";

type AuditDb = Pick<typeof db, "query" | "insert">;

// Canonical JSON serialization for consistent hashing
function canonicalJson(value: any): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

// SHA-256 hash for tamper-evidence
function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// Generate UUID for correlation IDs
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

// Generate unique IDs for order/execution/position
export function generateOrderId(): string {
  return `ORD-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function generateExecutionId(): string {
  return `EXE-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function generatePositionId(): string {
  return `POS-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export interface AuditContext {
  correlationId?: string;
  actorType: "USER" | "ADMIN" | "SYSTEM";
  actorUserId?: number | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface TradeAuditParams {
  tradeId: number;
  eventType: string;
  eventCategory?: string;
  ctx: AuditContext;

  // IDs
  orderId?: string | null;
  executionId?: string | null;
  positionId?: string | null;

  // Economics
  symbol?: string | null;
  side?: string | null;
  orderType?: string | null;
  timeInForce?: string | null;
  qtyLots?: number | null;
  notionalUsd?: number | null;

  // Cost & P/L snapshot
  grossProfitUsd?: number | null;
  netProfitUsd?: number | null;
  totalCostsUsd?: number | null;
  openCommissionUsd?: number | null;
  closeCommissionUsd?: number | null;
  openOtherFeesUsd?: number | null;
  closeOtherFeesUsd?: number | null;
  financingAccruedUsd?: number | null;
  swapAccruedUsd?: number | null;
  overnightDays?: number | null;
  categorySnapshot?: string | null;
  costModelVersion?: string | null;

  // Pricing
  requestedPrice?: number | null;
  triggerPrice?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  fillPrice?: number | null;
  avgFillPrice?: number | null;

  // Market context
  quoteTs?: number | Date | null;
  quoteSource?: string | null;
  quoteBid?: number | null;
  quoteAsk?: number | null;
  quoteMid?: number | null;
  quoteSpread?: number | null;
  spreadPips?: number | null;

  // Slippage
  slippage?: number | null;
  slippagePips?: number | null;
  slippageReference?: string | null;
  latencyMs?: number | null;

  // Risk evidence
  riskCheckName?: string | null;
  riskLimitValue?: number | null;
  riskObservedValue?: number | null;
  riskResult?: string | null;
  reasonCode?: string | null;

  note?: string | null;
  payload?: any;
}

// Write a trade audit event with hash chaining
export async function writeTradeAudit(
  params: TradeAuditParams,
  opts?: { db?: AuditDb },
): Promise<{ eventHash: string; prevHash: string }> {
  const eventAtMs = Date.now();
  const eventAt = Math.floor(eventAtMs / 1000);
  const quoteTs = params.quoteTs == null
    ? null
    : typeof params.quoteTs === "number"
      ? Math.floor(params.quoteTs)
      : Math.floor(params.quoteTs.getTime() / 1000);
  const correlationId = params.ctx.correlationId || generateCorrelationId();
  const dbLike = opts?.db ?? db;

  const payloadObj =
    params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
      ? (params.payload as Record<string, any>)
      : {};
  const toFinite = (value: unknown): number | null => {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const readFinite = (...values: unknown[]): number | null => {
    for (const value of values) {
      const n = toFinite(value);
      if (n !== null) return n;
    }
    return null;
  };
  const readText = (...values: unknown[]): string | null => {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  };

  const overnightDaysRaw = readFinite(params.overnightDays, payloadObj.overnightDays);
  const normalizedCostSnapshot = {
    notionalUsd: readFinite(params.notionalUsd, payloadObj.notionalUsd),
    grossProfitUsd: readFinite(params.grossProfitUsd, payloadObj.grossProfitUsd),
    netProfitUsd: readFinite(params.netProfitUsd, payloadObj.netProfitUsd),
    totalCostsUsd: readFinite(params.totalCostsUsd, payloadObj.totalCostsUsd),
    openCommissionUsd: readFinite(params.openCommissionUsd, payloadObj.openCommissionUsd),
    closeCommissionUsd: readFinite(params.closeCommissionUsd, payloadObj.closeCommissionUsd),
    openOtherFeesUsd: readFinite(params.openOtherFeesUsd, payloadObj.openOtherFeesUsd),
    closeOtherFeesUsd: readFinite(params.closeOtherFeesUsd, payloadObj.closeOtherFeesUsd),
    financingAccruedUsd: readFinite(params.financingAccruedUsd, payloadObj.financingAccruedUsd),
    swapAccruedUsd: readFinite(params.swapAccruedUsd, payloadObj.swapAccruedUsd),
    overnightDays: overnightDaysRaw === null ? null : Math.max(0, Math.trunc(overnightDaysRaw)),
    categorySnapshot: readText(params.categorySnapshot, payloadObj.categorySnapshot),
    costModelVersion: readText(params.costModelVersion, payloadObj.costModelVersion),
  };

  try {
    // Get previous hash for this trade's chain
    const lastEvent = await dbLike.query.tradeAudit.findFirst({
      where: eq(tradeAudit.tradeId, params.tradeId),
      orderBy: desc(tradeAudit.id),
    });

    const prevHash = (lastEvent as any)?.eventHash ?? "GENESIS";

    // Build envelope for hashing (excludes prevHash)
    const envelope = {
      tradeId: params.tradeId,
      eventType: params.eventType,
      eventCategory: params.eventCategory ?? "TRADE",
      eventAtMs,
      correlationId,
      orderId: params.orderId ?? null,
      executionId: params.executionId ?? null,
      positionId: params.positionId ?? null,
      actorType: params.ctx.actorType,
      actorUserId: params.ctx.actorUserId ?? null,
      sessionId: params.ctx.sessionId ?? null,
      ip: params.ctx.ip ?? null,
      userAgent: params.ctx.userAgent ?? null,
      symbol: params.symbol ?? null,
      side: params.side ?? null,
      orderType: params.orderType ?? null,
      timeInForce: params.timeInForce ?? null,
      qtyLots: params.qtyLots ?? null,
      notionalUsd: normalizedCostSnapshot.notionalUsd,
      grossProfitUsd: normalizedCostSnapshot.grossProfitUsd,
      netProfitUsd: normalizedCostSnapshot.netProfitUsd,
      totalCostsUsd: normalizedCostSnapshot.totalCostsUsd,
      openCommissionUsd: normalizedCostSnapshot.openCommissionUsd,
      closeCommissionUsd: normalizedCostSnapshot.closeCommissionUsd,
      openOtherFeesUsd: normalizedCostSnapshot.openOtherFeesUsd,
      closeOtherFeesUsd: normalizedCostSnapshot.closeOtherFeesUsd,
      financingAccruedUsd: normalizedCostSnapshot.financingAccruedUsd,
      swapAccruedUsd: normalizedCostSnapshot.swapAccruedUsd,
      overnightDays: normalizedCostSnapshot.overnightDays,
      categorySnapshot: normalizedCostSnapshot.categorySnapshot,
      costModelVersion: normalizedCostSnapshot.costModelVersion,
      requestedPrice: params.requestedPrice ?? null,
      triggerPrice: params.triggerPrice ?? null,
      limitPrice: params.limitPrice ?? null,
      stopPrice: params.stopPrice ?? null,
      fillPrice: params.fillPrice ?? null,
      avgFillPrice: params.avgFillPrice ?? null,
      quoteBid: params.quoteBid ?? null,
      quoteAsk: params.quoteAsk ?? null,
      quoteMid: params.quoteMid ?? null,
      quoteSpread: params.quoteSpread ?? null,
      spreadPips: params.spreadPips ?? null,
      slippage: params.slippage ?? null,
      slippagePips: params.slippagePips ?? null,
      slippageReference: params.slippageReference ?? null,
      latencyMs: params.latencyMs ?? null,
      riskCheckName: params.riskCheckName ?? null,
      riskLimitValue: params.riskLimitValue ?? null,
      riskObservedValue: params.riskObservedValue ?? null,
      riskResult: params.riskResult ?? null,
      reasonCode: params.reasonCode ?? null,
      note: params.note ?? null,
      payload: params.payload ?? null,
    };

    const payloadJson = canonicalJson(envelope);
    let finalEventHash = "";
    let finalPrevHash = "";
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Nested transaction (savepoint) prevents poisoning parent tx on unique constraint violations (23505)
        const executor = typeof (dbLike as any).transaction === 'function' ? (cb: any) => (dbLike as any).transaction(cb) : (cb: any) => cb(dbLike);

        await executor(async (tx: any) => {
          const lastEvent = await tx.query.tradeAudit.findFirst({
            where: eq(tradeAudit.tradeId, params.tradeId),
            orderBy: desc(tradeAudit.id),
          });

          finalPrevHash = (lastEvent as any)?.eventHash ?? "GENESIS";
          finalEventHash = sha256Hex(finalPrevHash + "\n" + payloadJson);

          await tx.insert(tradeAudit).values({
            tradeId: params.tradeId,
            eventType: params.eventType,
            eventCategory: params.eventCategory ?? "TRADE",
            eventAt,
            eventAtMs,
            correlationId,
            orderId: params.orderId ?? null,
            executionId: params.executionId ?? null,
            positionId: params.positionId ?? null,
            actorType: params.ctx.actorType,
            actorUserId: params.ctx.actorUserId ?? null,
            sessionId: params.ctx.sessionId ?? null,
            ip: params.ctx.ip ?? null,
            userAgent: params.ctx.userAgent ?? null,
            symbol: params.symbol ?? null,
            side: params.side ?? null,
            orderType: params.orderType ?? null,
            timeInForce: params.timeInForce ?? null,
            qtyLots: params.qtyLots ?? null,
            notionalUsd: normalizedCostSnapshot.notionalUsd,
            grossProfitUsd: normalizedCostSnapshot.grossProfitUsd,
            netProfitUsd: normalizedCostSnapshot.netProfitUsd,
            totalCostsUsd: normalizedCostSnapshot.totalCostsUsd,
            openCommissionUsd: normalizedCostSnapshot.openCommissionUsd,
            closeCommissionUsd: normalizedCostSnapshot.closeCommissionUsd,
            openOtherFeesUsd: normalizedCostSnapshot.openOtherFeesUsd,
            closeOtherFeesUsd: normalizedCostSnapshot.closeOtherFeesUsd,
            financingAccruedUsd: normalizedCostSnapshot.financingAccruedUsd,
            swapAccruedUsd: normalizedCostSnapshot.swapAccruedUsd,
            overnightDays: normalizedCostSnapshot.overnightDays,
            categorySnapshot: normalizedCostSnapshot.categorySnapshot,
            costModelVersion: normalizedCostSnapshot.costModelVersion,
            requestedPrice: params.requestedPrice ?? null,
            triggerPrice: params.triggerPrice ?? null,
            limitPrice: params.limitPrice ?? null,
            stopPrice: params.stopPrice ?? null,
            fillPrice: params.fillPrice ?? null,
            avgFillPrice: params.avgFillPrice ?? null,
            quoteTs,
            quoteSource: params.quoteSource ?? null,
            quoteBid: params.quoteBid ?? null,
            quoteAsk: params.quoteAsk ?? null,
            quoteMid: params.quoteMid ?? null,
            quoteSpread: params.quoteSpread ?? null,
            spreadPips: params.spreadPips ?? null,
            slippage: params.slippage ?? null,
            slippagePips: params.slippagePips ?? null,
            slippageReference: params.slippageReference ?? null,
            latencyMs: params.latencyMs ?? null,
            riskCheckName: params.riskCheckName ?? null,
            riskLimitValue: params.riskLimitValue ?? null,
            riskObservedValue: params.riskObservedValue ?? null,
            riskResult: params.riskResult ?? null,
            reasonCode: params.reasonCode ?? null,
            payloadJson,
            prevHash: finalPrevHash,
            eventHash: finalEventHash,
            note: params.note ?? null,
          });
        });

        break; // Success
      } catch (err: any) {
        if (err.code === '23505' && attempt < MAX_RETRIES) {
          console.warn(`[AuditWriter] Race condition unique_violation on tradeAudit ${params.tradeId} (attempt ${attempt}/${MAX_RETRIES}). Retrying...`);
          await new Promise(r => setTimeout(r, attempt * 50));
          continue;
        }
        throw err;
      }
    }

    return { eventHash: finalEventHash, prevHash: finalPrevHash };
  } catch (e) {
    console.error("Error writing trade audit:", e);
    throw e;
  }
}

export interface OrderIntentParams {
  correlationId: string;
  eventCode: "ORDER_RECEIVED" | "ORDER_VALIDATED" | "RISK_CHECK" | "DECISION";
  ctx: AuditContext;
  userId: number;

  // Decision (for DECISION events)
  decision?: "PASS" | "REJECT" | null;
  rejectCheck?: string | null;
  rejectReason?: string | null;

  // Economics
  symbol?: string | null;
  side?: string | null;
  orderType?: string | null;
  timeInForce?: string | null;
  qtyLots?: number | null;
  requestedPrice?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  takeProfit?: number | null;
  stopLoss?: number | null;

  // Quote context
  quoteBid?: number | null;
  quoteAsk?: number | null;
  quoteMid?: number | null;
  quoteTs?: number | Date | null;
  quoteIsStale?: boolean | null;

  // Risk evidence
  riskLimit?: any;
  riskObserved?: any;
  riskSnapshot?: any;

  payload?: any;
}

// Write an order intent audit event
export async function writeOrderIntentAudit(
  params: OrderIntentParams,
  opts?: { db?: AuditDb },
): Promise<{ eventHash: string; prevHash: string }> {
  const eventAtMs = Date.now();
  const eventAt = Math.floor(eventAtMs / 1000);
  const quoteTs = params.quoteTs == null
    ? null
    : typeof params.quoteTs === "number"
      ? Math.floor(params.quoteTs)
      : Math.floor(params.quoteTs.getTime() / 1000);
  const dbLike = opts?.db ?? db;

  try {
    // Get previous hash for this correlation chain
    const lastEvent = await dbLike.query.orderIntentAudit.findFirst({
      where: eq(orderIntentAudit.correlationId, params.correlationId),
      orderBy: desc(orderIntentAudit.id),
    });

    const prevHash = (lastEvent as any)?.eventHash ?? "GENESIS";

    // Build envelope for hashing (excludes prevHash)
    const envelope = {
      correlationId: params.correlationId,
      eventAtMs,
      eventCode: params.eventCode,
      decision: params.decision ?? null,
      rejectCheck: params.rejectCheck ?? null,
      rejectReason: params.rejectReason ?? null,
      actorType: params.ctx.actorType,
      userId: params.userId,
      sessionId: params.ctx.sessionId ?? null,
      ip: params.ctx.ip ?? null,
      userAgent: params.ctx.userAgent ?? null,
      symbol: params.symbol ?? null,
      side: params.side ?? null,
      orderType: params.orderType ?? null,
      timeInForce: params.timeInForce ?? null,
      qtyLots: params.qtyLots ?? null,
      requestedPrice: params.requestedPrice ?? null,
      limitPrice: params.limitPrice ?? null,
      stopPrice: params.stopPrice ?? null,
      takeProfit: params.takeProfit ?? null,
      stopLoss: params.stopLoss ?? null,
      quoteBid: params.quoteBid ?? null,
      quoteAsk: params.quoteAsk ?? null,
      quoteMid: params.quoteMid ?? null,
      quoteIsStale: params.quoteIsStale ?? null,
      riskLimit: params.riskLimit ?? null,
      riskObserved: params.riskObserved ?? null,
      riskSnapshot: params.riskSnapshot ?? null,
      payload: params.payload ?? null,
    };

    const payloadJson = canonicalJson(envelope);
    let finalEventHash = "";
    let finalPrevHash = "";
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const executor = typeof (dbLike as any).transaction === 'function' ? (cb: any) => (dbLike as any).transaction(cb) : (cb: any) => cb(dbLike);

        await executor(async (tx: any) => {
          const lastEvent = await tx.query.orderIntentAudit.findFirst({
            where: eq(orderIntentAudit.correlationId, params.correlationId),
            orderBy: desc(orderIntentAudit.id),
          });

          finalPrevHash = (lastEvent as any)?.eventHash ?? "GENESIS";
          finalEventHash = sha256Hex(finalPrevHash + "\n" + payloadJson);

          await tx.insert(orderIntentAudit).values({
            correlationId: params.correlationId,
            eventAt,
            eventAtMs,
            eventCode: params.eventCode,
            decision: params.decision ?? null,
            rejectCheck: params.rejectCheck ?? null,
            rejectReason: params.rejectReason ?? null,
            actorType: params.ctx.actorType,
            userId: params.userId,
            sessionId: params.ctx.sessionId ?? null,
            ip: params.ctx.ip ?? null,
            userAgent: params.ctx.userAgent ?? null,
            symbol: params.symbol ?? null,
            side: params.side ?? null,
            orderType: params.orderType ?? null,
            timeInForce: params.timeInForce ?? null,
            qtyLots: params.qtyLots ?? null,
            requestedPrice: params.requestedPrice ?? null,
            limitPrice: params.limitPrice ?? null,
            stopPrice: params.stopPrice ?? null,
            takeProfit: params.takeProfit ?? null,
            stopLoss: params.stopLoss ?? null,
            quoteBid: params.quoteBid ?? null,
            quoteAsk: params.quoteAsk ?? null,
            quoteMid: params.quoteMid ?? null,
            quoteTs,
            quoteIsStale: params.quoteIsStale ?? false,
            riskLimitJson: params.riskLimit ? JSON.stringify(params.riskLimit) : null,
            riskObservedJson: params.riskObserved ? JSON.stringify(params.riskObserved) : null,
            riskSnapshotJson: params.riskSnapshot ? JSON.stringify(params.riskSnapshot) : null,
            payloadJson,
            prevHash: finalPrevHash,
            eventHash: finalEventHash,
          });
        });

        break; // Success
      } catch (err: any) {
        if (err.code === '23505' && attempt < MAX_RETRIES) {
          console.warn(`[AuditWriter] Race condition unique_violation on orderIntentAudit ${params.correlationId} (attempt ${attempt}/${MAX_RETRIES}). Retrying...`);
          await new Promise(r => setTimeout(r, attempt * 50));
          continue;
        }
        throw err;
      }
    }

    return { eventHash: finalEventHash, prevHash: finalPrevHash };
  } catch (e) {
    console.error("Error writing order intent audit:", e);
    throw e;
  }
}

// Verify trade audit hash-chain integrity for one or more trades
export async function verifyTradeAuditChain(tradeIdOrIds: number | number[]): Promise<{ valid: boolean; errors: string[] }> {
  const tradeIds = Array.isArray(tradeIdOrIds)
    ? Array.from(new Set(tradeIdOrIds.map((id) => Math.trunc(Number(id))).filter((id) => Number.isInteger(id) && id > 0)))
    : [Math.trunc(Number(tradeIdOrIds))].filter((id) => Number.isInteger(id) && id > 0);

  if (tradeIds.length === 0) {
    return {
      valid: false,
      errors: ["No valid trade IDs provided for audit-chain verification"],
    };
  }

  const events = tradeIds.length === 1
    ? await db.select({
      id: tradeAudit.id,
      tradeId: tradeAudit.tradeId,
      prevHash: tradeAudit.prevHash,
      eventHash: tradeAudit.eventHash,
      payloadJson: tradeAudit.payloadJson,
    }).from(tradeAudit)
      .where(eq(tradeAudit.tradeId, tradeIds[0]!))
      .orderBy(asc(tradeAudit.id))
    : await db.select({
      id: tradeAudit.id,
      tradeId: tradeAudit.tradeId,
      prevHash: tradeAudit.prevHash,
      eventHash: tradeAudit.eventHash,
      payloadJson: tradeAudit.payloadJson,
    }).from(tradeAudit)
      .where(inArray(tradeAudit.tradeId, tradeIds))
      .orderBy(asc(tradeAudit.tradeId), asc(tradeAudit.id));

  const errors: string[] = [];
  let currentTradeId: number | null = null;
  let expectedPrevHash = "GENESIS";

  for (const event of events) {
    if (currentTradeId !== event.tradeId) {
      currentTradeId = event.tradeId;
      expectedPrevHash = "GENESIS";
    }

    const actualPrevHash = event.prevHash ?? "GENESIS";
    const actualEventHash = event.eventHash ?? "";
    const payloadJson = event.payloadJson ?? "";

    if (actualPrevHash !== expectedPrevHash) {
      errors.push(
        `Trade ${event.tradeId} event ${event.id}: prevHash mismatch (expected ${expectedPrevHash}, got ${actualPrevHash})`,
      );
    }

    const recomputedHash = sha256Hex(`${actualPrevHash}\n${payloadJson}`);
    if (actualEventHash !== recomputedHash) {
      errors.push(
        `Trade ${event.tradeId} event ${event.id}: eventHash mismatch (expected ${recomputedHash}, got ${actualEventHash || "EMPTY"})`,
      );
    }

    expectedPrevHash = actualEventHash || "GENESIS";
  }

  return { valid: errors.length === 0, errors };
}

// Verify order intent audit hash-chain integrity for one or more correlation IDs
export async function verifyOrderIntentAuditChain(correlationIdOrIds: string | string[]): Promise<{ valid: boolean; errors: string[] }> {
  const correlationIds = Array.isArray(correlationIdOrIds)
    ? Array.from(new Set(correlationIdOrIds.filter(id => typeof id === 'string' && id.trim().length > 0)))
    : [correlationIdOrIds].filter(id => typeof id === 'string' && id.trim().length > 0);

  if (correlationIds.length === 0) {
    return {
      valid: false,
      errors: ["No valid correlation IDs provided for audit-chain verification"],
    };
  }

  const events = correlationIds.length === 1
    ? await db.select({
      id: orderIntentAudit.id,
      correlationId: orderIntentAudit.correlationId,
      prevHash: orderIntentAudit.prevHash,
      eventHash: orderIntentAudit.eventHash,
      payloadJson: orderIntentAudit.payloadJson,
    }).from(orderIntentAudit)
      .where(eq(orderIntentAudit.correlationId, correlationIds[0]!))
      .orderBy(asc(orderIntentAudit.id))
    : await db.select({
      id: orderIntentAudit.id,
      correlationId: orderIntentAudit.correlationId,
      prevHash: orderIntentAudit.prevHash,
      eventHash: orderIntentAudit.eventHash,
      payloadJson: orderIntentAudit.payloadJson,
    }).from(orderIntentAudit)
      .where(inArray(orderIntentAudit.correlationId, correlationIds))
      .orderBy(asc(orderIntentAudit.correlationId), asc(orderIntentAudit.id));

  const errors: string[] = [];
  let currentCorrelationId: string | null = null;
  let expectedPrevHash = "GENESIS";

  for (const event of events) {
    if (currentCorrelationId !== event.correlationId) {
      currentCorrelationId = event.correlationId;
      expectedPrevHash = "GENESIS";
    }

    const actualPrevHash = event.prevHash ?? "GENESIS";
    const actualEventHash = event.eventHash ?? "";
    const payloadJson = event.payloadJson ?? "";

    if (actualPrevHash !== expectedPrevHash) {
      errors.push(
        `Intent ${event.correlationId} event ${event.id}: prevHash mismatch (expected ${expectedPrevHash}, got ${actualPrevHash})`,
      );
    }

    const recomputedHash = sha256Hex(`${actualPrevHash}\n${payloadJson}`);
    if (actualEventHash !== recomputedHash) {
      errors.push(
        `Intent ${event.correlationId} event ${event.id}: eventHash mismatch (expected ${recomputedHash}, got ${actualEventHash || "EMPTY"})`,
      );
    }

    expectedPrevHash = actualEventHash || "GENESIS";
  }

  return { valid: errors.length === 0, errors };
}

// Calculate slippage in pips
export function calculateSlippagePips(symbol: string, slippagePoints: number, pipDecimals?: number | null): number {
  const pip = Number.isFinite(Number(pipDecimals)) ? Math.pow(10, -Math.trunc(Number(pipDecimals))) : (symbol.toUpperCase().includes("JPY") ? 0.01 : 0.0001);
  return slippagePoints / pip;
}

// Calculate spread in pips
export function calculateSpreadPips(symbol: string, spreadPoints: number, pipDecimals?: number | null): number {
  const pip = Number.isFinite(Number(pipDecimals)) ? Math.pow(10, -Math.trunc(Number(pipDecimals))) : (symbol.toUpperCase().includes("JPY") ? 0.01 : 0.0001);
  return spreadPoints / pip;
}
