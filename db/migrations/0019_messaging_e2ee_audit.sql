ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mailbox_public_key" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mailbox_public_key_algo" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mailbox_public_key_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mailbox_public_key_updated_at" integer;
--> statement-breakpoint

ALTER TABLE "mailbox_messages"
  ADD COLUMN IF NOT EXISTS "content_format" text DEFAULT 'PLAINTEXT' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  DROP CONSTRAINT IF EXISTS "mailbox_messages_content_format_check";
--> statement-breakpoint
ALTER TABLE "mailbox_messages"
  ADD CONSTRAINT "mailbox_messages_content_format_check"
  CHECK ("content_format" IN ('PLAINTEXT', 'MARKDOWN'));
--> statement-breakpoint

ALTER TABLE "communication_settings"
  ADD COLUMN IF NOT EXISTS "messaging_e2ee_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "communication_settings"
  ADD COLUMN IF NOT EXISTS "messaging_e2ee_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "communication_settings"
  ADD COLUMN IF NOT EXISTS "notification_e2ee_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "communication_settings"
  ADD COLUMN IF NOT EXISTS "notification_e2ee_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "mailbox_message_audit" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer,
  "thread_id" integer NOT NULL,
  "actor_user_id" integer,
  "actor_role" text DEFAULT 'SYSTEM' NOT NULL,
  "action" text NOT NULL,
  "ip" text,
  "user_agent" text,
  "metadata" text DEFAULT '{}' NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "prev_hash" text,
  "event_hash" text NOT NULL,
  CONSTRAINT "mailbox_message_audit_message_id_mailbox_messages_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "public"."mailbox_messages"("id") ON DELETE cascade,
  CONSTRAINT "mailbox_message_audit_thread_id_mailbox_threads_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "public"."mailbox_threads"("id") ON DELETE cascade,
  CONSTRAINT "mailbox_message_audit_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "mailbox_message_audit_actor_role_check"
    CHECK ("actor_role" IN ('USER', 'ADMIN', 'SYSTEM'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "mailbox_message_audit_thread_created_idx"
  ON "mailbox_message_audit" ("thread_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_message_audit_message_idx"
  ON "mailbox_message_audit" ("message_id");
