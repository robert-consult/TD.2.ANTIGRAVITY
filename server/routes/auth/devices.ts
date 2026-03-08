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

export function registerDevicesRoutes(router: Router, deps: AuthRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/auth/devices", ensureAuth, async (req: Request, res: Response) => {
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

router.delete("/api/auth/devices/:id", ensureAuth, async (req: Request, res: Response) => {
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

router.delete("/api/auth/devices", ensureAuth, async (req: Request, res: Response) => {
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
