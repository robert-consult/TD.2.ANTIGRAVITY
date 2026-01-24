/**
 * Bootstrap DOC2 (Privacy Policy) Seed
 * Seeds the initial privacy policy into the legal_documents system
 */

import { db } from "../../db";
import { legalDocuments, legalDocPointers } from "@db/schema";
import { getDefaultGlobalPrivacyPolicy, getMobileAppPrivacyAddendum } from "./doc2Pack";
import { computeSha256 } from "./cryptoUtils";

export async function bootstrapDoc2Seed(adminUserId: number): Promise<void> {
    const globalPolicy = getDefaultGlobalPrivacyPolicy();
    const mobileAddendum = getMobileAppPrivacyAddendum();

    const now = Date.now();

    // Insert global privacy policy
    const [globalDoc] = await db.insert(legalDocuments).values({
        docSet: 'DOC2',
        docType: 'GLOBAL_MASTER',
        jurisdictionType: 'DEFAULT',
        jurisdictionKey: 'GLOBAL',
        version: '1.0.0',
        title: globalPolicy.title,
        body: globalPolicy.body,
        sha256: computeSha256(globalPolicy.body),
        adminUserId,
        createdAt: now,
        updatedAt: now,
        notes: 'Initial seed - Global Privacy Policy',
    }).returning();

    // Insert mobile app addendum (as region addendum for all regions)
    const [mobileDoc] = await db.insert(legalDocuments).values({
        docSet: 'DOC2',
        docType: 'ADDENDUM',
        jurisdictionType: 'DEFAULT',
        jurisdictionKey: 'MOBILE',
        version: '1.0.0',
        title: mobileAddendum.title,
        body: mobileAddendum.body,
        sha256: computeSha256(mobileAddendum.body),
        adminUserId,
        createdAt: now,
        updatedAt: now,
        notes: 'Initial seed - Mobile App Privacy Addendum',
    }).returning();

    // Set global policy as active
    await db.insert(legalDocPointers).values({
        docSet: 'DOC2',
        docType: 'GLOBAL_MASTER',
        jurisdictionType: 'DEFAULT',
        jurisdictionKey: 'GLOBAL',
        activeDocumentId: globalDoc.id,
    }).onConflictDoNothing();

    // Set mobile addendum as active
    await db.insert(legalDocPointers).values({
        docSet: 'DOC2',
        docType: 'ADDENDUM',
        jurisdictionType: 'DEFAULT',
        jurisdictionKey: 'MOBILE',
        activeDocumentId: mobileDoc.id,
    }).onConflictDoNothing();

    console.log(`[DOC2 Seed] Created global privacy policy (id=${globalDoc.id})`);
    console.log(`[DOC2 Seed] Created mobile addendum (id=${mobileDoc.id})`);
}
