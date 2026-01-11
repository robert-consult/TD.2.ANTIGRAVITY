// @ts-nocheck
import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { requireAdmin } from "../middleware/requireAdmin";
import { storage } from "../storage";
import { db } from "@db";
import { migrationExportJobs, migrationImportJobs, migrationIntegrityChecks, migrationJobLogs } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import {
  createExportJob,
  createImportJob,
  getExportJob,
  getImportJob,
  listExportJobs,
  listImportJobs,
  listJobLogs,
} from "../migration/migrationService";

const EXPORT_DIR = path.join(process.cwd(), "migration_exports");
const IMPORT_DIR = path.join(process.cwd(), "migration_imports");

if (!fs.existsSync(IMPORT_DIR)) {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
}

const upload = multer({ dest: IMPORT_DIR });

function requireMigrationAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId || !req.session?.isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const allowedIdsRaw = process.env.MIGRATION_SUPERADMIN_IDS || "";
  const allowedEmailsRaw = process.env.MIGRATION_SUPERADMIN_EMAILS || "";
  if (!allowedIdsRaw && !allowedEmailsRaw) {
    return next();
  }

  const allowedIds = allowedIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
  const allowedEmails = allowedEmailsRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const userId = Number(req.session.userId);
  const email = String(req.session.email || "").toLowerCase();
  const idAllowed = allowedIds.length === 0 || allowedIds.includes(userId);
  const emailAllowed = allowedEmails.length === 0 || allowedEmails.includes(email);

  if (!idAllowed || !emailAllowed) {
    return res.status(403).json({ message: "Forbidden" });
  }
  return next();
}

function isPathUnder(dir: string, filePath: string): boolean {
  const resolvedDir = path.resolve(dir) + path.sep;
  const resolvedFile = path.resolve(filePath);
  return resolvedFile.startsWith(resolvedDir);
}

function parseJsonField(value: any) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowMs() {
  return Date.now();
}

function safeJson(value: any) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function parseRangeHeader(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return null;

  if (!startRaw && endRaw) {
    const suffixLen = Number(endRaw);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    const start = Math.max(0, size - suffixLen);
    const end = size - 1;
    if (start > end) return null;
    return { start, end };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return null;
  const end = endRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(end) || end < start) return null;
  if (start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function sendFileWithRange(req: any, res: any, filePath: string, opts: { contentType: string; filename: string }) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  res.setHeader("Content-Type", opts.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${opts.filename}"`);
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = String(req.headers?.range || "").trim();
  if (!rangeHeader) {
    res.setHeader("Content-Length", size);
    return fs.createReadStream(filePath).pipe(res);
  }

  const range = parseRangeHeader(rangeHeader, size);
  if (!range) {
    res.status(416);
    res.setHeader("Content-Range", `bytes */${size}`);
    return res.end();
  }

  const { start, end } = range;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  return fs.createReadStream(filePath, { start, end }).pipe(res);
}

export const adminMigrationRouter = Router();
adminMigrationRouter.use(requireAdmin);
adminMigrationRouter.use(requireMigrationAdmin);

// POST /api/admin/migration/export-jobs
adminMigrationRouter.post("/export-jobs", async (req, res) => {
  try {
    const scope = String(req.body?.scope || "FULL_PLATFORM");
    const userIdRaw = req.body?.userId;
    const sinceTsRaw = req.body?.sinceTs;

    if (!["FULL_PLATFORM", "USER_BUNDLE", "DELTA"].includes(scope)) {
      return res.status(400).json({ message: "Invalid scope" });
    }

    const userId = userIdRaw !== undefined && userIdRaw !== null ? Number(userIdRaw) : undefined;
    const sinceTs = sinceTsRaw !== undefined && sinceTsRaw !== null ? Number(sinceTsRaw) : undefined;

    if (scope === "USER_BUNDLE" && !Number.isFinite(userId)) {
      return res.status(400).json({ message: "USER_BUNDLE requires userId" });
    }
    if (scope === "DELTA" && !Number.isFinite(sinceTs)) {
      return res.status(400).json({ message: "DELTA requires sinceTs (epoch ms)" });
    }

    const { jobId } = await createExportJob({
      scope,
      userId: Number.isFinite(userId) ? userId : undefined,
      sinceTs: Number.isFinite(sinceTs) ? sinceTs : undefined,
      requestedByAdminId: req.session.userId,
    });

    try {
      await storage.logAdminAction({
        adminId: req.session.userId,
        userId: userId ?? 0,
        actionType: "MIGRATION_EXPORT_REQUEST",
        metadata: { scope, sinceTs: sinceTs ?? null },
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });
    } catch {}

    return res.json({ jobId });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to create export job" });
  }
});

// GET /api/admin/migration/export-jobs
adminMigrationRouter.get("/export-jobs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit || 50)), 500);
    const jobs = listExportJobs(limit);
    return res.json(jobs.map((j: any) => ({
      ...j,
      totals: parseJsonField(j.totalsJson),
      manifest: parseJsonField(j.manifestJson),
    })));
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to list export jobs" });
  }
});

// GET /api/admin/migration/export-jobs/:jobId
adminMigrationRouter.get("/export-jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getExportJob(jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });
  return res.json({
    ...job,
    totals: parseJsonField(job.totalsJson),
    manifest: parseJsonField(job.manifestJson),
  });
});

// GET /api/admin/migration/export-jobs/:jobId/manifest
adminMigrationRouter.get("/export-jobs/:jobId/manifest", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getExportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status !== "READY" || !job.manifestPath) {
    return res.status(409).json({ message: "Export not ready" });
  }
  if (!isPathUnder(EXPORT_DIR, job.manifestPath) || !fs.existsSync(job.manifestPath)) {
    return res.status(404).json({ message: "Manifest file not found" });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${jobId}-manifest.json"`);
  // Express 5 + Windows: `res.sendFile(absolutePath)` can incorrectly 404.
  // Using `root` + relative path avoids the issue.
  return res.sendFile(path.basename(job.manifestPath), { root: path.dirname(job.manifestPath) });
});

// GET /api/admin/migration/export-jobs/:jobId/data
adminMigrationRouter.get("/export-jobs/:jobId/data", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getExportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status !== "READY") {
    return res.status(409).json({ message: "Export not ready" });
  }

  const partRaw = req.query?.part;
  let partIndex: number | null = null;
  if (partRaw !== undefined) {
    const raw = Array.isArray(partRaw) ? partRaw[0] : partRaw;
    const parsed = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return res.status(400).json({ message: "Invalid part index" });
    }
    partIndex = Math.floor(parsed);
  }

  const parts = parseJsonField(job.dataPartsJson);
  let filePath: string | null = null;
  if (Array.isArray(parts) && parts.length > 0) {
    const index = partIndex ?? 0;
    if (index < 0 || index >= parts.length) {
      return res.status(404).json({ message: "Chunk not found" });
    }
    filePath = String(parts[index] || "");
  } else {
    if (partIndex !== null && partIndex !== 0) {
      return res.status(404).json({ message: "Chunk not found" });
    }
    filePath = job.dataPath ? String(job.dataPath) : null;
  }

  if (!filePath) {
    return res.status(404).json({ message: "Data file not found" });
  }
  if (!isPathUnder(EXPORT_DIR, filePath) || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Data file not found" });
  }

  return sendFileWithRange(req, res, filePath, {
    contentType: "application/x-ndjson",
    filename: path.basename(filePath) || `${jobId}.ndjson`,
  });
});

// GET /api/admin/migration/export-jobs/:jobId/chunks
adminMigrationRouter.get("/export-jobs/:jobId/chunks", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getExportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status !== "READY") {
    return res.status(409).json({ message: "Export not ready" });
  }

  let manifest = parseJsonField(job.manifestJson);
  const manifestHasChunks = Array.isArray(manifest?.chunks) && manifest.chunks.length > 0;
  if ((!manifest || !manifestHasChunks) && job.manifestPath && isPathUnder(EXPORT_DIR, job.manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(job.manifestPath, "utf8"));
    } catch {
      manifest = null;
    }
  }

  if (!manifest) {
    return res.status(404).json({ message: "Manifest not found" });
  }

  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  return res.json({
    jobId,
    chunking: manifest?.chunking ?? { enabled: false },
    chunkChain: manifest?.chunkChain ?? null,
    dataSha256: manifest?.dataSha256 ?? null,
    dataSizeBytes: manifest?.dataSizeBytes ?? null,
    chunks,
  });
});

// GET /api/admin/migration/export-jobs/:jobId/chunks/:index
adminMigrationRouter.get("/export-jobs/:jobId/chunks/:index", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const indexRaw = Number(req.params.index);
  const index = Number.isFinite(indexRaw) ? Math.floor(indexRaw) : NaN;
  if (!Number.isFinite(index) || index < 0) {
    return res.status(400).json({ message: "Invalid chunk index" });
  }

  const job = getExportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status !== "READY") {
    return res.status(409).json({ message: "Export not ready" });
  }

  const parts = parseJsonField(job.dataPartsJson);
  let filePath: string | null = null;
  if (Array.isArray(parts) && index < parts.length) {
    filePath = String(parts[index] || "");
  } else if (index === 0 && job.dataPath) {
    filePath = String(job.dataPath || "");
  }

  if (!filePath) return res.status(404).json({ message: "Chunk not found" });
  if (!isPathUnder(EXPORT_DIR, filePath) || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Chunk file not found" });
  }

  return sendFileWithRange(req, res, filePath, {
    contentType: "application/x-ndjson",
    filename: path.basename(filePath),
  });
});

// POST /api/admin/migration/import-jobs
adminMigrationRouter.post(
  "/import-jobs",
  upload.fields([
    { name: "manifest", maxCount: 1 },
    { name: "data", maxCount: 500 },
  ]),
  async (req: any, res: any) => {
    try {
      const files = req.files || {};
      const manifestFile = files.manifest?.[0];
      const dataFiles = Array.isArray(files.data) ? files.data : [];

      if (!manifestFile || dataFiles.length === 0) {
        return res.status(400).json({ message: "manifest and data files are required" });
      }

      let manifest: any;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestFile.path, "utf8"));
      } catch {
        return res.status(400).json({ message: "Invalid manifest JSON" });
      }

      const mode = String(req.body?.mode || "DRY_RUN");
      const idStrategy = String(req.body?.idStrategy || "PRESERVE");

      if (!["DRY_RUN", "IMPORT"].includes(mode)) {
        return res.status(400).json({ message: "Invalid mode" });
      }
      if (idStrategy !== "PRESERVE") {
        return res.status(400).json({ message: "Unsupported idStrategy (PRESERVE only)" });
      }

      const expectedChunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
      const expectedFiles = expectedChunks
        .map((c: any) => String(c?.file || ""))
        .filter((name: string) => name.trim().length > 0);
      const chunkingFlag = Boolean(manifest?.chunking?.enabled ?? false);
      const isChunked = chunkingFlag || expectedFiles.length > 1;

      let dataPartsPaths: string[] = [];
      if (isChunked && expectedFiles.length > 0) {
        const byName = new Map<string, any>();
        for (const f of dataFiles) {
          const name = String(f?.originalname || "");
          if (!name) continue;
          byName.set(name, f);
        }
        const missing = expectedFiles.filter((n) => !byName.has(n));
        if (missing.length) {
          return res.status(400).json({ message: `Missing chunk files: ${missing.join(", ")}` });
        }
        const extras = dataFiles
          .map((f: any) => String(f?.originalname || ""))
          .filter((n: string) => n && !expectedFiles.includes(n));
        if (extras.length) {
          return res.status(400).json({ message: `Unexpected chunk files: ${extras.join(", ")}` });
        }
        dataPartsPaths = expectedFiles.map((n) => String(byName.get(n).path));
      } else {
        dataPartsPaths = [String(dataFiles[0].path)];
      }

      const { jobId } = await createImportJob({
        mode,
        idStrategy,
        manifestPath: manifestFile.path,
        dataPath: dataPartsPaths[0],
        dataPartsPaths,
        requestedByAdminId: req.session.userId,
      });

      try {
        await storage.logAdminAction({
          adminId: req.session.userId,
          userId: 0,
          actionType: "MIGRATION_IMPORT_REQUEST",
          metadata: {
            mode,
            idStrategy,
            scope: manifest?.scope ?? null,
            userId: manifest?.userId ?? null,
            sinceTs: manifest?.sinceTs ?? null,
            tables: Array.isArray(manifest?.tables) ? manifest.tables : null,
            skippedTables: Array.isArray(manifest?.skippedTables) ? manifest.skippedTables : null,
            chunked: isChunked,
            chunkCount: dataPartsPaths.length,
          },
          ip: req.ip || null,
          userAgent: req.get("user-agent") || null,
        });
      } catch {}

      return res.json({ jobId });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message || "Failed to create import job" });
    }
  }
);

// GET /api/admin/migration/import-jobs
adminMigrationRouter.get("/import-jobs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, Number(req.query.limit || 50)), 500);
    const jobs = listImportJobs(limit);
    return res.json(jobs.map((j: any) => ({
      ...j,
      totals: parseJsonField(j.totalsJson),
    })));
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to list import jobs" });
  }
});

// GET /api/admin/migration/import-jobs/:jobId
adminMigrationRouter.get("/import-jobs/:jobId", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getImportJob(jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });
  return res.json({
    ...job,
    totals: parseJsonField(job.totalsJson),
  });
});

// DELETE /api/admin/migration/import-jobs/:jobId/files
adminMigrationRouter.delete("/import-jobs/:jobId/files", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getImportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status === "RUNNING" || job.status === "QUEUED") {
    return res.status(409).json({ message: "Job is still running" });
  }

  const removed: string[] = [];
  const missing: string[] = [];
  let bytesFreed = 0;

  const removeFile = (filePath?: string | null) => {
    if (!filePath) return;
    if (!isPathUnder(IMPORT_DIR, filePath)) return;
    if (fs.existsSync(filePath)) {
      try {
        bytesFreed += fs.statSync(filePath).size;
      } catch {}
      fs.unlinkSync(filePath);
      removed.push(path.basename(filePath));
    } else {
      missing.push(path.basename(filePath));
    }
  };

  const partPaths = parseJsonField(job.dataPartsJson);
  if (Array.isArray(partPaths)) {
    for (const p of partPaths) {
      if (typeof p === "string") removeFile(p);
    }
  }
  removeFile(job.dataPath);
  removeFile(job.manifestPath);

  await db
    .update(migrationImportJobs)
    .set({
      dataPath: null,
      dataPartsJson: null,
      manifestPath: null,
      status: "PURGED",
    })
    .where(eq(migrationImportJobs.id, jobId))
    .run();

  try {
    await db.insert(migrationJobLogs).values({
      jobId,
      ts: nowMs(),
      level: "INFO",
      message: "Import files purged",
      contextJson: safeJson({ removed, missing, bytesFreed }),
    }).run();
  } catch {}

  try {
    await storage.logAdminAction({
      adminId: req.session.userId,
      userId: 0,
      actionType: "MIGRATION_IMPORT_PURGE",
      metadata: {
        jobId,
        removed,
        missing,
        bytesFreed,
      },
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });
  } catch {}

  return res.json({ ok: true, removed, missing, bytesFreed });
});

// GET /api/admin/migration/jobs/:jobId/logs
adminMigrationRouter.get("/jobs/:jobId/logs", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const limit = Math.min(Math.max(1, Number(req.query.limit || 200)), 500);
  const logs = listJobLogs(jobId, limit);
  return res.json(logs);
});

// GET /api/admin/migration/jobs/:jobId/integrity
adminMigrationRouter.get("/jobs/:jobId/integrity", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    const rows = await db
      .select()
      .from(migrationIntegrityChecks)
      .where(eq(migrationIntegrityChecks.jobId, jobId))
      .orderBy(desc(migrationIntegrityChecks.verifiedAt))
      .all();
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to fetch integrity checks" });
  }
});

// DELETE /api/admin/migration/export-jobs/:jobId/files
adminMigrationRouter.delete("/export-jobs/:jobId/files", async (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = getExportJob(jobId) as any;
  if (!job) return res.status(404).json({ message: "Job not found" });
  if (job.status === "RUNNING" || job.status === "QUEUED") {
    return res.status(409).json({ message: "Job is still running" });
  }

  const removed: string[] = [];
  const missing: string[] = [];
  let bytesFreed = 0;

  const removeFile = (filePath?: string | null) => {
    if (!filePath) return;
    if (!isPathUnder(EXPORT_DIR, filePath)) return;
    if (fs.existsSync(filePath)) {
      try {
        bytesFreed += fs.statSync(filePath).size;
      } catch {}
      fs.unlinkSync(filePath);
      removed.push(path.basename(filePath));
    } else {
      missing.push(path.basename(filePath));
    }
  };

  const partPaths = parseJsonField(job.dataPartsJson);
  if (Array.isArray(partPaths)) {
    for (const p of partPaths) {
      if (typeof p === "string") removeFile(p);
    }
  }
  removeFile(job.dataPath);
  removeFile(job.manifestPath);

  await db
    .update(migrationExportJobs)
    .set({
      dataPath: null,
      dataPartsJson: null,
      manifestPath: null,
      status: "PURGED",
    })
    .where(eq(migrationExportJobs.id, jobId))
    .run();

  try {
    await db.insert(migrationJobLogs).values({
      jobId,
      ts: nowMs(),
      level: "INFO",
      message: "Export files purged",
      contextJson: safeJson({ removed, missing, bytesFreed }),
    }).run();
  } catch {}

  try {
    await storage.logAdminAction({
      adminId: req.session.userId,
      userId: job.userId ?? 0,
      actionType: "MIGRATION_EXPORT_PURGE",
      metadata: {
        jobId,
        scope: job.scope,
        userId: job.userId ?? null,
        sinceTs: job.sinceTs ?? null,
        removed,
        missing,
        bytesFreed,
      },
      ip: req.ip || null,
      userAgent: req.get("user-agent") || null,
    });
  } catch {}

  return res.json({ ok: true, removed, missing, bytesFreed });
});

// POST /api/admin/migration/export-jobs/purge
adminMigrationRouter.post("/export-jobs/purge", async (req, res) => {
  try {
    const daysRaw = Number(req.body?.olderThanDays ?? 30);
    const olderThanDays = Number.isFinite(daysRaw) ? Math.max(1, Math.floor(daysRaw)) : 30;
    const cutoff = nowMs() - olderThanDays * 24 * 60 * 60 * 1000;

    const rows = db.$client.prepare(
      `SELECT * FROM migration_export_jobs
       WHERE created_at < ?
       AND (data_path IS NOT NULL OR manifest_path IS NOT NULL)
       ORDER BY created_at DESC`
    ).all(cutoff) as any[];

    let jobsPurged = 0;
    let filesRemoved = 0;
    let bytesFreed = 0;

    for (const job of rows as any[]) {
      if (job.status === "RUNNING" || job.status === "QUEUED") continue;
      const removed: string[] = [];

      const removeFile = (filePath?: string | null) => {
        if (!filePath) return;
        if (!isPathUnder(EXPORT_DIR, filePath)) return;
        if (fs.existsSync(filePath)) {
          try {
            bytesFreed += fs.statSync(filePath).size;
          } catch {}
          fs.unlinkSync(filePath);
          removed.push(path.basename(filePath));
          filesRemoved += 1;
        }
      };

      const jobDataPath = job.data_path ?? job.dataPath ?? null;
      const jobManifestPath = job.manifest_path ?? job.manifestPath ?? null;
      const jobDataPartsJson = job.data_parts_json ?? job.dataPartsJson ?? null;
      const partPaths = parseJsonField(jobDataPartsJson);
      if (Array.isArray(partPaths)) {
        for (const p of partPaths) {
          if (typeof p === "string") removeFile(p);
        }
      }
      removeFile(jobDataPath);
      removeFile(jobManifestPath);

      if (removed.length > 0) {
        jobsPurged += 1;
        await db
          .update(migrationExportJobs)
          .set({ dataPath: null, dataPartsJson: null, manifestPath: null, status: "PURGED" })
          .where(eq(migrationExportJobs.id, job.id))
          .run();
      }
    }

    try {
      await storage.logAdminAction({
        adminId: req.session.userId,
        userId: 0,
        actionType: "MIGRATION_EXPORT_PURGE_BULK",
        metadata: { olderThanDays, jobsPurged, filesRemoved, bytesFreed },
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });
    } catch {}

    return res.json({ ok: true, olderThanDays, jobsPurged, filesRemoved, bytesFreed });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to purge export files" });
  }
});

// POST /api/admin/migration/import-jobs/purge
adminMigrationRouter.post("/import-jobs/purge", async (req, res) => {
  try {
    const daysRaw = Number(req.body?.olderThanDays ?? 30);
    const olderThanDays = Number.isFinite(daysRaw) ? Math.max(1, Math.floor(daysRaw)) : 30;
    const cutoff = nowMs() - olderThanDays * 24 * 60 * 60 * 1000;

    const rows = db.$client.prepare(
      `SELECT * FROM migration_import_jobs
       WHERE created_at < ?
       AND (data_path IS NOT NULL OR manifest_path IS NOT NULL)
       ORDER BY created_at DESC`
    ).all(cutoff) as any[];

    let jobsPurged = 0;
    let filesRemoved = 0;
    let bytesFreed = 0;
    let strayFilesRemoved = 0;

    for (const job of rows) {
      if (job.status === "RUNNING" || job.status === "QUEUED") continue;
      const removed: string[] = [];

      const removeFile = (filePath?: string | null) => {
        if (!filePath) return;
        if (!isPathUnder(IMPORT_DIR, filePath)) return;
        if (fs.existsSync(filePath)) {
          try {
            bytesFreed += fs.statSync(filePath).size;
          } catch {}
          fs.unlinkSync(filePath);
          removed.push(path.basename(filePath));
          filesRemoved += 1;
        }
      };

      const jobDataPath = job.data_path ?? job.dataPath ?? null;
      const jobManifestPath = job.manifest_path ?? job.manifestPath ?? null;
      const jobDataPartsJson = job.data_parts_json ?? job.dataPartsJson ?? null;
      const partPaths = parseJsonField(jobDataPartsJson);
      if (Array.isArray(partPaths)) {
        for (const p of partPaths) {
          if (typeof p === "string") removeFile(p);
        }
      }
      removeFile(jobDataPath);
      removeFile(jobManifestPath);

      if (removed.length > 0) {
        jobsPurged += 1;
        await db
          .update(migrationImportJobs)
          .set({ dataPath: null, dataPartsJson: null, manifestPath: null, status: "PURGED" })
          .where(eq(migrationImportJobs.id, job.id))
          .run();
      }
    }

    const keepFiles = new Set<string>();
    const activeRows = db.$client.prepare(
      `SELECT data_path as dataPath, data_parts_json as dataPartsJson, manifest_path as manifestPath
       FROM migration_import_jobs
       WHERE status IN ('RUNNING','QUEUED')`
    ).all() as any[];

    for (const row of activeRows) {
      if (row?.dataPath) keepFiles.add(path.resolve(row.dataPath));
      if (row?.manifestPath) keepFiles.add(path.resolve(row.manifestPath));
      const partPaths = parseJsonField(row?.dataPartsJson ?? row?.data_parts_json ?? null);
      if (Array.isArray(partPaths)) {
        for (const p of partPaths) {
          if (typeof p === "string") keepFiles.add(path.resolve(p));
        }
      }
    }

    try {
      const entries = fs.readdirSync(IMPORT_DIR);
      for (const entry of entries) {
        const fullPath = path.join(IMPORT_DIR, entry);
        if (!isPathUnder(IMPORT_DIR, fullPath)) continue;
        if (keepFiles.has(path.resolve(fullPath))) continue;
        let stats: fs.Stats;
        try {
          stats = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (!stats.isFile()) continue;
        if (stats.mtimeMs >= cutoff) continue;
        bytesFreed += stats.size;
        fs.unlinkSync(fullPath);
        strayFilesRemoved += 1;
      }
    } catch {}

    try {
      await storage.logAdminAction({
        adminId: req.session.userId,
        userId: 0,
        actionType: "MIGRATION_IMPORT_PURGE_BULK",
        metadata: { olderThanDays, jobsPurged, filesRemoved, strayFilesRemoved, bytesFreed },
        ip: req.ip || null,
        userAgent: req.get("user-agent") || null,
      });
    } catch {}

    return res.json({ ok: true, olderThanDays, jobsPurged, filesRemoved, strayFilesRemoved, bytesFreed });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message || "Failed to purge import files" });
  }
});
