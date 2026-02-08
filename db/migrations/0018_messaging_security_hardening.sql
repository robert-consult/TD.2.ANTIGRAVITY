ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "body_encrypted" text;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "body_encoding" text DEFAULT 'PLAINTEXT_V0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "encryption_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "body_digest_sha256" text;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "e2ee_envelope" text;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "e2ee_sender_key_fingerprint" text;
--> statement-breakpoint

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "title_encrypted" text;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "message_encrypted" text;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "content_encoding" text DEFAULT 'PLAINTEXT_V0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "encryption_version" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "content_digest_sha256" text;
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "e2ee_envelope" text;
--> statement-breakpoint

ALTER TABLE "mailbox_messages"
  DROP CONSTRAINT IF EXISTS "mailbox_messages_body_encoding_check";
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD CONSTRAINT "mailbox_messages_body_encoding_check"
  CHECK ("body_encoding" IN ('PLAINTEXT_V0', 'ATREST_AES256GCM_V1', 'E2EE_ENVELOPE_V1'));
--> statement-breakpoint

ALTER TABLE "notifications"
  DROP CONSTRAINT IF EXISTS "notifications_content_encoding_check";
--> statement-breakpoint
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_content_encoding_check"
  CHECK ("content_encoding" IN ('PLAINTEXT_V0', 'ATREST_AES256GCM_V1', 'E2EE_ENVELOPE_V1'));
