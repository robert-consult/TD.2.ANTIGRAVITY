CREATE INDEX IF NOT EXISTS "trades_user_opened_at_idx" ON "trades" ("user_id", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_user_status_opened_at_idx" ON "trades" ("user_id", "status", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_symbol_status_opened_at_idx" ON "trades" ("symbol_id", "status", "opened_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_user_closed_at_history_idx" ON "trades" ("user_id", "closed_at") WHERE "status" IN ('CLOSED', 'CANCELED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_open_opened_at_idx" ON "trades" ("opened_at") WHERE "status" = 'OPEN';
