// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLegacySqliteSource } from "./legacySqliteSource";

const tempDirs = new Set<string>();

function makeRepoFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-sqlite-source-"));
  tempDirs.add(dir);
  return dir;
}

function touch(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "sqlite");
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("resolveLegacySqliteSource", () => {
  it("uses SQLITE_DB_PATH when provided", () => {
    const repoRoot = makeRepoFixture();
    const explicitPath = path.join(repoRoot, "snapshots", "custom.sqlite");
    touch(explicitPath);

    const resolved = resolveLegacySqliteSource({
      cwd: repoRoot,
      envPath: "./snapshots/custom.sqlite",
      purpose: "trade recovery",
    });

    expect(resolved).toEqual({
      kind: "env",
      sqlitePath: explicitPath,
    });
  });

  it("fails clearly when SQLITE_DB_PATH points to a missing file", () => {
    const repoRoot = makeRepoFixture();

    expect(() =>
      resolveLegacySqliteSource({
        cwd: repoRoot,
        envPath: "./missing.sqlite",
        purpose: "trade recovery",
      }),
    ).toThrow(/SQLITE_DB_PATH points to a missing SQLite file for trade recovery/);
  });

  it("prefers a local root trading_app.db snapshot", () => {
    const repoRoot = makeRepoFixture();
    const rootSnapshot = path.join(repoRoot, "trading_app.db");
    touch(rootSnapshot);
    touch(path.join(repoRoot, "db_backups", "trading_app_20260110_231703.db"));

    const resolved = resolveLegacySqliteSource({ cwd: repoRoot });

    expect(resolved).toEqual({
      kind: "legacy-root",
      sqlitePath: rootSnapshot,
    });
  });

  it("auto-discovers a single fallback snapshot", () => {
    const repoRoot = makeRepoFixture();
    const backupSnapshot = path.join(repoRoot, "db_backups", "trading_app_20260110_231703.db");
    touch(backupSnapshot);

    const resolved = resolveLegacySqliteSource({
      cwd: repoRoot,
      purpose: "SQLite -> Postgres import",
    });

    expect(resolved).toEqual({
      kind: "auto-discovery",
      sqlitePath: backupSnapshot,
    });
  });

  it("fails clearly when multiple fallback snapshots exist", () => {
    const repoRoot = makeRepoFixture();
    touch(path.join(repoRoot, "db_backups", "trading_app_20260110_231703.db"));
    touch(path.join(repoRoot, "migration_imports", "trading_app_dump.db"));

    expect(() =>
      resolveLegacySqliteSource({
        cwd: repoRoot,
        purpose: "SQLite -> Postgres import",
      }),
    ).toThrow(/Multiple local SQLite sources were found for SQLite -> Postgres import/);
  });

  it("fails clearly when no snapshot exists", () => {
    const repoRoot = makeRepoFixture();

    expect(() =>
      resolveLegacySqliteSource({
        cwd: repoRoot,
        purpose: "i18n import",
      }),
    ).toThrow(/No local SQLite source was found for i18n import/);
  });
});
