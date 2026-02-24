CREATE INDEX IF NOT EXISTS idx_grift_observations_user_observed_at
  ON grift_observations (user_id, observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_observations_ip_asn_observed_user
  ON grift_observations (ip, asn, observed_at, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_trade_observations_symbol_direction_observed_at
  ON grift_trade_observations (symbol, direction, observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_trade_observations_user_symbol_direction_observed_at
  ON grift_trade_observations (user_id, symbol, direction, observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_linked_account_edges_user_a_last_confirmed_at
  ON grift_linked_account_edges (user_a, last_confirmed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_linked_account_edges_user_b_last_confirmed_at
  ON grift_linked_account_edges (user_b, last_confirmed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_grift_device_users_device_last_seen_at
  ON grift_device_users (device_id, last_seen_at);
