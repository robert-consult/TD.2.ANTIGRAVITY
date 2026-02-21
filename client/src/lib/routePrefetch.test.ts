import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfHints, PerformanceTier } from "@/lib/perfHints";
import { DEFAULT_PERFORMANCE_SETTINGS } from "@/lib/perfHints";
import { prefetchAllRoutes, resetRoutePrefetchForTests } from "@/lib/routePrefetch";

let originalServiceWorkerDescriptor: PropertyDescriptor | undefined;

function buildHints(networkTier: PerformanceTier): PerfHints {
  const constrained = networkTier === "CONSTRAINED" || networkTier === "MINIMAL";
  return {
    effectiveType: "4g",
    saveData: false,
    rttMs: 80,
    downlinkMbps: 12,
    deviceMemoryGB: 8,
    hardwareConcurrency: 8,
    isNetworkConstrained: constrained,
    isDeviceConstrained: false,
    isConstrained: constrained,
    networkTier,
    deviceTier: "FAST",
    tier: constrained ? networkTier : "FAST",
  };
}

describe("routePrefetch scheduling", () => {
  beforeEach(() => {
    originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    vi.useFakeTimers();
    resetRoutePrefetchForTests();
  });

  afterEach(() => {
    if (originalServiceWorkerDescriptor) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
    } else {
      // navigator.serviceWorker is configurable in jsdom test runtime.
      delete (navigator as any).serviceWorker;
    }
    resetRoutePrefetchForTests();
    vi.useRealTimers();
  });

  it("does not schedule duplicate work for an identical plan", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    prefetchAllRoutes({
      hints: buildHints("FAST"),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 2000,
    });
    prefetchAllRoutes({
      hints: buildHints("FAST"),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 2000,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });

  it("reschedules when the tier plan changes materially", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    prefetchAllRoutes({
      hints: buildHints("CONSTRAINED"),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 5000,
    });
    prefetchAllRoutes({
      hints: buildHints("FAST"),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 2000,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls[1]?.[1]).toBe(2000);
    setTimeoutSpy.mockRestore();
  });

  it("allows the same plan to run again after the previous schedule starts", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const instantHints: PerfHints = {
      ...buildHints("INSTANT"),
      deviceTier: "INSTANT",
      tier: "INSTANT",
    };

    prefetchAllRoutes({
      hints: instantHints,
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 1200,
    });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    vi.runOnlyPendingTimers();

    prefetchAllRoutes({
      hints: instantHints,
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 1200,
    });

    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    setTimeoutSpy.mockRestore();
  });

  it("delegates burst prefetch to service worker when controlled", () => {
    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: { postMessage },
      },
    });

    prefetchAllRoutes({
      hints: buildHints("FAST"),
      settings: DEFAULT_PERFORMANCE_SETTINGS,
      startDelayMs: 0,
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "prefetch:burst",
      }),
    );
  });
});
