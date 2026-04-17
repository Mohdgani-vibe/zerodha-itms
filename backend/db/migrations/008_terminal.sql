CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY,
  target_device_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(target_device_id) REFERENCES devices(id),
  FOREIGN KEY(requested_by) REFERENCES users(id)
);