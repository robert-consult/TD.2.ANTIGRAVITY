ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "min_price_distance_pips" integer DEFAULT 20 NOT NULL;

