ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS lifecycle_state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (
    lifecycle_state IN ('QUEUED','ROUTING','SENT','ACKNOWLEDGED','EXECUTED','FAILED','TIMEOUT','CANCELLED')
  );

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'DEMO' CHECK (
    environment IN ('DEMO','LIVE','PROP','MARKET_DATA_MONITOR','FAILOVER_RESERVE')
  );

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS sandbox_mode BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS routed_terminal_id TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS routed_at TIMESTAMPTZ;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS ack_status TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS broker_message TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS ticket TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS executed_price NUMERIC(18, 5);

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS executed_volume_lots NUMERIC(18, 4);

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS slippage_points INTEGER;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS spread_points INTEGER;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS symbol TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS side TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE execution_commands
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_execution_commands_state ON execution_commands(lifecycle_state, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_commands_env ON execution_commands(environment, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_commands_dedupe ON execution_commands(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_command_events (
  id BIGSERIAL PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES execution_commands(command_id) ON DELETE CASCADE,
  terminal_id TEXT,
  lifecycle_state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('DEBUG','INFO','SUCCESS','WARNING','ERROR')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_execution_command_events_cmd_time ON execution_command_events(command_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_command_events_time ON execution_command_events(created_at DESC);

