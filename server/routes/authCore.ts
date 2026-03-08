import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@db";
import {
  emailVerificationTokens,
  loginSchema,
  signupFreezeAttempts,
  signupWaitlist,
  userVerification,
} from "@shared/schema";
import type { AuditContext as GriftAuditContext } from "../grift/griftTypes";
import { storage } from "../storage";
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
} from "../services/rememberMe";
import {
  buildGeoContext,
  createUserSession,
  endSession,
  extractClientIdentity,
  extractGeoHints,
  getClientIp,
  getUserAgent,
  parseDevice,
  recordLoginAttempt,
} from "../security/sessionTrail";
import { clearLoginRateLimit, enforceLoginRateLimit } from "../security/loginRateLimit";
import { botGuard, persistBotAssessmentForUser } from "../security/botGuard";
import { getTrustedProxyCountryIso2 } from "../security/proxyHeaders";
import {
  evaluateLoginJurisdiction,
  evaluateSignupJurisdiction,
  recordSignupJurisdictionBlock,
} from "../policy/jurisdictionControl";
import { getSignupPublicConfig, normalizeSignupPhone } from "../services/signupPublicConfig";
import { verifySignupCaptcha } from "../security/captcha";
import { checkCoverage } from "../legal/coverageGate";
import { verifyDoc1TermsToken } from "../legal/cryptoUtils";
import { LegalAcceptanceError, recordDoc1Acceptance } from "../legal/legalAcceptanceService";
import {
  computeDoc1ReacceptStatus,
  getDoc1ReacceptRequirement,
  upsertDoc1ReacceptRequirement,
} from "../legal/legalReacceptanceService";
import { withGriftClient } from "../grift/griftDb";
import { extractGriftContext } from "../grift/griftGeo";
import { maybeApplyAutoEnforcement } from "../grift/griftAutoEnforcement";
import { onLoginSuccess } from "../grift/griftEngine";
import { hashEmailVerificationToken } from "../security/emailVerificationToken";
import { appendIdentityAudit } from "../services/identityAudit";
import { sendWelcomeMailboxMessage } from "../services/messaging";
import { ensureRequestAuthenticated } from "../middleware/auth";
import { computeEmailGracePeriod } from "../utils/computeEmailGracePeriod";
import { maybeRecalcAccountForCurrentUser } from "../services/currentUserRecalc";
import { applyAdminScopeSession } from "../security/adminScopeSession";
import crypto from "crypto";

interface AuthCoreDeps {
  ensureAuth: (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
  sessionCookieName: string;
}

export function registerAuthCoreRoutes(app: Express, deps: AuthCoreDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;

// Authentication endpoints
app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = loginSchema.parse(req.body);
    const rememberMeConfig = await getRememberMeConfig();
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);
    const clientIdentity = extractClientIdentity(req);
    const geoHints = extractGeoHints(req);
    const geoContext = buildGeoContext(ip, geoHints);
    const unavailableAccountResponse = {
      message: "Account is unavailable. Please contact support.",
      code: "ACCOUNT_UNAVAILABLE",
    };

    const rateDecision = await enforceLoginRateLimit({ ip, email });
    if (!rateDecision.allowed) {
      await recordLoginAttempt({
        email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
        success: false,
        failureReason: `RATE_LIMITED_${rateDecision.scope}`,
      });
      res.setHeader("Retry-After", String(rateDecision.retryAfterSec));
      return res.status(429).json({
        message: "Too many login attempts. Please try again later.",
        code: "LOGIN_RATE_LIMITED",
        retryAfterSec: rateDecision.retryAfterSec,
      });
    }

    const bg = await botGuard(req, res, { action: "LOGIN", email });
    if (!bg.allowed) return;

    const user = await storage.verifyUser(email, password);

    if (!user) {
      await recordLoginAttempt({
        email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
        success: false,
        failureReason: "Invalid credentials",
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if ((user as any).isDeleted) {
      await recordLoginAttempt({
        userId: user.id,
        email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
        success: false,
        failureReason: "Account deleted",
      });
      return res.status(403).json(unavailableAccountResponse);
    }

    if (user.isDisabled) {
      await recordLoginAttempt({
        userId: user.id,
        email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
        success: false,
        failureReason: "Account disabled",
      });
      return res.status(403).json(unavailableAccountResponse);
    }

    if ((user as any).isFrozen) {
      await recordLoginAttempt({
        userId: user.id,
        email,
        ip,
        userAgent,
        identity: clientIdentity,
        geo: geoContext,
        success: false,
        failureReason: "Account frozen",
      });
      return res.status(403).json(unavailableAccountResponse);
    }

    // Jurisdiction control (sanctions / restricted countries)
    const ipCountryIso2 =
      getTrustedProxyCountryIso2(req) ??
      (geoContext.countryCode ? geoContext.countryCode.toUpperCase() : undefined);

    const userCountryIso2 =
      (user as any).countryIso2 && /^[A-Za-z]{2}$/.test(String((user as any).countryIso2).trim())
        ? String((user as any).countryIso2).trim().toUpperCase()
        : (user as any).country && /^[A-Za-z]{2}$/.test(String((user as any).country).trim())
          ? String((user as any).country).trim().toUpperCase()
          : undefined;

    // Enforce only for non-admin logins (admins can still access)
    if (!user.isAdmin) {
      const loginJ = evaluateLoginJurisdiction({
        ipCountryIso2,
        userCountryIso2: userCountryIso2 ?? null,
      });

      if (!loginJ.allowed) {
        await recordLoginAttempt({
          userId: user.id,
          email,
          ip,
          userAgent,
          identity: clientIdentity,
          geo: geoContext,
          success: false,
          failureReason: loginJ.reasonCode,
        });

        return res.status(loginJ.httpStatus).json({
          message: loginJ.message,
          code: loginJ.code,
          reasonCode: loginJ.reasonCode,
          blockedBy: loginJ.blockedBy,
          ipCountryIso2: loginJ.ipCountryIso2 ?? null,
          userCountryIso2: loginJ.selectedCountryIso2 ?? null,
        });
      }
    }

    try {
      await persistBotAssessmentForUser({ userId: user.id, score: bg.score, signals: bg.signals });
    } catch (e) {
      console.error("Failed to persist bot risk assessment:", e);
    }

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        return resolve();
      });
    });

    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.isAdmin = user.isAdmin;
    applyAdminScopeSession(req.session, user);
    req.session.userCountryIso2 = userCountryIso2;
    req.session.ipCountryIso2 = ipCountryIso2;
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
            eventType: "LOGIN_SUCCESS",
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

          // Run all detection rules via onLoginSuccess
          await onLoginSuccess(griftDb, griftAuditCtx);

          // Optional auto-enforcement (freeze/disable) based on admin-configured thresholds.
          try {
            griftAutoEnforcement = await maybeApplyAutoEnforcement(griftDb, griftAuditCtx);
          } catch (enfErr) {
            console.error("[Grift] Auto-enforcement failed:", enfErr);
          }
        });
      } catch (griftErr) {
        console.error("[Grift] Failed to capture login context:", griftErr);
      }
    }

    if (griftAutoEnforcement?.applied && griftAutoEnforcement?.newStatus && griftAutoEnforcement.newStatus !== "ACTIVE") {
      return req.session.destroy(() =>
        res.status(403).json(unavailableAccountResponse)
      );
    }

    const verificationLogin = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, user.id),
    });

    const emailVerifiedLogin = !!verificationLogin?.emailVerifiedAt;
    const loginGrace = computeEmailGracePeriod(user.createdAt, emailVerifiedLogin);

    let legalReacceptRequired = false;
    let legalReacceptBlocked = false;
    let legalReacceptBlockedReason: string | null = null;
    let legalRequiredCombinedSha256: string | null = null;
    let legalLastAcceptedCombinedSha256: string | null = null;
    try {
      const status = await computeDoc1ReacceptStatus(user.id);
      legalReacceptRequired = !!status.required;
      legalReacceptBlocked = !!status.blocked;
      legalReacceptBlockedReason = status.blockedReason ?? null;
      legalRequiredCombinedSha256 = status.requiredCombinedSha256 ?? null;
      legalLastAcceptedCombinedSha256 = status.lastAcceptedCombinedSha256 ?? null;
      await upsertDoc1ReacceptRequirement({ userId: user.id, detectedBy: "LOGIN", status });
      (req.session as any).legalReacceptRequired = legalReacceptRequired || legalReacceptBlocked;
    } catch (e) {
      console.error("[Legal] Failed to compute re-acceptance status on login:", e);
    }

    await recordLoginAttempt({
      userId: user.id,
      email: user.email,
      ip,
      userAgent,
      success: true,
      sessionId: req.sessionID,
      identity: clientIdentity,
      geo: geoContext,
      eventType: "LOGIN_SUCCESS",
    });

    try {
      await clearLoginRateLimit({ ip, email });
    } catch {
      // ignore rate-limit cache clear failures
    }

    const shouldIssueRememberMeToken = Boolean(rememberMe) && rememberMeConfig.enabled;
    if (shouldIssueRememberMeToken) {
      try {
        const issued = await issueRememberMeToken({
          userId: user.id,
          maxAgeDays: rememberMeConfig.maxAgeDays,
          req,
        });
        await enforceRememberMeDeviceLimit(user.id, rememberMeConfig.maxDevicesPerUser);
        res.cookie(
          REMEMBER_ME_COOKIE_NAME,
          issued.cookieValue,
          buildRememberMeCookieOptions(rememberMeConfig.maxAgeDays),
        );
        await recordLoginAttempt({
          userId: user.id,
          email: user.email,
          ip,
          userAgent,
          success: true,
          sessionId: req.sessionID,
          identity: clientIdentity,
          geo: geoContext,
          eventType: "PERSISTENT_TOKEN_ISSUED",
        });
      } catch (tokenErr) {
        console.error("Failed to issue remember-me token:", tokenErr);
      }
    } else {
      clearRememberMeCookie(res);
    }

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone || "",
      countryIso2: user.countryIso2 || null,
      language: (user as any).language || "en",
      balance: user.balance,
      startingEquity: user.startingEquity,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      emailVerified: emailVerifiedLogin,
      emailVerifiedAt: verificationLogin?.emailVerifiedAt || null,
      inGracePeriod: loginGrace.inGracePeriod,
      gracePeriodEndsAt: loginGrace.gracePeriodEndsAt,
      legalReacceptRequired,
      legalReacceptBlocked,
      legalReacceptBlockedReason,
      legalRequiredCombinedSha256,
      legalLastAcceptedCombinedSha256,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid input data", errors: error.issues });
    }
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/api/auth/register", async (req: Request, res: Response) => {
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

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "INVALID_REGISTRATION_PAYLOAD",
        errors: parsed.error.flatten(),
      });
    }
    const { email, username, password, countryIso2, termsToken, combinedSha256, captchaToken, phone } = parsed.data;
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
          regionKey: regionKey ?? undefined,
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
    applyAdminScopeSession(req.session, user);
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

app.post("/api/auth/logout", async (req: Request, res: Response) => {
  const userId = req.session.userId;
  const sessionId = req.sessionID;
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const identity = extractClientIdentity(req);
  const geo = buildGeoContext(ip, extractGeoHints(req));

  const rememberMeConfig = await getRememberMeConfig();
  const currentRememberCookie = readRememberMeCookie(req);
  const parsedRememberCookie = currentRememberCookie ? decodeRememberMeCookie(currentRememberCookie) : null;

  if (userId) {
    try {
      await endSession({ userId, sessionId, ip, userAgent, geo });
    } catch (err) {
      console.error("Error recording logout:", err);
    }

    try {
      if (rememberMeConfig.logoutClearAllDeviceTokens) {
        await revokeAllRememberMeTokensForUser(userId);
        await recordLoginAttempt({
          userId,
          email: req.session.email || "",
          ip,
          userAgent,
          success: true,
          sessionId,
          identity,
          geo,
          eventType: "ALL_TOKENS_INVALIDATED",
        });
      } else if (parsedRememberCookie) {
        await revokeRememberMeTokenBySelector(parsedRememberCookie.selector, userId);
        await recordLoginAttempt({
          userId,
          email: req.session.email || "",
          ip,
          userAgent,
          success: true,
          sessionId,
          identity,
          geo,
          eventType: "PERSISTENT_TOKEN_REVOKED",
        });
      }
    } catch (tokenErr) {
      console.error("Error revoking remember-me token(s) during logout:", tokenErr);
    }
  }

  clearRememberMeCookie(res);
  res.clearCookie(SESSION_COOKIE_NAME);

  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ message: "Failed to logout" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

app.get("/api/auth/current-user", async (req: Request, res: Response) => {
  const authed = await ensureRequestAuthenticated(req, res, {
    unauthorizedMessage: "Not authenticated",
    revokedMessage: "Session has been terminated",
    destroySessionOnRevoked: true,
  });
  if (!authed) return;

  try {
    const user = await storage.getUserById(req.session.userId!);

    if (!user) {
      req.session.destroy(() => { });
      return res.status(401).json({ message: "User not found" });
    }

    const loadLegalReacceptState = async (userId: number) => {
      let legalReacceptRequired = false;
      let legalReacceptBlocked = false;
      let legalReacceptBlockedReason: string | null = null;
      let legalRequiredCombinedSha256: string | null = null;
      let legalLastAcceptedCombinedSha256: string | null = null;
      let computeSucceeded = false;
      let snapshotSucceeded = false;
      let snapshotRequired = false;

      try {
        const status = await computeDoc1ReacceptStatus(userId);
        computeSucceeded = true;
        legalReacceptRequired = Boolean(status.required);
        legalReacceptBlocked = Boolean(status.blocked);
        legalReacceptBlockedReason = status.blockedReason ?? null;
        legalRequiredCombinedSha256 = status.requiredCombinedSha256 ?? null;
        legalLastAcceptedCombinedSha256 = status.lastAcceptedCombinedSha256 ?? null;
        await upsertDoc1ReacceptRequirement({ userId, detectedBy: "STATUS", status });
        (req.session as any).legalReacceptRequired = legalReacceptRequired || legalReacceptBlocked;
        return {
          legalReacceptRequired,
          legalReacceptBlocked,
          legalReacceptBlockedReason,
          legalRequiredCombinedSha256,
          legalLastAcceptedCombinedSha256,
        };
      } catch (e) {
        console.error("[Legal] Failed to compute re-accept status on current-user:", e);
      }

      try {
        const reqRow = await getDoc1ReacceptRequirement(userId);
        snapshotSucceeded = true;
        if (reqRow) {
          snapshotRequired = true;
          legalReacceptRequired = true;
          legalRequiredCombinedSha256 = reqRow.requiredCombinedSha256;
          legalLastAcceptedCombinedSha256 = reqRow.lastAcceptedCombinedSha256;
        }
      } catch (e) {
        console.error("[Legal] Failed to load re-accept requirement snapshot:", e);
      }

      if (!computeSucceeded && (!snapshotSucceeded || !snapshotRequired)) {
        legalReacceptRequired = true;
        legalReacceptBlocked = true;
        legalReacceptBlockedReason = "LEGAL_STATUS_UNAVAILABLE";
        legalRequiredCombinedSha256 = null;
        legalLastAcceptedCombinedSha256 = null;
      }

      (req.session as any).legalReacceptRequired = legalReacceptRequired || legalReacceptBlocked;
      return {
        legalReacceptRequired,
        legalReacceptBlocked,
        legalReacceptBlockedReason,
        legalRequiredCombinedSha256,
        legalLastAcceptedCombinedSha256,
      };
    };

    const buildCurrentUserPayload = async (resolvedUser: any) => {
      const verification = await db.query.userVerification.findFirst({
        where: eq(userVerification.userId, resolvedUser.id),
      });
      const emailVerified = !!verification?.emailVerifiedAt;
      const grace = computeEmailGracePeriod(resolvedUser.createdAt, emailVerified);
      const legalStatus = await loadLegalReacceptState(resolvedUser.id);

      return {
        id: resolvedUser.id,
        email: resolvedUser.email,
        username: resolvedUser.username,
        name: resolvedUser.name || "",
        phone: resolvedUser.phone || "",
        countryIso2: resolvedUser.countryIso2 || null,
        language: (resolvedUser as any).language || "en",
        balance: resolvedUser.balance,
        startingEquity: resolvedUser.startingEquity,
        isAdmin: resolvedUser.isAdmin,
        equity: resolvedUser.equity,
        freeMargin: resolvedUser.freeMargin,
        usedMargin: resolvedUser.usedMargin,
        leverage: resolvedUser.leverage,
        createdAt: resolvedUser.createdAt,
        userTier: (resolvedUser as any).userTier || "CANDIDATE",
        contenderTier: (resolvedUser as any).contenderTier || null,
        emailVerified,
        emailVerifiedAt: verification?.emailVerifiedAt || null,
        inGracePeriod: grace.inGracePeriod,
        gracePeriodEndsAt: grace.gracePeriodEndsAt,
        legalReacceptRequired: legalStatus.legalReacceptRequired,
        legalReacceptBlocked: legalStatus.legalReacceptBlocked,
        legalReacceptBlockedReason: legalStatus.legalReacceptBlockedReason,
        legalRequiredCombinedSha256: legalStatus.legalRequiredCombinedSha256,
        legalLastAcceptedCombinedSha256: legalStatus.legalLastAcceptedCombinedSha256,
        isImpersonating: req.session.isImpersonating || false,
        realAdminId: req.session.realAdminId ?? null,
        realAdminEmail: req.session.realAdminEmail ?? null,
      };
    };

    try {
      await maybeRecalcAccountForCurrentUser(user.id);
    } catch (recalcError) {
      console.error("Error recalculating account metrics:", recalcError);
      // Continue with current persisted data if recalc fails
    }

    const refreshedUser = (await storage.getUserById(req.session.userId!)) || user;
    res.json(await buildCurrentUserPayload(refreshedUser));
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/api/auth/devices", ensureAuth, async (req: Request, res: Response) => {
  const rows = await listRememberMeDevices(req.session.userId!);
  const toMs = (value: number | null | undefined) => {
    if (value == null) return null;
    return value < 1e12 ? value * 1000 : value;
  };
  res.json(
    rows.map((row) => ({
      ...row,
      createdAt: toMs(row.createdAt),
      lastUsedAt: toMs(row.lastUsedAt),
    })),
  );
});

app.delete("/api/auth/devices/:id", ensureAuth, async (req: Request, res: Response) => {
  const tokenId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return res.status(400).json({ message: "Invalid device token id" });
  }

  await revokeRememberMeTokenById(tokenId, req.session.userId!);
  await recordLoginAttempt({
    userId: req.session.userId!,
    email: req.session.email || "",
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    success: true,
    sessionId: req.sessionID,
    identity: extractClientIdentity(req),
    geo: buildGeoContext(getClientIp(req), extractGeoHints(req)),
    eventType: "PERSISTENT_TOKEN_REVOKED",
  });
  return res.json({ ok: true });
});

app.delete("/api/auth/devices", ensureAuth, async (req: Request, res: Response) => {
  await revokeAllRememberMeTokensForUser(req.session.userId!);
  clearRememberMeCookie(res);
  await recordLoginAttempt({
    userId: req.session.userId!,
    email: req.session.email || "",
    ip: getClientIp(req),
    userAgent: getUserAgent(req),
    success: true,
    sessionId: req.sessionID,
    identity: extractClientIdentity(req),
    geo: buildGeoContext(getClientIp(req), extractGeoHints(req)),
    eventType: "ALL_TOKENS_INVALIDATED",
  });
  return res.json({ ok: true });
});
}
