import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { dbClient } from "@db";
import { getI18nConfig, refreshI18nConfig } from "./config";
import { withI18nClient, withI18nTransaction } from "./i18nDb";
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

  const available: Array<{ path: string; mtimeMs: number }> = [];
  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      available.push({ path: p, mtimeMs: st.mtimeMs });
    } catch {}
  }
  if (!available.length) return null;
  available.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return available[0].path;
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

  const cfg = await refreshI18nConfig();

  const exists = await withI18nClient(async (client) => {
    const res = await client.query("SELECT id FROM i18n_manifest_versions WHERE version = $1", [mf.version]);
    return (res.rowCount ?? 0) > 0;
  });
  if (exists) return { skipped: true, reason: "already-ingested", path: manifestPath, version: mf.version };

  return withI18nTransaction(async (client) => {
    const now = Math.floor(Date.now() / 1000);
    const supportedLocales = cfg.supportedLocales.length ? cfg.supportedLocales : [cfg.defaultLocale];
    const defaultLocale = cfg.defaultLocale || "en";
    const targetLocales = supportedLocales.filter((l) => l.toLowerCase() !== defaultLocale.toLowerCase());

    await client.query(
      `
      INSERT INTO i18n_manifest_versions (version, generated_at, entry_count, ingested_at)
      VALUES ($1, $2, $3, $4)
      `,
      [
        mf.version,
        mf.generatedAt ? Math.floor(Number(mf.generatedAt) / 1000) : null,
        mf.entries.length,
        now,
      ],
    );

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let jobsEnqueued = 0;

    for (const e of mf.entries) {
      const stringId = String((e as any).id || "").trim();
      const defaultText = String((e as any).defaultText || "").trim();
      if (!stringId || !defaultText) continue;

      const checksum = sha256(defaultText);
      const existing = await client.query("SELECT checksum FROM i18n_source_strings WHERE string_id = $1", [stringId]);
      const prevChecksum = existing.rows?.[0]?.checksum ? String(existing.rows[0].checksum) : null;
      const changed = prevChecksum && prevChecksum !== checksum;

      if (!prevChecksum) added += 1;
      else if (changed) updated += 1;
      else unchanged += 1;

      await client.query(
        `
        INSERT INTO i18n_source_strings (
          string_id, default_text, checksum,
          file, kind, prop_name, line, "column",
          first_seen_at, last_seen_at, last_modified_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)
        ON CONFLICT (string_id) DO UPDATE SET
          default_text = EXCLUDED.default_text,
          checksum = EXCLUDED.checksum,
          file = EXCLUDED.file,
          kind = EXCLUDED.kind,
          prop_name = EXCLUDED.prop_name,
          line = EXCLUDED.line,
          "column" = EXCLUDED."column",
          last_seen_at = EXCLUDED.last_seen_at,
          last_modified_at = CASE
            WHEN i18n_source_strings.checksum <> EXCLUDED.checksum THEN EXCLUDED.last_seen_at
            ELSE i18n_source_strings.last_modified_at
          END
        `,
        [
          stringId,
          defaultText,
          checksum,
          (e as any).file ?? null,
          (e as any).kind ?? null,
          (e as any).propName ?? null,
          (e as any).line ?? null,
          (e as any).column ?? null,
          now,
        ],
      );

      if (!cfg.autoTranslate) continue;
      if (!changed && prevChecksum) continue;

      for (const locale of targetLocales) {
        const tr = await client.query(
          "SELECT source_checksum FROM i18n_translations WHERE string_id = $1 AND locale = $2",
          [stringId, locale],
        );
        const trChecksum = tr.rows?.[0]?.source_checksum ? String(tr.rows[0].source_checksum) : null;
        if (trChecksum === checksum) continue;

        await client.query(
          `
          INSERT INTO i18n_translation_jobs (
            string_id, locale, status, attempt_count, last_error, locked_at, locked_by, created_at, updated_at
          ) VALUES ($1, $2, 'PENDING', 0, NULL, NULL, NULL, $3, $3)
          ON CONFLICT (string_id, locale) DO UPDATE SET
            status = 'PENDING',
            attempt_count = 0,
            last_error = NULL,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = EXCLUDED.updated_at
          `,
          [stringId, locale, now],
        );
        jobsEnqueued += 1;
      }
    }

    return {
      ingested: true as const,
      path: manifestPath,
      version: mf.version,
      added,
      updated,
      unchanged,
      jobsEnqueued,
    };
  }) as any;
}

export async function getBundle(requestedLocale: string): Promise<I18nBundle> {
  const cfg = getI18nConfig();
  const supported = cfg.supportedLocales.length ? cfg.supportedLocales : [cfg.defaultLocale];
  const locale = normalizeLocale(requestedLocale, supported, cfg.defaultLocale || "en");

  if (!cfg.enabled || locale.toLowerCase() === cfg.defaultLocale.toLowerCase()) {
    return { locale, strings: {} };
  }

  const rows = await dbClient.query(
    "SELECT string_id, translated_text FROM i18n_translations WHERE locale = $1",
    [locale],
  );
  const strings: Record<string, string> = {};
  for (const r of rows.rows) strings[String(r.string_id)] = String(r.translated_text);
  return { locale, strings };
}

export async function getBundleEtag(locale: string): Promise<string> {
  const row = await dbClient.query(
    "SELECT COUNT(*) AS cnt, MAX(updated_at) AS max_updated_at FROM i18n_translations WHERE locale = $1",
    [locale],
  );
  const cnt = Number(row.rows?.[0]?.cnt || 0);
  const maxUpdatedAt = Number(row.rows?.[0]?.max_updated_at || 0);
  return `W/\"i18n-${locale}-${cnt}-${maxUpdatedAt}\"`;
}

export async function getSummary() {
  const cfg = getI18nConfig();
  const sourcesRow = await dbClient.query("SELECT COUNT(*) AS c FROM i18n_source_strings");
  const translationsRow = await dbClient.query("SELECT COUNT(*) AS c FROM i18n_translations");
  const jobsPendingRow = await dbClient.query(
    "SELECT COUNT(*) AS c FROM i18n_translation_jobs WHERE status = 'PENDING'",
  );
  const jobsFailedRow = await dbClient.query(
    "SELECT COUNT(*) AS c FROM i18n_translation_jobs WHERE status = 'FAILED'",
  );
  const sources = Number(sourcesRow.rows?.[0]?.c || 0);
  const translations = Number(translationsRow.rows?.[0]?.c || 0);
  const jobsPending = Number(jobsPendingRow.rows?.[0]?.c || 0);
  const jobsFailed = Number(jobsFailedRow.rows?.[0]?.c || 0);
  return { sources, translations, jobsPending, jobsFailed, config: cfg };
}
