-- 0025_challenges_v4_multiphase_rewards.sql
-- Challenges v4: multiphase evaluation, rewards primitives, audit events, leaderboard snapshots.

BEGIN;

-- ------------------------------------------------------------
-- Messaging parity for challenge notifications
-- ------------------------------------------------------------
ALTER TABLE communication_settings
  ADD COLUMN IF NOT EXISTS notification_challenge_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('TRADE', 'SYSTEM', 'ACCOUNT', 'SECURITY', 'KYC', 'CHALLENGE'));

ALTER TABLE mailbox_threads DROP CONSTRAINT IF EXISTS mailbox_threads_category_check;
ALTER TABLE mailbox_threads
  ADD CONSTRAINT mailbox_threads_category_check
  CHECK (category IN ('SYSTEM', 'SUPPORT', 'ANNOUNCEMENT', 'CHALLENGES'));

-- ------------------------------------------------------------
-- system_config: global challenge defaults + feature flags
-- ------------------------------------------------------------
ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS challenge_auto_advance_phase boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_default_drawdown_type text NOT NULL DEFAULT 'STATIC',
  ADD COLUMN IF NOT EXISTS challenge_default_capital_mode text NOT NULL DEFAULT 'VIRTUAL',
  ADD COLUMN IF NOT EXISTS challenge_default_max_retries integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challenge_default_retry_cooldown_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challenge_default_eligibility text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS challenge_rewards_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_prize_pools_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_badges_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_certificates_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_certificates_downloadable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_certificates_shareable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_selection_boost_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_default_selection_boost integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS challenge_progression_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_custom_rewards_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_enroll boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_phase_warning boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_breach boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_phase_pass boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_fail boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_badge_award boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_prize_award boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_cert_issue boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_tier_up boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_on_admin_action boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_notify_via_mailbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS challenge_mailbox_category text NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS challenge_warning_threshold_pct real NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS challenge_leaderboard_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_leaderboard_refresh_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS challenge_eval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS challenge_eval_interval_min integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS challenge_eval_max_rows integer NOT NULL DEFAULT 500;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_config_challenge_default_drawdown_type_check'
  ) THEN
    ALTER TABLE system_config
      ADD CONSTRAINT system_config_challenge_default_drawdown_type_check
      CHECK (challenge_default_drawdown_type IN ('STATIC', 'TRAILING'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_config_challenge_default_capital_mode_check'
  ) THEN
    ALTER TABLE system_config
      ADD CONSTRAINT system_config_challenge_default_capital_mode_check
      CHECK (challenge_default_capital_mode IN ('VIRTUAL', 'SNAPSHOT_EQUITY'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_config_challenge_mailbox_category_check'
  ) THEN
    ALTER TABLE system_config
      ADD CONSTRAINT system_config_challenge_mailbox_category_check
      CHECK (challenge_mailbox_category IN ('SYSTEM', 'SUPPORT', 'ANNOUNCEMENT', 'CHALLENGES'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- challenges table enhancement
-- ------------------------------------------------------------
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'OPEN',
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS icon_color text,
  ADD COLUMN IF NOT EXISTS virtual_capital_usd real NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS capital_mode text NOT NULL DEFAULT 'VIRTUAL',
  ADD COLUMN IF NOT EXISTS leverage_multiplier real NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_enrollments integer,
  ADD COLUMN IF NOT EXISTS max_active_enrollments integer,
  ADD COLUMN IF NOT EXISTS max_retries_per_trader integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_cooldown_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eligibility_gate text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS enrollment_start_at integer,
  ADD COLUMN IF NOT EXISTS enrollment_end_at integer,
  ADD COLUMN IF NOT EXISTS visible_to_traders boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS featured_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_pool_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prize_pool_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_distribution_json text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS prize_min_completions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_award_timing text NOT NULL DEFAULT 'ON_COMPLETE',
  ADD COLUMN IF NOT EXISTS badges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS badge_on_pass text,
  ADD COLUMN IF NOT EXISTS badge_on_top3 text,
  ADD COLUMN IF NOT EXISTS certificate_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_downloadable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS certificate_shareable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS certificate_template_id integer,
  ADD COLUMN IF NOT EXISTS certificate_include_metrics boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS selection_boost_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selection_boost_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partner_visibility_on_pass boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_watchlist_tier text,
  ADD COLUMN IF NOT EXISTS progression_tier_id integer,
  ADD COLUMN IF NOT EXISTS custom_reward_json text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS leaderboard_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS leaderboard_anonymize boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leaderboard_max_visible integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS updated_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_capital_mode_check') THEN
    ALTER TABLE challenges
      ADD CONSTRAINT challenges_capital_mode_check
      CHECK (capital_mode IN ('VIRTUAL', 'SNAPSHOT_EQUITY'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenges_prize_award_timing_check') THEN
    ALTER TABLE challenges
      ADD CONSTRAINT challenges_prize_award_timing_check
      CHECK (prize_award_timing IN ('ON_COMPLETE', 'ON_CHALLENGE_END', 'MANUAL'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS challenges_slug_uidx ON challenges(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS challenges_active_idx ON challenges(is_active, visible_to_traders, featured_order, updated_at);
CREATE INDEX IF NOT EXISTS challenges_enrollment_window_idx ON challenges(enrollment_start_at, enrollment_end_at);

-- ------------------------------------------------------------
-- challenge_enrollments enhancement
-- ------------------------------------------------------------
ALTER TABLE challenge_enrollments
  ADD COLUMN IF NOT EXISTS current_phase integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS snapshot_equity real,
  ADD COLUMN IF NOT EXISTS capital_base_used real,
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_total_loss_hit real,
  ADD COLUMN IF NOT EXISTS peak_equity real,
  ADD COLUMN IF NOT EXISTS phase_started_at integer,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS last_warning_event text,
  ADD COLUMN IF NOT EXISTS last_warning_at integer;

CREATE INDEX IF NOT EXISTS challenge_enrollments_status_idx ON challenge_enrollments(status);
CREATE INDEX IF NOT EXISTS challenge_enrollments_challenge_status_idx ON challenge_enrollments(challenge_id, status);

-- ------------------------------------------------------------
-- phases
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_phases (
  id serial PRIMARY KEY,
  challenge_id integer NOT NULL,
  phase_number integer NOT NULL,
  phase_name text,
  profit_target_pct real NOT NULL,
  max_daily_loss_pct real NOT NULL,
  max_total_loss_pct real,
  drawdown_type text NOT NULL DEFAULT 'STATIC',
  duration_days integer NOT NULL DEFAULT 1,
  min_trading_days integer,
  max_single_day_profit_pct real,
  allow_weekend_holding boolean NOT NULL DEFAULT true,
  allow_news_trading boolean NOT NULL DEFAULT true,
  restricted_symbols_csv text NOT NULL DEFAULT '',
  max_concurrent_positions integer,
  max_lot_size real,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_phases_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_phases_challenge_phase_uidx
  ON challenge_phases (challenge_id, phase_number);
CREATE INDEX IF NOT EXISTS challenge_phases_challenge_idx
  ON challenge_phases (challenge_id, phase_number);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenge_phases_drawdown_type_check') THEN
    ALTER TABLE challenge_phases
      ADD CONSTRAINT challenge_phases_drawdown_type_check
      CHECK (drawdown_type IN ('STATIC', 'TRAILING'));
  END IF;
END $$;

-- seed phase 1 from existing legacy challenge fields
INSERT INTO challenge_phases (
  challenge_id,
  phase_number,
  phase_name,
  profit_target_pct,
  max_daily_loss_pct,
  max_total_loss_pct,
  drawdown_type,
  duration_days,
  min_trading_days
)
SELECT
  c.id,
  1,
  'Phase 1',
  COALESCE(c.profit_target_pct, 0),
  COALESCE(c.max_daily_loss_pct, 0),
  c.max_total_loss_pct,
  'STATIC',
  GREATEST(1, COALESCE(c.duration_days, 1)),
  c.min_trading_days
FROM challenges c
ON CONFLICT (challenge_id, phase_number) DO NOTHING;

-- ------------------------------------------------------------
-- enrollment events (hash chained)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_enrollment_events (
  id serial PRIMARY KEY,
  enrollment_id integer NOT NULL,
  event_type text NOT NULL,
  event_at integer NOT NULL DEFAULT (extract(epoch from now())),
  actor_type text NOT NULL DEFAULT 'SYSTEM',
  actor_user_id integer,
  phase_number integer,
  details_json text NOT NULL DEFAULT '{}',
  pnl_snapshot_pct real,
  daily_loss_snapshot real,
  total_dd_snapshot real,
  trading_days_snapshot integer,
  note text,
  prev_hash text,
  event_hash text NOT NULL DEFAULT '',
  CONSTRAINT challenge_enrollment_events_enrollment_id_challenge_enrollments_id_fk
    FOREIGN KEY (enrollment_id) REFERENCES public.challenge_enrollments(id) ON DELETE cascade,
  CONSTRAINT challenge_enrollment_events_actor_user_id_users_id_fk
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE set null
);

CREATE INDEX IF NOT EXISTS challenge_enrollment_events_enrollment_at_idx
  ON challenge_enrollment_events (enrollment_id, event_at);
CREATE INDEX IF NOT EXISTS challenge_enrollment_events_type_at_idx
  ON challenge_enrollment_events (event_type, event_at);

-- ------------------------------------------------------------
-- badges, prizes, certs, progression
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_badges (
  id serial PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  icon_url text,
  icon_emoji text,
  category text NOT NULL DEFAULT 'GENERAL',
  criteria_json text NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at integer NOT NULL DEFAULT (extract(epoch from now()))
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_badges_key_uidx ON challenge_badges(key);
CREATE INDEX IF NOT EXISTS challenge_badges_active_idx ON challenge_badges(is_active, created_at);

CREATE TABLE IF NOT EXISTS challenge_badge_awards (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  badge_id integer NOT NULL,
  challenge_id integer,
  enrollment_id integer,
  awarded_at integer NOT NULL DEFAULT (extract(epoch from now())),
  awarded_reason text,
  CONSTRAINT challenge_badge_awards_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT challenge_badge_awards_badge_id_challenge_badges_id_fk
    FOREIGN KEY (badge_id) REFERENCES public.challenge_badges(id) ON DELETE cascade,
  CONSTRAINT challenge_badge_awards_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE set null,
  CONSTRAINT challenge_badge_awards_enrollment_id_challenge_enrollments_id_fk
    FOREIGN KEY (enrollment_id) REFERENCES public.challenge_enrollments(id) ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_badge_awards_user_badge_enroll_uidx
  ON challenge_badge_awards (user_id, badge_id, enrollment_id);
CREATE INDEX IF NOT EXISTS challenge_badge_awards_user_awarded_idx
  ON challenge_badge_awards (user_id, awarded_at);

CREATE TABLE IF NOT EXISTS challenge_prize_awards (
  id serial PRIMARY KEY,
  challenge_id integer NOT NULL,
  enrollment_id integer NOT NULL,
  user_id integer NOT NULL,
  rank integer NOT NULL,
  prize_amount_usd real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  approved_by integer,
  approved_at integer,
  paid_at integer,
  note text,
  prev_hash text,
  event_hash text NOT NULL DEFAULT '',
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_prize_awards_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade,
  CONSTRAINT challenge_prize_awards_enrollment_id_challenge_enrollments_id_fk
    FOREIGN KEY (enrollment_id) REFERENCES public.challenge_enrollments(id) ON DELETE cascade,
  CONSTRAINT challenge_prize_awards_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT challenge_prize_awards_approved_by_users_id_fk
    FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE set null
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'challenge_prize_awards_status_check') THEN
    ALTER TABLE challenge_prize_awards
      ADD CONSTRAINT challenge_prize_awards_status_check
      CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS challenge_prize_awards_challenge_rank_idx
  ON challenge_prize_awards (challenge_id, rank);
CREATE INDEX IF NOT EXISTS challenge_prize_awards_user_created_idx
  ON challenge_prize_awards (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_prize_awards_uidx
  ON challenge_prize_awards (challenge_id, user_id, enrollment_id);

CREATE TABLE IF NOT EXISTS challenge_certificate_templates (
  id serial PRIMARY KEY,
  name text NOT NULL,
  header_text text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  include_metrics boolean NOT NULL DEFAULT true,
  include_verification_code boolean NOT NULL DEFAULT true,
  brand_color text,
  logo_url text,
  is_downloadable boolean NOT NULL DEFAULT true,
  is_shareable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_certificate_templates_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE set null
);

CREATE INDEX IF NOT EXISTS challenge_certificate_templates_active_idx
  ON challenge_certificate_templates (is_active, updated_at);

CREATE TABLE IF NOT EXISTS challenge_progression_tiers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  tiers_json text NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_by integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_progression_tiers_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE set null
);

CREATE INDEX IF NOT EXISTS challenge_progression_tiers_active_idx
  ON challenge_progression_tiers (is_active, updated_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenges_certificate_template_id_fk'
  ) THEN
    ALTER TABLE challenges
      ADD CONSTRAINT challenges_certificate_template_id_fk
      FOREIGN KEY (certificate_template_id) REFERENCES public.challenge_certificate_templates(id) ON DELETE set null;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenges_progression_tier_id_fk'
  ) THEN
    ALTER TABLE challenges
      ADD CONSTRAINT challenges_progression_tier_id_fk
      FOREIGN KEY (progression_tier_id) REFERENCES public.challenge_progression_tiers(id) ON DELETE set null;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS challenge_user_progression (
  user_id integer PRIMARY KEY NOT NULL,
  current_tier text NOT NULL DEFAULT 'NONE',
  challenges_passed integer NOT NULL DEFAULT 0,
  top3_count integer NOT NULL DEFAULT 0,
  avg_pnl_pct real NOT NULL DEFAULT 0,
  total_dqs integer NOT NULL DEFAULT 0,
  tier_advanced_at integer,
  progression_plan_id integer,
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_user_progression_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT challenge_user_progression_progression_plan_id_challenge_progression_tiers_id_fk
    FOREIGN KEY (progression_plan_id) REFERENCES public.challenge_progression_tiers(id) ON DELETE set null
);

CREATE TABLE IF NOT EXISTS challenge_selection_boosts (
  id serial PRIMARY KEY,
  challenge_id integer NOT NULL,
  enrollment_id integer NOT NULL,
  user_id integer NOT NULL,
  points real NOT NULL DEFAULT 0,
  reason text,
  awarded_at integer NOT NULL DEFAULT (extract(epoch from now())),
  created_by integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_selection_boosts_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade,
  CONSTRAINT challenge_selection_boosts_enrollment_id_challenge_enrollments_id_fk
    FOREIGN KEY (enrollment_id) REFERENCES public.challenge_enrollments(id) ON DELETE cascade,
  CONSTRAINT challenge_selection_boosts_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT challenge_selection_boosts_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_selection_boosts_uidx
  ON challenge_selection_boosts (challenge_id, user_id, enrollment_id);
CREATE INDEX IF NOT EXISTS challenge_selection_boosts_user_awarded_idx
  ON challenge_selection_boosts (user_id, awarded_at);

CREATE TABLE IF NOT EXISTS challenge_certificates (
  id serial PRIMARY KEY,
  enrollment_id integer NOT NULL,
  user_id integer NOT NULL,
  challenge_id integer NOT NULL,
  template_id integer,
  verification_code_hmac text NOT NULL,
  metrics_json text NOT NULL DEFAULT '{}',
  is_downloadable boolean NOT NULL DEFAULT true,
  is_shareable boolean NOT NULL DEFAULT true,
  share_token_hash text,
  issued_at integer NOT NULL DEFAULT (extract(epoch from now())),
  downloaded_at integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_certificates_enrollment_id_challenge_enrollments_id_fk
    FOREIGN KEY (enrollment_id) REFERENCES public.challenge_enrollments(id) ON DELETE cascade,
  CONSTRAINT challenge_certificates_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT challenge_certificates_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade,
  CONSTRAINT challenge_certificates_template_id_challenge_certificate_templates_id_fk
    FOREIGN KEY (template_id) REFERENCES public.challenge_certificate_templates(id) ON DELETE set null
);

CREATE UNIQUE INDEX IF NOT EXISTS challenge_certificates_enrollment_uidx
  ON challenge_certificates (enrollment_id);
CREATE INDEX IF NOT EXISTS challenge_certificates_user_issued_idx
  ON challenge_certificates (user_id, issued_at);
CREATE INDEX IF NOT EXISTS challenge_certificates_verify_idx
  ON challenge_certificates (verification_code_hmac);
CREATE INDEX IF NOT EXISTS challenge_certificates_share_idx
  ON challenge_certificates (share_token_hash);

CREATE TABLE IF NOT EXISTS challenge_leaderboard_snapshot (
  challenge_id integer NOT NULL,
  user_id integer NOT NULL,
  rank integer NOT NULL,
  pnl_pct real NOT NULL,
  trading_days integer NOT NULL DEFAULT 0,
  max_daily_loss_hit real,
  composite_score real,
  calculated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_leaderboard_snapshot_pk PRIMARY KEY (challenge_id, user_id),
  CONSTRAINT challenge_leaderboard_snapshot_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade,
  CONSTRAINT challenge_leaderboard_snapshot_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS challenge_leaderboard_snapshot_rank_idx
  ON challenge_leaderboard_snapshot (challenge_id, rank);
CREATE INDEX IF NOT EXISTS challenge_leaderboard_snapshot_calc_idx
  ON challenge_leaderboard_snapshot (challenge_id, calculated_at);

COMMIT;
