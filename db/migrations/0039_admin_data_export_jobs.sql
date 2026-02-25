CREATE TABLE IF NOT EXISTS "admin_data_export_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "requested_by_admin_id" integer,
  "filter_hash" text,
  "filters_json" text NOT NULL DEFAULT '{}',
  "queue_name" text NOT NULL DEFAULT 'admin-export-v1',
  "queue_job_id" text,
  "object_key" text,
  "row_count" integer,
  "bytes_written" bigint,
  "truncated" boolean NOT NULL DEFAULT false,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 6,
  "error" text,
  "created_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "started_at" integer,
  "completed_at" integer,
  "expires_at" integer,
  "updated_at" integer NOT NULL DEFAULT (extract(epoch from now()))
);

CREATE TABLE IF NOT EXISTS "admin_data_export_job_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL,
  "ts" integer NOT NULL DEFAULT (extract(epoch from now())),
  "level" text NOT NULL DEFAULT 'INFO',
  "message" text NOT NULL,
  "context_json" text NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "idx_ade_jobs_status_created"
  ON "admin_data_export_jobs" ("status", "created_at");

CREATE INDEX IF NOT EXISTS "idx_ade_jobs_type_created"
  ON "admin_data_export_jobs" ("type", "created_at");

CREATE INDEX IF NOT EXISTS "idx_ade_jobs_req_created"
  ON "admin_data_export_jobs" ("requested_by_admin_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_ade_jobs_filter_hash"
  ON "admin_data_export_jobs" ("filter_hash", "status", "created_at");

CREATE INDEX IF NOT EXISTS "idx_ade_jobs_queue"
  ON "admin_data_export_jobs" ("queue_name", "queue_job_id");

CREATE INDEX IF NOT EXISTS "idx_ade_events_job_ts"
  ON "admin_data_export_job_events" ("job_id", "ts");
