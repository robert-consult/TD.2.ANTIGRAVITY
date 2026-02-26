import { Router, type Request } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { ADMIN_DATA_EXPORT_TYPES, adminDataExportCreateRequestSchema } from "@shared/admin/dataExports";
import { createAdminDataExportJob } from "../services/adminDataExportRepo";
import { enqueueAdminDataExportJob } from "../services/adminDataExportQueue";
import { onAdminExportJobCreated } from "../services/adminDataExportMetrics";
import { getPetascaleRuntimeConfig } from "../services/petascaleEnv";

type AdminDataExportType = (typeof ADMIN_DATA_EXPORT_TYPES)[number];

function getSessionAdminId(req: any): number | null {
  const id = Number(req?.session?.userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function parseIntClamped(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parseOptionalPositiveInt(raw: unknown): number | null {
  const normalized = String(raw ?? "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  const value = Math.trunc(parsed);
  if (value < 1) return null;
  return value;
}

function parseLegacyExportFormat(raw: unknown): "csv" | "jsonl" | "parquet" | null {
  const value = String(raw ?? "csv").trim().toLowerCase();
  const normalized = value === "excel" ? "csv" : value === "ndjson" ? "jsonl" : value;
  if (normalized === "csv" || normalized === "jsonl" || normalized === "parquet") return normalized;
  return null;
}

async function queueLegacyExportJob(params: {
  req: any;
  type: AdminDataExportType;
  format: "csv" | "jsonl" | "parquet";
  filters: Record<string, unknown>;
  dedupeWindowSec?: number;
}) {
  const requestedByAdminId = getSessionAdminId(params.req);
  if (!requestedByAdminId) throw new Error("Forbidden");

  const request = adminDataExportCreateRequestSchema.parse({
    type: params.type,
    format: params.format,
    filters: params.filters,
  });

  const cfg = getPetascaleRuntimeConfig();
  const created = await createAdminDataExportJob({
    request,
    requestedByAdminId,
    maxAttempts: cfg.queueMaxAttempts,
    dedupeWindowSec: params.dedupeWindowSec ?? 1800,
  });

  onAdminExportJobCreated({ deduped: created.deduped });
  await enqueueAdminDataExportJob({ jobId: created.job.id });

  return {
    jobId: created.job.id,
    deduped: created.deduped,
    pollUrl: `/api/admin/data-exports/${encodeURIComponent(created.job.id)}`,
  };
}

function querySuffix(req: Request): string {
  const idx = req.originalUrl.indexOf("?");
  return idx >= 0 ? req.originalUrl.slice(idx) : "";
}

function redirectLegacy(req: Request, res: any, targetPath: string): void {
  res.redirect(307, `/api/admin${targetPath}${querySuffix(req)}`);
}

export const adminDataLegacyCompatRouter = Router();
adminDataLegacyCompatRouter.use(requireAdmin);

adminDataLegacyCompatRouter.get("/_legacy/kpi-summary", (req, res) => {
  redirectLegacy(req, res, "/kpi-summary");
});

adminDataLegacyCompatRouter.get("/_legacy/signup-funnel", (req, res) => {
  redirectLegacy(req, res, "/signup-funnel");
});

adminDataLegacyCompatRouter.get("/_legacy/user-analytics", (req, res) => {
  redirectLegacy(req, res, "/user-analytics");
});

adminDataLegacyCompatRouter.get("/_legacy/analytics/compliance", (req, res) => {
  redirectLegacy(req, res, "/analytics/compliance");
});

adminDataLegacyCompatRouter.get("/_legacy/deactivated-accounts/summary", (req, res) => {
  redirectLegacy(req, res, "/deactivated-accounts/summary");
});

adminDataLegacyCompatRouter.get("/_legacy/trade-audit", (req, res) => {
  redirectLegacy(req, res, "/trade-audit");
});

adminDataLegacyCompatRouter.get("/_legacy/order-intent-audit", (req, res) => {
  redirectLegacy(req, res, "/order-intent-audit");
});

adminDataLegacyCompatRouter.get("/_legacy/audit-trail", (req, res) => {
  redirectLegacy(req, res, "/audit-trail");
});

adminDataLegacyCompatRouter.get("/_legacy/export-manifests", (req, res) => {
  redirectLegacy(req, res, "/export-manifests");
});

adminDataLegacyCompatRouter.get("/_legacy/trade-audit/export/csv", (req, res) => {
  redirectLegacy(req, res, "/trade-audit/export/csv");
});

adminDataLegacyCompatRouter.get("/_legacy/trade-audit/export/jsonl", (req, res) => {
  redirectLegacy(req, res, "/trade-audit/export/jsonl");
});

adminDataLegacyCompatRouter.get("/_legacy/order-intent-audit/export/csv", (req, res) => {
  redirectLegacy(req, res, "/order-intent-audit/export/csv");
});

adminDataLegacyCompatRouter.get("/trader-scouting/export", async (req: any, res) => {
  try {
    const format = parseLegacyExportFormat(req.query.format);
    if (!format) {
      return res.status(400).json({ message: "Invalid format (expected csv, jsonl or parquet)" });
    }

    const days = parseIntClamped(req.query.days, 30, 0, 365);
    const exportLimit = parseOptionalPositiveInt(req.query.exportLimit);
    const qRaw = String(req.query.q || "").trim();
    const categoriesRaw = req.query.categories;
    const categories = Array.isArray(categoriesRaw)
      ? categoriesRaw.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean)
      : String(categoriesRaw || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);

    const filters: Record<string, unknown> = {
      days,
      minTrades: parseIntClamped(req.query.minTrades, 0, 0, 100_000),
    };
    if (exportLimit != null) filters.exportLimit = exportLimit;
    if (qRaw) filters.q = qRaw.slice(0, 200);
    if (categories.length) filters.categories = categories;

    const floatFilters: Array<[string, string]> = [
      ["minWinRate", "minWinRate"],
      ["maxDrawdown", "maxDrawdown"],
      ["minNetProfit", "minNetProfit"],
      ["maxBestDayPct", "maxBestDayPct"],
      ["minProfitFactor", "minProfitFactor"],
      ["minSlUsage", "minSlUsage"],
      ["minTpUsage", "minTpUsage"],
      ["minHoldSec", "minHoldSec"],
      ["maxHoldSec", "maxHoldSec"],
    ];
    for (const [queryKey, filterKey] of floatFilters) {
      const parsed = Number(req.query[queryKey]);
      if (Number.isFinite(parsed)) filters[filterKey] = parsed;
    }

    const queued = await queueLegacyExportJob({
      req,
      type: "trader_scouting",
      format,
      filters,
    });

    return res.status(202).json({
      ok: true,
      jobId: queued.jobId,
      deduped: queued.deduped,
      status: "QUEUED",
      pollUrl: queued.pollUrl,
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/deactivated-accounts/export", async (req: any, res) => {
  try {
    const format = parseLegacyExportFormat(req.query.format);
    if (!format) {
      return res.status(400).json({ message: "Invalid format (expected csv, jsonl or parquet)" });
    }

    const queued = await queueLegacyExportJob({
      req,
      type: "deactivated_accounts",
      format,
      filters: {
        days: parseIntClamped(req.query.days, 0, 0, 365),
        includeTrades: String(req.query.includeTrades || "1") !== "0",
      },
    });

    return res.status(202).json({
      ok: true,
      jobId: queued.jobId,
      deduped: queued.deduped,
      status: "QUEUED",
      pollUrl: queued.pollUrl,
      hint: "Use /api/admin/data-exports/:jobId and /download-link when ready.",
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users", async (req: any, res) => {
  try {
    const queued = await queueLegacyExportJob({
      req,
      type: "users",
      format: "csv",
      filters: {
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
        includeAdmins: String(req.query.includeAdmins || "1") !== "0",
        includeDeleted: String(req.query.includeDeleted || "1") !== "0",
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users/jsonl", async (req: any, res) => {
  try {
    const queued = await queueLegacyExportJob({
      req,
      type: "users",
      format: "jsonl",
      filters: {
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
        includeAdmins: String(req.query.includeAdmins || "1") !== "0",
        includeDeleted: String(req.query.includeDeleted || "1") !== "0",
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users/parquet", async (req: any, res) => {
  try {
    const queued = await queueLegacyExportJob({
      req,
      type: "users",
      format: "parquet",
      filters: {
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
        includeAdmins: String(req.query.includeAdmins || "1") !== "0",
        includeDeleted: String(req.query.includeDeleted || "1") !== "0",
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users/:id/timeline", async (req: any, res) => {
  try {
    const userId = parseIntClamped(req.params.id, 0, 1, 2_147_483_647);
    const queued = await queueLegacyExportJob({
      req,
      type: "user_timeline",
      format: "csv",
      filters: {
        userId,
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users/:id/timeline/jsonl", async (req: any, res) => {
  try {
    const userId = parseIntClamped(req.params.id, 0, 1, 2_147_483_647);
    const queued = await queueLegacyExportJob({
      req,
      type: "user_timeline",
      format: "jsonl",
      filters: {
        userId,
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});

adminDataLegacyCompatRouter.get("/export/users/:id/timeline/parquet", async (req: any, res) => {
  try {
    const userId = parseIntClamped(req.params.id, 0, 1, 2_147_483_647);
    const queued = await queueLegacyExportJob({
      req,
      type: "user_timeline",
      format: "parquet",
      filters: {
        userId,
        limit: parseIntClamped(req.query.limit, 500_000, 1, 5_000_000),
      },
    });
    return res.status(202).json({ ok: true, jobId: queued.jobId, deduped: queued.deduped, status: "QUEUED", pollUrl: queued.pollUrl });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || "Internal server error" });
  }
});
