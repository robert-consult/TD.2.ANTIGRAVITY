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

export function registerChangePasswordRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.post("/api/profile/change-password", ensureAuth, async (req: Request, res: Response) => {
  try {
    const passwordChangeSchema = z.object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: z.string().min(8, "New password must be at least 8 characters").max(25, "New password must be at most 25 characters"),
    });

    const validationResult = passwordChangeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: validationResult.error.issues[0]?.message || "Invalid input"
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
}
