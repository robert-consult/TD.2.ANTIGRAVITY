/**
 * Legal DOC1 Resolve Router
 * Public endpoint for signup flow to resolve legal documents
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@db";
import { systemConfig } from "../../shared/schema";
import { assembleDoc1Terms } from "../legal/termsEngineDb";
import { getRestrictedCountryPolicy, isRestrictedCountry, getRegionForCountry } from "../legal/regionRules";

export const legalDoc1ResolveRouter = Router();

/**
 * GET /api/legal/doc1/resolve?countryIso2=KE
 * Resolves legal documents for signup flow
 */
legalDoc1ResolveRouter.get("/resolve", async (req, res) => {
  try {
    const countryIso2 = String(req.query.countryIso2 || "").trim().toUpperCase();
    const regionKeyOverride = req.query.regionKey != null ? String(req.query.regionKey).trim() : null;

    if (!countryIso2 || countryIso2.length !== 2) {
      return res.status(400).json({
        ok: false,
        error: "countryIso2 must be 2-letter ISO code.",
      });
    }

    // Check restricted first
    if (isRestrictedCountry(countryIso2)) {
      const { message } = getRestrictedCountryPolicy();
      return res.status(409).json({
        ok: false,
        code: "JURISDICTION_RESTRICTED",
        reason: message,
        countryIso2,
      });
    }

    const assembled = await assembleDoc1Terms(countryIso2, { purpose: "SIGNUP" });

    if (assembled.blocked) {
      return res.status(409).json({
        ok: false,
        code: "LEGAL_COVERAGE_BLOCKED",
        reason: assembled.blockedReason,
        enforce: assembled.meta.enforce,
        countryIso2: assembled.meta.countryIso2,
        regionKey: assembled.meta.regionKey,
        remediation:
          "Admin must set active targets (System Config → Legal Docs) for GLOBAL_MASTER DEFAULT/GLOBAL and resolved ADDENDUM target.",
      });
    }

    return res.json({
      ok: true,
      enforce: assembled.meta.enforce,
      countryIso2: assembled.meta.countryIso2,
      regionKey: assembled.meta.regionKey,
      current: {
        global: assembled.global
          ? {
              id: assembled.global.id,
              version: assembled.global.version,
              sha256: assembled.global.sha256,
              mode: assembled.global.mode,
            }
          : null,
        addendum: assembled.addendum
          ? {
              id: assembled.addendum.id,
              version: assembled.addendum.version,
              sha256: assembled.addendum.sha256,
              mode: assembled.addendum.mode,
              target: assembled.addendum.target,
            }
          : null,
        combinedSha256: assembled.combined.sha256,
      },
      docs: {
        combinedText: assembled.combined.text,
      },
      token: assembled.token,
      warnings: assembled.warnings,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Resolve failed." });
  }
});

/**
 * GET /api/legal/doc1/check?countryIso2=KE
 * Quick availability check (no document content)
 */
legalDoc1ResolveRouter.get("/check", async (req, res) => {
  try {
    const countryIso2 = String(req.query.countryIso2 || "").trim().toUpperCase();

    if (!countryIso2 || countryIso2.length !== 2) {
      return res.status(400).json({
        ok: false,
        error: "countryIso2 must be 2-letter ISO code.",
      });
    }

    if (isRestrictedCountry(countryIso2)) {
      const { message } = getRestrictedCountryPolicy();
      return res.json({
        ok: true,
        available: false,
        restricted: true,
        reason: "JURISDICTION_RESTRICTED",
        message,
        countryIso2,
      });
    }

    const assembled = await assembleDoc1Terms(countryIso2, { purpose: "SIGNUP" });

    if (assembled.blocked) {
      return res.json({
        ok: true,
        available: false,
        restricted: false,
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
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Check failed." });
  }
});
