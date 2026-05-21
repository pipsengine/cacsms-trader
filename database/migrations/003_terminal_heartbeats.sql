CREATE TABLE IF NOT EXISTS mt5_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES mt5_terminals(terminal_id) ON DELETE CASCADE,
  account_number TEXT NOT NULL REFERENCES trading_accounts(account_number),
  sequence BIGINT NOT NULL DEFAULT 0,
  connection_status TEXT NOT NULL CHECK (connection_status IN ('connected', 'degraded', 'disconnected')),
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tick_time TIMESTAMPTZ NOT NULL,
  terminal_time TIMESTAMPTZ NOT NULL,
  mt5_server_time TIMESTAMPTZ NOT NULL,
  nigeria_time TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  open_orders INTEGER NOT NULL DEFAULT 0,
  balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  equity NUMERIC(18, 2) NOT NULL DEFAULT 0,
  margin NUMERIC(18, 2) NOT NULL DEFAULT 0,
  free_margin NUMERIC(18, 2) NOT NULL DEFAULT 0,
  version TEXT NOT NULL DEFAULT 'unknown',
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mt5_heartbeats_terminal_received ON mt5_heartbeats(terminal_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt5_heartbeats_account_received ON mt5_heartbeats(account_number, received_at DESC);
