import Database from "better-sqlite3";
import { sha256Hex } from "./crypto";

function getDb() {
  const db = new Database("./trading_app.db");
  // Improve concurrency for audit log writes under load.
  try {
    db.pragma("journal_mode = WAL");
  } catch {}
  try {
    db.pragma("busy_timeout = 5000");
  } catch {}
  try {
    db.pragma("foreign_keys = ON");
  } catch {}
  return db;
}

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
  const db = getDb();
  try {
    const atMs = evt.at ?? Date.now();
    const atSec = Math.floor(atMs / 1000);
    
    const lastRow = (evt.userId == null
      ? db.prepare(`
          SELECT event_hash FROM identity_audit WHERE user_id IS NULL ORDER BY id DESC LIMIT 1
        `).get()
      : db.prepare(`
          SELECT event_hash FROM identity_audit WHERE user_id = ? ORDER BY id DESC LIMIT 1
        `).get(evt.userId)) as { event_hash?: string } | undefined;

    const prevHash = lastRow?.event_hash ?? null;
    
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
    
    db.prepare(`
      INSERT INTO identity_audit (
        at, user_id, email, username, category, type, title, description, ip, user_agent,
        actor_admin_id, actor_type, actor_user_id, session_id, correlation_id, data_json,
        prev_hash, event_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      atSec,
      evt.userId ?? null,
      evt.email ?? null,
      evt.username ?? null,
      evt.category,
      evt.type,
      evt.title ?? null,
      evt.description ?? null,
      evt.ip ?? null,
      evt.userAgent ?? null,
      evt.actorAdminId ?? null,
      evt.actorType ?? null,
      evt.actorUserId ?? null,
      evt.sessionId ?? null,
      evt.correlationId ?? null,
      evt.data ? JSON.stringify(evt.data) : null,
      prevHash,
      eventHash
    );
  } finally {
    db.close();
  }
}

export function getIdentityAuditForUser(
  userId: number,
  options?: { limit?: number; offset?: number; category?: string }
): any[] {
  const db = getDb();
  try {
    const { limit = 100, offset = 0, category } = options ?? {};
    
    let sql = `SELECT * FROM identity_audit WHERE user_id = ?`;
    const params: any[] = [userId];
    
    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    
    sql += ` ORDER BY at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}

export function getRecentIdentityAudit(
  options?: { limit?: number; offset?: number; category?: string; type?: string }
): any[] {
  const db = getDb();
  try {
    const { limit = 100, offset = 0, category, type } = options ?? {};
    
    let sql = `SELECT * FROM identity_audit WHERE 1=1`;
    const params: any[] = [];
    
    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    
    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }
    
    sql += ` ORDER BY at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}
