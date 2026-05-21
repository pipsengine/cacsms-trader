CREATE TABLE IF NOT EXISTS ea_comm_events (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  channel TEXT NOT NULL CHECK (channel IN ('HEARTBEAT','COMMAND','TICK','AUTH','HANDSHAKE','BRIDGE','ERROR')),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('DEBUG','INFO','SUCCESS','WARNING','ERROR')),
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ea_comm_events_time ON ea_comm_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_comm_events_terminal_time ON ea_comm_events(terminal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ea_comm_events_type_time ON ea_comm_events(event_type, created_at DESC);
