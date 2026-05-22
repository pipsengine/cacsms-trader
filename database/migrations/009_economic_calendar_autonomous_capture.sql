-- Keep Economic Calendar Intelligence self-driving while preserving the no-fake-data rule.

UPDATE economic_sources
SET enabled = true,
    source_url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml',
    robots_policy = 'public_xml_feed',
    terms_policy = 'autonomous_collection_allowed',
    updated_at = now()
WHERE source_name = 'ForexFactory';

INSERT INTO economic_calendar_settings (key, value)
VALUES (
  'collection_policy',
  '{
    "respect_robots_txt": true,
    "rate_limit_required": true,
    "render_scraped_html": false,
    "auto_discover_enabled": true,
    "auto_refresh_enabled": true,
    "auto_release_watcher_enabled": true,
    "auto_retry_missing_actuals": true,
    "allow_synthetic_values": false
  }'::jsonb
)
ON CONFLICT (key)
DO UPDATE SET
  value = economic_calendar_settings.value
    || jsonb_build_object(
      'auto_discover_enabled', true,
      'auto_refresh_enabled', true,
      'auto_release_watcher_enabled', true,
      'auto_retry_missing_actuals', true,
      'allow_synthetic_values', false
    ),
  updated_at = now();

UPDATE economic_events
SET status = 'WATCHING',
    ai_summary = 'Actual value is not captured yet. Cacsms Trader is actively watching enabled real data sources and will not invent a result.',
    ai_reasoning = NULL,
    updated_at = now()
WHERE actual_value IS NULL
  AND utc_event_time IS NOT NULL
  AND utc_event_time <= now()
  AND utc_event_time >= now() - interval '24 hours'
  AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED');

UPDATE economic_events
SET status = 'FAILED',
    ai_summary = 'Release window passed but no actual value was captured from enabled real data sources. Retry collection or add a confirmed source.',
    ai_reasoning = NULL,
    updated_at = now()
WHERE actual_value IS NULL
  AND utc_event_time IS NOT NULL
  AND utc_event_time < now() - interval '24 hours'
  AND status NOT IN ('ARCHIVED','ANALYZED','RELEASED','CONFLICTED');

INSERT INTO economic_event_monitoring_jobs (event_id, job_type, status, run_after)
SELECT event.id, 'release_watcher', 'QUEUED', now() + interval '5 minutes'
FROM economic_events event
WHERE event.actual_value IS NULL
  AND event.status IN ('WATCHING','FAILED')
  AND event.utc_event_time >= now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1
    FROM economic_event_monitoring_jobs job
    WHERE job.event_id = event.id
      AND job.job_type = 'release_watcher'
      AND job.status IN ('QUEUED','RUNNING')
  );
