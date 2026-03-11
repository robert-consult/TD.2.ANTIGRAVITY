// @vitest-environment node
import express from "express";
import session from "express-session";
import http from "node:http";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;
const SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

vi.mock("@db", () => {
  return {
    db: {
      query: {
        userVerification: {
          findFirst: async () => ({ emailVerifiedAt: 123 }),
        },
      },
    },
  };
});

vi.mock("../../storage", () => {
  return {
    storage: {
      getUserById: async (id: number) => ({
        id,
        email: "trader@tradehub.example.com",
        username: "trader",
        name: "Trader",
        phone: "",
        countryIso2: "US",
        language: "en",
        balance: "1000.00",
        startingEquity: 1000,
        isAdmin: false,
        equity: 1000,
        freeMargin: 1000,
        usedMargin: 0,
        leverage: 100,
        createdAt: 0,
      }),
    },
  };
});

vi.mock("../../legal/legalReacceptanceService", () => {
  return {
    computeDoc1ReacceptStatus: async () => ({
      required: false,
      blocked: false,
      blockedReason: null,
      requiredCombinedSha256: null,
      lastAcceptedCombinedSha256: null,
    }),
    getDoc1ReacceptRequirement: async () => null,
    upsertDoc1ReacceptRequirement: async () => {},
  };
});

vi.mock("../../services/currentUserRecalc", () => ({
  maybeRecalcAccountForCurrentUser: async () => {},
}));

vi.mock("../../middleware/auth", () => ({
  ensureRequestAuthenticated: async (req: any, res: any) => {
    if (!req?.session?.userId) {
      res.status(401).json({ message: "Not authenticated" });
      return false;
    }
    return true;
  },
}));

vi.mock("../../services/rememberMe", () => ({
  REMEMBER_ME_COOKIE_NAME: "tq_rm",
  buildRememberMeCookieOptions: () => ({ httpOnly: true, path: "/", sameSite: "lax" as const, secure: false }),
  clearRememberMeCookie: () => {},
  decodeRememberMeCookie: () => null,
  enforceRememberMeDeviceLimit: async () => {},
  getRememberMeConfig: async () => ({
    enabled: true,
    maxAgeDays: 30,
    maxDevicesPerUser: 10,
    reauthAfterAbsenceDays: 7,
    tokenRotationEnabled: true,
    theftAutoRevokeAll: true,
    sessionCookieMaxAgeHours: 24,
    sessionIdleTimeoutMinutes: 0,
    logoutClearAllDeviceTokens: false,
  }),
  issueRememberMeToken: async () => ({
    tokenId: 1,
    cookieValue: "stub",
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  }),
  listRememberMeDevices: async () => [],
  readRememberMeCookie: () => null,
  revokeAllRememberMeTokensForUser: async () => {},
  revokeRememberMeTokenById: async () => {},
  revokeRememberMeTokenBySelector: async () => {},
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { registerCurrentUserRoute } = await import("./currentUser");

  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-session-secret",
      resave: false,
      saveUninitialized: false,
      name: "connect.sid",
      cookie: {
        httpOnly: true,
        sameSite: "strict",
      },
    }),
  );

  app.post("/seed-session", (req, res) => {
    req.session.userId = 1;
    req.session.email = "trader@tradehub.example.com";
    req.session.isAdmin = false;
    req.session.cookie.maxAge = 1_000;
    res.json({ ok: true });
  });

  app.get("/session-debug", (req, res) => {
    res.json({
      userId: req.session.userId ?? null,
      maxAge: req.session.cookie.maxAge ?? null,
    });
  });

  const router = express.Router();
  registerCurrentUserRoute(router, {
    sessionCookieName: "connect.sid",
    ensureAuth: async () => true,
  });
  app.use(router);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind current-user test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}, HOOK_TIMEOUT_MS);

test("current-user refreshes the session maxAge for active mobile/native clients", async () => {
  const seedResponse = await fetch(`${baseUrl}/seed-session`, { method: "POST" });
  expect(seedResponse.status).toBe(200);

  const cookie = seedResponse.headers.get("set-cookie")?.split(";")[0]?.trim() ?? "";
  expect(cookie).toMatch(/^connect\.sid=/);

  const beforeResponse = await fetch(`${baseUrl}/session-debug`, {
    headers: { Cookie: cookie },
  });
  const beforeSession = await beforeResponse.json();
  expect(Number(beforeSession.maxAge)).toBeLessThan(60_000);

  const currentUserResponse = await fetch(`${baseUrl}/api/auth/current-user`, {
    headers: { Cookie: cookie },
  });
  expect(currentUserResponse.status).toBe(200);
  expect(currentUserResponse.headers.get("set-cookie") ?? "").toMatch(/^connect\.sid=/);

  const afterResponse = await fetch(`${baseUrl}/session-debug`, {
    headers: { Cookie: cookie },
  });
  const afterSession = await afterResponse.json();
  expect(Number(afterSession.maxAge)).toBeGreaterThan(SESSION_COOKIE_MAX_AGE_MS - 60_000);
});
