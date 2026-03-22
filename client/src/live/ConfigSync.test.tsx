import { render } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ConfigSync } from "@/live/ConfigSync";
import { useAuth } from "@/hooks/use-auth";
import { useLiveUpdates } from "@/live/LiveUpdatesProvider";
import { useQueryClient } from "@tanstack/react-query";
import {
  mergeGlobalSettingsPerformance,
  resolveGlobalPerformanceSettingsPayload,
} from "@/lib/globalSettingsPerformance";

vi.mock("@/hooks/use-auth");
vi.mock("@/live/LiveUpdatesProvider");
vi.mock("@tanstack/react-query");

describe("mergeGlobalSettingsPerformance", () => {
  it("merges updates under performanceSettings without polluting the root object", () => {
    const previous = {
      maintenanceMode: false,
      updatedAt: 1000,
      performanceSettings: {
        restFallbackPollMs: 500,
        quoteFlushIntervalMs: 50,
      },
    };

    const next = mergeGlobalSettingsPerformance(
      previous,
      { restFallbackPollMs: 900, maxWsReconnectAttempts: 12, prefetchFastConcurrencyCap: 3 },
      2000,
    );

    expect(next.maintenanceMode).toBe(false);
    expect(next.restFallbackPollMs).toBeUndefined();
    expect(next.performanceSettings).toEqual({
      restFallbackPollMs: 900,
      quoteFlushIntervalMs: 50,
      maxWsReconnectAttempts: 12,
      prefetchFastConcurrencyCap: 3,
    });
    expect(next.updatedAt).toBe(2000);
  });

  it("creates a nested performanceSettings object when no prior settings object exists", () => {
    const next = mergeGlobalSettingsPerformance(
      null,
      { restFallbackPollMs: 700, quoteFlushIntervalMs: 120 },
      null,
    );

    expect(next.performanceSettings).toEqual({
      restFallbackPollMs: 700,
      quoteFlushIntervalMs: 120,
    });
    expect(next.restFallbackPollMs).toBeUndefined();
  });

  it("overrides stale nested values even when root-level legacy keys differ", () => {
    const previous = {
      restFallbackPollMs: 500,
      updatedAt: 1000,
      performanceSettings: {
        restFallbackPollMs: 500,
      },
    };

    const next = mergeGlobalSettingsPerformance(
      previous,
      { restFallbackPollMs: 1200 },
      2000,
    );

    expect(next.restFallbackPollMs).toBe(500);
    expect(next.performanceSettings).toEqual({ restFallbackPollMs: 1200 });
    expect(next.updatedAt).toBe(2000);
  });

  it("drops unknown performance keys from incoming patches", () => {
    const next = mergeGlobalSettingsPerformance(
      { performanceSettings: { restFallbackPollMs: 500 } },
      {
        restFallbackPollMs: 900,
        unknownKey: "ignored",
        "__proto__": { polluted: true },
      },
      2000,
    );

    expect(next.performanceSettings).toEqual({ restFallbackPollMs: 900 });
    expect((next.performanceSettings as any).unknownKey).toBeUndefined();
  });

  it("resolves nested performance payload values for consumers that read flattened fields", () => {
    const resolved = resolveGlobalPerformanceSettingsPayload({
      restFallbackPollMs: 500,
      performanceSettings: {
        restFallbackPollMs: 1200,
        prefetchFastConcurrencyCap: 2,
      },
    });

    expect(resolved.restFallbackPollMs).toBe(1200);
    expect(resolved.prefetchFastConcurrencyCap).toBe(2);
  });

  it("filters unknown nested performance keys when resolving payloads", () => {
    const resolved = resolveGlobalPerformanceSettingsPayload({
      performanceSettings: {
        restFallbackPollMs: 900,
        unknownKey: "ignored",
      },
    });

    expect(resolved.restFallbackPollMs).toBe(900);
    expect((resolved as any).unknownKey).toBeUndefined();
  });
});

describe("ConfigSync", () => {
  const invalidateQueries = vi.fn();
  const checkAuth = vi.fn();
  let liveUpdateHandler: ((message: unknown) => void) | null = null;

  beforeEach(() => {
    invalidateQueries.mockReset();
    checkAuth.mockReset();
    liveUpdateHandler = null;

    vi.mocked(useAuth).mockReturnValue({
      isAuthenticated: true,
      checkAuth,
    } as any);

    vi.mocked(useQueryClient).mockReturnValue({
      invalidateQueries,
      setQueryData: vi.fn(),
    } as any);

    vi.mocked(useLiveUpdates).mockReturnValue({
      isConnected: false,
      sendMessage: vi.fn(),
      subscribe: (listener: (message: unknown) => void) => {
        liveUpdateHandler = listener;
        return () => {};
      },
    } as any);
  });

  it("invalidates policy, jurisdiction, and enforcement caches when system config changes", () => {
    render(<ConfigSync />);
    expect(liveUpdateHandler).toBeTruthy();
    liveUpdateHandler?.({ type: "system-config:updated" });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/system-config/policy"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/system-config/jurisdiction-restrictions"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/legal-docs-v2/system-config/enforcement"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/runtime-config/governance"] });
  });

  it("invalidates grift and activity caches when abuse config changes", () => {
    render(<ConfigSync />);
    expect(liveUpdateHandler).toBeTruthy();

    liveUpdateHandler?.({ type: "grift-config:updated" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/grift/config"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/grift/config/effective"] });

    liveUpdateHandler?.({ type: "activity-config:updated" });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin-activity-config"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin-activity-users"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/activity/config/effective"] });
  });

  it("invalidates the governance snapshot when global or provider runtime state changes", () => {
    render(<ConfigSync />);
    expect(liveUpdateHandler).toBeTruthy();

    liveUpdateHandler?.({
      type: "global-settings:updated",
      payload: { performanceSettings: { restFallbackPollMs: 700 } },
    });
    liveUpdateHandler?.({ type: "market-data:providers-updated" });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/runtime-config/governance"] });
  });
});
