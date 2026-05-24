CREATE TABLE IF NOT EXISTS visual_market_interpretation_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  error_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS visual_market_interpretations (
  id UUID PRIMARY KEY,
  job_id UUID,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  dominant_timeframe TEXT NOT NULL,
  final_market_bias TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  liquidity_objective TEXT NOT NULL,
  market_phase TEXT NOT NULL,
  setup_readiness_score NUMERIC(8, 4) NOT NULL,
  final_decision TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  entry_readiness TEXT NOT NULL,
  invalidation_condition TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  full_ai_market_narrative TEXT NOT NULL,
  previous_interpretation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE visual_market_interpretations
  ADD COLUMN IF NOT EXISTS job_id UUID;

CREATE TABLE IF NOT EXISTS final_decision_scores (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeframe_control_states (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  bias TEXT NOT NULL,
  control_score NUMERIC(8, 4) NOT NULL,
  confirms_entry BOOLEAN NOT NULL DEFAULT false,
  narrative_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS institutional_bias_logs (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  bias TEXT NOT NULL,
  interpretation_text TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS setup_readiness_scores (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  readiness_score NUMERIC(8, 4) NOT NULL,
  entry_readiness TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visual_decision_audit_trails (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  finding TEXT NOT NULL,
  score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visual_market_interpretations_symbol
  ON visual_market_interpretations(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visual_market_interpretations_symbol_tf
  ON visual_market_interpretations(symbol, timeframe, created_at DESC);
