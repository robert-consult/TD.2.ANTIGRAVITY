CREATE TABLE "daily_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"user_id" integer NOT NULL,
	"balance" real NOT NULL,
	"profit_day" real,
	"trades_closed" integer,
	"trades_won" integer
);
--> statement-breakpoint
CREATE TABLE "i18n_manifest_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"generated_at" integer,
	"ingested_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "i18n_manifest_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "i18n_source_strings" (
	"string_id" text PRIMARY KEY NOT NULL,
	"default_text" text NOT NULL,
	"checksum" text NOT NULL,
	"file" text,
	"kind" text,
	"prop_name" text,
	"line" integer,
	"column" integer,
	"first_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_modified_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "i18n_translation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"string_id" text NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" integer,
	"locked_by" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "i18n_translations" (
	"string_id" text NOT NULL,
	"locale" text NOT NULL,
	"translated_text" text NOT NULL,
	"source_checksum" text NOT NULL,
	"provider" text,
	"model" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	CONSTRAINT "i18n_translations_string_id_locale_pk" PRIMARY KEY("string_id","locale")
);
--> statement-breakpoint
CREATE TABLE "market_daily_close" (
	"symbol" text NOT NULL,
	"session_day" text NOT NULL,
	"close" real NOT NULL,
	"close_ts_ms" bigint NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	CONSTRAINT "market_daily_close_symbol_session_day_pk" PRIMARY KEY("symbol","session_day")
);
--> statement-breakpoint
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "i18n_translation_jobs" ADD CONSTRAINT "i18n_translation_jobs_string_id_i18n_source_strings_string_id_fk" FOREIGN KEY ("string_id") REFERENCES "public"."i18n_source_strings"("string_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "i18n_translations" ADD CONSTRAINT "i18n_translations_string_id_i18n_source_strings_string_id_fk" FOREIGN KEY ("string_id") REFERENCES "public"."i18n_source_strings"("string_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_daily_closes_user_date" ON "daily_closes" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_i18n_jobs_string_locale" ON "i18n_translation_jobs" USING btree ("string_id","locale");--> statement-breakpoint
CREATE INDEX "idx_i18n_jobs_status" ON "i18n_translation_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_i18n_tr_locale" ON "i18n_translations" USING btree ("locale","updated_at");--> statement-breakpoint
CREATE INDEX "idx_mdc_symbol_day" ON "market_daily_close" USING btree ("symbol","session_day");