ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS source_fingerprint VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_source_fingerprint_unique
  ON assets (source_fingerprint)
  WHERE source_fingerprint IS NOT NULL AND source_fingerprint <> '';