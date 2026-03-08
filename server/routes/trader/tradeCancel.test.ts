// @vitest-environment node
import express from "express";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

const HOOK_TIMEOUT_MS = 30_000;

const state = vi.hoisted(() => {
  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return {
    broadcast: vi.fn(),
    cancelTrade: vi.fn(),
    getExecutionQuote: vi.fn(),
    getTradeById: vi.fn(),
    update,
    updateSet,
    updateWhere,
    writeTradeAudit: vi.fn(async () => {}),
  };
});

vi.mock("@db", () => ({
  db: {
    update: state.update,
  },
}));

vi.mock("@db/config", () => ({
  isPostgres: false,
}));

vi.mock("../../storage", () => ({
  storage: {
    getTradeById: state.getTradeById,
    cancelTrade: state.cancelTrade,
  },
}));

vi.mock("../../risk", () => ({
  riskMiddleware: (_req: any, _res: any, next: any) => next(),
  getEffectiveMinHoldSec: async () => 0,
}));

vi.mock("../../middleware/requirePolicy", () => ({
  requirePolicy: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../recalcAccount", () => ({
  recalcAccount: async () => {},
}));

vi.mock("../../services/quoteService", () => ({
  getExecutionQuote: state.getExecutionQuote,
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
  computeOpenSideCosts: () => ({}),
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
  calculateSpreadPips: () => 1.2,
  generateCorrelationId: () => "corr-generated",
  generateExecutionId: () => "exec-1",
  generateOrderId: () => "order-generated",
  generatePositionId: () => "pos-generated",
  writeOrderIntentAudit: async () => {},
  writeTradeAudit: state.writeTradeAudit,
}));

vi.mock("../../recruitment/challengesV4/challengeService", () => ({
  getActiveTradeConstraintsForUser: async () => null,
}));

vi.mock("../../services/globalSettings", () => ({
  getGlobalSettingsCached: async () => ({}),
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
  incTradeCloseRejectedQuoteStaleTotal: () => {},
  incTradeTargetsRejectedQuoteStaleTotal: () => {},
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { registerTradeCancelRoute } = await import("./tradeCancel");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).sessionID = "sess-1";
    (req as any).session = { userId: 7 };
    next();
  });

  const router = express.Router();
  registerTradeCancelRoute(router, {
    ensureAuth: (_req, _res, next) => next(),
    ensureDoc1TermsAccepted: (_req, _res, next) => next(),
    broadcast: state.broadcast,
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

beforeEach(() => {
  state.broadcast.mockClear();
  state.cancelTrade.mockReset();
  state.getExecutionQuote.mockReset();
  state.getTradeById.mockReset();
  state.update.mockClear();
  state.updateSet.mockClear();
  state.updateWhere.mockClear();
  state.writeTradeAudit.mockClear();
});

test("rejects cancel requests for trades that are not pending", async () => {
  state.getTradeById.mockResolvedValue({
    id: 22,
    userId: 7,
    status: "OPEN",
  });

  const response = await fetch(`${baseUrl}/api/trades/22/cancel`, {
    method: "PATCH",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    message: "Trade is not pending",
  });
});

test("cancels pending trades and broadcasts the update", async () => {
  state.getTradeById.mockResolvedValue({
    id: 23,
    userId: 7,
    symbolId: 1,
    type: "BUY",
    status: "PENDING",
    orderType: "LIMIT",
    timeInForce: "GTC",
    lots: 1,
    limitPrice: 1.25,
    stopPrice: null,
    correlationId: "corr-existing",
    orderId: "order-existing",
    positionId: "pos-existing",
    symbol: {
      id: 1,
      symbol: "EURUSD",
      pipDecimals: 4,
    },
  });
  state.getExecutionQuote.mockResolvedValue({
    symbol: "EURUSD",
    bid: 1.2499,
    ask: 1.2501,
    mid: 1.25,
    spread: 0.0002,
    quoteTs: new Date("2026-03-08T12:00:00Z"),
    source: "quotes_db",
  });
  state.cancelTrade.mockResolvedValue({
    id: 23,
    status: "CANCELED",
  });

  const response = await fetch(`${baseUrl}/api/trades/23/cancel`, {
    method: "PATCH",
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: 23,
    status: "CANCELED",
  });
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(state.writeTradeAudit).toHaveBeenCalledTimes(1);
  expect(state.broadcast).toHaveBeenCalledTimes(1);
});
