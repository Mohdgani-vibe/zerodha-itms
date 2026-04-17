ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS issue_date DATE;

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS employee_name VARCHAR(150);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS department_name VARCHAR(150);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(50);

ALTER TABLE gatepasses
  ADD COLUMN IF NOT EXISTS asset_description TEXT;