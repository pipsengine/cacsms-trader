CREATE TABLE IF NOT EXISTS structure_analysis_outputs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  current_structure TEXT NOT NULL,
  current_market_phase TEXT NOT NULL,
  institutional_bias TEXT NOT NULL,
  retail_trap_risk NUMERIC(8, 4) NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  trade_decision TEXT NOT NULL,
  mss_status TEXT NOT NULL,
  last_bos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_choch_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  multi_timeframe_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS structure_events (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  candle_index INTEGER NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  validation_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_context_score NUMERIC(8, 4) NOT NULL,
  false_break_risk NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS structure_phase_snapshots (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  phase_state TEXT NOT NULL,
  accumulation_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  expansion_score NUMERIC(8, 4) NOT NULL,
  distribution_score NUMERIC(8, 4) NOT NULL,
  consolidation_score NUMERIC(8, 4) NOT NULL,
  continuation_score NUMERIC(8, 4) NOT NULL,
  reversal_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS structure_feedback (
  id UUID PRIMARY KEY,
  structure_output_id UUID NOT NULL REFERENCES structure_analysis_outputs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_structure_outputs_capture ON structure_analysis_outputs(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_structure_events_capture_type ON structure_events(chart_capture_id, event_type, candle_index DESC);
CREATE INDEX IF NOT EXISTS idx_structure_phase_capture ON structure_phase_snapshots(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_structure_feedback_output ON structure_feedback(structure_output_id, created_at DESC);
