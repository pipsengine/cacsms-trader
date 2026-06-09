CREATE TABLE IF NOT EXISTS execution_open_positions (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES mt5_terminals(terminal_id) ON DELETE CASCADE,
  ticket TEXT NOT NULL,
  open_command_id TEXT NOT NULL,
  symbol TEXT,
  side TEXT,
  volume_lots NUMERIC(18, 6),
  entry_price NUMERIC(18, 6),
  stop_loss NUMERIC(18, 6),
  take_profit NUMERIC(18, 6),
  current_price NUMERIC(18, 6),
  profit_loss NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  last_action TEXT,
  last_action_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_open_positions_terminal_ticket_uidx
  ON execution_open_positions (terminal_id, ticket)
  WHERE status IN ('open', 'partial');

CREATE INDEX IF NOT EXISTS execution_open_positions_terminal_status_idx
  ON execution_open_positions (terminal_id, status, opened_at DESC);
