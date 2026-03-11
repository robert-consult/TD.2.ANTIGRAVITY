CREATE TABLE IF NOT EXISTS "push_devices" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "app_variant" text NOT NULL DEFAULT 'native',
  "platform" text NOT NULL DEFAULT 'android',
  "environment" text NOT NULL DEFAULT 'production',
  "push_provider" text NOT NULL DEFAULT 'FCM',
  "token" text NOT NULL,
  "token_hash" text NOT NULL,
  "device_id" text,
  "device_install_id" text,
  "device_fingerprint" text,
  "app_version" text,
  "build_number" text,
  "locale" text,
  "timezone" text,
  "metadata_json" text,
  "last_seen_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "created_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "updated_at" integer NOT NULL DEFAULT (extract(epoch from now())),
  "revoked_at" integer
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_devices_token_hash_uq" ON "push_devices" ("token_hash");
CREATE INDEX IF NOT EXISTS "push_devices_user_updated_idx" ON "push_devices" ("user_id", "updated_at");
CREATE INDEX IF NOT EXISTS "push_devices_user_platform_idx" ON "push_devices" ("user_id", "platform");
CREATE INDEX IF NOT EXISTS "push_devices_device_install_idx" ON "push_devices" ("device_install_id");
