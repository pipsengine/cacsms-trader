-- account_balances
CREATE TABLE account_balances (
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

-- account_performance
CREATE TABLE account_performance (
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

-- account_prop_bindings
CREATE TABLE account_prop_bindings (
  account_id TEXT PRIMARY KEY REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES prop_profiles(id),
  rule_id INTEGER REFERENCES prop_rules(id),
  bound_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- account_qualifications
CREATE TABLE account_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  reasons_json TEXT,
  checks_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- account_snapshots
CREATE TABLE account_snapshots (
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

-- app_candles
CREATE TABLE app_candles (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    open_ts INTEGER NOT NULL,

    [open] REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    [close] REAL NOT NULL,
    tick_volume INTEGER NOT NULL DEFAULT 0,
    spread INT NULL,
    source TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revised_at TEXT NULL,
    CONSTRAINT PK_app_candles PRIMARY KEY (symbol, timeframe, open_ts)
  );

-- app_currency_strength
CREATE TABLE app_currency_strength (
    code TEXT NOT NULL PRIMARY KEY,
    q REAL NOT NULL DEFAULT 0,
    m REAL NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    trend TEXT NOT NULL DEFAULT 'Stable',
    classification TEXT NOT NULL DEFAULT 'NEUTRAL',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_direction_history
CREATE TABLE app_direction_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    structural_phase TEXT NULL,
    alignment TEXT NOT NULL,
    confidence REAL NOT NULL,
    channel_position REAL NULL,
    d1_status TEXT NULL,
    d1_direction TEXT NULL,
    h8_status TEXT NULL,
    h8_direction TEXT NULL,
    prev_state TEXT NULL,
    prev_direction TEXT NULL,
    trigger_reason TEXT NULL,
    explanation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_direction_instrument
CREATE TABLE app_direction_instrument (
    symbol TEXT NOT NULL PRIMARY KEY,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    structural_phase TEXT NULL,
    alignment TEXT NOT NULL,
    confidence REAL NOT NULL,
    channel_position REAL NULL,
    zone TEXT NULL,
    ready_for_h1 INTEGER NOT NULL DEFAULT 0,
    ready_since TEXT NULL,
    scanner_state TEXT NULL,
    vision_status TEXT NULL,
    d1_status TEXT NULL,
    d1_direction TEXT NULL,
    h8_status TEXT NULL,
    h8_direction TEXT NULL,
    freshness_status TEXT NOT NULL,
    trigger_reason TEXT NULL,
    decision_json TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_direction_run
CREATE TABLE app_direction_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    triggers TEXT NOT NULL,
    status TEXT NOT NULL,
    candidates INT NOT NULL,
    aligned INT NOT NULL,
    pullback_waiting INT NOT NULL,
    conflicts INT NOT NULL,
    blocked INT NOT NULL,
    ready INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_events
CREATE TABLE app_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    severity TEXT NOT NULL DEFAULT 'INFO',
    source TEXT NOT NULL DEFAULT 'SYSTEM',
    message TEXT NOT NULL
  );

-- app_exec_deal
CREATE TABLE app_exec_deal (
    account_id TEXT NOT NULL,
    deal_ticket INTEGER NOT NULL,
    execution_id TEXT NULL,
    mt5_order INTEGER NULL,
    mt5_position INTEGER NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry TEXT NOT NULL,
    volume REAL NOT NULL,
    price REAL NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    magic INTEGER NULL,
    comment TEXT NULL,
    reason TEXT NULL,
    deal_time TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_exec_deal PRIMARY KEY (account_id, deal_ticket)
  );

-- app_exec_event
CREATE TABLE app_exec_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NULL,
    account_id TEXT NULL,
    kind TEXT NOT NULL,
    state TEXT NULL,
    detail TEXT NOT NULL,
    data_json TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_exec_ledger
CREATE TABLE app_exec_ledger (
    execution_id TEXT NOT NULL PRIMARY KEY,
    setup_key TEXT NOT NULL,
    attempt INT NOT NULL,
    account_id TEXT NOT NULL,
    account_class TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_state TEXT NOT NULL,
    position_state TEXT NULL,
    blocker_code TEXT NULL,
    node TEXT NULL,
    mt5_order INTEGER NULL,
    mt5_position INTEGER NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT NULL,
    CONSTRAINT UQ_app_exec_ledger_attempt UNIQUE (setup_key, account_id, attempt)
  );

-- app_exec_order
CREATE TABLE app_exec_order (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    execution_id TEXT NULL,
    account_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    symbol TEXT NOT NULL,
    order_type TEXT NULL,
    volume REAL NULL,
    requested_price REAL NULL,
    sl REAL NULL,
    tp REAL NULL,
    status TEXT NOT NULL,
    retcode INT NULL,
    retcode_text TEXT NULL,
    mt5_order INTEGER NULL,
    mt5_deal INTEGER NULL,
    fill_price REAL NULL,
    fill_volume REAL NULL,
    spread REAL NULL,
    slippage_points REAL NULL,
    latency_ms INT NULL,
    request_json TEXT NULL,
    result_json TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT NULL,
    CONSTRAINT UQ_app_exec_order_request UNIQUE (request_id)
  );

-- app_exec_reconcile
CREATE TABLE app_exec_reconcile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL,
    account_id TEXT NOT NULL,
    execution_id TEXT NULL,
    mt5_ticket INTEGER NULL,
    status TEXT NOT NULL,
    severity TEXT NOT NULL,
    detail TEXT NOT NULL,
    action TEXT NULL,
    data_json TEXT NULL,
    occurrences INT NOT NULL DEFAULT 1,
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolution TEXT NULL,
    resolved_by TEXT NULL,
    resolved_at TEXT NULL,
    resolution_note TEXT NULL
  );

-- app_exec_trade
CREATE TABLE app_exec_trade (
    execution_id TEXT NOT NULL PRIMARY KEY,
    account_id TEXT NOT NULL,
    account_class TEXT NOT NULL,
    currency TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    setup_key TEXT NOT NULL,
    opened_at TEXT NULL,
    closed_at TEXT NULL,
    volume REAL NOT NULL,
    entry_expected REAL NULL,
    entry_actual REAL NULL,
    exit_price REAL NULL,
    slippage_points REAL NULL,
    realized_pnl REAL NOT NULL,
    commission REAL NOT NULL,
    swap REAL NOT NULL,
    risk_amount REAL NULL,
    r_multiple REAL NULL,
    duration_sec INT NULL,
    exit_reason TEXT NOT NULL,
    trade_json TEXT NOT NULL,
    stage10_status TEXT NOT NULL DEFAULT 'PUBLISHED',
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_h1_event
CREATE TABLE app_h1_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    side TEXT NOT NULL,
    bar_ts INTEGER NOT NULL,
    level REAL NULL,
    price REAL NULL,
    detail TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UQ_app_h1_event UNIQUE (symbol, event_type, side, bar_ts)
  );

-- app_h1_history
CREATE TABLE app_h1_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    phase TEXT NULL,
    score REAL NOT NULL,
    invalidation_level REAL NULL,
    stage6_state TEXT NULL,
    prev_state TEXT NULL,
    trigger_reason TEXT NULL,
    explanation TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_h1_instrument
CREATE TABLE app_h1_instrument (
    symbol TEXT NOT NULL PRIMARY KEY,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    phase TEXT NULL,
    score REAL NOT NULL,
    invalidation_level REAL NULL,
    stage6_state TEXT NULL,
    h1_data_status TEXT NULL,
    h1_last_ts INTEGER NULL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    confirmed_since TEXT NULL,
    trigger_reason TEXT NULL,
    decision_json TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_h1_run
CREATE TABLE app_h1_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    triggers TEXT NOT NULL,
    status TEXT NOT NULL,
    candidates INT NOT NULL,
    monitoring INT NOT NULL,
    confirmed INT NOT NULL,
    rejected INT NOT NULL,
    invalidated INT NOT NULL,
    blocked INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_hist_event
CREATE TABLE app_hist_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    symbol TEXT NULL,
    timeframe TEXT NULL,
    job_id INTEGER NULL,
    message TEXT NOT NULL,
    detail_json TEXT NULL
  );

-- app_hist_job
CREATE TABLE app_hist_job (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    priority INT NOT NULL,
    state TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    fetched INT NOT NULL DEFAULT 0,
    inserted INT NOT NULL DEFAULT 0,
    revised INT NOT NULL DEFAULT 0,
    checkpoint_ts INTEGER NULL,
    message TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT NULL,
    finished_at TEXT NULL,
    next_attempt_at TEXT NULL
  );

-- app_hist_series
CREATE TABLE app_hist_series (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NULL,
    candle_count INT NOT NULL DEFAULT 0,
    earliest_ts INTEGER NULL,
    latest_ts INTEGER NULL,
    provider_latest_ts INTEGER NULL,
    required_depth INT NOT NULL,
    min_required INT NOT NULL,
    provider_depth INT NULL,
    provider_exhausted INTEGER NOT NULL DEFAULT 0,
    completeness REAL NULL,
    quality_score REAL NULL,
    integrity_errors INT NOT NULL DEFAULT 0,
    missing_bars INT NOT NULL DEFAULT 0,
    gaps_json TEXT NULL,
    provider_gaps_json TEXT NULL,
    issues_json TEXT NULL,
    source TEXT NULL,
    source_note TEXT NULL,
    last_sync_at TEXT NULL,
    last_success_at TEXT NULL,
    last_validated_at TEXT NULL,
    last_repair_at TEXT NULL,
    last_error TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_hist_series PRIMARY KEY (symbol, timeframe)
  );

-- app_instruments
CREATE TABLE app_instruments (
    symbol TEXT NOT NULL PRIMARY KEY,
    kind TEXT NOT NULL,
    bid REAL NOT NULL DEFAULT 0,
    ask REAL NOT NULL DEFAULT 0,
    spread REAL NOT NULL DEFAULT 0,
    change_pct REAL NOT NULL DEFAULT 0,
    d1 TEXT NOT NULL DEFAULT 'NEUTRAL',
    h8 TEXT NOT NULL DEFAULT 'NEUTRAL',
    h1 TEXT NOT NULL DEFAULT 'Waiting',
    score REAL NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'WAIT',
    strength_diff REAL NOT NULL DEFAULT 0,
    channel_pos REAL NOT NULL DEFAULT 50,
    confidence REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_positions
CREATE TABLE app_positions (
    id TEXT NOT NULL PRIMARY KEY,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL NOT NULL,
    sl REAL NOT NULL,
    tp REAL NOT NULL,
    size_lots REAL NOT NULL,
    risk_pct REAL NOT NULL DEFAULT 0,
    pnl REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    opened_at TEXT NULL,
    account_id TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_regime_pair
CREATE TABLE app_regime_pair (
    symbol TEXT NOT NULL PRIMARY KEY,
    base TEXT NOT NULL,
    quote TEXT NOT NULL,
    status TEXT NOT NULL,
    bias TEXT NOT NULL,
    differential REAL NOT NULL,
    conviction REAL NOT NULL,
    persistence REAL NOT NULL,
    momentum REAL NOT NULL,
    confidence REAL NOT NULL,
    base_regime TEXT NULL,
    quote_regime TEXT NULL,
    relationship TEXT NOT NULL,
    reason TEXT NOT NULL,
    obs_date DATE NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_regime_snapshot
CREATE TABLE app_regime_snapshot (
    asset TEXT NOT NULL,
    obs_date DATE NOT NULL,
    is_closed INTEGER NOT NULL,
    q REAL NOT NULL,
    m REAL NOT NULL,
    w REAL NOT NULL,
    d REAL NOT NULL,
    macro REAL NOT NULL,
    current_strength REAL NOT NULL,
    composite REAL NOT NULL,
    prev_composite REAL NULL,
    momentum REAL NULL,
    acceleration REAL NULL,
    raw_regime TEXT NULL,
    regime TEXT NULL,
    regime_since DATE NULL,
    candidate TEXT NULL,
    candidate_count INT NOT NULL DEFAULT 0,
    candidate_since DATE NULL,
    duration_obs INT NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    obs_confidence REAL NOT NULL DEFAULT 0,
    persistence REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_regime_snapshot PRIMARY KEY (asset, obs_date)
  );

-- app_regime_transition
CREATE TABLE app_regime_transition (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset TEXT NOT NULL,
    confirmed_at DATE NOT NULL,
    first_seen DATE NOT NULL,
    prev_regime TEXT NOT NULL,
    new_regime TEXT NOT NULL,
    confidence REAL NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UQ_app_regime_transition UNIQUE (asset, confirmed_at)
  );

-- app_risk_account_eval
CREATE TABLE app_risk_account_eval (
    setup_key TEXT NOT NULL,
    account_id TEXT NOT NULL,
    state TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    volume REAL NULL,
    risk_amount REAL NULL,
    risk_currency TEXT NULL,
    risk_pct REAL NULL,
    margin_required REAL NULL,
    eval_json TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_risk_account_eval PRIMARY KEY (setup_key, account_id)
  );

-- app_risk_approval
CREATE TABLE app_risk_approval (
    setup_key TEXT NOT NULL,
    account_id TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_risk_approval PRIMARY KEY (setup_key, account_id)
  );

-- app_risk_authorization
CREATE TABLE app_risk_authorization (
    execution_id TEXT NOT NULL PRIMARY KEY,
    setup_key TEXT NOT NULL,
    attempt INT NOT NULL,
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    broker_symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    volume REAL NOT NULL,
    entry_policy_json TEXT NOT NULL,
    stop_loss REAL NOT NULL,
    take_profit REAL NULL,
    risk_amount REAL NOT NULL,
    risk_currency TEXT NOT NULL,
    risk_pct REAL NOT NULL,
    expires_at TEXT NOT NULL,
    source_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    authorization_json TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    authorized_at TEXT NOT NULL,
    status TEXT NOT NULL,
    status_reason TEXT NULL,
    status_at TEXT NOT NULL,
    CONSTRAINT UQ_app_risk_authorization UNIQUE (setup_key, account_id, attempt)
  );

-- app_risk_authorization_event
CREATE TABLE app_risk_authorization_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_risk_config_audit
CREATE TABLE app_risk_config_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    changed_keys TEXT NOT NULL,
    critical INTEGER NOT NULL,
    before_hash TEXT NOT NULL,
    after_hash TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    reason TEXT NULL
  );

-- app_risk_exposure
CREATE TABLE app_risk_exposure (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    open_risk_pct REAL NOT NULL,
    pending_risk_pct REAL NOT NULL,
    daily_loss_pct REAL NULL,
    drawdown_pct REAL NULL,
    equity REAL NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_risk_history
CREATE TABLE app_risk_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setup_key TEXT NOT NULL,
    account_id TEXT NULL,
    symbol TEXT NOT NULL,
    state TEXT NOT NULL,
    prev_state TEXT NULL,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL NULL,
    volume REAL NULL,
    risk_pct REAL NULL,
    trigger_reason TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_risk_opportunity
CREATE TABLE app_risk_opportunity (
    setup_key TEXT NOT NULL PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    state TEXT NOT NULL,
    setup_state TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL NOT NULL,
    confidence REAL NULL,
    entry_price REAL NULL,
    stop_loss REAL NULL,
    take_profit REAL NULL,
    reward_risk REAL NULL,
    eligible_accounts INT NOT NULL DEFAULT 0,
    authorized_accounts INT NOT NULL DEFAULT 0,
    proposed_risk_pct REAL NULL,
    active INTEGER NOT NULL DEFAULT 1,
    confirmed_since TEXT NULL,
    expires_at TEXT NULL,
    trigger_reason TEXT NULL,
    opportunity_json TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_at TEXT NOT NULL,
    evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_risk_run
CREATE TABLE app_risk_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    triggers TEXT NOT NULL,
    status TEXT NOT NULL,
    candidates INT NOT NULL,
    qualified INT NOT NULL,
    authorized INT NOT NULL,
    blocked INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json TEXT NULL
  );

-- app_scanner_instrument
CREATE TABLE app_scanner_instrument (
    symbol TEXT NOT NULL PRIMARY KEY,
    rank_no INT NOT NULL,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    conviction REAL NULL,
    raw_score REAL NULL,
    confidence REAL NULL,
    differential REAL NULL,
    macro_bias TEXT NULL,
    relationship TEXT NOT NULL,
    alignment TEXT NOT NULL,
    trajectory TEXT NULL,
    acceleration_state TEXT NULL,
    persistence REAL NULL,
    stage1_status TEXT NOT NULL,
    freshness_status TEXT NOT NULL,
    promoted INTEGER NOT NULL DEFAULT 0,
    promoted_at TEXT NULL,
    reason TEXT NOT NULL,
    obs_date DATE NULL,
    run_id INTEGER NULL,
    detail_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_scanner_promotion
CREATE TABLE app_scanner_promotion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    action TEXT NOT NULL,
    run_id INTEGER NULL,
    direction TEXT NOT NULL,
    conviction REAL NULL,
    differential REAL NULL,
    relationship TEXT NOT NULL,
    confidence REAL NULL,
    freshness TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_scanner_run
CREATE TABLE app_scanner_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL,
    triggers TEXT NOT NULL,
    status TEXT NOT NULL,
    universe INT NOT NULL,
    available INT NOT NULL,
    directional INT NOT NULL,
    promoted INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_scanner_snapshot
CREATE TABLE app_scanner_snapshot (
    run_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    rank_no INT NOT NULL,
    state TEXT NOT NULL,
    direction TEXT NOT NULL,
    conviction REAL NULL,
    differential REAL NULL,
    confidence REAL NULL,
    relationship TEXT NOT NULL,
    stage1_status TEXT NOT NULL,
    promoted INTEGER NOT NULL,
    CONSTRAINT PK_app_scanner_snapshot PRIMARY KEY (run_id, symbol)
  );

-- app_settings
CREATE TABLE app_settings (
    [key] TEXT NOT NULL PRIMARY KEY,
    [value] TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- app_vision_channel
CREATE TABLE app_vision_channel (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    data_status TEXT NOT NULL,
    data_reason TEXT NOT NULL,
    bars_available INT NOT NULL,
    bars_required INT NOT NULL,
    channel_key TEXT NULL,
    status TEXT NULL,
    direction TEXT NOT NULL,
    lean TEXT NULL,
    confirmed INTEGER NOT NULL DEFAULT 0,
    phase TEXT NULL,
    position REAL NULL,
    upper_now REAL NULL,
    lower_now REAL NULL,
    slope REAL NULL,
    slope_atr20 REAL NULL,
    width REAL NULL,
    width_atr REAL NULL,
    touches_anchor INT NULL,
    touches_opposite INT NULL,
    touch_quality REAL NULL,
    parallel_dev REAL NULL,
    age_bars INT NULL,
    breakout_side TEXT NULL,
    breakout_ts INTEGER NULL,
    breakout_atr REAL NULL,
    atr REAL NULL,
    vol_ratio REAL NULL,
    vol_state TEXT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    last_bar_ts INTEGER NULL,
    analysis_json TEXT NULL,
    analysed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT PK_app_vision_channel PRIMARY KEY (symbol, timeframe)
  );

-- app_vision_event
CREATE TABLE app_vision_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    channel_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    bar_ts INTEGER NOT NULL,
    price REAL NULL,
    severity TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UQ_app_vision_event UNIQUE (symbol, timeframe, channel_key, event_type, bar_ts)
  );

-- app_vision_history
CREATE TABLE app_vision_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    d1_bar_ts INTEGER NOT NULL,
    h8_bar_ts INTEGER NOT NULL,
    status TEXT NOT NULL,
    primary_direction TEXT NOT NULL,
    agreement TEXT NOT NULL,
    phase TEXT NULL,
    confidence REAL NOT NULL,
    d1_status TEXT NULL,
    d1_direction TEXT NULL,
    d1_position REAL NULL,
    d1_confidence REAL NULL,
    h8_status TEXT NULL,
    h8_direction TEXT NULL,
    h8_position REAL NULL,
    h8_confidence REAL NULL,
    trigger_reason TEXT NULL,
    analysed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UQ_app_vision_history UNIQUE (symbol, d1_bar_ts, h8_bar_ts)
  );

-- app_vision_instrument
CREATE TABLE app_vision_instrument (
    symbol TEXT NOT NULL PRIMARY KEY,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    scanner_status TEXT NOT NULL,
    scanner_reason TEXT NULL,
    primary_direction TEXT NOT NULL,
    agreement TEXT NOT NULL,
    phase TEXT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    channel_position REAL NULL,
    live_price REAL NULL,
    live_position_d1 REAL NULL,
    live_position_h8 REAL NULL,
    live_at TEXT NULL,
    d1_bar_ts INTEGER NULL,
    h8_bar_ts INTEGER NULL,
    output_json TEXT NOT NULL,
    trigger_reason TEXT NULL,
    duration_ms INT NULL,
    analysed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  , live_tick_ts INTEGER, live_market_open INTEGER);

-- app_vision_touch
CREATE TABLE app_vision_touch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    channel_key TEXT NOT NULL,
    seq INT NOT NULL,
    boundary TEXT NOT NULL,
    role TEXT NOT NULL,
    bar_ts INTEGER NOT NULL,
    price REAL NOT NULL,
    line_price REAL NOT NULL,
    deviation_atr REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- audit_logs
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','ERROR','SECURITY','TRADE')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- bridge_account_balances
CREATE TABLE bridge_account_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES bridge_mt5_accounts(id) ON DELETE CASCADE,
    currency TEXT NOT NULL,
    balance REAL NOT NULL,
    equity REAL NOT NULL,
    margin REAL NOT NULL DEFAULT 0,
    free_margin REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    as_of TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- bridge_mt5_accounts
CREATE TABLE bridge_mt5_accounts (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    account_class TEXT NOT NULL CHECK (account_class IN ('DEMO', 'LIVE', 'PROP')),
    currency TEXT NOT NULL,
    broker TEXT NOT NULL,
    firm_name TEXT NULL,
    server_name TEXT NOT NULL,
    login TEXT NOT NULL,
    credential_secret_ref TEXT NULL,
    terminal_instance TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'DISCONNECTED',
    trading_mode TEXT NOT NULL DEFAULT 'ANALYSIS_ONLY',
    trading_enabled INTEGER NOT NULL DEFAULT 0,
    leverage INT NOT NULL DEFAULT 100,
    risk_profile TEXT NOT NULL DEFAULT 'BALANCED',
    max_concurrent_trades INT NOT NULL DEFAULT 2,
    balance REAL NOT NULL DEFAULT 0,
    equity REAL NOT NULL DEFAULT 0,
    margin REAL NOT NULL DEFAULT 0,
    free_margin REAL NOT NULL DEFAULT 0,
    profit REAL NOT NULL DEFAULT 0,
    latency_ms INT NULL,
    last_heartbeat TEXT NULL,
    connected_at TEXT NULL,
    assigned_symbols_json TEXT NULL,
    prop_rules_json TEXT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT UQ_mt5_accounts_server_login UNIQUE (server_name, login)
  );

-- currencies
CREATE TABLE currencies (
  code TEXT PRIMARY KEY CHECK (length(code) BETWEEN 3 AND 3),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'FIAT' CHECK (kind IN ('FIAT','METAL')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);

-- currency_strength
CREATE TABLE currency_strength (
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

-- deals
CREATE TABLE deals (
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

-- execution_eligibility
CREATE TABLE execution_eligibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  gateway_ready INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- execution_events
CREATE TABLE execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id),
  position_id TEXT REFERENCES positions(id),
  order_id TEXT REFERENCES orders(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- execution_requests
CREATE TABLE execution_requests (
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

-- historical_regime
CREATE TABLE historical_regime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_code TEXT NOT NULL REFERENCES currencies(code),
  state TEXT NOT NULL,
  persistence REAL,
  acceleration REAL,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(currency_code, as_of)
);

-- instruments
CREATE TABLE instruments (
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

-- learning_feedback
CREATE TABLE learning_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  insight TEXT NOT NULL,
  confidence REAL,
  source TEXT,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- market_candles
CREATE TABLE market_candles (
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

-- market_structure
CREATE TABLE market_structure (
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

-- mt5_accounts
CREATE TABLE mt5_accounts (
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

-- mt5_brokers
CREATE TABLE mt5_brokers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('RETAIL','PROP','DEMO')),
  website TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- mt5_connections
CREATE TABLE mt5_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  latency_ms INTEGER,
  connected_at TEXT,
  disconnected_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- mt5_heartbeats
CREATE TABLE mt5_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  terminal_id TEXT REFERENCES mt5_terminals(id) ON DELETE CASCADE,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- mt5_nodes
CREATE TABLE mt5_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK (status IN ('CONNECTED','DISCONNECTED','DEGRADED')),
  version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- mt5_positions
CREATE TABLE mt5_positions (
    id TEXT NOT NULL PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES bridge_mt5_accounts(id) ON DELETE CASCADE,
    cacsms_trade_id TEXT NOT NULL,
    mt5_order_id TEXT NULL,
    mt5_deal_id TEXT NULL,
    mt5_position_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL NOT NULL,
    sl REAL NULL,
    tp REAL NULL,
    pnl REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opened_at TEXT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- mt5_servers
CREATE TABLE mt5_servers (
  id TEXT PRIMARY KEY,
  broker_id TEXT NOT NULL REFERENCES mt5_brokers(id) ON DELETE CASCADE,
  server_name TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'LIVE' CHECK (environment IN ('DEMO','LIVE')),
  UNIQUE(broker_id, server_name)
);

-- mt5_terminals
CREATE TABLE mt5_terminals (
  id TEXT PRIMARY KEY, -- e.g. CACSMS-MT5-0001
  node_id TEXT REFERENCES mt5_nodes(id) ON DELETE SET NULL,
  path_ref TEXT, -- path reference, not secrets
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  last_heartbeat TEXT,
  heartbeat_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- opportunities
CREATE TABLE opportunities (
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

-- orders
CREATE TABLE orders (
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

-- position_sizing
CREATE TABLE position_sizing (
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

-- positions
CREATE TABLE positions (
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

-- prop_compliance_history
CREATE TABLE prop_compliance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASS','FAIL','WATCH')),
  detail TEXT,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- prop_profiles
CREATE TABLE prop_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  firm_name TEXT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- prop_rules
CREATE TABLE prop_rules (
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

-- reconciliation_issues
CREATE TABLE reconciliation_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  position_id TEXT,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- reconciliation_runs
CREATE TABLE reconciliation_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CURRENT','MISMATCH','FAILED')),
  issues_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- risk_decisions
CREATE TABLE risk_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES mt5_accounts(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  approved INTEGER NOT NULL CHECK (approved IN (0,1)),
  risk_pct REAL,
  reasons_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- schema_migrations
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sl_tp_changes
CREATE TABLE sl_tp_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  old_sl REAL,
  new_sl REAL,
  old_tp REAL,
  new_tp REAL,
  source TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- symbol_mappings
CREATE TABLE symbol_mappings (
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

-- system_events
CREATE TABLE system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT,
  severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARNING','ERROR','SUCCESS')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- system_settings
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string','number','boolean','json')),
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- trade_decisions
CREATE TABLE trade_decisions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  decision TEXT NOT NULL,
  reason TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- trading_performance
CREATE TABLE trading_performance (
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

-- users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator','viewer','auditor')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  password_hash_ref TEXT, -- secret reference only; never store plaintext passwords
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- workflow_decisions
CREATE TABLE workflow_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL REFERENCES instruments(symbol),
  decision TEXT NOT NULL CHECK (decision IN ('WAIT','WATCH','QUALIFIED','BLOCKED','BUY','SELL','EXIT','READY','OPEN')),
  reason TEXT,
  confidence REAL,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- workflow_events
CREATE TABLE workflow_events (
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

-- workflow_failures
CREATE TABLE workflow_failures (
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

-- workflow_runs
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','PAUSED','COMPLETED','FAILED')),
  execution_enabled INTEGER NOT NULL DEFAULT 0 CHECK (execution_enabled IN (0,1)),
  mode TEXT NOT NULL DEFAULT 'SIMULATION' CHECK (mode IN ('SIMULATION','PAPER','LIVE')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  notes TEXT
);

-- workflow_stage_states
CREATE TABLE workflow_stage_states (
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

-- world_model_snapshots
CREATE TABLE world_model_snapshots (
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
