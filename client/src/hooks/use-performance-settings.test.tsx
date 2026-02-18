import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";
import { usePerformanceSettings } from "@/hooks/use-performance-settings";
import { DEFAULT_PERFORMANCE_SETTINGS } from "@/lib/perfHints";

describe("usePerformanceSettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads nested performanceSettings from global settings responses", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        maintenanceMode: false,
        performanceSettings: {
          restFallbackPollMs: 880,
          quoteFlushIntervalMs: 110,
          prefetchStrategy: "critical",
        },
      },
    } as any);

    const { result } = renderHook(() => usePerformanceSettings());

    expect(result.current.restFallbackPollMs).toBe(880);
    expect(result.current.quoteFlushIntervalMs).toBe(110);
    expect(result.current.prefetchStrategy).toBe("critical");
  });

  it("prefers nested performanceSettings over stale root-level legacy fields", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        restFallbackPollMs: 500,
        performanceSettings: {
          restFallbackPollMs: 1400,
        },
      },
    } as any);

    const { result } = renderHook(() => usePerformanceSettings());
    expect(result.current.restFallbackPollMs).toBe(1400);
  });

  it("keeps backward compatibility when performance fields are at root level", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        restFallbackPollMs: 930,
        quoteFlushIntervalMs: 130,
      },
    } as any);

    const { result } = renderHook(() => usePerformanceSettings());
    expect(result.current.restFallbackPollMs).toBe(930);
    expect(result.current.quoteFlushIntervalMs).toBe(130);
  });

  it("returns defaults when no data is present", () => {
    vi.mocked(useQuery).mockReturnValue({ data: undefined } as any);
    const { result } = renderHook(() => usePerformanceSettings());
    expect(result.current).toEqual(DEFAULT_PERFORMANCE_SETTINGS);
  });
});
