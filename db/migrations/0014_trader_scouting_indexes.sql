CREATE INDEX IF NOT EXISTS "trades_closed_closed_at_idx"
  ON "trades" ("closed_at")
  WHERE "status" = 'CLOSED';
