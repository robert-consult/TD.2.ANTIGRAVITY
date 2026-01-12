import type { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { buildGeoContext, getClientIp, revokeSession } from "../security/sessionTrail";
import { evaluateLoginJurisdiction } from "../policy/jurisdictionControl";
import { getJurisdictionRestrictionPolicy } from "../legal/regionRules";

function readHeaderIso2(req: Request): string | undefined {
  const raw =
    req.get("cf-ipcountry") ||
    req.get("x-vercel-ip-country") ||
    req.get("x-appengine-country") ||
    "";

  const v = String(raw).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : undefined;
}

/**
 * Applies jurisdiction login restrictions to already-authenticated sessions.
 * If admin toggles blocking after a user is logged in, this will terminate them on next API call.
 */
export async function jurisdictionSessionGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const sess: any = req.session;

    // Only applies to authenticated sessions
    if (!sess?.userId) return next();

    // Always allow exiting impersonation even if the impersonated user is blocked
    if (req.path === "/admin/view-as/stop") return next();

    // Do not block real admin sessions (but impersonation sessions have isAdmin=false already)
    if (sess.isAdmin && !sess.isImpersonating) return next();

    const policy = getJurisdictionRestrictionPolicy();
    if (!policy.jurisdictionBlockLogin) return next();

    // Resolve user country if needed
    let userCountryIso2: string | undefined =
      typeof sess.userCountryIso2 === "string" ? String(sess.userCountryIso2).trim().toUpperCase() : undefined;

    if (policy.jurisdictionEnforceBySignupCountry && !userCountryIso2) {
      const [row] = await db
        .select({ countryIso2: users.countryIso2, country: users.country })
        .from(users)
        .where(eq(users.id, Number(sess.userId)))
        .limit(1);

      userCountryIso2 = row?.countryIso2
        ? String(row.countryIso2).trim().toUpperCase()
        : row?.country && String(row.country).trim().length === 2
          ? String(row.country).trim().toUpperCase()
          : undefined;

      sess.userCountryIso2 = userCountryIso2;
    }

    // Resolve IP country if needed
    let ipCountryIso2: string | undefined =
      typeof sess.ipCountryIso2 === "string" ? String(sess.ipCountryIso2).trim().toUpperCase() : undefined;

    if (policy.jurisdictionEnforceByIpGeo) {
      ipCountryIso2 =
        readHeaderIso2(req) ??
        (() => {
          const ip = getClientIp(req);
          const geo = buildGeoContext(ip);
          return geo.countryCode ? String(geo.countryCode).trim().toUpperCase() : undefined;
        })();

      sess.ipCountryIso2 = ipCountryIso2;
    }

    const decision = evaluateLoginJurisdiction({
      ipCountryIso2,
      userCountryIso2,
    });

    if (decision.allowed) return next();

    // Revoke session in user_sessions (best-effort) + destroy cookie session
    try {
      await revokeSession({
        actorUserId: 0,
        targetUserId: Number(sess.userId),
        sessionId: req.sessionID,
        reason: decision.reasonCode,
      });
    } catch {}

    try {
      req.session.destroy(() => {});
    } catch {}

    return res.status(decision.httpStatus).json({
      message: decision.message,
      code: decision.code,
      reasonCode: decision.reasonCode,
      blockedBy: decision.blockedBy,
      ipCountryIso2: decision.ipCountryIso2 ?? null,
      userCountryIso2: decision.selectedCountryIso2 ?? null,
    });
  } catch (e) {
    console.error("[Jurisdiction] session guard error:", e);
    return next(); // fail-open for middleware errors only (policy eval itself fails closed at login/signup)
  }
}
