/**
 * Admin System Config Router
 * Provides get/set endpoints for system configuration keys
 */

// @ts-nocheck
import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@db";
import { requireAdmin } from "../middleware/requireAdmin";
import { systemConfig, userSessions, users } from "../../shared/schema";
import { evaluateLoginJurisdiction } from "../policy/jurisdictionControl";
import { revokeSession } from "../security/sessionTrail";
import { invalidateJurisdictionRestrictionPolicyCache, parseRestrictedCountriesCsv } from "../legal/regionRules";

export const adminSystemConfigRouter = Router();
adminSystemConfigRouter.use(requireAdmin);

// GET /api/admin/system-config/legal-coverage
// Returns the current legal coverage enforcement state
adminSystemConfigRouter.get("/legal-coverage", (_req, res) => {
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    
    return res.json({
      ok: true,
      legalCoverageEnforce: !!config?.legalCoverageEnforce,
      updatedAt: config?.updatedAt || null,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// POST /api/admin/system-config/legal-coverage
// body: { enforce: boolean }
adminSystemConfigRouter.post("/legal-coverage", (req, res) => {
  try {
    const enforce = !!req.body?.enforce;
    const adminUserId = Number((req as any).user?.id || 0) || null;
    const now = new Date();

    db.update(systemConfig)
      .set({
        legalCoverageEnforce: enforce,
        updatedAt: now,
      })
      .where(eq(systemConfig.id, 1))
      .run();

    const updated = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();

    return res.json({
      ok: true,
      legalCoverageEnforce: !!updated?.legalCoverageEnforce,
      updatedAt: updated?.updatedAt || null,
      updatedByAdminId: adminUserId,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to set config." });
  }
});

// GET /api/admin/system-config/jurisdiction-restrictions
// Returns restricted ISO2 list + message
adminSystemConfigRouter.get("/jurisdiction-restrictions", (_req, res) => {
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get() as any;
    const restrictedCountriesCsv = String(config?.jurisdictionRestrictedIso2Csv ?? "KP,IR,CU,SY");
    const restrictedMessage = String(
      config?.jurisdictionRestrictedMessage ?? "This jurisdiction is not supported due to regulatory restrictions."
    );

    return res.json({
      ok: true,
      restrictedCountriesCsv,
      restrictedMessage,
      countries: parseRestrictedCountriesCsv(restrictedCountriesCsv),
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get restrictions." });
  }
});

// POST /api/admin/system-config/jurisdiction-restrictions
// body: { restrictedCountriesCsv: string; restrictedMessage: string }
adminSystemConfigRouter.post("/jurisdiction-restrictions", (req, res) => {
  try {
    const restrictedCountriesCsvRaw =
      typeof req.body?.restrictedCountriesCsv === "string" ? String(req.body.restrictedCountriesCsv) : "";
    const restrictedMessageRaw =
      typeof req.body?.restrictedMessage === "string" ? String(req.body.restrictedMessage) : "";

    const countries = parseRestrictedCountriesCsv(restrictedCountriesCsvRaw);
    const restrictedCountriesCsv = countries.join(",");
    const restrictedMessage =
      restrictedMessageRaw.trim() || "This jurisdiction is not supported due to regulatory restrictions.";

    db.update(systemConfig)
      .set({
        jurisdictionRestrictedIso2Csv: restrictedCountriesCsv,
        jurisdictionRestrictedMessage: restrictedMessage,
        updatedAt: new Date(),
      })
      .where(eq(systemConfig.id, 1))
      .run();

    const updated = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get() as any;

    try {
      invalidateJurisdictionRestrictionPolicyCache();
    } catch {}

    return res.json({
      ok: true,
      restrictedCountriesCsv: String(updated?.jurisdictionRestrictedIso2Csv ?? restrictedCountriesCsv),
      restrictedMessage: String(updated?.jurisdictionRestrictedMessage ?? restrictedMessage),
      countries: parseRestrictedCountriesCsv(String(updated?.jurisdictionRestrictedIso2Csv ?? restrictedCountriesCsv)),
      updatedAt: updated?.updatedAt || null,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to set restrictions." });
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
          revokeSession({
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
adminSystemConfigRouter.get("/all", (_req, res) => {
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    
    if (!config) {
      return res.json({ ok: true, config: null });
    }

    return res.json({
      ok: true,
      config: {
        maintenanceMode: config.maintenanceMode,
        tradingHalt: config.tradingHalt,
        closeOnlyMode: config.closeOnlyMode,
        blockOpenOnStaleQuotes: config.blockOpenOnStaleQuotes,
        maintenanceMessage: config.maintenanceMessage,
        quoteRefreshMs: config.quoteRefreshMs,
        feedPollMs: config.feedPollMs,
        staleThresholdMs: config.staleThresholdMs,
        legalCoverageEnforce: config.legalCoverageEnforce,
        policyContenderPath1MinAgeDays: config.policyContenderPath1MinAgeDays,
        policyContenderPath1MinTradesLifetime: config.policyContenderPath1MinTradesLifetime,
        policyContenderPath1MinBalancePct: config.policyContenderPath1MinBalancePct,
        policyContenderPath2MinAgeDays: config.policyContenderPath2MinAgeDays,
        policyContenderPath2MinTradesLast90: config.policyContenderPath2MinTradesLast90,
        policyContenderPath2MinReturnLast90: config.policyContenderPath2MinReturnLast90,
        policyContenderPath2MaxDaysSinceLastTrade: config.policyContenderPath2MaxDaysSinceLastTrade,
        policyAutoPromotePerformer: config.policyAutoPromotePerformer,
        policyEmailResendCooldownSec: config.policyEmailResendCooldownSec,
        policyEmailDailySendCap: config.policyEmailDailySendCap,
        policySmsDailySendCap: config.policySmsDailySendCap,
        policySmsResendCooldownSec: config.policySmsResendCooldownSec,
        policyOtpMaxAttempts: config.policyOtpMaxAttempts,
        policyOtpLockMinutes: config.policyOtpLockMinutes,
        updatedAt: config.updatedAt,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// GET /api/admin/system-config/policy
// Returns contender thresholds used for performer selection
adminSystemConfigRouter.get("/policy", (_req, res) => {
  try {
    const config = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();
    if (!config) {
      return res.json({ ok: true, config: null });
    }

    return res.json({
      ok: true,
      config: {
        policyContenderPath1MinAgeDays: config.policyContenderPath1MinAgeDays,
        policyContenderPath1MinTradesLifetime: config.policyContenderPath1MinTradesLifetime,
        policyContenderPath1MinBalancePct: config.policyContenderPath1MinBalancePct,
        policyContenderPath2MinAgeDays: config.policyContenderPath2MinAgeDays,
        policyContenderPath2MinTradesLast90: config.policyContenderPath2MinTradesLast90,
        policyContenderPath2MinReturnLast90: config.policyContenderPath2MinReturnLast90,
        policyContenderPath2MaxDaysSinceLastTrade: config.policyContenderPath2MaxDaysSinceLastTrade,
        policyAutoPromotePerformer: config.policyAutoPromotePerformer,
        policyEmailResendCooldownSec: config.policyEmailResendCooldownSec,
        policyEmailDailySendCap: config.policyEmailDailySendCap,
        policySmsDailySendCap: config.policySmsDailySendCap,
        policySmsResendCooldownSec: config.policySmsResendCooldownSec,
        policyOtpMaxAttempts: config.policyOtpMaxAttempts,
        policyOtpLockMinutes: config.policyOtpLockMinutes,
        updatedAt: config.updatedAt,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to get config." });
  }
});

// POST /api/admin/system-config/policy
// body: { policyContenderPath1MinAgeDays?, policyContenderPath1MinTradesLifetime?, ... }
adminSystemConfigRouter.post("/policy", (req, res) => {
  try {
    const body = req.body ?? {};
    const updates: any = {};

    if (body.policyContenderPath1MinAgeDays !== undefined) {
      updates.policyContenderPath1MinAgeDays = Number(body.policyContenderPath1MinAgeDays);
    }
    if (body.policyContenderPath1MinTradesLifetime !== undefined) {
      updates.policyContenderPath1MinTradesLifetime = Number(body.policyContenderPath1MinTradesLifetime);
    }
    if (body.policyContenderPath1MinBalancePct !== undefined) {
      updates.policyContenderPath1MinBalancePct = Number(body.policyContenderPath1MinBalancePct);
    }
    if (body.policyContenderPath2MinAgeDays !== undefined) {
      updates.policyContenderPath2MinAgeDays = Number(body.policyContenderPath2MinAgeDays);
    }
    if (body.policyContenderPath2MinTradesLast90 !== undefined) {
      updates.policyContenderPath2MinTradesLast90 = Number(body.policyContenderPath2MinTradesLast90);
    }
    if (body.policyContenderPath2MinReturnLast90 !== undefined) {
      updates.policyContenderPath2MinReturnLast90 = Number(body.policyContenderPath2MinReturnLast90);
    }
    if (body.policyContenderPath2MaxDaysSinceLastTrade !== undefined) {
      updates.policyContenderPath2MaxDaysSinceLastTrade = Number(body.policyContenderPath2MaxDaysSinceLastTrade);
    }
    if (body.policyAutoPromotePerformer !== undefined) {
      updates.policyAutoPromotePerformer = body.policyAutoPromotePerformer ? 1 : 0;
    }
    if (body.policyEmailResendCooldownSec !== undefined) {
      updates.policyEmailResendCooldownSec = Number(body.policyEmailResendCooldownSec);
    }
    if (body.policyEmailDailySendCap !== undefined) {
      updates.policyEmailDailySendCap = Number(body.policyEmailDailySendCap);
    }
    if (body.policySmsDailySendCap !== undefined) {
      updates.policySmsDailySendCap = Number(body.policySmsDailySendCap);
    }
    if (body.policySmsResendCooldownSec !== undefined) {
      updates.policySmsResendCooldownSec = Number(body.policySmsResendCooldownSec);
    }
    if (body.policyOtpMaxAttempts !== undefined) {
      updates.policyOtpMaxAttempts = Number(body.policyOtpMaxAttempts);
    }
    if (body.policyOtpLockMinutes !== undefined) {
      updates.policyOtpLockMinutes = Number(body.policyOtpLockMinutes);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: "No policy config updates provided." });
    }

    updates.updatedAt = new Date();

    db.update(systemConfig)
      .set(updates)
      .where(eq(systemConfig.id, 1))
      .run();

    const updated = db.select().from(systemConfig).where(eq(systemConfig.id, 1)).get();

    return res.json({
      ok: true,
      config: {
        policyContenderPath1MinAgeDays: updated?.policyContenderPath1MinAgeDays,
        policyContenderPath1MinTradesLifetime: updated?.policyContenderPath1MinTradesLifetime,
        policyContenderPath1MinBalancePct: updated?.policyContenderPath1MinBalancePct,
        policyContenderPath2MinAgeDays: updated?.policyContenderPath2MinAgeDays,
        policyContenderPath2MinTradesLast90: updated?.policyContenderPath2MinTradesLast90,
        policyContenderPath2MinReturnLast90: updated?.policyContenderPath2MinReturnLast90,
        policyContenderPath2MaxDaysSinceLastTrade: updated?.policyContenderPath2MaxDaysSinceLastTrade,
        policyAutoPromotePerformer: updated?.policyAutoPromotePerformer,
        policyEmailResendCooldownSec: updated?.policyEmailResendCooldownSec,
        policyEmailDailySendCap: updated?.policyEmailDailySendCap,
        policySmsDailySendCap: updated?.policySmsDailySendCap,
        policySmsResendCooldownSec: updated?.policySmsResendCooldownSec,
        policyOtpMaxAttempts: updated?.policyOtpMaxAttempts,
        policyOtpLockMinutes: updated?.policyOtpLockMinutes,
        updatedAt: updated?.updatedAt || null,
      },
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Failed to set policy config." });
  }
});
