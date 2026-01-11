import express from "express";
import { getBundle, getBundleEtag } from "../i18n/service";
import { getI18nPublicConfig } from "../i18n/config";

export const i18nRouter = express.Router();

// GET /api/i18n/config
i18nRouter.get("/config", (_req, res) => {
  const cfg = getI18nPublicConfig();
  res.json({ ok: true, ...cfg });
});

// GET /api/i18n/bundle?locale=xx
i18nRouter.get("/bundle", (req, res) => {
  const requested = String((req.query as any)?.locale || "");
  const bundle = getBundle(requested);
  const etag = getBundleEtag(bundle.locale);

  const ifNoneMatch = String(req.headers["if-none-match"] || "");
  if (ifNoneMatch && ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }

  res.setHeader("ETag", etag);
  res.json(bundle);
});

