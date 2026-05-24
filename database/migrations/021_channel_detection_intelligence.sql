CREATE TABLE IF NOT EXISTS channel_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  upper_start_price NUMERIC(18, 6) NOT NULL,
  upper_end_price NUMERIC(18, 6) NOT NULL,
  lower_start_price NUMERIC(18, 6) NOT NULL,
  lower_end_price NUMERIC(18, 6) NOT NULL,
  upper_start_pixel_x NUMERIC(18, 6) NOT NULL,
  upper_start_pixel_y NUMERIC(18, 6) NOT NULL,
  upper_end_pixel_x NUMERIC(18, 6) NOT NULL,
  upper_end_pixel_y NUMERIC(18, 6) NOT NULL,
  lower_start_pixel_x NUMERIC(18, 6) NOT NULL,
  lower_start_pixel_y NUMERIC(18, 6) NOT NULL,
  lower_end_pixel_x NUMERIC(18, 6) NOT NULL,
  lower_end_pixel_y NUMERIC(18, 6) NOT NULL,
  slope NUMERIC(18, 8) NOT NULL,
  channel_width NUMERIC(18, 6) NOT NULL,
  containment_score NUMERIC(8, 4) NOT NULL,
  touch_count INTEGER NOT NULL,
  respect_rate NUMERIC(8, 4) NOT NULL,
  false_break_count INTEGER NOT NULL,
  slope_consistency NUMERIC(8, 4) NOT NULL,
  volatility_state TEXT NOT NULL,
  compression_score NUMERIC(8, 4) NOT NULL,
  breakout_probability NUMERIC(8, 4) NOT NULL,
  liquidity_risk NUMERIC(8, 4) NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  quality_score NUMERIC(8, 4) NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_breakout_pressure (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channel_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  boundary TEXT NOT NULL,
  pressure_score NUMERIC(8, 4) NOT NULL,
  repeated_touch_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_build_up_score NUMERIC(8, 4) NOT NULL,
  breakout_direction TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_detection_feedback (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channel_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channels_capture_quality ON channel_detections(chart_capture_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_channel_pressure_capture ON channel_breakout_pressure(chart_capture_id, pressure_score DESC);
CREATE INDEX IF NOT EXISTS idx_channel_feedback ON channel_detection_feedback(channel_id, created_at DESC);
