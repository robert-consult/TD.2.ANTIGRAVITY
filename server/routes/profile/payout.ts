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

export function registerPayoutRoutes(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
  const payoutCurrencies = ["USD", "EUR", "GBP", "CHF", "JPY"] as const;
router.get("/api/profile/payout", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    const defaultCurrency = defaultPaymentCurrencyForCountry({
      countryIso2: (user as any)?.countryIso2 ?? (user as any)?.country ?? null,
      regionKey: (user as any)?.regionKey ?? null,
    });

    const payoutProfile = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, req.session.userId!),
    });

    if (!payoutProfile) {
      return res.json({
        preferredPaymentCurrency: defaultCurrency,
        payoutMethod: null,
        isVerified: false,
      });
    }

    res.json({
      preferredPaymentCurrency: payoutProfile.preferredPaymentCurrency || defaultCurrency,
      payoutMethod: payoutProfile.payoutMethod,
      isVerified: payoutProfile.isVerified,
    });
  } catch (error) {
    console.error("Get payout profile error:", error);
    res.status(500).json({ message: "Failed to fetch payout profile" });
  }
});

// Update payout currency preference
router.put("/api/profile/payout/currency", ensureAuth, requirePolicy("PREFERRED_PAYMENT_CURRENCY_SET"), async (req: Request, res: Response) => {
  try {
    const payoutCurrencySchema = z.object({
      currency: z.enum(payoutCurrencies, {
        message: "Invalid currency. Must be USD, EUR, GBP, CHF, or JPY",
      }),
    });

    const validationResult = payoutCurrencySchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({ message: validationResult.error.issues[0]?.message || "Invalid input" });
    }

    const { currency } = validationResult.data;

    const existing = await db.query.userPayoutProfiles.findFirst({
      where: eq(userPayoutProfiles.userId, req.session.userId!),
    });

    if (existing) {
      await db.update(userPayoutProfiles)
        .set({
          preferredPaymentCurrency: currency,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(userPayoutProfiles.userId, req.session.userId!));
    } else {
      await db.insert(userPayoutProfiles).values({
        userId: req.session.userId!,
        preferredPaymentCurrency: currency,
      });
    }

    res.json({ message: "Currency preference updated" });
  } catch (error) {
    console.error("Update payout currency error:", error);
    res.status(500).json({ message: "Failed to update currency preference" });
  }
});

}
