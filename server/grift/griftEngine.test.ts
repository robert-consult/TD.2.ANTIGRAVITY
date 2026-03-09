// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkMultiAccountDevice,
  getConfig,
  invalidateConfigCache,
} from "./griftEngine";

function createGriftDb(input: {
  configRow?: Record<string, unknown> | null;
  deviceUsers?: Array<{ user_id: number }>;
}) {
  const state = {
    configGetCount: 0,
    recordedEdgeParams: [] as Array<Array<number | string>>,
  };

  const db = {
    prepare(sql: string) {
      if (sql.includes("SELECT * FROM grift_config")) {
        return {
          get: async () => {
            state.configGetCount += 1;
            return input.configRow ?? null;
          },
        };
      }

      if (sql.includes("SELECT DISTINCT user_id FROM grift_device_users")) {
        return {
          all: async () => input.deviceUsers ?? [],
        };
      }

      if (sql.includes("INSERT INTO grift_linked_account_edges")) {
        return {
          run: async (...params: Array<number | string>) => {
            state.recordedEdgeParams.push(params);
          },
        };
      }

      throw new Error(`Unexpected SQL in test double: ${sql}`);
    },
  };

  return { db, state };
}

describe("griftEngine", () => {
  beforeEach(() => {
    invalidateConfigCache();
  });

  it("caches config rows until invalidated", async () => {
    const input = {
      configRow: {
        id: 1,
        enabled: 0,
        multi_account_window_days: 14,
      },
    };
    const { db, state } = createGriftDb(input);

    const first = await getConfig(db as any);
    input.configRow = {
      id: 1,
      enabled: 1,
      multi_account_window_days: 99,
    };
    const second = await getConfig(db as any);

    expect(first.enabled).toBe(0);
    expect(second.enabled).toBe(0);
    expect(second.multiAccountWindowDays).toBe(14);
    expect(state.configGetCount).toBe(1);

    invalidateConfigCache();
    const third = await getConfig(db as any);
    expect(third.enabled).toBe(1);
    expect(third.multiAccountWindowDays).toBe(99);
    expect(state.configGetCount).toBe(2);
  });

  it("flags linked accounts seen on the same device and records the linkage edges", async () => {
    const { db, state } = createGriftDb({
      configRow: {
        id: 1,
        multi_account_window_days: 30,
        score_multi_account_device: 65,
        tier_med: 20,
        tier_high: 60,
        tier_critical: 90,
      },
      deviceUsers: [
        { user_id: 44 },
        { user_id: 12 },
        { user_id: 7 },
      ],
    });

    const trigger = await checkMultiAccountDevice(db as any, {
      ts: Date.now(),
      userId: 7,
      deviceId: "device-abc",
    });

    expect(trigger).toMatchObject({
      ruleCode: "MULTI_ACCOUNT_DEVICE",
      severity: "HIGH",
      primaryUserId: 7,
      secondaryUserId: 12,
      points: 65,
      evidence: {
        deviceId: "device-abc",
        linkedUsers: [12, 44],
        linkedUsersTotal: 2,
        edgesRecorded: 2,
        truncated: false,
      },
    });
    expect(state.recordedEdgeParams).toHaveLength(1);
    expect(state.recordedEdgeParams[0]).toEqual([
      7,
      12,
      "device",
      "device-abc",
      expect.any(Number),
      expect.any(Number),
      7,
      44,
      "device",
      "device-abc",
      expect.any(Number),
      expect.any(Number),
    ]);
  });
});
