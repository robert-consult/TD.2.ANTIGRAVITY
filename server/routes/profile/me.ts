// @ts-nocheck
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

export function registerProfileMeRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/profile/me", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const user = await storage.getUserById(userId);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const verification = await db.query.userVerification.findFirst({
      where: eq(userVerification.userId, userId),
    });

    const kyc = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    const payout = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, userId),
    });

    const settings = await storage.getUserSettingsById(userId);
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const decisionCtx = await buildDecisionContext({
      userId,
      nowMs: Date.now(),
      request: {
        correlationId: auditCtx.correlationId,
        actorType: auditCtx.actorType,
        actorUserId: auditCtx.actorUserId,
        sessionId: auditCtx.sessionId,
        ip: auditCtx.ip,
        userAgent: auditCtx.userAgent,
      },
      policyConfig,
    });
    const gates = featureGates(decisionCtx, policyConfig);

    const consolidatedProfile = {
      id: user.id,
      email: user.email,
      username: user.username,
      phone: user.phone,
      countryIso2: user.countryIso2,
      userTier: (user as any).userTier || "CANDIDATE",
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,

      verification: {
        emailVerified: !!verification?.emailVerifiedAt,
        emailVerifiedAt: verification?.emailVerifiedAt,
        emailReverifyDueAt: verification?.emailReverifyDueAt,
        gracePeriodEndsAt: verification?.emailInitialDueAt ?? null,
        phoneVerified: !!verification?.smsVerifiedAt,
        phoneVerifiedAt: verification?.smsVerifiedAt,
        contenderTier: verification?.contenderTier || "NONE",
      },

      kyc: {
        status: kyc?.status || "NOT_STARTED",
        invitedAt: kyc?.invitedAt,
        submittedAt: kyc?.submittedAt,
        reviewedAt: kyc?.reviewedAt,
      },

      payout: {
        preferredPaymentCurrency: payout?.preferredPaymentCurrency,
      },

      settings: {
        defaultSymbol: settings?.defaultSymbol,
        defaultLotSize: settings?.defaultLotSize,
        defaultLeverage: settings?.defaultLeverage,
        defaultStopLoss: settings?.defaultStopLoss,
        defaultTakeProfit: settings?.defaultTakeProfit,
      },

      featureGates: {
        accountState: gates.accountState,
        contenderEligible: gates.contenderEligible,
        canTradeOpenOrIncrease: gates.canTradeOpenOrIncrease,
        canTradeCloseOrReduce: gates.canTradeCloseOrReduce,
        canStartSms: gates.canStartSms,
        canViewKyc: gates.canViewKyc,
        canSetPreferredPaymentCurrency: gates.canSetPreferredPaymentCurrency,
        canRequestPayout: gates.canRequestPayout,
      },
    };

    res.json(consolidatedProfile);
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

}
