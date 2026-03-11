// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  log: vi.fn(),
}));

let marginCallModule: Awaited<typeof import("./marginCall")> | null = null;

vi.mock("@db", () => ({
  db: {
    execute: state.dbExecute,
    query: {
      trades: {
        findMany: vi.fn(),
      },
    },
    transaction: vi.fn(),
  },
}));

vi.mock("../vite", () => ({
  log: state.log,
}));

vi.mock("../recalcAccount", () => ({
  recalcAccount: async () => null,
}));

vi.mock("../services/quoteService", () => ({
  getExecutionQuote: async () => {
    throw new Error("no quote expected");
  },
}));

vi.mock("../lib/realizedPnl", () => ({
  realizedPnlUsd: async () => 0,
}));

vi.mock("../lib/margin", () => ({
  requiredMargin: () => 0,
}));

vi.mock("../lib/auditWriter", () => ({
  writeTradeAudit: async () => {},
  generateCorrelationId: () => "corr-1",
  generateOrderId: () => "order-1",
  generateExecutionId: () => "exec-1",
  generatePositionId: () => "pos-1",
  calculateSpreadPips: () => 1.2,
}));

vi.mock("../services/liveBus", () => ({
  onLiveEvent: () => () => {},
  publishLiveEvent: () => {},
}));

vi.mock("../services/tradeAtomic", () => ({
  applyUserBalanceDelta: async () => {},
  releaseUserMargin: async () => {},
}));

vi.mock("../services/messaging", () => ({
  createNotification: async () => {},
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
  }),
}));

vi.mock("../trades/excursionTracking", () => ({
  clearTradeExcursion: () => {},
  resolveTradeExcursionForCloseDurable: async () => ({
    intradayHigh: null,
    intradayLow: null,
    mae: null,
    mfe: null,
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  state.dbExecute.mockReset();
  state.dbExecute.mockResolvedValue({ rows: [] });
  state.log.mockClear();
});

afterEach(() => {
  marginCallModule?.stopMarginCallScheduler();
  marginCallModule = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("starts the scheduler once and polls on the fixed cadence", async () => {
  marginCallModule = await import("./marginCall");
  const { startMarginCallScheduler } = marginCallModule;

  await startMarginCallScheduler();
  await vi.advanceTimersByTimeAsync(15_000);

  expect(state.dbExecute).toHaveBeenCalledTimes(1);
  expect(state.log).toHaveBeenCalledWith(expect.stringContaining("Starting Margin Call"));
}, 30_000);

test("does not register duplicate polling intervals on repeated starts", async () => {
  marginCallModule = await import("./marginCall");
  const { startMarginCallScheduler } = marginCallModule;

  await startMarginCallScheduler();
  await startMarginCallScheduler();
  await vi.advanceTimersByTimeAsync(15_000);

  expect(state.dbExecute).toHaveBeenCalledTimes(1);
  expect(
    state.log.mock.calls.filter(([message]) => String(message).includes("Starting Margin Call")),
  ).toHaveLength(1);
}, 30_000);
