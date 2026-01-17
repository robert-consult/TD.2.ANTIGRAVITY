CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '10000.00',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    is_admin INTEGER NOT NULL DEFAULT 0
  , is_disabled INTEGER NOT NULL DEFAULT 0, is_frozen INTEGER NOT NULL DEFAULT 0, freeze_reason_code TEXT, freeze_reason_text TEXT, frozen_at INTEGER, frozen_by INTEGER, name TEXT, phone TEXT, timezone TEXT DEFAULT 'UTC', language TEXT DEFAULT 'en', country TEXT, kyc_status TEXT DEFAULT 'none', kyc_verified_at INTEGER, kyc_expires_at INTEGER, first_name TEXT, last_name TEXT, display_name TEXT, starting_equity REAL DEFAULT 1000000, user_tier TEXT NOT NULL DEFAULT 'CANDIDATE', tier_promoted_at INTEGER, tier_promoted_by INTEGER, selected_at INTEGER, country_iso2 TEXT, region_key TEXT, signup_ip TEXT, signup_ip_hash TEXT, signup_user_agent TEXT, signup_country_code TEXT, signup_region TEXT, signup_city TEXT, signup_latitude REAL, signup_longitude REAL, signup_device_type TEXT, signup_browser TEXT, signup_os TEXT, signup_client_tz TEXT, signup_inferred_tz TEXT, signup_device_fp TEXT, signup_device_install_id TEXT, signup_client_lang TEXT, leverage REAL DEFAULT 50, used_margin REAL DEFAULT 0, equity REAL, free_margin REAL, margin_level REAL, currency TEXT DEFAULT "USD", deletion_exempt INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0, inactivated_at INTEGER, deleted_at INTEGER, deleted_mode TEXT, deleted_reason TEXT, deleted_by_admin_id INTEGER);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE symbol_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    spread REAL NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    min_lot INTEGER NOT NULL DEFAULT 1000,
    max_lot INTEGER NOT NULL DEFAULT 100000,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  , min_spread_pips REAL DEFAULT 0.1, max_spread_pips REAL DEFAULT 10, pip_value REAL DEFAULT 0.0001, category TEXT DEFAULT "forex", tick_size REAL DEFAULT 0.00001, contract_size INTEGER DEFAULT 100000, margin_percent REAL DEFAULT 2.0, trading_hours TEXT, session_pattern TEXT, rollover_time TEXT DEFAULT "17:00", rollover_tz TEXT DEFAULT "America/New_York");
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    open_price REAL NOT NULL,
    close_price REAL,
    take_profit REAL,
    stop_loss REAL,
    profit TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    closed_at INTEGER, close_reason TEXT, close_quote_ts INTEGER, close_source TEXT, close_bid REAL, close_ask REAL, close_mid REAL, close_spread REAL, correlation_id TEXT, order_id TEXT, position_id TEXT, last_execution_id TEXT, last_actor_user_id INTEGER, last_actor_session_id TEXT, last_actor_ip TEXT, last_actor_user_agent TEXT, last_actor_type TEXT DEFAULT 'USER', last_actor_device_id TEXT, order_type TEXT DEFAULT "MARKET", pending_price REAL, time_in_force TEXT DEFAULT "GTC", expires_at INTEGER, lots REAL, limit_price REAL, trigger_price REAL, filled_at INTEGER, cancelled_at INTEGER, cancel_reason TEXT, expire_action TEXT, swap_total REAL DEFAULT 0, commission REAL DEFAULT 0, pnl_pips REAL, max_pips REAL, min_pips REAL, entry_price REAL, exit_price REAL, margin_used REAL, stop_price REAL, take_profit_price REAL, trailing_stop REAL, trailing_stop_distance REAL, pip_value REAL, expiry_time INTEGER, is_pending INTEGER DEFAULT 0, executed_at INTEGER, execution_price REAL, slippage REAL, filled_size REAL, remaining_size REAL, avg_fill_price REAL, triggered_at INTEGER, trigger_type TEXT, stop_triggered INTEGER DEFAULT 0, tp_triggered INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (symbol_id) REFERENCES symbol_configs (id)
  );
CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY,
    leverage REAL NOT NULL DEFAULT 50,
    max_concurrent INTEGER NOT NULL DEFAULT 5,
    min_hold_sec INTEGER NOT NULL DEFAULT 60,
    max_hold_sec INTEGER NOT NULL DEFAULT 86400,
    show_lb INTEGER NOT NULL DEFAULT 1, max_concurrent_lots INTEGER NOT NULL DEFAULT 50, max_concurrent_per_instrument INTEGER,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );
CREATE TABLE global_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    default_leverage REAL NOT NULL DEFAULT 50,
    max_position_size REAL NOT NULL DEFAULT 100000,
    max_trades_per_user INTEGER NOT NULL DEFAULT 5,
    max_trades_per_instrument INTEGER NOT NULL DEFAULT 3,
    max_concurrent_lots INTEGER NOT NULL DEFAULT 50,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
  , market_open_time TEXT NOT NULL DEFAULT '09:00', market_close_time TEXT NOT NULL DEFAULT '17:00', allow_weekend_trading INTEGER NOT NULL DEFAULT 0, enable_auto_close INTEGER NOT NULL DEFAULT 1, auto_close_after_days INTEGER NOT NULL DEFAULT 4, auto_close_check_frequency_minutes INTEGER NOT NULL DEFAULT 60, min_hold_sec INTEGER NOT NULL DEFAULT 60, enable_loss_limits INTEGER NOT NULL DEFAULT 1, daily_loss_limit_pct REAL NOT NULL DEFAULT 10, lifetime_loss_limit_pct REAL NOT NULL DEFAULT 20, trading_halt INTEGER NOT NULL DEFAULT 0, close_only_mode INTEGER NOT NULL DEFAULT 0, block_open_on_stale_quotes INTEGER NOT NULL DEFAULT 1, maintenance_message TEXT DEFAULT 'System is under maintenance.', quote_refresh_ms INTEGER NOT NULL DEFAULT 870, feed_poll_ms INTEGER NOT NULL DEFAULT 870, stale_threshold_ms INTEGER NOT NULL DEFAULT 30000);
CREATE TABLE system_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    maintenance_mode INTEGER NOT NULL DEFAULT 0,
    trading_halt INTEGER NOT NULL DEFAULT 0,
    close_only_mode INTEGER NOT NULL DEFAULT 0,
    block_open_on_stale_quotes INTEGER NOT NULL DEFAULT 1,
    maintenance_message TEXT DEFAULT 'System is under maintenance. Trading will resume shortly.',
    quote_refresh_ms INTEGER NOT NULL DEFAULT 870,
    feed_poll_ms INTEGER NOT NULL DEFAULT 870,
    stale_threshold_ms INTEGER NOT NULL DEFAULT 30000,
    fx_rollover_tz TEXT NOT NULL DEFAULT 'America/New_York',
    fx_rollover_time TEXT NOT NULL DEFAULT '17:00',
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_by TEXT
  , policy_contender_path1_min_age_days INTEGER NOT NULL DEFAULT 30, policy_contender_path1_min_trades_lifetime INTEGER NOT NULL DEFAULT 30, policy_contender_path1_min_balance_pct REAL NOT NULL DEFAULT 1.2, policy_contender_path2_min_age_days INTEGER NOT NULL DEFAULT 90, policy_contender_path2_min_trades_last90 INTEGER NOT NULL DEFAULT 20, policy_contender_path2_min_return_last90 REAL NOT NULL DEFAULT 0.1, policy_contender_path2_max_days_since_last_trade INTEGER NOT NULL DEFAULT 14, policy_auto_promote_performer INTEGER NOT NULL DEFAULT 1, policy_email_resend_cooldown_sec INTEGER NOT NULL DEFAULT 60, policy_email_daily_send_cap INTEGER NOT NULL DEFAULT 5, policy_sms_daily_send_cap INTEGER NOT NULL DEFAULT 5, policy_sms_resend_cooldown_sec INTEGER NOT NULL DEFAULT 60, policy_otp_max_attempts INTEGER NOT NULL DEFAULT 5, policy_otp_lock_minutes INTEGER NOT NULL DEFAULT 30, legal_coverage_enforce INTEGER NOT NULL DEFAULT 0, jurisdiction_restricted_iso2_csv TEXT NOT NULL DEFAULT 'KP,IR,CU,SY', jurisdiction_restricted_message TEXT NOT NULL DEFAULT 'This jurisdiction is not supported due to regulatory restrictions.', signup_captcha_enforce INTEGER NOT NULL DEFAULT 1, captcha_provider TEXT NOT NULL DEFAULT 'SLIDER', signup_phone_enforce INTEGER NOT NULL DEFAULT 0, allow_user_timezone_edit INTEGER NOT NULL DEFAULT 1, signup_freeze INTEGER NOT NULL DEFAULT 0, signup_freeze_message TEXT NOT NULL DEFAULT 'Signups are temporarily paused due to capacity. Existing users can still log in.', signup_waitlist_enabled INTEGER NOT NULL DEFAULT 1, signup_waitlist_invite_sender TEXT NOT NULL DEFAULT 'TradeQuip <noreply@tradequip.com>', signup_waitlist_invite_subject TEXT NOT NULL DEFAULT 'Signup slots are open again', signup_waitlist_invite_body_text TEXT NOT NULL DEFAULT 'Hello {{name}},

Signup slots are open again. Please register here: {{signup_link}}

If you did not request an invite, you can ignore this message.', signup_waitlist_auto_invite_on_unfreeze INTEGER NOT NULL DEFAULT 0, signup_waitlist_invite_batch_cap INTEGER NOT NULL DEFAULT 200, signup_waitlist_policy_version TEXT NOT NULL DEFAULT '1', signup_waitlist_policy_content TEXT NOT NULL DEFAULT 'WAITLIST COMMUNICATIONS & PRIVACY NOTICE

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
- You can opt out by replying to an invite email or contacting support.', i18n_enabled INTEGER NOT NULL DEFAULT 1, i18n_default_locale TEXT NOT NULL DEFAULT 'en', i18n_supported_locales_csv TEXT NOT NULL DEFAULT 'en,fr,pt,es,de,ar,hi,id,zh,ms,tl,ko,ja,sw,th,bn,tr', i18n_auto_translate INTEGER NOT NULL DEFAULT 1, i18n_llm_enabled INTEGER NOT NULL DEFAULT 1, i18n_llm_provider TEXT NOT NULL DEFAULT 'openai', i18n_llm_model TEXT NOT NULL DEFAULT 'gpt-4o-mini', i18n_llm_max_batch_size INTEGER NOT NULL DEFAULT 50, i18n_llm_max_attempts INTEGER NOT NULL DEFAULT 3, inactivity_threshold_days INTEGER NOT NULL DEFAULT 90, deletion_grace_days INTEGER NOT NULL DEFAULT 30, activity_auto_queue_inactive INTEGER NOT NULL DEFAULT 1, activity_auto_soft_delete INTEGER NOT NULL DEFAULT 0, bot_score_threshold INTEGER NOT NULL DEFAULT 40, bot_pow_enabled INTEGER NOT NULL DEFAULT 1, bot_pow_enforce_signup INTEGER NOT NULL DEFAULT 1, bot_pow_enforce_login INTEGER NOT NULL DEFAULT 0, bot_pow_challenge_score INTEGER NOT NULL DEFAULT 25, bot_pow_base_difficulty INTEGER NOT NULL DEFAULT 14, bot_pow_max_difficulty INTEGER NOT NULL DEFAULT 20, bot_pow_ttl_sec INTEGER NOT NULL DEFAULT 120, bot_valkey_enabled INTEGER NOT NULL DEFAULT 1, migration_chunking_enabled INTEGER NOT NULL DEFAULT 0, migration_chunk_size_mb INTEGER NOT NULL DEFAULT 51200, jurisdiction_enforce_by_ip_geo INTEGER NOT NULL DEFAULT 0, jurisdiction_enforce_by_signup_country INTEGER NOT NULL DEFAULT 1, jurisdiction_block_signup INTEGER NOT NULL DEFAULT 1, jurisdiction_block_login INTEGER NOT NULL DEFAULT 1);
CREATE TABLE trade_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        event_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        requested_price REAL,
        trigger_price REAL,
        fill_price REAL,
        slippage REAL,
        quote_ts INTEGER,
        quote_source TEXT,
        quote_bid REAL,
        quote_ask REAL,
        quote_mid REAL,
        quote_spread REAL,
        note TEXT, event_category TEXT NOT NULL DEFAULT 'TRADE', event_at_ms INTEGER, correlation_id TEXT, order_id TEXT, execution_id TEXT, position_id TEXT, actor_type TEXT NOT NULL DEFAULT 'SYSTEM', actor_user_id INTEGER, session_id TEXT, ip TEXT, user_agent TEXT, symbol TEXT, side TEXT, order_type TEXT, time_in_force TEXT, qty_lots REAL, limit_price REAL, stop_price REAL, avg_fill_price REAL, spread_pips REAL, slippage_pips REAL, slippage_reference TEXT, latency_ms INTEGER, risk_check_name TEXT, risk_limit_value REAL, risk_observed_value REAL, risk_result TEXT, reason_code TEXT, payload_json TEXT, prev_hash TEXT, event_hash TEXT,
        FOREIGN KEY(trade_id) REFERENCES trades(id)
      );
CREATE INDEX idx_trade_audit_trade_id ON trade_audit(trade_id);
CREATE INDEX idx_trade_audit_event_at ON trade_audit(event_at);
CREATE INDEX idx_trade_audit_correlation ON trade_audit(correlation_id);
CREATE INDEX idx_trade_audit_event_type ON trade_audit(event_type);
CREATE INDEX idx_trade_audit_risk_result ON trade_audit(risk_result);
CREATE TABLE order_intent_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        event_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        event_at_ms INTEGER,
        event_code TEXT NOT NULL,
        decision TEXT,
        reject_check TEXT,
        reject_reason TEXT,
        actor_type TEXT NOT NULL DEFAULT 'USER',
        user_id INTEGER NOT NULL,
        session_id TEXT,
        ip TEXT,
        user_agent TEXT,
        symbol TEXT,
        side TEXT,
        order_type TEXT,
        time_in_force TEXT,
        qty_lots REAL,
        requested_price REAL,
        limit_price REAL,
        stop_price REAL,
        take_profit REAL,
        stop_loss REAL,
        quote_bid REAL,
        quote_ask REAL,
        quote_mid REAL,
        quote_ts INTEGER,
        quote_is_stale INTEGER,
        risk_limit_json TEXT,
        risk_observed_json TEXT,
        risk_snapshot_json TEXT,
        payload_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL
      );
CREATE INDEX idx_order_intent_correlation ON order_intent_audit(correlation_id);
CREATE INDEX idx_order_intent_user ON order_intent_audit(user_id);
CREATE INDEX idx_order_intent_event ON order_intent_audit(event_code);
CREATE INDEX idx_order_intent_decision ON order_intent_audit(decision);
CREATE TABLE market_daily_close (
        symbol TEXT NOT NULL,
        session_day TEXT NOT NULL,
        close REAL NOT NULL,
        close_ts_ms INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (symbol, session_day)
      );
CREATE INDEX idx_mdc_symbol_day ON market_daily_close(symbol, session_day);
CREATE TABLE user_login_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        email TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        failure_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), logout_at INTEGER, session_length_sec INTEGER, device_fp TEXT, device_install_id TEXT, client_tz TEXT, client_lang TEXT, country_code TEXT, region TEXT, city TEXT, latitude REAL, longitude REAL, session_id TEXT, event_type TEXT DEFAULT 'LOGIN_SUCCESS',
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
CREATE INDEX idx_user_login_history_user_id_created_at ON user_login_history(user_id, created_at);
CREATE TABLE user_account_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        reason_code TEXT,
        reason_text TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (admin_id) REFERENCES users(id)
      );
CREATE INDEX idx_user_account_events_user_id_created_at ON user_account_events(user_id, created_at);
CREATE TABLE user_admin_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER,
        type TEXT NOT NULL DEFAULT 'NOTE',
        severity TEXT NOT NULL DEFAULT 'INFO',
        flag_code TEXT,
        content TEXT NOT NULL,
        is_resolved INTEGER NOT NULL DEFAULT 0,
        resolved_at INTEGER,
        resolved_by_admin_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (admin_id) REFERENCES users(id)
      );
CREATE INDEX idx_user_admin_notes_user_id ON user_admin_notes(user_id);
CREATE INDEX idx_user_admin_notes_created_at ON user_admin_notes(created_at);
CREATE TABLE trader_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        trade_id INTEGER,
        note TEXT NOT NULL,
        mood TEXT,
        tags TEXT,
        attachment_url TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      , trade_ids TEXT);
CREATE INDEX idx_trader_journal_user_id ON trader_journal(user_id);
CREATE INDEX idx_trader_journal_created_at ON trader_journal(created_at);
CREATE TABLE admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        action_type TEXT NOT NULL,
        metadata TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE INDEX idx_admin_actions_admin_id ON admin_actions(admin_id);
CREATE INDEX idx_admin_actions_user_id ON admin_actions(user_id);
CREATE INDEX idx_admin_actions_action_type ON admin_actions(action_type);
CREATE TABLE user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        device_type TEXT,
        browser TEXT,
        os TEXT,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_active_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER
      , device_fp TEXT, device_install_id TEXT, client_tz TEXT, client_lang TEXT, country_code TEXT, region TEXT, city TEXT, latitude REAL, longitude REAL, inferred_tz TEXT, revoked_at INTEGER, revoked_by_user_id INTEGER, revoke_reason TEXT);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX idx_user_sessions_device_fp ON user_sessions(device_fp);
CREATE INDEX idx_user_sessions_device_install_id ON user_sessions(device_install_id);
CREATE INDEX idx_login_history_device_fp ON user_login_history(device_fp);
CREATE INDEX idx_login_history_device_install_id ON user_login_history(device_install_id);
CREATE INDEX idx_trades_correlation_id ON trades(correlation_id);
CREATE INDEX idx_trades_order_id ON trades(order_id);
CREATE INDEX idx_trades_position_id ON trades(position_id);
CREATE INDEX idx_trades_last_execution_id ON trades(last_execution_id);
CREATE INDEX idx_trades_device_id ON trades(last_actor_device_id);
CREATE TABLE audit_export_manifest (
        export_id TEXT PRIMARY KEY,
        exported_at_utc_ms INTEGER NOT NULL,
        export_type TEXT NOT NULL,
        export_format TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      );
CREATE INDEX idx_aem_type_time ON audit_export_manifest(export_type, exported_at_utc_ms);
CREATE TABLE migration_export_jobs (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        user_id INTEGER,
        since_ts INTEGER,
        requested_by_admin_id INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        totals_json TEXT NOT NULL DEFAULT '{}',
        manifest_json TEXT NOT NULL DEFAULT '{}',
        manifest_sha256 TEXT,
        data_sha256 TEXT,
        data_path TEXT,
        manifest_path TEXT,
        error TEXT
      , data_parts_json TEXT, chunking_enabled INTEGER, chunk_size_mb INTEGER);
CREATE TABLE migration_import_jobs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        id_strategy TEXT NOT NULL DEFAULT 'PRESERVE',
        requested_by_admin_id INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        manifest_sha256 TEXT,
        data_sha256 TEXT,
        data_path TEXT,
        manifest_path TEXT,
        totals_json TEXT NOT NULL DEFAULT '{}',
        error TEXT
      , data_parts_json TEXT);
CREATE TABLE migration_job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}'
      );
CREATE TABLE migration_id_map (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        legacy_id TEXT NOT NULL,
        new_id TEXT NOT NULL
      );
CREATE TABLE migration_integrity_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        chain_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        status TEXT NOT NULL,
        failure_reason TEXT,
        verified_at INTEGER NOT NULL
      );
CREATE INDEX idx_migration_export_jobs_created_at ON migration_export_jobs(created_at);
CREATE INDEX idx_migration_export_jobs_status ON migration_export_jobs(status);
CREATE INDEX idx_migration_import_jobs_created_at ON migration_import_jobs(created_at);
CREATE INDEX idx_migration_import_jobs_status ON migration_import_jobs(status);
CREATE INDEX idx_migration_job_logs_job_id ON migration_job_logs(job_id);
CREATE INDEX idx_migration_id_map_job_id ON migration_id_map(job_id);
CREATE INDEX idx_migration_integrity_job_id ON migration_integrity_checks(job_id);
CREATE TABLE user_verification (
        user_id INTEGER PRIMARY KEY NOT NULL,
        email_verified_at INTEGER,
        email_initial_due_at INTEGER,
        email_reverify_due_at INTEGER,
        email_resend_day_key TEXT,
        email_resend_count_day INTEGER DEFAULT 0,
        email_last_resend_at INTEGER,
        email_resend_day_start INTEGER,
        phone_e164 TEXT,
        sms_verified_at INTEGER,
        sms_send_day_key TEXT,
        sms_send_count_day INTEGER DEFAULT 0,
        sms_last_sent_at INTEGER,
        sms_last_send_at INTEGER,
        sms_send_day_start INTEGER,
        sms_verify_fail_count INTEGER DEFAULT 0,
        sms_enabled INTEGER DEFAULT 0,
        contender_tier TEXT NOT NULL DEFAULT 'NONE',
        contender_eligible_at INTEGER,
        locked_at INTEGER,
        lock_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      , sms_otp_locked_until INTEGER);
CREATE TABLE email_verification_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'VERIFY',
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE INDEX idx_evt_user ON email_verification_tokens(user_id);
CREATE INDEX idx_evt_token ON email_verification_tokens(token_hash);
CREATE TABLE sms_otp_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        phone_e164 TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE INDEX idx_sms_otp_user ON sms_otp_tokens(user_id);
CREATE INDEX idx_sms_otp_phone ON sms_otp_tokens(phone_e164);
CREATE INDEX idx_sms_otp_expires ON sms_otp_tokens(expires_at);
CREATE TABLE user_equity_daily (
        user_id INTEGER NOT NULL,
        day_key TEXT NOT NULL,
        equity REAL NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (user_id, day_key)
      );
CREATE INDEX idx_user_equity_daily_user ON user_equity_daily(user_id);
CREATE INDEX idx_user_equity_daily_day ON user_equity_daily(day_key);
CREATE TABLE user_mfa (
        user_id INTEGER PRIMARY KEY NOT NULL,
        totp_secret_enc TEXT,
        totp_pending_secret_enc TEXT,
        recovery_codes_hash_json TEXT,
        recovery_codes_used_json TEXT,
        enabled_at INTEGER,
        disabled_at INTEGER,
        last_verified_at INTEGER,
        failed_attempts INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE user_kyc_profiles (
        user_id INTEGER PRIMARY KEY NOT NULL,
        status TEXT NOT NULL DEFAULT 'NOT_STARTED',
        invited_at INTEGER,
        invited_by_admin_id INTEGER,
        invite_note TEXT,
        submitted_at INTEGER,
        document_type TEXT,
        document_number TEXT,
        reviewed_at INTEGER,
        reviewed_by_admin_id INTEGER,
        reviewer_note TEXT,
        rejection_reason TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      , legal_first_name TEXT, legal_last_name TEXT, dob TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, region TEXT, postal_code TEXT, country TEXT, id_document_ref TEXT);
CREATE TABLE user_payout_profiles (
        user_id INTEGER PRIMARY KEY NOT NULL,
        preferred_payment_currency TEXT DEFAULT 'USD',
        payout_method TEXT,
        payout_details_json TEXT,
        is_verified INTEGER DEFAULT 0,
        verified_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE identity_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        user_id INTEGER,
        email TEXT,
        username TEXT,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        description TEXT,
        ip TEXT,
        user_agent TEXT,
        actor_admin_id INTEGER,
        actor_type TEXT,
        actor_user_id INTEGER,
        session_id TEXT,
        correlation_id TEXT,
        data_json TEXT,
        prev_hash TEXT,
        event_hash TEXT NOT NULL
      );
CREATE INDEX idx_identity_audit_user ON identity_audit(user_id);
CREATE INDEX idx_identity_audit_category ON identity_audit(category);
CREATE INDEX idx_identity_audit_type ON identity_audit(type);
CREATE INDEX idx_identity_audit_at ON identity_audit(at);
CREATE INDEX idx_identity_audit_correlation ON identity_audit(correlation_id);
CREATE TABLE grift_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        multi_account_window_days INTEGER NOT NULL DEFAULT 30,
        churn_window_hours INTEGER NOT NULL DEFAULT 24,
        hedge_window_minutes INTEGER NOT NULL DEFAULT 10,
        concurrent_window_minutes INTEGER NOT NULL DEFAULT 15,
        ip_unique_threshold INTEGER NOT NULL DEFAULT 4,
        ua_unique_threshold INTEGER NOT NULL DEFAULT 3,
        device_unique_threshold INTEGER NOT NULL DEFAULT 3,
        asn_unique_threshold INTEGER NOT NULL DEFAULT 3,
        geo_velocity_kmh_threshold INTEGER NOT NULL DEFAULT 900,
        geo_velocity_min_distance_km INTEGER NOT NULL DEFAULT 800,
        geo_velocity_max_hours INTEGER NOT NULL DEFAULT 6,
        hedge_require_device_match INTEGER NOT NULL DEFAULT 1,
        hedge_allow_ip_match INTEGER NOT NULL DEFAULT 1,
        tier_med INTEGER NOT NULL DEFAULT 40,
        tier_high INTEGER NOT NULL DEFAULT 60,
        tier_critical INTEGER NOT NULL DEFAULT 80,
        score_multi_account_device INTEGER NOT NULL DEFAULT 35,
        score_multi_account_fingerprint INTEGER NOT NULL DEFAULT 25,
        score_hedge_pair INTEGER NOT NULL DEFAULT 55,
        score_ip_churn INTEGER NOT NULL DEFAULT 20,
        score_ua_churn INTEGER NOT NULL DEFAULT 15,
        score_device_churn INTEGER NOT NULL DEFAULT 20,
        score_geo_velocity INTEGER NOT NULL DEFAULT 30,
        score_concurrent_sessions INTEGER NOT NULL DEFAULT 25,
        score_asn_volatility INTEGER NOT NULL DEFAULT 15,
        score_shared_ip_asn_cluster INTEGER NOT NULL DEFAULT 40,
        score_multi_account_laddering INTEGER NOT NULL DEFAULT 50,
        cluster_min_users_for_ip_asn INTEGER NOT NULL DEFAULT 3,
        laddering_window_days INTEGER NOT NULL DEFAULT 7,
        laddering_min_sequence INTEGER NOT NULL DEFAULT 3,
        retention_observations_days INTEGER NOT NULL DEFAULT 180,
        retention_trade_observations_days INTEGER NOT NULL DEFAULT 180,
        retention_auth_events_days INTEGER NOT NULL DEFAULT 180,
        retention_ip_asn_cache_days INTEGER NOT NULL DEFAULT 365,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_by_admin_id INTEGER
      , mitigation_mfa INTEGER NOT NULL DEFAULT 10, mitigation_kyc_approved INTEGER NOT NULL DEFAULT 15, enforcement_freeze_threshold INTEGER NOT NULL DEFAULT 80, enforcement_disable_threshold INTEGER NOT NULL DEFAULT 100, enforcement_auto_freeze INTEGER NOT NULL DEFAULT 0, enforcement_auto_disable INTEGER NOT NULL DEFAULT 0);
CREATE TABLE grift_devices (
        device_id TEXT PRIMARY KEY,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        first_ip TEXT,
        first_geo_country TEXT,
        trust_level TEXT NOT NULL DEFAULT 'NEW',
        users_count INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );
CREATE INDEX idx_grift_devices_trust ON grift_devices(trust_level);
CREATE INDEX idx_grift_devices_users_count ON grift_devices(users_count);
CREATE TABLE grift_device_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        seen_count INTEGER NOT NULL DEFAULT 1,
        link_strength REAL NOT NULL DEFAULT 1.0
      );
CREATE INDEX idx_grift_device_users_device ON grift_device_users(device_id);
CREATE INDEX idx_grift_device_users_user ON grift_device_users(user_id);
CREATE INDEX idx_grift_device_users_device_seen ON grift_device_users(device_id, last_seen_at);
CREATE UNIQUE INDEX idx_grift_device_users_unique ON grift_device_users(device_id, user_id);
CREATE TABLE grift_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        rule_code TEXT NOT NULL,
        dedupe_key TEXT,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        points INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'OPEN',
        evidence_json TEXT,
        related_user_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        closed_at INTEGER,
        closed_by_admin_id INTEGER,
        closure_note TEXT
      , device_id TEXT, device_fp TEXT, device_install_id TEXT, client_tz TEXT, client_lang TEXT, ip TEXT, user_agent TEXT, geo_country TEXT, geo_region TEXT, geo_city TEXT, latitude REAL, longitude REAL, asn INTEGER, org TEXT, symbol TEXT, trade_id INTEGER);
CREATE INDEX idx_grift_signals_user ON grift_signals(user_id);
CREATE INDEX idx_grift_signals_status ON grift_signals(status);
CREATE INDEX idx_grift_signals_rule ON grift_signals(rule_code);
CREATE INDEX idx_grift_signals_user_created ON grift_signals(user_id, created_at);
CREATE INDEX idx_grift_signals_related_user ON grift_signals(related_user_id, created_at);
CREATE INDEX idx_grift_signals_rule_created ON grift_signals(rule_code, created_at);
CREATE UNIQUE INDEX idx_grift_signals_dedupe ON grift_signals(dedupe_key);
CREATE TABLE grift_identity_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_value TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT
      );
CREATE INDEX idx_grift_identity_user ON grift_identity_links(user_id);
CREATE INDEX idx_grift_identity_type_value ON grift_identity_links(link_type, link_value);
CREATE UNIQUE INDEX idx_grift_identity_unique ON grift_identity_links(user_id, link_type, link_value);
CREATE TABLE grift_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        rule_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        score INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        details_json TEXT,
        related_user_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        reviewed_at INTEGER,
        reviewed_by INTEGER,
        resolution_note TEXT
      );
CREATE INDEX idx_grift_alerts_user ON grift_alerts(user_id);
CREATE INDEX idx_grift_alerts_status ON grift_alerts(status);
CREATE INDEX idx_grift_alerts_severity ON grift_alerts(severity);
CREATE INDEX idx_grift_alerts_created ON grift_alerts(created_at);
CREATE TABLE grift_user_risk (
        user_id INTEGER PRIMARY KEY NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        risk_factors_json TEXT,
        last_evaluated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        manual_override TEXT,
        override_by INTEGER,
        override_at INTEGER,
        override_reason TEXT
      , enforcement_status TEXT DEFAULT 'ACTIVE', enforcement_at INTEGER, enforcement_by INTEGER, enforcement_reason TEXT);
CREATE TABLE grift_enforcement_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_status TEXT,
        new_status TEXT,
        admin_id INTEGER,
        reason TEXT,
        risk_score_at_action INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE INDEX idx_grift_enforcement_user ON grift_enforcement_log(user_id);
CREATE INDEX idx_grift_enforcement_action ON grift_enforcement_log(action);
CREATE INDEX idx_grift_enforcement_created ON grift_enforcement_log(created_at);
CREATE TABLE grift_linked_account_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a INTEGER NOT NULL,
        user_b INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_value TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        first_linked_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_confirmed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        metadata_json TEXT
      );
CREATE INDEX idx_grift_edges_user_a ON grift_linked_account_edges(user_a);
CREATE INDEX idx_grift_edges_user_b ON grift_linked_account_edges(user_b);
CREATE TABLE grift_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'SESSION_PING',
        session_id TEXT,
        device_id TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        client_tz TEXT,
        client_lang TEXT,
        ip TEXT,
        user_agent TEXT,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        observed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
CREATE INDEX idx_grift_obs_user ON grift_observations(user_id);
CREATE INDEX idx_grift_obs_device ON grift_observations(device_id);
CREATE INDEX idx_grift_obs_ip ON grift_observations(ip);
CREATE INDEX idx_grift_obs_user_ts ON grift_observations(user_id, observed_at);
CREATE INDEX idx_grift_obs_ip_ts ON grift_observations(ip, observed_at);
CREATE INDEX idx_grift_obs_device_ts ON grift_observations(device_id, observed_at);
CREATE INDEX idx_grift_obs_observed ON grift_observations(observed_at);
CREATE TABLE grift_trade_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        session_id TEXT,
        device_id TEXT,
        ip TEXT,
        user_agent TEXT,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        lots REAL NOT NULL,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        observed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      , device_fp TEXT, device_install_id TEXT, client_tz TEXT, client_lang TEXT);
CREATE INDEX idx_grift_trade_obs_user ON grift_trade_observations(user_id);
CREATE INDEX idx_grift_trade_obs_trade ON grift_trade_observations(trade_id);
CREATE INDEX idx_grift_trade_obs_symbol ON grift_trade_observations(symbol);
CREATE INDEX idx_grift_trade_obs_device ON grift_trade_observations(device_id);
CREATE INDEX idx_grift_trade_obs_observed ON grift_trade_observations(observed_at);
CREATE INDEX idx_grift_trade_obs_symbol_ts ON grift_trade_observations(symbol, observed_at);
CREATE INDEX idx_grift_trade_obs_user_ts ON grift_trade_observations(user_id, observed_at);
CREATE TABLE grift_ip_asn_cache (
        ip TEXT PRIMARY KEY,
        asn INTEGER,
        org TEXT,
        source TEXT,
        fetched_at INTEGER,
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        error TEXT,
        error_at INTEGER,
        next_retry_at INTEGER
      );
CREATE INDEX idx_grift_ip_asn_cache_last_seen ON grift_ip_asn_cache(last_seen_at);
CREATE INDEX idx_grift_ip_asn_cache_next_retry ON grift_ip_asn_cache(next_retry_at);
CREATE INDEX idx_grift_ip_asn_cache_asn ON grift_ip_asn_cache(asn);
CREATE TABLE grift_ip_asn_ranges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_version INTEGER NOT NULL,
        start_int INTEGER,
        end_int INTEGER,
        start_hex TEXT,
        end_hex TEXT,
        asn INTEGER,
        country TEXT,
        org TEXT
      );
CREATE INDEX idx_grift_ip_asn_ranges_v4_start ON grift_ip_asn_ranges(ip_version, start_int);
CREATE INDEX idx_grift_ip_asn_ranges_v6_start ON grift_ip_asn_ranges(ip_version, start_hex);
CREATE INDEX idx_grift_ip_asn_ranges_asn ON grift_ip_asn_ranges(asn);
CREATE TABLE grift_ip_asn_dataset_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        file_path TEXT NOT NULL,
        file_mtime_ms INTEGER NOT NULL,
        file_size INTEGER NOT NULL,
        imported_at INTEGER NOT NULL,
        row_count INTEGER NOT NULL,
        ipv4_count INTEGER NOT NULL,
        ipv6_count INTEGER NOT NULL
      );
CREATE TABLE grift_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'MEDIUM',
        created_by_admin_id INTEGER,
        assigned_admin_id INTEGER,
        resolution TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        closed_at INTEGER
      );
CREATE TABLE grift_case_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        signal_id INTEGER NOT NULL,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(case_id, signal_id)
      );
CREATE TABLE grift_case_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
CREATE TABLE grift_case_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_id INTEGER NOT NULL,
        added_by_admin_id INTEGER,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(case_id, link_type, link_id)
      );
CREATE INDEX idx_grift_case_links_case ON grift_case_links(case_id);
CREATE INDEX idx_grift_case_links_type ON grift_case_links(link_type, link_id);
CREATE TABLE grift_admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id INTEGER,
        payload_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        prev_hash TEXT,
        hash TEXT
      );
CREATE TABLE grift_user_scores (
        user_id INTEGER PRIMARY KEY,
        score_current INTEGER NOT NULL DEFAULT 0,
        score_7d INTEGER NOT NULL DEFAULT 0,
        score_30d INTEGER NOT NULL DEFAULT 0,
        tier TEXT NOT NULL DEFAULT 'LOW',
        devices_7d INTEGER NOT NULL DEFAULT 0,
        ips_7d INTEGER NOT NULL DEFAULT 0,
        user_agents_7d INTEGER NOT NULL DEFAULT 0,
        countries_7d INTEGER NOT NULL DEFAULT 0,
        asns_7d INTEGER NOT NULL DEFAULT 0,
        linked_accounts_30d INTEGER NOT NULL DEFAULT 0,
        hedge_pairs_7d INTEGER NOT NULL DEFAULT 0,
        open_signals_count INTEGER NOT NULL DEFAULT 0,
        last_evaluated_at INTEGER
      );
CREATE INDEX idx_grift_user_scores_current ON grift_user_scores(score_current);
CREATE INDEX idx_grift_user_scores_tier ON grift_user_scores(tier);
CREATE TABLE grift_user_enforcements (
        user_id INTEGER PRIMARY KEY,
        frozen_at INTEGER,
        frozen_by_admin_id INTEGER,
        disabled_at INTEGER,
        disabled_by_admin_id INTEGER,
        notes TEXT
      );
CREATE TABLE auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        event_type TEXT NOT NULL,
        session_id TEXT,
        device_id TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        client_tz TEXT,
        client_lang TEXT,
        ip TEXT,
        user_agent TEXT,
        geo_country TEXT,
        geo_region TEXT,
        geo_city TEXT,
        latitude REAL,
        longitude REAL,
        asn INTEGER,
        org TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        failure_reason TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );
CREATE INDEX idx_auth_events_user ON auth_events(user_id);
CREATE INDEX idx_auth_events_type ON auth_events(event_type);
CREATE INDEX idx_auth_events_device ON auth_events(device_id);
CREATE INDEX idx_auth_events_ip ON auth_events(ip);
CREATE INDEX idx_auth_events_created ON auth_events(created_at);
CREATE TABLE legal_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_set TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        jurisdiction_type TEXT NOT NULL,
        jurisdiction_key TEXT NOT NULL,
        version TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        content TEXT NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        created_by_admin_user_id INTEGER
      );
CREATE TABLE legal_doc_pointers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_set TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        jurisdiction_type TEXT NOT NULL,
        jurisdiction_key TEXT NOT NULL,
        active_document_id INTEGER,
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
        updated_by_admin_user_id INTEGER,
        FOREIGN KEY(active_document_id) REFERENCES legal_documents(id)
      );
CREATE TABLE legal_doc_change_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER,
        target_id INTEGER,
        action TEXT NOT NULL,
        changed_by TEXT,
        changed_at INTEGER,
        previous_value TEXT,
        new_value TEXT,
        reason TEXT
      );
CREATE TABLE legal_doc_change_audit_chain (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL,
        prev_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL,
        admin_user_id INTEGER,
        action TEXT NOT NULL,
        doc_set TEXT,
        doc_type TEXT,
        jurisdiction_type TEXT,
        jurisdiction_key TEXT,
        old_active_document_id INTEGER,
        new_active_document_id INTEGER,
        note TEXT,
        created_at_ms INTEGER NOT NULL,
        FOREIGN KEY(old_active_document_id) REFERENCES legal_documents(id),
        FOREIGN KEY(new_active_document_id) REFERENCES legal_documents(id)
      );
CREATE TABLE legal_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_seq INTEGER NOT NULL,
        prev_ledger_hash TEXT NOT NULL,
        ledger_hash TEXT NOT NULL,

        user_id INTEGER NOT NULL,
        email_at_acceptance TEXT NOT NULL,
        country_iso2 TEXT NOT NULL,
        region_key TEXT,

        global_doc_id INTEGER NOT NULL,
        global_doc_version TEXT NOT NULL,
        global_doc_sha256 TEXT NOT NULL,

        addendum_id INTEGER,
        addendum_version TEXT,
        addendum_sha256 TEXT,

        combined_text TEXT NOT NULL,
        combined_sha256 TEXT NOT NULL,

        accepted_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
        accepted_at_ms INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        session_id TEXT,

        terms_token TEXT NOT NULL,
        terms_token_verified INTEGER NOT NULL DEFAULT 0,

        prev_hash TEXT,
        record_hash TEXT,
        accepted_from_ip TEXT,
        accepted_user_agent TEXT, doc_id INTEGER, doc_version TEXT, doc_content_hash TEXT,

        FOREIGN KEY(global_doc_id) REFERENCES legal_documents(id),
        FOREIGN KEY(addendum_id) REFERENCES legal_documents(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
CREATE TABLE legal_reaccept_requirements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        doc_set TEXT NOT NULL,
        country_iso2 TEXT NOT NULL,
        region_key TEXT,
        required_combined_sha256 TEXT NOT NULL,
        last_accepted_combined_sha256 TEXT,
        last_acceptance_id INTEGER,
        detected_at_ms INTEGER NOT NULL,
        detected_by TEXT NOT NULL DEFAULT 'LOGIN',
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(last_acceptance_id) REFERENCES legal_acceptances(id)
      );
CREATE UNIQUE INDEX uq_legal_doc_pointers_target
      ON legal_doc_pointers(doc_set, doc_type, jurisdiction_type, jurisdiction_key);
CREATE UNIQUE INDEX uq_legal_doc_change_audit_chain_seq
      ON legal_doc_change_audit_chain(seq);
CREATE UNIQUE INDEX uq_legal_reaccept_requirements_user_doc_set
      ON legal_reaccept_requirements(user_id, doc_set);
CREATE INDEX idx_legal_reaccept_requirements_user_id
      ON legal_reaccept_requirements(user_id);
CREATE UNIQUE INDEX uq_legal_acceptances_ledger_seq
        ON legal_acceptances(ledger_seq);
CREATE INDEX idx_legal_acceptances_user_id ON legal_acceptances(user_id);
CREATE INDEX idx_legal_documents_sha ON legal_documents(sha256);
CREATE INDEX idx_legal_documents_target
      ON legal_documents(doc_set, doc_type, jurisdiction_type, jurisdiction_key);
CREATE INDEX idx_legal_doc_pointers_active_doc
      ON legal_doc_pointers(active_document_id);
CREATE TABLE signup_freeze_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        email_lower TEXT,
        username TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
CREATE INDEX idx_signup_freeze_attempts_email_lower ON signup_freeze_attempts(email_lower);
CREATE INDEX idx_signup_freeze_attempts_created_at ON signup_freeze_attempts(created_at);
CREATE TABLE signup_waitlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_lower TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'PUBLIC_WAITLIST',
        ip TEXT,
        user_agent TEXT,

        consented_at INTEGER NOT NULL,
        consent_doc_version TEXT NOT NULL,
        consent_doc_sha256 TEXT NOT NULL,
        consent_doc_content TEXT NOT NULL,
        consent_signature TEXT NOT NULL,
        prev_hash TEXT,
        record_hash TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'PENDING',

        invited_at INTEGER,
        invited_by_admin_id INTEGER,
        invite_send_count INTEGER NOT NULL DEFAULT 0,
        last_invite_sent_at INTEGER,
        last_invite_status TEXT,
        last_invite_error TEXT,
        last_invite_from TEXT,
        last_invite_subject TEXT,
        last_invite_body_sha256 TEXT,

        converted_at INTEGER,
        converted_user_id INTEGER,

        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
        updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
CREATE UNIQUE INDEX uq_signup_waitlist_email_lower ON signup_waitlist(email_lower);
CREATE INDEX idx_signup_waitlist_status ON signup_waitlist(status);
CREATE INDEX idx_signup_waitlist_created_at ON signup_waitlist(created_at);
CREATE TABLE signup_fingerprints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        request_id TEXT NOT NULL,
        
        ip TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        
        user_agent TEXT,
        device_type TEXT,
        browser TEXT,
        os TEXT,
        
        country_code TEXT,
        region TEXT,
        city TEXT,
        latitude REAL,
        longitude REAL,
        inferred_tz TEXT,
        
        client_tz TEXT,
        client_lang TEXT,
        device_fp TEXT,
        device_install_id TEXT,
        
        country_iso2_selected TEXT,
        region_key_selected TEXT,
        
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
CREATE UNIQUE INDEX idx_signup_fp_user_id ON signup_fingerprints(user_id);
CREATE INDEX idx_signup_fp_ip_hash ON signup_fingerprints(ip_hash);
CREATE INDEX idx_signup_fp_device_fp ON signup_fingerprints(device_fp);
CREATE TABLE daily_fx_closes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_id INTEGER NOT NULL,
        symbol_name TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        close_price REAL NOT NULL,
        bid_price REAL,
        ask_price REAL,
        source TEXT NOT NULL DEFAULT '1FORGE',
        rollover_tz TEXT NOT NULL,
        rollover_time TEXT NOT NULL,
        calculated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        created_by TEXT,
        FOREIGN KEY(symbol_id) REFERENCES symbol_configs(id)
      );
CREATE UNIQUE INDEX idx_daily_fx_closes_symbol_date ON daily_fx_closes(symbol_id, trade_date);
CREATE INDEX idx_daily_fx_closes_trade_date ON daily_fx_closes(trade_date);
CREATE INDEX idx_daily_fx_closes_symbol_name ON daily_fx_closes(symbol_name);
CREATE TABLE i18n_manifest_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        generated_at INTEGER,
        ingested_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        entry_count INTEGER NOT NULL DEFAULT 0
      );
CREATE TABLE i18n_source_strings (
        string_id TEXT PRIMARY KEY,
        default_text TEXT NOT NULL,
        checksum TEXT NOT NULL,
        file TEXT,
        kind TEXT,
        prop_name TEXT,
        line INTEGER,
        column INTEGER,
        first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_modified_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );
CREATE TABLE i18n_translations (
        string_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_checksum TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (string_id, locale),
        FOREIGN KEY (string_id) REFERENCES i18n_source_strings(string_id)
      );
CREATE TABLE i18n_translation_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        string_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        locked_at INTEGER,
        locked_by TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE (string_id, locale),
        FOREIGN KEY (string_id) REFERENCES i18n_source_strings(string_id)
      );
CREATE INDEX idx_i18n_jobs_status ON i18n_translation_jobs(status, updated_at);
CREATE INDEX idx_i18n_tr_locale ON i18n_translations(locale, updated_at);
CREATE VIEW vw_trader_stats AS
    SELECT 
      u.id AS user_id,
      u.username,
      u.email,
      COUNT(t.id) AS total_trades,
      ROUND(SUM(CASE WHEN t.profit > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(t.id), 0), 2) AS win_rate,
      ROUND(SUM(CAST(t.profit AS REAL)), 2) AS profit,
      ROUND(SUM(CAST(t.profit AS REAL)) * 100.0 / NULLIF(u.balance, 0), 2) AS profit_percent,
      ROUND(AVG((t.closed_at - t.opened_at) / 3600.0), 2) AS avg_hold_time,
      MAX(t.closed_at) AS last_trade_date
    FROM users u
    LEFT JOIN trades t ON u.id = t.user_id AND t.status = 'CLOSED'
    GROUP BY u.id;
CREATE TABLE daily_closes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      profit_day REAL,
      trades_closed INTEGER,
      trades_won INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
CREATE INDEX idx_daily_closes_user_date ON daily_closes(user_id, date);
CREATE TABLE quotes (
    symbol TEXT PRIMARY KEY,
    price REAL NOT NULL,
    bid REAL,
    ask REAL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_stale INTEGER DEFAULT 0,
    last_api_update INTEGER,
    source TEXT,
    mid REAL,
    spread REAL
  );
CREATE TABLE bot_risk_assessments (
        user_id INTEGER PRIMARY KEY,
        score INTEGER NOT NULL DEFAULT 0,
        label TEXT NOT NULL DEFAULT 'OK',
        signals_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
CREATE TABLE user_deletion_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'GRACE',
        reason TEXT NOT NULL DEFAULT 'INACTIVE',
        marked_at INTEGER NOT NULL,
        grace_expires_at INTEGER NOT NULL,
        last_active_at INTEGER,
        executed_at INTEGER,
        executed_by_admin_id INTEGER,
        note TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
CREATE INDEX idx_bot_risk_score ON bot_risk_assessments(score, updated_at);
CREATE INDEX idx_user_deletion_queue_status ON user_deletion_queue(status, grace_expires_at);
CREATE INDEX idx_user_deletion_queue_grace ON user_deletion_queue(grace_expires_at);
CREATE TABLE signup_jurisdiction_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        email_lower TEXT,
        username TEXT,
        ip TEXT,
        user_agent TEXT,
        ip_country_iso2 TEXT,
        selected_country_iso2 TEXT,
        reason_code TEXT NOT NULL,
        policy_snapshot_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
      );
CREATE INDEX idx_signup_jurisdiction_blocks_email_lower ON signup_jurisdiction_blocks(email_lower);
CREATE INDEX idx_signup_jurisdiction_blocks_created_at ON signup_jurisdiction_blocks(created_at);
CREATE UNIQUE INDEX idx_grift_edges_unique ON grift_linked_account_edges(user_a, user_b, link_type, link_value);
