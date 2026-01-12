import { db } from "@db";
import { legalDocuments, legalDocPointers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sha256 } from "./cryptoUtils";
import { getDefaultGlobalTerms } from "./doc1Pack";

export async function bootstrapDoc1Seed() {
  const existingRows = await db
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
    .limit(1);

  if (existingRows[0]?.id) return;

  const { title, body } = getDefaultGlobalTerms();
  const content = `${title}\n\n${body}`;
  const hash = sha256(content);

  const [doc] = await db
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
    .returning({ id: legalDocuments.id });

  const docId = Number(doc?.id || 0);

  const pointerRows = await db
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
    .limit(1);

  if (!pointerRows[0]?.id) {
    await db.insert(legalDocPointers).values({
      docSet: "DOC1",
      docType: "GLOBAL_MASTER",
      jurisdictionType: "DEFAULT",
      jurisdictionKey: "GLOBAL",
      activeDocumentId: docId || null,
    });
  }

  if (docId) {
    console.log("DOC1 GLOBAL_MASTER bootstrapped with ID:", docId);
  }
}
