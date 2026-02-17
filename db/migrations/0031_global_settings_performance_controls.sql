ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS rest_fallback_poll_ms integer NOT NULL DEFAULT 500;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS ws_push_frequency_ms integer NOT NULL DEFAULT 0;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS quote_flush_interval_ms integer NOT NULL DEFAULT 50;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS max_ws_reconnect_attempts integer NOT NULL DEFAULT 30;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS ws_reconnect_base_delay_ms integer NOT NULL DEFAULT 1500;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_strategy text NOT NULL DEFAULT 'all';

UPDATE global_settings
SET
  rest_fallback_poll_ms = COALESCE(rest_fallback_poll_ms, 500),
  ws_push_frequency_ms = COALESCE(ws_push_frequency_ms, 0),
  quote_flush_interval_ms = COALESCE(quote_flush_interval_ms, 50),
  max_ws_reconnect_attempts = COALESCE(max_ws_reconnect_attempts, 30),
  ws_reconnect_base_delay_ms = COALESCE(ws_reconnect_base_delay_ms, 1500),
  prefetch_strategy = CASE
    WHEN prefetch_strategy IN ('all', 'critical', 'none') THEN prefetch_strategy
    ELSE 'all'
  END;
