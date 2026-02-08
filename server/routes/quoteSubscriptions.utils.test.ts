import { describe, expect, it } from "vitest";
import { filterAvailableRowsByAllowedIds, parseBooleanQueryParam } from "./quoteSubscriptions.utils";

describe("parseBooleanQueryParam", () => {
  it("parses true variants", () => {
    expect(parseBooleanQueryParam(true, false)).toBe(true);
    expect(parseBooleanQueryParam("true", false)).toBe(true);
    expect(parseBooleanQueryParam("1", false)).toBe(true);
    expect(parseBooleanQueryParam("yes", false)).toBe(true);
    expect(parseBooleanQueryParam("on", false)).toBe(true);
  });

  it("parses false variants", () => {
    expect(parseBooleanQueryParam(false, true)).toBe(false);
    expect(parseBooleanQueryParam("false", true)).toBe(false);
    expect(parseBooleanQueryParam("0", true)).toBe(false);
    expect(parseBooleanQueryParam("no", true)).toBe(false);
    expect(parseBooleanQueryParam("off", true)).toBe(false);
  });

  it("uses fallback for invalid values", () => {
    expect(parseBooleanQueryParam(undefined, false)).toBe(false);
    expect(parseBooleanQueryParam(undefined, true)).toBe(true);
    expect(parseBooleanQueryParam("invalid", false)).toBe(false);
    expect(parseBooleanQueryParam("invalid", true)).toBe(true);
  });
});

describe("filterAvailableRowsByAllowedIds", () => {
  const rows = [
    { id: 1, symbol: "EURUSD" },
    { id: 2, symbol: "GBPUSD" },
    { id: 3, symbol: "AAPL" },
  ];

  it("removes allowed ids when excludeAllowed=true", () => {
    const filtered = filterAvailableRowsByAllowedIds(rows, new Set([1, 2]), true);
    expect(filtered.map((row) => row.id)).toEqual([3]);
  });

  it("keeps all rows when excludeAllowed=false", () => {
    const filtered = filterAvailableRowsByAllowedIds(rows, new Set([1, 2]), false);
    expect(filtered.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("keeps all rows when allowed set is empty", () => {
    const filtered = filterAvailableRowsByAllowedIds(rows, new Set(), true);
    expect(filtered.map((row) => row.id)).toEqual([1, 2, 3]);
  });
});
