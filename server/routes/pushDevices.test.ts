// @vitest-environment node
import express from "express";
import session from "express-session";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

const listPushDevicesForUser = vi.fn();
const revokeAllPushDevicesForUser = vi.fn();
const revokePushDeviceById = vi.fn();
const revokePushDeviceByToken = vi.fn();
const upsertPushDevice = vi.fn();
const appendIdentityAudit = vi.fn();

vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req?.session?.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  },
}));

vi.mock("../services/pushDevices", () => ({
  listPushDevicesForUser,
  revokeAllPushDevicesForUser,
  revokePushDeviceById,
  revokePushDeviceByToken,
  upsertPushDevice,
}));

vi.mock("../services/identityAudit", () => ({
  appendIdentityAudit,
}));

vi.mock("../security/sessionTrail", () => ({
  getClientIp: () => "127.0.0.1",
  getUserAgent: () => "vitest",
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { pushDevicesRouter } = await import("./pushDevices");

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

  app.post("/seed-session", (req, res) => {
    req.session.userId = 42;
    req.session.email = "trader@tradehub.example.com";
    req.session.isAdmin = false;
    res.json({ ok: true });
  });

  app.use("/api/push", pushDevicesRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind pushDevices test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) return reject(error);
      resolve();
    });
  });
});

beforeEach(() => {
  listPushDevicesForUser.mockReset();
  revokeAllPushDevicesForUser.mockReset();
  revokePushDeviceById.mockReset();
  revokePushDeviceByToken.mockReset();
  upsertPushDevice.mockReset();
  appendIdentityAudit.mockReset();
});

async function seedSessionCookie(): Promise<string> {
  const response = await fetch(`${baseUrl}/seed-session`, { method: "POST" });
  const cookie = response.headers.get("set-cookie")?.split(";")[0]?.trim() ?? "";
  expect(cookie).toMatch(/^connect\.sid=/);
  return cookie;
}

test("push device routes register, list, and unregister authenticated devices", async () => {
  const cookie = await seedSessionCookie();

  upsertPushDevice.mockResolvedValue({
    id: 7,
    appVariant: "wrapper",
    platform: "android",
    environment: "production",
    pushProvider: "FCM",
    tokenPreview: "abc123...xyz789",
  });
  listPushDevicesForUser.mockResolvedValue([
    { id: 7, appVariant: "wrapper", platform: "android", tokenPreview: "abc123...xyz789" },
  ]);
  revokePushDeviceByToken.mockResolvedValue(true);

  const registerResponse = await fetch(`${baseUrl}/api/push/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      token: "abcdef1234567890",
      appVariant: "wrapper",
      platform: "android",
      environment: "production",
      pushProvider: "FCM",
      appVersion: "1.2.3",
      buildNumber: "20260310",
      locale: "en-US",
      timezone: "America/Chicago",
    }),
  });

  expect(registerResponse.status).toBe(200);
  expect(upsertPushDevice).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 42,
      token: "abcdef1234567890",
      appVariant: "wrapper",
      platform: "android",
      environment: "production",
      appVersion: "1.2.3",
      buildNumber: "20260310",
      locale: "en-US",
      timezone: "America/Chicago",
    }),
  );

  const listResponse = await fetch(`${baseUrl}/api/push`, {
    headers: { Cookie: cookie },
  });
  expect(listResponse.status).toBe(200);
  await expect(listResponse.json()).resolves.toMatchObject({
    rows: [{ id: 7, platform: "android" }],
  });

  const unregisterResponse = await fetch(`${baseUrl}/api/push/unregister`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ token: "abcdef1234567890" }),
  });
  expect(unregisterResponse.status).toBe(200);
  expect(revokePushDeviceByToken).toHaveBeenCalledWith(42, "abcdef1234567890");
  expect(appendIdentityAudit).toHaveBeenCalled();
});

test("push device route can revoke all tokens for the signed-in user", async () => {
  const cookie = await seedSessionCookie();
  revokeAllPushDevicesForUser.mockResolvedValue(3);

  const response = await fetch(`${baseUrl}/api/push/unregister`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ all: true }),
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ ok: true, updated: 3 });
  expect(revokeAllPushDevicesForUser).toHaveBeenCalledWith(42);
});
