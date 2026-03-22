/**
 * Admin System Config Router
 * Provides get/set endpoints for system configuration keys
 */

import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@db";
import { requireAdmin } from "../middleware/requireAdmin";
import { userSessions, users } from "../../shared/schema";
import { evaluateLoginJurisdiction } from "../policy/jurisdictionControl";
import { revokeSession } from "../security/sessionTrail";
import { parseRestrictedCountriesCsv } from "../legal/regionRules";
import {
  buildSystemConfigMutationActor,
  buildSystemConfigAllSnapshot,
  buildSystemConfigJurisdictionRestrictionsSnapshot,
  buildSystemConfigLegalCoverageSnapshot,
  buildSystemConfigPolicySnapshot,
  ensureSystemConfigRow,
  isSystemConfigConflictError,
  isSystemConfigValidationError,
  updateSystemConfigJurisdictionRestrictions,
  updateSystemConfigLegalCoverage,
  updateSystemConfigPolicy,
} from "../services/systemConfig";

export const adminSystemConfigRouter = Router();
adminSystemConfigRouter.use(requireAdmin);

function respondMutationError(res: any, error: unknown, fallback: string) {
  if (isSystemConfigValidationError(error)) {
    return res.status(400).json({ ok: false, error: error.message });
  }
  if (isSystemConfigConflictError(error)) {
    return res.status(409).json({
      ok: false,
      error: error.message,
      currentUpdatedAt: error.currentUpdatedAt,
    });
  }
  return res.status(400).json({ ok: false, error: (error as any)?.message || fallback });
}

// GET /api/admin/system-config/legal-coverage
// Returns the current legal coverage enforcement state
adminSystemConfigRouter.get("/legal-coverage", async (_req, res) => {
  try {
    const config = await ensureSystemConfigRow();
    const snapshot = buildSystemConfigLegalCoverageSnapshot(config);
    
    return res.json({
      ok: true,
      legalCoverageEnforce: snapshot.legalCoverageEnforce,
      updatedAt: snapshot.updatedAt,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// POST /api/admin/system-config/legal-coverage
// body: { enforce: boolean }
adminSystemConfigRouter.post("/legal-coverage", async (req, res) => {
  try {
    const actor = buildSystemConfigMutationActor(req);
    const result = await updateSystemConfigLegalCoverage({
      actor,
      enforce: req.body?.enforce,
    });

    return res.json({
      ok: true,
      legalCoverageEnforce: result.snapshot.legalCoverageEnforce,
      updatedAt: result.snapshot.updatedAt,
      updatedByAdminId: actor.adminUserId,
    });
  } catch (error) {
    return respondMutationError(res, error, "Failed to set config.");
  }
});

// GET /api/admin/system-config/jurisdiction-restrictions
// Returns restricted ISO2 list + message
adminSystemConfigRouter.get("/jurisdiction-restrictions", async (_req, res) => {
  try {
    const config = await ensureSystemConfigRow();
    const snapshot = buildSystemConfigJurisdictionRestrictionsSnapshot(config);

    return res.json({
      ok: true,
      restrictedCountriesCsv: snapshot.restrictedCountriesCsv,
      restrictedMessage: snapshot.restrictedMessage,
      countries: parseRestrictedCountriesCsv(snapshot.restrictedCountriesCsv),
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get restrictions." });
  }
});

// POST /api/admin/system-config/jurisdiction-restrictions
// body: { restrictedCountriesCsv: string; restrictedMessage: string }
adminSystemConfigRouter.post("/jurisdiction-restrictions", async (req, res) => {
  try {
    const result = await updateSystemConfigJurisdictionRestrictions({
      actor: buildSystemConfigMutationActor(req),
      bodyRaw: req.body,
    });

    return res.json({
      ok: true,
      restrictedCountriesCsv: result.snapshot.restrictedCountriesCsv,
      restrictedMessage: result.snapshot.restrictedMessage,
      countries: parseRestrictedCountriesCsv(result.snapshot.restrictedCountriesCsv),
      updatedAt: typeof result.updated.updatedAt === "number" ? result.updated.updatedAt : null,
    });
  } catch (error) {
    return respondMutationError(res, error, "Failed to set restrictions.");
  }
});

// POST /api/admin/system-config/jurisdiction-enforcement/revoke-active
// Revokes all currently-active sessions whose session geo or user-selected country is now restricted.
// This forces logout without waiting for the user's next API call.
adminSystemConfigRouter.post("/jurisdiction-enforcement/revoke-active", async (req, res) => {
  try {
    const adminUserId = Number(req.session?.userId || 0);

    const rows = await db
      .select({
        sessionId: userSessions.sessionId,
        userId: userSessions.userId,
        sessionCountry: userSessions.countryCode,
        userCountryIso2: users.countryIso2,
        userCountryLegacy: users.country,
        isAdmin: users.isAdmin,
      })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(and(isNull(userSessions.revokedAt as any)));

    let revoked = 0;

    for (const r of rows as any[]) {
      if (r.isAdmin) continue;

      const userCountryIso2 =
        r.userCountryIso2 && String(r.userCountryIso2).trim().length === 2
          ? String(r.userCountryIso2).trim().toUpperCase()
          : r.userCountryLegacy && String(r.userCountryLegacy).trim().length === 2
            ? String(r.userCountryLegacy).trim().toUpperCase()
            : null;

      const decision = evaluateLoginJurisdiction({
        ipCountryIso2: r.sessionCountry ?? null,
        userCountryIso2,
      });

      if (!decision.allowed) {
        try {
          await revokeSession({
            actorUserId: adminUserId,
            targetUserId: Number(r.userId),
            sessionId: String(r.sessionId),
            reason: decision.reasonCode,
          });
          revoked++;
        } catch (e) {
          // ignore individual revoke failure
        }
      }
    }

    return res.json({ ok: true, revoked, scanned: rows.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

// GET /api/admin/system-config/all
// Returns all system config values
adminSystemConfigRouter.get("/all", async (_req, res) => {
  try {
    const config = await ensureSystemConfigRow();

    return res.json({
      ok: true,
      config: buildSystemConfigAllSnapshot(config),
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// GET /api/admin/system-config/policy
// Returns contender thresholds used for performer selection
adminSystemConfigRouter.get("/policy", async (_req, res) => {
  try {
    const config = await ensureSystemConfigRow();

    return res.json({
      ok: true,
      config: buildSystemConfigPolicySnapshot(config),
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// POST /api/admin/system-config/policy
// body: { policyContenderPath1MinAgeDays?, policyContenderPath1MinTradesLifetime?, ... }
adminSystemConfigRouter.post("/policy", async (req, res) => {
  try {
    const result = await updateSystemConfigPolicy({
      actor: buildSystemConfigMutationActor(req),
      bodyRaw: req.body,
    });

    return res.json({
      ok: true,
      config: result.snapshot,
    });
  } catch (error) {
    return respondMutationError(res, error, "Failed to set policy config.");
  }
});
