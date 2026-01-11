import { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { userSessions, users } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { touchSession } from "../security/sessionTrail";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
  
  const sessionId = req.sessionID;
  if (sessionId) {
    // Validate session is still active (not revoked)
    const row = db
      .select({
        id: userSessions.id,
        userId: userSessions.userId,
        revokedAt: userSessions.revokedAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.sessionId, sessionId), eq(userSessions.userId, req.session.userId)))
      .limit(1)
      .get();
    
    // If session exists and is revoked, reject the request
    if (row && row.revokedAt !== null) {
      return res.status(401).json({ 
        message: "Session has been revoked",
        code: "SESSION_REVOKED"
      });
    }
    
    // Touch lastActiveAt (non-blocking)
    if (row) {
      try {
        touchSession(sessionId);
      } catch {
        // ignore errors
      }
    }
  }

  const user = db
    .select({ id: users.id, isDeleted: users.isDeleted, isDisabled: users.isDisabled })
    .from(users)
    .where(eq(users.id, Number(req.session.userId)))
    .limit(1)
    .get();

  if (!user) {
    return res.status(401).json({ message: "Unauthorized", code: "USER_NOT_FOUND" });
  }
  if (user.isDeleted) {
    return res.status(403).json({ message: "Account has been deleted", code: "ACCOUNT_DELETED" });
  }
  if (user.isDisabled) {
    return res.status(403).json({ message: "Account is disabled", code: "ACCOUNT_DISABLED" });
  }
  
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ message: "Forbidden" });
  next();
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
