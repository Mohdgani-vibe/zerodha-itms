CREATE TABLE IF NOT EXISTS gatepasses (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  asset_ref TEXT,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL,
  approver_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(requester_id) REFERENCES users(id),
  FOREIGN KEY(approver_id) REFERENCES users(id)
);