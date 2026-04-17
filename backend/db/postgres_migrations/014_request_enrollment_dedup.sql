WITH enrollment_requests AS (
  SELECT
    id,
    status,
    COALESCE(
      NULLIF(btrim(reference_key), ''),
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
      END
    ) AS cleanup_key,
    row_number() OVER (
      PARTITION BY COALESCE(
        NULLIF(btrim(reference_key), ''),
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
        END
      )
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM requests
  WHERE type = 'device_enrollment'
), duplicate_terminal_requests AS (
  SELECT id
  FROM enrollment_requests
  WHERE cleanup_key IS NOT NULL
    AND cleanup_key <> ''
    AND row_num > 1
    AND status IN ('resolved', 'rejected')
)
DELETE FROM requests
WHERE id IN (SELECT id FROM duplicate_terminal_requests);