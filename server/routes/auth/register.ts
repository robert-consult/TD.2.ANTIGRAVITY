// @ts-nocheck
import type { Router, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { emailVerificationTokens, loginSchema, signupFreezeAttempts, userVerification } from "@shared/schema";
import type { AuditContext as GriftAuditContext } from "../../grift/griftTypes";
import { storage } from "../../storage";
import { isPostgres } from "@db/config";
import {
  buildRememberMeCookieOptions,
  clearRememberMeCookie,
  decodeRememberMeCookie,
  enforceRememberMeDeviceLimit,
  getRememberMeConfig,
  issueRememberMeToken,
  listRememberMeDevices,
  readRememberMeCookie,
  REMEMBER_ME_COOKIE_NAME,
  revokeAllRememberMeTokensForUser,
  revokeRememberMeTokenById,
  revokeRememberMeTokenBySelector,
} from "../../services/rememberMe";
import {
  buildGeoContext,
  createUserSession,
  endSession,
  extractClientIdentity,
  extractGeoHints,
  getClientIp,
  getUserAgent,
  recordLoginAttempt,
} from "../../security/sessionTrail";
import { clearLoginRateLimit, enforceLoginRateLimit } from "../../security/loginRateLimit";
import { botGuard, persistBotAssessmentForUser } from "../../security/botGuard";
import { getTrustedProxyCountryIso2 } from "../../security/proxyHeaders";
import {
  evaluateLoginJurisdiction,
  evaluateSignupJurisdiction,
  recordSignupJurisdictionBlock,
} from "../../policy/jurisdictionControl";
import { getSignupPublicConfig, normalizeSignupPhone } from "../../services/signupPublicConfig";
import { verifySignupCaptcha } from "../../security/captcha";
import { checkCoverage } from "../../legal/coverageGate";
import { verifyDoc1TermsToken } from "../../legal/cryptoUtils";
import { recordDoc1Acceptance } from "../../legal/legalAcceptanceService";
import {
  computeDoc1ReacceptStatus,
  getDoc1ReacceptRequirement,
  upsertDoc1ReacceptRequirement,
} from "../../legal/legalReacceptanceService";
import { withGriftClient } from "../../grift/griftDb";
import { extractGriftContext } from "../../grift/griftGeo";
import { maybeApplyAutoEnforcement } from "../../grift/griftAutoEnforcement";
import { onLoginSuccess } from "../../grift/griftEngine";
import { hashEmailVerificationToken } from "../../security/emailVerificationToken";
import { appendIdentityAudit } from "../../services/identityAudit";
import { sendWelcomeMailboxMessage } from "../../services/messaging";
import { ensureRequestAuthenticated } from "../../middleware/auth";
import { computeEmailGracePeriod } from "../../utils/computeEmailGracePeriod";
import { maybeRecalcAccountForCurrentUser } from "../../services/currentUserRecalc";
import crypto from "crypto";
import type { AuthRouterDeps } from "./types";

export function registerRegisterRoute(router: Router, deps: AuthRouterDeps) {
  const { sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const signupCfg = await getSignupPublicConfig();

    // Hard stop: when signups are frozen, block registration but still log attempts.
    if (signupCfg.signupsFrozen) {
      const nowSec = Math.floor(Date.now() / 1000);
      const emailRaw = typeof (req.body as any)?.email === "string" ? String((req.body as any).email) : "";
      const usernameRaw = typeof (req.body as any)?.username === "string" ? String((req.body as any).username) : "";
      const emailLower = emailRaw ? emailRaw.trim().toLowerCase() : null;

      try {
        await db.insert(signupFreezeAttempts)
          .values({
            email: emailRaw || null,
            emailLower,
            username: usernameRaw || null,
            ip,
            userAgent,
            createdAt: nowSec,
          });
      } catch (e) {
        console.warn("Failed to record signup freeze attempt:", e);
      }

      return res.status(403).json({
        message: "SIGNUPS_FROZEN",
        error: "SIGNUPS_FROZEN",
        signupFreezeMessage: signupCfg.signupFreezeMessage,
        waitlistEnabled: signupCfg.waitlistEnabled,
      });
    }

    const schema = z.object({
      email: z.string().email(),
      username: z.string().min(3),
      password: z.string().min(8).max(25),
      countryIso2: z.string().length(2).toUpperCase(),
      termsToken: z.string().min(10),
      combinedSha256: z.string().min(10),
      captchaToken: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    });

    const { email, username, password, countryIso2, termsToken, combinedSha256, captchaToken, phone } = schema.parse(req.body);
    const clientIdentity = extractClientIdentity(req);

    // Jurisdiction control (sanctions / restricted countries)
    const geoHints = extractGeoHints(req);
    const geoContext = buildGeoContext(ip, geoHints);

    const ipCountryIso2 =
      getTrustedProxyCountryIso2(req) ??
      (geoContext.countryCode ? geoContext.countryCode.toUpperCase() : undefined);

    const signupJ = evaluateSignupJurisdiction({
      ipCountryIso2,
      selectedCountryIso2: countryIso2,
    });

    if (!signupJ.allowed) {
      const nowSec = Math.floor(Date.now() / 1000);
      await recordSignupJurisdictionBlock({
        email,
        username,
        ip,
        userAgent,
        ipCountryIso2: signupJ.ipCountryIso2 ?? null,
        selectedCountryIso2: signupJ.selectedCountryIso2 ?? null,
        reasonCode: signupJ.reasonCode,
        policySnapshot: { identity: clientIdentity },
        createdAtSec: nowSec,
      });

      return res.status(signupJ.httpStatus).json({
        message: signupJ.message,
        code: signupJ.code,
        reasonCode: signupJ.reasonCode,
        blockedBy: signupJ.blockedBy,
        ipCountryIso2: signupJ.ipCountryIso2 ?? null,
        selectedCountryIso2: signupJ.selectedCountryIso2 ?? null,
      });
    }

    const bg = await botGuard(req, res, { action: "SIGNUP", email });
    if (!bg.allowed) return;

    const captchaResult = await verifySignupCaptcha(req, captchaToken);
    if (!captchaResult.ok) {
      return res.status(400).json({ message: captchaResult.message });
    }

    const cov = await checkCoverage(countryIso2);
    if (cov.enforced && !cov.allowed) {
      return res.status(409).json({ message: "LEGAL_COVERAGE_MISSING" });
    }

    const tokenCheck = verifyDoc1TermsToken(termsToken, {
      expectedCountryIso2: countryIso2,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    if (!tokenCheck.ok) {
      return res.status(400).json({ message: tokenCheck.error });
    }
    if (tokenCheck.payload.combinedSha256 !== combinedSha256) {
      return res.status(400).json({ message: "TERMS_COMBINED_SHA_MISMATCH" });
    }
    const regionKey: string | null = tokenCheck.payload.regionKey ?? null;

    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const phoneRequired = Boolean(signupCfg.signupPhoneEnforce);
    const normalizedPhone = normalizeSignupPhone(phone ?? undefined, countryIso2);
    if (!normalizedPhone.ok) {
      return res.status(400).json({ message: "PHONE_INVALID" });
    }
    if (phoneRequired && !normalizedPhone.e164) {
      return res.status(400).json({ message: "PHONE_REQUIRED" });
    }

    // Build signup fingerprint data for grift detection and audit
    const deviceContext = parseDevice(userAgent);
    const signupFingerprint = {
      requestId: crypto.randomUUID(),
      ip,
      userAgent,
      geo: {
        countryCode: geoContext.countryCode,
        region: geoContext.region,
        city: geoContext.city,
        latitude: geoContext.latitude,
        longitude: geoContext.longitude,
        inferredTz: geoContext.inferredTz,
      },
      device: {
        deviceType: deviceContext.deviceType,
        browser: deviceContext.browser,
        os: deviceContext.os,
      },
      identity: {
        deviceFp: clientIdentity.deviceFp,
        deviceInstallId: clientIdentity.deviceInstallId,
        clientTz: clientIdentity.clientTz,
        clientLang: clientIdentity.clientLang,
      },
      countryIso2Selected: countryIso2,
      regionKeySelected: regionKey ?? undefined,
    };

    let user;
    try {
      user = await db.transaction(async (tx) => {
        const createdUser = await storage.createUserInTransaction(tx, {
          email,
          username,
          password,
          countryIso2: countryIso2 ?? null,
          regionKey: regionKey ?? null,
          phone: normalizedPhone.e164 ?? null,
          fingerprint: signupFingerprint,
        });

        await recordDoc1Acceptance({
          userId: createdUser.id,
          emailAtAcceptance: email,
          countryIso2,
          ipAddress: ip,
          userAgent,
          sessionId: req.sessionID,
          termsToken,
          combinedSha256,
          verifiedPayload: tokenCheck.payload,
          tx,
        });

        return createdUser;
      }, {
        isolationLevel: "serializable",
        accessMode: "read write",
      });
    } catch (acceptErr: any) {
      const code = acceptErr instanceof LegalAcceptanceError ? acceptErr.code : "REGISTRATION_TRANSACTION_FAILED";
      console.error("[Legal] Registration transaction failed:", code, acceptErr?.message || acceptErr);
      if (acceptErr?.stack) console.error("[Legal] Stack trace:", acceptErr.stack);
      return res.status(500).json({ message: code });
    }

    try {
      await persistBotAssessmentForUser({ userId: user.id, score: bg.score, signals: bg.signals });
    } catch (e) {
      console.error("Failed to persist bot risk assessment:", e);
    }

    // If this email was on the waitlist, mark it as converted (only after successful signup + acceptance).
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const emailLower = String(email).trim().toLowerCase();
      await db.update(signupWaitlist)
        .set({
          status: "CONVERTED",
          convertedAt: nowSec,
          convertedUserId: user.id,
          updatedAt: nowSec,
        })
        .where(eq(signupWaitlist.emailLower, emailLower));
    } catch (e) {
      console.warn("Failed to mark waitlist conversion:", e);
    }

    try {
      await db.insert(userVerification).values({
        userId: user.id,
        phoneE164: normalizedPhone.e164,
        contenderTier: "NONE",
        smsEnabled: false,
        smsVerifiedAt: null,
        smsVerifyFailCount: 0,
      }).onConflictDoUpdate({
        target: userVerification.userId,
        set: {
          phoneE164: normalizedPhone.e164,
          smsVerifiedAt: null,
          smsVerifyFailCount: 0,
          smsEnabled: false,
        },
      });
    } catch (verificationError) {
      console.error("Failed to initialize user_verification:", verificationError);
    }

    // Generate and send verification email automatically on registration
    try {
      const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;
      const token = crypto.randomBytes(32).toString("hex");

      const tokenHash = hashEmailVerificationToken(token);

      const tokenId = crypto.randomUUID();
      const expiresAt = Math.floor(Date.now() / 1000) + VERIFICATION_TOKEN_EXPIRY_HOURS * 3600;

      // Store token in email_verification_tokens table
      await db.insert(emailVerificationTokens).values({
        id: tokenId,
        userId: user.id,
        tokenHash,
        purpose: "VERIFY",
        expiresAt,
      });

      // Send verification email via Resend API
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
              subject: "Verify your TradeQuip email address",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2 style="color: #1a1a2e;">Welcome to TradeQuip!</h2>
                  <p>Thank you for registering. Please verify your email address to get started:</p>
                  <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
                    Verify Email
                  </a>
                  <p style="color: #666; font-size: 14px;">This link expires in ${VERIFICATION_TOKEN_EXPIRY_HOURS} hours.</p>
                  <p style="color: #666; font-size: 12px;">If you didn't create this account, please ignore this email.</p>
                </div>
              `,
            }),
          });

          const emailData = await emailResponse.json();
          if (emailResponse.ok) {
            emailSent = true;
            console.log("Registration verification email sent:", { id: emailData.id, to: email });
          } else {
            console.error("Resend API error during registration:", emailData);
          }
        } catch (emailError) {
          console.error("Error sending registration verification email:", emailError);
        }
      } else {
        console.warn("RESEND_API_KEY not configured, skipping verification email");
      }

      // Log to identity_audit
      appendIdentityAudit({
        userId: user.id,
        email: user.email,
        username: user.username,
        category: "VERIFICATION",
        type: emailSent ? "EMAIL_VERIFICATION_SENT" : "EMAIL_SEND_FAILED",
        title: emailSent ? "Registration verification email sent" : "Registration email send failed",
        description: emailSent ? "Automatic verification email on registration" : "RESEND_API_KEY missing or API error",
        ip,
        userAgent,
      });
    } catch (emailTokenError) {
      console.error("Failed to send registration verification email:", emailTokenError);
      // Don't fail registration if email fails - user can request resend
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        return resolve();
      });
    });

    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.isAdmin = Boolean(user.isAdmin);
    req.session.userCountryIso2 = user.countryIso2 || undefined;
    req.session.ipCountryIso2 = ipCountryIso2;
    const rememberMeConfig = await getRememberMeConfig();
    req.session.cookie.maxAge = rememberMeConfig.sessionCookieMaxAgeHours * 60 * 60 * 1000;

    const { geo } = await createUserSession({
      sessionId: req.sessionID,
      userId: user.id,
      email: user.email,
      ip,
      userAgent,
      identity: clientIdentity,
      geo: geoContext,
    });

    let griftAutoEnforcement: any = null;
    if (isPostgres) {
      try {
        const griftCtx = extractGriftContext(req);
        await withGriftClient(async (griftDb) => {
          const griftAuditCtx: GriftAuditContext = {
            ts: Date.now(),
            userId: user.id,
            sessionId: req.sessionID,
            deviceId: griftCtx.deviceId ?? undefined,
            deviceIdLegacy: griftCtx.deviceIdLegacy ?? undefined,
            deviceFp: griftCtx.deviceFp ?? undefined,
            deviceInstallId: griftCtx.deviceInstallId ?? undefined,
            clientTz: griftCtx.clientTz ?? undefined,
            clientLang: griftCtx.clientLang ?? undefined,
            eventType: "SIGNUP_SUCCESS",
            ip: griftCtx.ip ?? undefined,
            userAgent: griftCtx.userAgent ?? undefined,
            geoCountry: griftCtx.geoCountry ?? undefined,
            geoRegion: griftCtx.geoRegion ?? undefined,
            geoCity: griftCtx.geoCity ?? undefined,
            latitude: griftCtx.latitude ?? undefined,
            longitude: griftCtx.longitude ?? undefined,
            asn: griftCtx.asn ?? undefined,
            org: griftCtx.org ?? undefined,
          };

          await onLoginSuccess(griftDb, griftAuditCtx);

          try {
            griftAutoEnforcement = await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
          } catch (enfErr) {
            console.error("[Grift] Auto-enforcement failed (registration):", enfErr);
          }
        });
      } catch (griftErr) {
        console.error("[Grift] Failed to capture registration context:", griftErr);
      }
    }

    if (griftAutoEnforcement?.applied && griftAutoEnforcement?.newStatus && griftAutoEnforcement.newStatus !== "ACTIVE") {
      const statusMsg =
        griftAutoEnforcement.newStatus === "DISABLED"
          ? "Account is disabled due to integrity review. Please contact support."
          : "Account is frozen due to integrity review. Please contact support.";

      return req.session.destroy(() =>
        res.status(403).json({
          message: statusMsg,
          reasonCode: "GRIFT_AUTO_ENFORCEMENT",
          enforcement: griftAutoEnforcement,
        })
      );
    }

    void sendWelcomeMailboxMessage(user.id).catch((mailErr) => {
      console.error("[mailbox] failed to send signup welcome message:", mailErr);
    });

    const registerGrace = computeEmailGracePeriod(user.createdAt, false);

    res.status(201).json({
      id: user.id,
      email: user.email,
      username: user.username,
      countryIso2: user.countryIso2,
      language: (user as any).language || "en",
      phone: user.phone || "",
      balance: user.balance,
      startingEquity: user.startingEquity,
      createdAt: user.createdAt,
      emailVerified: false,
      emailVerifiedAt: null,
      inGracePeriod: registerGrace.inGracePeriod,
      gracePeriodEndsAt: registerGrace.gracePeriodEndsAt,
      legalReacceptRequired: false,
      legalReacceptBlocked: false,
      legalReacceptBlockedReason: null,
      legalRequiredCombinedSha256: null,
      legalLastAcceptedCombinedSha256: combinedSha256,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
}
