ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS actual_source TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS actual_capture_status TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS actual_captured_at TIMESTAMPTZ;

ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS website_actual_value TEXT;

ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS xml_actual_value TEXT;

ALTER TABLE economic_events
ADD COLUMN IF NOT EXISTS source_priority_used TEXT;

UPDATE economic_events
SET website_actual_value = COALESCE(website_actual_value, actual_value),
    actual_source = CASE WHEN actual_value IS NOT NULL THEN 'WEBSITE' ELSE actual_source END,
    actual_capture_status = CASE WHEN actual_value IS NOT NULL THEN 'CAPTURED' ELSE actual_capture_status END,
    actual_captured_at = CASE WHEN actual_value IS NOT NULL THEN COALESCE(actual_captured_at, updated_at, now()) ELSE actual_captured_at END,
    source_priority_used = COALESCE(source_priority_used, CASE WHEN validation_status LIKE 'WEBSITE%' THEN 'WEBSITE' ELSE source_priority_used END),
    updated_at = now()
WHERE source_name = 'ForexFactory';

