// @vitest-environment node
import express from "express";
import http from "node:http";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;

vi.mock("@shared/admin/dataExports", () => ({
  adminDataExportCreateRequestSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock("../middleware/requireAdmin", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    req.session = {
      ...(req.session || {}),
      isAdmin: true,
      isSuperAdmin: true,
      userId: 1,
    };
    next();
  },
}));

vi.mock("../services/adminDataExportRepo", () => ({
  appendAdminDataExportEvent: async () => {},
  createAdminDataExportJob: async () => ({ deduped: false, job: { id: "job-1" } }),
  getAdminDataExportJob: async () => null,
  getAdminDataExportJobByObjectKey: async () => null,
  listAdminDataExportJobEvents: async () => [],
  listAdminDataExportJobs: async () => [],
  markAdminDataExportJobCanceled: async () => {},
  markAdminDataExportJobExpired: async () => {},
  retryAdminDataExportJob: async () => {},
}));

vi.mock("../services/adminDataExportQueue", async () => {
  const expressMod = await import("express");
  const boardRouter = expressMod.Router();
  boardRouter.get("/", (_req, res) => res.status(200).send("bull-board-ok"));
  return {
    cancelAdminDataExportQueueJob: async () => {},
    enqueueAdminDataExportJob: async () => ({ queueJobId: "queue-1" }),
    getAdminExportBullBoardAdapter: () => ({
      getRouter: () => boardRouter,
    }),
    retryAdminDataExportJob: async () => {},
  };
});

vi.mock("../services/objectStorage", () => ({
  deleteExportArtifact: async () => {},
  getExportDownloadLink: async () => ({ url: "http://example.local/file", expiresAt: 0 }),
  resolveLocalObjectKeyPath: () => null,
  verifyLocalDownloadLink: () => false,
}));

vi.mock("../services/petascaleEnv", () => ({
  getPetascaleRuntimeConfig: () => ({ queueMaxAttempts: 3 }),
}));

vi.mock("../services/adminDataExportMetrics", () => ({
  onAdminExportJobCreated: () => {},
  onAdminExportJobExpired: () => {},
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { adminDataExportsRouter } = await import("./adminDataExports");
  const app = express();
  app.use(express.json());
  app.use("/api/admin/data-exports", adminDataExportsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to start test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}, HOOK_TIMEOUT_MS);

test("queues endpoint resolves to bull-board adapter route", async () => {
  const response = await fetch(`${baseUrl}/api/admin/data-exports/queues`);
  const body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("bull-board-ok");
  expect(body).not.toContain("Job not found");
});

