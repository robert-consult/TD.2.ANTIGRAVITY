CREATE DATABASE IF NOT EXISTS tradehub;

CREATE TABLE IF NOT EXISTS tradehub.sync_state (
  sync_key LowCardinality(String),
  last_marker UInt64 DEFAULT 0,
  last_row_id UInt64 DEFAULT 0,
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (sync_key, updated_at);

CREATE TABLE IF NOT EXISTS tradehub.admin_users (
  id UInt32,
  username String,
  email String,
  is_admin UInt8,
  starting_equity Float64,
  sync_marker UInt64
)
ENGINE = ReplacingMergeTree(sync_marker)
ORDER BY (id);

CREATE TABLE IF NOT EXISTS tradehub.admin_trades (
  id UInt64,
  user_id UInt32,
  username String,
  email String,
  is_admin UInt8,
  symbol String,
  category LowCardinality(String),
  side LowCardinality(String),
  status LowCardinality(String),
  lots Float64,
  open_price Float64,
  close_price Nullable(Float64),
  opened_at UInt32,
  closed_at UInt32,
  net_profit_usd Float64,
  stop_loss Nullable(Float64),
  take_profit Nullable(Float64),
  total_costs_usd Float64,
  open_commission_usd Float64,
  close_commission_usd Float64,
  financing_accrued_usd Float64,
  swap_accrued_usd Float64,
  overnight_days UInt16,
  row_version UInt64
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY toYYYYMM(toDateTime(opened_at))
ORDER BY (id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS tradehub.admin_daily_closes (
  id UInt64,
  user_id UInt32,
  date Date,
  balance Float64,
  profit_day Float64,
  trades_closed UInt32,
  trades_won UInt32,
  row_version UInt64
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY toYYYYMM(date)
ORDER BY (date, user_id, id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS tradehub.admin_user_account_events (
  id UInt64,
  user_id UInt32,
  event_type LowCardinality(String),
  reason_code Nullable(String),
  reason_text Nullable(String),
  created_at UInt32,
  row_version UInt64
)
ENGINE = ReplacingMergeTree(row_version)
PARTITION BY toYYYYMM(toDateTime(created_at))
ORDER BY (user_id, created_at, id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS tradehub.admin_export_events (
  ts DateTime,
  job_id String,
  export_type LowCardinality(String),
  export_format LowCardinality(String),
  status LowCardinality(String),
  row_count UInt64,
  bytes_written UInt64,
  latency_ms UInt64,
  admin_id UInt64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (export_type, status, ts, job_id)
SETTINGS index_granularity = 8192;

CREATE VIEW IF NOT EXISTS tradehub.admin_daily_pnl_agg AS
SELECT
  date,
  SUM(profit_day) AS total_profit,
  SUM(trades_closed) AS total_trades,
  SUM(trades_won) AS winning_trades,
  uniqExact(user_id) AS active_users
FROM tradehub.admin_daily_closes
GROUP BY date;
