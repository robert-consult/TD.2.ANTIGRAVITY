// @vitest-environment node
import express from "express";
import http from "node:http";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;

const state = vi.hoisted(() => ({
  policyAction: undefined as unknown,
}));

vi.mock("@db", () => ({
  db: {},
}));

vi.mock("@db/config", () => ({
  isPostgres: false,
}));

vi.mock("../../storage", () => ({
  storage: {
    getSymbolConfigById: vi.fn(),
    getUserById: vi.fn(),
    createTrade: vi.fn(),
    updateUserBalance: vi.fn(),
  },
}));

vi.mock("../../risk", () => ({
  riskMiddleware: (_req: any, _res: any, next: any) => next(),
  getEffectiveMinHoldSec: async () => 0,
}));

vi.mock("../../middleware/requirePolicy", () => ({
  requirePolicy: (action: unknown) => {
    state.policyAction = action;
    return (_req: any, _res: any, next: any) => next();
  },
}));

vi.mock("../../recalcAccount", () => ({
  recalcAccount: async () => {},
}));

vi.mock("../../services/quoteService", () => ({
  getExecutionQuote: async () => {
    throw new Error("getExecutionQuote should not run in this test path");
  },
  validateExecutionQuoteAtCommit: async () => ({ ok: true }),
}));

vi.mock("../../services/tradeAtomic", () => ({
  applyUserBalanceDelta: async () => {},
  releaseUserMargin: async () => {},
  reserveUserMargin: async () => {},
}));

vi.mock("../../lib/realizedPnl", () => ({
  realizedPnlUsd: async () => 0,
}));

vi.mock("../../services/tradeCosts", () => ({
  computeCloseSettlementCosts: async () => ({}),
  computeOpenSideCosts: () => ({
    totalCostsUsd: 0,
    openCommissionUsd: 0,
    openOtherFeesUsd: 0,
    financingAccruedUsd: 0,
    swapAccruedUsd: 0,
    overnightDays: 0,
    notionalUsd: 0,
    categorySnapshot: null,
    costModelVersion: "test",
  }),
}));

vi.mock("../../trades/excursionTracking", () => ({
  clearTradeExcursion: () => {},
  initTradeExcursion: () => {},
  resolveTradeExcursionForClose: async () => ({}),
}));

vi.mock("../../lib/auditContext", () => ({
  buildAuditContext: () => ({
    correlationId: "corr-1",
    actorType: "USER",
    actorUserId: 7,
    sessionId: "sess-1",
    ip: "127.0.0.1",
    userAgent: "vitest",
  }),
}));

vi.mock("../../lib/auditWriter", () => ({
  calculateSlippagePips: () => 0,
  calculateSpreadPips: () => 0,
  generateCorrelationId: () => "corr-1",
  generateExecutionId: () => "exec-1",
  generateOrderId: () => "order-1",
  generatePositionId: () => "pos-1",
  writeOrderIntentAudit: async () => {},
  writeTradeAudit: async () => {},
}));

vi.mock("../../recruitment/challengesV4/challengeService", () => ({
  getActiveTradeConstraintsForUser: async () => null,
}));

vi.mock("../../services/globalSettings", () => ({
  getGlobalSettingsCached: async () => ({ maxPositionSize: 5_000_000, minPriceDistancePips: 20 }),
  getMinPriceDistancePips: () => 20,
  sanitizeMinPriceDistancePips: (value: unknown) => Number(value ?? 20),
}));

vi.mock("../../security/botGuard", () => ({
  botGuard: async () => ({ allowed: true }),
}));

vi.mock("../../grift/griftGeo", () => ({
  extractGriftContext: () => ({}),
}));

vi.mock("../../grift/griftDb", () => ({
  withGriftClient: async () => {},
}));

vi.mock("../../grift/griftAutoEnforcement", () => ({
  maybeApplyAutoEnforcement: async () => null,
}));

vi.mock("../../grift/griftEngine", () => ({
  onSessionActivity: async () => {},
  onTradeSubmit: async () => {},
}));

vi.mock("../../lib/priceUtils", () => ({
  priceGreaterThan: (left: number, right: number) => left > right,
  priceGreaterThanOrEqual: (left: number, right: number) => left >= right,
  priceLessThan: (left: number, right: number) => left < right,
  priceLessThanOrEqual: (left: number, right: number) => left <= right,
  ticksToPrice: (ticks: number) => ticks,
  toTicks: (price: number) => price,
}));

vi.mock("../metricsState", () => ({
  incTradeOpenRejectedQuoteRevalidationTotal: () => {},
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { registerTradeOpenRoute } = await import("./tradeOpen");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).sessionID = "sess-1";
    (req as any).session = { userId: 7 };
    next();
  });

  const router = express.Router();
  registerTradeOpenRoute(router, {
    ensureAuth: (_req, _res, next) => next(),
    ensureDoc1TermsAccepted: (_req, _res, next) => next(),
    broadcast: () => {},
  });
  app.use(router);

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

test("resolves the policy action from the requested order type", () => {
  expect(typeof state.policyAction).toBe("function");
  const actionResolver = state.policyAction as (req: { body?: { orderType?: unknown } }) => string;

  expect(actionResolver({ body: {} })).toBe("TRADE_OPEN_OR_INCREASE");
  expect(actionResolver({ body: { orderType: "Market" } })).toBe("TRADE_OPEN_OR_INCREASE");
  expect(actionResolver({ body: { orderType: "Limit" } })).toBe("TRADE_PLACE_PENDING");
  expect(actionResolver({ body: { orderType: "Stop" } })).toBe("TRADE_PLACE_PENDING");
});

test("rejects invalid time-in-force values before trade execution work starts", async () => {
  const response = await fetch(`${baseUrl}/api/trades`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbolId: 1,
      type: "BUY",
      size: 1,
      timeInForce: "BAD",
    }),
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    message: expect.stringContaining("timeInForce must be one of"),
  });
});
