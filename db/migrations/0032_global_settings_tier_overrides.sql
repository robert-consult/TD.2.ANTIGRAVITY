ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS poll_instant_ms integer NOT NULL DEFAULT 200;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS poll_fast_ms integer NOT NULL DEFAULT 500;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS poll_moderate_ms integer NOT NULL DEFAULT 1500;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS poll_constrained_ms integer NOT NULL DEFAULT 4000;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS poll_minimal_ms integer NOT NULL DEFAULT 6000;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS flush_instant_ms integer NOT NULL DEFAULT 50;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS flush_fast_ms integer NOT NULL DEFAULT 150;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS flush_moderate_ms integer NOT NULL DEFAULT 300;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS flush_constrained_ms integer NOT NULL DEFAULT 500;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS flush_minimal_ms integer NOT NULL DEFAULT 1000;

UPDATE global_settings
SET
  poll_instant_ms = COALESCE(poll_instant_ms, LEAST(GREATEST(rest_fallback_poll_ms, 100), 200)),
  poll_fast_ms = COALESCE(poll_fast_ms, LEAST(GREATEST(rest_fallback_poll_ms, 100), 500)),
  poll_moderate_ms = COALESCE(
    poll_moderate_ms,
    LEAST(GREATEST(GREATEST(rest_fallback_poll_ms, 1500), 1500), 6000)
  ),
  poll_constrained_ms = COALESCE(
    poll_constrained_ms,
    GREATEST((GREATEST(rest_fallback_poll_ms, 100) * 2), 4000)
  ),
  poll_minimal_ms = COALESCE(
    poll_minimal_ms,
    GREATEST((GREATEST(rest_fallback_poll_ms, 100) * 3), 6000)
  ),
  flush_instant_ms = COALESCE(flush_instant_ms, LEAST(GREATEST(quote_flush_interval_ms, 20), 50)),
  flush_fast_ms = COALESCE(
    flush_fast_ms,
    LEAST(GREATEST((GREATEST(quote_flush_interval_ms, 20) * 3), 60), 5000)
  ),
  flush_moderate_ms = COALESCE(
    flush_moderate_ms,
    LEAST(GREATEST((GREATEST(quote_flush_interval_ms, 20) * 6), 120), 5000)
  ),
  flush_constrained_ms = COALESCE(
    flush_constrained_ms,
    LEAST(GREATEST((GREATEST(quote_flush_interval_ms, 20) * 10), 200), 5000)
  ),
  flush_minimal_ms = COALESCE(
    flush_minimal_ms,
    LEAST(GREATEST((GREATEST(quote_flush_interval_ms, 20) * 20), 400), 5000)
  );
