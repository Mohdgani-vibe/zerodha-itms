ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100);

ALTER TABLE asset_compute_details
  ADD COLUMN IF NOT EXISTS os_version TEXT,
  ADD COLUMN IF NOT EXISTS architecture TEXT,
  ADD COLUMN IF NOT EXISTS os_build TEXT;

CREATE TABLE IF NOT EXISTS inventory_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS inventory_sync_runs_started_at_idx
  ON inventory_sync_runs (started_at DESC);