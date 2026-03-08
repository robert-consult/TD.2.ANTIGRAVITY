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
    getExecutionQuote: vi.fn(),
    getSymbolConfigById: vi.fn(),
    getTradeById: vi.fn(),
    getEffectiveMinHoldSec: vi.fn(),
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
    getSymbolConfigById: state.getSymbolConfigById,
  },
}));

vi.mock("../../risk", () => ({
  riskMiddleware: (_req: any, _res: any, next: any) => next(),
  getEffectiveMinHoldSec: state.getEffectiveMinHoldSec,
}));

vi.mock("../../middleware/requirePolicy", () => ({
  requirePolicy: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../recalcAccount", () => ({
  recalcAccount: async () => {},
}));

vi.mock("../../services/quoteService", () => ({
  getExecutionQuote: state.getExecutionQuote,
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
  computeCloseSettlementCosts: async () => ({
    totalCostsUsd: 0,
    closingChargesUsd: 0,
    notionalUsd: 100000,
    closeCommissionUsd: 0,
    closeOtherFeesUsd: 0,
    financingAccruedUsd: 0,
    swapAccruedUsd: 0,
    overnightDays: 0,
    categorySnapshot: "forex",
    costModelVersion: "test",
  }),
  computeOpenSideCosts: () => ({}),
}));

vi.mock("../../trades/excursionTracking", () => ({
  clearTradeExcursion: () => {},
  initTradeExcursion: () => {},
  resolveTradeExcursionForCloseDurable: async () => ({
    intradayHigh: null,
    intradayLow: null,
    mae: null,
    mfe: null,
  }),
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
  getGlobalSettingsCached: async () => ({ minPriceDistancePips: 20 }),
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
  incTradeCloseRejectedQuoteRevalidationTotal: () => {},
  incTradeTargetsRejectedQuoteStaleTotal: () => {},
}));

let server: http.Server | undefined;
let baseUrl = "";

beforeAll(async () => {
  const { registerTradeCloseRoute } = await import("./tradeClose");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).sessionID = "sess-1";
    (req as any).session = { userId: 7 };
    next();
  });

  const router = express.Router();
  registerTradeCloseRoute(router, {
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

beforeEach(() => {
  state.getExecutionQuote.mockReset();
  state.getSymbolConfigById.mockReset();
  state.getTradeById.mockReset();
  state.getEffectiveMinHoldSec.mockReset();
  state.update.mockClear();
  state.updateSet.mockClear();
  state.updateWhere.mockClear();
  state.writeTradeAudit.mockClear();

  state.getSymbolConfigById.mockResolvedValue({
    id: 1,
    symbol: "USDJPY",
    category: "forex",
    quoteCurrency: "JPY",
    pipDecimals: 2,
    quoteDecimals: 3,
  });
  state.getEffectiveMinHoldSec.mockResolvedValue(0);
});

test("rejects manual closes that violate the minimum hold time", async () => {
  state.getTradeById.mockResolvedValue({
    id: 11,
    userId: 7,
    symbolId: 1,
    type: "BUY",
    status: "OPEN",
    openedAt: Math.floor(Date.now() / 1000),
    openPrice: 150,
    lots: 1,
    symbol: {
      id: 1,
      symbol: "USDJPY",
      pipDecimals: 2,
    },
  });
  state.getEffectiveMinHoldSec.mockResolvedValue(3600);

  const response = await fetch(`${baseUrl}/api/trades/11/close`, {
    method: "POST",
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    code: "MIN_HOLD_TIME",
    minHoldSec: 3600,
  });
});

test("rejects stale quotes before attempting the close transaction", async () => {
  state.getTradeById.mockResolvedValue({
    id: 12,
    userId: 7,
    symbolId: 1,
    type: "BUY",
    status: "OPEN",
    openedAt: Math.floor(Date.now() / 1000) - 7200,
    openPrice: 150,
    lots: 1,
    correlationId: null,
    orderId: null,
    positionId: null,
    symbol: {
      id: 1,
      symbol: "USDJPY",
      category: "forex",
      quoteCurrency: "JPY",
      pipDecimals: 2,
      quoteDecimals: 3,
    },
  });
  state.getExecutionQuote.mockResolvedValue({
    symbol: "USDJPY",
    execPrice: 150.1,
    bid: 150.09,
    ask: 150.11,
    mid: 150.1,
    spread: 0.02,
    marketOpen: true,
    isStale: true,
    quoteTs: new Date(Date.now() - 5_000),
    source: "quotes_db",
  });

  const response = await fetch(`${baseUrl}/api/trades/12/close`, {
    method: "POST",
  });

  expect(response.status).toBe(409);
  expect(response.headers.get("Retry-After")).toBe("1");
  await expect(response.json()).resolves.toMatchObject({
    code: "QUOTE_STALE_CLOSE",
    symbol: "USDJPY",
  });
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(state.writeTradeAudit).toHaveBeenCalledTimes(1);
});
