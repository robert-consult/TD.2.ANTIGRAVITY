// @vitest-environment node
import { describe, expect, it } from "vitest";
import { labelFor, uaHeuristicsScore, windowPenalty } from "./botGuardHeuristics";

describe("bot guard heuristics", () => {
  it("scores obviously automated user agents aggressively", () => {
    expect(uaHeuristicsScore("")).toBeGreaterThan(0);
    expect(uaHeuristicsScore("curl/8.0 playwright")).toBeGreaterThanOrEqual(75);
  });

  it("caps window penalties for high-volume bursts", () => {
    expect(
      windowPenalty("TRADE", {
        ip1m: 999,
        ip10m: 999,
        inst10m: 999,
        fp10m: 999,
      }),
    ).toBe(60);
  });

  it("maps labels using stable thresholds", () => {
    expect(labelFor(10)).toBe("OK");
    expect(labelFor(45)).toBe("SUSPICIOUS");
    expect(labelFor(70)).toBe("HIGH");
  });
});
