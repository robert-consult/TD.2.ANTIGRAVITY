import { describe, expect, it } from "vitest";
import { renderChallengeCertificatePdf } from "./certificatePdf";

describe("certificatePdf", () => {
  it("renders a PDF buffer with template + verification metadata", () => {
    const pdf = renderChallengeCertificatePdf({
      certificateId: 42,
      challengeName: "Alpha Challenge",
      templateName: "Institutional",
      headerText: "Completion Certificate",
      bodyText: "This certifies completion.",
      issuedIso: "2026-02-15T00:00:00.000Z",
      brandColor: "#003366",
      logoUrl: "https://example.com/logo.png",
      includeMetrics: true,
      includeVerificationCode: true,
      includeQr: true,
      verificationCode: "CHC-V1-ABCDEF1234567890",
      verificationUrl: "https://example.com/verify/CHC-V1-ABCDEF1234567890",
      metrics: { pnlPct: 0.12, tradingDays: 17, maxTotalLossHit: 0.03 },
    });

    const text = pdf.toString("utf8", 0, 16);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});

