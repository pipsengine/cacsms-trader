CREATE TABLE IF NOT EXISTS vision_capture_preprocessing (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL UNIQUE REFERENCES chart_captures(id) ON DELETE CASCADE,
  original_image_url TEXT NOT NULL,
  processed_image_url TEXT NOT NULL,
  perceptual_hash TEXT NOT NULL,
  duplicate_of_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  is_valid_chart BOOLEAN NOT NULL,
  chart_type TEXT NOT NULL,
  detected_symbol TEXT NOT NULL,
  detected_timeframe TEXT NOT NULL,
  chart_area_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  crop_geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  preprocessing_status TEXT NOT NULL,
  chart_quality_score NUMERIC(8, 4) NOT NULL,
  candle_visibility_score NUMERIC(8, 4) NOT NULL,
  blur_score NUMERIC(8, 4) NOT NULL,
  brightness_score NUMERIC(8, 4) NOT NULL,
  contrast_score NUMERIC(8, 4) NOT NULL,
  gridline_score NUMERIC(8, 4) NOT NULL,
  axis_detection_score NUMERIC(8, 4) NOT NULL,
  recommended_next_analysis_step TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vision_capture_preprocessing_hash ON vision_capture_preprocessing(perceptual_hash);
CREATE INDEX IF NOT EXISTS idx_vision_capture_preprocessing_created ON vision_capture_preprocessing(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_capture_preprocessing_valid ON vision_capture_preprocessing(is_valid_chart, chart_quality_score DESC);
