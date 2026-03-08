import fs from "node:fs";
import path from "node:path";

export type LegacySqliteSourceKind = "env" | "legacy-root" | "auto-discovery";

export type LegacySqliteSource = {
  kind: LegacySqliteSourceKind;
  sqlitePath: string;
};

const PRIMARY_ROOT_DB = "trading_app.db";
const MIGRATION_IMPORT_HINTS = ["migration_imports/trading_app_dump.db", "migration_imports/partial_dump.db"] as const;
const ROOT_SQLITE_PATTERN = /^trading_app.*\.(db|sqlite|sqlite3)$/i;

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function listPatternMatches(dirPath: string, pattern: RegExp): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => path.resolve(dirPath, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function describePurpose(purpose?: string): string {
  return purpose?.trim() ? ` for ${purpose.trim()}` : "";
}

function formatResolutionHelp(repoRoot: string): string {
  const hints = [
    path.resolve(repoRoot, PRIMARY_ROOT_DB),
    ...MIGRATION_IMPORT_HINTS.map((candidate) => path.resolve(repoRoot, candidate)),
    path.resolve(repoRoot, "db_backups", "trading_app*.db"),
  ];
  return `Set SQLITE_DB_PATH to a local SQLite snapshot. Common locations: ${hints.join(", ")}`;
}

export function resolveLegacySqliteSource(options?: {
  cwd?: string;
  envPath?: string | undefined;
  purpose?: string;
}): LegacySqliteSource {
  const repoRoot = path.resolve(options?.cwd ?? process.cwd());
  const purpose = describePurpose(options?.purpose);
  const envPath = options?.envPath ?? process.env.SQLITE_DB_PATH;

  if (envPath?.trim()) {
    const sqlitePath = path.resolve(repoRoot, envPath.trim());
    if (!isExistingFile(sqlitePath)) {
      throw new Error(`SQLITE_DB_PATH points to a missing SQLite file${purpose}: ${sqlitePath}`);
    }
    return { kind: "env", sqlitePath };
  }

  const primaryRootPath = path.resolve(repoRoot, PRIMARY_ROOT_DB);
  if (isExistingFile(primaryRootPath)) {
    return { kind: "legacy-root", sqlitePath: primaryRootPath };
  }

  const fallbackCandidates = uniquePaths([
    ...listPatternMatches(repoRoot, ROOT_SQLITE_PATTERN).filter((candidate) => candidate !== primaryRootPath),
    ...MIGRATION_IMPORT_HINTS.map((candidate) => path.resolve(repoRoot, candidate)).filter(isExistingFile),
    ...listPatternMatches(path.resolve(repoRoot, "migration_imports"), ROOT_SQLITE_PATTERN),
    ...listPatternMatches(path.resolve(repoRoot, "db_backups"), ROOT_SQLITE_PATTERN),
  ]);

  if (fallbackCandidates.length === 1) {
    return { kind: "auto-discovery", sqlitePath: fallbackCandidates[0] };
  }

  if (fallbackCandidates.length > 1) {
    throw new Error(
      `Multiple local SQLite sources were found${purpose}: ${fallbackCandidates.join(", ")}. ` +
        `${formatResolutionHelp(repoRoot)} and rerun the script.`,
    );
  }

  throw new Error(
    `No local SQLite source was found${purpose}. The repo no longer tracks ${PRIMARY_ROOT_DB}. ` +
      `${formatResolutionHelp(repoRoot)} and rerun the script.`,
  );
}
