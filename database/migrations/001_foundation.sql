CREATE TABLE IF NOT EXISTS trading_accounts (
  account_number TEXT PRIMARY KEY,
  broker_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('demo', 'live', 'prop_firm')),
  currency TEXT NOT NULL,
  balance NUMERIC(18, 2) NOT NULL,
  equity NUMERIC(18, 2) NOT NULL,
  margin NUMERIC(18, 2) NOT NULL,
  free_margin NUMERIC(18, 2) NOT NULL,
  peak_equity_today NUMERIC(18, 2) NOT NULL,
  starting_equity_today NUMERIC(18, 2) NOT NULL,
  peak_equity_all_time NUMERIC(18, 2) NOT NULL,
  open_trade_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mt5_terminals (
  terminal_id TEXT PRIMARY KEY,
  account_number TEXT NOT NULL REFERENCES trading_accounts(account_number),
  connection_status TEXT NOT NULL CHECK (connection_status IN ('connected', 'degraded', 'disconnected')),
  last_tick_time TIMESTAMPTZ NOT NULL,
  terminal_time TIMESTAMPTZ NOT NULL,
  mt5_server_time TIMESTAMPTZ NOT NULL,
  nigeria_time TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER NOT NULL,
  open_orders INTEGER NOT NULL DEFAULT 0,
  version TEXT NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id BIGSERIAL PRIMARY KEY,
  account_number TEXT NOT NULL REFERENCES trading_accounts(account_number),
  intent_id TEXT,
  allowed BOOLEAN NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  remaining_daily_loss_amount NUMERIC(18, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS execution_commands (
  command_id TEXT PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES mt5_terminals(terminal_id),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mt5_terminals_account_number ON mt5_terminals(account_number);
CREATE INDEX IF NOT EXISTS idx_risk_decisions_account_created ON risk_decisions(account_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_commands_terminal_status ON execution_commands(terminal_id, status);
