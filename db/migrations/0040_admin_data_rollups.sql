CREATE TABLE IF NOT EXISTS "admin_data_rollups" (
  "metric_key" text NOT NULL,
  "window_days" integer NOT NULL DEFAULT 0,
  "computed_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "data_json" text NOT NULL DEFAULT '{}',
  "source" text NOT NULL DEFAULT 'sql',
  "refreshed_by_role" text,
  CONSTRAINT "admin_data_rollups_pk" PRIMARY KEY ("metric_key", "window_days")
);

CREATE INDEX IF NOT EXISTS "idx_admin_data_rollups_computed"
  ON "admin_data_rollups" ("metric_key", "window_days", "computed_at");
