import { Router } from 'express';
import { z } from 'zod';
import { db } from "@db";
import { systemConfig, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { resolveCaptchaRuntimeConfig } from "../security/captcha";
import { getClientIp, getUserAgent } from "../security/sessionTrail";
import { recordDoc1Acceptance } from "../legal/legalAcceptanceService";
import { clearDoc1ReacceptRequirement, computeDoc1ReacceptStatusWithTerms, upsertDoc1ReacceptRequirement } from "../legal/legalReacceptanceService";
import { assembleDoc1Terms } from '../legal/termsEngineDb';
import { checkCoverage } from '../legal/coverageGate';
import { requireAuth } from "../middleware/auth";

const router = Router();

function normalizeCountryIso2(raw: unknown): string | null {
  if (raw == null) return null;
  const v = String(raw).trim().toUpperCase();
  if (!v) return null;
  if (!/^[A-Z]{2}$/.test(v)) return null;
  return v;
}

router.get("/public-config", async (req, res) => {
  const [cfg] = await db
    .select({
      signupCaptchaEnforce: systemConfig.signupCaptchaEnforce,
      captchaProvider: systemConfig.captchaProvider,
      signupPhoneEnforce: systemConfig.signupPhoneEnforce,
      legalCoverageEnforce: systemConfig.legalCoverageEnforce,
    })
    .from(systemConfig)
    .where(eq(systemConfig.id, 1))
    .limit(1);
  const captcha = resolveCaptchaRuntimeConfig({
    signupCaptchaEnforce: cfg?.signupCaptchaEnforce,
    captchaProvider: cfg?.captchaProvider,
  });
  res.json({
    ok: true,
    captcha: {
      enforceSignupCaptcha: captcha.enforceSignupCaptcha,
      provider: captcha.effectiveProvider,
    },
    signupPhoneEnforce: Boolean(cfg?.signupPhoneEnforce ?? false),
    legalCoverageEnforce: Boolean(cfg?.legalCoverageEnforce ?? false),
  });
});

// GET /api/legal/doc1/reaccept
// Returns whether current user must re-accept the latest active terms, and includes the current terms payload.
router.get("/doc1/reaccept", requireAuth, async (req, res) => {
  const userId = Number(req.session.userId);
  try {
    const { status, assembled } = await computeDoc1ReacceptStatusWithTerms(userId);

    // Keep a durable record of the "required hash" so the UI can surface the state without recomputing on every poll.
    await upsertDoc1ReacceptRequirement({ userId, detectedBy: "STATUS", status });
    (req.session as any).legalReacceptRequired = Boolean(status.required || status.blocked);

    const terms =
      assembled && !assembled.blocked
        ? {
            countryIso2: assembled.meta.countryIso2,
            regionKey: assembled.meta.regionKey,
            combinedSha256: assembled.combined.sha256,
            token: assembled.token,
            text: assembled.combined.text,
            global: assembled.global,
            addendum: assembled.addendum,
            warnings: assembled.warnings,
          }
        : null;

    return res.json({
      ok: true,
      docSet: "DOC1",
      required: Boolean(status.required),
      blocked: Boolean(status.blocked),
      blockedReason: status.blockedReason,
      countryIso2: status.countryIso2,
      regionKey: status.regionKey,
      requiredCombinedSha256: status.requiredCombinedSha256,
      lastAcceptedCombinedSha256: status.lastAcceptedCombinedSha256,
      terms,
    });
  } catch (e: any) {
    console.error("[Legal] Failed to compute re-accept status:", e);
    return res.status(500).json({ ok: false, message: "LEGAL_REACCEPT_STATUS_FAILED" });
  }
});

// POST /api/legal/doc1/accept
// Records a new acceptance for the current user (used for re-acceptance flow).
router.post("/doc1/accept", requireAuth, async (req, res) => {
  const userId = Number(req.session.userId);

  try {
    const schema = z.object({
      termsToken: z.string().min(10),
      combinedSha256: z.string().min(10),
    });

    const { termsToken, combinedSha256 } = schema.parse(req.body || {});

    const [user] = await db
      .select({ email: users.email, countryIso2: users.countryIso2, country: users.country })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return res.status(401).json({ message: "User not found" });

    const countryIso2 =
      normalizeCountryIso2(user.countryIso2) ?? normalizeCountryIso2(user.country);
    if (!countryIso2) {
      return res.status(409).json({ message: "COUNTRY_REQUIRED" });
    }

    const assembled = await assembleDoc1Terms(countryIso2, { purpose: "LOGIN" });
    if (assembled.blocked) {
      const code = assembled.blockedReason || "LEGAL_COVERAGE_BLOCKED";
      return res.status(code === "JURISDICTION_RESTRICTED" ? 403 : 409).json({ message: code, code });
    }

    if (String(assembled.combined.sha256 || "") !== String(combinedSha256 || "")) {
      return res.status(409).json({
        message: "TERMS_CHANGED",
        currentCombinedSha256: assembled.combined.sha256,
      });
    }

    await recordDoc1Acceptance({
      userId,
      emailAtAcceptance: String(user.email),
      countryIso2,
      ipAddress: getClientIp(req) ?? null,
      userAgent: getUserAgent(req) ?? null,
      sessionId: req.sessionID ?? null,
      termsToken,
      combinedSha256,
    });

    await clearDoc1ReacceptRequirement(userId);
    (req.session as any).legalReacceptRequired = false;

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("[Legal] Failed to record re-acceptance:", e);
    return res.status(400).json({ ok: false, message: e?.message || "LEGAL_ACCEPT_FAILED" });
  }
});

router.get('/doc1/resolve', async (req, res) => {
  try {
    const schema = z.object({
      country: z.string().length(2).toUpperCase(),
    });
    
    const { country } = schema.parse({ country: req.query.country });
    const result = await assembleDoc1Terms(country, { purpose: "SIGNUP" });
    
    if (result.blocked) {
      return res.status(result.blockedReason === 'JURISDICTION_RESTRICTED' ? 403 : 409).json({
        success: false,
        error: result.blockedReason,
        restricted: result.blockedReason === 'JURISDICTION_RESTRICTED',
      });
    }
    
    res.json({
      success: true,
      countryCode: result.meta.countryIso2,
      regionKey: result.meta.regionKey,
      global: result.global,
      addendum: result.addendum,
      combinedSha256: result.combined.sha256,
      token: result.token,
      text: result.combined.text,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid country code' });
    }
    console.error('[Legal] Error resolving terms:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/doc1/availability', async (req, res) => {
  try {
    const schema = z.object({
      country: z.string().length(2).toUpperCase(),
    });
    
    const { country } = schema.parse({ country: req.query.country });
    const result = await checkCoverage(country);
    
    res.json({
      countryCode: country,
      termsExist: result.allowed || result.fallbackAvailable,
      signupAllowed: result.allowed,
      restricted: result.restricted,
      scopeKey: result.scopeKey,
      fallbackUsed: result.fallbackAvailable && !result.restricted,
      enforced: result.enforced,
      message: result.reason,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Invalid country code' });
    }
    console.error('[Legal] Error checking availability:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.get('/doc1/check', async (req, res) => {
  try {
    const countryIso2 = String(req.query.countryIso2 || req.query.country || "").trim().toUpperCase();

    if (!countryIso2 || countryIso2.length !== 2) {
      return res.status(400).json({
        ok: false,
        error: "countryIso2 must be 2-letter ISO code.",
      });
    }

    const assembled = await assembleDoc1Terms(countryIso2, { purpose: "SIGNUP" });

    if (assembled.blocked) {
      return res.json({
        ok: true,
        available: false,
        restricted: assembled.blockedReason === "JURISDICTION_RESTRICTED",
        reason: assembled.blockedReason,
        enforce: assembled.meta.enforce,
        countryIso2: assembled.meta.countryIso2,
        regionKey: assembled.meta.regionKey,
      });
    }

    return res.json({
      ok: true,
      available: true,
      restricted: false,
      enforce: assembled.meta.enforce,
      countryIso2: assembled.meta.countryIso2,
      regionKey: assembled.meta.regionKey,
      hasWarnings: assembled.warnings.length > 0,
    });
  } catch (error) {
    console.error('[Legal] Error checking terms:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

export default router;
