import { db } from "@db";
import { legalDocChangeAudit } from "../../shared/schema";
import { sha256, stableStringify } from "./cryptoUtils";
import { asc, desc } from "drizzle-orm";

type AuditAction = "CREATE_VERSION" | "SET_ACTIVE" | "REPLACE_ACTIVE" | "ROLLBACK";
type DbConn = typeof db;

export async function appendLegalDocChangeAudit(params: {
  adminUserId: number | null;
  action: AuditAction | string;
  docSet: string;
  docType: string;
  jurisdictionType: string;
  jurisdictionKey: string;
  oldActiveDocumentId: number | null;
  newActiveDocumentId: number | null;
  note: string | null;
}, conn: DbConn = db) {
  const [last] = await conn
    .select({ seq: legalDocChangeAudit.seq, eventHash: legalDocChangeAudit.eventHash })
    .from(legalDocChangeAudit)
    .orderBy(desc(legalDocChangeAudit.seq))
    .limit(1);

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.eventHash ?? "GENESIS";
  const now = Date.now();

  const payload = {
    seq,
    prevHash,
    adminUserId: params.adminUserId,
    action: params.action,
    docSet: params.docSet,
    docType: params.docType,
    jurisdictionType: params.jurisdictionType,
    jurisdictionKey: params.jurisdictionKey,
    oldActiveDocumentId: params.oldActiveDocumentId,
    newActiveDocumentId: params.newActiveDocumentId,
    note: params.note,
    createdAtMs: now,
  };

  const eventHash = sha256(`${prevHash}|${stableStringify(payload)}`);

  await conn
    .insert(legalDocChangeAudit)
    .values({
      seq,
      prevHash,
      eventHash,
      adminUserId: params.adminUserId,
      action: params.action,
      docSet: params.docSet,
      docType: params.docType,
      jurisdictionType: params.jurisdictionType,
      jurisdictionKey: params.jurisdictionKey,
      oldActiveDocumentId: params.oldActiveDocumentId,
      newActiveDocumentId: params.newActiveDocumentId,
      note: params.note,
      createdAtMs: now,
    });

  return { seq, prevHash, eventHash };
}

export async function verifyLegalDocChangeAuditChain(): Promise<{
  valid: boolean;
  totalEntries: number;
  brokenAtSeq?: number;
  message?: string;
}> {
  const rows = await db.select().from(legalDocChangeAudit).orderBy(asc(legalDocChangeAudit.seq));

  let expectedPrevHash = "GENESIS";

  for (const row of rows as any[]) {
    const seq = Number(row.seq);

    if (typeof row.prevHash !== "string" || row.prevHash.length < 1) {
      return { valid: false, totalEntries: rows.length, brokenAtSeq: seq, message: "Missing prev_hash" };
    }
    if (typeof row.eventHash !== "string" || row.eventHash.length < 1) {
      return { valid: false, totalEntries: rows.length, brokenAtSeq: seq, message: "Missing event_hash" };
    }
    if (typeof row.createdAtMs !== "number" || !Number.isFinite(row.createdAtMs)) {
      return { valid: false, totalEntries: rows.length, brokenAtSeq: seq, message: "Missing created_at_ms" };
    }

    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, totalEntries: rows.length, brokenAtSeq: seq, message: "Chain break: prev_hash mismatch" };
    }

    const payload = {
      seq,
      prevHash: row.prevHash,
      adminUserId: row.adminUserId ?? null,
      action: row.action,
      docSet: row.docSet ?? null,
      docType: row.docType ?? null,
      jurisdictionType: row.jurisdictionType ?? null,
      jurisdictionKey: row.jurisdictionKey ?? null,
      oldActiveDocumentId: row.oldActiveDocumentId ?? null,
      newActiveDocumentId: row.newActiveDocumentId ?? null,
      note: row.note ?? null,
      createdAtMs: row.createdAtMs,
    };

    const recomputed = sha256(`${row.prevHash}|${stableStringify(payload)}`);

    if (recomputed !== row.eventHash) {
      return { valid: false, totalEntries: rows.length, brokenAtSeq: seq, message: "Chain break: event_hash mismatch" };
    }

    expectedPrevHash = row.eventHash;
  }

  return { valid: true, totalEntries: rows.length };
}
