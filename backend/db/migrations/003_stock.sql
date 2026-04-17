CREATE TABLE IF NOT EXISTS stock_items (
  id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  category TEXT,
  name TEXT NOT NULL,
  serial_number TEXT,
  specs TEXT,
  branch_id TEXT,
  assigned_user_id TEXT,
  warranty_expires_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(branch_id) REFERENCES branches(id),
  FOREIGN KEY(assigned_user_id) REFERENCES users(id)
);