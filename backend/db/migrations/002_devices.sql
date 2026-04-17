CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  serial_number TEXT,
  specs TEXT,
  os_name TEXT,
  os_version TEXT,
  assigned_user_id TEXT,
  branch_id TEXT,
  warranty_expires_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(assigned_user_id) REFERENCES users(id),
  FOREIGN KEY(branch_id) REFERENCES branches(id)
);