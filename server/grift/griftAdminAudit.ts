// server/grift/griftAdminAudit.ts
import crypto from "crypto";
import type { GriftDb } from "./griftDb";

export type AuditAction =
  | "CONFIG_UPDATE"
  | "RETENTION_PRUNE"
  | "MAINTENANCE_WAL_CHECKPOINT"
  | "MAINTENANCE_VACUUM"
  | "IP2ASN_REIMPORT"
  | "IP2ASN_ENRICH"
  | "SIGNAL_REVIEW"
  | "SIGNAL_CLOSE"
  | "SIGNAL_IGNORE"
  | "CASE_CREATE"
  | "CASE_UPDATE"
  | "CASE_CLOSE"
  | "CASE_NOTE"
  | "USER_FREEZE"
  | "USER_UNFREEZE"
  | "USER_DISABLE"
  | "USER_ENABLE"
  | "USER_REVIEW_START"
  | "USER_REVIEW_END"
  | "RISK_REEVALUATE"
  | "RISK_RECOMPUTE"
  | "ENFORCEMENT_FREEZE"
  | "ENFORCEMENT_UNFREEZE"
  | "ENFORCEMENT_DISABLE"
  | "ENFORCEMENT_ENABLE";

export type AuditEntry = {
  id?: number;
  adminId: number;
  action: AuditAction;
  targetType?: "signal" | "case" | "user" | "config" | "ip2asn" | "maintenance";
  targetId?: number;
  payload?: Record<string, any>;
  createdAt: number;
  prevHash: string | null;
  hash: string;
};

function computeHash(entry: Omit<AuditEntry, "hash" | "id">): string {
  const data = JSON.stringify({
    adminId: entry.adminId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    payload: entry.payload,
    createdAt: entry.createdAt,
    prevHash: entry.prevHash,
  });
  return crypto.createHash("sha256").update(data).digest("hex");
}

export async function appendAuditEntry(
  db: GriftDb,
  adminId: number,
  action: AuditAction,
  targetType?: "signal" | "case" | "user" | "config" | "ip2asn" | "maintenance",
  targetId?: number,
  payload?: Record<string, any>
): Promise<AuditEntry> {
  const now = Date.now();

  // Get previous hash
  const lastRow = await db.prepare(`
    SELECT hash FROM grift_admin_actions ORDER BY id DESC LIMIT 1
  `).get() as { hash: string } | undefined;

  const prevHash = lastRow?.hash ?? null;

  const entry: Omit<AuditEntry, "id"> = {
    adminId,
    action,
    targetType,
    targetId,
    payload,
    createdAt: now,
    prevHash,
    hash: "",
  };

  entry.hash = computeHash(entry);

  const result = await db.prepare(`
    INSERT INTO grift_admin_actions (admin_id, action, target_type, target_id, payload_json, created_at, prev_hash, hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).run(
    adminId,
    action,
    targetType ?? null,
    targetId ?? null,
    payload ? JSON.stringify(payload) : null,
    now,
    prevHash,
    entry.hash
  );

  return { id: Number(result.lastInsertRowid), ...entry };
}

export async function verifyAuditChain(
  db: GriftDb
): Promise<{ valid: boolean; totalEntries: number; brokenAt?: number; message?: string }> {
  const rows = await db.prepare(`
    SELECT id, admin_id as adminId, action, target_type as targetType, target_id as targetId, payload_json as payload, created_at as createdAt, prev_hash as prevHash, hash
    FROM grift_admin_actions ORDER BY id ASC
  `).all() as AuditEntry[];

  let expectedPrevHash: string | null = null;

  for (const row of rows) {
    // Check chain continuity
    if (row.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAt: row.id,
        message: "Chain break: prev_hash mismatch",
      };
    }

    // Re-compute hash
    const recomputed = computeHash({
      adminId: row.adminId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : undefined,
      createdAt: row.createdAt,
      prevHash: row.prevHash,
    });

    if (recomputed !== row.hash) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAt: row.id,
        message: "Chain break: hash mismatch",
      };
    }

    expectedPrevHash = row.hash;
  }

  return { valid: true, totalEntries: rows.length };
}

export async function getAuditLog(
  db: GriftDb,
  filters?: {
    adminId?: number;
    action?: AuditAction;
    targetType?: string;
    since?: number;
    limit?: number;
  }
): Promise<AuditEntry[]> {
  let sql = "SELECT * FROM grift_admin_actions WHERE 1=1";
  const params: any[] = [];

  if (filters?.adminId) {
    sql += " AND admin_id = ?";
    params.push(filters.adminId);
  }
  if (filters?.action) {
    sql += " AND action = ?";
    params.push(filters.action);
  }
  if (filters?.targetType) {
    sql += " AND target_type = ?";
    params.push(filters.targetType);
  }
  if (filters?.since) {
    sql += " AND created_at >= ?";
    params.push(filters.since);
  }

  sql += " ORDER BY id DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  const rows = await db.prepare(sql).all(...params) as AuditEntry[];
  return rows.map((r) => ({
    ...r,
    payload: r.payload ? (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) : undefined,
  }));
}
