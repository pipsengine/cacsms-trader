CREATE TABLE IF NOT EXISTS autonomous_pipeline_sessions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  terminal_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  current_stage TEXT NOT NULL DEFAULT 'terminal-connectivity',
  current_timeframe TEXT,
  mode TEXT NOT NULL DEFAULT 'full_auto',
  progress INTEGER NOT NULL DEFAULT 0,
  stage_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeframe_capture_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_pipeline_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES autonomous_pipeline_sessions(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_pipeline_sessions_status ON autonomous_pipeline_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_pipeline_events_session ON autonomous_pipeline_events(session_id, created_at DESC);
