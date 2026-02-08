CREATE TABLE IF NOT EXISTS "communication_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "messaging_enabled" boolean DEFAULT true NOT NULL,
  "messaging_allow_reply_by_default" boolean DEFAULT false NOT NULL,
  "messaging_allow_broadcast_replies" boolean DEFAULT false NOT NULL,
  "messaging_large_target_threshold" integer DEFAULT 100 NOT NULL,
  "messaging_max_recipients_per_send" integer DEFAULT 10000 NOT NULL,
  "messaging_async_fanout_threshold" integer DEFAULT 200 NOT NULL,
  "messaging_fanout_batch_size" integer DEFAULT 500 NOT NULL,
  "messaging_auto_welcome_enabled" boolean DEFAULT true NOT NULL,
  "messaging_account_status_mailbox_enabled" boolean DEFAULT true NOT NULL,
  "messaging_kyc_mailbox_enabled" boolean DEFAULT true NOT NULL,
  "notifications_enabled" boolean DEFAULT true NOT NULL,
  "notification_realtime_enabled" boolean DEFAULT true NOT NULL,
  "notification_sound_default_enabled" boolean DEFAULT true NOT NULL,
  "notification_trade_pending_fill_enabled" boolean DEFAULT true NOT NULL,
  "notification_trade_take_profit_enabled" boolean DEFAULT true NOT NULL,
  "notification_trade_stop_loss_enabled" boolean DEFAULT true NOT NULL,
  "notification_trade_max_hold_enabled" boolean DEFAULT true NOT NULL,
  "notification_account_freeze_enabled" boolean DEFAULT true NOT NULL,
  "notification_account_unfreeze_enabled" boolean DEFAULT true NOT NULL,
  "notification_kyc_updates_enabled" boolean DEFAULT true NOT NULL,
  "updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
  "updated_by" text
);
--> statement-breakpoint
INSERT INTO "communication_settings" ("id")
VALUES (1)
ON CONFLICT ("id") DO NOTHING;
