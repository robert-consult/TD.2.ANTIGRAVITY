import { db } from "@db";
import { identityAudit } from "@shared/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sha256Hex } from "./crypto";

// Canonical JSON serialization with sorted keys for deterministic hashing
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

export type IdentityAuditEvent = {
  at?: number;
  userId?: number | null;
  email?: string | null;
  username?: string | null;
  category: string;
  type: string;
  title?: string | null;
  description?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  actorAdminId?: number | null;
  actorType?: "USER" | "ADMIN" | "SYSTEM";
  actorUserId?: number | null;
  sessionId?: string | null;
  correlationId?: string | null;
  data?: Record<string, any> | null;
};

export function appendIdentityAudit(evt: IdentityAuditEvent): void {
  void (async () => {
    const atMs = evt.at ?? Date.now();
    const atSec = Math.floor(atMs / 1000);

    const [lastRow] = await db
      .select({ eventHash: identityAudit.eventHash })
      .from(identityAudit)
      .where(evt.userId == null ? isNull(identityAudit.userId) : eq(identityAudit.userId, evt.userId))
      .orderBy(desc(identityAudit.id))
      .limit(1);

    const prevHash = lastRow?.eventHash ?? null;

    const payload = {
      at: atSec,
      userId: evt.userId ?? null,
      email: evt.email ?? null,
      username: evt.username ?? null,
      category: evt.category,
      type: evt.type,
      title: evt.title ?? null,
      description: evt.description ?? null,
      ip: evt.ip ?? null,
      userAgent: evt.userAgent ?? null,
      actorAdminId: evt.actorAdminId ?? null,
      actorType: evt.actorType ?? null,
      actorUserId: evt.actorUserId ?? null,
      sessionId: evt.sessionId ?? null,
      correlationId: evt.correlationId ?? null,
      data: evt.data ?? null,
      prevHash,
    };

    const eventHash = sha256Hex(`${prevHash ?? ""}|${stableStringify(payload)}`);

    await db.insert(identityAudit).values({
      at: atSec,
      userId: evt.userId ?? null,
      email: evt.email ?? null,
      username: evt.username ?? null,
      category: evt.category,
      type: evt.type,
      title: evt.title ?? null,
      description: evt.description ?? null,
      ip: evt.ip ?? null,
      userAgent: evt.userAgent ?? null,
      actorAdminId: evt.actorAdminId ?? null,
      actorType: evt.actorType ?? null,
      actorUserId: evt.actorUserId ?? null,
      sessionId: evt.sessionId ?? null,
      correlationId: evt.correlationId ?? null,
      dataJson: evt.data ? JSON.stringify(evt.data) : null,
      prevHash,
      eventHash,
    });
  })().catch((err) => {
    console.error("[IdentityAudit] Failed to append audit event:", err);
  });
}

export async function getIdentityAuditForUser(
  userId: number,
  options?: { limit?: number; offset?: number; category?: string }
): Promise<any[]> {
  const { limit = 100, offset = 0, category } = options ?? {};
  const whereClause = category
    ? and(eq(identityAudit.userId, userId), eq(identityAudit.category, category))
    : eq(identityAudit.userId, userId);

  return await db
    .select()
    .from(identityAudit)
    .where(whereClause)
    .orderBy(desc(identityAudit.at))
    .limit(limit)
    .offset(offset);
}

export async function getRecentIdentityAudit(
  options?: { limit?: number; offset?: number; category?: string; type?: string }
): Promise<any[]> {
  const { limit = 100, offset = 0, category, type } = options ?? {};
  const conditions = [];
  if (category) conditions.push(eq(identityAudit.category, category));
  if (type) conditions.push(eq(identityAudit.type, type));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const query = db
    .select()
    .from(identityAudit)
    .orderBy(desc(identityAudit.at))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    return await query.where(whereClause);
  }

  return await query;
}
