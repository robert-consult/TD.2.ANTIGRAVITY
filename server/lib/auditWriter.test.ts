// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../services/crypto";

const state = vi.hoisted(() => {
  const mockState = {
    selectRows: [] as Array<{
      id: number;
      tradeId: number;
      prevHash: string | null;
      eventHash: string | null;
      payloadJson: string | null;
    }>,
    select: vi.fn(),
    selectFrom: vi.fn(),
    selectWhere: vi.fn(),
    selectOrderBy: vi.fn(async () => mockState.selectRows),
  };

  mockState.select.mockImplementation(() => ({ from: mockState.selectFrom }));
  mockState.selectFrom.mockImplementation(() => ({ where: mockState.selectWhere }));
  mockState.selectWhere.mockImplementation(() => ({ orderBy: mockState.selectOrderBy }));

  return mockState;
});

vi.mock("@db", () => ({
  db: {
    select: state.select,
  },
}));

import { verifyTradeAuditChain, writeTradeAudit } from "./auditWriter";

describe("auditWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T08:00:00.000Z"));
    state.selectRows = [];
    state.select.mockClear();
    state.selectFrom.mockClear();
    state.selectWhere.mockClear();
    state.selectOrderBy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("writes trade audit events with a chained hash and normalized cost fields", async () => {
    let insertedRow: Record<string, unknown> | null = null;
    const dbLike = {
      query: {
        tradeAudit: {
          findFirst: vi.fn(async () => ({ eventHash: "prev-hash" })),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(async (values: Record<string, unknown>) => {
          insertedRow = values;
        }),
      })),
    };

    const result = await writeTradeAudit(
      {
        tradeId: 11,
        eventType: "ORDER_FILLED",
        ctx: {
          actorType: "SYSTEM",
        },
        quoteTs: new Date("2026-03-09T07:59:30.000Z"),
        payload: {
          totalCostsUsd: "12.5",
          overnightDays: 2.8,
          categorySnapshot: "forex",
        },
      },
      { db: dbLike as any },
    );

    expect(result.prevHash).toBe("prev-hash");
    expect(dbLike.insert).toHaveBeenCalledTimes(1);
    expect(insertedRow).toBeTruthy();
    expect(insertedRow?.prevHash).toBe("prev-hash");
    expect(insertedRow?.eventHash).toBe(result.eventHash);
    expect(insertedRow?.quoteTs).toBe(Math.floor(new Date("2026-03-09T07:59:30.000Z").getTime() / 1000));

    const payload = JSON.parse(String(insertedRow?.payloadJson ?? "{}")) as Record<string, unknown>;
    expect(payload.eventType).toBe("ORDER_FILLED");
    expect(payload.totalCostsUsd).toBe(12.5);
    expect(payload.overnightDays).toBe(2);
    expect(payload.categorySnapshot).toBe("forex");
  });

  it("verifies a valid trade audit chain", async () => {
    const payload1 = "{\"event\":\"OPEN\"}";
    const hash1 = sha256Hex(`GENESIS\n${payload1}`);
    const payload2 = "{\"event\":\"CLOSE\"}";
    const hash2 = sha256Hex(`${hash1}\n${payload2}`);

    state.selectRows = [
      { id: 1, tradeId: 7, prevHash: "GENESIS", eventHash: hash1, payloadJson: payload1 },
      { id: 2, tradeId: 7, prevHash: hash1, eventHash: hash2, payloadJson: payload2 },
    ];

    const result = await verifyTradeAuditChain(7);

    expect(result).toEqual({ valid: true, errors: [] });
    expect(state.select).toHaveBeenCalledTimes(1);
  });

  it("reports hash-chain tampering", async () => {
    state.selectRows = [
      {
        id: 3,
        tradeId: 9,
        prevHash: "GENESIS",
        eventHash: "not-a-real-hash",
        payloadJson: "{\"event\":\"OPEN\"}",
      },
    ];

    const result = await verifyTradeAuditChain(9);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("eventHash mismatch");
  });
});
