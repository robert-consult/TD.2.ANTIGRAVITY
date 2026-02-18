import { describe, expect, it, vi } from "vitest";

vi.mock("@db", () => ({
  db: {},
}));

import * as rememberMe from "./rememberMe";

describe("rememberMe helpers", () => {
  it("encodes and decodes cookie values", () => {
    const selector = "a".repeat(32);
    const validator = "b".repeat(64);
    const encoded = rememberMe.encodeRememberMeCookie(selector, validator);
    const decoded = rememberMe.decodeRememberMeCookie(encoded);

    expect(decoded).toEqual({ selector, validator });
  });

  it("rejects malformed cookie values", () => {
    expect(rememberMe.decodeRememberMeCookie("")).toBeNull();
    expect(rememberMe.decodeRememberMeCookie("not_base64")).toBeNull();
    expect(rememberMe.decodeRememberMeCookie(Buffer.from("abc:def").toString("base64url"))).toBeNull();
  });

  it("compares hashes in constant-time helper", () => {
    const a = "0".repeat(64);
    const b = "0".repeat(64);
    const c = "f".repeat(64);

    expect(rememberMe.safeCompareHex(a, b)).toBe(true);
    expect(rememberMe.safeCompareHex(a, c)).toBe(false);
    expect(rememberMe.safeCompareHex("abcd", c)).toBe(false);
  });

  it("reads remember-me cookie from headers", () => {
    const req = {
      headers: {
        cookie: "foo=bar; tq_rm=test_token; baz=qux",
      },
    } as any;

    expect(rememberMe.readRememberMeCookie(req)).toBe("test_token");
  });
});
