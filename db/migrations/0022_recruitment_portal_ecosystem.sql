ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS scout_tab_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS partner_portal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trader_pro_profiles_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trader_compete_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trader_community_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_allocations_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leaderboard_mode text NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN IF NOT EXISTS scout_min_sharpe_alert real NOT NULL DEFAULT 2.0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_config_leaderboard_mode_check'
  ) THEN
    ALTER TABLE system_config
      ADD CONSTRAINT system_config_leaderboard_mode_check
      CHECK (leaderboard_mode IN ('PUBLIC', 'TOP_10', 'DISABLED'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS intraday_high real,
  ADD COLUMN IF NOT EXISTS intraday_low real,
  ADD COLUMN IF NOT EXISTS mae real,
  ADD COLUMN IF NOT EXISTS mfe real;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scout_metrics_snapshot (
  user_id integer PRIMARY KEY NOT NULL,
  sharpe_ratio real,
  sortino_ratio real,
  calmar_ratio real,
  equity_curve_r2 real,
  avg_mae real,
  avg_mfe real,
  style_cluster text,
  composite_score real,
  calculated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT scout_metrics_snapshot_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scout_metrics_snapshot_style_cluster_check'
  ) THEN
    ALTER TABLE scout_metrics_snapshot
      ADD CONSTRAINT scout_metrics_snapshot_style_cluster_check
      CHECK (style_cluster IS NULL OR style_cluster IN ('SNIPER', 'SCALPER', 'SWING', 'NEWS'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scout_watchlists (
  id serial PRIMARY KEY NOT NULL,
  admin_id integer NOT NULL,
  user_id integer NOT NULL,
  tier text NOT NULL DEFAULT 'B_LIST',
  notes text,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT scout_watchlists_admin_id_users_id_fk
    FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT scout_watchlists_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scout_watchlists_tier_check'
  ) THEN
    ALTER TABLE scout_watchlists
      ADD CONSTRAINT scout_watchlists_tier_check
      CHECK (tier IN ('A_LIST', 'B_LIST', 'INCUBATOR'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS scout_watchlists_admin_user_uidx
  ON scout_watchlists (admin_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scout_watchlists_user_tier_idx
  ON scout_watchlists (user_id, tier);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS recruiting_pipeline (
  user_id integer PRIMARY KEY NOT NULL,
  stage text NOT NULL DEFAULT 'DETECTED',
  assigned_admin_id integer,
  last_contacted_at integer,
  notes text,
  is_partner_visible boolean NOT NULL DEFAULT false,
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT recruiting_pipeline_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade,
  CONSTRAINT recruiting_pipeline_assigned_admin_id_users_id_fk
    FOREIGN KEY (assigned_admin_id) REFERENCES public.users(id) ON DELETE set null
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_pipeline_stage_check'
  ) THEN
    ALTER TABLE recruiting_pipeline
      ADD CONSTRAINT recruiting_pipeline_stage_check
      CHECK (stage IN (
        'DETECTED',
        'WATCHLIST',
        'CONTACTED',
        'VETTED_EMAIL',
        'VETTED_SMS',
        'PERFORMER',
        'SELECTED_KYC',
        'PARTNER_READY'
      ));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS partners (
  id serial PRIMARY KEY NOT NULL,
  name text NOT NULL,
  api_key_hash text NOT NULL,
  api_key_prefix text,
  ip_whitelist text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  last_key_rotated_at integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partners_api_key_hash_uidx
  ON partners (api_key_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partners_active_idx
  ON partners (is_active, updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS partner_allocations (
  id serial PRIMARY KEY NOT NULL,
  partner_id integer NOT NULL,
  user_id integer NOT NULL,
  user_hash_id text NOT NULL,
  capital_usd real NOT NULL,
  shadow_stop_pct real,
  status text NOT NULL DEFAULT 'ACTIVE',
  current_pnl_usd real NOT NULL DEFAULT 0,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT partner_allocations_partner_id_partners_id_fk
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE cascade,
  CONSTRAINT partner_allocations_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_allocations_status_check'
  ) THEN
    ALTER TABLE partner_allocations
      ADD CONSTRAINT partner_allocations_status_check
      CHECK (status IN ('ACTIVE', 'STOPPED', 'CLOSED'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_allocations_partner_status_idx
  ON partner_allocations (partner_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_allocations_user_status_idx
  ON partner_allocations (user_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS partner_inquiries (
  id serial PRIMARY KEY NOT NULL,
  partner_id integer NOT NULL,
  user_hash_id text,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  mailbox_thread_id integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT partner_inquiries_partner_id_partners_id_fk
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE cascade,
  CONSTRAINT partner_inquiries_mailbox_thread_id_mailbox_threads_id_fk
    FOREIGN KEY (mailbox_thread_id) REFERENCES public.mailbox_threads(id) ON DELETE set null
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_inquiries_status_check'
  ) THEN
    ALTER TABLE partner_inquiries
      ADD CONSTRAINT partner_inquiries_status_check
      CHECK (status IN ('OPEN', 'FORWARDED', 'ANSWERED', 'CLOSED'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_inquiries_partner_status_idx
  ON partner_inquiries (partner_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_inquiries_mailbox_thread_idx
  ON partner_inquiries (mailbox_thread_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS trader_profiles (
  user_id integer PRIMARY KEY NOT NULL,
  bio text,
  strategy text,
  pinned_trade_ids text NOT NULL DEFAULT '[]',
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT trader_profiles_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS challenges (
  id serial PRIMARY KEY NOT NULL,
  name text NOT NULL,
  description text,
  profit_target_pct real NOT NULL,
  max_daily_loss_pct real NOT NULL,
  max_total_loss_pct real,
  min_trading_days integer,
  duration_days integer NOT NULL,
  start_at integer,
  end_at integer,
  is_active boolean NOT NULL DEFAULT false,
  created_by integer,
  created_at integer NOT NULL DEFAULT (extract(epoch from now())),
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenges_created_by_users_id_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS challenges_active_window_idx
  ON challenges (is_active, start_at, end_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS challenge_enrollments (
  id serial PRIMARY KEY NOT NULL,
  challenge_id integer NOT NULL,
  user_id integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  enrolled_at integer NOT NULL DEFAULT (extract(epoch from now())),
  completed_at integer,
  current_pnl_pct real NOT NULL DEFAULT 0,
  max_daily_loss_hit real,
  trading_days integer NOT NULL DEFAULT 0,
  updated_at integer NOT NULL DEFAULT (extract(epoch from now())),
  CONSTRAINT challenge_enrollments_challenge_id_challenges_id_fk
    FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE cascade,
  CONSTRAINT challenge_enrollments_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE cascade
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_enrollments_status_check'
  ) THEN
    ALTER TABLE challenge_enrollments
      ADD CONSTRAINT challenge_enrollments_status_check
      CHECK (status IN ('ACTIVE', 'PASSED', 'FAILED', 'WITHDRAWN'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS challenge_enrollments_challenge_user_uidx
  ON challenge_enrollments (challenge_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS challenge_enrollments_user_status_idx
  ON challenge_enrollments (user_id, status);
