CREATE TABLE IF NOT EXISTS "instrument_reference" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_key" text NOT NULL,
  "category" text NOT NULL,
  "canonical_symbol" text NOT NULL,
  "provider_symbol" text NOT NULL,
  "name" text,
  "currency" text,
  "exchange" text,
  "country" text,
  "type" text,
  "currency_base" text,
  "currency_quote" text,
  "region" text,
  "meta_json" text DEFAULT '{}' NOT NULL,
  "last_refreshed_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  CONSTRAINT "instrument_reference_unique" UNIQUE("provider_key", "canonical_symbol", "provider_symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pip_category_defaults" (
  "category" text PRIMARY KEY NOT NULL,
  "pip_decimals" integer NOT NULL,
  "quote_decimals" integer,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_by_admin_id" integer
);
--> statement-breakpoint
ALTER TABLE "symbol_configs"
  ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "symbol_configs"
  ADD COLUMN IF NOT EXISTS "pip_decimals" integer;
--> statement-breakpoint
ALTER TABLE "symbol_configs"
  ADD COLUMN IF NOT EXISTS "quote_decimals" integer;
--> statement-breakpoint
ALTER TABLE "symbol_configs"
  ADD COLUMN IF NOT EXISTS "provider_symbol_map_json" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
INSERT INTO "pip_category_defaults" ("category", "pip_decimals", "quote_decimals")
VALUES
  ('forex', 4, 5),
  ('stocks', 2, 2),
  ('etf', 2, 2),
  ('commodities', 2, 2),
  ('crypto', 2, 2),
  ('bonds', 2, 2),
  ('funds', 2, 2),
  ('mutual_funds', 2, 2),
  ('indices', 0, 0)
ON CONFLICT ("category") DO NOTHING;
