import { describe, expect, it } from "vitest";
import { sanitizeMinPriceDistancePips } from "@shared/tradingRules";

describe("sanitizeMinPriceDistancePips", () => {
  it("falls back on invalid inputs", () => {
    expect(sanitizeMinPriceDistancePips(undefined)).toBe(20);
    expect(sanitizeMinPriceDistancePips(null)).toBe(20);
    expect(sanitizeMinPriceDistancePips("")).toBe(20);
    expect(sanitizeMinPriceDistancePips("nope")).toBe(20);
    expect(sanitizeMinPriceDistancePips(Number.NaN)).toBe(20);
    expect(sanitizeMinPriceDistancePips(Number.POSITIVE_INFINITY)).toBe(20);
  });

  it("clamps to a safe positive integer", () => {
    expect(sanitizeMinPriceDistancePips(20)).toBe(20);
    expect(sanitizeMinPriceDistancePips(20.9)).toBe(20);
    expect(sanitizeMinPriceDistancePips(-5)).toBe(20);
    expect(sanitizeMinPriceDistancePips(0)).toBe(20);
    expect(sanitizeMinPriceDistancePips(1)).toBe(1);
    expect(sanitizeMinPriceDistancePips(10_000)).toBe(10_000);
    expect(sanitizeMinPriceDistancePips(99_999)).toBe(10_000);
  });
});

