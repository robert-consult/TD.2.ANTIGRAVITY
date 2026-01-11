import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@db";
import { userSessions, userLoginHistory } from "@shared/schema";
import { revokeSession, getAllSessions, getRecentLoginActivity } from "../security/sessionTrail";

function requireAdmin(req: any, res: Response): { adminUserId: number } | null {
  const userId = req.session?.userId;
  const isAdmin = Boolean(req.session?.isAdmin);
  if (!userId || !isAdmin) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { adminUserId: Number(userId) };
}

function toCsv(rows: Array<Record<string, any>>): string {
  if (!rows.length) return "no_data\n";
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n") + "\n";
}

export function registerAdminSecurityRoutes(app: Express) {
  app.get("/api/admin/users/:userId/login-activity", (req: Request, res: Response) => {
    const admin = requireAdmin(req as any, res);
    if (!admin) return;

    const userId = Number(req.params.userId);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

    const rows = getRecentLoginActivity({ userId, limit });
    res.json({ rows });
  });

  app.get("/api/admin/users/:userId/login-activity.csv", (req: Request, res: Response) => {
    const admin = requireAdmin(req as any, res);
    if (!admin) return;

    const userId = Number(req.params.userId);
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit || 500)));

    const rows = db
      .select({
        id: userLoginHistory.id,
        eventType: userLoginHistory.eventType,
        eventAt: userLoginHistory.createdAt,
        sessionId: userLoginHistory.sessionId,
        ip: userLoginHistory.ip,
        userAgent: userLoginHistory.userAgent,
        countryCode: userLoginHistory.countryCode,
        region: userLoginHistory.region,
        city: userLoginHistory.city,
        success: userLoginHistory.success,
        failureReason: userLoginHistory.failureReason,
      })
      .from(userLoginHistory)
      .where(eq(userLoginHistory.userId, userId))
      .orderBy(desc(userLoginHistory.createdAt))
      .limit(limit)
      .all();

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="user_${userId}_login_activity.csv"`);
    res.send(toCsv(rows));
  });

  app.get("/api/admin/users/:userId/sessions", (req: Request, res: Response) => {
    const admin = requireAdmin(req as any, res);
    if (!admin) return;

    const userId = Number(req.params.userId);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const includeRevoked = String(req.query.includeRevoked || "0") === "1";

    const rows = getAllSessions({ userId, limit, includeRevoked });
    res.json({ rows });
  });

  app.post("/api/admin/users/:userId/sessions/:sessionId/revoke", (req: Request, res: Response) => {
    const admin = requireAdmin(req as any, res);
    if (!admin) return;

    const userId = Number(req.params.userId);
    const sessionId = String(req.params.sessionId);
    const reason = String((req.body as any)?.reason || "Admin revoked session");

    revokeSession({
      actorUserId: admin.adminUserId,
      targetUserId: userId,
      sessionId,
      reason,
    });

    res.json({ ok: true });
  });

  app.get("/api/admin/users/:userId/sessions.csv", (req: Request, res: Response) => {
    const admin = requireAdmin(req as any, res);
    if (!admin) return;

    const userId = Number(req.params.userId);
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit || 500)));
    const includeRevoked = String(req.query.includeRevoked || "1") === "1";

    const rows = getAllSessions({ userId, limit, includeRevoked });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="user_${userId}_sessions.csv"`);
    res.send(toCsv(rows));
  });
}
