CREATE TABLE IF NOT EXISTS ea_deployment_configs (
  id BIGSERIAL PRIMARY KEY,
  terminal_hash TEXT NOT NULL,
  project_ea_folder TEXT NOT NULL,
  mt5_data_folder TEXT NOT NULL,
  mt5_experts_folder TEXT NOT NULL,
  target_folder_name TEXT NOT NULL,
  deployment_method TEXT NOT NULL CHECK (deployment_method IN ('SYMLINK', 'COPY')),
  environment TEXT NOT NULL CHECK (environment IN ('DEMO', 'LIVE', 'PROP', 'MARKET_DATA_MONITOR', 'FAILOVER_RESERVE')),
  ea_source_folder TEXT,
  ea_compiled_folder TEXT,
  mt5_terminal_name TEXT,
  broker_account_label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (terminal_hash, target_folder_name)
);

CREATE TABLE IF NOT EXISTS ea_deployment_runs (
  run_id TEXT PRIMARY KEY,
  config_id BIGINT NOT NULL REFERENCES ea_deployment_configs(id) ON DELETE CASCADE,
  deployment_method TEXT NOT NULL CHECK (deployment_method IN ('SYMLINK', 'COPY')),
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  verification JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ea_deployment_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ea_deployment_runs(run_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR')),
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_deployment_configs_updated ON ea_deployment_configs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_deployment_runs_created ON ea_deployment_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_deployment_logs_run_time ON ea_deployment_logs(run_id, timestamp DESC);

