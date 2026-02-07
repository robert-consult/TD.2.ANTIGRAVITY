import { describe, expect, it } from "vitest";
import { isSimulatedQuotesAllowed } from "./simulationPolicy";

describe("isSimulatedQuotesAllowed", () => {
  it("disables simulated quotes in production by default", () => {
    expect(
      isSimulatedQuotesAllowed({
        NODE_ENV: "production",
        QUOTE_SOURCE: "1forge",
        ALLOW_SIMULATED_QUOTES: "false",
      }),
    ).toBe(false);
  });

  it("allows simulated quotes in production when explicitly enabled", () => {
    expect(
      isSimulatedQuotesAllowed({
        NODE_ENV: "production",
        QUOTE_SOURCE: "1forge",
        ALLOW_SIMULATED_QUOTES: "true",
      }),
    ).toBe(true);
  });

  it("allows simulated quotes in production when quote source is simulated", () => {
    expect(
      isSimulatedQuotesAllowed({
        NODE_ENV: "production",
        QUOTE_SOURCE: "simulated",
      }),
    ).toBe(true);
  });

  it("allows simulated quotes outside production", () => {
    expect(
      isSimulatedQuotesAllowed({
        NODE_ENV: "development",
        QUOTE_SOURCE: "1forge",
        ALLOW_SIMULATED_QUOTES: "false",
      }),
    ).toBe(true);
  });
});
