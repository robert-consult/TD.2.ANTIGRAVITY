-- 0030_remember_me_tokens_and_session_controls.sql
-- Persistent login tokens and admin session-device controls.

BEGIN;

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS remember_me_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remember_me_max_age_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS remember_me_max_devices_per_user integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS remember_me_reauth_after_absence_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS remember_me_token_rotation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remember_me_theft_auto_revoke_all boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS session_cookie_max_age_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logout_clear_all_device_tokens boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS remember_me_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selector text NOT NULL UNIQUE,
  validator_hash text NOT NULL,
  expires_at integer NOT NULL,
  last_used_at integer NOT NULL DEFAULT floor(extract(epoch from now())),
  created_at integer NOT NULL DEFAULT floor(extract(epoch from now())),
  user_agent text,
  ip text,
  device_type text,
  browser text,
  os text,
  device_fp text,
  device_install_id text,
  country_code text,
  city text
);

CREATE INDEX IF NOT EXISTS remember_me_tokens_user_last_used_idx
  ON remember_me_tokens(user_id, last_used_at);
CREATE INDEX IF NOT EXISTS remember_me_tokens_expires_at_idx
  ON remember_me_tokens(expires_at);

COMMIT;
