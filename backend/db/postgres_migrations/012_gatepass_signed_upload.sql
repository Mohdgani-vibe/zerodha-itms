ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_file_name VARCHAR(255);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_file_content_type VARCHAR(120);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_file_data BYTEA;

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_file_uploaded_at TIMESTAMPTZ;

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_file_uploaded_by UUID REFERENCES users(id);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_verification_status VARCHAR(30) NOT NULL DEFAULT 'missing';

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_verification_notes TEXT;