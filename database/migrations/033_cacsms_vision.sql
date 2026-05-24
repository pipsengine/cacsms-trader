CREATE TABLE IF NOT EXISTS cacsms_vision_scans (
  id UUID PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeframes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS cacsms_vision_analysis (
  id UUID PRIMARY KEY,
  scan_id UUID REFERENCES cacsms_vision_scans(id) ON DELETE SET NULL,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  capture_status TEXT NOT NULL,
  analysis_status TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  market_meaning TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  retail_trap_warning TEXT NOT NULL,
  liquidity_map_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  order_blocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  fair_value_gaps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  anomaly_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  segmentation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fair_value_gaps (
  id UUID PRIMARY KEY,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  price_low NUMERIC(18, 6),
  price_high NUMERIC(18, 6),
  start_candle_index INTEGER,
  end_candle_index INTEGER,
  fill_status TEXT NOT NULL DEFAULT 'open',
  confidence_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_health_logs (
  id UUID PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cacsms_vision_analysis_symbol_tf
  ON cacsms_vision_analysis(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cacsms_vision_scans_started
  ON cacsms_vision_scans(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_fair_value_gaps_symbol_tf
  ON fair_value_gaps(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_trace
  ON audit_logs(trace_id, created_at);
