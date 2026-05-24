CREATE TABLE IF NOT EXISTS chart_captures (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  capture_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'queued',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS vision_analysis_jobs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  model_version TEXT NOT NULL DEFAULT 'vision-institutional-v1',
  processing_time_ms INTEGER
);

CREATE TABLE IF NOT EXISTS reconstructed_candles (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  open_price NUMERIC(18, 6) NOT NULL,
  high_price NUMERIC(18, 6) NOT NULL,
  low_price NUMERIC(18, 6) NOT NULL,
  close_price NUMERIC(18, 6) NOT NULL,
  pixel_x NUMERIC(18, 6) NOT NULL,
  pixel_y_open NUMERIC(18, 6) NOT NULL,
  pixel_y_high NUMERIC(18, 6) NOT NULL,
  pixel_y_low NUMERIC(18, 6) NOT NULL,
  pixel_y_close NUMERIC(18, 6) NOT NULL,
  direction TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS vision_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  detection_type TEXT NOT NULL,
  detection_name TEXT NOT NULL,
  direction TEXT,
  price_level NUMERIC(18, 6),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  bounding_box_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS market_structure_states (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  trend_state TEXT NOT NULL,
  phase_state TEXT NOT NULL,
  last_bos_direction TEXT,
  last_choch_direction TEXT,
  liquidity_bias TEXT NOT NULL,
  institutional_bias TEXT NOT NULL,
  retail_bias TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_decision_outputs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL,
  bias TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  entry_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_loss NUMERIC(18, 6),
  take_profit_1 NUMERIC(18, 6),
  take_profit_2 NUMERIC(18, 6),
  risk_reward_ratio NUMERIC(10, 4),
  invalidation_level NUMERIC(18, 6),
  reasoning_text TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_confidence_scores (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES vision_analysis_jobs(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  raw_score NUMERIC(8, 4) NOT NULL,
  calibrated_score NUMERIC(8, 4) NOT NULL,
  uncertainty_score NUMERIC(8, 4) NOT NULL,
  final_confidence NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY,
  detection_id UUID NOT NULL REFERENCES vision_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_performance_history (
  id UUID PRIMARY KEY,
  model_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  detection_type TEXT NOT NULL,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  successful_predictions INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  false_negatives INTEGER NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  precision_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  recall_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visual_intelligence_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  chart_capture_id UUID,
  job_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_captures_symbol_time ON chart_captures(symbol, timeframe, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_chart_captures_hash ON chart_captures(image_hash);
CREATE INDEX IF NOT EXISTS idx_vision_jobs_capture ON vision_analysis_jobs(chart_capture_id);
CREATE INDEX IF NOT EXISTS idx_vision_jobs_status ON vision_analysis_jobs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconstructed_candles_capture_index ON reconstructed_candles(chart_capture_id, candle_index);
CREATE INDEX IF NOT EXISTS idx_vision_detections_capture_type ON vision_detections(chart_capture_id, detection_type);
CREATE INDEX IF NOT EXISTS idx_market_structure_symbol_timeframe ON market_structure_states(symbol, timeframe, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_capture ON ai_decision_outputs(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visual_events_id ON visual_intelligence_events(id);
