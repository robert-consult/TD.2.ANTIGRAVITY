CREATE UNIQUE INDEX IF NOT EXISTS idx_grift_device_users_device_user
  ON grift_device_users (device_id, user_id);
