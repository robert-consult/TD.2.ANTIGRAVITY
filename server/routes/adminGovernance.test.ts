// @vitest-environment node
import express from "express";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.session = { isAdmin: true, isSuperAdmin: true, userId: 1, email: "admin@local.test" };
    next();
  },
}));

vi.mock("../services/runtimeGovernance", () => ({
  getRuntimeGovernanceSnapshot: vi.fn(async () => ({
    generatedAt: 1,
    sections: [
      {
        id: "identity-session",
        title: "Identity And Session",
        description: "desc",
        entries: [],
      },
    ],
    reloads: [],
    documentation: [],
  })),
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { adminGovernanceRouter } = await import("./adminGovernance");
  const app = express();
  app.use("/api/admin", adminGovernanceRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start governance test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
});

describe("adminGovernanceRouter", () => {
  it("returns the runtime governance snapshot", async () => {
    const response = await fetch(`${baseUrl}/api/admin/runtime-config/governance`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        generatedAt: 1,
        sections: expect.arrayContaining([expect.objectContaining({ id: "identity-session" })]),
      }),
    );
  });
});
