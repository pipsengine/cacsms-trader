ALTER TABLE economic_events
DROP CONSTRAINT IF EXISTS economic_events_status_check;

ALTER TABLE economic_events
ADD CONSTRAINT economic_events_status_check
CHECK (status IN ('UPCOMING','SCHEDULED','PRE_MONITORING','WATCHING','RELEASED','ANALYZED','ARCHIVED','FAILED','CONFLICTED','SOURCE_CONFLICT'));

UPDATE economic_events
SET status = 'SOURCE_CONFLICT',
    updated_at = now()
WHERE status = 'CONFLICTED';

UPDATE economic_events
SET conflict_status = 'SOURCE_CONFLICT',
    updated_at = now()
WHERE conflict_status = 'CONFLICTED';

