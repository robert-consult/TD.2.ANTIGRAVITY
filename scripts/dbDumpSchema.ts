import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..");

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    console.error("[schema] DATABASE_URL is required for Postgres schema dump");
    process.exit(1);
  }

  const outPath = path.resolve(repoRoot, "db", "schema.pg.sql");
  const result = spawnSync(
    "pg_dump",
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--no-comments",
      "--schema=public",
      databaseUrl,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    console.error("[schema] pg_dump failed:");
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }

  fs.writeFileSync(outPath, String(result.stdout ?? ""), "utf8");
  console.log(`[schema] Wrote ${path.relative(repoRoot, outPath)}`);
}

main();
