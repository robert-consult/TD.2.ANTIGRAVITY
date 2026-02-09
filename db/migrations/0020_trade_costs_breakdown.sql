ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS gross_profit_usd real,
  ADD COLUMN IF NOT EXISTS net_profit_usd real,
  ADD COLUMN IF NOT EXISTS notional_usd real,
  ADD COLUMN IF NOT EXISTS total_costs_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_commission_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_commission_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS open_other_fees_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_other_fees_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financing_accrued_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swap_accrued_usd real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overnight_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category_snapshot text,
  ADD COLUMN IF NOT EXISTS cost_model_version text;

UPDATE trades t
SET
  notional_usd = COALESCE(t.notional_usd, CASE WHEN t.size IS NOT NULL AND t.size > 0 THEN t.size::real ELSE COALESCE(t.lots, 1) * 100000.0 END),
  category_snapshot = COALESCE(t.category_snapshot, sc.category),
  net_profit_usd = COALESCE(
    t.net_profit_usd,
    CASE
      WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
      WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
      ELSE NULL
    END
  ),
  gross_profit_usd = COALESCE(
    t.gross_profit_usd,
    CASE
      WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN NULL
      WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::real
      ELSE NULL
    END
  ),
  cost_model_version = COALESCE(t.cost_model_version, 'v2026_02_08_global_swap10')
FROM symbol_configs sc
WHERE sc.id = t.symbol_id;
