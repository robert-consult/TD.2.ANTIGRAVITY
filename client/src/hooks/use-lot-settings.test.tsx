import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

import { useQuery } from "@tanstack/react-query";
import { useLotSettings } from "@/hooks/use-lot-settings";

describe("useLotSettings", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prefers normalized array payloads from the server", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        lotDropdownMax: 12,
        lotPresetCardsArray: [10, 1, 10, 5],
        lotDropdownOptions: [8, 4, 8, 2],
        minPriceDistancePips: 18,
      },
    } as any);

    const { result } = renderHook(() => useLotSettings());

    expect(result.current.lotDropdownMax).toBe(12);
    expect(result.current.lotPresetCards).toEqual([1, 5, 10]);
    expect(result.current.lotDropdownOptions).toEqual([2, 4, 8]);
    expect(result.current.minPriceDistancePips).toBe(18);
  });

  it("falls back to parsing JSON card presets and default dropdown options", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        lotDropdownMax: 6,
        lotPresetCards: "[5, 2, 5, 9]",
      },
    } as any);

    const { result } = renderHook(() => useLotSettings());

    expect(result.current.lotPresetCards).toEqual([2, 5]);
    expect(result.current.lotDropdownOptions).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("clamps invalid settings back to safe defaults", () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        lotDropdownMax: 999,
        lotPresetCards: "not-json",
        minPriceDistancePips: -4,
      },
    } as any);

    const { result } = renderHook(() => useLotSettings());

    expect(result.current.lotDropdownMax).toBe(50);
    expect(result.current.lotPresetCards).toEqual([1, 5, 10, 25, 50]);
    expect(result.current.minPriceDistancePips).toBeGreaterThan(0);
  });
});
