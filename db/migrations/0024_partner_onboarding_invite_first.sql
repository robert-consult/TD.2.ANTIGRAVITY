ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS partner_gating_config text NOT NULL DEFAULT '{"viewDataRoom":"INVITED","runSimulations":"IDENTITY","requestAllocation":"COMPLIANT","directContact":"ADMIN_APPROVED"}',
  ADD COLUMN IF NOT EXISTS partner_password_rotation_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS partner_password_reminder_logins integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS partner_invite_default_expiry_days integer NOT NULL DEFAULT 7;
--> statement-breakpoint
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_username text,
  ADD COLUMN IF NOT EXISTS temp_password_hash text,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_expires_at integer,
  ADD COLUMN IF NOT EXISTS password_rotated_at integer,
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS onboarding_step text NOT NULL DEFAULT 'PROFILE',
  ADD COLUMN IF NOT EXISTS profile_data text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fund_logo_url text,
  ADD COLUMN IF NOT EXISTS aum_range text,
  ADD COLUMN IF NOT EXISTS hq_location text,
  ADD COLUMN IF NOT EXISTS strategy_tags text NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS kyb_doc_url text,
  ADD COLUMN IF NOT EXISTS agreements_signed_at integer,
  ADD COLUMN IF NOT EXISTS contact_access_requested_at integer,
  ADD COLUMN IF NOT EXISTS approved_at integer,
  ADD COLUMN IF NOT EXISTS gating_overrides text NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS admin_notes text;
--> statement-breakpoint
UPDATE partners
SET
  invite_status = 'ACTIVE',
  onboarding_step = 'COMPLETED'
WHERE contact_email IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_invite_status_check'
  ) THEN
    ALTER TABLE partners
      ADD CONSTRAINT partners_invite_status_check
      CHECK (invite_status IN ('INVITED', 'ACTIVE', 'REVOKED'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partners_onboarding_step_check'
  ) THEN
    ALTER TABLE partners
      ADD CONSTRAINT partners_onboarding_step_check
      CHECK (onboarding_step IN ('PROFILE', 'IDENTITY', 'LEGAL', 'WAITING_APPROVAL', 'COMPLETED'));
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partners_contact_email_uidx
  ON partners (lower(contact_email))
  WHERE contact_email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS partner_invites (
  id serial PRIMARY KEY NOT NULL,
  admin_id integer,
  partner_id integer NOT NULL,
  partner_email text NOT NULL,
  fund_name text,
  admin_notes text,
  expires_in_days integer NOT NULL DEFAULT 7,
  invited_at integer NOT NULL DEFAULT (extract(epoch from now())),
  email_status text NOT NULL DEFAULT 'QUEUED',
  invite_token_hash text,
  email_provider_message_id text,
  email_status_detail text,
  CONSTRAINT partner_invites_admin_id_users_id_fk
    FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE set null,
  CONSTRAINT partner_invites_partner_id_partners_id_fk
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE cascade
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'partner_invites_email_status_check'
  ) THEN
    ALTER TABLE partner_invites
      ADD CONSTRAINT partner_invites_email_status_check
      CHECK (email_status IN ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'FAILED', 'SKIPPED'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_invites_partner_invited_idx
  ON partner_invites (partner_id, invited_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_invites_admin_invited_idx
  ON partner_invites (admin_id, invited_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_invites_email_idx
  ON partner_invites (partner_email);
