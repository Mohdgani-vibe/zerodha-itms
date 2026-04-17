ALTER TABLE gatepasses
  DROP COLUMN IF EXISTS pdf_data;

ALTER TABLE gatepasses
  DROP COLUMN IF EXISTS pdf_generated_at;