import { db } from "@db";
import { eq, sql } from "drizzle-orm";
import { recruitingPipeline, users } from "@shared/schema";
import { computeDoc1ReacceptStatus } from "../legal/legalReacceptanceService";

export const PIPELINE_STAGES = [
  "DETECTED",
  "WATCHLIST",
  "CONTACTED",
  "VETTED_EMAIL",
  "VETTED_SMS",
  "PERFORMER",
  "SELECTED_KYC",
  "PARTNER_READY",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineUpdatePatch = {
  stage?: PipelineStage;
  assignedAdminId?: number | null;
  lastContactedAt?: number | null;
  notes?: string | null;
  isPartnerVisible?: boolean;
};

export type PipelineUpdateResult =
  | {
      ok: true;
      row: typeof recruitingPipeline.$inferSelect;
      applied: {
        stage?: PipelineStage;
        isPartnerVisible?: boolean;
      };
    }
  | {
      ok: false;
      message:
        | "TRADER_NOT_FOUND"
        | "PIPELINE_NOT_FOUND"
        | "PARTNER_VISIBILITY_REQUIRES_PARTNER_READY"
        | "PARTNER_READY_GATING_FAILED";
      reason?: string;
    };

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function parseBool(raw: unknown): boolean {
  return raw === true;
}

export function parseOptionalPipelineStage(raw: unknown): PipelineStage | null {
  const text = String(raw ?? "").trim().toUpperCase();
  if (!text) return null;
  return PIPELINE_STAGES.includes(text as PipelineStage) ? (text as PipelineStage) : null;
}

async function getTraderUser(userId: number): Promise<{ id: number; isAdmin: boolean; isDeleted: boolean } | null> {
  const [row] = await db
    .select({ id: users.id, isAdmin: users.isAdmin, isDeleted: users.isDeleted })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function ensurePipelineRowForUser(userId: number): Promise<boolean> {
  const user = await getTraderUser(userId);
  if (!user || user.isAdmin || user.isDeleted) return false;

  const ts = nowSec();
  await db
    .insert(recruitingPipeline)
    .values({
      userId,
      stage: "DETECTED",
      isPartnerVisible: false,
      updatedAt: ts,
    })
    .onConflictDoNothing();
  return true;
}

export async function canSetPartnerReady(userId: number): Promise<{ allowed: boolean; reason?: string }> {
  const [row] = await db
    .select({
      userTier: users.userTier,
      kycStatus: users.kycStatus,
      isDisabled: users.isDisabled,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return { allowed: false, reason: "USER_NOT_FOUND" };
  if (row.isDisabled || row.isDeleted) return { allowed: false, reason: "USER_NOT_ACTIVE" };

  const kyc = String(row.kycStatus || "").toLowerCase();
  if (kyc !== "approved") return { allowed: false, reason: "KYC_NOT_APPROVED" };

  const tier = String(row.userTier || "").toUpperCase();
  if (tier !== "PERFORMER" && tier !== "SELECTED") {
    return { allowed: false, reason: "TIER_NOT_ELIGIBLE" };
  }

  const legal = await computeDoc1ReacceptStatus(userId);
  if (legal.blocked) return { allowed: false, reason: "LEGAL_BLOCKED" };
  if (legal.required) return { allowed: false, reason: "LEGAL_REACCEPT_REQUIRED" };

  return { allowed: true };
}

export async function updateRecruitingPipelineForUser(params: {
  userId: number;
  patch: PipelineUpdatePatch;
  now?: number;
}): Promise<PipelineUpdateResult> {
  const ensured = await ensurePipelineRowForUser(params.userId);
  if (!ensured) {
    return { ok: false, message: "TRADER_NOT_FOUND" };
  }

  const [current] = await db
    .select({ stage: recruitingPipeline.stage })
    .from(recruitingPipeline)
    .where(eq(recruitingPipeline.userId, params.userId))
    .limit(1);

  if (!current) {
    return { ok: false, message: "PIPELINE_NOT_FOUND" };
  }

  const ts = Number.isFinite(params.now) ? Math.trunc(params.now as number) : nowSec();
  const incomingStage = params.patch.stage ?? null;
  const effectiveStage = incomingStage ?? String(current.stage || "DETECTED");
  const requestedPartnerVisible = parseBool(params.patch.isPartnerVisible);
  const requestedPartnerReady = effectiveStage === "PARTNER_READY" || requestedPartnerVisible;

  if (requestedPartnerVisible && effectiveStage !== "PARTNER_READY") {
    return {
      ok: false,
      message: "PARTNER_VISIBILITY_REQUIRES_PARTNER_READY",
    };
  }

  if (requestedPartnerReady) {
    const eligibility = await canSetPartnerReady(params.userId);
    if (!eligibility.allowed) {
      return {
        ok: false,
        message: "PARTNER_READY_GATING_FAILED",
        reason: eligibility.reason,
      };
    }
  }

  const nextLastContactedAt =
    params.patch.lastContactedAt !== undefined
      ? params.patch.lastContactedAt
      : incomingStage === "CONTACTED"
        ? ts
        : undefined;

  const nextIsPartnerVisible =
    incomingStage === "PARTNER_READY"
      ? true
      : params.patch.isPartnerVisible !== undefined
        ? params.patch.isPartnerVisible
        : undefined;

  await db
    .update(recruitingPipeline)
    .set({
      stage: incomingStage ?? undefined,
      assignedAdminId: params.patch.assignedAdminId,
      lastContactedAt: nextLastContactedAt,
      notes: params.patch.notes,
      isPartnerVisible: nextIsPartnerVisible,
      updatedAt: ts,
    })
    .where(eq(recruitingPipeline.userId, params.userId));

  const [updated] = await db.select().from(recruitingPipeline).where(eq(recruitingPipeline.userId, params.userId)).limit(1);
  if (!updated) return { ok: false, message: "PIPELINE_NOT_FOUND" };

  return {
    ok: true,
    row: updated,
    applied: {
      stage: incomingStage ?? undefined,
      isPartnerVisible: nextIsPartnerVisible,
    },
  };
}

export async function getPartnerEligibilityUserIds(): Promise<number[]> {
  const rows = await db.execute(sql`
    SELECT rp.user_id
    FROM recruiting_pipeline rp
    INNER JOIN users u ON u.id = rp.user_id
    WHERE rp.stage = 'PARTNER_READY'
      AND rp.is_partner_visible = true
      AND u.is_admin = false
      AND u.is_disabled = false
      AND u.is_deleted = false
      AND COALESCE(LOWER(u.kyc_status), '') = 'approved'
      AND COALESCE(u.user_tier, 'CANDIDATE') IN ('PERFORMER', 'SELECTED')
    ORDER BY rp.updated_at DESC
  `);

  return ((rows as any).rows ?? [])
    .map((row: any) => Number(row.user_id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}
