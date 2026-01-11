import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { withI18nDb } from "./i18nDb";
import { getI18nConfig } from "./config";
import type { I18nBundle, I18nManifestFile } from "./types";

let lastManifestMtimeMs: number | null = null;
let lastManifestPath: string | null = null;
let lastManifestVersion: string | null = null;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function baseLocale(locale: string): string {
  return String(locale || "").trim().toLowerCase().split("-")[0] || "en";
}

function normalizeLocale(locale: string, supported: string[], def: string): string {
  const raw = String(locale || "").trim();
  if (!raw) return def;
  const exact = supported.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const base = baseLocale(raw);
  const baseMatch = supported.find((s) => s.toLowerCase() === base);
  return baseMatch ?? def;
}

async function resolveManifestPath(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "dist", "public", "i18n-manifest.json"),
    path.resolve(process.cwd(), "client", "i18n-manifest.json"),
  ];

  for (const p of candidates) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

async function readManifestFromDisk(p: string): Promise<I18nManifestFile> {
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw) as I18nManifestFile;
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid manifest JSON");
  if (!Array.isArray((parsed as any).entries)) throw new Error("Manifest missing entries[]");
  return parsed;
}

export async function maybeIngestBuiltManifest(): Promise<
  | { skipped: true; reason: string; path?: string; version?: string }
  | { ingested: true; path: string; version: string; added: number; updated: number; unchanged: number; jobsEnqueued: number }
> {
  const manifestPath = await resolveManifestPath();
  if (!manifestPath) return { skipped: true, reason: "manifest-not-found" };

  const st = await fs.stat(manifestPath);
  if (lastManifestPath === manifestPath && lastManifestMtimeMs === st.mtimeMs) {
    return { skipped: true, reason: "mtime-unchanged", path: manifestPath, version: lastManifestVersion ?? undefined };
  }

  const mf = await readManifestFromDisk(manifestPath);
  lastManifestPath = manifestPath;
  lastManifestMtimeMs = st.mtimeMs;
  lastManifestVersion = mf.version;

  const cfg = getI18nConfig();

  return withI18nDb((db) => {
    const exists = db.prepare("SELECT id FROM i18n_manifest_versions WHERE version = ?").get(mf.version);
    if (exists) return { skipped: true as const, reason: "already-ingested", path: manifestPath, version: mf.version };

    const now = Math.floor(Date.now() / 1000);
    const supportedLocales = cfg.supportedLocales.length ? cfg.supportedLocales : [cfg.defaultLocale];
    const defaultLocale = cfg.defaultLocale || "en";
    const targetLocales = supportedLocales.filter((l) => l.toLowerCase() !== defaultLocale.toLowerCase());

    const insertManifest = db.prepare(
      "INSERT INTO i18n_manifest_versions (version, generated_at, entry_count, ingested_at) VALUES (?, ?, ?, ?)",
    );
    const selectExisting = db.prepare("SELECT checksum FROM i18n_source_strings WHERE string_id = ?");
    const upsertString = db.prepare(`
      INSERT INTO i18n_source_strings (
        string_id, default_text, checksum,
        file, kind, prop_name, line, column,
        first_seen_at, last_seen_at, last_modified_at
      ) VALUES (
        @string_id, @default_text, @checksum,
        @file, @kind, @prop_name, @line, @column,
        @now, @now, @now
      )
      ON CONFLICT(string_id) DO UPDATE SET
        default_text = excluded.default_text,
        checksum = excluded.checksum,
        file = excluded.file,
        kind = excluded.kind,
        prop_name = excluded.prop_name,
        line = excluded.line,
        column = excluded.column,
        last_seen_at = excluded.last_seen_at,
        last_modified_at = CASE
          WHEN i18n_source_strings.checksum <> excluded.checksum THEN excluded.last_seen_at
          ELSE i18n_source_strings.last_modified_at
        END
    `);

    const selectTranslation = db.prepare("SELECT source_checksum FROM i18n_translations WHERE string_id = ? AND locale = ?");
    const upsertJob = db.prepare(`
      INSERT INTO i18n_translation_jobs (
        string_id, locale, status, attempt_count, last_error, locked_at, locked_by, created_at, updated_at
      ) VALUES (
        ?, ?, 'PENDING', 0, NULL, NULL, NULL, ?, ?
      )
      ON CONFLICT(string_id, locale) DO UPDATE SET
        status = 'PENDING',
        attempt_count = 0,
        last_error = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = excluded.updated_at
    `);

    const tx = db.transaction(() => {
      insertManifest.run(mf.version, mf.generatedAt ? Math.floor(Number(mf.generatedAt) / 1000) : null, mf.entries.length, now);

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      let jobsEnqueued = 0;

      for (const e of mf.entries) {
        const stringId = String((e as any).id || "").trim();
        const defaultText = String((e as any).defaultText || "").trim();
        if (!stringId || !defaultText) continue;

        const checksum = sha256(defaultText);
        const existing = selectExisting.get(stringId) as any;
        const prevChecksum = existing?.checksum ? String(existing.checksum) : null;
        const changed = prevChecksum && prevChecksum !== checksum;

        if (!prevChecksum) added += 1;
        else if (changed) updated += 1;
        else unchanged += 1;

        upsertString.run({
          string_id: stringId,
          default_text: defaultText,
          checksum,
          file: (e as any).file ?? null,
          kind: (e as any).kind ?? null,
          prop_name: (e as any).propName ?? null,
          line: (e as any).line ?? null,
          column: (e as any).column ?? null,
          now,
        });

        if (!cfg.autoTranslate) continue;
        if (!changed && prevChecksum) continue; // only enqueue on new/changed

        for (const locale of targetLocales) {
          const tr = selectTranslation.get(stringId, locale) as any;
          const trChecksum = tr?.source_checksum ? String(tr.source_checksum) : null;
          if (trChecksum === checksum) continue;

          upsertJob.run(stringId, locale, now, now);
          jobsEnqueued += 1;
        }
      }

      return { added, updated, unchanged, jobsEnqueued };
    });

    const result = tx();

    return {
      ingested: true as const,
      path: manifestPath,
      version: mf.version,
      added: result.added,
      updated: result.updated,
      unchanged: result.unchanged,
      jobsEnqueued: result.jobsEnqueued,
    };
  }) as any;
}

export function getBundle(requestedLocale: string): I18nBundle {
  const cfg = getI18nConfig();
  const supported = cfg.supportedLocales.length ? cfg.supportedLocales : [cfg.defaultLocale];
  const locale = normalizeLocale(requestedLocale, supported, cfg.defaultLocale || "en");

  if (!cfg.enabled || locale.toLowerCase() === cfg.defaultLocale.toLowerCase()) {
    return { locale, strings: {} };
  }

  return withI18nDb((db) => {
    const rows = db
      .prepare("SELECT string_id, translated_text FROM i18n_translations WHERE locale = ?")
      .all(locale) as Array<{ string_id: string; translated_text: string }>;
    const strings: Record<string, string> = {};
    for (const r of rows) strings[String(r.string_id)] = String(r.translated_text);
    return { locale, strings };
  });
}

export function getBundleEtag(locale: string): string {
  return withI18nDb((db) => {
    const row = db
      .prepare("SELECT COUNT(*) AS cnt, MAX(updated_at) AS max_updated_at FROM i18n_translations WHERE locale = ?")
      .get(locale) as any;
    const cnt = Number(row?.cnt || 0);
    const maxUpdatedAt = Number(row?.max_updated_at || 0);
    return `W/\"i18n-${locale}-${cnt}-${maxUpdatedAt}\"`;
  });
}

export function getSummary() {
  const cfg = getI18nConfig();
  return withI18nDb((db) => {
    const sourcesRow = db.prepare("SELECT COUNT(*) AS c FROM i18n_source_strings").get() as any;
    const translationsRow = db.prepare("SELECT COUNT(*) AS c FROM i18n_translations").get() as any;
    const sources = Number(sourcesRow?.c || 0);
    const translations = Number(translationsRow?.c || 0);
    const jobsPending = Number(
      (db.prepare("SELECT COUNT(*) AS c FROM i18n_translation_jobs WHERE status = 'PENDING'").get() as any)?.c || 0,
    );
    const jobsFailed = Number(
      (db.prepare("SELECT COUNT(*) AS c FROM i18n_translation_jobs WHERE status = 'FAILED'").get() as any)?.c || 0,
    );
    return { sources, translations, jobsPending, jobsFailed, config: cfg };
  });
}
