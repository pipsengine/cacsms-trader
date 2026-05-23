CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS central_bank_rate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  country TEXT,
  central_bank TEXT,
  event_name TEXT NOT NULL,
  investing_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_central_bank_rate_events_currency ON central_bank_rate_events(currency);
CREATE INDEX IF NOT EXISTS idx_central_bank_rate_events_active ON central_bank_rate_events(is_active);

CREATE TABLE IF NOT EXISTS central_bank_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER NOT NULL REFERENCES central_bank_rate_events(event_id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  central_bank TEXT,
  release_date DATE NOT NULL,
  release_time TEXT NOT NULL DEFAULT '',
  actual_rate NUMERIC(12,6),
  forecast_rate NUMERIC(12,6),
  previous_rate NUMERIC(12,6),
  rate_change NUMERIC(12,6),
  surprise NUMERIC(12,6),
  bias TEXT,
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE central_bank_rate_history
  DROP CONSTRAINT IF EXISTS uq_central_bank_rate_history_event_date_time;

CREATE UNIQUE INDEX IF NOT EXISTS uq_central_bank_rate_history_event_date_time
  ON central_bank_rate_history(event_id, currency, release_date, release_time);

CREATE INDEX IF NOT EXISTS idx_central_bank_rate_history_currency_date ON central_bank_rate_history(currency, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_central_bank_rate_history_event_date ON central_bank_rate_history(event_id, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_central_bank_rate_history_fetched ON central_bank_rate_history(fetched_at DESC);

CREATE TABLE IF NOT EXISTS rate_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id INTEGER,
  currency TEXT,
  sync_started_at TIMESTAMPTZ NOT NULL,
  sync_completed_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  rows_fetched INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_rate_sync_logs_started ON rate_sync_logs(sync_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_sync_logs_event_started ON rate_sync_logs(event_id, sync_started_at DESC);
