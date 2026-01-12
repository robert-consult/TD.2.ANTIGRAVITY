import { withI18nClient } from "./i18nDb";
import { refreshI18nConfig } from "./config";
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

    const cfg = await refreshI18nConfig();
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

    const result = await withI18nClient(async (client) => {
      const now = Math.floor(Date.now() / 1000);

      await client.query(
        `
        UPDATE i18n_translation_jobs
        SET status = 'PENDING', locked_at = NULL, locked_by = NULL, updated_at = $1
        WHERE status = 'IN_PROGRESS'
          AND locked_at IS NOT NULL
          AND locked_at < ($1 - 600)
        `,
        [now],
      );

      const candidates = await client.query(
        `
        SELECT id
        FROM i18n_translation_jobs
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT $1
        `,
        [cfg.llmMaxBatchSize],
      );

      if (!candidates.rows.length) {
        console.log("[i18n] Worker tick: no pending jobs");
        return { processed: 0 };
      }
      console.log(`[i18n] Worker tick: processing ${candidates.rows.length} jobs`);

      for (const c of candidates.rows) {
        await client.query(
          `
          UPDATE i18n_translation_jobs
          SET status = 'IN_PROGRESS',
              locked_at = $1,
              locked_by = $2,
              attempt_count = attempt_count + 1,
              updated_at = $1
          WHERE id = $3 AND status = 'PENDING'
          `,
          [now, instanceId, c.id],
        );
      }

      const jobsRes = await client.query(
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
        WHERE j.status = 'IN_PROGRESS' AND j.locked_by = $1 AND j.locked_at = $2
        `,
        [instanceId, now],
      );

      const jobs = jobsRes.rows as Array<{
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
            await client.query(
              `
              UPDATE i18n_translation_jobs
              SET status = $1, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = $3
              WHERE id = $4
              `,
              [status, msg, now, j.id],
            );
          }
          continue;
        }

        for (const j of localeJobs) {
          const translated = translatedMap[String(j.string_id)];
          if (!translated) {
            const status = j.attempt_count >= cfg.llmMaxAttempts ? "FAILED" : "PENDING";
            await client.query(
              `
              UPDATE i18n_translation_jobs
              SET status = $1, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = $3
              WHERE id = $4
              `,
              [status, "missing-translation", now, j.id],
            );
            continue;
          }

          const missing = missingTokens(String(j.default_text), String(translated));
          if (missing.length) {
            const status = j.attempt_count >= cfg.llmMaxAttempts ? "FAILED" : "PENDING";
            await client.query(
              `
              UPDATE i18n_translation_jobs
              SET status = $1, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = $3
              WHERE id = $4
              `,
              [status, `missing-placeholders:${missing.join(",")}`, now, j.id],
            );
            continue;
          }

          await client.query(
            `
            INSERT INTO i18n_translations (
              string_id, locale, translated_text, source_checksum, provider, model, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
            ON CONFLICT (string_id, locale) DO UPDATE SET
              translated_text = EXCLUDED.translated_text,
              source_checksum = EXCLUDED.source_checksum,
              provider = EXCLUDED.provider,
              model = EXCLUDED.model,
              updated_at = EXCLUDED.updated_at
            `,
            [j.string_id, j.locale, String(translated), j.checksum, cfg.llmProvider, cfg.llmModel, now],
          );

          await client.query(
            `
            UPDATE i18n_translation_jobs
            SET status = 'DONE', last_error = NULL, locked_at = NULL, locked_by = NULL, updated_at = $1
            WHERE id = $2
            `,
            [now, j.id],
          );
          processed += 1;
        }
      }

      return { processed };
    });

    return { ok: true, ingest, processed: result.processed, summary: await getSummary() };
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
