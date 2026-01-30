// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractForgeErrorMessage, formatSymbolsForForgeAPI, normalizeSymbol } from "./forgeUtils";

describe("forgeUtils", () => {
  it("normalizes symbols consistently", () => {
    expect(normalizeSymbol(" eur/usd ")).toBe("EURUSD");
    expect(normalizeSymbol("USDJPY")).toBe("USDJPY");
  });

  it("formats only pair symbols for the 1Forge pairs query", () => {
    const pairs = formatSymbolsForForgeAPI(["EURUSD", "USDJPY", "NAS100", "SPX500", "US30", "XAUUSD"]);
    expect(pairs).toBe("EUR/USD,USD/JPY,XAU/USD");
  });

  it("extracts provider error messages", () => {
    expect(extractForgeErrorMessage({ error: true, message: "API limit exceeded" })).toBe("API limit exceeded");
    expect(extractForgeErrorMessage({ error: "Invalid pair", message: "" })).toBe("Invalid pair");
    expect(extractForgeErrorMessage({ error: true })).toBe("1Forge error");
    expect(extractForgeErrorMessage("nope")).toBeNull();
  });
});

