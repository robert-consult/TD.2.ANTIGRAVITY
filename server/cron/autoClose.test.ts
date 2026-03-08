// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {
    enableAutoClose: true,
    autoCloseAfterDays: 4,
    autoCloseCheckFrequencyMinutes: 60,
  },
  getOldOpenTrades: vi.fn(),
  liveHandler: undefined as ((event: unknown) => void) | undefined,
  log: vi.fn(),
}));

vi.mock("@db", () => ({
  db: {
    query: {
      globalSettings: {
        findFirst: async () => ({ ...state.settings }),
      },
    },
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getOldOpenTrades: state.getOldOpenTrades,
    getSymbolConfigById: vi.fn(),
  },
}));

vi.mock("../vite", () => ({
  log: state.log,
}));

vi.mock("../recalcAccount", () => ({
  recalcAccount: async () => {},
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
  onLiveEvent: (handler: (event: unknown) => void) => {
    state.liveHandler = handler;
    return () => {
      state.liveHandler = undefined;
    };
  },
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
    holdDays: 4,
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
  vi.setSystemTime(new Date("2026-03-08T12:00:00Z"));
  vi.resetModules();
  state.settings = {
    enableAutoClose: true,
    autoCloseAfterDays: 4,
    autoCloseCheckFrequencyMinutes: 60,
  };
  state.getOldOpenTrades.mockReset();
  state.getOldOpenTrades.mockResolvedValue([]);
  state.liveHandler = undefined;
  state.log.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("starts the scheduler and runs the auto-close job on the configured cadence", async () => {
  const { startAutoCloseScheduler } = await import("./autoClose");

  await startAutoCloseScheduler();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

  expect(state.getOldOpenTrades).toHaveBeenCalledTimes(1);
  expect(state.log).toHaveBeenCalledWith(expect.stringContaining("Auto-close scheduled to run every 60 minutes"));
});

test("reschedules when live settings updates are published", async () => {
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  const { startAutoCloseScheduler } = await import("./autoClose");

  await startAutoCloseScheduler();
  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  expect(setIntervalSpy.mock.calls[0]?.[1]).toBe(60 * 60 * 1000);

  state.settings.autoCloseCheckFrequencyMinutes = 5;
  expect(state.liveHandler).toBeTypeOf("function");
  state.liveHandler?.({ type: "global-settings:updated" });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  expect(setIntervalSpy.mock.calls[1]?.[1]).toBe(5 * 60 * 1000);
});
