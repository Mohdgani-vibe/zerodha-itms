ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS reference_key VARCHAR(255);

WITH ranked_requests AS (
  SELECT
    id,
    CASE
      WHEN type = 'device_enrollment' THEN
        'device_enrollment:' || upper(
          regexp_replace(
            btrim(
              COALESCE(
                NULLIF(substring(description FROM 'Asset tag / host:\s*([^\n]+)'), ''),
                NULLIF(substring(title FROM 'Device enrollment review for\s+(.+)'), ''),
                ''
              )
            ),
            '\s+',
            ' ',
            'g'
          )
        )
      ELSE NULL
    END AS derived_reference_key,
    row_number() OVER (
      PARTITION BY type,
      upper(
        regexp_replace(
          btrim(
            COALESCE(
              NULLIF(substring(description FROM 'Asset tag / host:\s*([^\n]+)'), ''),
              NULLIF(substring(title FROM 'Device enrollment review for\s+(.+)'), ''),
              ''
            )
          ),
          '\s+',
          ' ',
          'g'
        )
      )
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM requests
)
UPDATE requests AS r
SET reference_key = ranked_requests.derived_reference_key
FROM ranked_requests
WHERE r.id = ranked_requests.id
  AND ranked_requests.row_num = 1
  AND ranked_requests.derived_reference_key IS NOT NULL
  AND ranked_requests.derived_reference_key <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_active_reference_key_unique
  ON requests (reference_key)
  WHERE reference_key IS NOT NULL
    AND btrim(reference_key) <> ''
    AND status IN ('pending', 'in_progress');