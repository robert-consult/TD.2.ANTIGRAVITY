CREATE TABLE IF NOT EXISTS "auth_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"event_type" text NOT NULL,
	"session_id" text,
	"device_id" text,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text,
	"ip" text,
	"user_agent" text,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"latitude" real,
	"longitude" real,
	"asn" integer,
	"org" text,
	"success" integer DEFAULT 1 NOT NULL,
	"failure_reason" text,
	"metadata_json" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_events_user" ON "auth_events" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_events_type" ON "auth_events" ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_events_device" ON "auth_events" ("device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_events_ip" ON "auth_events" ("ip");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_events_created" ON "auth_events" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_export_manifest" (
	"export_id" text PRIMARY KEY NOT NULL,
	"exported_at_utc_ms" bigint NOT NULL,
	"export_type" text NOT NULL,
	"export_format" text NOT NULL,
	"filters_json" text NOT NULL,
	"record_count" integer NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aem_type_time" ON "audit_export_manifest" ("export_type","exported_at_utc_ms");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grift_ip_asn_cache" (
	"ip" text PRIMARY KEY NOT NULL,
	"asn" integer,
	"org" text,
	"source" text,
	"fetched_at" bigint,
	"last_seen_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" bigint,
	"error" text,
	"error_at" bigint,
	"next_retry_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_cache_last_seen" ON "grift_ip_asn_cache" ("last_seen_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_cache_next_retry" ON "grift_ip_asn_cache" ("next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_cache_asn" ON "grift_ip_asn_cache" ("asn");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grift_ip_asn_ranges" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip_version" integer NOT NULL,
	"start_int" bigint,
	"end_int" bigint,
	"start_hex" text,
	"end_hex" text,
	"asn" integer,
	"country" text,
	"org" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_ranges_v4_start" ON "grift_ip_asn_ranges" ("ip_version", "start_int");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_ranges_v6_start" ON "grift_ip_asn_ranges" ("ip_version", "start_hex");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_ip_asn_ranges_asn" ON "grift_ip_asn_ranges" ("asn");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grift_ip_asn_dataset_meta" (
	"id" integer PRIMARY KEY CHECK (id = 1) NOT NULL,
	"file_path" text NOT NULL,
	"file_mtime_ms" bigint NOT NULL,
	"file_size" bigint NOT NULL,
	"imported_at" bigint NOT NULL,
	"row_count" bigint NOT NULL,
	"ipv4_count" bigint NOT NULL,
	"ipv6_count" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes"
	ALTER COLUMN "last_api_update" TYPE bigint
	USING CASE
		WHEN "last_api_update" IS NULL THEN NULL
		WHEN "last_api_update" < 1000000000000 THEN ("last_api_update"::bigint * 1000)
		ELSE "last_api_update"
	END;
--> statement-breakpoint
ALTER TABLE "grift_identity_links"
	ALTER COLUMN "first_seen_at" TYPE bigint
	USING CASE
		WHEN "first_seen_at" IS NULL THEN NULL
		WHEN "first_seen_at" < 1000000000000 THEN ("first_seen_at"::bigint * 1000)
		ELSE "first_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_identity_links"
	ALTER COLUMN "first_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_identity_links"
	ALTER COLUMN "last_seen_at" TYPE bigint
	USING CASE
		WHEN "last_seen_at" IS NULL THEN NULL
		WHEN "last_seen_at" < 1000000000000 THEN ("last_seen_at"::bigint * 1000)
		ELSE "last_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_identity_links"
	ALTER COLUMN "last_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_identity_user" ON "grift_identity_links" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_grift_identity_type_value" ON "grift_identity_links" ("link_type","link_value");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_grift_identity_unique" ON "grift_identity_links" ("user_id","link_type","link_value");
--> statement-breakpoint
ALTER TABLE "grift_alerts"
	ALTER COLUMN "created_at" TYPE bigint
	USING CASE
		WHEN "created_at" IS NULL THEN NULL
		WHEN "created_at" < 1000000000000 THEN ("created_at"::bigint * 1000)
		ELSE "created_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_alerts"
	ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_alerts"
	ALTER COLUMN "reviewed_at" TYPE bigint
	USING CASE
		WHEN "reviewed_at" IS NULL THEN NULL
		WHEN "reviewed_at" < 1000000000000 THEN ("reviewed_at"::bigint * 1000)
		ELSE "reviewed_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_risk"
	ALTER COLUMN "last_evaluated_at" TYPE bigint
	USING CASE
		WHEN "last_evaluated_at" IS NULL THEN NULL
		WHEN "last_evaluated_at" < 1000000000000 THEN ("last_evaluated_at"::bigint * 1000)
		ELSE "last_evaluated_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_risk"
	ALTER COLUMN "last_evaluated_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_user_risk"
	ALTER COLUMN "override_at" TYPE bigint
	USING CASE
		WHEN "override_at" IS NULL THEN NULL
		WHEN "override_at" < 1000000000000 THEN ("override_at"::bigint * 1000)
		ELSE "override_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_risk"
	ALTER COLUMN "enforcement_at" TYPE bigint
	USING CASE
		WHEN "enforcement_at" IS NULL THEN NULL
		WHEN "enforcement_at" < 1000000000000 THEN ("enforcement_at"::bigint * 1000)
		ELSE "enforcement_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_linked_account_edges"
	ALTER COLUMN "first_linked_at" TYPE bigint
	USING CASE
		WHEN "first_linked_at" IS NULL THEN NULL
		WHEN "first_linked_at" < 1000000000000 THEN ("first_linked_at"::bigint * 1000)
		ELSE "first_linked_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_linked_account_edges"
	ALTER COLUMN "first_linked_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_linked_account_edges"
	ALTER COLUMN "last_confirmed_at" TYPE bigint
	USING CASE
		WHEN "last_confirmed_at" IS NULL THEN NULL
		WHEN "last_confirmed_at" < 1000000000000 THEN ("last_confirmed_at"::bigint * 1000)
		ELSE "last_confirmed_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_linked_account_edges"
	ALTER COLUMN "last_confirmed_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_config"
	ALTER COLUMN "updated_at" TYPE bigint
	USING CASE
		WHEN "updated_at" IS NULL THEN NULL
		WHEN "updated_at" < 1000000000000 THEN ("updated_at"::bigint * 1000)
		ELSE "updated_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_config"
	ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_devices"
	ALTER COLUMN "first_seen_at" TYPE bigint
	USING CASE
		WHEN "first_seen_at" IS NULL THEN NULL
		WHEN "first_seen_at" < 1000000000000 THEN ("first_seen_at"::bigint * 1000)
		ELSE "first_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_devices"
	ALTER COLUMN "first_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_devices"
	ALTER COLUMN "last_seen_at" TYPE bigint
	USING CASE
		WHEN "last_seen_at" IS NULL THEN NULL
		WHEN "last_seen_at" < 1000000000000 THEN ("last_seen_at"::bigint * 1000)
		ELSE "last_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_devices"
	ALTER COLUMN "last_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_device_users"
	ALTER COLUMN "first_seen_at" TYPE bigint
	USING CASE
		WHEN "first_seen_at" IS NULL THEN NULL
		WHEN "first_seen_at" < 1000000000000 THEN ("first_seen_at"::bigint * 1000)
		ELSE "first_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_device_users"
	ALTER COLUMN "first_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_device_users"
	ALTER COLUMN "last_seen_at" TYPE bigint
	USING CASE
		WHEN "last_seen_at" IS NULL THEN NULL
		WHEN "last_seen_at" < 1000000000000 THEN ("last_seen_at"::bigint * 1000)
		ELSE "last_seen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_device_users"
	ALTER COLUMN "last_seen_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_signals"
	ALTER COLUMN "created_at" TYPE bigint
	USING CASE
		WHEN "created_at" IS NULL THEN NULL
		WHEN "created_at" < 1000000000000 THEN ("created_at"::bigint * 1000)
		ELSE "created_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_signals"
	ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_signals"
	ALTER COLUMN "updated_at" TYPE bigint
	USING CASE
		WHEN "updated_at" IS NULL THEN NULL
		WHEN "updated_at" < 1000000000000 THEN ("updated_at"::bigint * 1000)
		ELSE "updated_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_signals"
	ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000);
--> statement-breakpoint
ALTER TABLE "grift_signals"
	ALTER COLUMN "closed_at" TYPE bigint
	USING CASE
		WHEN "closed_at" IS NULL THEN NULL
		WHEN "closed_at" < 1000000000000 THEN ("closed_at"::bigint * 1000)
		ELSE "closed_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_scores"
	ALTER COLUMN "last_evaluated_at" TYPE bigint
	USING CASE
		WHEN "last_evaluated_at" IS NULL THEN NULL
		WHEN "last_evaluated_at" < 1000000000000 THEN ("last_evaluated_at"::bigint * 1000)
		ELSE "last_evaluated_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_enforcements"
	ALTER COLUMN "frozen_at" TYPE bigint
	USING CASE
		WHEN "frozen_at" IS NULL THEN NULL
		WHEN "frozen_at" < 1000000000000 THEN ("frozen_at"::bigint * 1000)
		ELSE "frozen_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_user_enforcements"
	ALTER COLUMN "disabled_at" TYPE bigint
	USING CASE
		WHEN "disabled_at" IS NULL THEN NULL
		WHEN "disabled_at" < 1000000000000 THEN ("disabled_at"::bigint * 1000)
		ELSE "disabled_at"
	END;
--> statement-breakpoint
ALTER TABLE "grift_cases"
	ALTER COLUMN "closed_at" TYPE bigint
	USING CASE
		WHEN "closed_at" IS NULL THEN NULL
		WHEN "closed_at" < 1000000000000 THEN ("closed_at"::bigint * 1000)
		ELSE "closed_at"
	END;
