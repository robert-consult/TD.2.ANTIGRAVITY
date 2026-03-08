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

function toIsoString(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

export function registerKycRoutes(router: Router, deps: ProfileRouterDeps) {
  const { ensureAuth, sessionCookieName } = deps;
  const SESSION_COOKIE_NAME = sessionCookieName;
router.get("/api/profile/kyc", ensureAuth, requirePolicy("KYC_VIEW"), async (req: Request, res: Response) => {
  try {
    const kycProfile = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, req.session.userId!),
    });

    if (!kycProfile) {
      return res.json({
        status: "NOT_STARTED",
        invitedAt: null,
        submittedAt: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    }

    res.json({
      status: kycProfile.status,
      invitedAt: toIsoString(kycProfile.invitedAt),
      submittedAt: toIsoString(kycProfile.submittedAt),
      reviewedAt: toIsoString(kycProfile.reviewedAt),
      rejectionReason: kycProfile.rejectionReason,
    });
  } catch (error) {
    console.error("Get KYC profile error:", error);
    res.status(500).json({ message: "Failed to fetch KYC profile" });
  }
});

// Submit KYC documents for current user
router.post("/api/profile/kyc/submit", ensureAuth, requirePolicy("KYC_SUBMIT"), async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const {
      documentType,
      documentNumber,
      legalFirstName,
      legalLastName,
      dob,
      addressLine1,
      addressLine2,
      city,
      region,
      postalCode,
      country,
      idDocumentRef,
      documentData,
    } = req.body ?? {};

    if (!documentType || typeof documentType !== "string") {
      return res.status(400).json({ message: "Document type is required" });
    }

    const missing: string[] = [];
    if (!legalFirstName) missing.push("legalFirstName");
    if (!legalLastName) missing.push("legalLastName");
    if (!dob) missing.push("dob");
    if (!addressLine1) missing.push("addressLine1");
    if (!city) missing.push("city");
    if (!country) missing.push("country");

    if (missing.length) {
      return res.status(400).json({ message: `Missing required KYC fields: ${missing.join(", ")}` });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const kycProfile = await db.query.userKycProfiles.findFirst({
      where: eq(userKycProfiles.userId, userId),
    });

    if (!kycProfile) {
      return res.status(400).json({ message: "You must be invited for KYC verification first" });
    }

    if (kycProfile.status !== "INVITED" && kycProfile.status !== "REJECTED") {
      return res.status(400).json({
        message: `Cannot submit KYC with current status: ${kycProfile.status}`
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    await db.update(userKycProfiles)
      .set({
        status: "SUBMITTED",
        documentType,
        documentNumber: documentNumber || null,
        legalFirstName: legalFirstName || null,
        legalLastName: legalLastName || null,
        dob: dob || null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        region: region || null,
        postalCode: postalCode || null,
        country: country || null,
        idDocumentRef: idDocumentRef || documentData || null,
        submittedAt: nowSec,
        updatedAt: nowSec,
      })
      .where(eq(userKycProfiles.userId, userId));

    appendIdentityAudit({
      userId,
      email: user.email,
      category: "KYC",
      type: "KYC_SUBMITTED",
      title: "KYC documents submitted",
      description: `Document type: ${documentType}`,
      ip: req.ip || (req.headers["x-forwarded-for"] as string),
      userAgent: req.headers["user-agent"],
    });

    res.json({ success: true, message: "KYC documents submitted for review" });
  } catch (error) {
    console.error("KYC submit error:", error);
    res.status(500).json({ message: "Failed to submit KYC documents" });
  }
});

}
