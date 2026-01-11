-- Add min_spread_pips to symbol_configs if it doesn't exist
ALTER TABLE symbol_configs ADD COLUMN IF NOT EXISTS min_spread_pips REAL DEFAULT 2.0;

-- Add order_type to trades if it doesn't exist
ALTER TABLE trades ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'Market';

-- Update all users to have $1,000,000 balance
UPDATE users SET balance = '1000000.00' WHERE balance != '1000000.00';