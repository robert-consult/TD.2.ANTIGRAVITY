import { db } from "@db";
import { eq } from "drizzle-orm";
import { users, userVerification } from "@shared/schema";
import {
  computeContenderEligibility,
  type DecisionContext,
  type PolicyConfig,
  type ContenderTier,
} from "@shared/policyDecision";
import { appendIdentityAudit } from "../services/identityAudit";

const CONTENDER_TIER_RANK: Record<ContenderTier, number> = {
  NONE: 0,
  CANDIDATE_EMAIL_ONLY: 1,
  CANDIDATE_SMS_REQUIRED: 2,
  VERIFIED_SMS: 3,
  SELECTED_REAL_CAPITAL: 4,
};

function shouldPromoteContenderTier(current: ContenderTier, proposed: ContenderTier): boolean {
  return CONTENDER_TIER_RANK[proposed] > CONTENDER_TIER_RANK[current];
}

export async function promotePerformerIfEligible(args: {
  ctx: DecisionContext;
  policyConfig: PolicyConfig;
  correlationId?: string | null;
  actorType?: "USER" | "ADMIN" | "SYSTEM";
  actorUserId?: number | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ eligible: boolean; path1: boolean; path2: boolean; promoted: boolean }> {
  const { ctx, policyConfig } = args;
  const contender = computeContenderEligibility(ctx, policyConfig);

  if (!contender.eligible) {
    return { eligible: contender.eligible, path1: contender.path1, path2: contender.path2, promoted: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let promoted = false;
  let contenderTierUpdated = false;

  const verification = await db.query.userVerification.findFirst({
    where: eq(userVerification.userId, ctx.user.id),
  });

  const currentTier = (verification?.contenderTier ?? "NONE") as ContenderTier;
  if (shouldPromoteContenderTier(currentTier, "CANDIDATE_SMS_REQUIRED")) {
    contenderTierUpdated = true;
    if (verification) {
      await db.update(userVerification)
        .set({
          contenderTier: "CANDIDATE_SMS_REQUIRED",
          contenderEligibleAt: verification.contenderEligibleAt ?? nowSec,
          updatedAt: nowSec,
        })
        .where(eq(userVerification.userId, ctx.user.id));
    } else {
      await db.insert(userVerification).values({
        userId: ctx.user.id,
        contenderTier: "CANDIDATE_SMS_REQUIRED",
        contenderEligibleAt: nowSec,
        createdAt: nowSec,
        updatedAt: nowSec,
      } as any);
    }
  }

  if (policyConfig.autoPromotePerformer && ctx.user.userTier === "CANDIDATE") {
    promoted = true;
    await db.update(users)
      .set({
        userTier: "PERFORMER",
        tierPromotedAt: nowSec,
        tierPromotedBy: args.actorUserId ?? null,
      })
      .where(eq(users.id, ctx.user.id));
  }

  if (promoted || contenderTierUpdated) {
    try {
      appendIdentityAudit({
        userId: ctx.user.id,
        email: ctx.user.email,
        username: ctx.user.username ?? undefined,
        category: "TIER",
        type: promoted ? "PERFORMER_PROMOTED" : "CONTENDER_ELIGIBLE",
        title: promoted ? "User promoted to PERFORMER" : "User became eligible for SMS verification",
        description: `Eligibility met (path1=${contender.path1}, path2=${contender.path2})`,
        actorAdminId: args.actorType === "ADMIN" ? args.actorUserId ?? null : null,
        actorType: args.actorType ?? "SYSTEM",
        actorUserId: args.actorUserId ?? null,
        sessionId: args.sessionId ?? null,
        correlationId: args.correlationId ?? null,
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
        data: {
          path1: contender.path1,
          path2: contender.path2,
          accountAgeDays: ctx.metrics.accountAgeDays,
          balancePctOfStart: ctx.metrics.balancePctOfStart,
          tradesLifetime: ctx.metrics.tradesLifetime,
          tradesLast90d: ctx.metrics.tradesLast90d,
          returnLast90d: ctx.metrics.returnLast90d,
        },
      });
    } catch (err) {
      console.error("Failed to write contender eligibility audit:", err);
    }
  }

  return { eligible: contender.eligible, path1: contender.path1, path2: contender.path2, promoted };
}
