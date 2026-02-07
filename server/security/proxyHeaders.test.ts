import type { Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { getTrustedProxyCountryIso2, shouldTrustProxyGeoHeaders } from "./proxyHeaders";

function mockReq(opts: {
  headers?: Record<string, string | string[] | undefined>;
  remoteAddress?: string;
} = {}): Request {
  return {
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? "198.51.100.20" },
  } as any as Request;
}

const originalNodeEnv = process.env.NODE_ENV;
const originalTrustOverride = process.env.TRUST_PROXY_GEO_HEADERS;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalTrustOverride === undefined) delete process.env.TRUST_PROXY_GEO_HEADERS;
  else process.env.TRUST_PROXY_GEO_HEADERS = originalTrustOverride;
});

describe("proxy geo header trust", () => {
  it("trusts proxy geo headers when request hop is private", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TRUST_PROXY_GEO_HEADERS;

    const req = mockReq({
      remoteAddress: "10.0.0.5",
      headers: { "cf-ipcountry": "US" },
    });

    expect(shouldTrustProxyGeoHeaders(req)).toBe(true);
    expect(getTrustedProxyCountryIso2(req)).toBe("US");
  });

  it("does not trust geo headers from public direct hops without proxy signature", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TRUST_PROXY_GEO_HEADERS;

    const req = mockReq({
      remoteAddress: "198.51.100.20",
      headers: { "cf-ipcountry": "US" },
    });

    expect(shouldTrustProxyGeoHeaders(req)).toBe(false);
    expect(getTrustedProxyCountryIso2(req)).toBeUndefined();
  });

  it("trusts cloudflare signature on public hops", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TRUST_PROXY_GEO_HEADERS;

    const req = mockReq({
      remoteAddress: "198.51.100.20",
      headers: {
        "cf-ipcountry": "gb",
        "cf-connecting-ip": "203.0.113.50",
        "cf-ray": "abcd1234",
      },
    });

    expect(shouldTrustProxyGeoHeaders(req)).toBe(true);
    expect(getTrustedProxyCountryIso2(req)).toBe("GB");
  });

  it("honors explicit override to disable trusted proxy geo headers", () => {
    process.env.NODE_ENV = "production";
    process.env.TRUST_PROXY_GEO_HEADERS = "false";

    const req = mockReq({
      remoteAddress: "10.0.0.5",
      headers: { "cf-ipcountry": "US" },
    });

    expect(shouldTrustProxyGeoHeaders(req)).toBe(false);
    expect(getTrustedProxyCountryIso2(req)).toBeUndefined();
  });
});
