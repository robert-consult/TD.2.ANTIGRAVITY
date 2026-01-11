import { withI18nDbAsync } from "./i18nDb";
import { getI18nConfig } from "./config";
import { getSummary, maybeIngestBuiltManifest } from "./service";
import { isOpenAiConfigured, translateWithOpenAi } from "./providers/openai";

type PlaceholderToken = string;

function extractPlaceholderTokens(text: string): Set<PlaceholderToken> {
  const s = new Set<PlaceholderToken>();
  const src = String(text || "");
  for (const m of src.matchAll(/\{\{[a-zA-Z0-9_]+\}\}/g)) s.add(m[0]);
  for (const m of src.matchAll(/\{[a-zA-Z0-9_]+\}/g)) s.add(m[0]);
  for (const m of src.matchAll(/%\{[a-zA-Z0-9_]+\}/g)) s.add(m[0]);
  for (const m of src.matchAll(/\$\{[a-zA-Z0-9_.]+\}/g)) s.add(m[0]);
  return s;
}

function missingTokens(source: string, translated: string): string[] {
  const a = extractPlaceholderTokens(source);
  if (a.size === 0) return [];
  const b = extractPlaceholderTokens(translated);
  const missing: string[] = [];
  for (const tok of a) {
    if (!b.has(tok)) missing.push(tok);
  }
  return missing;
}

const instanceId = `i18n-${Math.random().toString(16).slice(2)}`;
let running = false;

export async function runI18nWorkerTick() {
  if (running) return { skipped: true, reason: "already-running" };
  running = true;
  try {
    const ingest = await maybeIngestBuiltManifest().catch((e) => ({ skipped: true as const, reason: `ingest-error:${e?.message || e}` }));

    const cfg = getI18nConfig();
    if (!cfg.llmEnabled || !cfg.autoTranslate) {
      console.log("[i18n] Worker tick skipped: llm-disabled");
      return { ok: true, ingest, processed: 0, reason: "llm-disabled" };
    }

    if (cfg.llmProvider !== "openai") {
      console.log(`[i18n] Worker tick skipped: unsupported-provider:${cfg.llmProvider}`);
      return { ok: true, ingest, processed: 0, reason: `unsupported-provider:${cfg.llmProvider}` };
    }
    if (!isOpenAiConfigured()) {
      console.log("[i18n] Worker tick skipped: missing-openai-key");
      return { ok: true, ingest, processed: 0, reason: "missing-openai-key" };
    }

    const result = await withI18nDbAsync(async (db) => {
      const now = Math.floor(Date.now() / 1000);

      // Reset stale in-progress locks (crash recovery)
      db.prepare(
        `
        UPDATE i18n_translation_jobs
        SET status = 'PENDING', locked_at = NULL, locked_by = NULL, updated_at = @now
        WHERE status = 'IN_PROGRESS'
          AND locked_at IS NOT NULL
          AND locked_at < (@now - 600)
      `,
      ).run({ now });

      const candidates = db
        .prepare(
          `
          SELECT id
          FROM i18n_translation_jobs
          WHERE status = 'PENDING'
          ORDER BY created_at ASC
          LIMIT ?
        `,
        )
        .all(cfg.llmMaxBatchSize) as Array<{ id: number }>;

      if (!candidates.length) {
        console.log("[i18n] Worker tick: no pending jobs");
        return { processed: 0 };
      }
      console.log(`[i18n] Worker tick: processing ${candidates.length} jobs`);

      const lockStmt = db.prepare(
        `
        UPDATE i18n_translation_jobs
        SET status = 'IN_PROGRESS',
            locked_at = @now,
            locked_by = @locked_by,
            attempt_count = attempt_count + 1,
            updated_at = @now
        WHERE id = @id AND status = 'PENDING'
      `,
      );

      for (const c of candidates) {
        lockStmt.run({ id: c.id, now, locked_by: instanceId });
      }

      const jobs = db
        .prepare(
          `
          SELECT
            j.id,
            j.string_id,
            j.locale,
            j.attempt_count,
            s.default_text,
            s.checksum
          FROM i18n_translation_jobs j
          JOIN i18n_source_strings s ON s.string_id = j.string_id
          WHERE j.status = 'IN_PROGRESS' AND j.locked_by = @locked_by AND j.locked_at = @now
        `,
        )
        .all({ locked_by: instanceId, now }) as Array<{
        id: number;
        string_id: string;
        locale: string;
        attempt_count: number;
        default_text: string;
        checksum: string;
      }>;

      if (!jobs.length) return { processed: 0 };

      const byLocale = new Map<string, typeof jobs>();
      for (const j of jobs) {
        const key = String(j.locale);
        const arr = byLocale.get(key) ?? [];
        arr.push(j);
        byLocale.set(key, arr);
      }

      const upsertTranslation = db.prepare(`
        INSERT INTO i18n_translations (
          string_id, locale, translated_text, source_checksum, provider, model, created_at, updated_at
        ) VALUES (
          @string_id, @locale, @translated_text, @source_checksum, @provider, @model, @now, @now
        )
        ON CONFLICT(string_id, locale) DO UPDATE SET
          translated_text = excluded.translated_text,
          source_checksum = excluded.source_checksum,
          provider = excluded.provider,
          model = excluded.model,
          updated_at = excluded.updated_at
      `);

      const markDone = db.prepare(`
        UPDATE i18n_translation_jobs
        SET status = 'DONE',
            last_error = NULL,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = @now
        WHERE id = @id
      `);

      const markFailed = db.prepare(`
        UPDATE i18n_translation_jobs
        SET status = @status,
            last_error = @last_error,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = @now
        WHERE id = @id
      `);

      let processed = 0;

      for (const [locale, localeJobs] of byLocale.entries()) {
        const items = localeJobs.map((j) => ({ id: String(j.string_id), text: String(j.default_text) }));
        let translatedMap: Record<string, string> = {};

        try {
          translatedMap = await translateWithOpenAi({ locale, model: cfg.llmModel, items });
          console.log(`[i18n] Translated ${Object.keys(translatedMap).length} strings for ${locale}`);
        } catch (e: any) {
          const msg = e?.message || String(e);
          console.warn(`[i18n] Translation failed for ${locale}: ${msg}`);
          for (const j of localeJobs) {
            const status = j.attempt_count >= cfg.llmMaxAttempts ? "FAILED" : "PENDING";
            markFailed.run({ id: j.id, status, last_error: msg, now });
          }
          continue;
        }

        for (const j of localeJobs) {
          const translated = translatedMap[String(j.string_id)];
          if (!translated) {
            const status = j.attempt_count >= cfg.llmMaxAttempts ? "FAILED" : "PENDING";
            markFailed.run({ id: j.id, status, last_error: "missing-translation", now });
            continue;
          }

          const missing = missingTokens(String(j.default_text), String(translated));
          if (missing.length) {
            const status = j.attempt_count >= cfg.llmMaxAttempts ? "FAILED" : "PENDING";
            markFailed.run({ id: j.id, status, last_error: `missing-placeholders:${missing.join(",")}`, now });
            continue;
          }

          upsertTranslation.run({
            string_id: j.string_id,
            locale: j.locale,
            translated_text: String(translated),
            source_checksum: j.checksum,
            provider: cfg.llmProvider,
            model: cfg.llmModel,
            now,
          });
          markDone.run({ id: j.id, now });
          processed += 1;
        }
      }

      return { processed };
    });

    return { ok: true, ingest, processed: result.processed, summary: getSummary() };
  } finally {
    running = false;
  }
}

export function startI18nWorker(intervalMs: number) {
  const ms = Math.max(5_000, intervalMs);
  setInterval(() => {
    runI18nWorkerTick().catch((e) => console.warn("[i18n] worker tick failed:", e));
  }, ms);
}
