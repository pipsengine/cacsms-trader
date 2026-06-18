CREATE TABLE IF NOT EXISTS platform_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'trader',
  status TEXT NOT NULL DEFAULT 'active',
  managed_by_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_users_role ON platform_users(role);
CREATE INDEX IF NOT EXISTS idx_platform_users_status ON platform_users(status);
CREATE INDEX IF NOT EXISTS idx_platform_users_managed_by ON platform_users(managed_by_user_id);

CREATE TABLE IF NOT EXISTS platform_user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_sessions_user ON platform_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_sessions_expires ON platform_user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS platform_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_user_mt5_config (
  user_id UUID PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  broker_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  server_name TEXT NOT NULL DEFAULT '',
  terminal_id TEXT,
  symbol TEXT NOT NULL DEFAULT 'XAUUSD',
  encrypted_password TEXT,
  encrypted_investor_password TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  last_connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_user_trading_config (
  user_id UUID PRIMARY KEY REFERENCES platform_users(id) ON DELETE CASCADE,
  trading_enabled BOOLEAN NOT NULL DEFAULT false,
  lot_size NUMERIC(12, 4) NOT NULL DEFAULT 0.01,
  risk_per_trade_percent NUMERIC(8, 4) NOT NULL DEFAULT 0.5,
  daily_drawdown_percent NUMERIC(8, 4) NOT NULL DEFAULT 4,
  max_open_trades INTEGER NOT NULL DEFAULT 3,
  basket_limit INTEGER NOT NULL DEFAULT 3,
  profit_lock_enabled BOOLEAN NOT NULL DEFAULT true,
  profit_lock_percent NUMERIC(8, 4) NOT NULL DEFAULT 50,
  gold_engine_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_category ON platform_audit_log(category);
CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON platform_audit_log(actor_user_id);
