WITH numbered_gatepasses AS (
  SELECT
    id,
    'ZGP-' || to_char(COALESCE(issue_date, created_at::date), 'YYYYMMDD') || '-' || lpad(
      row_number() OVER (
        PARTITION BY COALESCE(issue_date, created_at::date)
        ORDER BY created_at, id
      )::text,
      4,
      '0'
    ) AS generated_number
  FROM gatepasses
  WHERE gatepass_number IS NULL OR btrim(gatepass_number) = ''
)
UPDATE gatepasses AS gatepass
SET gatepass_number = numbered_gatepasses.generated_number
FROM numbered_gatepasses
WHERE gatepass.id = numbered_gatepasses.id;