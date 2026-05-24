CREATE TABLE IF NOT EXISTS liquidity_zone_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  liquidity_type TEXT NOT NULL,
  liquidity_side TEXT NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  equal_level_count INTEGER NOT NULL,
  stop_cluster_score NUMERIC(8, 4) NOT NULL,
  obvious_retail_score NUMERIC(8, 4) NOT NULL,
  sweep_status TEXT NOT NULL,
  sweep_quality_score NUMERIC(8, 4) NOT NULL,
  inducement_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  trap_probability NUMERIC(8, 4) NOT NULL,
  volatility_expansion_score NUMERIC(8, 4) NOT NULL,
  session_timing_score NUMERIC(8, 4) NOT NULL,
  institutional_narrative TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liquidity_sweep_events (
  id UUID PRIMARY KEY,
  liquidity_zone_id UUID NOT NULL REFERENCES liquidity_zone_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  sweep_direction TEXT NOT NULL,
  swept_price_level NUMERIC(18, 6) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  close_failure_score NUMERIC(8, 4) NOT NULL,
  displacement_reversal_score NUMERIC(8, 4) NOT NULL,
  sweep_quality_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liquidity_void_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  void_direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  inefficiency_score NUMERIC(8, 4) NOT NULL,
  rebalance_probability NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS liquidity_detection_feedback (
  id UUID PRIMARY KEY,
  liquidity_zone_id UUID NOT NULL REFERENCES liquidity_zone_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_liquidity_zones_capture_confidence ON liquidity_zone_detections(chart_capture_id, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_sweeps_capture ON liquidity_sweep_events(chart_capture_id, sweep_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_voids_capture ON liquidity_void_detections(chart_capture_id, inefficiency_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_feedback_zone ON liquidity_detection_feedback(liquidity_zone_id, created_at DESC);
