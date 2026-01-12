import { db } from "@db";
import { legalAcceptances, legalDocuments } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { sha256, stableStringify, verifyDoc1TermsToken, type Doc1TermsTokenPayload } from "./cryptoUtils";

export class LegalAcceptanceError extends Error {
  public code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function buildCombinedText(globalContent: string, addendumContent: string | null): string {
  return addendumContent ? `${globalContent}\n\n---\n\n${addendumContent}` : globalContent;
}

function assertSha256Like(v: string) {
  if (!/^[a-f0-9]{64}$/i.test(v)) throw new LegalAcceptanceError("SHA_INVALID", "Invalid SHA-256 format");
}

export async function recordDoc1Acceptance(params: {
  userId: number;
  emailAtAcceptance: string;
  countryIso2: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId: string | null;

  termsToken: string;
  combinedSha256: string;

  verifiedPayload?: Doc1TermsTokenPayload;
}) {
  assertSha256Like(params.combinedSha256);

  const verified =
    params.verifiedPayload ??
    (() => {
      const v = verifyDoc1TermsToken(params.termsToken, {
        expectedCountryIso2: params.countryIso2,
        maxAgeMs: 24 * 60 * 60 * 1000,
      });
      if (!v.ok) throw new LegalAcceptanceError("TOKEN_INVALID", v.error);
      return v.payload;
    })();

  if (verified.countryIso2 !== params.countryIso2) {
    throw new LegalAcceptanceError("COUNTRY_MISMATCH", "Token country mismatch");
  }
  if (verified.combinedSha256 !== params.combinedSha256) {
    throw new LegalAcceptanceError("COMBINED_SHA_MISMATCH", "Combined SHA mismatch");
  }

  const [globalDoc] = await db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.id, verified.global.id))
    .limit(1);

  if (!globalDoc) throw new LegalAcceptanceError("GLOBAL_DOC_MISSING", "Global doc missing");
  if (globalDoc.sha256 !== verified.global.sha256) {
    throw new LegalAcceptanceError("GLOBAL_DOC_SHA_MISMATCH", "Global doc SHA mismatch");
  }

  const addendumDoc =
    verified.addendum?.id != null
      ? (await db
          .select()
          .from(legalDocuments)
          .where(eq(legalDocuments.id, verified.addendum.id))
          .limit(1))[0]
      : null;

  if (verified.addendum) {
    if (!addendumDoc) throw new LegalAcceptanceError("ADDENDUM_DOC_MISSING", "Addendum doc missing");
    if (addendumDoc.sha256 !== verified.addendum.sha256) {
      throw new LegalAcceptanceError("ADDENDUM_DOC_SHA_MISMATCH", "Addendum doc SHA mismatch");
    }
  }

  const combinedText = buildCombinedText(globalDoc.content, addendumDoc?.content ?? null);
  const recomputed = sha256(combinedText);

  if (recomputed !== params.combinedSha256) {
    throw new LegalAcceptanceError("COMBINED_TEXT_MISMATCH", "Combined text does not hash to provided SHA");
  }

  const acceptedAtMs = Date.now(); // Store exact milliseconds for hash computation
  const acceptedAtSec = Math.floor(acceptedAtMs / 1000);
  const regionKey = verified.regionKey ?? null;

  const result = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({
        ledgerSeq: legalAcceptances.ledgerSeq,
        ledgerHash: legalAcceptances.ledgerHash,
        recordHash: legalAcceptances.recordHash,
      })
      .from(legalAcceptances)
      .orderBy(desc(legalAcceptances.ledgerSeq))
      .limit(1)
      ;

    const ledgerSeq = (last?.ledgerSeq ?? 0) + 1;
    const prevLedgerHash = last?.ledgerHash ?? "GENESIS";

    const ledgerPayload = {
      ledgerSeq,
      prevLedgerHash,
      userId: params.userId,
      emailAtAcceptance: params.emailAtAcceptance,
      countryIso2: params.countryIso2,
      regionKey,

      global: {
        id: globalDoc.id,
        version: globalDoc.version,
        sha256: globalDoc.sha256,
      },
      addendum: addendumDoc
        ? { id: addendumDoc.id, version: addendumDoc.version, sha256: addendumDoc.sha256 }
        : null,

      combinedSha256: params.combinedSha256,
      acceptedAtMs, // Use the stored milliseconds value
      sessionId: params.sessionId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      termsToken: params.termsToken,
    };

    const ledgerPayloadStr = stableStringify(ledgerPayload);
    const ledgerHash = sha256(`${prevLedgerHash}|${ledgerPayloadStr}`);

    const prevHash = last?.recordHash ?? "GENESIS";
    const recordPayloadStr = stableStringify({
      ...ledgerPayload,
      prevHash,
    });
    const recordHash = sha256(`${prevHash}|${recordPayloadStr}`);

    const [inserted] = await tx
      .insert(legalAcceptances)
      .values({
        ledgerSeq,
        prevLedgerHash,
        ledgerHash,

        userId: params.userId,
        emailAtAcceptance: params.emailAtAcceptance,
        countryIso2: params.countryIso2,
        regionKey,

        globalDocId: globalDoc.id,
        globalDocVersion: globalDoc.version,
        globalDocSha256: globalDoc.sha256,

        addendumId: addendumDoc?.id ?? null,
        addendumVersion: addendumDoc?.version ?? null,
        addendumSha256: addendumDoc?.sha256 ?? null,

        combinedText,
        combinedSha256: params.combinedSha256,

        acceptedAt: acceptedAtSec,
        acceptedAtMs, // Store exact milliseconds for hash verification
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        sessionId: params.sessionId,

        termsToken: params.termsToken,
        termsTokenVerified: true,

        prevHash,
        recordHash,
        acceptedFromIp: params.ipAddress,
        acceptedUserAgent: params.userAgent,
      })
      .returning({ id: legalAcceptances.id });

    return {
      acceptanceId: Number(inserted?.id),
      ledgerSeq,
      ledgerHash,
    };
  });

  return result;
}
