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

export function registerPreferencesRoutes(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.put("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
  console.log(`[Preferences] PUT /api/profile/preferences called by user ${req.session.userId}, body:`, JSON.stringify(req.body));
  try {
    const preferencesSchema = z.object({
      timezone: z.string().max(50).optional(),
      language: z.string().max(10).optional(),
      country: z.string().max(50).optional(),
    });

    const validationResult = preferencesSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        message: validationResult.error.errors[0]?.message || "Invalid input"
      });
    }

    const { timezone, language, country } = validationResult.data;

    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Policy: admin controls timezone editability
    const [cfg] = await db
      .select({ allowUserTimezoneEdit: systemConfig.allowUserTimezoneEdit })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;

    const updateData: Record<string, string> = {};
    let didUpdate = false;

    // Language always editable
    if (language !== undefined) {
      const normalized = normalizeLanguagePreference(language);
      if (!normalized.matched) {
        return res.status(400).json({ message: "Unsupported language" });
      }
      updateData.language = normalized.normalized;
      didUpdate = true;
      console.log(`[Preferences] User ${req.session.userId} updating language to: ${updateData.language}`);
    }

    // Timezone editable only if policy allows it
    if (timezone !== undefined && allowUserTimezoneEdit) {
      updateData.timezone = timezone;
      didUpdate = true;
    }

    // Country: set-once only (immutable after first set)
    if (country !== undefined) {
      const normalized = String(country).trim().toUpperCase();
      if (normalized) {
        const existingRaw = (user as any).countryIso2 || (user as any).country;
        const existing = existingRaw ? String(existingRaw).trim().toUpperCase() : "";

        // If already set and differs -> reject
        if (existing && normalized !== existing) {
          return res.status(409).json({ message: "Country is locked and cannot be changed." });
        }

        // If not set yet -> allow one-time set (and also set countryIso2)
        if (!existing) {
          if (!/^[A-Z]{2}$/.test(normalized)) {
            return res.status(400).json({ message: "Invalid country code (expected ISO2)." });
          }
          await storage.updateUser(user.id, { countryIso2: normalized, country: normalized });
          didUpdate = true;
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      console.log(`[Preferences] Saving preferences for user ${req.session.userId}:`, updateData);
      await storage.updateUserPreferences(req.session.userId!, updateData);
      console.log(`[Preferences] Successfully saved preferences for user ${req.session.userId}`);
      didUpdate = true;
    }

    if (!didUpdate) {
      return res.status(400).json({ message: "No preferences to update" });
    }

    res.json({ message: "Preferences updated successfully" });
  } catch (error) {
    console.error("Update preferences error:", error);
    res.status(500).json({ message: "Failed to update preferences" });
  }
});

// Get user preferences + policy flags
router.get("/api/profile/preferences", ensureAuth, async (req: Request, res: Response) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [cfg] = await db
      .select({ allowUserTimezoneEdit: systemConfig.allowUserTimezoneEdit })
      .from(systemConfig)
      .where(eq(systemConfig.id, 1))
      .limit(1);
    const allowUserTimezoneEdit = cfg ? Boolean((cfg as any).allowUserTimezoneEdit ?? true) : true;
    const countryRaw = (user as any).countryIso2 || (user as any).country || null;
    const countryIso2 = countryRaw ? String(countryRaw).trim().toUpperCase() : null;

    res.json({
      timezone: (user as any).timezone || "UTC",
      language: (user as any).language || "en",
      country: countryIso2,
      countryLocked: Boolean(countryIso2),
      timezoneEditable: allowUserTimezoneEdit,
    });
  } catch (error) {
    console.error("Get preferences error:", error);
    res.status(500).json({ message: "Failed to fetch preferences" });
  }
});

}
