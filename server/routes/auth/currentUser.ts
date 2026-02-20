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

export function registerCurrentUserRoute(router: Router, deps: AuthRouterDeps) {
  const { sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/auth/current-user", async (req: Request, res: Response) => {
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
        realAdminId: null,
        realAdminEmail: null,
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
}
