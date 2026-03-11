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
import { revokeAllPushDevicesForUser } from "../../services/pushDevices";
import { ensureRequestAuthenticated } from "../../middleware/auth";
import { computeEmailGracePeriod } from "../../utils/computeEmailGracePeriod";
import { maybeRecalcAccountForCurrentUser } from "../../services/currentUserRecalc";
import crypto from "crypto";
import type { AuthRouterDeps } from "./types";

export function registerLogoutRoute(router: Router, deps: AuthRouterDeps) {
  const { sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/auth/logout", async (req: Request, res: Response) => {
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
        await revokeAllPushDevicesForUser(userId);
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
}
