// @vitest-environment node
import express from "express";
import session from "express-session";
import http from "node:http";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;

vi.mock("../lib/auditContext", () => ({
  buildAuditContext: () => ({
    actorType: "ADMIN",
    actorUserId: 1,
    sessionId: "vitest-session",
    ip: "127.0.0.1",
    userAgent: "vitest",
  }),
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.session?.isAdmin) return next();
    return res.status(403).json({ message: "Forbidden" });
  },
}));

vi.mock("../services/identityAudit", () => ({
  appendIdentityAudit: async () => {},
}));

vi.mock("../security/adminScopeSession", () => ({
  applyAdminScopeSession: (currentSession: any, _userLike: any) => {
    currentSession.isSuperAdmin = true;
    currentSession.adminResourceScopes = { all: "ALL" };
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getUserById: async (id: number) => {
      if (id === 1) {
        return {
          id: 1,
          email: "admin@test.local",
          username: "admin",
          isAdmin: true,
          isSuperAdmin: true,
          adminResourceScopes: { all: "ALL" },
        };
      }
      if (id === 14) {
        return {
          id: 14,
          email: "asto@asto.com",
          username: "asto",
          isAdmin: false,
        };
      }
      return null;
    },
    logAdminAction: async () => {},
  },
}));

vi.mock("../grift/griftAdminAudit", () => ({
  appendAuditEntry: async () => {},
}));

vi.mock("../grift/griftDb", () => ({
  getGriftDb: () => ({}),
}));

class DelayedStore extends session.Store {
  private readonly sessions = new Map<string, session.SessionData>();

  override get(sid: string, callback: (err?: any, sessionData?: session.SessionData | null) => void): void {
    setTimeout(() => {
      const existing = this.sessions.get(sid);
      callback(undefined, existing ? JSON.parse(JSON.stringify(existing)) : null);
    }, 10);
  }

  override set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void): void {
    const snapshot = JSON.parse(JSON.stringify(sessionData));
    setTimeout(() => {
      this.sessions.set(sid, snapshot);
      callback?.(undefined);
    }, 250);
  }

  override destroy(sid: string, callback?: (err?: any) => void): void {
    setTimeout(() => {
      this.sessions.delete(sid);
      callback?.(undefined);
    }, 10);
  }

  override touch(sid: string, sessionData: session.SessionData, callback?: () => void): void {
    this.set(sid, sessionData, callback);
  }
}

async function persistSession(currentSession: session.Session & Partial<session.SessionData>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    currentSession.save((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { adminUsersRouter } = await import("./adminUsers");

  const app = express();
  app.use(express.json());
  app.use(
    session({
      store: new DelayedStore(),
      secret: "test-session-secret",
      resave: false,
      saveUninitialized: false,
      name: "connect.sid",
      cookie: { httpOnly: true, sameSite: "strict" },
    }),
  );

  app.post("/prime/admin", async (req, res, next) => {
    try {
      req.session.userId = 1;
      req.session.email = "admin@test.local";
      req.session.isAdmin = true;
      req.session.isSuperAdmin = true;
      req.session.adminResourceScopes = { all: "ALL" };
      await persistSession(req.session);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/prime/impersonating", async (req, res, next) => {
    try {
      req.session.userId = 14;
      req.session.email = "asto@asto.com";
      req.session.isAdmin = false;
      req.session.isImpersonating = true;
      req.session.realAdminId = 1;
      req.session.realAdminEmail = "admin@test.local";
      req.session.realAdminIsSuperAdmin = true;
      req.session.realAdminResourceScopes = { all: "ALL" };
      req.session.impersonatedUserId = 14;
      req.session.impersonationStartedAt = Date.now();
      await persistSession(req.session);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/session-state", (req, res) => {
    res.json({
      userId: req.session.userId ?? null,
      email: req.session.email ?? null,
      isAdmin: Boolean(req.session.isAdmin),
      isImpersonating: Boolean(req.session.isImpersonating),
      realAdminId: req.session.realAdminId ?? null,
      realAdminEmail: req.session.realAdminEmail ?? null,
      impersonatedUserId: req.session.impersonatedUserId ?? null,
      adminResourceScopes: req.session.adminResourceScopes ?? null,
    });
  });

  app.use("/api/admin", adminUsersRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
}, HOOK_TIMEOUT_MS);

async function primeSession(pathname: "/prime/admin" | "/prime/impersonating"): Promise<string> {
  const response = await fetch(`${baseUrl}${pathname}`, { method: "POST" });
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]?.trim() ?? "";
  expect(cookie).toMatch(/^connect\.sid=/);
  await response.arrayBuffer();
  return cookie;
}

test("view-as start persists the impersonated identity before the response body is drained", async () => {
  const cookie = await primeSession("/prime/admin");

  const startRes = await fetch(`${baseUrl}/api/admin/view-as/start`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId: 14 }),
  });

  expect(startRes.status).toBe(200);

  const stateRes = await fetch(`${baseUrl}/session-state`, {
    headers: { Cookie: cookie },
  });
  await expect(stateRes.json()).resolves.toMatchObject({
    userId: 14,
    email: "asto@asto.com",
    isAdmin: false,
    isImpersonating: true,
    realAdminId: 1,
    realAdminEmail: "admin@test.local",
    impersonatedUserId: 14,
  });

  await startRes.arrayBuffer();
});

test("view-as stop restores the admin identity before the response body is drained", async () => {
  const cookie = await primeSession("/prime/impersonating");

  const stopRes = await fetch(`${baseUrl}/api/admin/view-as/stop`, {
    method: "POST",
    headers: { Cookie: cookie },
  });

  expect(stopRes.status).toBe(200);

  const stateRes = await fetch(`${baseUrl}/session-state`, {
    headers: { Cookie: cookie },
  });
  await expect(stateRes.json()).resolves.toMatchObject({
    userId: 1,
    email: "admin@test.local",
    isAdmin: true,
    isImpersonating: false,
    realAdminId: null,
    realAdminEmail: null,
    impersonatedUserId: null,
    adminResourceScopes: { all: "ALL" },
  });

  await stopRes.arrayBuffer();
});
