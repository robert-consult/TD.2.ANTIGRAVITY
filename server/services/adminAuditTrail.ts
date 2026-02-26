import { db } from "@db";
import { orderIntentAudit, symbolConfigs, tradeAudit, trades, users } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseUnixSec(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

function toIso(value: unknown): string | null {
  const sec = parseUnixSec(value);
  if (sec === null) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export type FetchTradeAuditRecordsParams = {
  limit?: number;
  tradeId?: number | null;
  eventType?: string | null;
  riskResult?: string | null;
  correlationId?: string | null;
};

export async function fetchTradeAuditRecords(params: FetchTradeAuditRecordsParams): Promise<any[]> {
  const limit = clampInt(params.limit, 200, 1, 5000);
  const tradeId = params.tradeId != null ? normalizeInt(params.tradeId) : null;
  const eventType = nonEmptyString(params.eventType);
  const riskResult = nonEmptyString(params.riskResult);
  const correlationId = nonEmptyString(params.correlationId);

  const conditions: any[] = [];
  if (tradeId != null && tradeId > 0) conditions.push(eq(tradeAudit.tradeId, tradeId));
  if (eventType && eventType.toLowerCase() !== "all") conditions.push(eq(tradeAudit.eventType, eventType));
  if (riskResult && riskResult.toLowerCase() !== "all") conditions.push(eq(tradeAudit.riskResult, riskResult));
  if (correlationId) conditions.push(eq(tradeAudit.correlationId, correlationId));

  let query: any = db
    .select({
      id: tradeAudit.id,
      tradeId: tradeAudit.tradeId,
      eventType: tradeAudit.eventType,
      eventCategory: tradeAudit.eventCategory,
      eventAt: tradeAudit.eventAt,
      eventAtMs: tradeAudit.eventAtMs,
      correlationId: tradeAudit.correlationId,
      orderId: tradeAudit.orderId,
      executionId: tradeAudit.executionId,
      positionId: tradeAudit.positionId,
      actorType: tradeAudit.actorType,
      actorUserId: tradeAudit.actorUserId,
      sessionId: tradeAudit.sessionId,
      ip: tradeAudit.ip,
      userAgent: tradeAudit.userAgent,
      symbol: tradeAudit.symbol,
      side: tradeAudit.side,
      orderType: tradeAudit.orderType,
      timeInForce: tradeAudit.timeInForce,
      qtyLots: tradeAudit.qtyLots,
      notionalUsd: tradeAudit.notionalUsd,
      grossProfitUsd: tradeAudit.grossProfitUsd,
      netProfitUsd: tradeAudit.netProfitUsd,
      totalCostsUsd: tradeAudit.totalCostsUsd,
      openCommissionUsd: tradeAudit.openCommissionUsd,
      closeCommissionUsd: tradeAudit.closeCommissionUsd,
      openOtherFeesUsd: tradeAudit.openOtherFeesUsd,
      closeOtherFeesUsd: tradeAudit.closeOtherFeesUsd,
      financingAccruedUsd: tradeAudit.financingAccruedUsd,
      swapAccruedUsd: tradeAudit.swapAccruedUsd,
      overnightDays: tradeAudit.overnightDays,
      categorySnapshot: tradeAudit.categorySnapshot,
      costModelVersion: tradeAudit.costModelVersion,
      requestedPrice: tradeAudit.requestedPrice,
      triggerPrice: tradeAudit.triggerPrice,
      limitPrice: tradeAudit.limitPrice,
      stopPrice: tradeAudit.stopPrice,
      fillPrice: tradeAudit.fillPrice,
      avgFillPrice: tradeAudit.avgFillPrice,
      slippage: tradeAudit.slippage,
      slippagePips: tradeAudit.slippagePips,
      slippageReference: tradeAudit.slippageReference,
      latencyMs: tradeAudit.latencyMs,
      quoteTs: tradeAudit.quoteTs,
      quoteSource: tradeAudit.quoteSource,
      quoteBid: tradeAudit.quoteBid,
      quoteAsk: tradeAudit.quoteAsk,
      quoteMid: tradeAudit.quoteMid,
      quoteSpread: tradeAudit.quoteSpread,
      spreadPips: tradeAudit.spreadPips,
      riskCheckName: tradeAudit.riskCheckName,
      riskLimitValue: tradeAudit.riskLimitValue,
      riskObservedValue: tradeAudit.riskObservedValue,
      riskResult: tradeAudit.riskResult,
      reasonCode: tradeAudit.reasonCode,
      payloadJson: tradeAudit.payloadJson,
      prevHash: tradeAudit.prevHash,
      eventHash: tradeAudit.eventHash,
      note: tradeAudit.note,
      symbolFromTrade: symbolConfigs.symbol,
      userId: trades.userId,
      username: users.username,
      userEmail: users.email,
      tradeSide: trades.type,
      tradeLots: trades.lots,
      tradeOrderType: trades.orderType,
      tradeNotionalUsd: trades.notionalUsd,
      tradeGrossProfitUsd: trades.grossProfitUsd,
      tradeNetProfitUsd: trades.netProfitUsd,
      tradeTotalCostsUsd: trades.totalCostsUsd,
      tradeOpenCommissionUsd: trades.openCommissionUsd,
      tradeCloseCommissionUsd: trades.closeCommissionUsd,
      tradeOpenOtherFeesUsd: trades.openOtherFeesUsd,
      tradeCloseOtherFeesUsd: trades.closeOtherFeesUsd,
      tradeFinancingAccruedUsd: trades.financingAccruedUsd,
      tradeSwapAccruedUsd: trades.swapAccruedUsd,
      tradeOvernightDays: trades.overnightDays,
      tradeCategorySnapshot: trades.categorySnapshot,
      tradeCostModelVersion: trades.costModelVersion,
    })
    .from(tradeAudit)
    .leftJoin(trades, eq(tradeAudit.tradeId, trades.id))
    .leftJoin(users, eq(trades.userId, users.id))
    .leftJoin(symbolConfigs, eq(trades.symbolId, symbolConfigs.id));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query.orderBy(desc(tradeAudit.eventAt)).limit(limit);

  return rows.map((r: any) => {
    const eventAtSec = parseUnixSec(r.eventAt);
    const quoteTsSec = parseUnixSec(r.quoteTs);
    return {
      ...r,
      eventAtSec,
      eventAt: toIso(r.eventAt),
      quoteTsSec,
      quoteTs: toIso(r.quoteTs),
      symbol: r.symbol || r.symbolFromTrade,
      side: r.side || r.tradeSide,
      qtyLots: r.qtyLots ?? r.tradeLots,
      orderType: r.orderType || r.tradeOrderType,
      notionalUsd: r.notionalUsd ?? r.tradeNotionalUsd,
      grossProfitUsd: r.grossProfitUsd ?? r.tradeGrossProfitUsd,
      netProfitUsd: r.netProfitUsd ?? r.tradeNetProfitUsd,
      totalCostsUsd: r.totalCostsUsd ?? r.tradeTotalCostsUsd,
      openCommissionUsd: r.openCommissionUsd ?? r.tradeOpenCommissionUsd,
      closeCommissionUsd: r.closeCommissionUsd ?? r.tradeCloseCommissionUsd,
      openOtherFeesUsd: r.openOtherFeesUsd ?? r.tradeOpenOtherFeesUsd,
      closeOtherFeesUsd: r.closeOtherFeesUsd ?? r.tradeCloseOtherFeesUsd,
      financingAccruedUsd: r.financingAccruedUsd ?? r.tradeFinancingAccruedUsd,
      swapAccruedUsd: r.swapAccruedUsd ?? r.tradeSwapAccruedUsd,
      overnightDays: r.overnightDays ?? r.tradeOvernightDays,
      categorySnapshot: r.categorySnapshot ?? r.tradeCategorySnapshot,
      costModelVersion: r.costModelVersion ?? r.tradeCostModelVersion,
      payload: parseJsonObject(r.payloadJson),
    };
  });
}

export type FetchOrderIntentAuditRecordsParams = {
  limit?: number;
  correlationId?: string | null;
  decision?: string | null;
  userId?: number | null;
};

export async function fetchOrderIntentAuditRecords(
  params: FetchOrderIntentAuditRecordsParams,
): Promise<any[]> {
  const limit = clampInt(params.limit, 200, 1, 5000);
  const correlationId = nonEmptyString(params.correlationId);
  const decision = nonEmptyString(params.decision);
  const userId = params.userId != null ? normalizeInt(params.userId) : null;

  const conditions: any[] = [];
  if (correlationId) conditions.push(eq(orderIntentAudit.correlationId, correlationId));
  if (decision && decision.toLowerCase() !== "all") conditions.push(eq(orderIntentAudit.decision, decision));
  if (userId != null && userId > 0) conditions.push(eq(orderIntentAudit.userId, userId));

  let query: any = db
    .select({
      id: orderIntentAudit.id,
      correlationId: orderIntentAudit.correlationId,
      eventAt: orderIntentAudit.eventAt,
      eventAtMs: orderIntentAudit.eventAtMs,
      eventCode: orderIntentAudit.eventCode,
      decision: orderIntentAudit.decision,
      rejectCheck: orderIntentAudit.rejectCheck,
      rejectReason: orderIntentAudit.rejectReason,
      actorType: orderIntentAudit.actorType,
      userId: orderIntentAudit.userId,
      sessionId: orderIntentAudit.sessionId,
      ip: orderIntentAudit.ip,
      userAgent: orderIntentAudit.userAgent,
      symbol: orderIntentAudit.symbol,
      side: orderIntentAudit.side,
      orderType: orderIntentAudit.orderType,
      timeInForce: orderIntentAudit.timeInForce,
      qtyLots: orderIntentAudit.qtyLots,
      requestedPrice: orderIntentAudit.requestedPrice,
      limitPrice: orderIntentAudit.limitPrice,
      stopPrice: orderIntentAudit.stopPrice,
      takeProfit: orderIntentAudit.takeProfit,
      stopLoss: orderIntentAudit.stopLoss,
      quoteBid: orderIntentAudit.quoteBid,
      quoteAsk: orderIntentAudit.quoteAsk,
      quoteMid: orderIntentAudit.quoteMid,
      quoteTs: orderIntentAudit.quoteTs,
      quoteIsStale: orderIntentAudit.quoteIsStale,
      riskLimitJson: orderIntentAudit.riskLimitJson,
      riskObservedJson: orderIntentAudit.riskObservedJson,
      riskSnapshotJson: orderIntentAudit.riskSnapshotJson,
      payloadJson: orderIntentAudit.payloadJson,
      prevHash: orderIntentAudit.prevHash,
      eventHash: orderIntentAudit.eventHash,
      username: users.username,
      userEmail: users.email,
    })
    .from(orderIntentAudit)
    .leftJoin(users, eq(orderIntentAudit.userId, users.id));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query.orderBy(desc(orderIntentAudit.eventAt)).limit(limit);

  return rows.map((r: any) => {
    const eventAtSec = parseUnixSec(r.eventAt);
    const quoteTsSec = parseUnixSec(r.quoteTs);
    return {
      ...r,
      eventAtSec,
      eventAtIso: toIso(r.eventAt),
      quoteTsSec,
      quoteTsIso: toIso(r.quoteTs),
      riskLimit: parseJsonObject(r.riskLimitJson),
      riskObserved: parseJsonObject(r.riskObservedJson),
      riskSnapshot: parseJsonObject(r.riskSnapshotJson),
      payload: parseJsonObject(r.payloadJson),
    };
  });
}

type CorrelationLinkAccumulator = {
  correlationId: string;
  firstAt: number | null;
  lastAt: number | null;
  tradeAuditEventIds: Set<number>;
  orderIntentEventIds: Set<number>;
  tradeIds: Set<number>;
  orderIds: Set<string>;
  executionIds: Set<string>;
  positionIds: Set<string>;
  sessionIds: Set<string>;
  actorUserIds: Set<number>;
  userIds: Set<number>;
  eventTypes: Set<string>;
  decisions: Set<string>;
  reasonCodes: Set<string>;
  rejectChecks: Set<string>;
};

type SessionLinkAccumulator = {
  sessionId: string;
  firstAt: number | null;
  lastAt: number | null;
  loginIds: Set<number>;
  tradeAuditEventIds: Set<number>;
  orderIntentEventIds: Set<number>;
  identityEventIds: Set<number>;
  adminActionIds: Set<number>;
  userIds: Set<number>;
  emails: Set<string>;
  ips: Set<string>;
};

type UserLinkAccumulator = {
  userId: number;
  firstAt: number | null;
  lastAt: number | null;
  signupIds: Set<number>;
  loginIds: Set<number>;
  tradeAuditEventIds: Set<number>;
  orderIntentEventIds: Set<number>;
  identityEventIds: Set<number>;
  adminActionIds: Set<number>;
  sessionIds: Set<string>;
  emails: Set<string>;
  usernames: Set<string>;
  tradeIds: Set<number>;
  correlationIds: Set<string>;
};

function withWindow<T extends { firstAt: number | null; lastAt: number | null }>(link: T, tsSec: number | null) {
  if (tsSec == null) return;
  if (link.firstAt == null || tsSec < link.firstAt) link.firstAt = tsSec;
  if (link.lastAt == null || tsSec > link.lastAt) link.lastAt = tsSec;
}

function toSortedArray<T extends number | string>(set: Set<T>): T[] {
  return Array.from(set.values()).sort((a, b) => String(a).localeCompare(String(b)));
}

export function buildAuditTrailLinkage(params: {
  signups: any[];
  logins: any[];
  adminActions: any[];
  identityEvents: any[];
  tradeAuditEvents: any[];
  orderIntentEvents: any[];
}) {
  const byCorrelationId = new Map<string, CorrelationLinkAccumulator>();
  const bySessionId = new Map<string, SessionLinkAccumulator>();
  const byUserId = new Map<number, UserLinkAccumulator>();

  const ensureCorrelation = (correlationId: string) => {
    const existing = byCorrelationId.get(correlationId);
    if (existing) return existing;
    const created: CorrelationLinkAccumulator = {
      correlationId,
      firstAt: null,
      lastAt: null,
      tradeAuditEventIds: new Set<number>(),
      orderIntentEventIds: new Set<number>(),
      tradeIds: new Set<number>(),
      orderIds: new Set<string>(),
      executionIds: new Set<string>(),
      positionIds: new Set<string>(),
      sessionIds: new Set<string>(),
      actorUserIds: new Set<number>(),
      userIds: new Set<number>(),
      eventTypes: new Set<string>(),
      decisions: new Set<string>(),
      reasonCodes: new Set<string>(),
      rejectChecks: new Set<string>(),
    };
    byCorrelationId.set(correlationId, created);
    return created;
  };

  const ensureSession = (sessionId: string) => {
    const existing = bySessionId.get(sessionId);
    if (existing) return existing;
    const created: SessionLinkAccumulator = {
      sessionId,
      firstAt: null,
      lastAt: null,
      loginIds: new Set<number>(),
      tradeAuditEventIds: new Set<number>(),
      orderIntentEventIds: new Set<number>(),
      identityEventIds: new Set<number>(),
      adminActionIds: new Set<number>(),
      userIds: new Set<number>(),
      emails: new Set<string>(),
      ips: new Set<string>(),
    };
    bySessionId.set(sessionId, created);
    return created;
  };

  const ensureUser = (userId: number) => {
    const existing = byUserId.get(userId);
    if (existing) return existing;
    const created: UserLinkAccumulator = {
      userId,
      firstAt: null,
      lastAt: null,
      signupIds: new Set<number>(),
      loginIds: new Set<number>(),
      tradeAuditEventIds: new Set<number>(),
      orderIntentEventIds: new Set<number>(),
      identityEventIds: new Set<number>(),
      adminActionIds: new Set<number>(),
      sessionIds: new Set<string>(),
      emails: new Set<string>(),
      usernames: new Set<string>(),
      tradeIds: new Set<number>(),
      correlationIds: new Set<string>(),
    };
    byUserId.set(userId, created);
    return created;
  };

  for (const s of params.signups) {
    const userId = normalizeInt(s?.id);
    const at = parseUnixSec(s?.createdAt);
    if (userId == null || userId <= 0) continue;
    const userLink = ensureUser(userId);
    userLink.signupIds.add(userId);
    withWindow(userLink, at);
    const email = nonEmptyString(s?.email);
    if (email) userLink.emails.add(email);
    const username = nonEmptyString(s?.username);
    if (username) userLink.usernames.add(username);
  }

  for (const l of params.logins) {
    const loginId = normalizeInt(l?.id);
    const userId = normalizeInt(l?.userId);
    const createdAt = parseUnixSec(l?.createdAt);
    const sessionId = nonEmptyString(l?.sessionId);
    const email = nonEmptyString(l?.email);
    const ip = nonEmptyString(l?.ip);

    if (sessionId) {
      const sessionLink = ensureSession(sessionId);
      if (loginId != null && loginId > 0) sessionLink.loginIds.add(loginId);
      if (userId != null && userId > 0) sessionLink.userIds.add(userId);
      if (email) sessionLink.emails.add(email);
      if (ip) sessionLink.ips.add(ip);
      withWindow(sessionLink, createdAt);
    }

    if (userId != null && userId > 0) {
      const userLink = ensureUser(userId);
      if (loginId != null && loginId > 0) userLink.loginIds.add(loginId);
      if (email) userLink.emails.add(email);
      if (sessionId) userLink.sessionIds.add(sessionId);
      withWindow(userLink, createdAt);
    }
  }

  for (const e of params.identityEvents) {
    const id = normalizeInt(e?.id);
    const at = parseUnixSec(e?.at);
    const userId = normalizeInt(e?.userId);
    const sessionId = nonEmptyString(e?.sessionId);
    const correlationId = nonEmptyString(e?.correlationId);
    const email = nonEmptyString(e?.email);
    const username = nonEmptyString(e?.username);

    if (sessionId) {
      const sessionLink = ensureSession(sessionId);
      if (id != null && id > 0) sessionLink.identityEventIds.add(id);
      if (userId != null && userId > 0) sessionLink.userIds.add(userId);
      if (email) sessionLink.emails.add(email);
      withWindow(sessionLink, at);
    }

    if (correlationId) {
      const corrLink = ensureCorrelation(correlationId);
      withWindow(corrLink, at);
      if (userId != null && userId > 0) corrLink.userIds.add(userId);
      if (sessionId) corrLink.sessionIds.add(sessionId);
      if (nonEmptyString(e?.type)) corrLink.eventTypes.add(String(e.type));
    }

    if (userId != null && userId > 0) {
      const userLink = ensureUser(userId);
      if (id != null && id > 0) userLink.identityEventIds.add(id);
      if (email) userLink.emails.add(email);
      if (username) userLink.usernames.add(username);
      if (sessionId) userLink.sessionIds.add(sessionId);
      if (correlationId) userLink.correlationIds.add(correlationId);
      withWindow(userLink, at);
    }
  }

  for (const a of params.adminActions) {
    const id = normalizeInt(a?.id);
    const at = parseUnixSec(a?.createdAt);
    const adminId = normalizeInt(a?.adminId);
    const userId = normalizeInt(a?.userId);
    const ip = nonEmptyString(a?.ip);
    const metadataObj = (a?.metadataJson && typeof a.metadataJson === "object")
      ? (a.metadataJson as Record<string, unknown>)
      : parseJsonObject(a?.metadata);
    const sessionId = nonEmptyString((metadataObj?.sessionId as string | undefined) || null);
    const correlationId = nonEmptyString((metadataObj?.correlationId as string | undefined) || null);

    if (sessionId) {
      const sessionLink = ensureSession(sessionId);
      if (id != null && id > 0) sessionLink.adminActionIds.add(id);
      if (userId != null && userId > 0) sessionLink.userIds.add(userId);
      if (adminId != null && adminId > 0) sessionLink.userIds.add(adminId);
      if (ip) sessionLink.ips.add(ip);
      withWindow(sessionLink, at);
    }

    if (correlationId) {
      const corrLink = ensureCorrelation(correlationId);
      withWindow(corrLink, at);
      if (userId != null && userId > 0) corrLink.userIds.add(userId);
      if (adminId != null && adminId > 0) corrLink.userIds.add(adminId);
      if (sessionId) corrLink.sessionIds.add(sessionId);
      if (nonEmptyString(a?.actionType)) corrLink.eventTypes.add(String(a.actionType));
    }

    if (userId != null && userId > 0) {
      const userLink = ensureUser(userId);
      if (id != null && id > 0) userLink.adminActionIds.add(id);
      if (sessionId) userLink.sessionIds.add(sessionId);
      if (correlationId) userLink.correlationIds.add(correlationId);
      withWindow(userLink, at);
    }
  }

  for (const t of params.tradeAuditEvents) {
    const id = normalizeInt(t?.id);
    const at = parseUnixSec(t?.eventAtSec ?? t?.eventAt);
    const userId = normalizeInt(t?.userId ?? t?.actorUserId);
    const tradeId = normalizeInt(t?.tradeId);
    const sessionId = nonEmptyString(t?.sessionId);
    const correlationId = nonEmptyString(t?.correlationId);
    const orderId = nonEmptyString(t?.orderId);
    const executionId = nonEmptyString(t?.executionId);
    const positionId = nonEmptyString(t?.positionId);
    const reasonCode = nonEmptyString(t?.reasonCode);
    const eventType = nonEmptyString(t?.eventType);

    if (sessionId) {
      const sessionLink = ensureSession(sessionId);
      if (id != null && id > 0) sessionLink.tradeAuditEventIds.add(id);
      if (userId != null && userId > 0) sessionLink.userIds.add(userId);
      if (nonEmptyString(t?.userEmail)) sessionLink.emails.add(String(t.userEmail));
      if (nonEmptyString(t?.ip)) sessionLink.ips.add(String(t.ip));
      withWindow(sessionLink, at);
    }

    if (correlationId) {
      const corrLink = ensureCorrelation(correlationId);
      if (id != null && id > 0) corrLink.tradeAuditEventIds.add(id);
      if (tradeId != null && tradeId > 0) corrLink.tradeIds.add(tradeId);
      if (orderId) corrLink.orderIds.add(orderId);
      if (executionId) corrLink.executionIds.add(executionId);
      if (positionId) corrLink.positionIds.add(positionId);
      if (sessionId) corrLink.sessionIds.add(sessionId);
      if (userId != null && userId > 0) corrLink.userIds.add(userId);
      if (normalizeInt(t?.actorUserId) != null && normalizeInt(t?.actorUserId)! > 0) {
        corrLink.actorUserIds.add(normalizeInt(t?.actorUserId)!);
      }
      if (eventType) corrLink.eventTypes.add(eventType);
      if (nonEmptyString(t?.riskResult)) corrLink.decisions.add(String(t.riskResult));
      if (reasonCode) corrLink.reasonCodes.add(reasonCode);
      withWindow(corrLink, at);
    }

    if (userId != null && userId > 0) {
      const userLink = ensureUser(userId);
      if (id != null && id > 0) userLink.tradeAuditEventIds.add(id);
      if (tradeId != null && tradeId > 0) userLink.tradeIds.add(tradeId);
      if (sessionId) userLink.sessionIds.add(sessionId);
      if (correlationId) userLink.correlationIds.add(correlationId);
      if (nonEmptyString(t?.userEmail)) userLink.emails.add(String(t.userEmail));
      if (nonEmptyString(t?.username)) userLink.usernames.add(String(t.username));
      withWindow(userLink, at);
    }
  }

  for (const o of params.orderIntentEvents) {
    const id = normalizeInt(o?.id);
    const at = parseUnixSec(o?.eventAtSec ?? o?.eventAt);
    const userId = normalizeInt(o?.userId);
    const sessionId = nonEmptyString(o?.sessionId);
    const correlationId = nonEmptyString(o?.correlationId);
    const decision = nonEmptyString(o?.decision);
    const rejectCheck = nonEmptyString(o?.rejectCheck);
    const eventCode = nonEmptyString(o?.eventCode);

    if (sessionId) {
      const sessionLink = ensureSession(sessionId);
      if (id != null && id > 0) sessionLink.orderIntentEventIds.add(id);
      if (userId != null && userId > 0) sessionLink.userIds.add(userId);
      if (nonEmptyString(o?.userEmail)) sessionLink.emails.add(String(o.userEmail));
      if (nonEmptyString(o?.ip)) sessionLink.ips.add(String(o.ip));
      withWindow(sessionLink, at);
    }

    if (correlationId) {
      const corrLink = ensureCorrelation(correlationId);
      if (id != null && id > 0) corrLink.orderIntentEventIds.add(id);
      if (sessionId) corrLink.sessionIds.add(sessionId);
      if (userId != null && userId > 0) corrLink.userIds.add(userId);
      if (eventCode) corrLink.eventTypes.add(eventCode);
      if (decision) corrLink.decisions.add(decision);
      if (rejectCheck) corrLink.rejectChecks.add(rejectCheck);
      if (nonEmptyString(o?.rejectReason)) corrLink.reasonCodes.add(String(o.rejectReason));
      withWindow(corrLink, at);
    }

    if (userId != null && userId > 0) {
      const userLink = ensureUser(userId);
      if (id != null && id > 0) userLink.orderIntentEventIds.add(id);
      if (sessionId) userLink.sessionIds.add(sessionId);
      if (correlationId) userLink.correlationIds.add(correlationId);
      if (nonEmptyString(o?.userEmail)) userLink.emails.add(String(o.userEmail));
      if (nonEmptyString(o?.username)) userLink.usernames.add(String(o.username));
      withWindow(userLink, at);
    }
  }

  return {
    byCorrelationId: Array.from(byCorrelationId.values())
      .map((v) => ({
        correlationId: v.correlationId,
        firstAt: v.firstAt,
        lastAt: v.lastAt,
        eventCount: v.tradeAuditEventIds.size + v.orderIntentEventIds.size,
        tradeAuditEventIds: toSortedArray(v.tradeAuditEventIds),
        orderIntentEventIds: toSortedArray(v.orderIntentEventIds),
        tradeIds: toSortedArray(v.tradeIds),
        orderIds: toSortedArray(v.orderIds),
        executionIds: toSortedArray(v.executionIds),
        positionIds: toSortedArray(v.positionIds),
        sessionIds: toSortedArray(v.sessionIds),
        actorUserIds: toSortedArray(v.actorUserIds),
        userIds: toSortedArray(v.userIds),
        eventTypes: toSortedArray(v.eventTypes),
        decisions: toSortedArray(v.decisions),
        reasonCodes: toSortedArray(v.reasonCodes),
        rejectChecks: toSortedArray(v.rejectChecks),
      }))
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),
    bySessionId: Array.from(bySessionId.values())
      .map((v) => ({
        sessionId: v.sessionId,
        firstAt: v.firstAt,
        lastAt: v.lastAt,
        eventCount:
          v.loginIds.size +
          v.tradeAuditEventIds.size +
          v.orderIntentEventIds.size +
          v.identityEventIds.size +
          v.adminActionIds.size,
        loginIds: toSortedArray(v.loginIds),
        tradeAuditEventIds: toSortedArray(v.tradeAuditEventIds),
        orderIntentEventIds: toSortedArray(v.orderIntentEventIds),
        identityEventIds: toSortedArray(v.identityEventIds),
        adminActionIds: toSortedArray(v.adminActionIds),
        userIds: toSortedArray(v.userIds),
        emails: toSortedArray(v.emails),
        ips: toSortedArray(v.ips),
      }))
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),
    byUserId: Array.from(byUserId.values())
      .map((v) => ({
        userId: v.userId,
        firstAt: v.firstAt,
        lastAt: v.lastAt,
        eventCount:
          v.signupIds.size +
          v.loginIds.size +
          v.tradeAuditEventIds.size +
          v.orderIntentEventIds.size +
          v.identityEventIds.size +
          v.adminActionIds.size,
        signupIds: toSortedArray(v.signupIds),
        loginIds: toSortedArray(v.loginIds),
        tradeAuditEventIds: toSortedArray(v.tradeAuditEventIds),
        orderIntentEventIds: toSortedArray(v.orderIntentEventIds),
        identityEventIds: toSortedArray(v.identityEventIds),
        adminActionIds: toSortedArray(v.adminActionIds),
        sessionIds: toSortedArray(v.sessionIds),
        emails: toSortedArray(v.emails),
        usernames: toSortedArray(v.usernames),
        tradeIds: toSortedArray(v.tradeIds),
        correlationIds: toSortedArray(v.correlationIds),
      }))
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0)),
  };
}

