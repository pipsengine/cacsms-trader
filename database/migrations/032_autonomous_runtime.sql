CREATE TABLE IF NOT EXISTS autonomous_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT,
  timeframe TEXT,
  worker_name TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(8, 4),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_run_time TIMESTAMPTZ,
  audit_trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_job_runs (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES autonomous_jobs(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score NUMERIC(8, 4),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS autonomous_schedules (
  id UUID PRIMARY KEY,
  worker_name TEXT NOT NULL,
  schedule_key TEXT NOT NULL UNIQUE,
  symbol TEXT,
  timeframe TEXT,
  cadence_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_worker_status (
  worker_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  current_job_id UUID,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  processed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS autonomous_scan_cycles (
  id UUID PRIMARY KEY,
  cycle_type TEXT NOT NULL,
  status TEXT NOT NULL,
  symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeframes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS autonomous_symbol_queue (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'queued',
  reason TEXT NOT NULL,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_timeframe_queue (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 5,
  next_scan_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_failures (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  worker_name TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  failure_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  escalated BOOLEAN NOT NULL DEFAULT false,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_retry_logs (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  retry_number INTEGER NOT NULL,
  backoff_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_decision_logs (
  id UUID PRIMARY KEY,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  dominant_timeframe TEXT NOT NULL,
  final_bias TEXT NOT NULL,
  setup_type TEXT NOT NULL,
  setup_readiness_score NUMERIC(8, 4) NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  risk_score NUMERIC(8, 4) NOT NULL,
  decision TEXT NOT NULL,
  entry_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_loss NUMERIC(18, 6),
  take_profit_levels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidation_level NUMERIC(18, 6),
  reason_for_decision TEXT NOT NULL,
  reason_against_decision TEXT NOT NULL,
  macro_risk_warning TEXT NOT NULL,
  liquidity_warning TEXT NOT NULL,
  anomaly_warning TEXT NOT NULL,
  recommended_next_action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_alerts (
  id UUID PRIMARY KEY,
  decision_log_id UUID REFERENCES autonomous_decision_logs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  severity TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS autonomous_model_feedback (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_type TEXT NOT NULL,
  feedback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_outcome_tracking (
  id UUID PRIMARY KEY,
  decision_log_id UUID REFERENCES autonomous_decision_logs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL,
  outcome_status TEXT NOT NULL DEFAULT 'pending',
  pnl_r_multiple NUMERIC(10, 4),
  reviewed_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_system_health (
  id UUID PRIMARY KEY,
  health_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  emergency_stopped BOOLEAN NOT NULL DEFAULT false,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_audit_trails (
  id UUID PRIMARY KEY,
  audit_trace_id UUID NOT NULL,
  job_id UUID REFERENCES autonomous_jobs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS autonomous_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_jobs_status
  ON autonomous_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_jobs_symbol_tf
  ON autonomous_jobs(symbol, timeframe, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_failures_worker
  ON autonomous_failures(worker_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_symbol_tf
  ON autonomous_decision_logs(symbol, timeframe, created_at DESC);
