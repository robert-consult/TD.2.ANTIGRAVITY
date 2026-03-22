// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyAdminScopeSession: vi.fn(),
  buildGeoContext: vi.fn(() => ({ countryCode: "IR" })),
  clearRememberMeCookie: vi.fn(),
  createUserSession: vi.fn(),
  dbSelectLimit: vi.fn(),
  evaluateLoginJurisdiction: vi.fn(),
  extractClientIdentity: vi.fn(() => ({})),
  extractGeoHints: vi.fn(() => ({})),
  getClientIp: vi.fn(() => "127.0.0.1"),
  getRememberMeConfig: vi.fn(),
  getTrustedProxyCountryIso2: vi.fn(() => undefined),
  getUserAgent: vi.fn(() => "vitest"),
  readRememberMeCookie: vi.fn(),
  recordLoginAttempt: vi.fn(),
  revokeAllRememberMeTokensForUser: vi.fn(),
  revokeAllSessionsForUser: vi.fn(),
  revokeRememberMeTokenById: vi.fn(),
  revokeSession: vi.fn(),
  rotateRememberMeToken: vi.fn(),
  touchRememberMeToken: vi.fn(),
  touchSession: vi.fn(),
  verifyRememberMeToken: vi.fn(),
}));

vi.mock("@db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.dbSelectLimit,
        }),
      }),
    }),
  },
}));

vi.mock("../security/sessionTrail", () => ({
  buildGeoContext: mocks.buildGeoContext,
  createUserSession: mocks.createUserSession,
  extractClientIdentity: mocks.extractClientIdentity,
  extractGeoHints: mocks.extractGeoHints,
  getClientIp: mocks.getClientIp,
  getUserAgent: mocks.getUserAgent,
  recordLoginAttempt: mocks.recordLoginAttempt,
  revokeAllSessionsForUser: mocks.revokeAllSessionsForUser,
  revokeSession: mocks.revokeSession,
  touchSession: mocks.touchSession,
}));

vi.mock("../security/proxyHeaders", () => ({
  getTrustedProxyCountryIso2: mocks.getTrustedProxyCountryIso2,
}));

vi.mock("../policy/jurisdictionControl", () => ({
  evaluateLoginJurisdiction: mocks.evaluateLoginJurisdiction,
}));

vi.mock("../services/rememberMe", () => ({
  REMEMBER_ME_COOKIE_NAME: "tq_rm",
  buildRememberMeCookieOptions: () => ({ httpOnly: true, path: "/" }),
  clearRememberMeCookie: mocks.clearRememberMeCookie,
  getRememberMeConfig: mocks.getRememberMeConfig,
  readRememberMeCookie: mocks.readRememberMeCookie,
  revokeAllRememberMeTokensForUser: mocks.revokeAllRememberMeTokensForUser,
  revokeRememberMeTokenById: mocks.revokeRememberMeTokenById,
  rotateRememberMeToken: mocks.rotateRememberMeToken,
  touchRememberMeToken: mocks.touchRememberMeToken,
  verifyRememberMeToken: mocks.verifyRememberMeToken,
}));

vi.mock("../services/identityAudit", () => ({
  appendIdentityAudit: vi.fn(),
}));

vi.mock("../lib/saveSession", () => ({
  saveSession: vi.fn(),
}));

vi.mock("../security/adminScopeSession", () => ({
  applyAdminScopeSession: mocks.applyAdminScopeSession,
}));

function createResponse() {
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(function json(payload: any) {
      res.payload = payload;
      return res;
    }),
    setHeader: vi.fn(),
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };
  return res;
}

describe("ensureRequestAuthenticated remember-me restoration", () => {
  beforeEach(() => {
    mocks.applyAdminScopeSession.mockReset();
    mocks.clearRememberMeCookie.mockReset();
    mocks.createUserSession.mockReset();
    mocks.dbSelectLimit.mockReset();
    mocks.evaluateLoginJurisdiction.mockReset();
    mocks.getRememberMeConfig.mockReset();
    mocks.readRememberMeCookie.mockReset();
    mocks.recordLoginAttempt.mockReset();
    mocks.revokeAllRememberMeTokensForUser.mockReset();
    mocks.revokeAllSessionsForUser.mockReset();
    mocks.revokeRememberMeTokenById.mockReset();
    mocks.revokeSession.mockReset();
    mocks.rotateRememberMeToken.mockReset();
    mocks.touchRememberMeToken.mockReset();
    mocks.touchSession.mockReset();
    mocks.verifyRememberMeToken.mockReset();

    mocks.readRememberMeCookie.mockReturnValue("cookie-value");
    mocks.getRememberMeConfig.mockResolvedValue({
      enabled: true,
      maxAgeDays: 30,
      maxDevicesPerUser: 10,
      reauthAfterAbsenceDays: 7,
      tokenRotationEnabled: false,
      theftAutoRevokeAll: true,
      sessionCookieMaxAgeHours: 24,
      sessionIdleTimeoutMinutes: 0,
      logoutClearAllDeviceTokens: false,
    });
    mocks.verifyRememberMeToken.mockResolvedValue({
      status: "VALID",
      token: { id: 9 },
      userId: 42,
    });
    mocks.dbSelectLimit.mockResolvedValue([
      {
        id: 42,
        email: "blocked@example.test",
        isAdmin: false,
        isDeleted: false,
        isDisabled: false,
        isFrozen: false,
        countryIso2: "IR",
        country: "IR",
      },
    ]);
    mocks.evaluateLoginJurisdiction.mockReturnValue({
      allowed: false,
      code: "JURISDICTION_RESTRICTED",
      httpStatus: 403,
      message: "This jurisdiction is not supported due to regulatory restrictions.",
      reasonCode: "JURISDICTION_RESTRICTED_SELECTED",
      blockedBy: ["COUNTRY_SELECTED"],
      ipCountryIso2: "IR",
      selectedCountryIso2: "IR",
    });
  });

  it(
    "denies the restoring request and revokes the restored session when jurisdiction is blocked",
    async () => {
      const { ensureRequestAuthenticated } = await import("./auth");

    const session: any = {
      cookie: {},
      regenerate(callback: (err?: unknown) => void) {
        callback();
      },
      destroy: vi.fn((callback?: () => void) => callback?.()),
    };
    const req: any = {
      headers: { cookie: "tq_rm=cookie-value" },
      session,
      sessionID: "sess-1",
    };
    const res = createResponse();

    const ok = await ensureRequestAuthenticated(req, res as any, {
      unauthorizedMessage: "Unauthorized",
      revokedMessage: "Session has been revoked",
      destroySessionOnRevoked: false,
    });

    expect(ok).toBe(false);
    expect(mocks.createUserSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        userId: 42,
      }),
    );
    expect(mocks.revokeSession).toHaveBeenCalledWith({
      actorUserId: 0,
      targetUserId: 42,
      sessionId: "sess-1",
      reason: "JURISDICTION_RESTRICTED_SELECTED",
    });
    expect(mocks.revokeRememberMeTokenById).toHaveBeenCalledWith(9, 42);
    expect(session.destroy).toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "JURISDICTION_RESTRICTED",
          reasonCode: "JURISDICTION_RESTRICTED_SELECTED",
          userCountryIso2: "IR",
        }),
      );
    },
    15_000,
  );
});
