// @vitest-environment node
import express from "express";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;

const mocks = vi.hoisted(() => ({
  appendIdentityAudit: vi.fn(),
  buildDecisionContext: vi.fn(),
  decidePolicy: vi.fn(),
  loadPolicyConfig: vi.fn(),
}));

vi.mock("../lib/auditContext", () => ({
  buildAuditContext: () => ({
    correlationId: "corr-1",
    actorType: "USER",
    actorUserId: 7,
    sessionId: "sess-1",
    ip: "127.0.0.1",
    userAgent: "vitest",
  }),
}));

vi.mock("../services/identityAudit", () => ({
  appendIdentityAudit: mocks.appendIdentityAudit,
}));

vi.mock("../policy/buildDecisionContext", () => ({
  buildDecisionContext: mocks.buildDecisionContext,
}));

vi.mock("../policy/getPolicyConfig", () => ({
  loadPolicyConfig: mocks.loadPolicyConfig,
}));

vi.mock("../../shared/policyDecision", () => ({
  decidePolicy: mocks.decidePolicy,
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { requirePolicy } = await import("./requirePolicy");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userIdHeader = req.header("x-user-id");
    (req as any).sessionID = "sess-1";
    (req as any).session = userIdHeader ? { userId: Number(userIdHeader) } : {};
    next();
  });

  app.get(
    "/allow",
    requirePolicy("TRADE_OPEN_OR_INCREASE"),
    (req, res) => {
      const policyReq = req as typeof req & { policyAction?: string; policyDecision?: { allowed: boolean } };
      res.json({
        ok: true,
        action: policyReq.policyAction ?? null,
        allowed: policyReq.policyDecision?.allowed ?? null,
      });
    },
  );

  server = http.createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}, HOOK_TIMEOUT_MS);

beforeEach(() => {
  mocks.appendIdentityAudit.mockReset();
  mocks.buildDecisionContext.mockReset();
  mocks.decidePolicy.mockReset();
  mocks.loadPolicyConfig.mockReset();

  mocks.loadPolicyConfig.mockResolvedValue({});
  mocks.buildDecisionContext.mockResolvedValue({
    user: {
      email: "trader@example.test",
      username: "trader",
    },
  });
});

test("returns 401 when the session has no authenticated user", async () => {
  const response = await fetch(`${baseUrl}/allow`);

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ message: "Not authenticated" });
  expect(mocks.decidePolicy).not.toHaveBeenCalled();
});

test("attaches the policy decision and correlation id for allowed requests", async () => {
  mocks.decidePolicy.mockReturnValue({
    allowed: true,
    accountState: "ACTIVE_VERIFIED",
  });

  const response = await fetch(`${baseUrl}/allow`, {
    headers: { "x-user-id": "7" },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("x-correlation-id")).toBe("corr-1");
  await expect(response.json()).resolves.toMatchObject({
    ok: true,
    action: "TRADE_OPEN_OR_INCREASE",
    allowed: true,
  });
  expect(mocks.buildDecisionContext).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 7,
    }),
  );
});

test("writes an audit entry and returns the deny payload when policy blocks the action", async () => {
  mocks.decidePolicy.mockReturnValue({
    allowed: false,
    deny_code: "EMAIL_REVERIFY_OVERDUE",
    deny: {
      code: "EMAIL_REVERIFY_OVERDUE",
      messageKey: "deny.EMAIL_REVERIFY_OVERDUE",
      httpStatus: 403,
    },
    derived: {
      accountState: "LOCKED_EMAIL_REVERIFY_OVERDUE",
    },
    accountState: "LOCKED_EMAIL_REVERIFY_OVERDUE",
    showLockedBanner: true,
    redirectTo: "/verify-email",
  });

  const response = await fetch(`${baseUrl}/allow`, {
    headers: { "x-user-id": "7" },
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    deny_code: "EMAIL_REVERIFY_OVERDUE",
    redirectTo: "/verify-email",
    correlationId: "corr-1",
  });
  expect(mocks.appendIdentityAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 7,
      category: "POLICY",
      type: "ACCOUNT_ACTION_DENIED",
    }),
  );
});
