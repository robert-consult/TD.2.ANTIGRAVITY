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

export function createDocumentVersion(params: {
  target: LegalDocTarget;
  version: string;
  content: string;
  notes?: string | null;
  adminUserId?: number | null;
}) {
  const sha = sha256(params.content);
  const now = Date.now();

  db.insert(legalDocuments)
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
    .run();

  const doc = db
    .select()
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.docSet, params.target.docSet),
        eq(legalDocuments.docType, params.target.docType),
        eq(legalDocuments.jurisdictionType, params.target.jurisdictionType),
        eq(legalDocuments.jurisdictionKey, params.target.jurisdictionKey),
        eq(legalDocuments.sha256, sha)
      )
    )
    .orderBy(desc(legalDocuments.createdAt))
    .limit(1)
    .get();
  
  if (!doc) throw new Error("Insert failed.");
  return doc;
}

export function getActiveDoc(target: LegalDocTarget) {
  const pointer = db
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
    .get();

  if (!pointer || !pointer.activeDocumentId) return { pointer: pointer || null, doc: null };

  const doc = db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.id, pointer.activeDocumentId))
    .get();

  return { pointer, doc: doc || null };
}

export function getPointer(target: LegalDocTarget) {
  return db
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
    .get();
}

export function listVersions(target: LegalDocTarget) {
  return db
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
    .orderBy(desc(legalDocuments.createdAt))
    .all();
}

export function upsertPointer(params: {
  target: LegalDocTarget;
  activeDocumentId: number;
  adminUserId?: number | null;
}) {
  const now = Date.now();
  const existing = getPointer(params.target);

  if (existing) {
    db.update(legalDocPointers)
      .set({
        activeDocumentId: params.activeDocumentId,
        updatedAt: now,
        updatedByAdminUserId: params.adminUserId || null,
      })
      .where(eq(legalDocPointers.id, existing.id))
      .run();
  } else {
    db.insert(legalDocPointers)
      .values({
        docSet: params.target.docSet,
        docType: params.target.docType,
        jurisdictionType: params.target.jurisdictionType,
        jurisdictionKey: params.target.jurisdictionKey,
        activeDocumentId: params.activeDocumentId,
        updatedAt: now,
        updatedByAdminUserId: params.adminUserId || null,
      })
      .run();
  }
}
