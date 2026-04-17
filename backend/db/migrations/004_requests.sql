CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  assignee_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(requester_id) REFERENCES users(id),
  FOREIGN KEY(assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS request_comments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY(author_id) REFERENCES users(id)
);