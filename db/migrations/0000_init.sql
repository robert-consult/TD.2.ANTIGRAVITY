CREATE TABLE "admin_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"metadata" text,
	"ip" text,
	"user_agent" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_risk_assessments" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT 'OK' NOT NULL,
	"signals_json" text DEFAULT '{}' NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_fx_closes" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol_id" integer NOT NULL,
	"symbol_name" text NOT NULL,
	"trade_date" text NOT NULL,
	"close_price" real NOT NULL,
	"bid_price" real,
	"ask_price" real,
	"source" text DEFAULT '1FORGE' NOT NULL,
	"rollover_tz" text NOT NULL,
	"rollover_time" text NOT NULL,
	"calculated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'VERIFY' NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_leverage" real DEFAULT 50 NOT NULL,
	"max_position_size" real DEFAULT 100000 NOT NULL,
	"max_trades_per_user" integer DEFAULT 10 NOT NULL,
	"max_trades_per_instrument" integer DEFAULT 3 NOT NULL,
	"max_concurrent_lots" integer DEFAULT 50 NOT NULL,
	"market_open_time" text DEFAULT '09:00' NOT NULL,
	"market_close_time" text DEFAULT '17:00' NOT NULL,
	"allow_weekend_trading" boolean DEFAULT false NOT NULL,
	"enable_auto_close" boolean DEFAULT true NOT NULL,
	"auto_close_after_days" integer DEFAULT 4 NOT NULL,
	"auto_close_check_frequency_minutes" integer DEFAULT 60 NOT NULL,
	"min_hold_sec" integer DEFAULT 60 NOT NULL,
	"enable_loss_limits" boolean DEFAULT true NOT NULL,
	"daily_loss_limit_pct" real DEFAULT 10 NOT NULL,
	"lifetime_loss_limit_pct" real DEFAULT 20 NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now()))
);
--> statement-breakpoint
CREATE TABLE "grift_admin_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" integer,
	"payload_json" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"prev_hash" text,
	"hash" text
);
--> statement-breakpoint
CREATE TABLE "grift_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"details_json" text,
	"related_user_id" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"reviewed_at" integer,
	"reviewed_by" integer,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "grift_case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"link_type" text NOT NULL,
	"link_id" integer NOT NULL,
	"added_by_admin_id" integer,
	"added_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_case_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"admin_id" integer NOT NULL,
	"note" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_case_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"signal_id" integer NOT NULL,
	"added_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"created_by_admin_id" integer,
	"assigned_admin_id" integer,
	"resolution" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"closed_at" integer
);
--> statement-breakpoint
CREATE TABLE "grift_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"multi_account_window_days" integer DEFAULT 30 NOT NULL,
	"churn_window_hours" integer DEFAULT 24 NOT NULL,
	"hedge_window_minutes" integer DEFAULT 10 NOT NULL,
	"concurrent_window_minutes" integer DEFAULT 15 NOT NULL,
	"ip_unique_threshold" integer DEFAULT 4 NOT NULL,
	"ua_unique_threshold" integer DEFAULT 3 NOT NULL,
	"device_unique_threshold" integer DEFAULT 3 NOT NULL,
	"asn_unique_threshold" integer DEFAULT 3 NOT NULL,
	"geo_velocity_kmh_threshold" integer DEFAULT 900 NOT NULL,
	"geo_velocity_min_distance_km" integer DEFAULT 800 NOT NULL,
	"geo_velocity_max_hours" integer DEFAULT 6 NOT NULL,
	"hedge_require_device_match" integer DEFAULT 1 NOT NULL,
	"hedge_allow_ip_match" integer DEFAULT 1 NOT NULL,
	"score_multi_account_device" integer DEFAULT 35 NOT NULL,
	"score_hedge_pair" integer DEFAULT 55 NOT NULL,
	"score_ip_churn" integer DEFAULT 20 NOT NULL,
	"score_ua_churn" integer DEFAULT 15 NOT NULL,
	"score_device_churn" integer DEFAULT 20 NOT NULL,
	"score_geo_velocity" integer DEFAULT 30 NOT NULL,
	"score_concurrent_sessions" integer DEFAULT 25 NOT NULL,
	"score_asn_volatility" integer DEFAULT 15 NOT NULL,
	"score_shared_ip_asn_cluster" integer DEFAULT 40 NOT NULL,
	"score_multi_account_laddering" integer DEFAULT 50 NOT NULL,
	"cluster_min_users_for_ip_asn" integer DEFAULT 3 NOT NULL,
	"laddering_window_days" integer DEFAULT 7 NOT NULL,
	"laddering_min_sequence" integer DEFAULT 3 NOT NULL,
	"tier_med" integer DEFAULT 40 NOT NULL,
	"tier_high" integer DEFAULT 60 NOT NULL,
	"tier_critical" integer DEFAULT 80 NOT NULL,
	"mitigation_mfa" integer DEFAULT 10 NOT NULL,
	"mitigation_kyc_approved" integer DEFAULT 15 NOT NULL,
	"enforcement_freeze_threshold" integer DEFAULT 80 NOT NULL,
	"enforcement_disable_threshold" integer DEFAULT 100 NOT NULL,
	"enforcement_auto_freeze" integer DEFAULT 0 NOT NULL,
	"enforcement_auto_disable" integer DEFAULT 0 NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_by_admin_id" integer
);
--> statement-breakpoint
CREATE TABLE "grift_device_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"first_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"link_strength" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_devices" (
	"device_id" text PRIMARY KEY NOT NULL,
	"first_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"first_ip" text,
	"first_geo_country" text,
	"trust_level" text DEFAULT 'NEW' NOT NULL,
	"users_count" integer DEFAULT 1 NOT NULL,
	"metadata_json" text
);
--> statement-breakpoint
CREATE TABLE "grift_enforcement_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" text NOT NULL,
	"old_status" text,
	"new_status" text,
	"admin_id" integer,
	"reason" text,
	"risk_score_at_action" integer,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_identity_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"link_type" text NOT NULL,
	"link_value" text NOT NULL,
	"first_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_seen_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"metadata_json" text
);
--> statement-breakpoint
CREATE TABLE "grift_linked_account_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_a" integer NOT NULL,
	"user_b" integer NOT NULL,
	"link_type" text NOT NULL,
	"link_value" text,
	"confidence" real DEFAULT 1 NOT NULL,
	"first_linked_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_confirmed_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"metadata_json" text
);
--> statement-breakpoint
CREATE TABLE "grift_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"event_type" text DEFAULT 'SESSION_PING' NOT NULL,
	"session_id" text,
	"device_id" text,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text,
	"ip" text,
	"user_agent" text,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"latitude" real,
	"longitude" real,
	"asn" integer,
	"org" text,
	"observed_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"rule_code" text NOT NULL,
	"dedupe_key" text,
	"severity" text DEFAULT 'MEDIUM' NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"evidence_json" text,
	"related_user_id" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"closed_at" integer,
	"closed_by_admin_id" integer,
	"closure_note" text,
	"device_id" text,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text,
	"ip" text,
	"user_agent" text,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"latitude" real,
	"longitude" real,
	"asn" integer,
	"org" text,
	"symbol" text,
	"trade_id" integer
);
--> statement-breakpoint
CREATE TABLE "grift_trade_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" text,
	"device_id" text,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text,
	"ip" text,
	"user_agent" text,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"lots" real NOT NULL,
	"geo_country" text,
	"geo_region" text,
	"geo_city" text,
	"latitude" real,
	"longitude" real,
	"asn" integer,
	"org" text,
	"observed_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grift_user_enforcements" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"frozen_at" integer,
	"frozen_by_admin_id" integer,
	"disabled_at" integer,
	"disabled_by_admin_id" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "grift_user_risk" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_factors_json" text,
	"last_evaluated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"manual_override" text,
	"override_by" integer,
	"override_at" integer,
	"override_reason" text,
	"enforcement_status" text DEFAULT 'ACTIVE',
	"enforcement_at" integer,
	"enforcement_by" integer,
	"enforcement_reason" text
);
--> statement-breakpoint
CREATE TABLE "grift_user_scores" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"score_current" integer DEFAULT 0 NOT NULL,
	"score_7d" integer DEFAULT 0 NOT NULL,
	"score_30d" integer DEFAULT 0 NOT NULL,
	"tier" text DEFAULT 'LOW' NOT NULL,
	"devices_7d" integer DEFAULT 0 NOT NULL,
	"ips_7d" integer DEFAULT 0 NOT NULL,
	"user_agents_7d" integer DEFAULT 0 NOT NULL,
	"countries_7d" integer DEFAULT 0 NOT NULL,
	"asns_7d" integer DEFAULT 0 NOT NULL,
	"linked_accounts_30d" integer DEFAULT 0 NOT NULL,
	"hedge_pairs_7d" integer DEFAULT 0 NOT NULL,
	"open_signals_count" integer DEFAULT 0 NOT NULL,
	"last_evaluated_at" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"user_id" integer,
	"email" text,
	"username" text,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"description" text,
	"ip" text,
	"user_agent" text,
	"actor_admin_id" integer,
	"actor_type" text,
	"actor_user_id" integer,
	"session_id" text,
	"correlation_id" text,
	"data_json" text,
	"prev_hash" text,
	"event_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email_at_acceptance" text,
	"country_iso2" text,
	"region_key" text,
	"global_doc_id" integer,
	"global_doc_version" text,
	"global_doc_sha256" text,
	"addendum_id" integer,
	"addendum_version" text,
	"addendum_sha256" text,
	"combined_sha256" text NOT NULL,
	"combined_text" text,
	"ledger_seq" integer NOT NULL,
	"prev_ledger_hash" text,
	"ledger_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"session_id" text,
	"doc_id" integer,
	"doc_version" text,
	"doc_content_hash" text,
	"terms_token" text,
	"terms_token_verified" boolean DEFAULT false,
	"accepted_from_ip" text,
	"accepted_user_agent" text,
	"prev_hash" text,
	"record_hash" text,
	"accepted_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"accepted_at_ms" integer
);
--> statement-breakpoint
CREATE TABLE "legal_doc_change_audit_chain" (
	"id" serial PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"prev_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"admin_user_id" integer,
	"action" text NOT NULL,
	"doc_set" text,
	"doc_type" text,
	"jurisdiction_type" text,
	"jurisdiction_key" text,
	"old_active_document_id" integer,
	"new_active_document_id" integer,
	"note" text,
	"created_at_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_doc_change_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" integer,
	"target_id" integer,
	"action" text NOT NULL,
	"changed_by" text,
	"changed_at" integer,
	"previous_value" text,
	"new_value" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "legal_doc_pointers" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_set" text NOT NULL,
	"doc_type" text NOT NULL,
	"jurisdiction_type" text NOT NULL,
	"jurisdiction_key" text NOT NULL,
	"active_document_id" integer,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"updated_by_admin_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_set" text NOT NULL,
	"doc_type" text NOT NULL,
	"jurisdiction_type" text NOT NULL,
	"jurisdiction_key" text NOT NULL,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"notes" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000) NOT NULL,
	"created_by_admin_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "legal_reaccept_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"doc_set" text NOT NULL,
	"country_iso2" text NOT NULL,
	"region_key" text,
	"required_combined_sha256" text NOT NULL,
	"last_accepted_combined_sha256" text,
	"last_acceptance_id" integer,
	"detected_at_ms" integer NOT NULL,
	"detected_by" text DEFAULT 'LOGIN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"user_id" integer,
	"since_ts" integer,
	"requested_by_admin_id" integer,
	"status" text NOT NULL,
	"created_at" integer NOT NULL,
	"started_at" integer,
	"completed_at" integer,
	"totals_json" text DEFAULT '{}' NOT NULL,
	"manifest_json" text DEFAULT '{}' NOT NULL,
	"data_parts_json" text,
	"chunking_enabled" boolean,
	"chunk_size_mb" integer,
	"manifest_sha256" text,
	"data_sha256" text,
	"data_path" text,
	"manifest_path" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "migration_id_map" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"legacy_id" text NOT NULL,
	"new_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"id_strategy" text DEFAULT 'PRESERVE' NOT NULL,
	"requested_by_admin_id" integer,
	"status" text NOT NULL,
	"created_at" integer NOT NULL,
	"started_at" integer,
	"completed_at" integer,
	"manifest_sha256" text,
	"data_sha256" text,
	"data_parts_json" text,
	"data_path" text,
	"manifest_path" text,
	"totals_json" text DEFAULT '{}' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "migration_integrity_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"chain_type" text NOT NULL,
	"entity_key" text NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"verified_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_job_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"ts" integer NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context_json" text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_intent_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"correlation_id" text NOT NULL,
	"event_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"event_at_ms" integer,
	"event_code" text NOT NULL,
	"decision" text,
	"reject_check" text,
	"reject_reason" text,
	"actor_type" text DEFAULT 'USER' NOT NULL,
	"user_id" integer NOT NULL,
	"session_id" text,
	"ip" text,
	"user_agent" text,
	"symbol" text,
	"side" text,
	"order_type" text,
	"time_in_force" text,
	"qty_lots" real,
	"requested_price" real,
	"limit_price" real,
	"stop_price" real,
	"take_profit" real,
	"stop_loss" real,
	"quote_bid" real,
	"quote_ask" real,
	"quote_mid" real,
	"quote_ts" integer,
	"quote_is_stale" boolean,
	"risk_limit_json" text,
	"risk_observed_json" text,
	"risk_snapshot_json" text,
	"payload_json" text NOT NULL,
	"prev_hash" text NOT NULL,
	"event_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"price" real DEFAULT 0 NOT NULL,
	"bid" real,
	"ask" real,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"last_api_update" integer
);
--> statement-breakpoint
CREATE TABLE "signup_fingerprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"request_id" text NOT NULL,
	"ip" text NOT NULL,
	"ip_hash" text NOT NULL,
	"user_agent" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"country_code" text,
	"region" text,
	"city" text,
	"latitude" real,
	"longitude" real,
	"inferred_tz" text,
	"client_tz" text,
	"client_lang" text,
	"device_fp" text,
	"device_install_id" text,
	"country_iso2_selected" text,
	"region_key_selected" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	CONSTRAINT "signup_fingerprints_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "signup_freeze_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"email_lower" text,
	"username" text,
	"ip" text,
	"user_agent" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_jurisdiction_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"email_lower" text,
	"username" text,
	"ip" text,
	"user_agent" text,
	"ip_country_iso2" text,
	"selected_country_iso2" text,
	"reason_code" text NOT NULL,
	"policy_snapshot_json" text,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signup_waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"email_lower" text NOT NULL,
	"source" text DEFAULT 'PUBLIC_WAITLIST' NOT NULL,
	"ip" text,
	"user_agent" text,
	"consented_at" integer NOT NULL,
	"consent_doc_version" text NOT NULL,
	"consent_doc_sha256" text NOT NULL,
	"consent_doc_content" text NOT NULL,
	"consent_signature" text NOT NULL,
	"prev_hash" text,
	"record_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"invited_at" integer,
	"invited_by_admin_id" integer,
	"invite_send_count" integer DEFAULT 0 NOT NULL,
	"last_invite_sent_at" integer,
	"last_invite_status" text,
	"last_invite_error" text,
	"last_invite_from" text,
	"last_invite_subject" text,
	"last_invite_body_sha256" text,
	"converted_at" integer,
	"converted_user_id" integer,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_otp_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"phone_e164" text NOT NULL,
	"otp_hash" text NOT NULL,
	"expires_at" integer NOT NULL,
	"consumed_at" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"base_currency" text,
	"quote_currency" text,
	"spread" real,
	"min_spread_pips" real DEFAULT 2,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_lot" integer DEFAULT 100000 NOT NULL,
	"max_lot" integer DEFAULT 5000000 NOT NULL,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	CONSTRAINT "symbol_configs_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "system_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"trading_halt" boolean DEFAULT false NOT NULL,
	"close_only_mode" boolean DEFAULT false NOT NULL,
	"block_open_on_stale_quotes" boolean DEFAULT true NOT NULL,
	"maintenance_message" text DEFAULT 'System is under maintenance. Trading will resume shortly.',
	"quote_refresh_ms" integer DEFAULT 870 NOT NULL,
	"feed_poll_ms" integer DEFAULT 870 NOT NULL,
	"stale_threshold_ms" integer DEFAULT 30000 NOT NULL,
	"fx_rollover_tz" text DEFAULT 'America/New_York' NOT NULL,
	"fx_rollover_time" text DEFAULT '17:00' NOT NULL,
	"legal_coverage_enforce" boolean DEFAULT false NOT NULL,
	"jurisdiction_restricted_iso2_csv" text DEFAULT 'KP,IR,CU,SY' NOT NULL,
	"jurisdiction_restricted_message" text DEFAULT 'This jurisdiction is not supported due to regulatory restrictions.' NOT NULL,
	"jurisdiction_enforce_by_ip_geo" boolean DEFAULT false NOT NULL,
	"jurisdiction_enforce_by_signup_country" boolean DEFAULT true NOT NULL,
	"jurisdiction_block_signup" boolean DEFAULT true NOT NULL,
	"jurisdiction_block_login" boolean DEFAULT true NOT NULL,
	"signup_captcha_enforce" boolean DEFAULT true NOT NULL,
	"captcha_provider" text DEFAULT 'SLIDER' NOT NULL,
	"signup_phone_enforce" boolean DEFAULT true NOT NULL,
	"signup_freeze" boolean DEFAULT false NOT NULL,
	"signup_freeze_message" text DEFAULT 'Signups are temporarily paused due to capacity. Existing users can still log in.' NOT NULL,
	"signup_waitlist_enabled" boolean DEFAULT true NOT NULL,
	"signup_waitlist_invite_sender" text DEFAULT 'TradeQuip <noreply@tradequip.com>' NOT NULL,
	"signup_waitlist_invite_subject" text DEFAULT 'Signup slots are open again' NOT NULL,
	"signup_waitlist_invite_body_text" text DEFAULT 'Hello {{name}},

Signup slots are open again. Please register here: {{signup_link}}

If you did not request an invite, you can ignore this message.' NOT NULL,
	"signup_waitlist_auto_invite_on_unfreeze" boolean DEFAULT false NOT NULL,
	"signup_waitlist_invite_batch_cap" integer DEFAULT 200 NOT NULL,
	"signup_waitlist_policy_version" text DEFAULT '1' NOT NULL,
	"signup_waitlist_policy_content" text DEFAULT 'WAITLIST COMMUNICATIONS & PRIVACY NOTICE

By requesting an invite, you consent to receive an email when signup slots reopen.

What we collect:
- Your name and email address
- Basic client metadata (IP address and user agent)

How we use it:
- To notify you when signup slots open
- We do not sell your data

Retention:
- We retain waitlist records until you are invited or you opt out

Opt-out:
- You can opt out by replying to an invite email or contacting support.' NOT NULL,
	"inactivity_threshold_days" integer DEFAULT 90 NOT NULL,
	"deletion_grace_days" integer DEFAULT 30 NOT NULL,
	"activity_auto_queue_inactive" boolean DEFAULT true NOT NULL,
	"activity_auto_soft_delete" boolean DEFAULT false NOT NULL,
	"bot_score_threshold" integer DEFAULT 40 NOT NULL,
	"bot_pow_enabled" boolean DEFAULT true NOT NULL,
	"bot_pow_enforce_signup" boolean DEFAULT true NOT NULL,
	"bot_pow_enforce_login" boolean DEFAULT false NOT NULL,
	"bot_pow_challenge_score" integer DEFAULT 25 NOT NULL,
	"bot_pow_base_difficulty" integer DEFAULT 14 NOT NULL,
	"bot_pow_max_difficulty" integer DEFAULT 20 NOT NULL,
	"bot_pow_ttl_sec" integer DEFAULT 120 NOT NULL,
	"bot_valkey_enabled" boolean DEFAULT true NOT NULL,
	"allow_user_timezone_edit" boolean DEFAULT true NOT NULL,
	"policy_contender_path1_min_age_days" integer DEFAULT 30 NOT NULL,
	"policy_contender_path1_min_trades_lifetime" integer DEFAULT 30 NOT NULL,
	"policy_contender_path1_min_balance_pct" real DEFAULT 1.2 NOT NULL,
	"policy_contender_path2_min_age_days" integer DEFAULT 90 NOT NULL,
	"policy_contender_path2_min_trades_last90" integer DEFAULT 20 NOT NULL,
	"policy_contender_path2_min_return_last90" real DEFAULT 0.1 NOT NULL,
	"policy_contender_path2_max_days_since_last_trade" integer DEFAULT 14 NOT NULL,
	"policy_auto_promote_performer" boolean DEFAULT true NOT NULL,
	"policy_email_resend_cooldown_sec" integer DEFAULT 60 NOT NULL,
	"policy_email_daily_send_cap" integer DEFAULT 5 NOT NULL,
	"policy_sms_daily_send_cap" integer DEFAULT 5 NOT NULL,
	"policy_sms_resend_cooldown_sec" integer DEFAULT 60 NOT NULL,
	"policy_otp_max_attempts" integer DEFAULT 5 NOT NULL,
	"policy_otp_lock_minutes" integer DEFAULT 30 NOT NULL,
	"i18n_enabled" boolean DEFAULT true NOT NULL,
	"i18n_default_locale" text DEFAULT 'en' NOT NULL,
	"i18n_supported_locales_csv" text DEFAULT 'en,fr,pt,es,de,ar,hi,id,zh,ms,tl,ko,ja,sw,th,bn,tr' NOT NULL,
	"i18n_auto_translate" boolean DEFAULT true NOT NULL,
	"i18n_llm_enabled" boolean DEFAULT true NOT NULL,
	"i18n_llm_provider" text DEFAULT 'openai' NOT NULL,
	"i18n_llm_model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"i18n_llm_max_batch_size" integer DEFAULT 50 NOT NULL,
	"i18n_llm_max_attempts" integer DEFAULT 3 NOT NULL,
	"migration_chunking_enabled" boolean DEFAULT false NOT NULL,
	"migration_chunk_size_mb" integer DEFAULT 51200 NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())),
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "trade_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_category" text DEFAULT 'TRADE' NOT NULL,
	"event_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"event_at_ms" integer,
	"correlation_id" text,
	"order_id" text,
	"execution_id" text,
	"position_id" text,
	"actor_type" text DEFAULT 'SYSTEM' NOT NULL,
	"actor_user_id" integer,
	"session_id" text,
	"ip" text,
	"user_agent" text,
	"symbol" text,
	"side" text,
	"order_type" text,
	"time_in_force" text,
	"qty_lots" real,
	"requested_price" real,
	"trigger_price" real,
	"limit_price" real,
	"stop_price" real,
	"fill_price" real,
	"avg_fill_price" real,
	"quote_ts" integer,
	"quote_source" text,
	"quote_bid" real,
	"quote_ask" real,
	"quote_mid" real,
	"quote_spread" real,
	"spread_pips" real,
	"slippage" real,
	"slippage_pips" real,
	"slippage_reference" text,
	"latency_ms" integer,
	"risk_check_name" text,
	"risk_limit_value" real,
	"risk_observed_value" real,
	"risk_result" text,
	"reason_code" text,
	"payload_json" text,
	"prev_hash" text,
	"event_hash" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "trader_journal" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"trade_id" integer,
	"trade_ids" text,
	"note" text NOT NULL,
	"mood" text,
	"tags" text,
	"attachment_url" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"symbol_id" integer NOT NULL,
	"type" text NOT NULL,
	"order_type" text DEFAULT 'Market' NOT NULL,
	"size" integer NOT NULL,
	"lots" integer,
	"open_price" real NOT NULL,
	"close_price" real,
	"take_profit" real,
	"stop_loss" real,
	"limit_price" real,
	"stop_price" real,
	"profit" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"opened_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"executed_at" integer,
	"closed_at" integer,
	"close_reason" text,
	"close_quote_ts" integer,
	"close_source" text,
	"close_bid" real,
	"close_ask" real,
	"close_mid" real,
	"close_spread" real,
	"correlation_id" text,
	"order_id" text,
	"position_id" text,
	"last_execution_id" text,
	"last_actor_user_id" integer,
	"last_actor_session_id" text,
	"last_actor_ip" text,
	"last_actor_user_agent" text,
	"last_actor_type" text,
	"last_actor_device_id" text
);
--> statement-breakpoint
CREATE TABLE "user_account_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"admin_id" integer,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reason_code" text,
	"reason_text" text,
	"metadata" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_admin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"admin_id" integer,
	"type" text DEFAULT 'NOTE' NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"flag_code" text,
	"content" text NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" integer,
	"resolved_by_admin_id" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_deletion_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"status" text DEFAULT 'GRACE' NOT NULL,
	"reason" text DEFAULT 'INACTIVE' NOT NULL,
	"marked_at" integer NOT NULL,
	"grace_expires_at" integer NOT NULL,
	"last_active_at" integer,
	"executed_at" integer,
	"executed_by_admin_id" integer,
	"note" text,
	CONSTRAINT "user_deletion_queue_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_equity_daily" (
	"user_id" integer NOT NULL,
	"day_key" text NOT NULL,
	"equity" real NOT NULL,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	CONSTRAINT "user_equity_daily_user_id_day_key_pk" PRIMARY KEY("user_id","day_key")
);
--> statement-breakpoint
CREATE TABLE "user_kyc_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"invited_at" integer,
	"invited_by_admin_id" integer,
	"invite_note" text,
	"submitted_at" integer,
	"document_type" text,
	"document_number" text,
	"legal_first_name" text,
	"legal_last_name" text,
	"dob" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text,
	"id_document_ref" text,
	"reviewed_at" integer,
	"reviewed_by_admin_id" integer,
	"reviewer_note" text,
	"rejection_reason" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_login_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"email" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"failure_reason" text,
	"logout_at" integer,
	"session_length_sec" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"country_code" text,
	"region" text,
	"city" text,
	"latitude" real,
	"longitude" real,
	"session_id" text,
	"event_type" text,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text
);
--> statement-breakpoint
CREATE TABLE "user_mfa" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"totp_secret_enc" text,
	"totp_pending_secret_enc" text,
	"recovery_codes_hash_json" text,
	"recovery_codes_used_json" text,
	"enabled_at" integer,
	"disabled_at" integer,
	"last_verified_at" integer,
	"failed_attempts" integer DEFAULT 0,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_payout_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"preferred_payment_currency" text DEFAULT 'USD',
	"payout_method" text,
	"payout_details_json" text,
	"is_verified" boolean DEFAULT false,
	"verified_at" integer,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"ip" text,
	"user_agent" text,
	"device_type" text,
	"browser" text,
	"os" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"last_active_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"expires_at" integer,
	"device_fp" text,
	"device_install_id" text,
	"client_tz" text,
	"client_lang" text,
	"country_code" text,
	"region" text,
	"city" text,
	"latitude" real,
	"longitude" real,
	"inferred_tz" text,
	"revoked_at" integer,
	"revoked_by_user_id" integer,
	"revoke_reason" text,
	CONSTRAINT "user_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"leverage" real DEFAULT 50 NOT NULL,
	"max_concurrent" integer DEFAULT 5 NOT NULL,
	"max_concurrent_per_instrument" integer,
	"max_concurrent_lots" integer DEFAULT 50 NOT NULL,
	"min_hold_sec" integer DEFAULT 60 NOT NULL,
	"max_hold_sec" integer DEFAULT 86400 NOT NULL,
	"show_lb" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_verification" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"email_verified_at" integer,
	"email_initial_due_at" integer,
	"email_reverify_due_at" integer,
	"email_resend_day_key" text,
	"email_resend_count_day" integer DEFAULT 0,
	"email_last_resend_at" integer,
	"email_resend_day_start" integer,
	"phone_e164" text,
	"sms_verified_at" integer,
	"sms_send_day_key" text,
	"sms_send_count_day" integer DEFAULT 0,
	"sms_last_sent_at" integer,
	"sms_last_send_at" integer,
	"sms_send_day_start" integer,
	"sms_verify_fail_count" integer DEFAULT 0,
	"sms_otp_locked_until" integer,
	"sms_enabled" boolean DEFAULT false,
	"contender_tier" text DEFAULT 'NONE' NOT NULL,
	"contender_eligible_at" integer,
	"locked_at" integer,
	"lock_reason" text,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"updated_at" integer DEFAULT (extract(epoch from now())) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"first_name" text,
	"last_name" text,
	"display_name" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"balance" text DEFAULT '1000000.00' NOT NULL,
	"starting_equity" real DEFAULT 1000000,
	"created_at" integer DEFAULT (extract(epoch from now())) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"deletion_exempt" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"inactivated_at" integer,
	"deleted_at" integer,
	"deleted_mode" text,
	"deleted_reason" text,
	"deleted_by_admin_id" integer,
	"user_tier" text DEFAULT 'CANDIDATE' NOT NULL,
	"tier_promoted_at" integer,
	"tier_promoted_by" integer,
	"selected_at" integer,
	"leverage" real DEFAULT 5 NOT NULL,
	"used_margin" real DEFAULT 0 NOT NULL,
	"equity" real DEFAULT 0 NOT NULL,
	"free_margin" real DEFAULT 0 NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"freeze_reason_code" text,
	"freeze_reason_text" text,
	"frozen_at" integer,
	"frozen_by" integer,
	"timezone" text DEFAULT 'UTC',
	"language" text DEFAULT 'en',
	"country" text,
	"country_iso2" text,
	"region_key" text,
	"kyc_status" text DEFAULT 'none',
	"kyc_verified_at" integer,
	"kyc_expires_at" integer,
	"signup_ip" text,
	"signup_ip_hash" text,
	"signup_user_agent" text,
	"signup_country_code" text,
	"signup_region" text,
	"signup_city" text,
	"signup_latitude" real,
	"signup_longitude" real,
	"signup_device_type" text,
	"signup_browser" text,
	"signup_os" text,
	"signup_client_tz" text,
	"signup_inferred_tz" text,
	"signup_device_fp" text,
	"signup_device_install_id" text,
	"signup_client_lang" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "daily_fx_closes" ADD CONSTRAINT "daily_fx_closes_symbol_id_symbol_configs_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbol_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_global_doc_id_legal_documents_id_fk" FOREIGN KEY ("global_doc_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_addendum_id_legal_documents_id_fk" FOREIGN KEY ("addendum_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_doc_id_legal_documents_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_doc_change_audit_chain" ADD CONSTRAINT "legal_doc_change_audit_chain_old_active_document_id_legal_documents_id_fk" FOREIGN KEY ("old_active_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_doc_change_audit_chain" ADD CONSTRAINT "legal_doc_change_audit_chain_new_active_document_id_legal_documents_id_fk" FOREIGN KEY ("new_active_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_doc_pointers" ADD CONSTRAINT "legal_doc_pointers_active_document_id_legal_documents_id_fk" FOREIGN KEY ("active_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reaccept_requirements" ADD CONSTRAINT "legal_reaccept_requirements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reaccept_requirements" ADD CONSTRAINT "legal_reaccept_requirements_last_acceptance_id_legal_acceptances_id_fk" FOREIGN KEY ("last_acceptance_id") REFERENCES "public"."legal_acceptances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_audit" ADD CONSTRAINT "trade_audit_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_symbol_id_symbol_configs_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."symbol_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;