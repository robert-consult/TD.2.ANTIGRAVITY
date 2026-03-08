import { describe, expect, it } from "vitest";
import {
  computeDayExpirySec,
  normalizeTimeInForce,
  resolvePendingOrderExpirySec,
} from "../../shared/trading/timeInForce";

describe("timeInForce", () => {
  it("normalizes supported values and falls back to GTC", () => {
    expect(normalizeTimeInForce("ioc")).toBe("IOC");
    expect(normalizeTimeInForce("  gtd  ")).toBe("GTD");
    expect(normalizeTimeInForce("unknown")).toBe("GTC");
  });

  it("computes DAY expiry at the end of the UTC day", () => {
    const nowMs = Date.UTC(2026, 2, 7, 12, 30, 15);
    expect(computeDayExpirySec(nowMs)).toBe(Math.trunc(Date.UTC(2026, 2, 7, 23, 59, 59, 999) / 1000));
  });

  it("resolves GTD expiry inputs to unix seconds", () => {
    expect(resolvePendingOrderExpirySec({
      timeInForce: "GTD",
      expiresAt: "2026-03-08T18:45:00Z",
    })).toBe(1772995500);
  });
});
