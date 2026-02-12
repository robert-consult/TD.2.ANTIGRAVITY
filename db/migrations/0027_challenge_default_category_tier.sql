-- 0027_challenge_default_category_tier.sql
-- Align challenge default settings with design spec defaults.

BEGIN;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS challenge_default_category text NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS challenge_default_tier text NOT NULL DEFAULT 'STARTER';

ALTER TABLE system_config
  ALTER COLUMN challenge_default_max_retries SET DEFAULT 3,
  ALTER COLUMN challenge_default_retry_cooldown_hours SET DEFAULT 24,
  ALTER COLUMN challenge_default_eligibility SET DEFAULT 'EMAIL_VERIFIED',
  ALTER COLUMN challenge_custom_rewards_enabled SET DEFAULT false;

-- Backfill rows that still have legacy bootstrap defaults.
UPDATE system_config
SET challenge_default_max_retries = 3
WHERE challenge_default_max_retries = 0;

UPDATE system_config
SET challenge_default_retry_cooldown_hours = 24
WHERE challenge_default_retry_cooldown_hours = 0;

UPDATE system_config
SET challenge_default_eligibility = 'EMAIL_VERIFIED'
WHERE challenge_default_eligibility = '{}';

COMMIT;
