import {
  getApiBaseUrl,
  getDeepLinkPrefixes,
  getSessionPollIntervalMs,
  PRODUCTION_APP_URL,
  resolveAllowedDeepLink,
} from "../src/services/runtimeConfig";
import { MOBILE_SESSION_POLL_INTERVAL_MS } from "@shared/appSurfaceConfig";

describe("native runtime config deep-link hardening", () => {
  it("normalizes supported relative paths onto the native route scheme", () => {
    expect(resolveAllowedDeepLink("/trade/EURUSD")).toBe("tradequip://trade/EURUSD");
    expect(resolveAllowedDeepLink("leaderboard")).toBe("tradequip://leaderboard");
  });

  it("keeps runtime base URLs and prefixes explicit across dev-safe resolution", () => {
    expect(getApiBaseUrl()).toMatch(/^http:\/\/(localhost|10\.0\.2\.2):5000$/);
    expect(getDeepLinkPrefixes()).toEqual(
      expect.arrayContaining(["tradequip://", PRODUCTION_APP_URL, getApiBaseUrl()]),
    );
    expect(getSessionPollIntervalMs()).toBe(MOBILE_SESSION_POLL_INTERVAL_MS);
  });

  it("accepts the canonical https host and custom scheme only for supported app routes", () => {
    expect(resolveAllowedDeepLink("https://tradehub.example.com/account")).toBe(
      "tradequip://account",
    );
    expect(resolveAllowedDeepLink("tradequip://trade/USDJPY")).toBe("tradequip://trade/USDJPY");
    expect(resolveAllowedDeepLink("https://tradehub.example.com/?tab=chart&symbol=eurusd")).toBe(
      "tradequip://chart/EURUSD",
    );
    expect(resolveAllowedDeepLink("https://tradehub.example.com/?tab=account&panel=mailbox")).toBe(
      "tradequip://account?panel=mailbox",
    );
    expect(resolveAllowedDeepLink(`${PRODUCTION_APP_URL}/verify-email?token=abc123`)).toBe(
      "tradequip://verify-email?token=abc123",
    );
    expect(resolveAllowedDeepLink(`${getApiBaseUrl()}/?tab=chart&symbol=eurusd`)).toBe(
      "tradequip://chart/EURUSD",
    );
  });

  it("rejects external, unsafe, and unsupported targets", () => {
    expect(resolveAllowedDeepLink("https://evil.example/account")).toBeNull();
    expect(resolveAllowedDeepLink("mailto:security@example.com")).toBeNull();
    expect(resolveAllowedDeepLink("https://tradehub.example.com/admin")).toBeNull();
    expect(resolveAllowedDeepLink("https://tradehub.example.com/partner")).toBeNull();
  });
});
