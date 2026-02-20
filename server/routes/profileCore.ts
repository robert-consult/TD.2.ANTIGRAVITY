// @ts-nocheck
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { eq } from "drizzle-orm";
import { db } from "@db";
import {
  emailVerificationTokens,
  systemConfig,
  userKycProfiles,
  userPayoutProfiles,
  userVerification,
  users,
} from "@shared/schema";
import { storage } from "../storage";
import { hashEmailVerificationToken } from "../security/emailVerificationToken";
import { appendIdentityAudit } from "../services/identityAudit";
import { getSignupPublicConfig } from "../services/signupPublicConfig";
import {
  buildGeoContext,
  createUserSession,
  extractClientIdentity,
  extractGeoHints,
  getActiveSessions,
  getClientIp,
  getRecentLoginActivity,
  getUserAgent,
  recordLoginAttempt,
  revokeAllSessionsForUser,
  revokeSession,
} from "../security/sessionTrail";
import {
  clearRememberMeCookie,
  revokeAllRememberMeTokensForUser,
} from "../services/rememberMe";
import { normalizeLanguagePreference } from "../lib/priceUtils";
import { requirePolicy } from "../middleware/requirePolicy";
import { buildAuditContext } from "../lib/auditContext";
import { buildDecisionContext } from "../policy/buildDecisionContext";
import { loadPolicyConfig } from "../policy/getPolicyConfig";
import { decidePolicy, featureGates } from "@shared/policyDecision";
import { promotePerformerIfEligible } from "../policy/performerPromotion";
import { defaultPaymentCurrencyForCountry } from "../utils/paymentCurrency";

interface ProfileCoreDeps {
  ensureAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  sessionCookieName: string;
}

export function registerProfileCoreRoutes(app: Express, deps: ProfileCoreDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;

// Profile update endpoint - with proper auth and validation
app.post("/api/profile/update", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const ip = (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined;
    const userAgent = req.headers["user-agent"] ?? undefined;

    // Validate with Zod - only allow whitelisted fields
    const profileUpdateSchema = z.object({
      email: z.string().email("Please enter a valid email").optional(),
      username: z.string().min(3, "Username must be at least 3 characters").max(50).optional(),
      name: z.string().max(100).optional(),
      phone: z.string().max(20).optional(),
      countryIso2: z.string().length(2, "Country code must be 2 letters").optional(),
    });

    const validationResult = profileUpdateSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: validationResult.error.errors[0]?.message || "Invalid input"
      });
    }

    const { email, username, name, phone, countryIso2 } = validationResult.data;
    const normalizedCountryIso2 = countryIso2?.toUpperCase();

    // Get existing user data to compare
    const existingUser = await storage.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if username is already taken by another user
    if (username) {
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername && existingUsername.id !== userId) {
        return res.status(400).json({ message: "Username is already taken" });
      }
    }

    // Check if email is already taken by another user
    if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail && existingEmail.id !== userId) {
        return res.status(400).json({ message: "Email is already taken" });
      }
    }

    const phoneRequired = (await getSignupPublicConfig()).signupPhoneEnforce;

    if (phone === undefined && phoneRequired && !existingUser.phone) {
      return res.status(400).json({ message: "PHONE_REQUIRED" });
    }

    let normalizedPhone: string | null = null;
    if (phone !== undefined) {
      if (!phone) {
        return res.status(400).json({ message: "PHONE_REQUIRED" });
      }
      const phoneCountry = normalizedCountryIso2 ?? existingUser.countryIso2;
      const parsed = phoneCountry
        ? parsePhoneNumberFromString(phone, phoneCountry as any)
        : parsePhoneNumberFromString(phone);
      if (!parsed || !parsed.isValid()) {
        return res.status(400).json({ message: "PHONE_INVALID" });
      }
      normalizedPhone = parsed.format("E.164");
    }

    // Only update provided and valid fields - never allow isAdmin or other protected fields
    const updateData: Record<string, string> = {};
    if (email !== undefined) updateData.email = email;
    if (username !== undefined) updateData.username = username;
    if (name !== undefined) updateData.name = name;
    if (normalizedPhone !== null) updateData.phone = normalizedPhone;
    if (normalizedCountryIso2 !== undefined) {
      updateData.countryIso2 = normalizedCountryIso2;
      updateData.country = normalizedCountryIso2;
    }

    await storage.updateUser(userId, updateData);

    if (normalizedPhone !== null && normalizedPhone !== existingUser.phone) {
      try {
        await db.insert(userVerification).values({
          userId,
          phoneE164: normalizedPhone,
          smsVerifiedAt: null,
          smsVerifyFailCount: 0,
          smsEnabled: false,
          smsSendCountDay: 0,
          smsSendDayKey: null,
          smsLastSentAt: null,
          smsLastSendAt: null,
          smsSendDayStart: null,
          smsOtpLockedUntil: null,
        }).onConflictDoUpdate({
          target: userVerification.userId,
          set: {
            phoneE164: normalizedPhone,
            smsVerifiedAt: null,
            smsVerifyFailCount: 0,
            smsEnabled: false,
            smsSendCountDay: 0,
            smsSendDayKey: null,
            smsLastSentAt: null,
            smsLastSendAt: null,
            smsSendDayStart: null,
            smsOtpLockedUntil: null,
          },
        });
      } catch (phoneUpdateError) {
        console.error("Failed to update phone verification state:", phoneUpdateError);
        return res.status(500).json({ message: "PHONE_STATE_UPDATE_FAILED" });
      }

      appendIdentityAudit({
        userId,
        email: existingUser.email,
        category: "VERIFICATION",
        type: "PHONE_UPDATED",
        title: "Phone updated from profile",
        description: `Updated phone to ${normalizedPhone}`,
        ip,
        userAgent,
      });
    }

    // P0: Email change must reset verification state
    if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
      // 1. Reset verification state in user_verification table
      await db.update(userVerification)
        .set({
          emailVerifiedAt: null,
          emailReverifyDueAt: null,
        })
        .where(eq(userVerification.userId, userId));

      // 2. Generate new verification token
      const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
      const token = crypto.randomBytes(32).toString("hex");

      const tokenHash = hashEmailVerificationToken(token);

      const tokenId = crypto.randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

      // 3. Store token hash in email_verification_tokens table
      await db.insert(emailVerificationTokens).values({
        id: tokenId,
        userId: userId,
        tokenHash,
        purpose: "VERIFY",
        expiresAt,
      });

      // 4. Send verification email to new address
      const resendApiKey = process.env.RESEND_API_KEY;
      let emailSent = false;

      if (resendApiKey) {
        const verifyUrl = `${process.env.APP_URL || "http://localhost:5000"}/api/verification/email/verify?token=${token}`;

        try {
          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM || "TradeQuip <noreply@tradequip.com>",
              to: [email],
              subject: "Verify your new TradeQuip email address",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1a1a2e;">Email Address Changed</h2>
                  <p>Your TradeQuip account email has been changed. Please verify your new email address:</p>
                  <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Verify New Email
                  </a>
                  <p style="color: #666; font-size: 14px;">This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours.</p>
                  <p style="color: #666; font-size: 12px;">If you didn't make this change, please contact support immediately.</p>
                </div>
              `,
            }),
          });

          const emailData = await emailResponse.json();
          if (emailResponse.ok) {
            emailSent = true;
            console.log("Email change verification email sent:", { id: emailData.id, to: email });
          } else {
            console.error("Resend API error during email change:", emailData);
          }
        } catch (emailError) {
          console.error("Error sending email change verification email:", emailError);
        }
      } else {
        console.warn("RESEND_API_KEY not configured, skipping verification email");
      }

      // 5. Emit identity_audit event for EMAIL_CHANGED
      appendIdentityAudit({
        userId: userId,
        email: email,
        category: "VERIFICATION",
        type: "EMAIL_CHANGED",
        title: "Email address changed",
        description: `Old: ${existingUser.email}, New: ${email}`,
        ip,
        userAgent,
      });

      // Also log the verification email send status
      appendIdentityAudit({
        userId: userId,
        email: email,
        category: "VERIFICATION",
        type: emailSent ? "EMAIL_VERIFICATION_SENT" : "EMAIL_SEND_FAILED",
        title: emailSent ? "Email change verification sent" : "Email change verification send failed",
        description: emailSent ? `Verification email sent to ${email}` : "RESEND_API_KEY missing or API error",
        ip,
        userAgent,
      });

      // Update session email
      req.session.email = email;
    }

    res.json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// Change password endpoint - with proper auth and validation
app.post("/api/profile/change-password", ensureAuth, async (req: Request, res: Response) => {
  try {
    const passwordChangeSchema = z.object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: z.string().min(8, "New password must be at least 8 characters").max(25, "New password must be at most 25 characters"),
    });

    const validationResult = passwordChangeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: validationResult.error.errors[0]?.message || "Invalid input"
      });
    }

    const { currentPassword, newPassword } = validationResult.data;

    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Verify current password using passwordHash field (same as login)
    const bcrypt = await import("bcryptjs");
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Hash new password and update using passwordHash field
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await storage.updateUser(req.session.userId!, { passwordHash: hashedPassword });
    await revokeAllRememberMeTokensForUser(req.session.userId!);
    await revokeAllSessionsForUser({
      actorUserId: req.session.userId!,
      targetUserId: req.session.userId!,
      reason: "PASSWORD_CHANGED",
    });

    await recordLoginAttempt({
      userId: req.session.userId!,
      email: user.email,
      ip: getClientIp(req),
      userAgent: getUserAgent(req),
      success: true,
      sessionId: req.sessionID,
      identity: extractClientIdentity(req),
      geo: buildGeoContext(getClientIp(req), extractGeoHints(req)),
      eventType: "ALL_TOKENS_INVALIDATED",
    });

    clearRememberMeCookie(res);
    res.clearCookie(SESSION_COOKIE_NAME);
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));

    res.json({ message: "Password changed successfully. Please log in again.", reauthRequired: true });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
});

app.post("/api/profile/account/deactivate", ensureAuth, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      reasonCode: z.string().min(1).max(64),
      reasonText: z.string().max(500).optional().nullable(),
      password: z.string().min(1),
      confirm: z.string().min(1),
    });

    const { reasonCode, reasonText, password, confirm } = schema.parse(req.body);

    if (confirm.trim().toUpperCase() !== "DEACTIVATE") {
      return res.status(400).json({ message: "Type DEACTIVATE to confirm." });
    }

    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      req.session.destroy(() => { });
      return res.status(401).json({ message: "User not found" });
    }

    if ((user as any).isDeleted) {
      return res.status(400).json({ message: "Account is already deleted" });
    }

    if (user.isDisabled) {
      return res.status(400).json({ message: "Account is already deactivated" });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ message: "Password is incorrect" });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const normalizedReasonCode = reasonCode.trim() ? reasonCode.trim().toUpperCase() : "OTHER";
    const normalizedReasonText = reasonText && reasonText.trim()
      ? reasonText.trim().slice(0, 500)
      : null;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    await db.update(users)
      .set({ isDisabled: true, inactivatedAt: nowSec })
      .where(eq(users.id, user.id));

    try {
      await storage.upsertSettings({ userId: user.id, showOnLeaderboard: false } as any);
    } catch (e) {
      console.warn("Failed to update leaderboard visibility:", e);
    }

    await storage.recordAccountEvent({
      userId: user.id,
      eventType: "ACCOUNT_SELF_DEACTIVATED",
      title: "Account deactivated",
      description: "User requested account deactivation",
      reasonCode: normalizedReasonCode,
      reasonText: normalizedReasonText,
      metadata: {
        action: "DEACTIVATE",
        ip,
        userAgent,
        sessionId: req.sessionID,
      },
      provenance: {
        actorType: "USER",
        actorUserId: user.id,
        sessionId: req.sessionID,
        ip,
        userAgent,
      },
    });

    try {
      await revokeAllSessionsForUser({
        actorUserId: user.id,
        targetUserId: user.id,
        reason: "Account deactivated",
      });
    } catch (e) {
      console.error("Failed to revoke sessions after deactivation:", e);
    }

    try {
      await revokeAllRememberMeTokensForUser(user.id);
    } catch (e) {
      console.error("Failed to revoke remember-me tokens after deactivation:", e);
    }

    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    clearRememberMeCookie(res);
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true, message: "Account deactivated" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input data", errors: error.errors });
    }
    console.error("Account deactivation error:", error);
    res.status(500).json({ message: "Failed to deactivate account" });
  }
});

app.post("/api/profile/account/delete", ensureAuth, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      reasonCode: z.string().min(1).max(64),
      reasonText: z.string().max(500).optional().nullable(),
      password: z.string().min(1),
      confirm: z.string().min(1),
    });

    const { reasonCode, reasonText, password, confirm } = schema.parse(req.body);

    if (confirm.trim().toUpperCase() !== "DELETE") {
      return res.status(400).json({ message: "Type DELETE to confirm." });
    }

    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      req.session.destroy(() => { });
      return res.status(401).json({ message: "User not found" });
    }

    if ((user as any).isDeleted) {
      return res.status(400).json({ message: "Account is already deleted" });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ message: "Password is incorrect" });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const normalizedReasonCode = reasonCode.trim() ? reasonCode.trim().toUpperCase() : "OTHER";
    const normalizedReasonText = reasonText && reasonText.trim()
      ? reasonText.trim().slice(0, 500)
      : null;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    await db.update(users)
      .set({
        isDisabled: true,
        inactivatedAt: nowSec,
        isDeleted: true,
        deletedAt: nowSec,
        deletedMode: "USER",
        deletedReason: normalizedReasonCode,
        deletedByAdminId: null,
      })
      .where(eq(users.id, user.id));

    try {
      await storage.upsertSettings({ userId: user.id, showOnLeaderboard: false } as any);
    } catch (e) {
      console.warn("Failed to update leaderboard visibility:", e);
    }

    await storage.recordAccountEvent({
      userId: user.id,
      eventType: "ACCOUNT_SELF_DELETED",
      title: "Account deleted",
      description: "User requested account deletion",
      reasonCode: normalizedReasonCode,
      reasonText: normalizedReasonText,
      metadata: {
        action: "DELETE",
        ip,
        userAgent,
        sessionId: req.sessionID,
      },
      provenance: {
        actorType: "USER",
        actorUserId: user.id,
        sessionId: req.sessionID,
        ip,
        userAgent,
      },
    });

    try {
      await revokeAllSessionsForUser({
        actorUserId: user.id,
        targetUserId: user.id,
        reason: "Account deleted",
      });
    } catch (e) {
      console.error("Failed to revoke sessions after deletion:", e);
    }

    try {
      await revokeAllRememberMeTokensForUser(user.id);
    } catch (e) {
      console.error("Failed to revoke remember-me tokens after deletion:", e);
    }

    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    clearRememberMeCookie(res);
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input data", errors: error.errors });
    }
    console.error("Account deletion error:", error);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

// Consolidated profile endpoint - /api/profile/me
app.get("/api/profile/me", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const user = await storage.getUserById(userId);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId),
    });

    const kyc = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    const payout = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, userId),
    });

    const settings = await storage.getUserSettingsById(userId);
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const decisionCtx = await buildDecisionContext({
      userId,
      nowMs: Date.now(),
      request: {
        correlationId: auditCtx.correlationId,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent,
      },
      policyConfig,
    });
    const gates = featureGates(decisionCtx, policyConfig);

    const consolidatedProfile = {
      id: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone,
      countryIso2: user.countryIso2,
      userTier: (user as any).userTier || "CANDIDATE",
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,

      verification: {
        emailVerified: !!verification?.emailVerifiedAt,
        emailVerifiedAt: verification?.emailVerifiedAt,
        emailReverifyDueAt: verification?.emailReverifyDueAt,
        gracePeriodEndsAt: verification?.emailInitialDueAt ?? null,
        phoneVerified: !!verification?.smsVerifiedAt,
        phoneVerifiedAt: verification?.smsVerifiedAt,
        contenderTier: verification?.contenderTier || "NONE",
      },

      kyc: {
        status: kyc?.status || "NOT_STARTED",
        invitedAt: kyc?.invitedAt,
        submittedAt: kyc?.submittedAt,
        reviewedAt: kyc?.reviewedAt,
      },

      payout: {
        preferredPaymentCurrency: payout?.preferredPaymentCurrency,
      },

      settings: {
        defaultSymbol: settings?.defaultSymbol,
        defaultLotSize: settings?.defaultLotSize,
        defaultLeverage: settings?.defaultLeverage,
        defaultStopLoss: settings?.defaultStopLoss,
        defaultTakeProfit: settings?.defaultTakeProfit,
      },

      featureGates: {
        accountState: gates.accountState,
        contenderEligible: gates.contenderEligible,
        canTradeOpenOrIncrease: gates.canTradeOpenOrIncrease,
        canTradeCloseOrReduce: gates.canTradeCloseOrReduce,
        canStartSms: gates.canStartSms,
        canViewKyc: gates.canViewKyc,
        canSetPreferredPaymentCurrency: gates.canSetPreferredPaymentCurrency,
        canRequestPayout: gates.canRequestPayout,
      },
    };

    res.json(consolidatedProfile);
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// Policy snapshot endpoint - deterministic UI source of truth
app.get("/api/policy/snapshot", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const ctx = await buildDecisionContext({
      userId,
      nowMs: Date.now(),
      request: {
        correlationId: auditCtx.correlationId,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent,
      },
      policyConfig,
    });

    const promotion = await promotePerformerIfEligible({
      ctx,
      policyConfig,
      correlationId: auditCtx.correlationId,
      actorType: auditCtx.actorType,
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

    const baseDecision = decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig);
    const derived = baseDecision.derived ?? null;

    res.json({
      derived,
      user: {
        userTier: ctx.user.userTier,
        contenderTier: ctx.user.contenderTier,
        emailVerifiedAt: ctx.user.emailVerifiedAt?.toISOString() ?? null,
        emailReverifyDueAt: ctx.user.emailReverifyDueAt?.toISOString() ?? null,
        emailInitialDueAt: ctx.user.emailInitialDueAt?.toISOString() ?? null,
        phoneVerifiedAt: ctx.user.phoneVerifiedAt?.toISOString() ?? null,
        selectedAt: ctx.user.selectedAt?.toISOString() ?? null,
      },
      features: {
        canSendEmailVerification: decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig).allowed,
        canStartSms: decidePolicy("PHONE_VERIFY_START", ctx, policyConfig).allowed,
        canConfirmSms: decidePolicy("PHONE_VERIFY_CONFIRM", ctx, policyConfig).allowed,
        canViewKyc: decidePolicy("KYC_VIEW", ctx, policyConfig).allowed,
        canSubmitKyc: decidePolicy("KYC_SUBMIT", ctx, policyConfig).allowed,
        canSetPreferredPaymentCurrency: decidePolicy("PREFERRED_PAYMENT_CURRENCY_SET", ctx, policyConfig).allowed,
        canRequestPayout: decidePolicy("PAYOUT_REQUEST", ctx, policyConfig).allowed,
        canTradeOpenOrIncrease: decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig).allowed,
        canTradeCloseOrReduce: decidePolicy("TRADE_CLOSE_OR_REDUCE", ctx, policyConfig).allowed,
        canTradeCancelPending: decidePolicy("TRADE_CANCEL_PENDING", ctx, policyConfig).allowed,
        canTradeModifySltp: decidePolicy("TRADE_MODIFY_SLTP", ctx, policyConfig).allowed,
      },
      contenderCriteria: {
        path1: {
          minAgeDays: policyConfig.contenderMinAgeDays,
          minBalanceMultiplier: policyConfig.contenderMinBalancePct,
          minTradesLifetime: policyConfig.contenderMinTradesLifetime,
        },
        path2: {
          minAgeDays: policyConfig.contenderPath2MinAgeDays,
          minReturnPct: policyConfig.contenderPath2MinReturnLast90,
          minTradesWindow: policyConfig.contenderPath2MinTradesLast90,
          maxDaysSinceLastTrade: policyConfig.contenderPath2MaxDaysSinceLastTrade,
        },
      },
      correlationId: auditCtx.correlationId,
    });
  } catch (error) {
    console.error("Policy snapshot error:", error);
    res.status(500).json({ message: "Failed to fetch policy snapshot" });
  }
});

// Get user's own login history with geo-enrichment
app.get("/api/profile/login-history", ensureAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const logins = await getRecentLoginActivity({ userId: req.session.userId!, limit });
    res.json(logins);
  } catch (error) {
    console.error("Get login history error:", error);
    res.status(500).json({ message: "Failed to fetch login history" });
  }
});

// Get user's active sessions with geo-enrichment
app.get("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));
    const currentSessionId = req.sessionID;
    const userId = req.session.userId!;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);
    const geoContext = buildGeoContext(ip, extractGeoHints(req));

    let sessions = await getActiveSessions({ userId, limit });

    const currentExists = sessions.some(s => s.sessionId === currentSessionId);
    if (!currentExists) {
      const user = await storage.getUserById(userId);
      await createUserSession({
        sessionId: currentSessionId,
        userId,
        email: user?.email || "",
        ip,
        userAgent,
        geo: geoContext,
      });
      sessions = await getActiveSessions({ userId, limit });
    }

    const formattedSessions = sessions.map((s) => ({
      ...s,
      isCurrent: s.sessionId === currentSessionId,
      location: [s.city, s.region, s.countryCode].filter(Boolean).join(", ") || "Unknown",
    }));

    res.json(formattedSessions);
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ message: "Failed to fetch sessions" });
  }
});

// Terminate specific session (revoke with audit trail)
app.delete("/api/profile/sessions/:sessionId", ensureAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (sessionId === req.sessionID) {
      return res.status(400).json({ message: "Cannot terminate current session. Use logout instead." });
    }

    await revokeSession({
      actorUserId: req.session.userId!,
      targetUserId: req.session.userId!,
      sessionId,
      reason: "User terminated session",
    });
    res.json({ message: "Session terminated successfully" });
  } catch (error) {
    console.error("Terminate session error:", error);
    res.status(500).json({ message: "Failed to terminate session" });
  }
});

// Terminate all other sessions
app.delete("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
  try {
    const currentSessionId = req.sessionID;
    const allSessions = await getActiveSessions({ userId: req.session.userId!, limit: 100 });

    for (const session of allSessions) {
      if (session.sessionId !== currentSessionId) {
        await revokeSession({
          actorUserId: req.session.userId!,
          targetUserId: req.session.userId!,
          sessionId: session.sessionId,
          reason: "User terminated all other sessions",
        });
      }
    }
    res.json({ message: "All other sessions terminated successfully" });
  } catch (error) {
    console.error("Terminate all sessions error:", error);
    res.status(500).json({ message: "Failed to terminate sessions" });
  }
});

// Update user preferences (timezone, language, country)
app.put("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
  console.log(`[Preferences] PUT /api/profile/preferences called by user ${req.session.userId}, body:`, JSON.stringify(req.body));
  try {
    const preferencesSchema = z.object({
      timezone: z.string().max(50).optional(),
      language: z.string().max(10).optional(),
      country: z.string().max(50).optional(),
    });

    const validationResult = preferencesSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: validationResult.error.errors[0]?.message || "Invalid input"
      });
    }

    const { timezone, language, country } = validationResult.data;

    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Policy: admin controls timezone editability
    const [cfg] = await db
      .select({ allowUserTimezoneEdit: systemConfig.allowUserTimezoneEdit })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;

    const updateData: Record<string, string> = {};
    let didUpdate = false;

    // Language always editable
    if (language !== undefined) {
      const normalized = normalizeLanguagePreference(language);
      if (!normalized.matched) {
        return res.status(400).json({ message: "Unsupported language" });
      }
      updateData.language = normalized.normalized;
      didUpdate = true;
      console.log(`[Preferences] User ${req.session.userId} updating language to: ${updateData.language}`);
    }

    // Timezone editable only if policy allows it
    if (timezone !== undefined && allowUserTimezoneEdit) {
      updateData.timezone = timezone;
      didUpdate = true;
    }

    // Country: set-once only (immutable after first set)
    if (country !== undefined) {
      const normalized = String(country).trim().toUpperCase();
      if (normalized) {
        const existingRaw = (user as any).countryIso2 || (user as any).country;
        const existing = existingRaw ? String(existingRaw).trim().toUpperCase() : "";

        // If already set and differs -> reject
        if (existing && normalized !== existing) {
          return res.status(409).json({ message: "Country is locked and cannot be changed." });
        }

        // If not set yet -> allow one-time set (and also set countryIso2)
        if (!existing) {
          if (!/^[A-Z]{2}$/.test(normalized)) {
            return res.status(400).json({ message: "Invalid country code (expected ISO2)." });
          }
          await storage.updateUser(user.id, { countryIso2: normalized, country: normalized });
          didUpdate = true;
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      console.log(`[Preferences] Saving preferences for user ${req.session.userId}:`, updateData);
      await storage.updateUserPreferences(req.session.userId!, updateData);
      console.log(`[Preferences] Successfully saved preferences for user ${req.session.userId}`);
      didUpdate = true;
    }

    if (!didUpdate) {
      return res.status(400).json({ message: "No preferences to update" });
    }

    res.json({ message: "Preferences updated successfully" });
  } catch (error) {
    console.error("Update preferences error:", error);
    res.status(500).json({ message: "Failed to update preferences" });
  }
});

// Get user preferences + policy flags
app.get("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [cfg] = await db
      .select({ allowUserTimezoneEdit: systemConfig.allowUserTimezoneEdit })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;
    const countryRaw = (user as any).countryIso2 || (user as any).country || null;
    const countryIso2 = countryRaw ? String(countryRaw).trim().toUpperCase() : null;

    res.json({
      timezone: (user as any).timezone || "UTC",
      language: (user as any).language || "en",
      country: countryIso2,
      countryLocked: Boolean(countryIso2),
      timezoneEditable: allowUserTimezoneEdit,
    });
  } catch (error) {
    console.error("Get preferences error:", error);
    res.status(500).json({ message: "Failed to fetch preferences" });
  }
});

// Get KYC profile for current user
app.get("/api/profile/kyc", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
  try {
    const kycProfile = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, req.session.userId!),
    });

    if (!kycProfile) {
      return res.json({
        status: "NOT_STARTED",
        invitedAt: null,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    }

    res.json({
      status: kycProfile.status,
      invitedAt: kycProfile.invitedAt?.toISOString() || null,
      submittedAt: kycProfile.submittedAt?.toISOString() || null,
      reviewedAt: kycProfile.reviewedAt?.toISOString() || null,
      rejectionReason: kycProfile.rejectionReason,
    });
  } catch (error) {
    console.error("Get KYC profile error:", error);
    res.status(500).json({ message: "Failed to fetch KYC profile" });
  }
});

// Submit KYC documents for current user
app.post("/api/profile/kyc/submit", ensureAuth, requirePolicy("KYC_SUBMIT"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const {
      documentType,
      documentNumber,
      legalFirstName,
      legalLastName,
      dob,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      country,
      idDocumentRef,
      documentData,
    } = req.body ?? {};

    if (!documentType || typeof documentType !== "string") {
      return res.status(400).json({ message: "Document type is required" });
    }

    const missing: string[] = [];
    if (!legalFirstName) missing.push("legalFirstName");
    if (!legalLastName) missing.push("legalLastName");
    if (!dob) missing.push("dob");
    if (!addressLine1) missing.push("addressLine1");
    if (!city) missing.push("city");
    if (!country) missing.push("country");

    if (missing.length) {
      return res.status(400).json({ message: `Missing required KYC fields: ${missing.join(", ")}` });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const kycProfile = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    if (!kycProfile) {
      return res.status(400).json({ message: "You must be invited for KYC verification first" });
    }

    if (kycProfile.status !== "INVITED" && kycProfile.status !== "REJECTED") {
      return res.status(400).json({
        message: `Cannot submit KYC with current status: ${kycProfile.status}`
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    await db.update(userKycProfiles)
      .set({
        status: "SUBMITTED",
        documentType,
        documentNumber: documentNumber || null,
        legalFirstName: legalFirstName || null,
        legalLastName: legalLastName || null,
        dob: dob || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        region: region || null,
        postalCode: postalCode || null,
        country: country || null,
        idDocumentRef: idDocumentRef || documentData || null,
        submittedAt: nowSec,
        updatedAt: nowSec,
      })
      .where(eq(userKycProfiles.userId, userId));

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "KYC",
      type: "KYC_SUBMITTED",
      title: "KYC documents submitted",
      description: `Document type: ${documentType}`,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "KYC documents submitted for review" });
  } catch (error) {
    console.error("KYC submit error:", error);
    res.status(500).json({ message: "Failed to submit KYC documents" });
  }
});

// Get payout profile for current user
app.get("/api/profile/payout", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    const defaultCurrency = defaultPaymentCurrencyForCountry({
      countryIso2: (user as any)?.countryIso2 ?? (user as any)?.country ?? null,
      regionKey: (user as any)?.regionKey ?? null,
    });

    const payoutProfile = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, req.session.userId!),
    });

    if (!payoutProfile) {
      return res.json({
        preferredPaymentCurrency: defaultCurrency,
        payoutMethod: null,
        isVerified: false,
      });
    }

    res.json({
      preferredPaymentCurrency: payoutProfile.preferredPaymentCurrency || defaultCurrency,
      payoutMethod: payoutProfile.payoutMethod,
      isVerified: payoutProfile.isVerified,
    });
  } catch (error) {
    console.error("Get payout profile error:", error);
    res.status(500).json({ message: "Failed to fetch payout profile" });
  }
});

// Update payout currency preference
app.put("/api/profile/payout/currency", ensureAuth, requirePolicy("PREFERRED_PAYMENT_CURRENCY_SET"), async (req: Request, res: Response) => {
  try {
    const payoutCurrencySchema = z.object({
      currency: z.enum(["USD", "EUR", "GBP", "CHF", "JPY"], {
        errorMap: () => ({ message: "Invalid currency. Must be USD, EUR, GBP, CHF, or JPY" })
      })
    });

    const validationResult = payoutCurrencySchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ message: validationResult.error.errors[0]?.message || "Invalid input" });
    }

    const { currency } = validationResult.data;

    const existing = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, req.session.userId!),
    });

    if (existing) {
      await db.update(userPayoutProfiles)
        .set({
          preferredPaymentCurrency: currency,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(userPayoutProfiles.userId, req.session.userId!));
    } else {
      await db.insert(userPayoutProfiles).values({
        userId: req.session.userId!,
        preferredPaymentCurrency: currency,
      });
    }

    res.json({ message: "Currency preference updated" });
  } catch (error) {
    console.error("Update payout currency error:", error);
    res.status(500).json({ message: "Failed to update currency preference" });
  }
});

// Real-time account summary endpoint - returns fresh MT5-style metrics
app.get("/api/account/summary", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    // Import and run recalcAccount to get fresh metrics with stale detection
    const { recalcAccount } = await import("../recalcAccount");
    const metrics = await recalcAccount(userId);

    if (!metrics) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return MT5-style account summary with stale pricing indicators
    res.json({
      startingBalance: metrics.startingBalance,
      balance: metrics.balance,
      equity: metrics.equity,
      floatingPnl: metrics.floatingPnl,
      usedMargin: metrics.usedMargin,
      freeMargin: metrics.freeMargin,
      marginLevel: metrics.marginLevel, // null when no margin used (not 0)
      openPositions: metrics.openPositions,
      pricingStale: metrics.pricingStale,
      staleSymbols: metrics.staleSymbols,
      asOf: metrics.asOf.toISOString(),
    });
  } catch (error) {
    console.error("Get account summary error:", error);
    res.status(500).json({ message: "Failed to get account summary" });
  }
});

// Symbol configuration endpoint
app.get("/api/config/symbols", async (req: Request, res: Response) => {
  try {
    const symbols = await storage.getSymbolConfigs();
    res.json(symbols);
  } catch (error) {
    console.error("Get symbols error:", error);
    res.status(500).json({ message: "Failed to fetch symbols" });
  }
});
}
