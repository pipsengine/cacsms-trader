CREATE TABLE IF NOT EXISTS candle_classifications (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  reconstructed_candle_id UUID REFERENCES reconstructed_candles(id) ON DELETE SET NULL,
  candle_index INTEGER NOT NULL,
  detected_candle_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  trading_meaning TEXT NOT NULL,
  implication TEXT NOT NULL,
  supports_decision TEXT NOT NULL,
  body_strength_score NUMERIC(8, 4) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  momentum_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  institutional_displacement_score NUMERIC(8, 4) NOT NULL,
  candle_reliability_score NUMERIC(8, 4) NOT NULL,
  final_confidence_score NUMERIC(8, 4) NOT NULL,
  risk_warning TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candle_sequence_analyses (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  sequence_start_index INTEGER NOT NULL,
  sequence_end_index INTEGER NOT NULL,
  detected_sequence_type TEXT NOT NULL,
  phase_state TEXT NOT NULL,
  momentum_state TEXT NOT NULL,
  implication TEXT NOT NULL,
  supports_decision TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  risk_warning TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candle_classification_feedback (
  id UUID PRIMARY KEY,
  candle_classification_id UUID NOT NULL REFERENCES candle_classifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candle_classifications_capture_index ON candle_classifications(chart_capture_id, candle_index);
CREATE INDEX IF NOT EXISTS idx_candle_classifications_type ON candle_classifications(chart_capture_id, detected_candle_type);
CREATE INDEX IF NOT EXISTS idx_candle_sequence_capture ON candle_sequence_analyses(chart_capture_id, sequence_start_index, sequence_end_index);
CREATE INDEX IF NOT EXISTS idx_candle_feedback_classification ON candle_classification_feedback(candle_classification_id, created_at DESC);
