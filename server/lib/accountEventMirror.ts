import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@db";
import { tradeAudit, trades } from "@shared/schema";
import {
  generateCorrelationId,
  generateOrderId,
  generatePositionId,
  writeTradeAudit,
  type AuditContext,
} from "./auditWriter";

export type AccountActionProvenance = {
  actorType?: "USER" | "ADMIN" | "SYSTEM";
  actorUserId?: number;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export type MirrorAccountEventArgs = {
  accountEventId: number;
  userId: number;
  adminId?: number;
  eventType: string;
  title: string;
  description?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
  metadata?: Record<string, any> | null;
  provenance?: AccountActionProvenance;
};

function mapAccountEventType(eventType: string, title?: string): string {
  const et = (eventType || "").toUpperCase();
  const t = (title || "").toLowerCase();

  if (et === "FREEZE") return "ACCOUNT_FROZEN";
  if (et === "UNFREEZE") return "ACCOUNT_UNFROZEN";
  if (et === "STATUS_CHANGE") {
    if (t.includes("disable")) return "ACCOUNT_DISABLED";
    if (t.includes("enable")) return "ACCOUNT_ENABLED";
    return "ACCOUNT_STATUS_CHANGED";
  }
  if (et === "NOTE_ADDED") return "ACCOUNT_NOTE_ADDED";
  if (et === "FLAG_ADDED") return "ACCOUNT_FLAG_ADDED";
  if (et === "RISK_PROFILE_UPDATED" || et === "SETTINGS_CHANGE") {
    return "ACCOUNT_RISK_PROFILE_UPDATED";
  }
  return `ACCOUNT_${et || "EVENT"}`;
}

function buildCtx(args: MirrorAccountEventArgs, correlationId: string): AuditContext {
  const actorType =
    args.provenance?.actorType ?? (args.adminId ? "ADMIN" : "SYSTEM");
  return {
    correlationId,
    actorType,
    actorUserId: args.provenance?.actorUserId ?? args.adminId ?? null,
    sessionId: args.provenance?.sessionId ?? null,
    ip: args.provenance?.ip ?? null,
    userAgent: args.provenance?.userAgent ?? null,
  };
}

export async function mirrorAccountEventToTradeAudit(
  args: MirrorAccountEventArgs
): Promise<{ mirroredTrades: number }> {
  const mirrorEventType = mapAccountEventType(args.eventType, args.title);

  const openTrades = await db.query.trades.findMany({
    where: and(eq(trades.userId, args.userId), inArray(trades.status, ["OPEN", "PENDING"])),
    orderBy: [desc(trades.id)],
    with: { symbol: true },
  });

  let targetTrades = openTrades;
  if (targetTrades.length === 0) {
    const latest = await db.query.trades.findFirst({
      where: eq(trades.userId, args.userId),
      orderBy: [desc(trades.id)],
      with: { symbol: true },
    });
    targetTrades = latest ? [latest] : [];
  }

  if (targetTrades.length === 0) {
    return { mirroredTrades: 0 };
  }

  const accountWaveCorrelationId = generateCorrelationId();
  let mirrored = 0;

  for (const t of targetTrades) {
    let ensuredCorrelationId = (t as any).correlationId ?? null;
    let ensuredOrderId = (t as any).orderId ?? null;
    let ensuredPositionId = (t as any).positionId ?? null;

    if (!ensuredCorrelationId || !ensuredOrderId || !ensuredPositionId) {
      ensuredCorrelationId = ensuredCorrelationId ?? generateCorrelationId();
      ensuredOrderId = ensuredOrderId ?? generateOrderId();
      ensuredPositionId = ensuredPositionId ?? generatePositionId();

      await db
        .update(trades)
        .set({
          correlationId: ensuredCorrelationId,
          orderId: ensuredOrderId,
          positionId: ensuredPositionId,
        })
        .where(eq(trades.id, t.id));
    }

    const ctx = buildCtx(args, ensuredCorrelationId);
    const mirrorNote = `ACCOUNT_EVENT[${args.accountEventId}]: ${args.title}`;

    try {
      const existing = await db.query.tradeAudit.findFirst({
        where: and(eq(tradeAudit.tradeId, t.id), eq(tradeAudit.note, mirrorNote)),
      });
      if (existing) {
        continue;
      }
    } catch {
      // Best-effort guard only.
    }

    await writeTradeAudit({
      tradeId: t.id,
      eventType: mirrorEventType,
      eventCategory: "ACCOUNT",
      ctx,
      orderId: ensuredOrderId,
      positionId: ensuredPositionId,
      symbol: (t as any).symbol?.symbol ?? null,
      side: (t as any).type ?? null,
      requestedPrice: null,
      fillPrice: null,
      slippage: null,
      slippagePips: null,
      quoteBid: null,
      quoteAsk: null,
      quoteMid: null,
      quoteSpread: null,
      spreadPips: null,
      quoteTs: null,
      quoteSource: null,
      reasonCode: args.reasonCode ?? args.eventType,
      riskResult: null,
      note: mirrorNote,
      payload: {
        mirrorType: "ACCOUNT_EVENT",
        accountWaveCorrelationId,
        accountEventId: args.accountEventId,
        impactedUserId: args.userId,
        actorAdminId: args.adminId ?? null,
        title: args.title,
        description: args.description ?? null,
        reasonCode: args.reasonCode ?? null,
        reasonText: args.reasonText ?? null,
        metadata: args.metadata ?? null,
        provenance: args.provenance ?? null,
      },
    });

    mirrored += 1;
  }

  return { mirroredTrades: mirrored };
}
