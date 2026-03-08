import { Router } from "express";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, dbClient } from "@db";
import {
  challengeBadges,
  challengeBadgeAwards,
  challengeEnrollments,
  challengeEnrollmentEvents,
  challengeCertificateTemplates,
  challengeCertificates,
  challengeLeaderboardSnapshot,
  challengePhaseSnapshots,
  challengePhases,
  challengePrizeAwards,
  challengeProgressionTiers,
  challengeSelectionBoosts,
  challengeUserProgression,
  challenges,
  partnerAllocations,
  partnerInvites,
  partnerInquiries,
  partners,
  recruitingPipeline,
  scoutMetricsSnapshot,
  scoutWatchlists,
  globalSettings,
  systemConfig,
  trades,
  users,
} from "@shared/schema";
import { requireAdmin } from "../../middleware/requireAdmin";
import { randomToken, sha256Hex } from "../../services/crypto";
import {
  PIPELINE_STAGES,
  ensurePipelineRowForUser,
  updateRecruitingPipelineForUser,
} from "../../recruitment/pipelineService";
import { appendChallengeEvent } from "../../recruitment/challengesV4/challengeEvents";
import { getSystemChallengeConfig } from "../../recruitment/challengesV4/challengeConfig";
import { computePhaseStats } from "../../recruitment/challengesV4/challengeEvaluation";
import { listAdminScoutCandidates } from "../../scout/scoutService";
import {
  getPartnerInquiryRoutingConfig,
  resolvePartnerInquiryRouting,
  upsertPartnerInquiryRoutingConfig,
} from "../../partner/inquiryRouting";
import { createMailboxThreadWithMessage, createNotification, getCommunicationSettings } from "../../services/messaging";
import { publishLiveEvent } from "../../services/liveBus";
import {
  DEFAULT_PARTNER_GATING_CONFIG,
  normalizePartnerGatingConfig,
  normalizePartnerGatingOverrides,
} from "../../partner/onboarding";
import {
  LEADERBOARD_MODES,
  PARTNER_INVITE_EMAIL_STATUSES,
  challengeBadgeUpsertSchema,
  challengeCertificateTemplateUpsertSchema,
  challengeEnrollmentActionSchema,
  challengeEnrollmentExtendSchema,
  challengeEnrollmentNotifySchema,
  challengeEnrollmentOverrideSchema,
  challengePhaseUpsertSchema,
  challengePrizeApproveSchema,
  challengeProgressionTierUpsertSchema,
  challengeSettingsPatchSchema,
  challengeUpsertSchema,
  inquiryRoutingPatchSchema,
  partnerApproveSchema,
  partnerCreateSchema,
  partnerGatingOverrideSchema,
  partnerInviteSchema,
  partnerPatchSchema,
  pipelineUpdateSchema,
  scoutConfigPatchSchema,
  watchlistInputSchema,
} from "./validation";
import {
  PARTNER_INVITE_ADMIN_LIMIT,
  PARTNER_INVITE_IP_LIMIT,
  appendRecruitmentAudit,
  applyChallengeEnrollmentAdminAction,
  beginIdempotentMutation,
  buildPartnerApiKey,
  buildPartnerInviteDeepLink,
  buildPartnerTempPassword,
  buildPartnerUsername,
  clampInt,
  commitIdempotentMutation,
  computeMaxDrawdownFromEquitySeries,
  consumeRateLimit,
  decryptChallengeAdminNote,
  driftAbs,
  enforceAdminResourceScope,
  enforceChallengeAdminActionRateLimit,
  getTraderUser,
  netProfitSqlAlias,
  normalizeEmailArray,
  normalizeChallengeMailboxCategory,
  normalizePartnerEmail,
  notifyChallengeTrader,
  nowSec,
  parseBooleanQuery,
  parseJsonObjectSafe,
  parseOffset,
  parseOptionalFloat,
  parseOptionalStage,
  parsePositiveInt,
  partnerInviteRateByAdmin,
  partnerInviteRateByIp,
  publishChallengesUpdated,
  releaseIdempotentMutation,
  safeString,
  sanitizePartnerIpWhitelist,
  sendPartnerInviteEmail,
  toFiniteNumber,
} from "./support";

export const adminPartnersRouter = Router();
adminPartnersRouter.use(requireAdmin);

adminPartnersRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        p.id,
        p.name,
        p.api_key_prefix,
        p.ip_whitelist,
        p.is_active,
        p.contact_email,
        p.contact_username,
        p.invite_status,
        p.onboarding_step,
        p.invite_expires_at,
        p.agreements_signed_at,
        p.contact_access_requested_at,
        p.approved_at,
        p.gating_overrides,
        p.profile_data,
        p.aum_range,
        p.hq_location,
        p.strategy_tags,
        p.kyb_doc_url,
        p.admin_notes,
        p.created_at,
        p.updated_at,
        p.last_key_rotated_at,
        COUNT(DISTINCT a.id)::int AS allocation_count,
        COUNT(DISTINCT i.id)::int AS inquiry_count,
        MAX(pi.invited_at)::int AS latest_invited_at,
        MAX(pi.email_status) FILTER (WHERE pi.invited_at = (
          SELECT MAX(pi2.invited_at) FROM partner_invites pi2 WHERE pi2.partner_id = p.id
        )) AS latest_invite_email_status
      FROM partners p
      LEFT JOIN partner_allocations a ON a.partner_id = p.id
      LEFT JOIN partner_inquiries i ON i.partner_id = p.id
      LEFT JOIN partner_invites pi ON pi.partner_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC, p.id DESC
    `);

    return res.json({ ok: true, rows: (rows as any).rows ?? [] });
  } catch (error) {
    console.error("[admin-scout] partners list error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNERS" });
  }
});

adminPartnersRouter.post("/", async (req, res) => {
  let idempotency: { storeKey: string; fingerprint: string } | null = null;
  try {
    const parsed = partnerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    idempotency = beginIdempotentMutation(req, res, "PARTNER_CREATE");
    if (!idempotency) return;

    const { raw, hash, prefix } = buildPartnerApiKey();
    const ts = nowSec();

    const [created] = await db
      .insert(partners)
      .values({
        name: parsed.data.name,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        ipWhitelist: sanitizePartnerIpWhitelist(parsed.data.ipWhitelist),
        isActive: parsed.data.isActive ?? true,
        inviteStatus: "ACTIVE",
        onboardingStep: "COMPLETED",
        profileData: "{}",
        strategyTags: "[]",
        gatingOverrides: "{}",
        createdAt: ts,
        updatedAt: ts,
        lastKeyRotatedAt: ts,
      })
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        ipWhitelist: partners.ipWhitelist,
        isActive: partners.isActive,
        createdAt: partners.createdAt,
        updatedAt: partners.updatedAt,
        lastKeyRotatedAt: partners.lastKeyRotatedAt,
      });

    await appendRecruitmentAudit(req, "PARTNER_CREATE", { partnerId: created.id, name: created.name });

    const payload = {
      ok: true,
      row: created,
      apiKey: raw,
      warning: "Store this key now. It will not be shown again.",
    };
    commitIdempotentMutation(idempotency, 201, payload);
    return res.status(201).json(payload);
  } catch (error: any) {
    releaseIdempotentMutation(idempotency);
    console.error("[admin-scout] partner create error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_CREATE_PARTNER" });
  }
});

adminPartnersRouter.post("/invite", async (req, res) => {
  let idempotency: { storeKey: string; fingerprint: string } | null = null;
  try {
    const parsed = partnerInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    idempotency = beginIdempotentMutation(req, res, "PARTNER_INVITE_CREATE");
    if (!idempotency) return;

    const adminId = Number(req.session?.userId || 0);
    const adminEmail = String(req.session?.email || "admin");
    const ipKey = String(req.ip || "unknown");
    const adminRate = consumeRateLimit(partnerInviteRateByAdmin, adminId, PARTNER_INVITE_ADMIN_LIMIT);
    if (!adminRate.allowed) {
      res.setHeader("Retry-After", String(adminRate.retryAfterSec));
      return res.status(429).json({ message: "PARTNER_INVITE_ADMIN_RATE_LIMIT", retryAfterSec: adminRate.retryAfterSec });
    }
    const ipRate = consumeRateLimit(partnerInviteRateByIp, ipKey, PARTNER_INVITE_IP_LIMIT);
    if (!ipRate.allowed) {
      res.setHeader("Retry-After", String(ipRate.retryAfterSec));
      return res.status(429).json({ message: "PARTNER_INVITE_IP_RATE_LIMIT", retryAfterSec: ipRate.retryAfterSec });
    }

    const contactEmail = normalizePartnerEmail(parsed.data.email);
    if (!contactEmail) {
      return res.status(400).json({ message: "INVALID_EMAIL" });
    }
    const fundNameInput = String(parsed.data.fundName || "").trim();
    const adminNotes = String(parsed.data.adminNotes || "").trim() || null;

    const [cfg] = await db
      .select({
        partnerInviteDefaultExpiryDays: systemConfig.partnerInviteDefaultExpiryDays,
      })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);

    const defaultExpiry = Math.max(1, Math.min(180, Number(cfg?.partnerInviteDefaultExpiryDays ?? 7)));
    const expiresInDays = Math.max(1, Math.min(180, Number(parsed.data.expiresInDays ?? defaultExpiry)));
    const ts = nowSec();
    const inviteExpiresAt = ts + expiresInDays * 86400;

    const existingEmailRows = (
      await db.execute(sql`
        SELECT id
        FROM partners
        WHERE lower(contact_email) = ${contactEmail}
        LIMIT 1
      `)
    ).rows as Array<{ id: number }>;
    if (existingEmailRows.length > 0) {
      return res.status(409).json({ message: "PARTNER_EMAIL_ALREADY_EXISTS" });
    }

    const username = buildPartnerUsername(contactEmail);
    const tempPassword = buildPartnerTempPassword();
    const tempPasswordHash = await bcrypt.hash(tempPassword, 10);
    const inviteToken = randomToken(24);
    const inviteTokenHash = sha256Hex(inviteToken);
    const apiKey = buildPartnerApiKey();
    const partnerName =
      fundNameInput || contactEmail.split("@")[0]?.replace(/[^a-zA-Z0-9\s._-]/g, "").trim() || `Partner-${ts}`;
    const inviteStatus = parsed.data.autoActivate ? "ACTIVE" : "INVITED";
    const profileData = JSON.stringify({
      fundName: fundNameInput || null,
      aumRange: null,
      hqLocation: null,
      strategyTags: [],
    });

    const [created] = await db
      .insert(partners)
      .values({
        name: partnerName.slice(0, 120),
        apiKeyHash: apiKey.hash,
        apiKeyPrefix: apiKey.prefix,
        ipWhitelist: "",
        isActive: true,
        contactEmail,
        contactUsername: username,
        tempPasswordHash,
        inviteTokenHash,
        inviteExpiresAt,
        loginCount: 0,
        inviteStatus,
        onboardingStep: "PROFILE",
        profileData,
        strategyTags: "[]",
        gatingOverrides: "{}",
        adminNotes,
        createdAt: ts,
        updatedAt: ts,
        lastKeyRotatedAt: ts,
      })
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        contactEmail: partners.contactEmail,
        contactUsername: partners.contactUsername,
        inviteStatus: partners.inviteStatus,
        onboardingStep: partners.onboardingStep,
        inviteExpiresAt: partners.inviteExpiresAt,
      });

    const [inviteAudit] = await db
      .insert(partnerInvites)
      .values({
        adminId: adminId || null,
        partnerId: Number(created.id),
        partnerEmail: contactEmail,
        fundName: fundNameInput || null,
        adminNotes,
        expiresInDays,
        invitedAt: ts,
        emailStatus: "QUEUED",
        inviteTokenHash,
      })
      .returning({
        id: partnerInvites.id,
      });

    const deepLink = buildPartnerInviteDeepLink({ username, token: inviteToken });
    let emailSend: { status: (typeof PARTNER_INVITE_EMAIL_STATUSES)[number]; messageId?: string; detail?: string };
    try {
      emailSend = await sendPartnerInviteEmail({
        to: contactEmail,
        username,
        tempPassword,
        apiKey: apiKey.raw,
        deepLink,
        expiresInDays,
      });
    } catch (error: any) {
      emailSend = {
        status: "FAILED",
        detail: String(error?.message || "INVITE_EMAIL_SEND_FAILED"),
      };
    }

    await db
      .update(partnerInvites)
      .set({
        emailStatus: emailSend.status,
        emailProviderMessageId: emailSend.messageId || null,
        emailStatusDetail: emailSend.detail || null,
      })
      .where(eq(partnerInvites.id, Number(inviteAudit.id)));

    await appendRecruitmentAudit(req, "PARTNER_INVITE_CREATE", {
      partnerId: Number(created.id),
      partnerEmail: contactEmail,
      inviteStatus,
      expiresInDays,
      emailStatus: emailSend.status,
    });

    const payload = {
      ok: true,
      row: created,
      invite: {
        expiresInDays,
        inviteExpiresAt,
        emailStatus: emailSend.status,
        emailDetail: emailSend.detail || null,
      },
      credentials: {
        username,
        tempPassword,
        apiKey: apiKey.raw,
        inviteToken,
        deepLink,
      },
      warning: "Store these credentials now. API key and temporary password are shown once.",
    };
    commitIdempotentMutation(idempotency, 201, payload);
    return res.status(201).json(payload);
  } catch (error: any) {
    releaseIdempotentMutation(idempotency);
    console.error("[admin-scout] partner invite error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_INVITE_PARTNER" });
  }
});

adminPartnersRouter.get("/:id/onboarding", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "partner", id)) return;

    const [partnerRow] = await db
      .select({
        id: partners.id,
        name: partners.name,
        contactEmail: partners.contactEmail,
        contactUsername: partners.contactUsername,
        inviteStatus: partners.inviteStatus,
        onboardingStep: partners.onboardingStep,
        inviteExpiresAt: partners.inviteExpiresAt,
        profileData: partners.profileData,
        fundLogoUrl: partners.fundLogoUrl,
        aumRange: partners.aumRange,
        hqLocation: partners.hqLocation,
        strategyTags: partners.strategyTags,
        kybDocUrl: partners.kybDocUrl,
        agreementsSignedAt: partners.agreementsSignedAt,
        contactAccessRequestedAt: partners.contactAccessRequestedAt,
        approvedAt: partners.approvedAt,
        gatingOverrides: partners.gatingOverrides,
        adminNotes: partners.adminNotes,
        updatedAt: partners.updatedAt,
      })
      .from(partners)
      .where(eq(partners.id, id))
      .limit(1);

    if (!partnerRow) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const inviteRows = await db
      .select({
        id: partnerInvites.id,
        adminId: partnerInvites.adminId,
        partnerEmail: partnerInvites.partnerEmail,
        fundName: partnerInvites.fundName,
        adminNotes: partnerInvites.adminNotes,
        expiresInDays: partnerInvites.expiresInDays,
        invitedAt: partnerInvites.invitedAt,
        emailStatus: partnerInvites.emailStatus,
        emailStatusDetail: partnerInvites.emailStatusDetail,
      })
      .from(partnerInvites)
      .where(eq(partnerInvites.partnerId, id))
      .orderBy(desc(partnerInvites.invitedAt), desc(partnerInvites.id))
      .limit(20);

    return res.json({
      ok: true,
      row: {
        ...partnerRow,
        gateOverrides: normalizePartnerGatingOverrides(partnerRow.gatingOverrides),
      },
      invites: inviteRows,
    });
  } catch (error) {
    console.error("[admin-scout] partner onboarding get error:", error);
    return res.status(500).json({ message: "FAILED_TO_FETCH_PARTNER_ONBOARDING" });
  }
});

adminPartnersRouter.put("/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "partner", id)) return;

    const parsed = partnerApproveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const ts = nowSec();
    const nextNotes = String(parsed.data.adminNotes || "").trim();
    const setPatch: any = {
      adminNotes: nextNotes || existing.adminNotes || null,
      updatedAt: ts,
    };

    if (parsed.data.action === "APPROVE") {
      setPatch.inviteStatus = "ACTIVE";
      setPatch.isActive = true;
      setPatch.onboardingStep = "COMPLETED";
      setPatch.approvedAt = ts;
    } else if (parsed.data.action === "HOLD") {
      setPatch.inviteStatus = "ACTIVE";
      setPatch.onboardingStep = "WAITING_APPROVAL";
      setPatch.isActive = true;
    } else if (parsed.data.action === "REVOKE") {
      setPatch.inviteStatus = "REVOKED";
      setPatch.isActive = false;
    }

    const [updated] = await db
      .update(partners)
      .set(setPatch)
      .where(eq(partners.id, id))
      .returning();

    await appendRecruitmentAudit(req, "PARTNER_APPROVAL_ACTION", {
      partnerId: id,
      action: parsed.data.action,
      inviteStatus: updated?.inviteStatus ?? null,
      onboardingStep: updated?.onboardingStep ?? null,
    });

    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] partner approval update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER_APPROVAL" });
  }
});

adminPartnersRouter.put("/:id/gating-overrides", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "partner", id)) return;

    const parsed = partnerGatingOverrideSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    const normalized = normalizePartnerGatingOverrides(parsed.data);
    const [updated] = await db
      .update(partners)
      .set({
        gatingOverrides: JSON.stringify(normalized),
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        gatingOverrides: partners.gatingOverrides,
        updatedAt: partners.updatedAt,
      });

    await appendRecruitmentAudit(req, "PARTNER_GATING_OVERRIDE_UPDATE", {
      partnerId: id,
      overrides: normalized,
    });

    return res.json({
      ok: true,
      row: {
        id: updated.id,
        gatingOverrides: normalizePartnerGatingOverrides(updated.gatingOverrides),
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    console.error("[admin-scout] partner gating overrides update error:", error);
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER_GATING_OVERRIDES" });
  }
});

adminPartnersRouter.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "partner", id)) return;

    const parsed = partnerPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "INVALID_PAYLOAD", errors: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ message: "EMPTY_UPDATE" });
    }

    const [existing] = await db.select().from(partners).where(eq(partners.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    let rotatedApiKey: string | null = null;
    let apiKeyHash: string | undefined;
    let apiKeyPrefix: string | undefined;
    let lastKeyRotatedAt: number | undefined;

    if (parsed.data.rotateKey) {
      const generated = buildPartnerApiKey();
      rotatedApiKey = generated.raw;
      apiKeyHash = generated.hash;
      apiKeyPrefix = generated.prefix;
      lastKeyRotatedAt = nowSec();
    }

    const [updated] = await db
      .update(partners)
      .set({
        name: parsed.data.name,
        ipWhitelist: parsed.data.ipWhitelist === undefined ? undefined : sanitizePartnerIpWhitelist(parsed.data.ipWhitelist),
        isActive: parsed.data.isActive,
        apiKeyHash,
        apiKeyPrefix,
        lastKeyRotatedAt,
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        name: partners.name,
        apiKeyPrefix: partners.apiKeyPrefix,
        ipWhitelist: partners.ipWhitelist,
        isActive: partners.isActive,
        createdAt: partners.createdAt,
        updatedAt: partners.updatedAt,
        lastKeyRotatedAt: partners.lastKeyRotatedAt,
      });

    await appendRecruitmentAudit(req, parsed.data.rotateKey ? "PARTNER_KEY_ROTATE" : "PARTNER_UPDATE", {
      partnerId: id,
      rotateKey: Boolean(parsed.data.rotateKey),
      patchKeys: Object.keys(parsed.data),
    });

    return res.json({
      ok: true,
      row: updated,
      apiKey: rotatedApiKey,
      warning: rotatedApiKey ? "Store the rotated key now. It will not be shown again." : undefined,
    });
  } catch (error: any) {
    console.error("[admin-scout] partner update error:", error);
    if (String(error?.message || "").includes("partners_api_key_hash_uidx")) {
      return res.status(409).json({ message: "PARTNER_KEY_CONFLICT_RETRY" });
    }
    return res.status(500).json({ message: "FAILED_TO_UPDATE_PARTNER" });
  }
});

adminPartnersRouter.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "INVALID_PARTNER_ID" });
    }
    if (!enforceAdminResourceScope(req, res, "partner", id)) return;

    const [updated] = await db
      .update(partners)
      .set({
        isActive: false,
        updatedAt: nowSec(),
      })
      .where(eq(partners.id, id))
      .returning({
        id: partners.id,
        name: partners.name,
        isActive: partners.isActive,
        updatedAt: partners.updatedAt,
      });

    if (!updated) {
      return res.status(404).json({ message: "PARTNER_NOT_FOUND" });
    }

    await appendRecruitmentAudit(req, "PARTNER_DEACTIVATE", { partnerId: id });
    return res.json({ ok: true, row: updated });
  } catch (error) {
    console.error("[admin-scout] partner delete error:", error);
    return res.status(500).json({ message: "FAILED_TO_DEACTIVATE_PARTNER" });
  }
});
