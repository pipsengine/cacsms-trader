CREATE TABLE IF NOT EXISTS economic_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'public_calendar',
  source_url TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT false,
  requires_credentials BOOLEAN NOT NULL DEFAULT false,
  robots_policy TEXT NOT NULL DEFAULT 'unknown',
  terms_policy TEXT NOT NULL DEFAULT 'review_required',
  reliability_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  successful_fetch_count INTEGER NOT NULL DEFAULT 0,
  failed_fetch_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  average_update_delay_seconds INTEGER,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_events (
  id TEXT PRIMARY KEY,
  source_id UUID REFERENCES economic_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  event_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  normalized_event_name TEXT NOT NULL,
  country TEXT NOT NULL,
  currency TEXT NOT NULL,
  impact_level TEXT NOT NULL CHECK (impact_level IN ('Low','Medium','High','Critical')),
  event_date DATE NOT NULL,
  event_time TIME,
  event_timezone TEXT NOT NULL DEFAULT 'UTC',
  local_event_time TIMESTAMPTZ,
  broker_event_time TIMESTAMPTZ,
  utc_event_time TIMESTAMPTZ,
  actual_value TEXT,
  forecast_value TEXT,
  previous_value TEXT,
  revised_previous_value TEXT,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','SCHEDULED','PRE_MONITORING','WATCHING','RELEASED','ANALYZED','ARCHIVED','FAILED','CONFLICTED')),
  surprise_value NUMERIC,
  surprise_percentage NUMERIC,
  surprise_direction TEXT,
  bias TEXT NOT NULL DEFAULT 'Not Enough Data',
  bias_strength INTEGER NOT NULL DEFAULT 0,
  affected_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  trade_restriction_required BOOLEAN NOT NULL DEFAULT false,
  restriction_start_time TIMESTAMPTZ,
  restriction_end_time TIMESTAMPTZ,
  ai_summary TEXT,
  ai_reasoning TEXT,
  source_reliability_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  validation_status TEXT NOT NULL DEFAULT 'PROVISIONAL',
  conflict_status TEXT NOT NULL DEFAULT 'NONE',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (source_name, event_key)
);

CREATE TABLE IF NOT EXISTS economic_event_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL REFERENCES economic_events(id) ON DELETE CASCADE,
  actual_value TEXT,
  forecast_value TEXT,
  previous_value TEXT,
  revised_previous_value TEXT,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS economic_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL REFERENCES economic_events(id) ON DELETE CASCADE,
  currency_bias TEXT NOT NULL,
  bias_score INTEGER NOT NULL DEFAULT 0,
  price_move_5m JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_move_15m JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_move_30m JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_move_1h JSONB NOT NULL DEFAULT '{}'::jsonb,
  spread_widened BOOLEAN,
  volatility_spiked BOOLEAN,
  direction_followed_news BOOLEAN,
  reaction_reversed BOOLEAN,
  lessons_learned TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_event_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES economic_events(id) ON DELETE CASCADE,
  source_id UUID REFERENCES economic_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  event_time_text TEXT,
  forecast_value TEXT,
  previous_value TEXT,
  actual_value TEXT,
  impact_level TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_event_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES economic_events(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source_a TEXT NOT NULL,
  value_a TEXT,
  source_b TEXT NOT NULL,
  value_b TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'OPEN',
  preferred_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS economic_event_monitoring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES economic_events(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_trade_restriction_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT REFERENCES economic_events(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  affected_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  restriction_level TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS currency_bias_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency TEXT NOT NULL,
  score INTEGER NOT NULL,
  bias TEXT NOT NULL,
  contributing_events JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_fetch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES economic_sources(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  message TEXT,
  duration_ms INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL,
  error_type TEXT NOT NULL,
  message TEXT NOT NULL,
  url TEXT,
  raw_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS economic_calendar_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO economic_sources (source_name, source_type, source_url, priority, enabled, requires_credentials, robots_policy, terms_policy)
VALUES
  ('Official Government/Central Bank', 'official_release', 'https://www.bls.gov/', 1, false, false, 'respect_robots', 'review_required'),
  ('ForexFactory', 'public_calendar', 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml', 2, true, false, 'public_xml_feed', 'autonomous_collection_allowed'),
  ('Myfxbook', 'public_calendar', 'https://www.myfxbook.com/forex-economic-calendar', 3, false, false, 'respect_robots', 'review_required'),
  ('FXStreet', 'public_calendar', 'https://www.fxstreet.com/economic-calendar', 4, false, false, 'respect_robots', 'review_required'),
  ('Investing.com', 'public_calendar', 'https://www.investing.com/economic-calendar/', 5, false, false, 'respect_robots', 'review_required'),
  ('CFTC COT', 'official_release', 'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm', 6, false, false, 'respect_robots', 'review_required'),
  ('FRED', 'official_api', 'https://fred.stlouisfed.org/', 7, false, true, 'api', 'official_api')
ON CONFLICT (source_name) DO NOTHING;

INSERT INTO economic_calendar_settings (key, value)
VALUES
  ('timezone', '{"local":"Africa/Lagos","broker":"UTC","source_default":"UTC"}'),
  ('trade_restriction_rules', '{"Low":{"before":0,"after":0},"Medium":{"before":10,"after":10},"High":{"before":15,"after":15},"Critical":{"before":30,"after":60}}'),
  ('ai_analysis', '{"enabled":true,"require_actual_value":true,"allow_synthetic_values":false}'),
  ('collection_policy', '{"respect_robots_txt":true,"rate_limit_required":true,"render_scraped_html":false,"auto_discover_enabled":true,"auto_refresh_enabled":true,"auto_release_watcher_enabled":true,"auto_retry_missing_actuals":true,"allow_synthetic_values":false}')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_economic_events_time ON economic_events (utc_event_time, status, currency, impact_level);
CREATE INDEX IF NOT EXISTS idx_economic_events_status ON economic_events (status);
CREATE INDEX IF NOT EXISTS idx_economic_restrictions_active ON economic_trade_restriction_windows (active, starts_at, ends_at);
