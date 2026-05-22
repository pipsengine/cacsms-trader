CREATE TABLE IF NOT EXISTS rate_decision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL DEFAULT 'Investing.com',
  source_page_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  country TEXT,
  currency TEXT NOT NULL,
  central_bank TEXT,
  event_name TEXT NOT NULL,
  normalized_event_name TEXT NOT NULL,
  release_date DATE NOT NULL,
  release_time TEXT,
  actual_rate NUMERIC(12,6),
  forecast_rate NUMERIC(12,6),
  previous_rate NUMERIC(12,6),
  rate_change_bps INTEGER,
  decision_type TEXT,
  surprise_direction TEXT,
  policy_bias TEXT,
  data_quality_status TEXT NOT NULL DEFAULT 'OK',
  source_reliability_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  raw_row_hash TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_page_id, currency, normalized_event_name, release_date)
);

CREATE INDEX IF NOT EXISTS idx_rate_decision_history_release_date ON rate_decision_history (release_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_decision_history_currency_date ON rate_decision_history (currency, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_decision_history_page_date ON rate_decision_history (source_page_id, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_decision_history_decision ON rate_decision_history (decision_type, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_decision_history_surprise ON rate_decision_history (surprise_direction, release_date DESC);

CREATE TABLE IF NOT EXISTS rate_decision_history_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  source_page_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success','error','warning','info')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_decision_history_logs_fetched ON rate_decision_history_logs (fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_decision_history_logs_page ON rate_decision_history_logs (source_page_id, fetched_at DESC);
