import {
  appendAdminDataExportEvent,
  listExpiredAdminDataExportJobs,
  markAdminDataExportJobExpired,
} from "./adminDataExportRepo";
import { onAdminExportJobExpired, onAdminExportRetentionSweep } from "./adminDataExportMetrics";
import { deleteExportArtifact } from "./objectStorage";

let started = false;
let running = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;

function parsePositiveInt(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function envEnabled(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const ENABLED = envEnabled("ADMIN_DATA_EXPORT_RETENTION_SWEEP_ENABLED", true);
const START_DELAY_SEC = parsePositiveInt(
  "ADMIN_DATA_EXPORT_RETENTION_SWEEP_START_DELAY_SEC",
  120,
  0,
  86_400,
);
const INTERVAL_SEC = parsePositiveInt("ADMIN_DATA_EXPORT_RETENTION_SWEEP_INTERVAL_SEC", 600, 30, 86_400);
const BATCH_LIMIT = parsePositiveInt("ADMIN_DATA_EXPORT_RETENTION_SWEEP_BATCH_LIMIT", 200, 1, 1000);

async function runRetentionSweep(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = Date.now();

  try {
    const expiredJobs = await listExpiredAdminDataExportJobs({
      nowSec: Math.floor(Date.now() / 1000),
      limit: BATCH_LIMIT,
    });
    if (!expiredJobs.length) return;

    let expiredCount = 0;
    for (const job of expiredJobs) {
      try {
        if (job.objectKey) {
          await deleteExportArtifact(job.objectKey);
        }
        await markAdminDataExportJobExpired(job.id);
        onAdminExportJobExpired();
        await appendAdminDataExportEvent({
          jobId: job.id,
          level: "INFO",
          message: "Export artifact expired and cleaned up by scheduler",
          context: {
            objectKey: job.objectKey,
            previousStatus: job.status,
          },
        });
        expiredCount += 1;
      } catch (error: any) {
        await appendAdminDataExportEvent({
          jobId: job.id,
          level: "ERROR",
          message: "Export retention sweep failed for job",
          context: {
            error: String(error?.message || error),
          },
        }).catch(() => {});
      }
    }

    if (expiredCount > 0) {
      console.log(
        `[admin-export-retention] expired=${expiredCount} scanned=${expiredJobs.length} tookMs=${Date.now() - startedAt}`,
      );
    }
    onAdminExportRetentionSweep({ expiredCount });
  } catch (error) {
    console.warn("[admin-export-retention] sweep failed:", error);
  } finally {
    running = false;
  }
}

export function startAdminDataExportRetentionScheduler(): void {
  if (started) return;
  started = true;

  if (!ENABLED) {
    console.log("[admin-export-retention] disabled (ADMIN_DATA_EXPORT_RETENTION_SWEEP_ENABLED=0)");
    return;
  }

  console.log(
    `[admin-export-retention] starting interval=${INTERVAL_SEC}s startDelay=${START_DELAY_SEC}s batchLimit=${BATCH_LIMIT}`,
  );
  startupTimer = setTimeout(() => {
    void runRetentionSweep();
  }, START_DELAY_SEC * 1000);
  startupTimer.unref?.();

  intervalTimer = setInterval(() => {
    void runRetentionSweep();
  }, INTERVAL_SEC * 1000);
  intervalTimer.unref?.();
}

export function stopAdminDataExportRetentionScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  started = false;
}
