CREATE TABLE IF NOT EXISTS ai_visual_interpretations (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  title TEXT NOT NULL,
  full_explanation TEXT NOT NULL,
  dominant_bias TEXT NOT NULL,
  institutional_behavior TEXT NOT NULL,
  institutional_narrative TEXT NOT NULL,
  retail_trap_warning TEXT NOT NULL,
  liquidity_narrative TEXT NOT NULL,
  market_structure_narrative TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  market_clarity_score NUMERIC(8, 4) NOT NULL,
  setup_quality_score NUMERIC(8, 4) NOT NULL,
  decision TEXT NOT NULL,
  entry_logic TEXT NOT NULL,
  invalidation_logic TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  dominant_story TEXT NOT NULL,
  higher_timeframe_context TEXT NOT NULL,
  ranked_structures_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning_timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_reasoning_components (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  component_weight NUMERIC(8, 4) NOT NULL,
  bias TEXT NOT NULL,
  score NUMERIC(8, 4) NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  summary_text TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_market_narratives (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  narrative_type TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_decision_breakdowns (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_visual_interpretations_capture
  ON ai_visual_interpretations(chart_capture_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_visual_interpretations_symbol_tf
  ON ai_visual_interpretations(symbol, timeframe, created_at DESC);
