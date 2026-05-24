CREATE TABLE IF NOT EXISTS trendline_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  trendline_kind TEXT NOT NULL,
  direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  start_price NUMERIC(18, 6) NOT NULL,
  end_price NUMERIC(18, 6) NOT NULL,
  start_pixel_x NUMERIC(18, 6) NOT NULL,
  start_pixel_y NUMERIC(18, 6) NOT NULL,
  end_pixel_x NUMERIC(18, 6) NOT NULL,
  end_pixel_y NUMERIC(18, 6) NOT NULL,
  slope NUMERIC(18, 8) NOT NULL,
  normalized_slope NUMERIC(8, 4) NOT NULL,
  slope_state TEXT NOT NULL,
  touch_count INTEGER NOT NULL,
  validity_score NUMERIC(8, 4) NOT NULL,
  respect_score NUMERIC(8, 4) NOT NULL,
  spacing_score NUMERIC(8, 4) NOT NULL,
  break_probability NUMERIC(8, 4) NOT NULL,
  retest_probability NUMERIC(8, 4) NOT NULL,
  trap_risk NUMERIC(8, 4) NOT NULL,
  break_status TEXT NOT NULL,
  retest_status TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trendline_break_events (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  break_direction TEXT NOT NULL,
  break_quality_score NUMERIC(8, 4) NOT NULL,
  false_break_probability NUMERIC(8, 4) NOT NULL,
  liquidity_grab_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trendline_retest_events (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  retest_quality_score NUMERIC(8, 4) NOT NULL,
  continuation_probability NUMERIC(8, 4) NOT NULL,
  rejection_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trendline_detection_feedback (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trendlines_capture_validity ON trendline_detections(chart_capture_id, validity_score DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_breaks_capture ON trendline_break_events(chart_capture_id, break_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_retests_capture ON trendline_retest_events(chart_capture_id, continuation_probability DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_feedback ON trendline_detection_feedback(trendline_id, created_at DESC);
