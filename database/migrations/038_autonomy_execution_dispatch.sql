CREATE TABLE IF NOT EXISTS autonomy_execution_dispatches (
  id UUID PRIMARY KEY,
  decision_log_id UUID NOT NULL REFERENCES autonomous_decision_logs(id) ON DELETE CASCADE,
  command_id TEXT,
  terminal_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('blocked', 'queued', 'dispatched', 'failed')),
  blockers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS autonomy_execution_dispatches_decision_uidx
  ON autonomy_execution_dispatches (decision_log_id);

CREATE INDEX IF NOT EXISTS autonomy_execution_dispatches_status_created_idx
  ON autonomy_execution_dispatches (status, created_at DESC);
