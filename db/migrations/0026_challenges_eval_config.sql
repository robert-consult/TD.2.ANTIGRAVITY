-- 0026_challenges_eval_config.sql
-- Keep this migration as idempotent parity for environments that may have applied partial challenge patches.

BEGIN;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS challenge_eval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_eval_interval_min integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS challenge_eval_max_rows integer NOT NULL DEFAULT 500;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRADE', 'SYSTEM', 'ACCOUNT', 'SECURITY', 'KYC', 'CHALLENGE'));

ALTER TABLE mailbox_threads DROP CONSTRAINT IF EXISTS mailbox_threads_category_check;
ALTER TABLE mailbox_threads
  ADD CONSTRAINT mailbox_threads_category_check
  CHECK (category IN ('SYSTEM', 'SUPPORT', 'ANNOUNCEMENT', 'CHALLENGES'));

COMMIT;
