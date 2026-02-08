CREATE TABLE IF NOT EXISTS "mailbox_threads" (
  "id" serial PRIMARY KEY NOT NULL,
  "subject" text,
  "created_by" integer,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "is_broadcast" boolean DEFAULT false NOT NULL,
  "category" text DEFAULT 'SUPPORT' NOT NULL,
  CONSTRAINT "mailbox_threads_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "mailbox_threads_category_check"
    CHECK ("category" IN ('SYSTEM', 'SUPPORT', 'ANNOUNCEMENT'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mailbox_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "thread_id" integer NOT NULL,
  "sender_id" integer,
  "body" text NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "allow_reply" boolean DEFAULT false NOT NULL,
  "message_type" text DEFAULT 'DIRECT' NOT NULL,
  "metadata" text DEFAULT '{}' NOT NULL,
  CONSTRAINT "mailbox_messages_thread_id_mailbox_threads_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "public"."mailbox_threads"("id") ON DELETE cascade,
  CONSTRAINT "mailbox_messages_sender_id_users_id_fk"
    FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mailbox_participants" (
  "thread_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "last_read_message_id" integer,
  "is_archived" boolean DEFAULT false NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  CONSTRAINT "mailbox_participants_thread_id_user_id_pk" PRIMARY KEY("thread_id", "user_id"),
  CONSTRAINT "mailbox_participants_thread_id_mailbox_threads_id_fk"
    FOREIGN KEY ("thread_id") REFERENCES "public"."mailbox_threads"("id") ON DELETE cascade,
  CONSTRAINT "mailbox_participants_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "mailbox_participants_last_read_message_id_mailbox_messages_id_fk"
    FOREIGN KEY ("last_read_message_id") REFERENCES "public"."mailbox_messages"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "type" text DEFAULT 'SYSTEM' NOT NULL,
  "severity" text DEFAULT 'INFO' NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "read_at" integer,
  "link" text,
  "source_event" text,
  CONSTRAINT "notifications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "notifications_type_check"
    CHECK ("type" IN ('TRADE', 'SYSTEM', 'ACCOUNT', 'SECURITY', 'KYC')),
  CONSTRAINT "notifications_severity_check"
    CHECK ("severity" IN ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_threads_updated_at_idx"
  ON "mailbox_threads" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_threads_created_by_idx"
  ON "mailbox_threads" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_messages_thread_created_idx"
  ON "mailbox_messages" ("thread_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_messages_sender_idx"
  ON "mailbox_messages" ("sender_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_participants_user_updated_idx"
  ON "mailbox_participants" ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_participants_user_archived_idx"
  ON "mailbox_participants" ("user_id", "is_archived");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_read_idx"
  ON "notifications" ("user_id", "is_read");
