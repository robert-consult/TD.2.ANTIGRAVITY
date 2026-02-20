// @ts-nocheck
import type { Router, NextFunction, Request, Response } from "express";
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
import { storage } from "../../storage";
import { hashEmailVerificationToken } from "../../security/emailVerificationToken";
import { appendIdentityAudit } from "../../services/identityAudit";
import { getSignupPublicConfig } from "../../services/signupPublicConfig";
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
} from "../../security/sessionTrail";
import {
  clearRememberMeCookie,
  revokeAllRememberMeTokensForUser,
} from "../../services/rememberMe";
import { normalizeLanguagePreference } from "../../lib/priceUtils";
import { requirePolicy } from "../../middleware/requirePolicy";
import { buildAuditContext } from "../../lib/auditContext";
import { buildDecisionContext } from "../../policy/buildDecisionContext";
import { loadPolicyConfig } from "../../policy/getPolicyConfig";
import { decidePolicy, featureGates } from "@shared/policyDecision";
import { promotePerformerIfEligible } from "../../policy/performerPromotion";
import { defaultPaymentCurrencyForCountry } from "../../utils/paymentCurrency";
import type { ProfileRouterDeps } from "./types";

export function registerProfileUpdateRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/profile/update", ensureAuth, async (req: Request, res: Response) => {
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

}
