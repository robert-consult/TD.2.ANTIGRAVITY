import { describe, expect, it } from "vitest";
import { mergeGlobalSettingsPerformance } from "@/lib/globalSettingsPerformance";

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
      { restFallbackPollMs: 900, maxWsReconnectAttempts: 12 },
      2000,
    );

    expect(next.maintenanceMode).toBe(false);
    expect(next.restFallbackPollMs).toBeUndefined();
    expect(next.performanceSettings).toEqual({
      restFallbackPollMs: 900,
      quoteFlushIntervalMs: 50,
      maxWsReconnectAttempts: 12,
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
});
