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

export function registerDeactivateRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/profile/account/deactivate", ensureAuth, async (req: Request, res: Response) => {
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
      reasonText: normalizedReasonText ?? undefined,
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
      return res.status(400).json({ message: "Invalid input data", errors: error.issues });
    }
    console.error("Account deactivation error:", error);
    res.status(500).json({ message: "Failed to deactivate account" });
  }
});
}
