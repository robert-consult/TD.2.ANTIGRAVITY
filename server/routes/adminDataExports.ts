import fs from "fs";
import path from "path";
import { Router } from "express";
import {
  adminDataExportCreateRequestSchema,
  type AdminDataExportCreateRequest,
} from "@shared/admin/dataExports";
import { requireAdmin } from "../middleware/requireAdmin";
import {
  appendAdminDataExportEvent,
  createAdminDataExportJob,
  getAdminDataExportJob,
  getAdminDataExportJobByObjectKey,
  listAdminDataExportJobEvents,
  listAdminDataExportJobs,
  markAdminDataExportJobCanceled,
  markAdminDataExportJobExpired,
  retryAdminDataExportJob as retryAdminDataExportJobInRepo,
} from "../services/adminDataExportRepo";
import {
  cancelAdminDataExportQueueJob,
  enqueueAdminDataExportJob,
  getAdminExportBullBoardAdapter,
  retryAdminDataExportJob,
} from "../services/adminDataExportQueue";
import {
  deleteExportArtifact,
  getExportDownloadLink,
  resolveLocalObjectKeyPath,
  verifyLocalDownloadLink,
} from "../services/objectStorage";
import { getPetascaleRuntimeConfig } from "../services/petascaleEnv";
import { onAdminExportJobCreated, onAdminExportJobExpired } from "../services/adminDataExportMetrics";

function getSessionAdminId(req: any): number | null {
  const id = Number(req?.session?.userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function canAccessJob(req: any, job: { requestedByAdminId: number | null }): boolean {
  if (!req?.session?.isAdmin) return false;
  if (req?.session?.isSuperAdmin) return true;
  const adminId = getSessionAdminId(req);
  if (!adminId) return false;
  return job.requestedByAdminId === adminId;
}

type RateLimitEntry = { count: number; resetAtMs: number };
const createRateByAdminId = new Map<number, RateLimitEntry>();
const downloadRateByAdminId = new Map<number, RateLimitEntry>();
const retryRateByAdminId = new Map<number, RateLimitEntry>();

function cleanupRateLimitMap<K>(store: Map<K, RateLimitEntry>): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAtMs <= now) store.delete(key);
  }
}

function consumeRateLimit<K>(
  store: Map<K, RateLimitEntry>,
  key: K,
  maxCount: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || existing.resetAtMs <= now) {
    store.set(key, { count: 1, resetAtMs: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  existing.count += 1;
  store.set(key, existing);
  if (existing.count <= maxCount) return { allowed: true, retryAfterSec: 0 };
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000)),
  };
}

const adminDataExportRateCleanupHandle = setInterval(() => {
  cleanupRateLimitMap(createRateByAdminId);
  cleanupRateLimitMap(downloadRateByAdminId);
  cleanupRateLimitMap(retryRateByAdminId);
}, 60_000);
(adminDataExportRateCleanupHandle as any)?.unref?.();

function enforceAdminRateLimit(args: {
  res: any;
  adminId: number | null;
  kind: "create" | "download" | "retry";
}): boolean {
  if (!args.adminId) return true;
  if (args.kind === "create") {
    const rate = consumeRateLimit(createRateByAdminId, args.adminId, 30, 10 * 60 * 1000);
    if (rate.allowed) return true;
    args.res.setHeader("Retry-After", String(rate.retryAfterSec));
    args.res.status(429).json({ message: "EXPORT_CREATE_RATE_LIMIT", retryAfterSec: rate.retryAfterSec });
    return false;
  }
  if (args.kind === "download") {
    const rate = consumeRateLimit(downloadRateByAdminId, args.adminId, 120, 10 * 60 * 1000);
    if (rate.allowed) return true;
    args.res.setHeader("Retry-After", String(rate.retryAfterSec));
    args.res.status(429).json({ message: "EXPORT_DOWNLOAD_RATE_LIMIT", retryAfterSec: rate.retryAfterSec });
    return false;
  }
  const rate = consumeRateLimit(retryRateByAdminId, args.adminId, 40, 10 * 60 * 1000);
  if (rate.allowed) return true;
  args.res.setHeader("Retry-After", String(rate.retryAfterSec));
  args.res.status(429).json({ message: "EXPORT_RETRY_RATE_LIMIT", retryAfterSec: rate.retryAfterSec });
  return false;
}

async function createAndEnqueueJob(args: {
  request: AdminDataExportCreateRequest;
  requestedByAdminId: number;
}): Promise<{ jobId: string; deduped: boolean }> {
  const cfg = getPetascaleRuntimeConfig();
  const created = await createAdminDataExportJob({
    request: args.request,
    requestedByAdminId: args.requestedByAdminId,
    maxAttempts: cfg.queueMaxAttempts,
    dedupeWindowSec: 1800,
  });
  onAdminExportJobCreated({ deduped: created.deduped });
  await enqueueAdminDataExportJob({ jobId: created.job.id });
  return { jobId: created.job.id, deduped: created.deduped };
}

export const adminDataExportsRouter = Router();
adminDataExportsRouter.use(requireAdmin);

adminDataExportsRouter.post("/", async (req: any, res) => {
  try {
    const requestedByAdminId = getSessionAdminId(req);
    if (!requestedByAdminId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!enforceAdminRateLimit({ res, adminId: requestedByAdminId, kind: "create" })) return;
    const parsed = adminDataExportCreateRequestSchema.parse(req.body ?? {});
    const result = await createAndEnqueueJob({
      request: parsed,
      requestedByAdminId,
    });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(400).json({
      message: err?.message || "Failed to create export job",
    });
  }
});

adminDataExportsRouter.get("/", async (req: any, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 50)));
    const scope = String(req.query.scope || "mine").toLowerCase();
    const adminId = getSessionAdminId(req);
    if (!adminId) return res.status(403).json({ message: "Forbidden" });

    const requestedByAdminId =
      scope === "all" && req.session?.isSuperAdmin ? null : adminId;

    const jobs = await listAdminDataExportJobs({
      limit,
      requestedByAdminId,
    });
    return res.json({ ok: true, jobs });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to list export jobs" });
  }
});

adminDataExportsRouter.get("/files", async (req: any, res) => {
  const key = String(req.query.key || "");
  const exp = Number(req.query.exp || 0);
  const sig = String(req.query.sig || "");
  const requestedByAdminId = getSessionAdminId(req);
  if (!requestedByAdminId) return res.status(403).json({ message: "Forbidden" });
  if (!enforceAdminRateLimit({ res, adminId: requestedByAdminId, kind: "download" })) return;
  if (!key) return res.status(400).json({ message: "Missing key" });
  if (!Number.isFinite(exp) || exp <= 0 || exp < Math.floor(Date.now() / 1000)) {
    return res.status(410).json({ message: "Link expired" });
  }

  const objectKey = decodeURIComponent(key);
  const job = await getAdminDataExportJobByObjectKey(objectKey);
  if (!job) return res.status(404).json({ message: "Artifact not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });

  const localPath = resolveLocalObjectKeyPath(objectKey);
  if (!localPath) return res.status(404).json({ message: "Not a local artifact" });
  if (!fs.existsSync(localPath)) return res.status(404).json({ message: "Artifact file missing" });

  const ext = job.format === "jsonl" ? "jsonl" : "csv";
  const fileName = String(req.query.name || `${job.type}-${job.id}.${ext}`);
  if (
    !verifyLocalDownloadLink({
      objectKey,
      fileName,
      expiresAt: exp,
      signature: sig,
    })
  ) {
    return res.status(403).json({ message: "Invalid download signature" });
  }
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader(
    "Content-Type",
    job.format === "jsonl" ? "application/x-ndjson" : "text/csv; charset=utf-8",
  );
  return res.sendFile(path.basename(localPath), { root: path.dirname(localPath) });
});

adminDataExportsRouter.get("/:jobId", async (req: any, res) => {
  const job = await getAdminDataExportJob(String(req.params.jobId || ""));
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });
  return res.json({ ok: true, job });
});

adminDataExportsRouter.get("/:jobId/events", async (req: any, res) => {
  const job = await getAdminDataExportJob(String(req.params.jobId || ""));
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });

  const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 200)));
  const events = await listAdminDataExportJobEvents({ jobId: job.id, limit });
  return res.json({ ok: true, events });
});

adminDataExportsRouter.post("/:jobId/retry", async (req: any, res) => {
  const jobId = String(req.params.jobId || "");
  const job = await getAdminDataExportJob(jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });

  if (!["FAILED", "CANCELED", "EXPIRED"].includes(job.status)) {
    return res.status(409).json({ message: `Cannot retry job in status ${job.status}` });
  }
  if (!enforceAdminRateLimit({ res, adminId: getSessionAdminId(req), kind: "retry" })) return;

  if (job.objectKey) {
    await deleteExportArtifact(job.objectKey).catch(() => {});
  }
  await retryAdminDataExportJobInRepo(jobId).catch(() => {});
  await appendAdminDataExportEvent({
    jobId,
    level: "INFO",
    message: "Retry requested by admin",
    context: { adminId: getSessionAdminId(req) },
  });
  await retryAdminDataExportJob(jobId);
  return res.json({ ok: true, jobId });
});

adminDataExportsRouter.post("/:jobId/cancel", async (req: any, res) => {
  const jobId = String(req.params.jobId || "");
  const job = await getAdminDataExportJob(jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });

  await cancelAdminDataExportQueueJob(jobId);
  await markAdminDataExportJobCanceled(jobId);
  await appendAdminDataExportEvent({
    jobId,
    level: "INFO",
    message: "Job canceled by admin",
    context: { adminId: getSessionAdminId(req) },
  });
  return res.json({ ok: true, jobId });
});

adminDataExportsRouter.get("/:jobId/download-link", async (req: any, res) => {
  const jobId = String(req.params.jobId || "");
  const job = await getAdminDataExportJob(jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (!canAccessJob(req, job)) return res.status(403).json({ message: "Forbidden" });
  if (job.status !== "READY" || !job.objectKey) {
    return res.status(409).json({ message: "Export is not ready" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (job.expiresAt && job.expiresAt <= now) {
    if (job.objectKey) {
      await deleteExportArtifact(job.objectKey).catch(() => {});
    }
    await markAdminDataExportJobExpired(job.id).catch(() => {});
    onAdminExportJobExpired();
    await appendAdminDataExportEvent({
      jobId: job.id,
      level: "INFO",
      message: "Download link request rejected because artifact is expired",
      context: { adminId: getSessionAdminId(req), expiresAt: job.expiresAt },
    }).catch(() => {});
    return res.status(410).json({ message: "Export artifact expired" });
  }

  const extension = job.format === "jsonl" ? "jsonl" : "csv";
  const fileName = `${job.type}-${job.id}.${extension}`;
  if (!enforceAdminRateLimit({ res, adminId: getSessionAdminId(req), kind: "download" })) return;
  const link = await getExportDownloadLink({
    objectKey: job.objectKey,
    fileName,
  });

  await appendAdminDataExportEvent({
    jobId,
    level: "INFO",
    message: "Download link issued",
    context: { adminId: getSessionAdminId(req), expiresAt: link.expiresAt },
  }).catch(() => {});

  return res.json({
    ok: true,
    jobId: job.id,
    url: link.url,
    expiresAt: link.expiresAt,
  });
});

adminDataExportsRouter.post("/trader-scouting", async (req: any, res) => {
  try {
    const requestedByAdminId = getSessionAdminId(req);
    if (!requestedByAdminId) return res.status(403).json({ message: "Forbidden" });
    if (!enforceAdminRateLimit({ res, adminId: requestedByAdminId, kind: "create" })) return;
    const parsed = adminDataExportCreateRequestSchema.parse({
      type: "trader_scouting",
      format: req.body?.format ?? "csv",
      filters: req.body?.filters ?? {},
    });
    const result = await createAndEnqueueJob({ request: parsed, requestedByAdminId });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || "Failed to create trader scouting export job" });
  }
});

adminDataExportsRouter.post("/deactivated-accounts", async (req: any, res) => {
  try {
    const requestedByAdminId = getSessionAdminId(req);
    if (!requestedByAdminId) return res.status(403).json({ message: "Forbidden" });
    if (!enforceAdminRateLimit({ res, adminId: requestedByAdminId, kind: "create" })) return;
    const parsed = adminDataExportCreateRequestSchema.parse({
      type: "deactivated_accounts",
      format: req.body?.format ?? "csv",
      filters: req.body?.filters ?? {},
    });
    const result = await createAndEnqueueJob({ request: parsed, requestedByAdminId });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || "Failed to create deactivated accounts export job" });
  }
});

if (String(process.env.BULL_BOARD_ENABLED || "1").trim() !== "0") {
  const adapter = getAdminExportBullBoardAdapter();
  if (adapter) {
    adminDataExportsRouter.use("/queues", adapter.getRouter());
  }
}
