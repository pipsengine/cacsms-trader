CREATE TABLE IF NOT EXISTS order_block_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL,
  origin_candle_index INTEGER NOT NULL,
  displacement_candle_index INTEGER NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  open_price NUMERIC(18, 6) NOT NULL,
  close_price NUMERIC(18, 6) NOT NULL,
  invalidation_level NUMERIC(18, 6) NOT NULL,
  mitigation_status TEXT NOT NULL,
  mitigation_percentage NUMERIC(8, 4) NOT NULL,
  displacement_strength NUMERIC(8, 4) NOT NULL,
  body_dominance_score NUMERIC(8, 4) NOT NULL,
  range_expansion_score NUMERIC(8, 4) NOT NULL,
  bos_confirmed BOOLEAN NOT NULL DEFAULT false,
  bos_strength NUMERIC(8, 4) NOT NULL,
  fvg_confirmed BOOLEAN NOT NULL DEFAULT false,
  fvg_score NUMERIC(8, 4) NOT NULL,
  participation_proxy_score NUMERIC(8, 4) NOT NULL,
  freshness_score NUMERIC(8, 4) NOT NULL,
  liquidity_proximity_score NUMERIC(8, 4) NOT NULL,
  htf_alignment_score NUMERIC(8, 4) NOT NULL,
  quality_score NUMERIC(8, 4) NOT NULL,
  institutional_relevance TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_block_mitigation_events (
  id UUID PRIMARY KEY,
  order_block_id UUID NOT NULL REFERENCES order_block_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  mitigation_type TEXT NOT NULL,
  penetration_percentage NUMERIC(8, 4) NOT NULL,
  reaction_score NUMERIC(8, 4) NOT NULL,
  invalidated BOOLEAN NOT NULL DEFAULT false,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_block_feedback (
  id UUID PRIMARY KEY,
  order_block_id UUID NOT NULL REFERENCES order_block_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_blocks_capture_quality ON order_block_detections(chart_capture_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_order_blocks_capture_status ON order_block_detections(chart_capture_id, mitigation_status);
CREATE INDEX IF NOT EXISTS idx_order_block_mitigations_capture ON order_block_mitigation_events(chart_capture_id, candle_index DESC);
CREATE INDEX IF NOT EXISTS idx_order_block_feedback ON order_block_feedback(order_block_id, created_at DESC);
