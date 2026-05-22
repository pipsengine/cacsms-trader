CREATE TABLE IF NOT EXISTS cot_institutional_positions (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  currency TEXT NOT NULL,
  market_name TEXT,
  cftc_market_code TEXT,
  exchange TEXT,
  long_positions BIGINT,
  short_positions BIGINT,
  change_long BIGINT,
  change_short BIGINT,
  percent_change NUMERIC,
  net_positions BIGINT,
  net_change BIGINT,
  bias TEXT,
  bias_strength INTEGER,
  report_type TEXT NOT NULL DEFAULT 'FUTURES_ONLY',
  source_name TEXT NOT NULL DEFAULT 'CFTC',
  source_url TEXT,
  source_year INTEGER,
  raw_contract_market_name TEXT,
  raw_row_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cot_institutional_positions_unique
ON cot_institutional_positions (report_date, currency, report_type);

CREATE INDEX IF NOT EXISTS cot_institutional_positions_report_date_idx
ON cot_institutional_positions (report_date DESC);

CREATE INDEX IF NOT EXISTS cot_institutional_positions_currency_idx
ON cot_institutional_positions (currency, report_date DESC);

CREATE INDEX IF NOT EXISTS cot_institutional_positions_bias_idx
ON cot_institutional_positions (bias, report_date DESC);

CREATE INDEX IF NOT EXISTS cot_institutional_positions_source_year_idx
ON cot_institutional_positions (source_year, report_date DESC);

CREATE TABLE IF NOT EXISTS cot_source_logs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details JSONB,
  source_url TEXT,
  source_year INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cot_source_logs_fetched_at_idx
ON cot_source_logs (fetched_at DESC);
