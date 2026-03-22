// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@db", () => ({
  db: {
    query: {
      systemConfig: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import {
  BOT_GUARD_HEURISTIC_VERSION,
  buildActivityConfigWrite,
  resolveActivityLifecycleConfig,
  resolveBotGuardConfig,
} from "./botConfig";

describe("bot/activity runtime config", () => {
  it("normalizes coarse bot guard controls and derives the trade proof threshold", () => {
    const resolved = resolveBotGuardConfig({
      botScoreThreshold: 18,
      botPowEnabled: 1,
      botPowEnforceSignup: 0,
      botPowEnforceLogin: 1,
      botPowChallengeScore: 96,
      botPowBaseDifficulty: 24,
      botPowMaxDifficulty: 10,
      botPowTtlSec: 5,
      botValkeyEnabled: 0,
    } as any);

    expect(resolved.botScoreThreshold).toBe(18);
    expect(resolved.powEnabled).toBe(true);
    expect(resolved.powEnforceSignup).toBe(false);
    expect(resolved.powEnforceLogin).toBe(true);
    expect(resolved.powChallengeScore).toBe(96);
    expect(resolved.tradePowChallengeScore).toBe(100);
    expect(resolved.powBaseDifficulty).toBe(24);
    expect(resolved.powMaxDifficulty).toBe(24);
    expect(resolved.powTtlSec).toBe(10);
    expect(resolved.valkeyEnabled).toBe(false);
    expect(resolved.heuristicVersion).toBe(BOT_GUARD_HEURISTIC_VERSION);
  });

  it("normalizes lifecycle controls and emits a canonical write patch", () => {
    const lifecycle = resolveActivityLifecycleConfig({
      inactivityThresholdDays: 0,
      deletionGraceDays: 99999,
      botScoreThreshold: 101,
      activityAutoQueueInactive: 0,
      activityAutoSoftDelete: 1,
    } as any);

    expect(lifecycle).toEqual({
      inactivityThresholdDays: 1,
      deletionGraceDays: 3650,
      botScoreThreshold: 100,
      autoQueueInactive: false,
      autoSoftDelete: true,
    });

    const patch = buildActivityConfigWrite({
      inactivityThresholdDays: 90,
      deletionGraceDays: 45,
      botScoreThreshold: 33,
      botPowEnabled: true,
      botPowEnforceSignup: true,
      botPowEnforceLogin: false,
      botPowChallengeScore: 40,
      botPowBaseDifficulty: 14,
      botPowMaxDifficulty: 20,
      botPowTtlSec: 120,
      botValkeyEnabled: true,
      activityAutoQueueInactive: true,
      activityAutoSoftDelete: false,
    } as any);

    expect(patch).toMatchObject({
      inactivityThresholdDays: 90,
      deletionGraceDays: 45,
      botScoreThreshold: 33,
      botPowChallengeScore: 40,
      botPowBaseDifficulty: 14,
      botPowMaxDifficulty: 20,
      activityAutoQueueInactive: true,
      activityAutoSoftDelete: false,
    });
  });
});
