import { describe, expect, it } from "vitest";
import {
  computeVerificationCodeHmac,
  deriveCertificatePublicCode,
  generateCertificateVerificationBundle,
  parseVerificationCodeKeyId,
} from "./certificateCode";

describe("certificateCode", () => {
  it("generates verifiable public codes with keyed HMAC", () => {
    const bundle = generateCertificateVerificationBundle("v1");
    expect(bundle.publicCode.startsWith("CHC-V1-")).toBe(true);
    expect(bundle.nonce.length).toBe(32);
    expect(bundle.hmac.length).toBe(64);
    expect(computeVerificationCodeHmac(bundle.publicCode, bundle.keyId)).toBe(bundle.hmac);
  });

  it("derives challenge-scoped public code from nonce + key id", () => {
    const bundle = generateCertificateVerificationBundle("rotating-key");
    const derived = deriveCertificatePublicCode({
      verificationCodeNonce: bundle.nonce,
      verificationHmacKeyId: bundle.keyId,
      verificationCodeHmac: bundle.hmac,
    });
    expect(derived).toBe(bundle.publicCode);
  });

  it("keeps legacy codes when nonce is missing", () => {
    const legacyCode = "legacy-direct-code";
    const derived = deriveCertificatePublicCode({
      verificationCodeHmac: legacyCode,
    });
    expect(derived).toBe(legacyCode);
  });

  it("parses key id only for valid CHC code format", () => {
    const bundle = generateCertificateVerificationBundle("v2");
    expect(parseVerificationCodeKeyId(bundle.publicCode)).toBe("v2");
    expect(parseVerificationCodeKeyId("not-a-cert-code")).toBeNull();
  });
});

