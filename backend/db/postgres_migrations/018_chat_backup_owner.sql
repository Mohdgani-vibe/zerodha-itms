ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS backup_owner_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_chat_channels_backup_owner_id ON chat_channels(backup_owner_id);