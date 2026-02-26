import { Router } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@db";
import {
  userKycProfiles,
  userPayoutProfiles,
  userVerification,
  users,
} from "@shared/schema";
import { computeContenderEligibility } from "@shared/policyDecision";
import { requireAdmin } from "../middleware/requireAdmin";
import { buildAuditContext } from "../lib/auditContext";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { promotePerformerIfEligible } from "../policy/performerPromotion";
import { appendIdentityAudit } from "../services/identityAudit";
import { createNotification, sendKycMailboxMessage } from "../services/messaging";
import { storage } from "../storage";
import { defaultPaymentCurrencyForCountry } from "../utils/paymentCurrency";

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const num = Number(value);
  if (Number.isFinite(num)) {
    const ms = num < 1e12 ? num * 1000 : num;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toUnixSec(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num < 1e12 ? Math.floor(num) : Math.floor(num / 1000);
}

async function ensureDefaultPayoutCurrency(user: any, userId: number, nowSec: number): Promise<string> {
  const preferred = defaultPaymentCurrencyForCountry({
    countryIso2: user?.countryIso2 ?? user?.country ?? null,
    regionKey: user?.regionKey ?? null,
  });

  const existing = await db.query.userPayoutProfiles.findFirst({
    where: eq(userPayoutProfiles.userId, userId),
  });

  if (existing) {
    if (!existing.preferredPaymentCurrency) {
      await db
        .update(userPayoutProfiles)
        .set({ preferredPaymentCurrency: preferred, updatedAt: nowSec })
        .where(eq(userPayoutProfiles.userId, userId));
    }
    return existing.preferredPaymentCurrency || preferred;
  }

  await db.insert(userPayoutProfiles).values({
    userId,
    preferredPaymentCurrency: preferred,
    createdAt: nowSec,
    updatedAt: nowSec,
  });
  return preferred;
}

async function notifyKycStatusChange(params: {
  userId: number;
  status: string;
  note?: string | null;
  actorAdminId: number;
}): Promise<void> {
  const status = String(params.status || "").toUpperCase();
  const title =
    status === "APPROVED"
      ? "KYC approved"
      : status === "REJECTED"
        ? "KYC rejected"
        : status === "INVITED"
          ? "KYC invited"
          : `KYC status: ${status}`;
  const message = params.note ? `${title}. ${params.note}` : `${title}. Check your account for next steps.`;

  void createNotification({
    userId: params.userId,
    type: "KYC",
    severity: status === "REJECTED" ? "WARNING" : status === "APPROVED" ? "SUCCESS" : "INFO",
    title,
    message,
    sourceEvent: `KYC_${status}:${params.userId}:${params.actorAdminId}:${Math.floor(Date.now() / 1000)}`,
    link: "/account",
    playSound: true,
  }).catch((err) => {
    console.error("[notifications] failed to create KYC notification:", err);
  });

  void sendKycMailboxMessage({
    userId: params.userId,
    actorAdminId: params.actorAdminId,
    subject: `KYC Update: ${status}`,
    body: message,
  }).catch((err) => {
    console.error("[mailbox] failed to create KYC mailbox update:", err);
  });
}

const tierChangeSchema = z.object({
  tier: z.enum(["CANDIDATE", "PERFORMER", "SELECTED"]),
  reason: z.string().optional(),
});

export const adminKycRouter = Router();
adminKycRouter.use(requireAdmin);

adminKycRouter.get("/kyc-queue", async (req, res) => {
  try {
    const policyConfig = await loadPolicyConfig();
    const auditCtx = buildAuditContext(req);
    const baseCorrelationId = auditCtx.correlationId;
    const nowMs = Date.now();

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        isAdmin: users.isAdmin,
      })
      .from(users);

    const candidates: Array<any> = [];

    for (const user of userRows) {
      if (user.isAdmin) continue;

      const ctx = await buildDecisionContext({
        userId: user.id,
        nowMs,
        request: {
          correlationId: `${baseCorrelationId}:${user.id}`,
          actorType: "ADMIN",
          actorUserId: auditCtx.actorUserId,
          sessionId: auditCtx.sessionId,
          ip: auditCtx.ip,
          userAgent: auditCtx.userAgent,
        },
        policyConfig,
      });

      const eligibility = computeContenderEligibility(ctx, policyConfig);
      if (!eligibility.eligible) continue;

      const promotion = await promotePerformerIfEligible({
        ctx,
        policyConfig,
        correlationId: `${baseCorrelationId}:${user.id}`,
        actorType: "ADMIN",
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent,
      });

      if (promotion.promoted) {
        ctx.user.userTier = "PERFORMER";
      }
      if (promotion.eligible && (ctx.user.contenderTier === "NONE" || ctx.user.contenderTier === "CANDIDATE_EMAIL_ONLY")) {
        ctx.user.contenderTier = "CANDIDATE_SMS_REQUIRED";
      }

      if (ctx.user.userTier === "SELECTED" || ctx.user.selectedAt) {
        continue;
      }

      candidates.push({
        userId: user.id,
        email: user.email,
        username: user.username,
        accountAgeDays: ctx.metrics.accountAgeDays,
        tradesLifetime: ctx.metrics.tradesLifetime,
        tradesLast90d: ctx.metrics.tradesLast90d,
        balancePctOfStart: ctx.metrics.balancePctOfStart,
        returnLast90d: ctx.metrics.returnLast90d,
        contenderPath1: eligibility.path1,
        contenderPath2: eligibility.path2,
        userTier: ctx.user.userTier,
        contenderTier: ctx.user.contenderTier,
        selectedAt: toIso(ctx.user.selectedAt),
      });
    }

    candidates.sort((a, b) => {
      if (b.returnLast90d !== a.returnLast90d) return b.returnLast90d - a.returnLast90d;
      return b.balancePctOfStart - a.balancePctOfStart;
    });

    return res.json({ candidates });
  } catch (error) {
    console.error("Get KYC queue error:", error);
    return res.status(500).json({ message: "Failed to fetch KYC queue" });
  }
});

adminKycRouter.post("/users/:id/kyc-status", async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const adminId = req.session.userId!;
    const { status, notes } = req.body;

    if (!status || !["INVITED", "APPROVED", "REJECTED", "PENDING_DOCS", "UNDER_REVIEW"].includes(status)) {
      return res
        .status(400)
        .json({ message: "Valid status is required (INVITED, APPROVED, REJECTED, PENDING_DOCS, UNDER_REVIEW)" });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const existing = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    const previousStatus = existing?.status ?? "NOT_STARTED";

    if (existing) {
      const updateData: any = {
        status,
        updatedAt: nowSec,
      };

      if (status === "INVITED" && !existing.invitedAt) {
        updateData.invitedAt = nowSec;
        updateData.invitedByAdminId = adminId;
      }

      if (status === "APPROVED" || status === "REJECTED") {
        updateData.reviewedAt = nowSec;
        updateData.reviewedByAdminId = adminId;
        if (notes) updateData.reviewerNote = notes;
        if (status === "REJECTED") updateData.rejectionReason = notes || "Not specified";
      }

      await db.update(userKycProfiles).set(updateData).where(eq(userKycProfiles.userId, userId));
    } else {
      await db.insert(userKycProfiles).values({
        userId,
        status,
        invitedAt: status === "INVITED" ? nowSec : null,
        invitedByAdminId: status === "INVITED" ? adminId : null,
        inviteNote: notes || null,
      });
    }

    if (status === "INVITED") {
      const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
      const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
      await db
        .update(users)
        .set({
          userTier: "SELECTED",
          selectedAt,
          tierPromotedAt,
          tierPromotedBy: adminId,
        })
        .where(eq(users.id, userId));

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });
      if (verification && verification.contenderTier !== "SELECTED_REAL_CAPITAL") {
        await db
          .update(userVerification)
          .set({
            contenderTier: "SELECTED_REAL_CAPITAL",
            updatedAt: nowSec,
          })
          .where(eq(userVerification.userId, userId));
      }

      await ensureDefaultPayoutCurrency(user, userId, nowSec);
    }

    if (status === "APPROVED") {
      const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
      const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
      await db
        .update(users)
        .set({
          userTier: "SELECTED",
          selectedAt,
          tierPromotedAt,
          tierPromotedBy: adminId,
        })
        .where(eq(users.id, userId));

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });

      if (verification) {
        await db
          .update(userVerification)
          .set({
            contenderTier: "SELECTED_REAL_CAPITAL",
            updatedAt: nowSec,
          })
          .where(eq(userVerification.userId, userId));
      }

      await ensureDefaultPayoutCurrency(user, userId, nowSec);
    }

    await storage.logAdminAction({
      adminId,
      userId,
      actionType: `KYC_STATUS_${status}`,
      metadata: { previousStatus, newStatus: status, notes: notes || null },
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "KYC",
      type: `KYC_${status}`,
      title: `KYC status updated to ${status}`,
      description: notes || `Admin updated KYC status from ${previousStatus} to ${status}`,
      actorAdminId: adminId,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    await notifyKycStatusChange({
      userId,
      status,
      note: typeof notes === "string" ? notes : null,
      actorAdminId: adminId,
    });

    return res.json({ success: true, message: `KYC status updated to ${status}` });
  } catch (error) {
    console.error("Update KYC status error:", error);
    return res.status(500).json({ message: "Failed to update KYC status" });
  }
});

adminKycRouter.post("/kyc/invite", async (req, res) => {
  try {
    const { userId, note } = req.body;
    const adminId = req.session.userId!;

    if (!userId || typeof userId !== "number") {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const existing = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    if (existing && ["INVITED", "SUBMITTED", "APPROVED"].includes(existing.status)) {
      return res.status(400).json({ message: `User already has KYC status: ${existing.status}` });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
    const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;

    if ((user as any).userTier !== "SELECTED" || !(user as any).selectedAt) {
      await db
        .update(users)
        .set({
          userTier: "SELECTED",
          selectedAt,
          tierPromotedAt,
          tierPromotedBy: adminId,
        })
        .where(eq(users.id, userId));
    }

    const verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId),
    });
    if (verification && verification.contenderTier !== "SELECTED_REAL_CAPITAL") {
      await db
        .update(userVerification)
        .set({
          contenderTier: "SELECTED_REAL_CAPITAL",
          updatedAt: nowSec,
        })
        .where(eq(userVerification.userId, userId));
    }

    await ensureDefaultPayoutCurrency(user, userId, nowSec);

    if (existing) {
      await db
        .update(userKycProfiles)
        .set({
          status: "INVITED",
          invitedAt: nowSec,
          invitedByAdminId: adminId,
          inviteNote: note || null,
          updatedAt: nowSec,
        })
        .where(eq(userKycProfiles.userId, userId));
    } else {
      await db.insert(userKycProfiles).values({
        userId,
        status: "INVITED",
        invitedAt: nowSec,
        invitedByAdminId: adminId,
        inviteNote: note || null,
      });
    }

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "KYC",
      type: "KYC_INVITED",
      title: "KYC invitation sent",
      description: note || "Admin invited user for KYC verification",
      actorAdminId: adminId,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    await notifyKycStatusChange({
      userId,
      status: "INVITED",
      note: typeof note === "string" ? note : null,
      actorAdminId: adminId,
    });

    return res.json({ success: true, message: "KYC invitation sent" });
  } catch (error) {
    console.error("KYC invite error:", error);
    return res.status(500).json({ message: "Failed to send KYC invitation" });
  }
});

adminKycRouter.post("/kyc/review", async (req, res) => {
  try {
    const { userId, decision, note, rejectionReason } = req.body;
    const adminId = req.session.userId!;

    if (!userId || typeof userId !== "number") {
      return res.status(400).json({ message: "User ID is required" });
    }

    if (!decision || !["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "Decision must be APPROVED or REJECTED" });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const kycProfile = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    if (!kycProfile) {
      return res.status(404).json({ message: "No KYC profile found for user" });
    }

    if (kycProfile.status !== "SUBMITTED") {
      return res.status(400).json({ message: `Cannot review KYC with status: ${kycProfile.status}` });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    await db
      .update(userKycProfiles)
      .set({
        status: decision,
        reviewedAt: nowSec,
        reviewedByAdminId: adminId,
        reviewerNote: note || null,
        rejectionReason: decision === "REJECTED" ? rejectionReason || "Not specified" : null,
        updatedAt: nowSec,
      })
      .where(eq(userKycProfiles.userId, userId));

    if (decision === "APPROVED") {
      const selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
      const tierPromotedAt = toUnixSec((user as any).tierPromotedAt) ?? nowSec;
      await db
        .update(users)
        .set({
          userTier: "SELECTED",
          selectedAt,
          tierPromotedAt,
          tierPromotedBy: adminId,
        })
        .where(eq(users.id, userId));

      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, userId),
      });

      if (verification) {
        await db
          .update(userVerification)
          .set({
            contenderTier: "SELECTED_REAL_CAPITAL",
            updatedAt: nowSec,
          })
          .where(eq(userVerification.userId, userId));
      }

      await ensureDefaultPayoutCurrency(user, userId, nowSec);
    }

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "KYC",
      type: decision === "APPROVED" ? "KYC_APPROVED" : "KYC_REJECTED",
      title: `KYC ${decision.toLowerCase()}`,
      description: rejectionReason || note || `Admin ${decision.toLowerCase()} KYC`,
      actorAdminId: adminId,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    await notifyKycStatusChange({
      userId,
      status: decision,
      note:
        typeof rejectionReason === "string" && rejectionReason
          ? rejectionReason
          : typeof note === "string"
            ? note
            : null,
      actorAdminId: adminId,
    });

    return res.json({
      success: true,
      message: `KYC ${decision.toLowerCase()}`,
      newTier: decision === "APPROVED" ? "SELECTED" : undefined,
    });
  } catch (error) {
    console.error("KYC review error:", error);
    return res.status(500).json({ message: "Failed to process KYC review" });
  }
});

adminKycRouter.post("/users/:id/tier", async (req, res) => {
  try {
    const userId = parseInt(getParam(req.params.id), 10);
    const adminId = req.session.userId!;

    if (!userId || Number.isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const parsed = tierChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: parsed.error.issues,
      });
    }

    const { tier, reason } = parsed.data;

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const oldTier = (user as any).userTier || "CANDIDATE";
    if (oldTier === tier) {
      return res.status(400).json({ message: `User is already in ${tier} tier` });
    }

    const isPromotion =
      ["CANDIDATE", "PERFORMER", "SELECTED"].indexOf(tier) >
      ["CANDIDATE", "PERFORMER", "SELECTED"].indexOf(oldTier);

    const nowSec = Math.floor(Date.now() / 1000);
    const updateUserData: any = { userTier: tier };
    if (tier === "SELECTED") {
      updateUserData.selectedAt = toUnixSec((user as any).selectedAt) ?? nowSec;
      if (isPromotion) {
        updateUserData.tierPromotedAt = nowSec;
        updateUserData.tierPromotedBy = adminId;
      }
    } else if ((user as any).selectedAt) {
      updateUserData.selectedAt = null;
    }

    await db.update(users).set(updateUserData).where(eq(users.id, userId));

    const verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId),
    });

    if (verification) {
      let newContenderTier: string;
      if (tier === "SELECTED") {
        newContenderTier = "SELECTED_REAL_CAPITAL";
      } else if (tier === "PERFORMER") {
        if (verification.smsVerifiedAt) {
          newContenderTier = "VERIFIED_SMS";
        } else if (verification.emailVerifiedAt) {
          newContenderTier = "CANDIDATE_SMS_REQUIRED";
        } else {
          newContenderTier = "NONE";
        }
      } else {
        newContenderTier = "NONE";
      }

      await db
        .update(userVerification)
        .set({
          contenderTier: newContenderTier,
          updatedAt: nowSec,
        })
        .where(eq(userVerification.userId, userId));
    }

    if (tier === "SELECTED") {
      await ensureDefaultPayoutCurrency(user, userId, nowSec);
    }

    appendIdentityAudit({
      userId,
      email: user.email,
      username: user.username,
      category: "TIER",
      type: "TIER_CHANGED",
      title: `Tier ${isPromotion ? "promoted" : "demoted"}: ${oldTier} → ${tier}`,
      description: reason || `Admin ${isPromotion ? "promoted" : "demoted"} user tier`,
      actorAdminId: adminId,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    return res.json({
      success: true,
      message: `User tier changed from ${oldTier} to ${tier}`,
      oldTier,
      newTier: tier,
    });
  } catch (error) {
    console.error("Tier change error:", error);
    return res.status(500).json({ message: "Failed to update tier" });
  }
});

adminKycRouter.get("/user-profiles", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const search = (req.query.q as string) || "";

    const allUsers = await storage.listUsersWithSettings();

    let filtered = allUsers.filter((u: any) => !u.isAdmin);

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((u: any) => u.email?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q));
    }

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);

    const results = await Promise.all(
      paged.map(async (user: any) => {
        const verification = await db.query.userVerification.findFirst({
          where: eq(userVerification.userId, user.id),
        });

        const kyc = await db.query.userKycProfiles.findFirst({
          where: eq(userKycProfiles.userId, user.id),
        });

        const payout = await db.query.userPayoutProfiles.findFirst({
          where: eq(userPayoutProfiles.userId, user.id),
        });

        return {
          userId: user.id,
          email: user.email,
          username: user.username,
          userTier: user.userTier || "CANDIDATE",
          createdAt: user.createdAt,
          emailVerified: !!verification?.emailVerifiedAt,
          emailVerifiedAt: verification?.emailVerifiedAt,
          emailReverifyDueAt: verification?.emailReverifyDueAt,
          phoneVerified: !!verification?.smsVerifiedAt,
          phoneVerifiedAt: verification?.smsVerifiedAt,
          contenderTier: verification?.contenderTier || "NONE",
          kycStatus: kyc?.status || "NOT_STARTED",
          kycInvitedAt: kyc?.invitedAt,
          kycSubmittedAt: kyc?.submittedAt,
          kycReviewedAt: kyc?.reviewedAt,
          preferredPaymentCurrency: payout?.preferredPaymentCurrency,
        };
      }),
    );

    return res.json({
      users: results,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get user profiles error:", error);
    return res.status(500).json({ message: "Failed to fetch user profiles" });
  }
});

adminKycRouter.get("/kyc/pending", async (_req, res) => {
  try {
    const pending = await db.query.userKycProfiles.findMany({
      where: eq(userKycProfiles.status, "SUBMITTED"),
    });

    const results = await Promise.all(
      pending.map(async (kyc) => {
        const user = await storage.getUserById(kyc.userId);
        return {
          userId: kyc.userId,
          email: user?.email,
          username: user?.username,
          submittedAt: kyc.submittedAt,
          documentType: kyc.documentType,
        };
      }),
    );

    return res.json(results);
  } catch (error) {
    console.error("Get pending KYC error:", error);
    return res.status(500).json({ message: "Failed to fetch pending KYC" });
  }
});

adminKycRouter.get("/kyc/queue", async (req, res) => {
  try {
    const { status } = req.query;

    const kycProfiles = await db.query.userKycProfiles.findMany({
      where:
        status && status !== "all_status"
          ? eq(userKycProfiles.status, String(status))
          : inArray(userKycProfiles.status, ["INVITED", "SUBMITTED"]),
    });

    const results = await Promise.all(
      kycProfiles.map(async (kyc) => {
        const user = await storage.getUserById(kyc.userId);
        return {
          userId: kyc.userId,
          email: user?.email || "",
          username: user?.username || "",
          status: kyc.status,
          invitedAt: toUnixSec(kyc.invitedAt),
          submittedAt: toUnixSec(kyc.submittedAt),
          documentType: kyc.documentType,
          invitedByAdminId: kyc.invitedByAdminId,
          inviteNote: kyc.inviteNote,
        };
      }),
    );

    results.sort((a, b) => {
      if (a.status === "SUBMITTED" && b.status !== "SUBMITTED") return -1;
      if (a.status !== "SUBMITTED" && b.status === "SUBMITTED") return 1;
      const aTime = a.submittedAt || a.invitedAt || 0;
      const bTime = b.submittedAt || b.invitedAt || 0;
      return bTime - aTime;
    });

    return res.json(results);
  } catch (error) {
    console.error("Get KYC queue error:", error);
    return res.status(500).json({ message: "Failed to fetch KYC queue" });
  }
});
