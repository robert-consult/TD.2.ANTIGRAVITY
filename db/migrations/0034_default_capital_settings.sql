ALTER TABLE global_settings
  ADD COLUMN IF NOT EXISTS default_user_starting_balance_usd real NOT NULL DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS default_user_starting_equity_usd real NOT NULL DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS default_challenge_virtual_capital_usd real NOT NULL DEFAULT 100000;
