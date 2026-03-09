// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => {
  const selectWhere = vi.fn(async () => []);
  const selectLeftJoin2 = vi.fn(() => ({ where: selectWhere }));
  const selectLeftJoin1 = vi.fn(() => ({ leftJoin: selectLeftJoin2 }));
  const selectFrom = vi.fn(() => ({ leftJoin: selectLeftJoin1 }));
  const select = vi.fn(() => ({ from: selectFrom }));
  return {
    nowSec: 1,
    select,
    selectFrom,
    selectLeftJoin1,
    selectLeftJoin2,
    selectWhere,
  };
});

vi.mock("@db", () => ({
  db: {
    select: state.select,
    query: {
      globalSettings: {
        findFirst: async () => ({ maxTradesPerUser: 10, maxTradesPerInstrument: 3, maxConcurrentLots: 50, defaultLeverage: 50 }),
      },
    },
  },
}));

vi.mock("@shared/scalars", () => ({
  nowSec: () => state.nowSec,
  toFiniteNumber: (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  },
}));

vi.mock("@shared/trading/timeInForce", () => ({
  normalizeTimeInForce: (value: unknown, fallback: string) => String(value ?? fallback),
}));

vi.mock("../lib/margin", () => ({
  requiredMargin: () => 0,
}));

vi.mock("../recalcAccount", () => ({
  recalcAccount: async () => {},
}));

vi.mock("../services/liveBus", () => ({
  publishLiveEvent: () => {},
}));

vi.mock("../lib/realizedPnl", () => ({
  realizedPnlUsd: async () => 0,
}));

vi.mock("../services/identityAudit", () => ({
  appendIdentityAudit: async () => {},
}));

vi.mock("../policy/buildDecisionContext", () => ({
  buildDecisionContext: async () => ({}),
}));

vi.mock("@shared/policyDecision", () => ({
  decidePolicy: () => ({ allowed: true }),
}));

vi.mock("../policy/getPolicyConfig", () => ({
  loadPolicyConfig: async () => ({}),
}));

vi.mock("../services/tradeAtomic", () => ({
  applyUserBalanceDelta: async () => {},
  releaseUserMargin: async () => {},
  reserveUserMargin: async () => {},
}));

vi.mock("../services/tradeCosts", () => ({
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
    openCommissionUsd: 0,
    openOtherFeesUsd: 0,
    holdDays: 1,
  }),
  computeOpenSideCosts: () => ({
    totalCostsUsd: 0,
    openCommissionUsd: 0,
    openOtherFeesUsd: 0,
    financingAccruedUsd: 0,
    swapAccruedUsd: 0,
    overnightDays: 0,
    notionalUsd: 100000,
    categorySnapshot: "forex",
    costModelVersion: "test",
  }),
}));

vi.mock("../services/messaging", () => ({
  createNotification: async () => {},
}));

vi.mock("../trades/excursionTracking", () => ({
  clearTradeExcursion: () => {},
  initTradeExcursion: () => {},
  resolveTradeExcursionForCloseDurable: async () => ({
    intradayHigh: null,
    intradayLow: null,
    mae: null,
    mfe: null,
  }),
  trackTradeExcursion: async () => {},
}));

vi.mock("../recruitment/challengesV4/challengeService", () => ({
  getActiveTradeConstraintsForUser: async () => null,
}));

vi.mock("../lib/auditWriter", () => ({
  writeTradeAudit: async () => {},
  generateCorrelationId: () => "corr-1",
  generateOrderId: () => "order-1",
  generateExecutionId: () => "exec-1",
  generatePositionId: () => "pos-1",
  calculateSlippagePips: () => 0,
  calculateSpreadPips: () => 1.2,
}));

beforeEach(() => {
  vi.resetModules();
  state.nowSec = 1;
  state.select.mockClear();
  state.selectFrom.mockClear();
  state.selectLeftJoin1.mockClear();
  state.selectLeftJoin2.mockClear();
  state.selectWhere.mockReset();
  state.selectWhere.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("skips stale or malformed quote updates without running the expiry sweep before it is due", async () => {
  const { onQuotesUpdated } = await import("./orderEngine");

  await onQuotesUpdated([
    { symbol: "EURUSD", isStale: true, bid: 1.1, ask: 1.2 },
    { symbol: "", bid: 1.1, ask: 1.2 },
  ]);

  expect(state.select).not.toHaveBeenCalled();
}, 10_000);

test("runs the pending-expiry sweep when enough time has elapsed", async () => {
  state.nowSec = 10;
  const { onQuotesUpdated } = await import("./orderEngine");

  await onQuotesUpdated([]);

  expect(state.select).toHaveBeenCalled();
  expect(state.selectWhere).toHaveBeenCalledTimes(1);
}, 10_000);
