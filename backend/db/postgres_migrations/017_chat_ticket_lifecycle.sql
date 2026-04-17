CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1000;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(32);

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS source_chat_id UUID REFERENCES chat_channels(id) ON DELETE SET NULL;

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'open';

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id);

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS linked_request_id UUID REFERENCES requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_ticket_number_unique
  ON requests (ticket_number)
  WHERE ticket_number IS NOT NULL AND btrim(ticket_number) <> '';

CREATE INDEX IF NOT EXISTS idx_requests_source_chat_id ON requests(source_chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_channels_status ON chat_channels(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_channels_linked_request_id ON chat_channels(linked_request_id);
