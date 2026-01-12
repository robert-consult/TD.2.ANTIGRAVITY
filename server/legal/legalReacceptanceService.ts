import { db } from "@db";
import { legalAcceptances, legalReacceptRequirements, users } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { assembleDoc1Terms, type AssembleResult } from "./termsEngineDb";

export type ReacceptDetectionSource = "LOGIN" | "TRADE" | "STATUS";

export type Doc1ReacceptStatus = {
  blocked: boolean;
  blockedReason: string | null;

  countryIso2: string | null;
  regionKey: string | null;

  required: boolean;
  requiredCombinedSha256: string | null;

  lastAcceptedCombinedSha256: string | null;
  lastAcceptanceId: number | null;
};

const DOC_SET = "DOC1" as const;

function normalizeCountryIso2(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim().toUpperCase();
  if (!v) return null;
  if (!/^[A-Z]{2}$/.test(v)) return null;
  return v;
}

async function getLatestDoc1Acceptance(userId: number): Promise<{ id: number; combinedSha256: string } | null> {
  const [row] = await db
    .select({ id: legalAcceptances.id, combinedSha256: legalAcceptances.combinedSha256 })
    .from(legalAcceptances)
    .where(eq(legalAcceptances.userId, userId))
    .orderBy(desc(legalAcceptances.id))
    .limit(1)
    ;
  if (!row) return null;
  return { id: Number(row.id), combinedSha256: String(row.combinedSha256 || "") };
}

export async function getDoc1ReacceptRequirement(userId: number): Promise<{
  requiredCombinedSha256: string;
  lastAcceptedCombinedSha256: string | null;
} | null> {
  const [row] = await db
    .select({
      requiredCombinedSha256: legalReacceptRequirements.requiredCombinedSha256,
      lastAcceptedCombinedSha256: legalReacceptRequirements.lastAcceptedCombinedSha256,
    })
    .from(legalReacceptRequirements)
    .where(and(eq(legalReacceptRequirements.userId, userId), eq(legalReacceptRequirements.docSet, DOC_SET)))
    .limit(1)
    ;

  if (!row) return null;
  return {
    requiredCombinedSha256: String(row.requiredCombinedSha256 || ""),
    lastAcceptedCombinedSha256: row.lastAcceptedCombinedSha256 ? String(row.lastAcceptedCombinedSha256) : null,
  };
}

export async function clearDoc1ReacceptRequirement(userId: number): Promise<void> {
  await db.delete(legalReacceptRequirements)
    .where(and(eq(legalReacceptRequirements.userId, userId), eq(legalReacceptRequirements.docSet, DOC_SET)));
}

export async function computeDoc1ReacceptStatus(userId: number): Promise<Doc1ReacceptStatus> {
  return (await computeDoc1ReacceptStatusWithTerms(userId)).status;
}

export async function computeDoc1ReacceptStatusWithTerms(userId: number): Promise<{
  status: Doc1ReacceptStatus;
  assembled: AssembleResult | null;
}> {
  const [user] = await db
    .select({ countryIso2: users.countryIso2, country: users.country })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    ;

  const countryIso2 =
    normalizeCountryIso2(user?.countryIso2) ?? normalizeCountryIso2(user?.country);

  if (!countryIso2) {
    const last = await getLatestDoc1Acceptance(userId);
    return {
      assembled: null,
      status: {
      blocked: true,
      blockedReason: "COUNTRY_REQUIRED",
      countryIso2: null,
      regionKey: null,
      required: true,
      requiredCombinedSha256: null,
      lastAcceptedCombinedSha256: last?.combinedSha256 ?? null,
      lastAcceptanceId: last?.id ?? null,
      },
    };
  }

  const assembled = await assembleDoc1Terms(countryIso2, { purpose: "LOGIN" });

  if (assembled.blocked) {
    const last = await getLatestDoc1Acceptance(userId);
    return {
      assembled,
      status: {
      blocked: true,
      blockedReason: assembled.blockedReason,
      countryIso2: assembled.meta.countryIso2,
      regionKey: assembled.meta.regionKey,
      required: false,
      requiredCombinedSha256: null,
      lastAcceptedCombinedSha256: last?.combinedSha256 ?? null,
      lastAcceptanceId: last?.id ?? null,
      },
    };
  }

  const requiredCombinedSha256 = assembled.combined?.sha256 ? String(assembled.combined.sha256) : null;
  const last = await getLatestDoc1Acceptance(userId);
  const lastAcceptedCombinedSha256 = last?.combinedSha256 ?? null;

  const required = !lastAcceptedCombinedSha256 || !requiredCombinedSha256 || lastAcceptedCombinedSha256 !== requiredCombinedSha256;

  return {
    assembled,
    status: {
    blocked: false,
    blockedReason: null,
    countryIso2: assembled.meta.countryIso2,
    regionKey: assembled.meta.regionKey,
    required,
    requiredCombinedSha256,
    lastAcceptedCombinedSha256,
    lastAcceptanceId: last?.id ?? null,
    },
  };
}

export async function upsertDoc1ReacceptRequirement(params: {
  userId: number;
  detectedBy: ReacceptDetectionSource;
  status?: Doc1ReacceptStatus;
}): Promise<void> {
  const status = params.status ?? (await computeDoc1ReacceptStatus(params.userId));

  if (status.blocked || !status.required) {
    await clearDoc1ReacceptRequirement(params.userId);
    return;
  }

  if (!status.countryIso2 || !status.requiredCombinedSha256) return;

  await db.insert(legalReacceptRequirements)
    .values({
      userId: params.userId,
      docSet: DOC_SET,
      countryIso2: status.countryIso2,
      regionKey: status.regionKey,
      requiredCombinedSha256: status.requiredCombinedSha256,
      lastAcceptedCombinedSha256: status.lastAcceptedCombinedSha256,
      lastAcceptanceId: status.lastAcceptanceId,
      detectedAtMs: Date.now(),
      detectedBy: params.detectedBy,
    })
    .onConflictDoUpdate({
      target: [legalReacceptRequirements.userId, legalReacceptRequirements.docSet],
      set: {
        countryIso2: status.countryIso2,
        regionKey: status.regionKey,
        requiredCombinedSha256: status.requiredCombinedSha256,
        lastAcceptedCombinedSha256: status.lastAcceptedCombinedSha256,
        lastAcceptanceId: status.lastAcceptanceId,
        detectedAtMs: Date.now(),
        detectedBy: params.detectedBy,
      },
    })
    ;
}
