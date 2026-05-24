CREATE TABLE IF NOT EXISTS chart_segments (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  price_low NUMERIC(18, 6) NOT NULL,
  price_high NUMERIC(18, 6) NOT NULL,
  start_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  end_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  segment_type TEXT NOT NULL,
  volatility_regime TEXT NOT NULL,
  structure_regime TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_classifications (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL,
  market_meaning TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  trading_relevance TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_confidence_scores (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  confidence_score NUMERIC(8, 4) NOT NULL,
  change_point_score NUMERIC(8, 4) NOT NULL,
  regime_score NUMERIC(8, 4) NOT NULL,
  visual_score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_ai_explanations (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  explanation_text TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'chart-segmentation-hybrid-v1',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS segment_feedback (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_segments_capture
  ON chart_segments(chart_capture_id, start_candle_index);

CREATE INDEX IF NOT EXISTS idx_chart_segments_symbol_tf
  ON chart_segments(symbol, timeframe, created_at DESC);
