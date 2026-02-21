ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_max_concurrency integer NOT NULL DEFAULT 4;

ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS prefetch_start_delay_ms integer NOT NULL DEFAULT 0;

UPDATE global_settings
SET
  prefetch_max_concurrency = LEAST(GREATEST(COALESCE(prefetch_max_concurrency, 4), 1), 6),
  prefetch_start_delay_ms = LEAST(GREATEST(COALESCE(prefetch_start_delay_ms, 0), 0), 15000);
