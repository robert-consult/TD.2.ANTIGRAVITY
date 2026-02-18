import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secureCache", () => ({
  secureDelete: vi.fn(),
  secureGet: vi.fn(),
  securePut: vi.fn(),
}));

vi.mock("@/lib/staleData", () => ({
  markFreshData: vi.fn(),
  markStaleData: vi.fn(),
}));

vi.mock("@/lib/perfHints", () => ({
  getPerfHints: vi.fn(() => ({ tier: "FAST" })),
  tierHydrationTimeoutMs: vi.fn(() => 100),
}));

import { QueryPersistence } from "@/lib/queryPersistence";
import { secureGet } from "@/lib/secureCache";

describe("QueryPersistence hydrate ordering", () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates essential auth/global keys even after the soft deadline is exceeded", async () => {
    vi.mocked(secureGet).mockImplementation(async (_store, key) => {
      nowMs += 350;
      if (key === "/api/auth/current-user") {
        return { schemaVersion: 1, data: { id: 101 }, updatedAt: nowMs };
      }
      if (key === "/api/user") {
        return { schemaVersion: 1, data: { id: 101, email: "trader@example.com" }, updatedAt: nowMs };
      }
      if (key === "/api/global-settings") {
        return { schemaVersion: 1, data: { performanceSettings: { restFallbackPollMs: 900 } }, updatedAt: nowMs };
      }
      return null;
    });

    const setQueryData = vi.fn();
    const queryClient = {
      setQueryData,
      getQueryCache: () => ({ subscribe: vi.fn(() => () => undefined) }),
      getQueryState: vi.fn(),
    } as any;

    const persistence = new QueryPersistence(queryClient);
    await persistence.hydrate();

    const hydratedKeys = setQueryData.mock.calls.map((call) => call[0]?.[0]);
    expect(hydratedKeys).toEqual([
      "/api/auth/current-user",
      "/api/user",
      "/api/global-settings",
    ]);
  });
});
