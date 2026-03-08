import { describe, expect, it } from "vitest";
import { clampInt, clampIntOr, nowSec, toFiniteNumber, toFiniteNumberOr } from "../../shared/scalars";

describe("shared scalars", () => {
  it("parses finite numbers from strings and rejects non-numeric values", () => {
    expect(toFiniteNumber("12.5")).toBe(12.5);
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("applies integer clamping with truncation and fallback helpers", () => {
    expect(clampInt("9.8", 1, 5)).toBe(5);
    expect(clampInt("-3", 0, 10)).toBe(0);
    expect(clampIntOr("bad", 7, 1, 9)).toBe(7);
  });

  it("returns a current unix timestamp in seconds", () => {
    const before = Math.floor(Date.now() / 1000);
    const current = nowSec();
    const after = Math.floor(Date.now() / 1000);
    expect(current).toBeGreaterThanOrEqual(before);
    expect(current).toBeLessThanOrEqual(after);
    expect(toFiniteNumberOr(null, 4)).toBe(4);
  });
});
