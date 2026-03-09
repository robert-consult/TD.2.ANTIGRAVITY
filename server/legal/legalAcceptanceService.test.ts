// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@db", () => ({
  db: {
    transaction: vi.fn(),
  },
}));

import { LegalAcceptanceError, recordDoc1Acceptance } from "./legalAcceptanceService";
import { sha256, type Doc1TermsTokenPayload } from "./cryptoUtils";

function createTx(input: {
  globalDoc: { id: number; version: string; sha256: string; content: string };
  addendumDoc?: { id: number; version: string; sha256: string; content: string } | null;
  lastLedger?: { ledgerSeq: number; ledgerHash: string; recordHash: string } | null;
}) {
  const docQueue = [input.globalDoc, ...(input.addendumDoc ? [input.addendumDoc] : [])];
  const insertedValues: Array<Record<string, unknown>> = [];

  const tx = {
    select: vi.fn((shape?: Record<string, unknown>) => ({
      from: vi.fn(() => {
        if (shape && "ledgerSeq" in shape) {
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => (input.lastLedger ? [input.lastLedger] : [])),
            })),
          };
        }

        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              const next = docQueue.shift();
              return next ? [next] : [];
            }),
          })),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return {
          returning: vi.fn(async () => [{ id: 99 }]),
        };
      }),
    })),
  };

  return { tx, insertedValues };
}

describe("recordDoc1Acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T09:15:30.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes chained ledger metadata for a verified global and addendum acceptance", async () => {
    const globalContent = "Global terms";
    const addendumContent = "US addendum";
    const combinedText = `${globalContent}\n\n---\n\n${addendumContent}`;
    const combinedSha256 = sha256(combinedText);

    const globalDoc = {
      id: 1,
      version: "global-v1",
      sha256: sha256(globalContent),
      content: globalContent,
    };
    const addendumDoc = {
      id: 2,
      version: "us-v1",
      sha256: sha256(addendumContent),
      content: addendumContent,
    };

    const verifiedPayload: Doc1TermsTokenPayload = {
      v: 1,
      ts: Date.now(),
      countryIso2: "US",
      regionKey: "NA",
      global: {
        id: globalDoc.id,
        version: globalDoc.version,
        sha256: globalDoc.sha256,
      },
      addendum: {
        id: addendumDoc.id,
        version: addendumDoc.version,
        sha256: addendumDoc.sha256,
      },
      combinedSha256,
    };

    const { tx, insertedValues } = createTx({
      globalDoc,
      addendumDoc,
      lastLedger: {
        ledgerSeq: 41,
        ledgerHash: "ledger-41",
        recordHash: "record-41",
      },
    });

    const result = await recordDoc1Acceptance({
      userId: 5,
      emailAtAcceptance: "trader@example.com",
      countryIso2: "US",
      ipAddress: "127.0.0.1",
      userAgent: "Vitest",
      sessionId: "session-1",
      termsToken: "verified-token",
      combinedSha256,
      verifiedPayload,
      tx,
    });

    expect(result).toEqual({
      acceptanceId: 99,
      ledgerSeq: 42,
      ledgerHash: expect.any(String),
    });
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      ledgerSeq: 42,
      prevLedgerHash: "ledger-41",
      prevHash: "record-41",
      regionKey: "NA",
      combinedText,
      combinedSha256,
      termsTokenVerified: true,
      acceptedAt: Math.floor(Date.now() / 1000),
      acceptedAtMs: Date.now(),
    });
  });

  it("rejects mismatched combined hashes before any writes happen", async () => {
    const verifiedPayload: Doc1TermsTokenPayload = {
      v: 1,
      ts: Date.now(),
      countryIso2: "US",
      regionKey: null,
      global: {
        id: 1,
        version: "global-v1",
        sha256: "a".repeat(64),
      },
      addendum: null,
      combinedSha256: "b".repeat(64),
    };

    await expect(
      recordDoc1Acceptance({
        userId: 5,
        emailAtAcceptance: "trader@example.com",
        countryIso2: "US",
        ipAddress: null,
        userAgent: null,
        sessionId: null,
        termsToken: "verified-token",
        combinedSha256: "c".repeat(64),
        verifiedPayload,
        tx: createTx({
          globalDoc: {
            id: 1,
            version: "global-v1",
            sha256: "a".repeat(64),
            content: "unused",
          },
        }).tx,
      }),
    ).rejects.toMatchObject<LegalAcceptanceError>({
      code: "COMBINED_SHA_MISMATCH",
    });
  });
});
