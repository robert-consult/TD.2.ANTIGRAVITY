import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@db", () => ({
  db: {
    query: {},
  },
}));

import {
  allowLegacyEnvProviderFallback,
  buildConfiguredProviderCandidateKeys,
  resolveLegacyEnvProviderKeys,
} from "./providerManager";

const originalNodeEnv = process.env.NODE_ENV;
const originalFallback = process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK;
const originalTwelve = process.env.TWELVE_DATA_API_KEY;
const originalForge = process.env.FORGE_KEY;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalFallback === undefined) delete process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK;
  else process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK = originalFallback;

  if (originalTwelve === undefined) delete process.env.TWELVE_DATA_API_KEY;
  else process.env.TWELVE_DATA_API_KEY = originalTwelve;

  if (originalForge === undefined) delete process.env.FORGE_KEY;
  else process.env.FORGE_KEY = originalForge;
});

describe("market data provider selection hardening", () => {
  it("disables legacy env fallback by default in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK;

    expect(allowLegacyEnvProviderFallback()).toBe(false);
  });

  it("keeps legacy env fallback available by default outside production", () => {
    process.env.NODE_ENV = "development";
    delete process.env.MARKET_DATA_PROVIDER_ALLOW_ENV_FALLBACK;

    expect(allowLegacyEnvProviderFallback()).toBe(true);
  });

  it("resolves legacy env provider keys in deterministic priority order", () => {
    process.env.TWELVE_DATA_API_KEY = "td";
    process.env.FORGE_KEY = "fg";

    expect(resolveLegacyEnvProviderKeys()).toEqual(["twelvedata", "1forge"]);
  });

  it("prefers configured active and fallback provider keys before any legacy env keys", () => {
    const keys = buildConfiguredProviderCandidateKeys({
      activeKey: "custom-feed",
      fallbackKeys: ["twelvedata", "1forge"],
      allowLegacyEnvFallback: true,
      legacyEnvKeys: ["twelvedata", "1forge"],
    });

    expect(keys).toEqual(["custom-feed", "twelvedata", "1forge"]);
  });

  it("defaults to twelvedata when no active provider is configured", () => {
    const keys = buildConfiguredProviderCandidateKeys({
      activeKey: null,
      fallbackKeys: [],
      allowLegacyEnvFallback: false,
      legacyEnvKeys: [],
    });

    expect(keys).toEqual(["twelvedata"]);
  });
});
