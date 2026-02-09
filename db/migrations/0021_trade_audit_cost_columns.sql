ALTER TABLE trade_audit
  ADD COLUMN IF NOT EXISTS notional_usd real,
  ADD COLUMN IF NOT EXISTS gross_profit_usd real,
  ADD COLUMN IF NOT EXISTS net_profit_usd real,
  ADD COLUMN IF NOT EXISTS total_costs_usd real,
  ADD COLUMN IF NOT EXISTS open_commission_usd real,
  ADD COLUMN IF NOT EXISTS close_commission_usd real,
  ADD COLUMN IF NOT EXISTS open_other_fees_usd real,
  ADD COLUMN IF NOT EXISTS close_other_fees_usd real,
  ADD COLUMN IF NOT EXISTS financing_accrued_usd real,
  ADD COLUMN IF NOT EXISTS swap_accrued_usd real,
  ADD COLUMN IF NOT EXISTS overnight_days integer,
  ADD COLUMN IF NOT EXISTS category_snapshot text,
  ADD COLUMN IF NOT EXISTS cost_model_version text;

CREATE OR REPLACE VIEW vw_trader_stats AS
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  COUNT(t.id) AS total_trades,
  ROUND(
    SUM(
      CASE
        WHEN COALESCE(
          t.net_profit_usd::numeric,
          CASE
            WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
            WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
            ELSE 0::numeric
          END
        ) > 0
          THEN 1
        ELSE 0
      END
    ) * 100.0 / NULLIF(COUNT(t.id), 0),
    2
  ) AS win_rate,
  ROUND(
    SUM(
      COALESCE(
        t.net_profit_usd::numeric,
        CASE
          WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
          WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
          ELSE 0::numeric
        END
      )
    ),
    2
  ) AS profit,
  ROUND(
    SUM(
      COALESCE(
        t.net_profit_usd::numeric,
        CASE
          WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
          WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
          ELSE 0::numeric
        END
      )
    ) * 100.0 / NULLIF((u.balance)::numeric, 0),
    2
  ) AS profit_percent,
  ROUND(AVG((t.closed_at - t.opened_at) / 3600.0)::numeric, 2) AS avg_hold_time,
  MAX(t.closed_at) AS last_trade_date
FROM users u
LEFT JOIN trades t ON u.id = t.user_id AND t.status = 'CLOSED'
GROUP BY u.id;
