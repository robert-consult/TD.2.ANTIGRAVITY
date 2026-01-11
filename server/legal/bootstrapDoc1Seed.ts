import { db } from "@db";
import { legalDocuments, legalDocPointers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sha256 } from "./cryptoUtils";
import { getDefaultGlobalTerms } from "./doc1Pack";

export function bootstrapDoc1Seed() {
  const existing = db
    .select({ id: legalDocuments.id })
    .from(legalDocuments)
    .where(
      and(
        eq(legalDocuments.docSet, "DOC1"),
        eq(legalDocuments.docType, "GLOBAL_MASTER"),
        eq(legalDocuments.jurisdictionType, "DEFAULT"),
        eq(legalDocuments.jurisdictionKey, "GLOBAL"),
      ),
    )
    .limit(1)
    .get();

  if (existing?.id) return;

  const { title, body } = getDefaultGlobalTerms();
  const content = `${title}\n\n${body}`;
  const hash = sha256(content);

  const insert = db
    .insert(legalDocuments)
    .values({
      docSet: "DOC1",
      docType: "GLOBAL_MASTER",
      jurisdictionType: "DEFAULT",
      jurisdictionKey: "GLOBAL",
      version: "1.0.0",
      sha256: hash,
      content,
      notes: "BOOTSTRAP: default global terms seeded at startup",
    })
    .run();

  const docId = Number(insert.lastInsertRowid);

  const pointer = db
    .select({ id: legalDocPointers.id })
    .from(legalDocPointers)
    .where(
      and(
        eq(legalDocPointers.docSet, "DOC1"),
        eq(legalDocPointers.docType, "GLOBAL_MASTER"),
        eq(legalDocPointers.jurisdictionType, "DEFAULT"),
        eq(legalDocPointers.jurisdictionKey, "GLOBAL"),
      ),
    )
    .limit(1)
    .get();

  if (!pointer?.id) {
    db.insert(legalDocPointers)
      .values({
        docSet: "DOC1",
        docType: "GLOBAL_MASTER",
        jurisdictionType: "DEFAULT",
        jurisdictionKey: "GLOBAL",
        activeDocumentId: docId,
      })
      .run();
  }

  console.log("DOC1 GLOBAL_MASTER bootstrapped with ID:", docId);
}
