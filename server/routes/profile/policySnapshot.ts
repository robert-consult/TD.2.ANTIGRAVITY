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

export function registerPolicySnapshotRoute(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/policy/snapshot", ensureAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const auditCtx = buildAuditContext(req);
    const policyConfig = await loadPolicyConfig();
    const ctx = await buildDecisionContext({
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

    const promotion = await promotePerformerIfEligible({
      ctx,
      policyConfig,
      correlationId: auditCtx.correlationId,
      actorType: auditCtx.actorType,
      actorUserId: auditCtx.actorUserId,
      sessionId: auditCtx.sessionId,
      ip: auditCtx.ip,
      userAgent: auditCtx.userAgent,
    });
    if (promotion.promoted) {
      ctx.user.userTier = "PERFORMER";
    }
    if (promotion.eligible && (ctx.user.contenderTier === "NONE" || ctx.user.contenderTier === "CANDIDATE_EMAIL_ONLY")) {
      ctx.user.contenderTier = "CANDIDATE_SMS_REQUIRED";
    }

    const baseDecision = decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig);
    const derived = baseDecision.derived ?? null;

    res.json({
      derived,
      user: {
        userTier: ctx.user.userTier,
        contenderTier: ctx.user.contenderTier,
        emailVerifiedAt: ctx.user.emailVerifiedAt?.toISOString() ?? null,
        emailReverifyDueAt: ctx.user.emailReverifyDueAt?.toISOString() ?? null,
        emailInitialDueAt: ctx.user.emailInitialDueAt?.toISOString() ?? null,
        phoneVerifiedAt: ctx.user.phoneVerifiedAt?.toISOString() ?? null,
        selectedAt: ctx.user.selectedAt?.toISOString() ?? null,
      },
      features: {
        canSendEmailVerification: decidePolicy("EMAIL_RESEND_VERIFICATION", ctx, policyConfig).allowed,
        canStartSms: decidePolicy("PHONE_VERIFY_START", ctx, policyConfig).allowed,
        canConfirmSms: decidePolicy("PHONE_VERIFY_CONFIRM", ctx, policyConfig).allowed,
        canViewKyc: decidePolicy("KYC_VIEW", ctx, policyConfig).allowed,
        canSubmitKyc: decidePolicy("KYC_SUBMIT", ctx, policyConfig).allowed,
        canSetPreferredPaymentCurrency: decidePolicy("PREFERRED_PAYMENT_CURRENCY_SET", ctx, policyConfig).allowed,
        canRequestPayout: decidePolicy("PAYOUT_REQUEST", ctx, policyConfig).allowed,
        canTradeOpenOrIncrease: decidePolicy("TRADE_OPEN_OR_INCREASE", ctx, policyConfig).allowed,
        canTradeCloseOrReduce: decidePolicy("TRADE_CLOSE_OR_REDUCE", ctx, policyConfig).allowed,
        canTradeCancelPending: decidePolicy("TRADE_CANCEL_PENDING", ctx, policyConfig).allowed,
        canTradeModifySltp: decidePolicy("TRADE_MODIFY_SLTP", ctx, policyConfig).allowed,
      },
      contenderCriteria: {
        path1: {
          minAgeDays: policyConfig.contenderMinAgeDays,
          minBalanceMultiplier: policyConfig.contenderMinBalancePct,
          minTradesLifetime: policyConfig.contenderMinTradesLifetime,
        },
        path2: {
          minAgeDays: policyConfig.contenderPath2MinAgeDays,
          minReturnPct: policyConfig.contenderPath2MinReturnLast90,
          minTradesWindow: policyConfig.contenderPath2MinTradesLast90,
          maxDaysSinceLastTrade: policyConfig.contenderPath2MaxDaysSinceLastTrade,
        },
      },
      correlationId: auditCtx.correlationId,
    });
  } catch (error) {
    console.error("Policy snapshot error:", error);
    res.status(500).json({ message: "Failed to fetch policy snapshot" });
  }
});

}
