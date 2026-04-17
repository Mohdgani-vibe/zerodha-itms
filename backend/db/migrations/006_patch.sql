CREATE TABLE IF NOT EXISTS patch_jobs (
  id TEXT PRIMARY KEY,
  jid TEXT NOT NULL UNIQUE,
  triggered_by TEXT NOT NULL,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(triggered_by) REFERENCES users(id)
);