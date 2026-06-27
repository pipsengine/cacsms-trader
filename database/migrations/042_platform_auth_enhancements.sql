-- MFA login pending tokens, user invites, trading account connection status, continuous session user scope

CREATE TABLE IF NOT EXISTS platform_login_mfa_pending (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_login_mfa_pending_expires
  ON platform_login_mfa_pending(expires_at);

CREATE TABLE IF NOT EXISTS platform_user_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'trader',
  invited_by_user_id UUID REFERENCES platform_users(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_user_invites_email ON platform_user_invites(email);

ALTER TABLE platform_trading_account_links
  ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'unknown';

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_ea_user_terminal
  ON platform_ea_instances(user_id, terminal_id);
