ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS primary_owner_id UUID REFERENCES users(id);

UPDATE chat_channels c
SET primary_owner_id = COALESCE(
  (
    SELECT creator.id
    FROM users creator
    JOIN roles creator_role ON creator_role.id = creator.role_id
    WHERE creator.id = c.created_by
      AND creator_role.name IN ('super_admin', 'it_team')
    LIMIT 1
  ),
  (
    SELECT cm.user_id
    FROM chat_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE cm.channel_id = c.id
      AND r.name IN ('super_admin', 'it_team')
    ORDER BY cm.created_at ASC
    LIMIT 1
  )
)
WHERE c.primary_owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_channels_primary_owner_id ON chat_channels(primary_owner_id);
