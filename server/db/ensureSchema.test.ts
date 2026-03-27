import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("@db", () => ({
  db: {},
  dbClient: {
    query: queryMock,
  },
}));

vi.mock("@db/config", () => ({
  isPostgres: true,
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: vi.fn(async () => {}),
}));

import {
  ensurePgStatStatementsExtension,
  isPgStatStatementsPermissionError,
} from "./ensureSchema";

describe("ensureSchema pg_stat_statements handling", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("detects the expected non-superuser permission error shape", () => {
    expect(
      isPgStatStatementsPermissionError({
        code: "42501",
        message: 'permission denied to create extension "pg_stat_statements"',
      }),
    ).toBe(true);

    expect(
      isPgStatStatementsPermissionError({
        code: "XX000",
        message: 'permission denied to create extension "pg_stat_statements"',
      }),
    ).toBe(false);
  });

  it("treats pg_stat_statements permission denial as best-effort only", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    queryMock.mockRejectedValueOnce({
      code: "42501",
      message: 'permission denied to create extension "pg_stat_statements"',
    });

    await expect(ensurePgStatStatementsExtension()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "[db] Skipping pg_stat_statements extension ensure; current database user lacks CREATE EXTENSION privileges.",
    );

    warnSpy.mockRestore();
  });

  it("still throws unexpected extension errors", async () => {
    queryMock.mockRejectedValueOnce(new Error("network down"));

    await expect(ensurePgStatStatementsExtension()).rejects.toThrow("network down");
  });
});
