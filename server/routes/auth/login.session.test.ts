// @vitest-environment node
import express from "express";
import session from "express-session";
import http from "node:http";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

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

vi.mock("@db/config", () => ({ isPostgres: false }));

vi.mock("../../storage", () => {
  return {
    storage: {
      verifyUser: async (email: string, _password: string) => ({
        id: 1,
        email,
        username: "test",
        phone: "",
        countryIso2: "US",
        country: "US",
        balance: "0.00",
        startingEquity: 0,
        isAdmin: false,
        isDisabled: false,
        createdAt: 0,
      }),
    },
  };
});

vi.mock("../../security/loginRateLimit", () => {
  return {
    enforceLoginRateLimit: async () => ({ allowed: true }),
    clearLoginRateLimit: async () => {},
  };
});

vi.mock("../../security/botGuard", () => {
  return {
    botGuard: async () => ({ allowed: true, score: 0, signals: {} }),
    persistBotAssessmentForUser: async () => {},
  };
});

vi.mock("../../policy/jurisdictionControl", () => {
  return {
    evaluateLoginJurisdiction: () => ({ allowed: true }),
    evaluateSignupJurisdiction: () => ({ allowed: true }),
    recordSignupJurisdictionBlock: async () => {},
  };
});

vi.mock("../../security/proxyHeaders", () => {
  return {
    getTrustedProxyCountryIso2: () => undefined,
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

vi.mock("../../services/currentUserRecalc", () => ({ maybeRecalcAccountForCurrentUser: async () => {} }));

vi.mock("../../security/sessionTrail", () => {
  return {
    getClientIp: () => "127.0.0.1",
    getUserAgent: () => "vitest",
    extractClientIdentity: () => ({}),
    extractGeoHints: () => ({}),
    buildGeoContext: () => ({ countryCode: "US" }),
    createUserSession: async () => ({ geo: null }),
    endSession: async () => {},
    recordLoginAttempt: async () => {},
  };
});

vi.mock("../../services/identityAudit", () => ({ appendIdentityAudit: async () => {} }));

vi.mock("../../services/messaging", () => ({ sendWelcomeMailboxMessage: async () => {} }));

vi.mock("../../services/signupPublicConfig", () => ({
  getSignupPublicConfig: async () => ({}),
  normalizeSignupPhone: (value: unknown) => value,
}));

vi.mock("../../security/captcha", () => ({ verifySignupCaptcha: async () => ({ ok: true }) }));
vi.mock("../../legal/coverageGate", () => ({ checkCoverage: async () => ({ allowed: true }) }));
vi.mock("../../legal/cryptoUtils", () => ({ verifyDoc1TermsToken: () => ({ ok: true }) }));
vi.mock("../../legal/legalAcceptanceService", () => ({ recordDoc1Acceptance: async () => {} }));

vi.mock("../../grift/griftDb", () => ({ withGriftClient: async () => {} }));
vi.mock("../../grift/griftGeo", () => ({ extractGriftContext: () => ({}) }));
vi.mock("../../grift/griftAutoEnforcement", () => ({ maybeApplyAutoEnforcement: async () => null }));
vi.mock("../../grift/griftEngine", () => ({ onLoginSuccess: async () => {} }));

vi.mock("../../security/emailVerificationToken", () => ({ hashEmailVerificationToken: () => "" }));

vi.mock("../../services/rememberMe", () => {
  const REMEMBER_ME_COOKIE_NAME = "tq_rm";
  const parseRememberMeCookie = (req: any): string | null => {
    const raw = String(req?.headers?.cookie ?? "");
    if (!raw) return null;
    const pairs = raw.split(";").map((part) => part.trim());
    for (const pair of pairs) {
      if (!pair.startsWith(`${REMEMBER_ME_COOKIE_NAME}=`)) continue;
      const value = pair.slice(`${REMEMBER_ME_COOKIE_NAME}=`.length).trim();
      return value ? value : null;
    }
    return null;
  };

  return {
    REMEMBER_ME_COOKIE_NAME,
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
    buildRememberMeCookieOptions: () => ({ httpOnly: true, path: "/", sameSite: "lax" as const, secure: false }),
    readRememberMeCookie: parseRememberMeCookie,
    clearRememberMeCookie: (res: any) => {
      res.cookie(REMEMBER_ME_COOKIE_NAME, "", { path: "/", expires: new Date(0), httpOnly: true, sameSite: "lax" });
    },
    issueRememberMeToken: async () => ({
      tokenId: 1,
      cookieValue: "stub",
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    }),
    enforceRememberMeDeviceLimit: async () => {},
    decodeRememberMeCookie: () => null,
    listRememberMeDevices: async () => [],
    revokeAllRememberMeTokensForUser: async () => {},
    revokeRememberMeTokenById: async () => {},
    revokeRememberMeTokenBySelector: async () => {},
  };
});

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const { registerLoginRoute } = await import("./login");

  const app = express();
  app.use(express.json());

  app.use(
    session({
      secret: "test-session-secret",
      resave: false,
      saveUninitialized: false,
      name: "connect.sid",
      cookie: { httpOnly: true, sameSite: "strict" },
    }),
  );

  const router = express.Router();
  registerLoginRoute(router, {
    sessionCookieName: "connect.sid",
    ensureAuth: async () => true,
  });
  app.use(router);

  app.get("/me", (req, res) => {
    res.json({ userId: (req.session as any)?.userId ?? null });
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
});

test("login emits connect.sid first and session is immediately usable", async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@local.test", password: "changeme" }),
  });

  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  expect(setCookie).toMatch(/^connect\.sid=/);
  const naiveCookie = setCookie.split(";")[0]?.trim() ?? "";
  expect(naiveCookie).toMatch(/^connect\.sid=/);

  // Critical regression: follow-up request should succeed even if the client doesn't
  // read/drain the login response body before using the session cookie.
  const meRes = await fetch(`${baseUrl}/me`, {
    headers: { Cookie: naiveCookie },
  });
  expect(meRes.status).toBe(200);
  await expect(meRes.json()).resolves.toMatchObject({ userId: 1 });

  // Cleanup: drain login response to avoid leaking undici resources in tests.
  await loginRes.arrayBuffer();
});
