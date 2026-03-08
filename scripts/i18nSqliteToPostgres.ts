import "dotenv/config";
import { Client } from "pg";
import { resolveLegacySqliteSource } from "../db/legacySqliteSource";

const BATCH_SIZE = Number(process.env.MIGRATE_BATCH_SIZE ?? 1000);
const DRY_RUN = process.env.MIGRATE_DRY_RUN === "1";

function log(message: string) {
  console.log(`[i18n-migrate] ${message}`);
}

async function loadBetterSqlite3(): Promise<any> {
  try {
    const mod = await import("better-sqlite3");
    return (mod as any).default ?? mod;
  } catch {
    throw new Error(
      "Missing optional dependency 'better-sqlite3'. Install it temporarily to run this migration: npm i -D better-sqlite3",
    );
  }
}

function normalizeLocale(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/.test(s)) return null;
  return s;
}

function normalizeEpochSeconds(value: any, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num > 1_000_000_000_000) return Math.floor(num / 1000);
  return Math.floor(num);
}

async function upsertManifestVersions(client: Client, rows: any[]) {
  if (!rows.length) return;
  const cols = ["version", "generated_at", "ingested_at", "entry_count"];
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;
  for (const r of rows) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    params.push(r.version, r.generated_at, r.ingested_at, r.entry_count);
  }
  const sql = `
    INSERT INTO i18n_manifest_versions (${cols.join(",")})
    VALUES ${values.join(",")}
    ON CONFLICT (version) DO UPDATE SET
      generated_at = COALESCE(i18n_manifest_versions.generated_at, EXCLUDED.generated_at),
      ingested_at = GREATEST(i18n_manifest_versions.ingested_at, EXCLUDED.ingested_at),
      entry_count = GREATEST(i18n_manifest_versions.entry_count, EXCLUDED.entry_count)
  `;
  await client.query(sql, params);
}

async function upsertSourceStrings(client: Client, rows: any[]) {
  if (!rows.length) return;
  const cols = [
    "string_id",
    "default_text",
    "checksum",
    "file",
    "kind",
    "prop_name",
    "line",
    "\"column\"",
    "first_seen_at",
    "last_seen_at",
    "last_modified_at",
  ];
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;
  for (const r of rows) {
    values.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
    );
    params.push(
      r.string_id,
      r.default_text,
      r.checksum,
      r.file,
      r.kind,
      r.prop_name,
      r.line,
      r.column,
      r.first_seen_at,
      r.last_seen_at,
      r.last_modified_at,
    );
  }
  const sql = `
    INSERT INTO i18n_source_strings (${cols.join(",")})
    VALUES ${values.join(",")}
    ON CONFLICT (string_id) DO UPDATE SET
      default_text = EXCLUDED.default_text,
      checksum = EXCLUDED.checksum,
      file = EXCLUDED.file,
      kind = EXCLUDED.kind,
      prop_name = EXCLUDED.prop_name,
      line = EXCLUDED.line,
      "column" = EXCLUDED."column",
      first_seen_at = LEAST(i18n_source_strings.first_seen_at, EXCLUDED.first_seen_at),
      last_seen_at = GREATEST(i18n_source_strings.last_seen_at, EXCLUDED.last_seen_at),
      last_modified_at = GREATEST(i18n_source_strings.last_modified_at, EXCLUDED.last_modified_at)
  `;
  await client.query(sql, params);
}

async function upsertTranslations(client: Client, rows: any[]) {
  if (!rows.length) return;
  const cols = [
    "string_id",
    "locale",
    "translated_text",
    "source_checksum",
    "provider",
    "model",
    "created_at",
    "updated_at",
  ];
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;
  for (const r of rows) {
    values.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
    );
    params.push(
      r.string_id,
      r.locale,
      r.translated_text,
      r.source_checksum,
      r.provider,
      r.model,
      r.created_at,
      r.updated_at,
    );
  }
  const sql = `
    INSERT INTO i18n_translations (${cols.join(",")})
    VALUES ${values.join(",")}
    ON CONFLICT (string_id, locale) DO UPDATE SET
      translated_text = EXCLUDED.translated_text,
      source_checksum = EXCLUDED.source_checksum,
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > i18n_translations.updated_at
  `;
  await client.query(sql, params);
}

async function upsertTranslationJobs(client: Client, rows: any[]) {
  if (!rows.length) return;
  const cols = [
    "string_id",
    "locale",
    "status",
    "attempt_count",
    "last_error",
    "locked_at",
    "locked_by",
    "created_at",
    "updated_at",
  ];
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;
  for (const r of rows) {
    values.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
    );
    params.push(
      r.string_id,
      r.locale,
      r.status,
      r.attempt_count,
      r.last_error,
      r.locked_at,
      r.locked_by,
      r.created_at,
      r.updated_at,
    );
  }
  const sql = `
    INSERT INTO i18n_translation_jobs (${cols.join(",")})
    VALUES ${values.join(",")}
    ON CONFLICT (string_id, locale) DO UPDATE SET
      status = EXCLUDED.status,
      attempt_count = EXCLUDED.attempt_count,
      last_error = EXCLUDED.last_error,
      locked_at = EXCLUDED.locked_at,
      locked_by = EXCLUDED.locked_by,
      updated_at = EXCLUDED.updated_at
    WHERE EXCLUDED.updated_at > i18n_translation_jobs.updated_at
  `;
  await client.query(sql, params);
}

async function main() {
  const sqliteSource = resolveLegacySqliteSource({ purpose: "i18n SQLite -> Postgres migration" });
  const sqlitePath = sqliteSource.sqlitePath;

  const BetterSqlite3 = await loadBetterSqlite3();
  const sqlite = new BetterSqlite3(sqlitePath, { readonly: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  log(`SQLite source: ${sqlitePath} (${sqliteSource.kind})`);
  log(`Batch size: ${BATCH_SIZE}`);
  log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

  const now = Math.floor(Date.now() / 1000);

  const migrateTable = async (
    label: string,
    stmtSql: string,
    mapRow: (r: any) => any | null,
    upsert: (rows: any[]) => Promise<void>,
  ) => {
    const stmt = sqlite.prepare(stmtSql);
    let batch: any[] = [];
    let total = 0;
    let skipped = 0;
    for (const row of stmt.iterate()) {
      const mapped = mapRow(row);
      if (!mapped) {
        skipped += 1;
        continue;
      }
      batch.push(mapped);
      total += 1;
      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) await upsert(batch);
        batch = [];
      }
    }
    if (batch.length && !DRY_RUN) await upsert(batch);
    log(`${label}: rows=${total}, skipped=${skipped}`);
  };

  await migrateTable(
    "i18n_manifest_versions",
    "SELECT version, generated_at, ingested_at, entry_count FROM i18n_manifest_versions",
    (r) => ({
      version: String(r.version),
      generated_at: normalizeEpochSeconds(r.generated_at, now),
      ingested_at: normalizeEpochSeconds(r.ingested_at, now),
      entry_count: Number(r.entry_count ?? 0),
    }),
    (rows) => upsertManifestVersions(client, rows),
  );

  await migrateTable(
    "i18n_source_strings",
    "SELECT string_id, default_text, checksum, file, kind, prop_name, line, column, first_seen_at, last_seen_at, last_modified_at FROM i18n_source_strings",
    (r) => ({
      string_id: String(r.string_id),
      default_text: String(r.default_text ?? ""),
      checksum: String(r.checksum ?? ""),
      file: r.file != null ? String(r.file) : null,
      kind: r.kind != null ? String(r.kind) : null,
      prop_name: r.prop_name != null ? String(r.prop_name) : null,
      line: r.line != null ? Number(r.line) : null,
      column: r.column != null ? Number(r.column) : null,
      first_seen_at: normalizeEpochSeconds(r.first_seen_at, now),
      last_seen_at: normalizeEpochSeconds(r.last_seen_at, now),
      last_modified_at: normalizeEpochSeconds(r.last_modified_at, now),
    }),
    (rows) => upsertSourceStrings(client, rows),
  );

  await migrateTable(
    "i18n_translations",
    "SELECT string_id, locale, translated_text, source_checksum, provider, model, created_at, updated_at FROM i18n_translations",
    (r) => {
      const locale = normalizeLocale(r.locale);
      if (!locale) return null;
      return {
        string_id: String(r.string_id),
        locale,
        translated_text: String(r.translated_text ?? ""),
        source_checksum: String(r.source_checksum ?? ""),
        provider: r.provider != null ? String(r.provider) : null,
        model: r.model != null ? String(r.model) : null,
        created_at: normalizeEpochSeconds(r.created_at, now),
        updated_at: normalizeEpochSeconds(r.updated_at, now),
      };
    },
    (rows) => upsertTranslations(client, rows),
  );

  await migrateTable(
    "i18n_translation_jobs",
    "SELECT string_id, locale, status, attempt_count, last_error, locked_at, locked_by, created_at, updated_at FROM i18n_translation_jobs",
    (r) => {
      const locale = normalizeLocale(r.locale);
      if (!locale) return null;
      return {
        string_id: String(r.string_id),
        locale,
        status: String(r.status ?? "PENDING"),
        attempt_count: Number(r.attempt_count ?? 0),
        last_error: r.last_error != null ? String(r.last_error) : null,
        locked_at: r.locked_at != null ? normalizeEpochSeconds(r.locked_at, now) : null,
        locked_by: r.locked_by != null ? String(r.locked_by) : null,
        created_at: normalizeEpochSeconds(r.created_at, now),
        updated_at: normalizeEpochSeconds(r.updated_at, now),
      };
    },
    (rows) => upsertTranslationJobs(client, rows),
  );

  await client.end();
  sqlite.close();
  log("Done.");
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
