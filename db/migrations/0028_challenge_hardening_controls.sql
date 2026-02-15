-- 0028_challenge_hardening_controls.sql
-- Additive challenge hardening controls: settings surface, evaluation run ledger,
-- reward idempotency ledger, and certificate verification key metadata.

BEGIN;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS challenge_breach_policy_default text NOT NULL DEFAULT 'FAIL',
  ADD COLUMN IF NOT EXISTS challenge_single_day_profit_basis text NOT NULL DEFAULT 'PNL_PCT',
  ADD COLUMN IF NOT EXISTS challenge_leaderboard_snapshot_interval_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS challenge_leaderboard_ranking_metric text NOT NULL DEFAULT 'COMPOSITE_SCORE',
  ADD COLUMN IF NOT EXISTS challenge_prize_award_timing_default text NOT NULL DEFAULT 'ON_COMPLETE',
  ADD COLUMN IF NOT EXISTS challenge_prize_candidates_default text NOT NULL DEFAULT 'PASSED_ONLY',
  ADD COLUMN IF NOT EXISTS challenge_news_blackout_windows_json text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS challenge_weekend_cutoff_hours integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS challenge_force_close_before_weekend boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS challenge_leverage_multiplier_default real NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS challenge_max_active_enrollments_user integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS challenge_max_active_enrollments_per_challenge integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS challenge_cooldown_hours_after_fail integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS challenge_cooldown_hours_after_withdraw integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS challenge_certificate_default_template_id integer,
  ADD COLUMN IF NOT EXISTS challenge_certificate_include_metrics_default boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_certificate_include_qr_default boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_certificate_verification_key_id text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS challenge_evaluation_interval_sec integer NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS challenge_audit_strict_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_anomaly_detection_enabled boolean NOT NULL DEFAULT true;

UPDATE system_config
SET challenge_evaluation_interval_sec = GREATEST(60, COALESCE(challenge_eval_interval_min, 60) * 60)
WHERE challenge_evaluation_interval_sec IS NULL OR challenge_evaluation_interval_sec <= 0;

ALTER TABLE challenge_certificates
  ADD COLUMN IF NOT EXISTS verification_code_nonce text,
  ADD COLUMN IF NOT EXISTS verification_hmac_key_id text NOT NULL DEFAULT 'legacy';

UPDATE challenge_certificates
SET verification_hmac_key_id = 'legacy'
WHERE verification_hmac_key_id IS NULL OR btrim(verification_hmac_key_id) = '';

CREATE TABLE IF NOT EXISTS challenge_reward_ledger (
  id serial PRIMARY KEY,
  enrollment_id integer NOT NULL REFERENCES challenge_enrollments(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  reward_key text NOT NULL,
  action_type text NOT NULL,
  run_id text,
  details_json text NOT NULL DEFAULT '{}',
  created_at integer NOT NULL DEFAULT floor(extract(epoch from now()))
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_reward_ledger_uidx
  ON challenge_reward_ledger(enrollment_id, trigger, reward_key);
CREATE INDEX IF NOT EXISTS challenge_reward_ledger_challenge_idx
  ON challenge_reward_ledger(challenge_id, created_at);
CREATE INDEX IF NOT EXISTS challenge_reward_ledger_user_idx
  ON challenge_reward_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS challenge_reward_ledger_run_idx
  ON challenge_reward_ledger(run_id, created_at);

CREATE TABLE IF NOT EXISTS challenge_evaluation_runs (
  id serial PRIMARY KEY,
  run_id text NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING',
  started_at integer NOT NULL DEFAULT floor(extract(epoch from now())),
  ended_at integer,
  processed_count integer NOT NULL DEFAULT 0,
  advanced_count integer NOT NULL DEFAULT 0,
  passed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  warned_count integer NOT NULL DEFAULT 0,
  error_json text,
  created_at integer NOT NULL DEFAULT floor(extract(epoch from now()))
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_evaluation_runs_run_uidx
  ON challenge_evaluation_runs(run_id);
CREATE INDEX IF NOT EXISTS challenge_evaluation_runs_status_started_idx
  ON challenge_evaluation_runs(status, started_at);

COMMIT;
