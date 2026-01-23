CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_linked_account_edges_unique
  ON grift_linked_account_edges (user_a, user_b, link_type, link_value);

