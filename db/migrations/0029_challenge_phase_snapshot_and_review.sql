-- 0029_challenge_phase_snapshot_and_review.sql
-- Add canonical phase snapshot reconciliation ledger and manual-review controls.

BEGIN;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS challenge_manual_review_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS challenge_manual_review_suspicious_threshold integer NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS challenge_phase_snapshots (
  id serial PRIMARY KEY,
  enrollment_id integer NOT NULL REFERENCES challenge_enrollments(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phase_number integer NOT NULL,
  run_id text,
  pnl_basis text NOT NULL DEFAULT 'REALIZED_ONLY',
  rounding_mode text NOT NULL DEFAULT 'HALF_AWAY_FROM_ZERO_8DP',
  input_hash text NOT NULL,
  trade_count integer NOT NULL DEFAULT 0,
  total_pnl real NOT NULL DEFAULT 0,
  pnl_pct real NOT NULL DEFAULT 0,
  trading_days integer NOT NULL DEFAULT 0,
  worst_day_loss_pct real NOT NULL DEFAULT 0,
  best_day_profit_pct real NOT NULL DEFAULT 0,
  start_dd_pct real NOT NULL DEFAULT 0,
  trailing_dd_pct real NOT NULL DEFAULT 0,
  peak_equity real NOT NULL DEFAULT 0,
  computed_at integer NOT NULL DEFAULT floor(extract(epoch from now())),
  created_at integer NOT NULL DEFAULT floor(extract(epoch from now()))
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_phase_snapshots_uidx
  ON challenge_phase_snapshots(enrollment_id, phase_number, input_hash);
CREATE INDEX IF NOT EXISTS challenge_phase_snapshots_challenge_computed_idx
  ON challenge_phase_snapshots(challenge_id, computed_at);
CREATE INDEX IF NOT EXISTS challenge_phase_snapshots_run_idx
  ON challenge_phase_snapshots(run_id, computed_at);

COMMIT;

