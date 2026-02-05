CREATE TABLE IF NOT EXISTS "market_data_providers" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_key" text NOT NULL,
  "display_name" text NOT NULL,
  "driver" text NOT NULL,
  "config_json" text DEFAULT '{}' NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "deleted_at" integer,
  CONSTRAINT "market_data_providers_provider_key_unique" UNIQUE("provider_key")
);
--> statement-breakpoint
ALTER TABLE "system_config"
  ADD COLUMN IF NOT EXISTS "market_data_active_provider_key" text;
--> statement-breakpoint
ALTER TABLE "system_config"
  ADD COLUMN IF NOT EXISTS "market_data_fallback_provider_keys_csv" text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "system_config"
SET
  "market_data_active_provider_key" = COALESCE("market_data_active_provider_key", 'twelvedata'),
  "market_data_fallback_provider_keys_csv" = COALESCE(NULLIF("market_data_fallback_provider_keys_csv", ''), '1forge')
WHERE "id" = 1;
--> statement-breakpoint
INSERT INTO "market_data_providers" ("provider_key", "display_name", "driver", "config_json", "is_enabled")
VALUES
  (
    'twelvedata',
    'Twelve Data',
    'twelvedata',
    '{"driver":"twelvedata","apiKey":"env:TWELVE_DATA_API_KEY","restBaseUrl":"https://api.twelvedata.com","quoteEndpoint":"/quote","timeoutMs":8000,"maxBatchSymbols":8}',
    true
  ),
  (
    '1forge',
    '1Forge',
    'oneforge',
    '{"driver":"oneforge","apiKey":"env:FORGE_KEY","restBaseUrl":"https://api.1forge.com","quoteEndpoint":"/quotes","timeoutMs":8000,"maxBatchSymbols":100}',
    true
  )
ON CONFLICT ("provider_key") DO NOTHING;
