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

export function registerSessionsRoutes(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
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
router.delete("/api/profile/sessions/:sessionId", ensureAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = Array.isArray(req.params.sessionId) ? req.params.sessionId[0] : req.params.sessionId;

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
router.delete("/api/profile/sessions", ensureAuth, async (req: Request, res: Response) => {
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

}
