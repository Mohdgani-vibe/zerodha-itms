ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS issuer_signed_name VARCHAR(150);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS issuer_signed_at TIMESTAMPTZ;

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_name VARCHAR(150);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS receiver_signed_at TIMESTAMPTZ;

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS security_signed_name VARCHAR(150);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS security_signed_at TIMESTAMPTZ;