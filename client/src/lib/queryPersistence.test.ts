import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perfHints", () => ({
  getPerfHints: vi.fn(() => ({ tier: "FAST" })),
  tierHydrationTimeoutMs: vi.fn(() => 300),
}));

import {
  QUERY_PERSIST_HYDRATE_TIMEOUT_MS_DEFAULT,
  getQueryPersistHydrateTimeoutMs,
} from "@/lib/queryPersistence";
import { getPerfHints, tierHydrationTimeoutMs } from "@/lib/perfHints";

describe("queryPersistence hydration timeout", () => {
  it("uses the tier-derived timeout when perf hints resolve", () => {
    vi.mocked(tierHydrationTimeoutMs).mockReturnValueOnce(500);
    expect(getQueryPersistHydrateTimeoutMs()).toBe(500);
    expect(getPerfHints).toHaveBeenCalled();
  });

  it("falls back to default timeout when hint resolution throws", () => {
    vi.mocked(tierHydrationTimeoutMs).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(getQueryPersistHydrateTimeoutMs()).toBe(QUERY_PERSIST_HYDRATE_TIMEOUT_MS_DEFAULT);
  });
});
