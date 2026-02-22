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
import { applyAdminScopeSession } from "../../security/adminScopeSession";
import crypto from "crypto";
import type { AuthRouterDeps } from "./types";

export function registerLoginRoute(router: Router, deps: AuthRouterDeps) {
  const { sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/auth/login", async (req: Request, res: Response) => {
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
      return res.status(400).json({ message: "Invalid input data", errors: error.errors });
    }
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
}
