CREATE TABLE IF NOT EXISTS image_comparison_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  previous_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  current_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  processing_time_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_comparison_results (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  previous_image_url TEXT,
  current_image_url TEXT,
  comparison_score NUMERIC(8, 4) NOT NULL,
  similarity_percentage NUMERIC(8, 4) NOT NULL,
  visual_change_confidence NUMERIC(8, 4) NOT NULL,
  changed_bias TEXT NOT NULL,
  final_interpretation TEXT NOT NULL,
  changed_structures_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_zones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidated_zones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visual_difference_maps (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  heatmap_url TEXT NOT NULL,
  difference_blocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  keypoint_matches_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  registration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chart_change_events (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity_score NUMERIC(8, 4) NOT NULL,
  timeframe TEXT NOT NULL,
  description TEXT NOT NULL,
  zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comparison_ai_interpretations (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ai_summary TEXT NOT NULL,
  market_change_timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  institutional_interpretation TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_comparison_jobs_symbol_tf ON image_comparison_jobs(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_comparison_results_job ON image_comparison_results(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_visual_difference_maps_job ON visual_difference_maps(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_chart_change_events_job ON chart_change_events(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_comparison_ai_interpretations_job ON comparison_ai_interpretations(comparison_job_id);
