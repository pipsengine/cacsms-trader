CREATE TABLE IF NOT EXISTS timeframe_analysis_snapshots (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  trend_direction TEXT NOT NULL,
  market_structure TEXT NOT NULL,
  last_bos_direction TEXT,
  last_choch_direction TEXT,
  liquidity_status TEXT NOT NULL,
  order_block_status TEXT NOT NULL,
  support_resistance_reaction TEXT NOT NULL,
  candle_momentum TEXT NOT NULL,
  volatility_condition TEXT NOT NULL,
  ai_confidence_score NUMERIC(8, 4) NOT NULL,
  bias TEXT NOT NULL,
  decision_state TEXT NOT NULL,
  structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeframe_alignment_scores (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  left_timeframe TEXT NOT NULL,
  right_timeframe TEXT NOT NULL,
  alignment_state TEXT NOT NULL,
  alignment_score NUMERIC(8, 4) NOT NULL,
  trend_match BOOLEAN NOT NULL,
  structure_match BOOLEAN NOT NULL,
  liquidity_match BOOLEAN NOT NULL,
  order_block_match BOOLEAN NOT NULL,
  support_resistance_match BOOLEAN NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeframe_conflict_logs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  higher_timeframe TEXT NOT NULL,
  lower_timeframe TEXT NOT NULL,
  severity_score NUMERIC(8, 4) NOT NULL,
  description TEXT NOT NULL,
  recommended_resolution TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS multi_timeframe_decisions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  final_decision TEXT NOT NULL,
  final_bias TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  controlling_timeframe TEXT NOT NULL,
  lower_timeframe_confirmation TEXT NOT NULL,
  scalp_only BOOLEAN NOT NULL DEFAULT false,
  market_narrative TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mtf_snapshots_symbol_tf ON timeframe_analysis_snapshots(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_alignment_symbol ON timeframe_alignment_scores(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_conflicts_symbol ON timeframe_conflict_logs(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_decisions_symbol ON multi_timeframe_decisions(symbol, created_at DESC);
