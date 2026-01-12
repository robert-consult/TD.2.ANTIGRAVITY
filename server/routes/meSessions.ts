import type { Express, Request, Response } from "express";
import { db } from "@db";
import { userSessions } from "@shared/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { revokeSession, endSession, getClientIp, getUserAgent, touchSession } from "../security/sessionTrail";
import { requireAuth } from "../middleware/auth";

export function registerMeSessionsRoutes(app: Express) {
  // List sessions (active + currentSessionId for UI)
  app.get("/api/me/sessions", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const currentSessionId = req.sessionID;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

    const rows = await db
      .select({
        id: userSessions.sessionId,
        createdAt: userSessions.createdAt,
        lastSeenAt: userSessions.lastActiveAt,
        ip: userSessions.ip,
        userAgent: userSessions.userAgent,
        deviceType: userSessions.deviceType,
        browser: userSessions.browser,
        os: userSessions.os,
        countryCode: userSessions.countryCode,
        region: userSessions.region,
        city: userSessions.city,
        inferredTz: userSessions.inferredTz,
        revokedAt: userSessions.revokedAt,
      })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastActiveAt))
      .limit(limit);

    // Convert dates to timestamps for consistent frontend handling
    const toMs = (value: number | null | undefined) => {
      if (value == null) return null;
      return value < 1e12 ? value * 1000 : value;
    };
    const formattedRows = rows.map(r => ({
      ...r,
      createdAt: toMs(r.createdAt),
      lastSeenAt: toMs(r.lastSeenAt),
    }));

    res.json({ currentSessionId, rows: formattedRows });
  });

  // Revoke a specific session
  app.post("/api/me/sessions/:sessionId/revoke", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const targetSessionId = String(req.params.sessionId);
    const reason = String((req.body as any)?.reason || "User revoked session");

    // Prevent revoking current session via this endpoint
    if (targetSessionId === req.sessionID) {
      return res.status(400).json({ 
        error: "Cannot revoke current session. Use logout endpoint instead.",
        code: "CANNOT_REVOKE_CURRENT"
      });
    }

    await revokeSession({
      actorUserId: userId,
      targetUserId: userId,
      sessionId: targetSessionId,
      reason,
    });

    res.json({ ok: true });
  });

  // Logout all other devices (revoke all sessions except current)
  app.post("/api/me/sessions/logout-others", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const currentSessionId = req.sessionID;
    const reason = String((req.body as any)?.reason || "User logged out other devices");

    const others = await db
      .select({ sessionId: userSessions.sessionId })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          ne(userSessions.sessionId, currentSessionId)
        )
      );

    for (const s of others) {
      await revokeSession({
        actorUserId: userId,
        targetUserId: userId,
        sessionId: s.sessionId,
        reason,
      });
    }

    res.json({ ok: true, revokedCount: others.length });
  });

  // Logout current session
  app.post("/api/me/logout", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    const sessionId = req.sessionID;
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    // End the session in our tracking table
    await endSession({ userId, sessionId, ip, userAgent });

    // Destroy express session
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
      }
    });

    res.json({ ok: true });
  });
}
