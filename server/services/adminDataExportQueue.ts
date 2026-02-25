import fs from "fs";
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import {
  adminDataExportCreateRequestSchema,
  type AdminDataExportCreateRequest,
} from "@shared/admin/dataExports";
import { buildAdminDataExportArtifact } from "./adminDataExportBuild";
import {
  appendAdminDataExportEvent,
  getAdminDataExportJob,
  incrementAdminDataExportAttempt,
  markAdminDataExportJobFailed,
  markAdminDataExportJobRunning,
  markAdminDataExportJobReady,
  setAdminDataExportJobQueued,
} from "./adminDataExportRepo";
import {
  onAdminExportJobFinished,
  onAdminExportJobStarted,
  setAdminExportQueueDepth,
} from "./adminDataExportMetrics";
import { uploadExportArtifact } from "./objectStorage";
import { getPetascaleRuntimeConfig } from "./petascaleEnv";
import { insertClickHouseJsonRows } from "./clickhouseClient";

type ExportQueuePayload = {
  jobId: string;
};

let queueConnection: IORedis | null = null;
let exportQueue: Queue<ExportQueuePayload> | null = null;
let exportWorker: Worker<ExportQueuePayload> | null = null;
let queueStatsTimer: NodeJS.Timeout | null = null;
let workerStarted = false;

let bullBoardAdapter: ExpressAdapter | null = null;
let bullBoardInitialized = false;

function getRetentionSec(): number {
  const parsed = Number(process.env.ADMIN_DATA_EXPORT_RETENTION_SEC ?? 7 * 24 * 60 * 60);
  if (!Number.isFinite(parsed)) return 7 * 24 * 60 * 60;
  return Math.max(3600, Math.min(30 * 24 * 60 * 60, Math.trunc(parsed)));
}

function getQueueConnection(): IORedis | null {
  const cfg = getPetascaleRuntimeConfig();
  if (!cfg.valkeyUrl) return null;
  if (queueConnection) return queueConnection;
  queueConnection = new IORedis(cfg.valkeyUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  queueConnection.on("error", (err) => {
    console.warn("[admin-export] queue connection error:", err?.message || err);
  });
  return queueConnection;
}

function getQueue(): Queue<ExportQueuePayload> | null {
  const cfg = getPetascaleRuntimeConfig();
  if (!cfg.queueEnabled) return null;
  if (exportQueue) return exportQueue;
  const connection = getQueueConnection();
  if (!connection) return null;

  exportQueue = new Queue<ExportQueuePayload>(cfg.queueName, {
    connection,
    prefix: cfg.queuePrefix,
    defaultJobOptions: {
      attempts: cfg.queueMaxAttempts,
      removeOnComplete: 2000,
      removeOnFail: 5000,
      backoff: {
        type: "exponential",
        delay: cfg.queueBackoffMs,
      },
    },
  });
  return exportQueue;
}

function toExportRequest(job: {
  type: string;
  format: string;
  filtersJson: Record<string, unknown>;
}): AdminDataExportCreateRequest {
  return adminDataExportCreateRequestSchema.parse({
    type: job.type,
    format: job.format,
    filters: job.filtersJson,
  });
}

function toClickHouseDateTime(value: number): string {
  return new Date(value).toISOString().slice(0, 19).replace("T", " ");
}

async function writeExportEventToClickHouse(params: {
  job: {
    id: string;
    type: string;
    format: string;
    requestedByAdminId: number | null;
  };
  status: "READY" | "FAILED" | "CANCELED";
  rowCount: number;
  bytesWritten: number;
  latencyMs: number;
}): Promise<void> {
  await insertClickHouseJsonRows("admin_export_events", [
    {
      ts: toClickHouseDateTime(Date.now()),
      job_id: params.job.id,
      export_type: params.job.type,
      export_format: params.job.format,
      status: params.status,
      row_count: Math.max(0, Math.trunc(params.rowCount || 0)),
      bytes_written: Math.max(0, Math.trunc(params.bytesWritten || 0)),
      latency_ms: Math.max(0, Math.trunc(params.latencyMs || 0)),
      admin_id: params.job.requestedByAdminId ? Math.max(0, params.job.requestedByAdminId) : 0,
    },
  ]).catch(() => {});
}

async function runAdminExportJob(jobId: string): Promise<void> {
  const startedAtMs = Date.now();
  const retentionSec = getRetentionSec();
  onAdminExportJobStarted();
  await markAdminDataExportJobRunning(jobId);
  await appendAdminDataExportEvent({
    jobId,
    level: "INFO",
    message: "Worker started export job",
  });

  const job = await getAdminDataExportJob(jobId);
  if (!job) {
    onAdminExportJobFinished({ success: false, durationMs: Date.now() - startedAtMs });
    throw new Error("Export job not found");
  }
  if (job.status === "CANCELED" || job.status === "EXPIRED") {
    onAdminExportJobFinished({ success: false, canceled: true, durationMs: Date.now() - startedAtMs });
    return;
  }

  let artifactPath = "";
  try {
    await incrementAdminDataExportAttempt(jobId);
    const request = toExportRequest({
      type: job.type,
      format: job.format,
      filtersJson: job.filtersJson,
    });
    const built = await buildAdminDataExportArtifact({
      jobId,
      request,
    });
    artifactPath = built.filePath;

    const uploaded = await uploadExportArtifact({
      jobId,
      sourcePath: built.filePath,
      filename: built.filename,
      contentType: built.contentType,
    });
    const expiresAt = Math.floor(Date.now() / 1000) + retentionSec;
    await markAdminDataExportJobReady({
      jobId,
      objectKey: uploaded.objectKey,
      rowCount: built.rowCount,
      bytesWritten: uploaded.bytesWritten,
      truncated: built.truncated,
      expiresAt,
    });
    await appendAdminDataExportEvent({
      jobId,
      level: "INFO",
      message: "Export artifact uploaded",
      context: {
        objectKey: uploaded.objectKey,
        bytesWritten: uploaded.bytesWritten,
        rowCount: built.rowCount,
        truncated: built.truncated,
      },
    });
    await writeExportEventToClickHouse({
      job,
      status: "READY",
      rowCount: built.rowCount,
      bytesWritten: uploaded.bytesWritten,
      latencyMs: Date.now() - startedAtMs,
    });
    onAdminExportJobFinished({ success: true, durationMs: Date.now() - startedAtMs });
  } catch (err: any) {
    const message = String(err?.message || err || "Export worker failed");
    await markAdminDataExportJobFailed({ jobId, error: message, attemptCountDelta: 0 });
    await appendAdminDataExportEvent({
      jobId,
      level: "ERROR",
      message: "Export worker failed",
      context: { error: message },
    });
    if (job) {
      await writeExportEventToClickHouse({
        job,
        status: "FAILED",
        rowCount: 0,
        bytesWritten: 0,
        latencyMs: Date.now() - startedAtMs,
      });
    }
    onAdminExportJobFinished({ success: false, durationMs: Date.now() - startedAtMs });
    throw err;
  } finally {
    if (artifactPath) {
      try {
        fs.rmSync(artifactPath, { force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

async function refreshQueueStats(): Promise<void> {
  const q = getQueue();
  if (!q) return;
  try {
    const counts = await q.getJobCounts("waiting", "active", "delayed", "failed", "completed");
    setAdminExportQueueDepth({
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      failed: counts.failed || 0,
      completed: counts.completed || 0,
    });
  } catch {
    // ignore intermittent telemetry failures
  }
}

export async function enqueueAdminDataExportJob(params: { jobId: string }): Promise<{ queueJobId: string }> {
  const cfg = getPetascaleRuntimeConfig();
  const q = getQueue();
  if (!q) {
    // Fallback mode keeps exports operational if queue infra is unavailable.
    setImmediate(() => {
      runAdminExportJob(params.jobId).catch((err) => {
        console.error("[admin-export] fallback worker error:", err);
      });
    });
    await setAdminDataExportJobQueued({
      jobId: params.jobId,
      queueName: cfg.queueName,
      queueJobId: params.jobId,
    });
    return { queueJobId: params.jobId };
  }

  const queued = await q.add(
    "admin-data-export",
    { jobId: params.jobId },
    {
      jobId: params.jobId,
      priority: 10,
      attempts: cfg.queueMaxAttempts,
      backoff: { type: "exponential", delay: cfg.queueBackoffMs },
    },
  );
  const queueJobId = String(queued.id || params.jobId);
  await setAdminDataExportJobQueued({
    jobId: params.jobId,
    queueName: cfg.queueName,
    queueJobId,
  });
  await appendAdminDataExportEvent({
    jobId: params.jobId,
    level: "INFO",
    message: "Export job enqueued",
    context: { queueJobId },
  });
  void refreshQueueStats();
  return { queueJobId };
}

export async function retryAdminDataExportJob(jobId: string): Promise<void> {
  const q = getQueue();
  if (!q) {
    setImmediate(() => {
      runAdminExportJob(jobId).catch((err) => {
        console.error("[admin-export] retry fallback worker error:", err);
      });
    });
    return;
  }
  await q.add(
    "admin-data-export",
    { jobId },
    {
      jobId,
      priority: 5,
      attempts: getPetascaleRuntimeConfig().queueMaxAttempts,
      backoff: { type: "exponential", delay: getPetascaleRuntimeConfig().queueBackoffMs },
    },
  );
  void refreshQueueStats();
}

export async function cancelAdminDataExportQueueJob(jobId: string): Promise<void> {
  const q = getQueue();
  if (!q) return;
  const existing = await q.getJob(jobId);
  if (!existing) return;
  await existing.remove().catch(() => {});
  void refreshQueueStats();
}

export function startAdminDataExportWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const cfg = getPetascaleRuntimeConfig();
  const q = getQueue();
  if (!q) {
    console.warn("[admin-export] queue disabled or VALKEY_URL missing; running in fallback mode");
    return;
  }

  const connection = getQueueConnection();
  if (!connection) {
    console.warn("[admin-export] queue connection unavailable");
    return;
  }

  exportWorker = new Worker<ExportQueuePayload>(
    cfg.queueName,
    async (job: Job<ExportQueuePayload>) => {
      await runAdminExportJob(job.data.jobId);
    },
    {
      connection,
      prefix: cfg.queuePrefix,
      concurrency: cfg.queueConcurrency,
      autorun: true,
    },
  );

  exportWorker.on("completed", () => {
    void refreshQueueStats();
  });

  exportWorker.on("failed", async (job, err) => {
    const jobId = job?.data?.jobId;
    if (jobId) {
      await appendAdminDataExportEvent({
        jobId,
        level: "ERROR",
        message: "BullMQ worker failure",
        context: { error: String(err?.message || err) },
      }).catch(() => {});
    }
    void refreshQueueStats();
  });

  queueStatsTimer = setInterval(() => {
    void refreshQueueStats();
  }, 10_000);
  queueStatsTimer.unref?.();
  void refreshQueueStats();
  console.log(
    `[admin-export] worker started queue=${cfg.queueName} concurrency=${cfg.queueConcurrency}`,
  );
}

export function getAdminExportBullBoardAdapter(): ExpressAdapter | null {
  const q = getQueue();
  if (!q) return null;
  if (!bullBoardAdapter) {
    bullBoardAdapter = new ExpressAdapter();
    bullBoardAdapter.setBasePath("/api/admin/data-exports/queues");
  }

  if (!bullBoardInitialized) {
    createBullBoard({
      queues: [new BullMQAdapter(q)],
      serverAdapter: bullBoardAdapter,
    });
    bullBoardInitialized = true;
  }
  return bullBoardAdapter;
}
