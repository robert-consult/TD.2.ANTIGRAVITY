ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS partner_inquiry_inbox_alias text NOT NULL DEFAULT 'inquiries@',
  ADD COLUMN IF NOT EXISTS partner_inquiry_route_admin_emails_csv text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS partner_inquiry_viewer_admin_emails_csv text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE partner_inquiries
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS sender_email text;
