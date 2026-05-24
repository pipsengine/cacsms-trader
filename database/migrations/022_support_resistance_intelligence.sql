CREATE TABLE IF NOT EXISTS support_resistance_zones (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  zone_type TEXT NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  midpoint_price NUMERIC(18, 6) NOT NULL,
  touch_count INTEGER NOT NULL,
  weighted_touch_score NUMERIC(8, 4) NOT NULL,
  freshness_score NUMERIC(8, 4) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  break_probability NUMERIC(8, 4) NOT NULL,
  retest_probability NUMERIC(8, 4) NOT NULL,
  liquidity_attraction_score NUMERIC(8, 4) NOT NULL,
  psychological_score NUMERIC(8, 4) NOT NULL,
  institutional_defense_score NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  broken_role TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_resistance_liquidity (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES support_resistance_zones(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  liquidity_side TEXT NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  stop_pool_score NUMERIC(8, 4) NOT NULL,
  attraction_score NUMERIC(8, 4) NOT NULL,
  sweep_probability NUMERIC(8, 4) NOT NULL,
  reversal_probability NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_resistance_feedback (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES support_resistance_zones(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sr_zones_capture_strength ON support_resistance_zones(chart_capture_id, strength_score DESC);
CREATE INDEX IF NOT EXISTS idx_sr_liquidity_capture ON support_resistance_liquidity(chart_capture_id, attraction_score DESC);
CREATE INDEX IF NOT EXISTS idx_sr_feedback_zone ON support_resistance_feedback(zone_id, created_at DESC);
