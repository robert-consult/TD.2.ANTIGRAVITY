export const LEGACY_TRADE_PROFIT_NUMERIC_SQL = `
  CASE
    WHEN t.profit IS NULL OR btrim(t.profit) = '' THEN 0::numeric
    WHEN t.profit ~ '^-?\\d+(\\.\\d+)?$' THEN t.profit::numeric
    ELSE 0::numeric
  END
`;

export const TRADE_NET_PROFIT_SQL = `
  COALESCE(
    t.net_profit_usd::numeric,
    ${LEGACY_TRADE_PROFIT_NUMERIC_SQL}
  )
`;

export const TRADER_SCOUT_CATEGORY_SQL = `
  CASE
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fx', 'forex', 'forex_pair', 'forex_pairs', 'physical_currency') THEN 'forex'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('stock', 'stocks', 'common_stock', 'preferred_stock', 'american_depositary_receipt', 'depositary_receipt', 'global_depositary_receipt', 'reit', 'right', 'warrant', 'limited_partnership', 'structured_product') THEN 'stocks'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('etf', 'etfs', 'exchange_traded_note', 'exchange_traded_fund') THEN 'etf'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('crypto', 'cryptocurrency', 'cryptocurrencies', 'digital_currency', 'crypto_pair', 'crypto_pairs') THEN 'crypto'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('commodity', 'commodities', 'agricultural_product', 'energy', 'energies', 'energy_resource', 'livestock', 'metal', 'metals', 'precious_metal', 'precious_metals', 'industrial_metal', 'industrial_metals', 'gold', 'silver', 'platinum', 'palladium', 'oil', 'gas', 'natural_gas', 'crude_oil') THEN 'commodities'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('bond', 'bonds') THEN 'bonds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('fund', 'funds', 'bond_fund', 'closed_end_fund', 'trust', 'unit') THEN 'funds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('mutual_fund', 'mutual_funds') THEN 'mutual_funds'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) IN ('index', 'indices') THEN 'indices'
    WHEN LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown')) = 'unknown' THEN 'unknown'
    ELSE LOWER(COALESCE(NULLIF(sc.category, ''), 'unknown'))
  END
`;

export const TRADER_SCOUT_SEARCH_SQL = `
WITH ft AS (
  SELECT
    t.user_id,
    t.opened_at,
    t.closed_at,
    ${TRADE_NET_PROFIT_SQL} AS profit,
    t.stop_loss,
    t.take_profit,
    ${TRADER_SCOUT_CATEGORY_SQL} AS category
  FROM trades t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN symbol_configs sc ON sc.id = t.symbol_id
  WHERE t.status = 'CLOSED'
    AND t.closed_at IS NOT NULL
    AND t.closed_at >= $1::int
    AND u.is_admin = FALSE
    AND ($2::text[] IS NULL OR ${TRADER_SCOUT_CATEGORY_SQL} = ANY($2::text[]))
    AND ($3::text IS NULL OR u.username ILIKE $3::text OR u.email ILIKE $3::text)
),
agg AS (
  SELECT
    user_id,
    COUNT(*)::int AS trades,
    SUM(profit) AS net_profit,
    SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) AS gross_profit,
    SUM(CASE WHEN profit < 0 THEN profit ELSE 0 END) AS gross_loss,
    (SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS win_rate,
    AVG((closed_at - opened_at)::float) AS avg_hold_sec,
    MAX((closed_at - opened_at)::float) AS max_hold_sec,
    MIN((closed_at - opened_at)::float) AS min_hold_sec,
    (SUM(CASE WHEN stop_loss IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS sl_usage,
    (SUM(CASE WHEN take_profit IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) AS tp_usage
  FROM ft
  GROUP BY user_id
  HAVING COUNT(*) >= $6::int
),
candidates AS (
  SELECT
    a.*,
    CASE
      WHEN ABS(a.gross_loss) < 0.0001 THEN CASE WHEN a.gross_profit > 0 THEN 999.0 ELSE NULL END
      ELSE (a.gross_profit / ABS(a.gross_loss))
    END AS profit_factor
  FROM agg a
  WHERE ($7::float IS NULL OR a.win_rate >= $7::float)
    AND ($8::numeric IS NULL OR a.net_profit >= $8::numeric)
    AND ($4::int IS NULL OR a.avg_hold_sec >= $4::int)
    AND ($5::int IS NULL OR a.avg_hold_sec <= $5::int)
    AND ($12::float IS NULL OR a.sl_usage >= $12::float)
    AND ($13::float IS NULL OR a.tp_usage >= $13::float)
),
candidates2 AS (
  SELECT *
  FROM candidates c
  WHERE ($11::float IS NULL OR (c.profit_factor IS NOT NULL AND c.profit_factor >= $11::float))
),
day_pnl AS (
  SELECT
    ft.user_id,
    date_trunc('day', to_timestamp(ft.closed_at)) AS day,
    SUM(ft.profit) AS pnl
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, day
),
day_equity AS (
  SELECT
    dp.user_id,
    dp.day,
    SUM(dp.pnl) OVER (PARTITION BY dp.user_id ORDER BY dp.day) AS cum_pnl
  FROM day_pnl dp
),
day_equity2 AS (
  SELECT
    de.user_id,
    de.day,
    de.cum_pnl,
    MAX(de.cum_pnl) OVER (
      PARTITION BY de.user_id
      ORDER BY de.day
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS peak_cum_pnl
  FROM day_equity de
),
dd AS (
  SELECT
    de.user_id,
    MAX(
      CASE
        WHEN (u.starting_equity::numeric + de.peak_cum_pnl) <= 0 THEN NULL
        ELSE (de.peak_cum_pnl - de.cum_pnl) / NULLIF((u.starting_equity::numeric + de.peak_cum_pnl), 0)
      END
    ) AS max_drawdown
  FROM day_equity2 de
  JOIN users u ON u.id = de.user_id
  GROUP BY de.user_id
),
best_day AS (
  SELECT
    user_id,
    MAX(pnl) AS best_day_pnl,
    SUM(pnl) AS total_pnl
  FROM day_pnl
  GROUP BY user_id
),
best_day_pct AS (
  SELECT
    user_id,
    CASE WHEN total_pnl > 0 THEN (best_day_pnl / total_pnl) ELSE NULL END AS best_day_pct
  FROM best_day
),
mix AS (
  SELECT
    ft.user_id,
    ft.category,
    COUNT(*)::int AS trades
  FROM ft
  JOIN candidates2 c ON c.user_id = ft.user_id
  GROUP BY ft.user_id, ft.category
),
mix_totals AS (
  SELECT user_id, SUM(trades)::int AS total_trades
  FROM mix
  GROUP BY user_id
),
mix_json AS (
  SELECT
    m.user_id,
    jsonb_object_agg(m.category, (m.trades::float / NULLIF(mt.total_trades, 0))) AS asset_mix
  FROM mix m
  JOIN mix_totals mt ON mt.user_id = m.user_id
  GROUP BY m.user_id
)
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  c.trades,
  c.win_rate,
  c.net_profit,
  c.gross_profit,
  c.gross_loss,
  c.profit_factor,
  c.avg_hold_sec,
  c.max_hold_sec,
  c.min_hold_sec,
  d.max_drawdown,
  b.best_day_pct,
  c.sl_usage,
  c.tp_usage,
  mj.asset_mix
FROM candidates2 c
JOIN users u ON u.id = c.user_id
LEFT JOIN dd d ON d.user_id = c.user_id
LEFT JOIN best_day_pct b ON b.user_id = c.user_id
LEFT JOIN mix_json mj ON mj.user_id = c.user_id
WHERE ($9::float IS NULL OR (d.max_drawdown IS NOT NULL AND d.max_drawdown <= $9::float))
  AND ($10::float IS NULL OR (b.best_day_pct IS NOT NULL AND b.best_day_pct <= $10::float))
ORDER BY c.net_profit DESC, c.trades DESC, u.id ASC
LIMIT $14::int OFFSET $15::int;
`;
