CREATE TABLE IF NOT EXISTS "runtime_reload_status" (
  "domain" text PRIMARY KEY NOT NULL,
  "requested_version" integer NOT NULL DEFAULT 0,
  "requested_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "requested_by" text,
  "required_scope" text NOT NULL DEFAULT 'reload',
  "changed_keys_json" text NOT NULL DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'idle',
  "acknowledgements_json" text NOT NULL DEFAULT '[]',
  "effective_state_json" text NOT NULL DEFAULT '{}',
  "last_applied_version" integer,
  "last_applied_at" integer,
  "last_error" text,
  "updated_at" integer NOT NULL DEFAULT (extract(epoch from now()))
);
