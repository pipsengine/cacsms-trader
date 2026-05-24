CREATE TABLE IF NOT EXISTS visual_anomaly_jobs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  model_version TEXT NOT NULL DEFAULT 'visual-anomaly-hybrid-v1',
  processing_time_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visual_anomalies (
  id UUID PRIMARY KEY,
  anomaly_job_id UUID NOT NULL REFERENCES visual_anomaly_jobs(id) ON DELETE CASCADE,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  affected_timeframe TEXT NOT NULL,
  affected_price_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visual_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  probability_score NUMERIC(8, 4) NOT NULL,
  trading_risk_meaning TEXT NOT NULL,
  possible_cause TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomaly_severity_scores (
  id UUID PRIMARY KEY,
  anomaly_job_id UUID NOT NULL REFERENCES visual_anomaly_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  low_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  overall_severity TEXT NOT NULL,
  manipulation_probability NUMERIC(8, 4) NOT NULL,
  feed_quality_score NUMERIC(8, 4) NOT NULL,
  image_integrity_score NUMERIC(8, 4) NOT NULL,
  volatility_spike_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomaly_resolution_logs (
  id UUID PRIMARY KEY,
  visual_anomaly_id UUID NOT NULL REFERENCES visual_anomalies(id) ON DELETE CASCADE,
  resolution_status TEXT NOT NULL,
  resolution_note TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS anomaly_model_history (
  id UUID PRIMARY KEY,
  model_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  total_anomalies INTEGER NOT NULL,
  critical_count INTEGER NOT NULL,
  high_count INTEGER NOT NULL,
  false_positive_count INTEGER NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_anomaly_jobs_symbol_tf
  ON visual_anomaly_jobs(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_anomalies_capture
  ON visual_anomalies(chart_capture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_anomalies_symbol
  ON visual_anomalies(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_anomalies_severity
  ON visual_anomalies(severity, resolved, created_at DESC);
