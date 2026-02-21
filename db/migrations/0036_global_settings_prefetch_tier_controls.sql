ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_fast_concurrency_cap integer NOT NULL DEFAULT 3;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_moderate_concurrency_cap integer NOT NULL DEFAULT 2;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_constrained_concurrency_cap integer NOT NULL DEFAULT 1;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_network_fast_start_delay_ms integer NOT NULL DEFAULT 75;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_network_moderate_start_delay_ms integer NOT NULL DEFAULT 200;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_network_constrained_start_delay_ms integer NOT NULL DEFAULT 450;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_device_moderate_start_delay_ms integer NOT NULL DEFAULT 50;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_device_constrained_start_delay_ms integer NOT NULL DEFAULT 150;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_device_minimal_start_delay_ms integer NOT NULL DEFAULT 300;

UPDATE global_settings
SET
  prefetch_fast_concurrency_cap = LEAST(GREATEST(COALESCE(prefetch_fast_concurrency_cap, 3), 1), 6),
  prefetch_moderate_concurrency_cap = LEAST(GREATEST(COALESCE(prefetch_moderate_concurrency_cap, 2), 1), 6),
  prefetch_constrained_concurrency_cap = LEAST(GREATEST(COALESCE(prefetch_constrained_concurrency_cap, 1), 1), 6),
  prefetch_network_fast_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_network_fast_start_delay_ms, 75), 0), 15000),
  prefetch_network_moderate_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_network_moderate_start_delay_ms, 200), 0), 15000),
  prefetch_network_constrained_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_network_constrained_start_delay_ms, 450), 0), 15000),
  prefetch_device_moderate_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_device_moderate_start_delay_ms, 50), 0), 15000),
  prefetch_device_constrained_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_device_constrained_start_delay_ms, 150), 0), 15000),
  prefetch_device_minimal_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_device_minimal_start_delay_ms, 300), 0), 15000);
