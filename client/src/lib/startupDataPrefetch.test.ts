import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfHints, PerformanceTier } from "@/lib/perfHints";
import { DEFAULT_PERFORMANCE_SETTINGS } from "@/lib/perfHints";
import {
  prefetchStartupData,
  resetStartupDataPrefetchForTests,
} from "@/lib/startupDataPrefetch";

function buildHints(options?: {
  networkTier?: PerformanceTier;
  deviceTier?: PerformanceTier;
  saveData?: boolean;
}): PerfHints {
  const networkTier = options?.networkTier ?? "FAST";
  const deviceTier = options?.deviceTier ?? "FAST";
  const saveData = Boolean(options?.saveData);

  return {
    effectiveType: networkTier === "CONSTRAINED" || networkTier === "MINIMAL" ? "3g" : "4g",
    saveData,
    rttMs: networkTier === "INSTANT" ? 40 : 120,
    downlinkMbps: networkTier === "INSTANT" ? 20 : 8,
    deviceMemoryGB: deviceTier === "MINIMAL" ? 1 : 8,
    hardwareConcurrency: deviceTier === "MINIMAL" ? 1 : 8,
    isNetworkConstrained: networkTier === "CONSTRAINED" || networkTier === "MINIMAL",
    isDeviceConstrained: deviceTier === "CONSTRAINED" || deviceTier === "MINIMAL",
    isConstrained:
      networkTier === "CONSTRAINED" ||
      networkTier === "MINIMAL" ||
      deviceTier === "CONSTRAINED" ||
      deviceTier === "MINIMAL",
    networkTier,
    deviceTier,
    tier:
      networkTier === "MINIMAL" || deviceTier === "MINIMAL"
        ? "MINIMAL"
        : networkTier === "CONSTRAINED" || deviceTier === "CONSTRAINED"
          ? "CONSTRAINED"
          : networkTier,
  };
}

type QueryClientLike = {
  prefetchQuery: ReturnType<typeof vi.fn>;
  getQueryData: ReturnType<typeof vi.fn>;
};

function createQueryClientMock(): QueryClientLike {
  const store = new Map<string, unknown>();
  const prefetchQuery = vi.fn(async (options: any) => {
    const key = Array.isArray(options?.queryKey) ? options.queryKey : [];
    const keyHead = String(key[0] || "");
    if (keyHead === "/api/quote-subscriptions/allowed-symbols") {
      store.set(keyHead, {
        symbols: [{ symbol: "USDJPY" }, { symbol: "EURUSD" }],
      });
    }
    return null;
  });

  const getQueryData = vi.fn((queryKey: any) => {
    if (!Array.isArray(queryKey)) return null;
    return store.get(String(queryKey[0] || "")) ?? null;
  });

  return {
    prefetchQuery,
    getQueryData,
  };
}

async function flushPrefetchWork(): Promise<void> {
  await vi.runAllTimersAsync();
  await Promise.resolve();
  await Promise.resolve();
}

describe("startupDataPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStartupDataPrefetchForTests();
  });

  afterEach(() => {
    resetStartupDataPrefetchForTests();
    vi.useRealTimers();
  });

  it("dedupes identical scheduled startup plans", () => {
    const queryClient = createQueryClientMock();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    prefetchStartupData({
      queryClient: queryClient as any,
      phase: "public",
      hints: buildHints(),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 500,
    });
    prefetchStartupData({
      queryClient: queryClient as any,
      phase: "public",
      hints: buildHints(),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 500,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });

  it("prefetches authenticated startup queries and latest quotes", async () => {
    const queryClient = createQueryClientMock();

    prefetchStartupData({
      queryClient: queryClient as any,
      phase: "authenticated",
      hints: buildHints({ networkTier: "FAST", deviceTier: "FAST" }),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 0,
    });

    await flushPrefetchWork();

    const queryKeys = queryClient.prefetchQuery.mock.calls
      .map((call) => call[0]?.queryKey)
      .filter(Array.isArray);

    expect(queryKeys).toContainEqual(["/api/auth/current-user"]);
    expect(queryKeys).toContainEqual(["/api/account/summary"]);
    expect(queryKeys).toContainEqual(["/api/quote-subscriptions/allowed-symbols"]);
    expect(queryKeys).toContainEqual(["/api/trades/open"]);
    expect(queryKeys).toContainEqual(["/api/trades/pending"]);
    expect(queryKeys).toContainEqual(["/api/trades"]);
    expect(queryKeys).toContainEqual(["/api/quotes/latest", ["USDJPY", "EURUSD"]]);

    const findIndexByHead = (head: string) =>
      queryKeys.findIndex((key) => Array.isArray(key) && String(key[0]) === head);
    const idxAllowed = findIndexByHead("/api/quote-subscriptions/allowed-symbols");
    const idxLatest = findIndexByHead("/api/quotes/latest");
    const idxTrades = findIndexByHead("/api/trades");
    expect(idxAllowed).toBeGreaterThanOrEqual(0);
    expect(idxLatest).toBeGreaterThanOrEqual(0);
    expect(idxTrades).toBeGreaterThanOrEqual(0);
    expect(idxAllowed).toBeLessThan(idxTrades);
    expect(idxLatest).toBeLessThan(idxTrades);
  });

  it("skips startup data prefetch when data-saver is enabled", async () => {
    const queryClient = createQueryClientMock();

    prefetchStartupData({
      queryClient: queryClient as any,
      phase: "authenticated",
      hints: buildHints({ saveData: true }),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 0,
    });

    await flushPrefetchWork();
    expect(queryClient.prefetchQuery).not.toHaveBeenCalled();
  });
});
