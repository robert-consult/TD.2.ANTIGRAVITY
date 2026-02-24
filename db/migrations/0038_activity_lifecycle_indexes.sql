CREATE INDEX IF NOT EXISTS user_sessions_user_last_active_idx
  ON user_sessions (user_id, last_active_at DESC);

CREATE INDEX IF NOT EXISTS user_login_history_user_success_created_idx
  ON user_login_history (user_id, created_at DESC)
  WHERE success = TRUE;

CREATE INDEX IF NOT EXISTS user_deletion_queue_status_grace_expires_idx
  ON user_deletion_queue (status, grace_expires_at, user_id);

CREATE INDEX IF NOT EXISTS users_activity_list_scan_idx
  ON users (created_at, id)
  WHERE is_admin = FALSE;

CREATE INDEX IF NOT EXISTS users_activity_sweep_scan_idx
  ON users (created_at, id)
  WHERE is_admin = FALSE AND is_deleted = FALSE AND deletion_exempt = FALSE;
