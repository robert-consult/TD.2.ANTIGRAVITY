import { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { userSessions, users } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  buildGeoContext,
  createUserSession,
  extractClientIdentity,
  extractGeoHints,
  getClientIp,
  getUserAgent,
  recordLoginAttempt,
  revokeAllSessionsForUser,
  touchSession,
} from "../security/sessionTrail";
import { getTrustedProxyCountryIso2 } from "../security/proxyHeaders";
import {
  buildRememberMeCookieOptions,
  clearRememberMeCookie,
  getRememberMeConfig,
  readRememberMeCookie,
  REMEMBER_ME_COOKIE_NAME,
  revokeAllRememberMeTokensForUser,
  revokeRememberMeTokenById,
  rotateRememberMeToken,
  touchRememberMeToken,
  verifyRememberMeToken,
} from "../services/rememberMe";

function normalizeIso2(value: unknown): string | undefined {
  const raw = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : undefined;
}

type RememberMeMissRateEntry = {
  count: number;
  resetAtMs: number;
};

const REMEMBER_ME_NOT_FOUND_RATE_WINDOW_MS = 10 * 60 * 1000;
const REMEMBER_ME_NOT_FOUND_RATE_LIMIT = 20;
const rememberMeNotFoundRateByIp = new Map<string, RememberMeMissRateEntry>();

function normalizeRateIp(ip: string): string {
  const normalized = String(ip || "").trim();
  return normalized.length > 0 ? normalized : "0.0.0.0";
}

function getRememberMeNotFoundRateState(ip: string): RememberMeMissRateEntry {
  const nowMs = Date.now();
  const key = normalizeRateIp(ip);
  const existing = rememberMeNotFoundRateByIp.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    const next: RememberMeMissRateEntry = {
      count: 0,
      resetAtMs: nowMs + REMEMBER_ME_NOT_FOUND_RATE_WINDOW_MS,
    };
    rememberMeNotFoundRateByIp.set(key, next);
    return next;
  }
  return existing;
}

function getRememberMeNotFoundRateStatus(ip: string): { blocked: boolean; retryAfterSec: number } {
  const state = getRememberMeNotFoundRateState(ip);
  if (state.count <= REMEMBER_ME_NOT_FOUND_RATE_LIMIT) {
    return { blocked: false, retryAfterSec: 0 };
  }
  const retryAfterSec = Math.max(1, Math.ceil((state.resetAtMs - Date.now()) / 1000));
  return { blocked: true, retryAfterSec };
}

function recordRememberMeTokenNotFound(ip: string): {
  blocked: boolean;
  retryAfterSec: number;
  newlyLimited: boolean;
} {
  const state = getRememberMeNotFoundRateState(ip);
  state.count += 1;
  const blocked = state.count > REMEMBER_ME_NOT_FOUND_RATE_LIMIT;
  const retryAfterSec = blocked ? Math.max(1, Math.ceil((state.resetAtMs - Date.now()) / 1000)) : 0;
  return {
    blocked,
    retryAfterSec,
    newlyLimited: state.count === REMEMBER_ME_NOT_FOUND_RATE_LIMIT + 1,
  };
}

function clearRememberMeNotFoundRate(ip: string): void {
  rememberMeNotFoundRateByIp.delete(normalizeRateIp(ip));
}

const rememberMeNotFoundRateCleanupTimer = setInterval(() => {
  const nowMs = Date.now();
  for (const [ip, state] of rememberMeNotFoundRateByIp.entries()) {
    if (state.resetAtMs <= nowMs) {
      rememberMeNotFoundRateByIp.delete(ip);
    }
  }
}, 2 * 60 * 1000);
rememberMeNotFoundRateCleanupTimer.unref?.();

async function tryRestoreSessionFromRememberMe(
  req: Request,
  res: Response,
): Promise<"restored" | "none" | "responded"> {
  const cookieValue = readRememberMeCookie(req);
  if (!cookieValue) return "none";

  const config = await getRememberMeConfig();
  if (!config.enabled) {
    clearRememberMeCookie(res);
    return "none";
  }

  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);
  const identity = extractClientIdentity(req);
  const geo = buildGeoContext(ip, extractGeoHints(req));

  const precheck = getRememberMeNotFoundRateStatus(ip);
  if (precheck.blocked) {
    clearRememberMeCookie(res);
    res.setHeader("Retry-After", String(precheck.retryAfterSec));
    res.status(429).json({
      message: "Too many invalid persistent login attempts. Please log in again.",
      code: "REMEMBER_ME_SELECTOR_RATE_LIMITED",
      retryAfterSec: precheck.retryAfterSec,
    });
    return "responded";
  }

  const result = await verifyRememberMeToken(cookieValue, config);

  if (result.status === "NOT_FOUND") {
    const miss = recordRememberMeTokenNotFound(ip);
    clearRememberMeCookie(res);

    if (miss.blocked) {
      if (miss.newlyLimited) {
        await recordLoginAttempt({
          email: "",
          ip,
          userAgent,
          success: false,
          failureReason: "REMEMBER_ME_SELECTOR_RATE_LIMITED",
          identity,
          geo,
          eventType: "REMEMBER_ME_SELECTOR_RATE_LIMITED",
        });
      }

      res.setHeader("Retry-After", String(miss.retryAfterSec));
      res.status(429).json({
        message: "Too many invalid persistent login attempts. Please log in again.",
        code: "REMEMBER_ME_SELECTOR_RATE_LIMITED",
        retryAfterSec: miss.retryAfterSec,
      });
      return "responded";
    }
    return "none";
  }

  if (result.status !== "MALFORMED") {
    clearRememberMeNotFoundRate(ip);
  }

  if (result.status === "MALFORMED" || result.status === "EXPIRED") {
    clearRememberMeCookie(res);
    return "none";
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      isAdmin: users.isAdmin,
      isDeleted: users.isDeleted,
      isDisabled: users.isDisabled,
      isFrozen: users.isFrozen,
      countryIso2: users.countryIso2,
      country: users.country,
    })
    .from(users)
    .where(eq(users.id, result.userId))
    .limit(1);

  if (result.status === "THEFT_DETECTED") {
    if (config.theftAutoRevokeAll) {
      await revokeAllRememberMeTokensForUser(result.userId);
      await revokeAllSessionsForUser({
        actorUserId: result.userId,
        targetUserId: result.userId,
        reason: "TOKEN_THEFT_DETECTED",
      });
    } else {
      await revokeRememberMeTokenById(result.token.id, result.userId);
    }

    await recordLoginAttempt({
      userId: result.userId,
      email: user?.email || "",
      ip,
      userAgent,
      success: false,
      failureReason: "TOKEN_THEFT_DETECTED",
      identity,
      geo,
      eventType: "TOKEN_THEFT_DETECTED",
    });

    clearRememberMeCookie(res);
    res.status(401).json({
      message: "Security alert: session terminated",
      code: "TOKEN_THEFT_DETECTED",
    });
    return "responded";
  }

  if (result.status === "ABSENCE_REAUTH_REQUIRED") {
    await revokeRememberMeTokenById(result.token.id, result.userId);
    await recordLoginAttempt({
      userId: result.userId,
      email: user?.email || "",
      ip,
      userAgent,
      success: false,
      failureReason: "ABSENCE_REAUTH_REQUIRED",
      identity,
      geo,
      eventType: "ABSENCE_REAUTH_REQUIRED",
    });

    clearRememberMeCookie(res);
    res.status(401).json({
      message: "Please log in again — it's been a while",
      code: "ABSENCE_REAUTH_REQUIRED",
    });
    return "responded";
  }

  if (!user) {
    await revokeRememberMeTokenById(result.token.id, result.userId);
    clearRememberMeCookie(res);
    return "none";
  }

  if (user.isDeleted) {
    await revokeAllRememberMeTokensForUser(user.id);
    clearRememberMeCookie(res);
    res.status(403).json({ message: "Account has been deleted", code: "ACCOUNT_DELETED" });
    return "responded";
  }
  if (user.isDisabled) {
    await revokeAllRememberMeTokensForUser(user.id);
    clearRememberMeCookie(res);
    res.status(403).json({ message: "Account is disabled", code: "ACCOUNT_DISABLED" });
    return "responded";
  }
  if (user.isFrozen) {
    await revokeAllRememberMeTokensForUser(user.id);
    clearRememberMeCookie(res);
    res.status(403).json({ message: "Account is frozen", code: "ACCOUNT_FROZEN" });
    return "responded";
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      return resolve();
    });
  });

  const ipCountryIso2 =
    getTrustedProxyCountryIso2(req) ?? (geo.countryCode ? String(geo.countryCode).toUpperCase() : undefined);
  const userCountryIso2 = normalizeIso2(user.countryIso2) ?? normalizeIso2(user.country);

  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.isAdmin = Boolean(user.isAdmin);
  req.session.userCountryIso2 = userCountryIso2;
  req.session.ipCountryIso2 = ipCountryIso2;
  req.session.cookie.maxAge = config.sessionCookieMaxAgeHours * 60 * 60 * 1000;

  await createUserSession({
    sessionId: req.sessionID,
    userId: user.id,
    email: user.email,
    ip,
    userAgent,
    identity,
    geo,
    eventType: "SESSION_RESTORED_VIA_TOKEN",
  });

  if (config.tokenRotationEnabled) {
    const rotated = await rotateRememberMeToken({
      oldTokenId: result.token.id,
      userId: result.userId,
      maxAgeDays: config.maxAgeDays,
      req,
    });
    res.cookie(
      REMEMBER_ME_COOKIE_NAME,
      rotated.cookieValue,
      buildRememberMeCookieOptions(config.maxAgeDays),
    );
    await recordLoginAttempt({
      userId: result.userId,
      email: user.email,
      ip,
      userAgent,
      success: true,
      sessionId: req.sessionID,
      identity,
      geo,
      eventType: "TOKEN_ROTATED",
    });
  } else {
    await touchRememberMeToken(result.token.id);
    res.cookie(
      REMEMBER_ME_COOKIE_NAME,
      cookieValue,
      buildRememberMeCookieOptions(config.maxAgeDays),
    );
  }

  return "restored";
}

export async function ensureRequestAuthenticated(
  req: Request,
  res: Response,
  options?: {
    unauthorizedMessage?: string;
    revokedMessage?: string;
    destroySessionOnRevoked?: boolean;
  },
): Promise<boolean> {
  if (!req.session.userId) {
    const restored = await tryRestoreSessionFromRememberMe(req, res);
    if (restored === "responded") return false;
    if (restored !== "restored") {
      res.status(401).json({ message: options?.unauthorizedMessage || "Unauthorized" });
      return false;
    }
  }

  const sessionUserId = Number(req.session.userId);
  if (!Number.isInteger(sessionUserId) || sessionUserId <= 0) {
    res.status(401).json({ message: options?.unauthorizedMessage || "Unauthorized" });
    return false;
  }

  const sessionId = req.sessionID;
  if (sessionId) {
    const [row] = await db
      .select({
        id: userSessions.id,
        userId: userSessions.userId,
        revokedAt: userSessions.revokedAt,
        lastActiveAt: userSessions.lastActiveAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.sessionId, sessionId), eq(userSessions.userId, sessionUserId)))
      .limit(1);

    if (row && row.revokedAt !== null) {
      if (options?.destroySessionOnRevoked) {
        req.session.destroy(() => {});
      }
      res.status(401).json({
        message: options?.revokedMessage || "Session has been revoked",
        code: "SESSION_REVOKED",
      });
      return false;
    }

    if (row) {
      const config = await getRememberMeConfig();
      if (config.sessionIdleTimeoutMinutes > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const lastActiveAt = Number(row.lastActiveAt || 0);
        const idleLimitSec = config.sessionIdleTimeoutMinutes * 60;
        if (lastActiveAt > 0 && nowSec - lastActiveAt > idleLimitSec) {
          await db
            .update(userSessions)
            .set({
              revokedAt: nowSec,
              revokeReason: "SESSION_IDLE_TIMEOUT",
              revokedByUserId: sessionUserId,
            })
            .where(and(eq(userSessions.sessionId, sessionId), eq(userSessions.userId, sessionUserId)));
          req.session.destroy(() => {});
          res.status(401).json({
            message: "Session expired due to inactivity",
            code: "SESSION_IDLE_TIMEOUT",
          });
          return false;
        }
      }
    }

    if (row) {
      try {
        await touchSession(sessionId);
      } catch {
        // ignore errors
      }
    }
  }

  const [user] = await db
    .select({ id: users.id, isDeleted: users.isDeleted, isDisabled: users.isDisabled })
    .from(users)
    .where(eq(users.id, sessionUserId))
    .limit(1);

  if (!user) {
    res.status(401).json({ message: options?.unauthorizedMessage || "Unauthorized", code: "USER_NOT_FOUND" });
    return false;
  }
  if (user.isDeleted) {
    res.status(403).json({ message: "Account has been deleted", code: "ACCOUNT_DELETED" });
    return false;
  }
  if (user.isDisabled) {
    res.status(403).json({ message: "Account is disabled", code: "ACCOUNT_DISABLED" });
    return false;
  }

  return true;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const ok = await ensureRequestAuthenticated(req, res, {
      unauthorizedMessage: "Unauthorized",
      revokedMessage: "Session has been revoked",
      destroySessionOnRevoked: false,
    });
    if (!ok) return;

    return next();
  } catch (err) {
    return next(err);
  }
}

export function resolveAdminUserId(req: Request): number | null {
  const userId = Number(req.session?.userId ?? 0);
  const isAdmin = Boolean(req.session?.isAdmin);
  if (!isAdmin || !Number.isFinite(userId) || userId <= 0) return null;
  return userId;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const ok = await ensureRequestAuthenticated(req, res, {
      unauthorizedMessage: "Unauthorized",
      revokedMessage: "Session has been revoked",
      destroySessionOnRevoked: true,
    });
    if (!ok) return;

    if (!resolveAdminUserId(req)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  } catch (err) {
    next(err);
  }
}

// Impersonation TTL in milliseconds (15 minutes)
const IMPERSONATION_TTL_MS = 15 * 60 * 1000;

// Whitelist of routes that are allowed during impersonation
// Note: When using app.use("/api", guard), req.path is stripped of /api prefix
const IMPERSONATION_WRITE_WHITELIST = [
  "/admin/view-as/stop",
];

/**
 * Middleware to block write operations (POST/PUT/PATCH/DELETE) during impersonation.
 * Only whitelisted routes (like stop impersonation) are allowed.
 * Also enforces TTL expiration for impersonation sessions.
 */
export function impersonationGuard(req: Request, res: Response, next: NextFunction) {
  // Skip if not impersonating
  if (!req.session.isImpersonating) {
    return next();
  }
  
  // Check TTL expiration
  if (req.session.impersonationStartedAt) {
    const elapsed = Date.now() - req.session.impersonationStartedAt;
    if (elapsed > IMPERSONATION_TTL_MS) {
      // Session expired - restore admin identity or destroy session
      const realAdminId = req.session.realAdminId;
      const realAdminEmail = req.session.realAdminEmail;
      
      if (realAdminId && realAdminEmail) {
        // Restore admin session identity
        req.session.userId = realAdminId;
        req.session.email = realAdminEmail;
        req.session.isAdmin = true;
      } else {
        // Cannot restore - destroy session for safety
        req.session.destroy(() => {});
        return res.status(440).json({ 
          message: "Impersonation session expired and could not restore admin session. Please login again.",
          code: "IMPERSONATION_EXPIRED"
        });
      }
      
      // Clear impersonation state
      req.session.isImpersonating = false;
      req.session.realAdminId = undefined;
      req.session.realAdminEmail = undefined;
      req.session.impersonatedUserId = undefined;
      req.session.impersonationStartedAt = undefined;
      
      return res.status(440).json({ 
        message: "Impersonation session expired. You have been returned to your admin session.",
        code: "IMPERSONATION_EXPIRED"
      });
    }
  }
  
  // For read operations (GET, HEAD, OPTIONS), allow through
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }
  
  // Check if route is whitelisted for writes during impersonation
  const isWhitelisted = IMPERSONATION_WRITE_WHITELIST.some(route => 
    req.path === route || req.path.startsWith(route)
  );
  
  if (isWhitelisted) {
    return next();
  }
  
  // Block all other write operations during impersonation
  return res.status(403).json({
    message: "Write operations are disabled while viewing as another user",
    code: "IMPERSONATION_WRITE_BLOCKED",
    hint: "Exit View As mode to perform this action"
  });
}
