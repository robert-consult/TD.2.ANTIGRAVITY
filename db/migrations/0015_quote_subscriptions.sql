CREATE TABLE IF NOT EXISTS "quote_subscription_config" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "global_enabled" boolean DEFAULT false NOT NULL,
  "default_mode" text DEFAULT 'BASIC_PLUS_CUSTOM' NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_by" text,
  CONSTRAINT "quote_subscription_config_default_mode_check"
    CHECK ("default_mode" IN ('BASIC_ONLY', 'BASIC_PLUS_CUSTOM', 'CUSTOM_ONLY'))
);
--> statement-breakpoint
INSERT INTO "quote_subscription_config" ("id", "global_enabled", "default_mode")
VALUES (1, false, 'BASIC_PLUS_CUSTOM')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trader_quote_prefs" (
  "user_id" integer PRIMARY KEY NOT NULL,
  "quote_mode" text DEFAULT 'BASIC_ONLY' NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  CONSTRAINT "trader_quote_prefs_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "trader_quote_prefs_quote_mode_check"
    CHECK ("quote_mode" IN ('BASIC_ONLY', 'BASIC_PLUS_CUSTOM', 'CUSTOM_ONLY'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trader_quote_subscriptions" (
  "user_id" integer NOT NULL,
  "symbol_id" integer NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  CONSTRAINT "trader_quote_subscriptions_user_id_symbol_id_pk" PRIMARY KEY("user_id", "symbol_id"),
  CONSTRAINT "trader_quote_subscriptions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "trader_quote_subscriptions_symbol_id_symbol_configs_id_fk"
    FOREIGN KEY ("symbol_id") REFERENCES "public"."symbol_configs"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trader_quote_subscriptions_symbol_id_idx"
  ON "trader_quote_subscriptions" ("symbol_id");
