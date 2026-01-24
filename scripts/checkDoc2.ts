/**
 * Quick check if DOC2 (Privacy Policy) is seeded in the database
 */

import { db } from "../db";
import { legalDocuments, legalDocPointers } from "@db/schema";
import { eq } from "drizzle-orm";

async function checkDoc2() {
    console.log("🔍 Checking for Privacy Policy (DOC2) in database...\n");

    // Check legal_documents for DOC2
    const docs = await db.select({
        id: legalDocuments.id,
        docSet: legalDocuments.docSet,
        docType: legalDocuments.docType,
        jurisdictionKey: legalDocuments.jurisdictionKey,
        version: legalDocuments.version,
        title: legalDocuments.title,
    }).from(legalDocuments).where(eq(legalDocuments.docSet, 'DOC2'));

    // Check legal_doc_pointers for DOC2
    const pointers = await db.select({
        docSet: legalDocPointers.docSet,
        docType: legalDocPointers.docType,
        jurisdictionKey: legalDocPointers.jurisdictionKey,
        activeDocumentId: legalDocPointers.activeDocumentId,
    }).from(legalDocPointers).where(eq(legalDocPointers.docSet, 'DOC2'));

    if (docs.length === 0) {
        console.log("❌ No DOC2 documents found in legal_documents table.");
        console.log("   Run: npm run legal:seed:doc2");
    } else {
        console.log(`✅ Found ${docs.length} DOC2 document(s):\n`);
        docs.forEach(doc => {
            console.log(`   ID: ${doc.id}`);
            console.log(`   Type: ${doc.docType}`);
            console.log(`   Jurisdiction: ${doc.jurisdictionKey}`);
            console.log(`   Version: ${doc.version}`);
            console.log(`   Title: ${doc.title}`);
            console.log("");
        });
    }

    if (pointers.length === 0) {
        console.log("❌ No DOC2 pointers found in legal_doc_pointers table.");
    } else {
        console.log(`✅ Found ${pointers.length} DOC2 pointer(s):\n`);
        pointers.forEach(ptr => {
            console.log(`   Type: ${ptr.docType}, Key: ${ptr.jurisdictionKey}, ActiveDocId: ${ptr.activeDocumentId}`);
        });
    }

    process.exit(0);
}

checkDoc2().catch((err) => {
    console.error("❌ Error checking database:", err.message);
    process.exit(1);
});
