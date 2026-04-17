ALTER TABLE gatepasses
ADD COLUMN IF NOT EXISTS gatepass_number VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gatepasses_gatepass_number
ON gatepasses(gatepass_number)
WHERE gatepass_number IS NOT NULL;