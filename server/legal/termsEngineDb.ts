/**
 * Terms Engine - Database-first document assembly using Drizzle ORM
 * Resolves legal documents for a given jurisdiction using 4-part key precedence rules
 */

import { and, eq, desc } from "drizzle-orm";
import { db } from "@db";
import { legalDocuments, legalDocPointers, systemConfig } from "../../shared/schema";
import { sha256, generateDoc1TermsToken, type Doc1TermsTokenPayload } from "./cryptoUtils";
import { getJurisdictionRestrictionPolicy, getRegionForCountry } from "./regionRules";

export type TargetKey = {
  docSet: string;
  docType: "GLOBAL_MASTER" | "ADDENDUM";
  jurisdictionType: "DEFAULT" | "COUNTRY" | "REGION";
  jurisdictionKey: string;
};

export type ResolvedDoc = {
  id: number;
  docSet: string;
  docType: string;
  jurisdictionType: string;
  jurisdictionKey: string;
  version: string;
  sha256: string;
  content: string;
  createdAt: number;
};

export type AssembleResult = {
  meta: {
    countryIso2: string;
    regionKey: string | null;
    enforce: boolean;
  };
  global: { id: number; version: string; sha256: string; mode: string } | null;
  addendum: { id: number; version: string; sha256: string; mode: string; target: TargetKey } | null;
  combined: {
    text: string;
    sha256: string;
  };
  token: string;
  warnings: string[];
  blocked: boolean;
  blockedReason: string | null;
};

function normIso2(x: any): string {
  return String(x || "").trim().toUpperCase();
}

function normRegion(x: any): string | null {
  const s = String(x || "").trim();
  return s || null;
}

/**
 * Check if enforcement is enabled from systemConfig
 */
export async function isEnforcementEnabled(): Promise<boolean> {
  try {
    const [config] = await db.select().from(systemConfig).where(eq(systemConfig.id, 1)).limit(1);
    return !!config?.legalCoverageEnforce;
  } catch {
    return false;
  }
}

/**
 * Get active document for a target (4-part key)
 */
async function getActiveDocForTarget(target: TargetKey): Promise<{ activeDocId: number | null; doc: ResolvedDoc | null }> {
  const [pointer] = await db
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

  if (!pointer || !pointer.activeDocumentId) {
    return { activeDocId: null, doc: null };
  }

  const [doc] = await db
    .select()
    .from(legalDocuments)
    .where(eq(legalDocuments.id, pointer.activeDocumentId))
    .limit(1);

  if (!doc) {
    return { activeDocId: pointer.activeDocumentId, doc: null };
  }

  return {
    activeDocId: pointer.activeDocumentId,
    doc: {
      id: doc.id,
      docSet: doc.docSet,
      docType: doc.docType,
      jurisdictionType: doc.jurisdictionType,
      jurisdictionKey: doc.jurisdictionKey,
      version: doc.version,
      sha256: doc.sha256,
      content: doc.content,
      createdAt: typeof doc.createdAt === "number" ? doc.createdAt : Date.now(),
    },
  };
}

/**
 * Get latest document for a target (fallback when not enforced)
 */
async function getLatestDocForTarget(target: TargetKey): Promise<ResolvedDoc | null> {
  const [doc] = await db
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
    .limit(1);

  if (!doc) return null;

  return {
    id: doc.id,
    docSet: doc.docSet,
    docType: doc.docType,
    jurisdictionType: doc.jurisdictionType,
    jurisdictionKey: doc.jurisdictionKey,
    version: doc.version,
    sha256: doc.sha256,
    content: doc.content,
    createdAt: typeof doc.createdAt === "number" ? doc.createdAt : Date.now(),
  };
}

/**
 * Generate verifiable Doc1 terms token with full HMAC signature
 */
function generateTermsToken(params: {
  globalDocId: number | null;
  globalVersion: string | null;
  globalSha256: string | null;
  addendumDocId: number | null;
  addendumVersion: string | null;
  addendumSha256: string | null;
  combinedSha256: string;
  countryIso2: string;
  regionKey: string | null;
  timestamp: number;
}): string {
  const payload: Doc1TermsTokenPayload = {
    v: 1,
    ts: params.timestamp,
    countryIso2: params.countryIso2,
    regionKey: params.regionKey,

    global: {
      id: params.globalDocId!,
      version: params.globalVersion!,
      sha256: params.globalSha256!,
    },
    addendum: params.addendumDocId
      ? { id: params.addendumDocId, version: params.addendumVersion!, sha256: params.addendumSha256! }
      : null,

    combinedSha256: params.combinedSha256,
  };

  return generateDoc1TermsToken(payload);
}

/**
 * Assemble DOC1 terms for a country using 4-part key precedence
 * Precedence: COUNTRY/{ISO2} → REGION/{regionKey} → DEFAULT/ROW
 */
export type Doc1AssemblePurpose = "SIGNUP" | "LOGIN" | "ADMIN_VIEW" | "PUBLIC";

export async function assembleDoc1Terms(
  countryIso2: string,
  overrideEnforceOrOpts?: boolean | { overrideEnforce?: boolean; purpose?: Doc1AssemblePurpose }
): Promise<AssembleResult> {
  const opts =
    typeof overrideEnforceOrOpts === "object" && overrideEnforceOrOpts !== null
      ? overrideEnforceOrOpts
      : { overrideEnforce: overrideEnforceOrOpts };

  const purpose: Doc1AssemblePurpose = (opts?.purpose ?? "PUBLIC") as Doc1AssemblePurpose;
  const ISO2 = normIso2(countryIso2);
  const regionKey = getRegionForCountry(ISO2);
  const RK = regionKey !== "ROW" ? regionKey : null;
  
  const enforce = opts.overrideEnforce ?? await isEnforcementEnabled();
  const warnings: string[] = [];

  // Check restricted (country selection only; IP geo enforcement lives in jurisdictionControl)
  const jp = getJurisdictionRestrictionPolicy();
  const restrictedByCountry = jp.countries.includes(ISO2);

  const shouldBlockByCountryForPurpose =
    jp.jurisdictionEnforceBySignupCountry &&
    (purpose === "LOGIN"
      ? jp.jurisdictionBlockLogin
      : purpose === "SIGNUP" || purpose === "PUBLIC"
        ? jp.jurisdictionBlockSignup
        : false);

  if (restrictedByCountry && shouldBlockByCountryForPurpose) {
    return {
      meta: { countryIso2: ISO2, regionKey: RK, enforce },
      global: null,
      addendum: null,
      combined: { text: "", sha256: "" },
      token: "",
      warnings: [],
      blocked: true,
      blockedReason: "JURISDICTION_RESTRICTED",
    };
  }

  // GLOBAL_MASTER is always DEFAULT/GLOBAL
  const globalTarget: TargetKey = {
    docSet: "DOC1",
    docType: "GLOBAL_MASTER",
    jurisdictionType: "DEFAULT",
    jurisdictionKey: "GLOBAL",
  };

  // ADDENDUM precedence: COUNTRY → REGION → DEFAULT/ROW
  const addendumTargets: TargetKey[] = [];
  if (ISO2) {
    addendumTargets.push({
      docSet: "DOC1",
      docType: "ADDENDUM",
      jurisdictionType: "COUNTRY",
      jurisdictionKey: ISO2,
    });
  }
  if (RK) {
    addendumTargets.push({
      docSet: "DOC1",
      docType: "ADDENDUM",
      jurisdictionType: "REGION",
      jurisdictionKey: RK,
    });
  }
  addendumTargets.push({
    docSet: "DOC1",
    docType: "ADDENDUM",
    jurisdictionType: "DEFAULT",
    jurisdictionKey: "ROW",
  });

  // Resolve GLOBAL
  const gActive = await getActiveDocForTarget(globalTarget);
  let globalMode = "ACTIVE_TARGET";
  let globalDoc = gActive.doc;

  if (!globalDoc) {
    if (enforce) {
      return {
        meta: { countryIso2: ISO2, regionKey: RK, enforce },
        global: null,
        addendum: null,
        combined: { text: "", sha256: "" },
        token: "",
        warnings: [],
        blocked: true,
        blockedReason: "GLOBAL_MASTER_ACTIVE_TARGET_MISSING",
      };
    }

    const latest = await getLatestDocForTarget(globalTarget);
    if (latest) {
      globalMode = "FALLBACK_LATEST";
      globalDoc = latest;
      warnings.push("GLOBAL_MASTER missing active target; using latest doc fallback.");
    } else {
      globalMode = "MISSING";
      warnings.push("GLOBAL_MASTER missing both active target and any doc content.");
    }
  }

  // Resolve ADDENDUM by precedence
  let chosenAddendumTarget = addendumTargets[addendumTargets.length - 1];
  let addMode = "MISSING";
  let addDoc: ResolvedDoc | null = null;

  for (const t of addendumTargets) {
    const aActive = await getActiveDocForTarget(t);
    if (aActive.doc) {
      chosenAddendumTarget = t;
      addMode = "ACTIVE_TARGET";
      addDoc = aActive.doc;
      break;
    }

    if (enforce) {
      continue;
    }

    const latest = await getLatestDocForTarget(t);
    if (latest) {
      chosenAddendumTarget = t;
      addMode = "FALLBACK_LATEST";
      addDoc = latest;
      warnings.push(`ADDENDUM ${t.jurisdictionType}/${t.jurisdictionKey} missing active target; using latest doc fallback.`);
      break;
    }
  }

  if (!addDoc && enforce) {
    return {
      meta: { countryIso2: ISO2, regionKey: RK, enforce },
      global: globalDoc
        ? { id: globalDoc.id, version: globalDoc.version, sha256: globalDoc.sha256, mode: globalMode }
        : null,
      addendum: null,
      combined: { text: "", sha256: "" },
      token: "",
      warnings: [],
      blocked: true,
      blockedReason: "ADDENDUM_ACTIVE_TARGET_MISSING",
    };
  }

  if (!addDoc) {
    warnings.push("ADDENDUM missing active targets and no docs found in fallback search.");
  }

  // GLOBAL_MASTER content is always required - block if missing
  const hasGlobalContent = !!globalDoc?.content;
  if (!hasGlobalContent) {
    return {
      meta: { countryIso2: ISO2, regionKey: RK, enforce },
      global: null,
      addendum: addDoc
        ? { id: addDoc.id, version: addDoc.version, sha256: addDoc.sha256, mode: addMode, target: chosenAddendumTarget }
        : null,
      combined: { text: "", sha256: "" },
      token: "",
      warnings: ["GLOBAL_MASTER content is required but not available."],
      blocked: true,
      blockedReason: "GLOBAL_MASTER_CONTENT_MISSING",
    };
  }

  // Assemble combined text
  const DELIM = "\n\n---\n\n";
  const parts: string[] = [];
  if (globalDoc?.content) parts.push(globalDoc.content);
  if (addDoc?.content) parts.push(addDoc.content);

  const combinedText = parts.join(DELIM);
  const combinedSha256 = sha256(combinedText);

  // Generate HMAC token
  const timestamp = Date.now();
  const token = generateTermsToken({
    globalDocId: globalDoc?.id || null,
    globalVersion: globalDoc?.version || null,
    globalSha256: globalDoc?.sha256 || null,
    addendumDocId: addDoc?.id || null,
    addendumVersion: addDoc?.version || null,
    addendumSha256: addDoc?.sha256 || null,
    combinedSha256,
    countryIso2: ISO2,
    regionKey: RK,
    timestamp,
  });

  return {
    meta: { countryIso2: ISO2, regionKey: RK, enforce },
    global: globalDoc
      ? { id: globalDoc.id, version: globalDoc.version, sha256: globalDoc.sha256, mode: globalMode }
      : null,
    addendum: addDoc
      ? { id: addDoc.id, version: addDoc.version, sha256: addDoc.sha256, mode: addMode, target: chosenAddendumTarget }
      : null,
    combined: { text: combinedText, sha256: combinedSha256 },
    token,
    warnings,
    blocked: false,
    blockedReason: null,
  };
}

/**
 * Check if terms are available for a country (used by signup flow)
 */
export async function checkTermsAvailability(countryCode: string): Promise<{
  available: boolean;
  restricted: boolean;
  scopeKey: string | null;
  fallback: boolean;
}> {
  const ISO2 = normIso2(countryCode);
  const result = await assembleDoc1Terms(ISO2, { overrideEnforce: false, purpose: "SIGNUP" });

  if (result.blocked) {
    return {
      available: false,
      restricted: result.blockedReason === "JURISDICTION_RESTRICTED",
      scopeKey: null,
      fallback: false,
    };
  }

  const fallbackUsed = result.global?.mode === "FALLBACK_LATEST" || result.addendum?.mode === "FALLBACK_LATEST";
  const scopeKey = result.addendum?.target
    ? `${result.addendum.target.jurisdictionType}/${result.addendum.target.jurisdictionKey}`
    : null;

  return {
    available: true,
    restricted: false,
    scopeKey,
    fallback: fallbackUsed,
  };
}

/**
 * Verify document content hash matches
 */
export async function verifyDocumentHash(docId: number, providedHash: string): Promise<boolean> {
  const [doc] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, docId)).limit(1);
  if (!doc) return false;

  const computedHash = sha256(doc.content);
  return computedHash === providedHash && doc.sha256 === providedHash;
}
