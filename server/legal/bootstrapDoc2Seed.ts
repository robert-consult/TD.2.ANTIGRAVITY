/**
 * Bootstrap DOC2 (Privacy Policy) Seed
 * Seeds the initial privacy policy into the legal_documents system.
 */

import { db } from "@db";
import { legalDocuments, legalDocPointers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { sha256 } from "./cryptoUtils";
import { getDefaultGlobalPrivacyPolicy, getMobileAppPrivacyAddendum } from "./doc2Pack";

export async function bootstrapDoc2Seed(adminUserId: number): Promise<void> {
    if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
        throw new Error(`bootstrapDoc2Seed: adminUserId must be a positive integer (got ${adminUserId})`);
    }

    const globalPolicy = getDefaultGlobalPrivacyPolicy();
    const mobileAddendum = getMobileAppPrivacyAddendum();

    const globalKey = {
        docSet: "DOC2",
        docType: "GLOBAL_MASTER",
        jurisdictionType: "DEFAULT",
        jurisdictionKey: "GLOBAL",
    } as const;

    const mobileKey = {
        docSet: "DOC2",
        docType: "ADDENDUM",
        jurisdictionType: "DEFAULT",
        jurisdictionKey: "MOBILE",
    } as const;

    const existingGlobal = await db
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(
            and(
                eq(legalDocuments.docSet, globalKey.docSet),
                eq(legalDocuments.docType, globalKey.docType),
                eq(legalDocuments.jurisdictionType, globalKey.jurisdictionType),
                eq(legalDocuments.jurisdictionKey, globalKey.jurisdictionKey),
            ),
        )
        .limit(1);

    let globalDocId = Number(existingGlobal[0]?.id || 0);
    let createdGlobal = false;

    if (!globalDocId) {
        const content = globalPolicy.body;
        const [doc] = await db
            .insert(legalDocuments)
            .values({
                ...globalKey,
                version: "1.0.0",
                title: globalPolicy.title,
                content,
                sha256: sha256(content),
                notes: "BOOTSTRAP: initial global privacy policy seed",
                createdByAdminUserId: adminUserId,
            })
            .returning({ id: legalDocuments.id });

        globalDocId = Number(doc?.id || 0);
        createdGlobal = true;
    }

    const existingMobile = await db
        .select({ id: legalDocuments.id })
        .from(legalDocuments)
        .where(
            and(
                eq(legalDocuments.docSet, mobileKey.docSet),
                eq(legalDocuments.docType, mobileKey.docType),
                eq(legalDocuments.jurisdictionType, mobileKey.jurisdictionType),
                eq(legalDocuments.jurisdictionKey, mobileKey.jurisdictionKey),
            ),
        )
        .limit(1);

    let mobileDocId = Number(existingMobile[0]?.id || 0);
    let createdMobile = false;

    if (!mobileDocId) {
        const content = mobileAddendum.body;
        const [doc] = await db
            .insert(legalDocuments)
            .values({
                ...mobileKey,
                version: "1.0.0",
                title: mobileAddendum.title,
                content,
                sha256: sha256(content),
                notes: "BOOTSTRAP: initial mobile privacy addendum seed",
                createdByAdminUserId: adminUserId,
            })
            .returning({ id: legalDocuments.id });

        mobileDocId = Number(doc?.id || 0);
        createdMobile = true;
    }

    const existingGlobalPointer = await db
        .select({ id: legalDocPointers.id })
        .from(legalDocPointers)
        .where(
            and(
                eq(legalDocPointers.docSet, globalKey.docSet),
                eq(legalDocPointers.docType, globalKey.docType),
                eq(legalDocPointers.jurisdictionType, globalKey.jurisdictionType),
                eq(legalDocPointers.jurisdictionKey, globalKey.jurisdictionKey),
            ),
        )
        .limit(1);

    if (!existingGlobalPointer[0]?.id) {
        await db.insert(legalDocPointers).values({
            ...globalKey,
            activeDocumentId: globalDocId || null,
            updatedByAdminUserId: adminUserId,
        });
    }

    const existingMobilePointer = await db
        .select({ id: legalDocPointers.id })
        .from(legalDocPointers)
        .where(
            and(
                eq(legalDocPointers.docSet, mobileKey.docSet),
                eq(legalDocPointers.docType, mobileKey.docType),
                eq(legalDocPointers.jurisdictionType, mobileKey.jurisdictionType),
                eq(legalDocPointers.jurisdictionKey, mobileKey.jurisdictionKey),
            ),
        )
        .limit(1);

    if (!existingMobilePointer[0]?.id) {
        await db.insert(legalDocPointers).values({
            ...mobileKey,
            activeDocumentId: mobileDocId || null,
            updatedByAdminUserId: adminUserId,
        });
    }

    console.log(`[DOC2 Seed] Global privacy policy ${createdGlobal ? "created" : "exists"} (id=${globalDocId})`);
    console.log(`[DOC2 Seed] Mobile privacy addendum ${createdMobile ? "created" : "exists"} (id=${mobileDocId})`);
}
