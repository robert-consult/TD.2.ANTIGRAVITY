ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "lot_preset_cards" text DEFAULT '[1,5,10,25,50]' NOT NULL;
--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "lot_dropdown_max" integer DEFAULT 50 NOT NULL;

