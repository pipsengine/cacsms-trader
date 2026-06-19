-- Enterprise multi-account architecture, dynamic role defaults, MFA hooks, EA instances

CREATE TABLE IF NOT EXISTS platform_role_defaults (
  role TEXT PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL
);

INSERT INTO platform_role_defaults (role, permissions)
VALUES
  ('super_admin', '{}'::jsonb),
  ('administrator', '{}'::jsonb),
  ('trader', '{}'::jsonb),
  ('viewer', '{}'::jsonb)
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_trading_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  broker_name TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  terminal_id TEXT,
  symbol TEXT NOT NULL DEFAULT 'XAUUSD',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  trading_enabled BOOLEAN NOT NULL DEFAULT true,
  gold_engine_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_trading_accounts_user ON platform_trading_account_links(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_trading_accounts_primary
  ON platform_trading_account_links(user_id)
  WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS platform_ea_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  trading_account_id UUID REFERENCES platform_trading_account_links(id) ON DELETE SET NULL,
  terminal_id TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL DEFAULT 'XAUUSD',
  ea_name TEXT NOT NULL DEFAULT 'CacsmsTraderEA',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_heartbeat_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_ea_user ON platform_ea_instances(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_ea_terminal ON platform_ea_instances(terminal_id);

CREATE TABLE IF NOT EXISTS platform_user_mfa (
  user_id UUID PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'totp',
  secret_encrypted TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  backup_codes_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE platform_user_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_platform_sessions_active
  ON platform_user_sessions(user_id, expires_at DESC);
