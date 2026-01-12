import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { refreshI18nConfig, updateI18nConfig } from "../i18n/config";
import { getSummary, maybeIngestBuiltManifest } from "../i18n/service";
import { runI18nWorkerTick } from "../i18n/worker";
import { withI18nClient } from "../i18n/i18nDb";

export const adminI18nRouter = Router();
adminI18nRouter.use(requireAdmin);

// GET /api/admin/i18n/config
adminI18nRouter.get("/config", async (_req, res) => {
  const cfg = await refreshI18nConfig();
  res.json({ ok: true, ...cfg });
});

// PUT /api/admin/i18n/config
adminI18nRouter.put("/config", async (req, res) => {
  const body = req.body ?? {};
  const patch: any = {};

  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.defaultLocale === "string" && body.defaultLocale.trim()) patch.defaultLocale = body.defaultLocale.trim();
  if (Array.isArray(body.supportedLocales)) {
    const locales = body.supportedLocales.map(String).map((s: string) => s.trim()).filter(Boolean);
    if (locales.length) patch.supportedLocales = locales;
  }
  if (typeof body.autoTranslate === "boolean") patch.autoTranslate = body.autoTranslate;
  if (typeof body.llmEnabled === "boolean") patch.llmEnabled = body.llmEnabled;
  if (typeof body.llmProvider === "string" && body.llmProvider.trim()) patch.llmProvider = body.llmProvider.trim();
  if (typeof body.llmModel === "string" && body.llmModel.trim()) patch.llmModel = body.llmModel.trim();
  if (body.llmMaxBatchSize !== undefined) patch.llmMaxBatchSize = Number(body.llmMaxBatchSize);
  if (body.llmMaxAttempts !== undefined) patch.llmMaxAttempts = Number(body.llmMaxAttempts);

  const next = await updateI18nConfig(patch);
  res.json({ ok: true, ...next });
});

// GET /api/admin/i18n/summary
adminI18nRouter.get("/summary", async (_req, res) => {
  const s = await getSummary();
  res.json({ ok: true, ...s });
});

// POST /api/admin/i18n/ingest-manifest
adminI18nRouter.post("/ingest-manifest", async (_req, res) => {
  const r = await maybeIngestBuiltManifest();
  res.json({ ok: true, ...r });
});

// POST /api/admin/i18n/run-worker
adminI18nRouter.post("/run-worker", async (_req, res) => {
  const r = await runI18nWorkerTick();
  res.json({ ok: true, ...r });
});

// POST /api/admin/i18n/reset-failed-jobs
adminI18nRouter.post("/reset-failed-jobs", async (_req, res) => {
  const result = await withI18nClient(async (client) => {
    const now = Math.floor(Date.now() / 1000);
    const info = await client.query(
      `
      UPDATE i18n_translation_jobs
      SET status = 'PENDING',
          attempt_count = 0,
          last_error = NULL,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = $1
      WHERE status IN ('FAILED', 'IN_PROGRESS')
      `,
      [now],
    );
    return { resetCount: info.rowCount ?? 0 };
  });
  res.json({ ok: true, ...result });
});
