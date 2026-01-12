import { db } from "@db";
import { legalDocuments, legalDocPointers } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { sha256 } from "./cryptoUtils";

export interface LegalDocTarget {
  docSet: string;
  docType: "GLOBAL_MASTER" | "ADDENDUM";
  jurisdictionType: "DEFAULT" | "COUNTRY" | "REGION";
  jurisdictionKey: string;
}

type DbConn = typeof db;

export async function createDocumentVersion(params: {
  target: LegalDocTarget;
  version: string;
  content: string;
  notes?: string | null;
  adminUserId?: number | null;
}, conn: DbConn = db) {
  const sha = sha256(params.content);
  const now = Date.now();

  const [doc] = await conn
    .insert(legalDocuments)
    .values({
      docSet: params.target.docSet,
      docType: params.target.docType,
      jurisdictionType: params.target.jurisdictionType,
      jurisdictionKey: params.target.jurisdictionKey,
      version: params.version,
      sha256: sha,
      content: params.content,
      notes: params.notes || null,
      createdAt: now,
      createdByAdminUserId: params.adminUserId || null,
    })
    .returning();

  if (!doc) throw new Error("Insert failed.");
  return doc;
}

export async function getActiveDoc(target: LegalDocTarget, conn: DbConn = db) {
  const [pointer] = await conn
    .select()
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, target.docSet),
        eq(legalDocPointers.docType, target.docType),
        eq(legalDocPointers.jurisdictionType, target.jurisdictionType),
        eq(legalDocPointers.jurisdictionKey, target.jurisdictionKey)
      )
    )
    .limit(1);

  if (!pointer || !pointer.activeDocumentId) return { pointer: pointer || null, doc: null };

  const [doc] = await conn
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.id, pointer.activeDocumentId))
    .limit(1);

  return { pointer, doc: doc || null };
}

export async function getPointer(target: LegalDocTarget, conn: DbConn = db) {
  const [pointer] = await conn
    .select()
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, target.docSet),
        eq(legalDocPointers.docType, target.docType),
        eq(legalDocPointers.jurisdictionType, target.jurisdictionType),
        eq(legalDocPointers.jurisdictionKey, target.jurisdictionKey)
      )
    )
    .limit(1);

  return pointer;
}

export async function listVersions(target: LegalDocTarget, conn: DbConn = db) {
  return await conn
    .select()
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.docSet, target.docSet),
        eq(legalDocuments.docType, target.docType),
        eq(legalDocuments.jurisdictionType, target.jurisdictionType),
        eq(legalDocuments.jurisdictionKey, target.jurisdictionKey)
      )
    )
    .orderBy(desc(legalDocuments.createdAt));
}

export async function upsertPointer(params: {
  target: LegalDocTarget;
  activeDocumentId: number;
  adminUserId?: number | null;
}, conn: DbConn = db) {
  const now = Date.now();
  const existing = await getPointer(params.target, conn);

  if (existing) {
    await conn
      .update(legalDocPointers)
      .set({
        activeDocumentId: params.activeDocumentId,
        updatedAt: now,
        updatedByAdminUserId: params.adminUserId || null,
      })
      .where(eq(legalDocPointers.id, existing.id));
  } else {
    await conn
      .insert(legalDocPointers)
      .values({
        docSet: params.target.docSet,
        docType: params.target.docType,
        jurisdictionType: params.target.jurisdictionType,
        jurisdictionKey: params.target.jurisdictionKey,
        activeDocumentId: params.activeDocumentId,
        updatedAt: now,
        updatedByAdminUserId: params.adminUserId || null,
      });
  }
}
