CREATE TABLE IF NOT EXISTS autonomous_pair_selections (
  id UUID PRIMARY KEY,
  selected_symbol TEXT NOT NULL,
  selected_symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  session TEXT,
  source TEXT NOT NULL DEFAULT 'autonomous_scan',
  composite_score NUMERIC(8, 4),
  reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autonomous_pair_selections_created ON autonomous_pair_selections(created_at DESC);
