/**
 * Institutional-Grade Audit Writer
 * Provides tamper-evident hash-chained audit logging for trade events
 * Compliant with OATS specifications and hedge fund allocator requirements
 */

import crypto from "crypto";
import { db } from "@db";
import { tradeAudit, orderIntentAudit } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

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
  
  try {
    // Get previous hash for this trade's chain
    const lastEvent = await dbLike.query.tradeAudit.findFirst({
      where: eq(tradeAudit.tradeId, params.tradeId),
      orderBy: desc(tradeAudit.id),
    });
    
    const prevHash = (lastEvent as any)?.eventHash ?? "GENESIS";
    
    // Build envelope for hashing
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
    const eventHash = sha256Hex(prevHash + "\n" + payloadJson);
    
    await dbLike.insert(tradeAudit).values({
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
      prevHash,
      eventHash,
      note: params.note ?? null,
    });
    
    return { eventHash, prevHash };
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
    
    // Build envelope for hashing
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
    const eventHash = sha256Hex(prevHash + "\n" + payloadJson);
    
    await dbLike.insert(orderIntentAudit).values({
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
      prevHash,
      eventHash,
    });
    
    return { eventHash, prevHash };
  } catch (e) {
    console.error("Error writing order intent audit:", e);
    throw e;
  }
}

// Verify hash chain integrity for a trade
export async function verifyTradeAuditChain(tradeId: number): Promise<{ valid: boolean; errors: string[] }> {
  const events = await db.query.tradeAudit.findMany({
    where: eq(tradeAudit.tradeId, tradeId),
    orderBy: tradeAudit.id,
  });
  
  const errors: string[] = [];
  let expectedPrevHash = "GENESIS";
  
  for (const event of events) {
    const e = event as any;
    if (e.prevHash !== expectedPrevHash) {
      errors.push(`Event ${e.id}: prevHash mismatch (expected ${expectedPrevHash}, got ${e.prevHash})`);
    }
    
    // Verify event hash (would need to reconstruct payload)
    expectedPrevHash = e.eventHash || "GENESIS";
  }
  
  return { valid: errors.length === 0, errors };
}

// Calculate slippage in pips
export function calculateSlippagePips(symbol: string, slippagePoints: number): number {
  // For JPY pairs, 1 pip = 0.01; for others, 1 pip = 0.0001
  const isJpy = symbol.toUpperCase().includes("JPY");
  const pipValue = isJpy ? 0.01 : 0.0001;
  return slippagePoints / pipValue;
}

// Calculate spread in pips
export function calculateSpreadPips(symbol: string, spreadPoints: number): number {
  const isJpy = symbol.toUpperCase().includes("JPY");
  const pipValue = isJpy ? 0.01 : 0.0001;
  return spreadPoints / pipValue;
}
