ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "time_in_force" text DEFAULT 'GTC' NOT NULL;
--> statement-breakpoint
ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "expires_at" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_status_expires_at_idx"
  ON "trades" ("status", "expires_at");
