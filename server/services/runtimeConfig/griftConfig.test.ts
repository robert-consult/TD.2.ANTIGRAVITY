// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_GRIFT_CONFIG } from "../../grift/griftDefaults";
import {
  getGriftEffectiveConfigState,
  resolveGriftRuntimePolicy,
} from "./griftConfig";

describe("grift runtime config", () => {
  it("falls back to canonical defaults when no row exists", () => {
    const resolved = resolveGriftRuntimePolicy(null);
    expect(resolved).toMatchObject({
      id: DEFAULT_GRIFT_CONFIG.id,
      enabled: DEFAULT_GRIFT_CONFIG.enabled,
      multiAccountWindowDays: DEFAULT_GRIFT_CONFIG.multiAccountWindowDays,
      enforcementDisableThreshold: DEFAULT_GRIFT_CONFIG.enforcementDisableThreshold,
    });
  });

  it("builds effective state with DB-backed policy and read-only engine caps", async () => {
    const db = {
      prepare: () => ({
        get: async () => ({
          id: 1,
          enabled: 0,
          multi_account_window_days: 21,
          tier_high: 55,
          updated_at: 1700000000,
        }),
      }),
    };

    const effective = await getGriftEffectiveConfigState(db as any);

    expect(effective.source).toBe("DB");
    expect(effective.policy.enabled).toBe(0);
    expect(effective.policy.multiAccountWindowDays).toBe(21);
    expect(effective.policy.tierHigh).toBe(55);
    expect(effective.engineCaps.configTtlMs).toBeGreaterThan(0);
    expect(effective.engineCaps.maxLinkedEdgeWritesPerTrigger).toBeGreaterThan(0);
    expect(effective.engineCaps.maxEvidenceLinkedUsers).toBeGreaterThan(0);
    expect(effective.engineCaps.maxLinkedEdgeBatchRows).toBeGreaterThan(0);
  });
});
