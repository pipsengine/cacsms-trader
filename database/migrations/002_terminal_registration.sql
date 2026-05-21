CREATE TABLE IF NOT EXISTS mt5_vps_nodes (
  vps_id TEXT PRIMARY KEY,
  computer_name TEXT NOT NULL,
  region TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'online', 'offline', 'degraded', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mt5_broker_accounts (
  account_number TEXT PRIMARY KEY,
  broker_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mt5_terminal_registrations (
  terminal_id TEXT PRIMARY KEY,
  terminal_name TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  computer_name TEXT NOT NULL,
  account_number TEXT NOT NULL REFERENCES mt5_broker_accounts(account_number),
  broker_name TEXT NOT NULL,
  server_name TEXT NOT NULL,
  mt5_build INTEGER NOT NULL,
  ea_version TEXT NOT NULL,
  terminal_type TEXT NOT NULL,
  environment TEXT NOT NULL,
  region TEXT NOT NULL,
  vps_id TEXT REFERENCES mt5_vps_nodes(vps_id),
  priority INTEGER NOT NULL DEFAULT 50,
  tags TEXT[] NOT NULL DEFAULT '{}',
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  token_hash TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending_heartbeat' CHECK (approval_status IN ('pending_heartbeat', 'approved', 'failed', 'retired')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mt5_registration_attempts (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES mt5_terminal_registrations(terminal_id),
  status TEXT NOT NULL,
  error_code TEXT,
  message TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mt5_terminal_registrations_account ON mt5_terminal_registrations(account_number);
CREATE INDEX IF NOT EXISTS idx_mt5_terminal_registrations_vps ON mt5_terminal_registrations(vps_id);
CREATE INDEX IF NOT EXISTS idx_mt5_registration_attempts_terminal_created ON mt5_registration_attempts(terminal_id, created_at DESC);
