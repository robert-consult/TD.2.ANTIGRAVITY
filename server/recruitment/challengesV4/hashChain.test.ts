// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chainHash, stableStringify } from "./hashChain";

describe("challenge hash chain helpers", () => {
  it("serializes objects deterministically regardless of key order", () => {
    const a = stableStringify({
      z: 1,
      nested: { b: true, a: false },
      list: [2, { y: "yes", x: "no" }],
    });
    const b = stableStringify({
      list: [2, { x: "no", y: "yes" }],
      nested: { a: false, b: true },
      z: 1,
    });

    expect(a).toBe(b);
  });

  it("includes the previous hash when computing the next hash", () => {
    const payload = { challengeId: 44, status: "PASSED" };

    expect(chainHash("prev-a", payload)).not.toBe(chainHash("prev-b", payload));
    expect(chainHash("prev-a", payload)).toBe(chainHash("prev-a", { status: "PASSED", challengeId: 44 }));
  });
});
