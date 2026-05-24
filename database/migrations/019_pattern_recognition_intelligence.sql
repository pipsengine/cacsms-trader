CREATE TABLE IF NOT EXISTS pattern_recognition_results (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  pattern_name TEXT NOT NULL,
  pattern_family TEXT NOT NULL,
  pattern_status TEXT NOT NULL,
  completion_percentage NUMERIC(8, 4) NOT NULL,
  breakout_direction TEXT NOT NULL,
  breakout_probability NUMERIC(8, 4) NOT NULL,
  failure_probability NUMERIC(8, 4) NOT NULL,
  trap_probability NUMERIC(8, 4) NOT NULL,
  retail_trap_score NUMERIC(8, 4) NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  similarity_score NUMERIC(8, 4) NOT NULL,
  dtw_distance NUMERIC(18, 6) NOT NULL,
  overlay_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_shape_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pattern_similarity_history (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  pattern_result_id UUID REFERENCES pattern_recognition_results(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_family TEXT NOT NULL,
  similarity_score NUMERIC(8, 4) NOT NULL,
  dtw_distance NUMERIC(18, 6) NOT NULL,
  historical_success_rate NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pattern_probability_snapshots (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  bullish_breakout_probability NUMERIC(8, 4) NOT NULL,
  bearish_breakout_probability NUMERIC(8, 4) NOT NULL,
  continuation_probability NUMERIC(8, 4) NOT NULL,
  reversal_probability NUMERIC(8, 4) NOT NULL,
  accumulation_probability NUMERIC(8, 4) NOT NULL,
  distribution_probability NUMERIC(8, 4) NOT NULL,
  manipulation_probability NUMERIC(8, 4) NOT NULL,
  volatility_compression_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_location_score NUMERIC(8, 4) NOT NULL,
  trend_context_score NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pattern_recognition_feedback (
  id UUID PRIMARY KEY,
  pattern_result_id UUID NOT NULL REFERENCES pattern_recognition_results(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patterns_capture_confidence ON pattern_recognition_results(chart_capture_id, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_capture_name ON pattern_recognition_results(chart_capture_id, pattern_name);
CREATE INDEX IF NOT EXISTS idx_pattern_similarity_capture ON pattern_similarity_history(chart_capture_id, similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_probability_capture ON pattern_probability_snapshots(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_feedback_result ON pattern_recognition_feedback(pattern_result_id, created_at DESC);
