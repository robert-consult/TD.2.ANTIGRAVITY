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

export function registerAccountSummaryRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/account/summary", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;

    // Import and run recalcAccount to get fresh metrics with stale detection
    const { recalcAccount } = await import("../../recalcAccount");
    const metrics = await recalcAccount(userId);

    if (!metrics) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return MT5-style account summary with stale pricing indicators
    res.json({
      startingBalance: metrics.startingBalance,
      balance: metrics.balance,
      equity: metrics.equity,
      floatingPnl: metrics.floatingPnl,
      usedMargin: metrics.usedMargin,
      freeMargin: metrics.freeMargin,
      marginLevel: metrics.marginLevel, // null when no margin used (not 0)
      openPositions: metrics.openPositions,
      pricingStale: metrics.pricingStale,
      staleSymbols: metrics.staleSymbols,
      asOf: metrics.asOf.toISOString(),
    });
  } catch (error) {
    console.error("Get account summary error:", error);
    res.status(500).json({ message: "Failed to get account summary" });
  }
});
}
