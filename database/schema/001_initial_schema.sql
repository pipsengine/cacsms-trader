-- Cacsms Trader · Initial schema (SQLite)
-- Version: 1
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','number','boolean','json')),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator','viewer','auditor')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash_ref TEXT, -- secret reference only; never store plaintext passwords
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','ERROR','SECURITY','TRADE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','ERROR','SUCCESS')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_system_events_created ON system_events(created_at);

-- Instruments (29 canonical)
CREATE TABLE IF NOT EXISTS instruments (
  symbol TEXT PRIMARY KEY,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('FX','METAL')),
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  digits INTEGER NOT NULL DEFAULT 5 CHECK (digits BETWEEN 0 AND 8),
  pip_size REAL NOT NULL DEFAULT 0.0001,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 3 AND 3),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'FIAT' CHECK (kind IN ('FIAT','METAL')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);

CREATE TABLE IF NOT EXISTS currency_strength (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('Q1','MN1','W1','D1')),
  score REAL NOT NULL,
  trend TEXT,
  classification TEXT,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(currency_code, timeframe, as_of)
);
CREATE INDEX IF NOT EXISTS idx_currency_strength_asof ON currency_strength(as_of);

CREATE TABLE IF NOT EXISTS historical_regime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  state TEXT NOT NULL,
  persistence REAL,
  acceleration REAL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(currency_code, as_of)
);

CREATE TABLE IF NOT EXISTS market_structure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  timeframe TEXT NOT NULL CHECK (timeframe IN ('D1','H8','H1')),
  direction TEXT,
  channel_status TEXT,
  channel_position REAL,
  confidence REAL,
  phase TEXT,
  choch INTEGER DEFAULT 0 CHECK (choch IN (0,1)),
  bos INTEGER DEFAULT 0 CHECK (bos IN (0,1)),
  confirmed INTEGER DEFAULT 0 CHECK (confirmed IN (0,1)),
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, timeframe, as_of)
);
CREATE INDEX IF NOT EXISTS idx_market_structure_symbol ON market_structure(symbol, timeframe);

CREATE TABLE IF NOT EXISTS world_model_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  version INTEGER NOT NULL,
  bid REAL,
  ask REAL,
  spread REAL,
  macro_bias TEXT,
  regime TEXT,
  d1_state TEXT,
  h8_state TEXT,
  h1_state TEXT,
  exposure TEXT,
  risk_available REAL,
  decision TEXT,
  confidence REAL,
  data_quality REAL,
  payload_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, version)
);
CREATE INDEX IF NOT EXISTS idx_world_model_symbol ON world_model_snapshots(symbol, updated_at);

-- Workflow Engine
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','PAUSED','COMPLETED','FAILED')),
  execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (execution_enabled IN (0,1)),
  mode TEXT NOT NULL DEFAULT 'SIMULATION' CHECK (mode IN ('SIMULATION','PAPER','LIVE')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS workflow_stage_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL CHECK (stage_id BETWEEN 1 AND 10),
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','waiting','blocked','error','paused','idle')),
  confidence REAL,
  latency_ms INTEGER,
  freshness_sec INTEGER,
  processed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  message TEXT,
  input_json TEXT,
  output_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(run_id, stage_id)
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  stage_id INTEGER,
  symbol TEXT REFERENCES instruments(symbol),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  detail TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_events_run ON workflow_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS workflow_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL,
  symbol TEXT,
  error_code TEXT,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  decision TEXT NOT NULL CHECK (decision IN ('WAIT','WATCH','QUALIFIED','BLOCKED','BUY','SELL','EXIT','READY','OPEN')),
  reason TEXT,
  confidence REAL,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_decisions_symbol ON workflow_decisions(symbol, created_at);

-- MT5 infrastructure
CREATE TABLE IF NOT EXISTS mt5_brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('RETAIL','PROP','DEMO')),
  website TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mt5_servers (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES mt5_brokers(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('DEMO','LIVE')),
  UNIQUE(broker_id, server_name)
);

CREATE TABLE IF NOT EXISTS mt5_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTED','DISCONNECTED','DEGRADED')),
  version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mt5_terminals (
  id TEXT PRIMARY KEY, -- e.g. CACSMS-MT5-0001
  node_id TEXT REFERENCES mt5_nodes(id) ON DELETE SET NULL,
  path_ref TEXT, -- path reference, not secrets
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  last_heartbeat TEXT,
  heartbeat_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mt5_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_class TEXT NOT NULL CHECK (account_class IN ('DEMO','LIVE','PROP')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  broker_id TEXT REFERENCES mt5_brokers(id),
  server_id TEXT REFERENCES mt5_servers(id),
  firm_name TEXT,
  login TEXT NOT NULL,
  credential_secret_ref TEXT, -- NEVER plaintext password
  terminal_id TEXT REFERENCES mt5_terminals(id),
  state TEXT NOT NULL DEFAULT 'DISCONNECTED',
  trading_mode TEXT NOT NULL DEFAULT 'ANALYSIS_ONLY' CHECK (trading_mode IN ('ANALYSIS_ONLY','APPROVAL_REQUIRED','AUTONOMOUS')),
  trading_enabled INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0,1)),
  leverage INTEGER NOT NULL DEFAULT 100,
  risk_profile TEXT NOT NULL DEFAULT 'BALANCED',
  max_concurrent_trades INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(server_id, login)
);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_class ON mt5_accounts(account_class, currency);

CREATE TABLE IF NOT EXISTS mt5_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  latency_ms INTEGER,
  connected_at TEXT,
  disconnected_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mt5_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  terminal_id TEXT REFERENCES mt5_terminals(id) ON DELETE CASCADE,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mt5_heartbeats_created ON mt5_heartbeats(created_at);

CREATE TABLE IF NOT EXISTS account_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  balance REAL NOT NULL,
  equity REAL NOT NULL,
  margin REAL NOT NULL DEFAULT 0,
  free_margin REAL NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  as_of TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, as_of)
);
CREATE INDEX IF NOT EXISTS idx_account_balances_account ON account_balances(account_id, as_of);

CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  balance REAL NOT NULL,
  equity REAL NOT NULL,
  margin REAL NOT NULL,
  free_margin REAL NOT NULL,
  profit REAL NOT NULL,
  open_positions INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prop_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  firm_name TEXT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prop_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES prop_profiles(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('CHALLENGE','VERIFICATION','FUNDED')),
  account_size REAL NOT NULL CHECK (account_size > 0),
  daily_loss_limit_pct REAL NOT NULL CHECK (daily_loss_limit_pct > 0),
  max_loss_limit_pct REAL NOT NULL CHECK (max_loss_limit_pct > 0),
  profit_target_pct REAL NOT NULL CHECK (profit_target_pct >= 0),
  min_trading_days INTEGER,
  max_trading_days INTEGER,
  news_trading INTEGER NOT NULL DEFAULT 0 CHECK (news_trading IN (0,1)),
  weekend_holding INTEGER NOT NULL DEFAULT 0 CHECK (weekend_holding IN (0,1)),
  overnight_holding INTEGER NOT NULL DEFAULT 1 CHECK (overnight_holding IN (0,1)),
  max_exposure_pct REAL NOT NULL DEFAULT 1,
  consistency_rule_pct REAL,
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (daily_loss_limit_pct <= max_loss_limit_pct)
);

CREATE TABLE IF NOT EXISTS account_prop_bindings (
  account_id TEXT PRIMARY KEY REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES prop_profiles(id),
  rule_id INTEGER REFERENCES prop_rules(id),
  bound_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prop_compliance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','WATCH')),
  detail TEXT,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS symbol_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  canonical_symbol TEXT NOT NULL REFERENCES instruments(symbol),
  broker_symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  digits INTEGER NOT NULL DEFAULT 5,
  min_lot REAL NOT NULL DEFAULT 0.01,
  max_lot REAL NOT NULL DEFAULT 100,
  lot_step REAL NOT NULL DEFAULT 0.01,
  tick_size REAL NOT NULL DEFAULT 0.00001,
  tick_value REAL NOT NULL DEFAULT 1,
  spread REAL,
  status TEXT NOT NULL DEFAULT 'MAPPED' CHECK (status IN ('MAPPED','UNMAPPED','UNAVAILABLE')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, canonical_symbol)
);

CREATE TABLE IF NOT EXISTS market_candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  timeframe TEXT NOT NULL,
  open_time TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'broker',
  UNIQUE(symbol, timeframe, open_time)
);
CREATE INDEX IF NOT EXISTS idx_market_candles_lookup ON market_candles(symbol, timeframe, open_time);

-- Opportunities / risk / execution
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL')),
  score REAL,
  stage INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN',
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS trade_decisions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  decision TEXT NOT NULL,
  reason TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  reasons_json TEXT,
  checks_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  approved INTEGER NOT NULL CHECK (approved IN (0,1)),
  risk_pct REAL,
  reasons_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS position_sizing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  equity REAL NOT NULL,
  risk_pct REAL NOT NULL,
  volume REAL NOT NULL,
  risk_budget REAL,
  estimated_risk REAL,
  valid INTEGER NOT NULL CHECK (valid IN (0,1)),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_eligibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  gateway_ready INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_requests (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id),
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  volume REAL NOT NULL CHECK (volume > 0),
  sl REAL,
  tp REAL,
  client_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','FILLED','REJECTED','CANCELLED')),
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_execution_requests_account ON execution_requests(account_id, created_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  execution_request_id TEXT REFERENCES execution_requests(id),
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id),
  mt5_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  volume REAL NOT NULL,
  price REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id),
  mt5_deal_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  volume REAL NOT NULL,
  price REAL NOT NULL,
  profit REAL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id),
  cacsms_trade_id TEXT NOT NULL,
  mt5_position_id TEXT,
  mt5_order_id TEXT,
  mt5_deal_id TEXT,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  volume REAL NOT NULL,
  entry REAL NOT NULL,
  current REAL,
  sl REAL,
  tp REAL,
  pnl REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED','PENDING','MISMATCH')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE(account_id, cacsms_trade_id)
);
CREATE INDEX IF NOT EXISTS idx_positions_account_status ON positions(account_id, status);

CREATE TABLE IF NOT EXISTS sl_tp_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  old_sl REAL,
  new_sl REAL,
  old_tp REAL,
  new_tp REAL,
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id),
  position_id TEXT REFERENCES positions(id),
  order_id TEXT REFERENCES orders(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CURRENT','MISMATCH','FAILED')),
  issues_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  position_id TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trading_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  net_return_pct REAL,
  win_rate REAL,
  profit_factor REAL,
  avg_r REAL,
  trades_closed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  net_pnl REAL,
  max_drawdown_pct REAL,
  trades INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learning_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  insight TEXT NOT NULL,
  confidence REAL,
  source TEXT,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
