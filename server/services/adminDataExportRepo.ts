import crypto from "crypto";
import { dbClient } from "@db";
import { sha256, stableStringify } from "../legal/cryptoUtils";
import type {
  AdminDataExportCreateRequest,
  AdminDataExportJob,
} from "@shared/admin/dataExports";

function convertQuestionMarks(sqlText: string): string {
  let out = "";
  let index = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    const next = i + 1 < sqlText.length ? sqlText[i + 1] : "";

    if (inLineComment) {
      out += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === "*" && next === "/") {
        out += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "-" && next === "-") {
        out += ch + next;
        i += 1;
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        out += ch + next;
        i += 1;
        inBlockComment = true;
        continue;
      }
    }
    if (ch === "'" && !inDouble) {
      out += ch;
      if (inSingle && next === "'") {
        out += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (ch === "\"" && !inSingle) {
      out += ch;
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === "?") {
      out += `$${index++}`;
      continue;
    }
    out += ch;
  }
  return out;
}

async function queryAll<T = any>(sqlText: string, params: any[] = []): Promise<T[]> {
  const rows = await dbClient.query(convertQuestionMarks(sqlText), params);
  return rows.rows as T[];
}

async function queryOne<T = any>(sqlText: string, params: any[] = []): Promise<T | undefined> {
  const rows = await queryAll<T>(sqlText, params);
  return rows[0];
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function makeJobId(): string {
  return `ADEXP-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function parseJsonValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapJob(row: any): AdminDataExportJob {
  return {
    id: String(row.id),
    type: String(row.type) as AdminDataExportJob["type"],
    format: String(row.format) as AdminDataExportJob["format"],
    status: String(row.status) as AdminDataExportJob["status"],
    requestedByAdminId:
      row.requested_by_admin_id == null ? null : Number(row.requested_by_admin_id),
    filterHash: row.filter_hash ? String(row.filter_hash) : null,
    filtersJson: parseJsonValue(row.filters_json),
    queueName: String(row.queue_name || "admin-export-v1"),
    queueJobId: row.queue_job_id ? String(row.queue_job_id) : null,
    objectKey: row.object_key ? String(row.object_key) : null,
    rowCount: row.row_count == null ? null : Number(row.row_count),
    bytesWritten: row.bytes_written == null ? null : Number(row.bytes_written),
    truncated: Boolean(row.truncated),
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 0),
    error: row.error ? String(row.error) : null,
    createdAt: Number(row.created_at || 0),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    updatedAt: Number(row.updated_at || 0),
  };
}

export async function appendAdminDataExportEvent(params: {
  jobId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const contextJson = JSON.stringify(params.context || {});
  await queryAll(
    `
      INSERT INTO admin_data_export_job_events (job_id, ts, level, message, context_json)
      VALUES (?, ?, ?, ?, ?)
    `,
    [params.jobId, nowSec(), params.level, params.message, contextJson],
  );
}

export async function createAdminDataExportJob(params: {
  request: AdminDataExportCreateRequest;
  requestedByAdminId: number;
  maxAttempts: number;
  dedupeWindowSec?: number;
}): Promise<{ job: AdminDataExportJob; deduped: boolean }> {
  const filtersJson = stableStringify(params.request.filters ?? {});
  const filterHash = sha256(`${params.request.type}:${params.request.format}:${filtersJson}`);
  const windowSec = Math.max(60, Math.trunc(params.dedupeWindowSec ?? 3600));
  const minCreated = nowSec() - windowSec;

  const dedupe = await queryOne<any>(
    `
      SELECT *
      FROM admin_data_export_jobs
      WHERE requested_by_admin_id = ?
        AND type = ?
        AND format = ?
        AND filter_hash = ?
        AND created_at >= ?
        AND status IN ('QUEUED', 'RUNNING', 'READY')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [params.requestedByAdminId, params.request.type, params.request.format, filterHash, minCreated],
  );

  if (dedupe) {
    return {
      job: mapJob(dedupe),
      deduped: true,
    };
  }

  const id = makeJobId();
  const createdAt = nowSec();
  await queryAll(
    `
      INSERT INTO admin_data_export_jobs (
        id, type, format, status, requested_by_admin_id, filter_hash, filters_json,
        queue_name, queue_job_id, object_key, row_count, bytes_written, truncated,
        attempt_count, max_attempts, error, created_at, started_at, completed_at,
        expires_at, updated_at
      ) VALUES (
        ?, ?, ?, 'QUEUED', ?, ?, ?, 'admin-export-v1', NULL, NULL, NULL, NULL, FALSE,
        0, ?, NULL, ?, NULL, NULL, NULL, ?
      )
    `,
    [
      id,
      params.request.type,
      params.request.format,
      params.requestedByAdminId,
      filterHash,
      filtersJson,
      params.maxAttempts,
      createdAt,
      createdAt,
    ],
  );
  await appendAdminDataExportEvent({
    jobId: id,
    level: "INFO",
    message: "Export job created",
    context: { type: params.request.type, format: params.request.format },
  });
  const created = await getAdminDataExportJob(id);
  if (!created) throw new Error("Failed to create export job");
  return { job: created, deduped: false };
}

export async function getAdminDataExportJob(jobId: string): Promise<AdminDataExportJob | null> {
  const row = await queryOne(
    `
      SELECT *
      FROM admin_data_export_jobs
      WHERE id = ?
      LIMIT 1
    `,
    [jobId],
  );
  if (!row) return null;
  return mapJob(row);
}

export async function getAdminDataExportJobByObjectKey(
  objectKey: string,
): Promise<AdminDataExportJob | null> {
  const row = await queryOne(
    `
      SELECT *
      FROM admin_data_export_jobs
      WHERE object_key = ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [objectKey],
  );
  if (!row) return null;
  return mapJob(row);
}

export async function listAdminDataExportJobs(params: {
  limit: number;
  requestedByAdminId?: number | null;
}): Promise<AdminDataExportJob[]> {
  const limit = Math.max(1, Math.min(500, Math.trunc(params.limit || 50)));
  if (params.requestedByAdminId && Number.isFinite(params.requestedByAdminId)) {
    const rows = await queryAll(
      `
        SELECT *
        FROM admin_data_export_jobs
        WHERE requested_by_admin_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [params.requestedByAdminId, limit],
    );
    return rows.map(mapJob);
  }
  const rows = await queryAll(
    `
      SELECT *
      FROM admin_data_export_jobs
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [limit],
  );
  return rows.map(mapJob);
}

export async function setAdminDataExportJobQueued(params: {
  jobId: string;
  queueName: string;
  queueJobId: string;
}): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET queue_name = ?, queue_job_id = ?, updated_at = ?
      WHERE id = ?
    `,
    [params.queueName, params.queueJobId, nowSec(), params.jobId],
  );
}

export async function markAdminDataExportJobRunning(jobId: string): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'RUNNING',
          started_at = COALESCE(started_at, ?),
          updated_at = ?
      WHERE id = ?
    `,
    [nowSec(), nowSec(), jobId],
  );
}

export async function markAdminDataExportJobReady(params: {
  jobId: string;
  objectKey: string;
  rowCount: number;
  bytesWritten: number;
  truncated: boolean;
  expiresAt: number | null;
}): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'READY',
          object_key = ?,
          row_count = ?,
          bytes_written = ?,
          truncated = ?,
          completed_at = ?,
          expires_at = ?,
          error = NULL,
          updated_at = ?
      WHERE id = ?
    `,
    [
      params.objectKey,
      params.rowCount,
      params.bytesWritten,
      params.truncated,
      nowSec(),
      params.expiresAt,
      nowSec(),
      params.jobId,
    ],
  );
}

export async function markAdminDataExportJobFailed(params: {
  jobId: string;
  error: string;
  attemptCountDelta?: number;
}): Promise<void> {
  const delta = Math.max(0, Math.trunc(params.attemptCountDelta ?? 0));
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'FAILED',
          error = ?,
          attempt_count = attempt_count + ?,
          completed_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
    [params.error.slice(0, 4000), delta, nowSec(), nowSec(), params.jobId],
  );
}

export async function incrementAdminDataExportAttempt(jobId: string): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET attempt_count = attempt_count + 1,
          updated_at = ?
      WHERE id = ?
    `,
    [nowSec(), jobId],
  );
}

export async function markAdminDataExportJobCanceled(jobId: string): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'CANCELED',
          completed_at = ?,
          updated_at = ?
      WHERE id = ?
        AND status IN ('QUEUED', 'RUNNING')
    `,
    [nowSec(), nowSec(), jobId],
  );
}

export async function retryAdminDataExportJob(jobId: string): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'QUEUED',
          error = NULL,
          started_at = NULL,
          completed_at = NULL,
          expires_at = NULL,
          object_key = NULL,
          row_count = NULL,
          bytes_written = NULL,
          truncated = FALSE,
          updated_at = ?
      WHERE id = ?
    `,
    [nowSec(), jobId],
  );
}

export async function markAdminDataExportJobExpired(jobId: string): Promise<void> {
  await queryAll(
    `
      UPDATE admin_data_export_jobs
      SET status = 'EXPIRED',
          updated_at = ?
      WHERE id = ?
        AND status = 'READY'
    `,
    [nowSec(), jobId],
  );
}

export async function listExpiredAdminDataExportJobs(params: {
  nowSec?: number;
  limit: number;
}): Promise<AdminDataExportJob[]> {
  const rows = await queryAll(
    `
      SELECT *
      FROM admin_data_export_jobs
      WHERE status = 'READY'
        AND expires_at IS NOT NULL
        AND expires_at <= ?
      ORDER BY expires_at ASC, created_at ASC
      LIMIT ?
    `,
    [
      Math.max(0, Math.trunc(params.nowSec ?? nowSec())),
      Math.max(1, Math.min(1000, Math.trunc(params.limit || 100))),
    ],
  );
  return rows.map(mapJob);
}

export async function listAdminDataExportJobEvents(params: {
  jobId: string;
  limit: number;
}): Promise<
  Array<{ id: number; jobId: string; ts: number; level: string; message: string; context: Record<string, unknown> }>
> {
  const limit = Math.max(1, Math.min(1000, Math.trunc(params.limit || 200)));
  const rows = await queryAll<any>(
    `
      SELECT id, job_id, ts, level, message, context_json
      FROM admin_data_export_job_events
      WHERE job_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [params.jobId, limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    jobId: String(row.job_id),
    ts: Number(row.ts),
    level: String(row.level || "INFO"),
    message: String(row.message || ""),
    context: parseJsonValue(row.context_json),
  }));
}
