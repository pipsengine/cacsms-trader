CREATE TABLE IF NOT EXISTS swing_point_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  swing_kind TEXT NOT NULL,
  swing_category TEXT NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  pixel_x NUMERIC(18, 6) NOT NULL,
  pixel_y NUMERIC(18, 6) NOT NULL,
  depth INTEGER NOT NULL,
  left_strength NUMERIC(8, 4) NOT NULL,
  right_strength NUMERIC(8, 4) NOT NULL,
  atr_validation_score NUMERIC(8, 4) NOT NULL,
  zigzag_validation_score NUMERIC(8, 4) NOT NULL,
  rejection_score NUMERIC(8, 4) NOT NULL,
  continuation_score NUMERIC(8, 4) NOT NULL,
  liquidity_relevance NUMERIC(8, 4) NOT NULL,
  turning_point_probability NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  swept BOOLEAN NOT NULL DEFAULT false,
  structural_importance TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swing_hierarchy_states (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  hierarchy_level TEXT NOT NULL,
  trend_state TEXT NOT NULL,
  last_structure_high NUMERIC(18, 6),
  last_structure_low NUMERIC(18, 6),
  liquidity_bias TEXT NOT NULL,
  structural_narrative TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swing_detection_feedback (
  id UUID PRIMARY KEY,
  swing_detection_id UUID NOT NULL REFERENCES swing_point_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swing_points_capture_index ON swing_point_detections(chart_capture_id, candle_index);
CREATE INDEX IF NOT EXISTS idx_swing_points_capture_kind ON swing_point_detections(chart_capture_id, swing_kind, swing_category);
CREATE INDEX IF NOT EXISTS idx_swing_points_liquidity ON swing_point_detections(chart_capture_id, liquidity_relevance DESC);
CREATE INDEX IF NOT EXISTS idx_swing_hierarchy_capture ON swing_hierarchy_states(chart_capture_id, hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_swing_feedback_detection ON swing_detection_feedback(swing_detection_id, created_at DESC);
