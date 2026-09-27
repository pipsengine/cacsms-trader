-- Stage 9 Execution & Positions persistence for db_Cacsms-Trader (no seed rows).
-- One ledger row per Stage 8 execution ID (idempotency key). The broker mirror stays in dbo.mt5_positions.

IF OBJECT_ID(N'dbo.app_exec_ledger', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_ledger (
    execution_id NVARCHAR(40) NOT NULL PRIMARY KEY,
    setup_key NVARCHAR(96) NOT NULL,
    attempt INT NOT NULL,
    account_id NVARCHAR(64) NOT NULL,
    account_class NVARCHAR(16) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    direction NVARCHAR(8) NOT NULL,
    order_state NVARCHAR(20) NOT NULL,
    position_state NVARCHAR(16) NULL,
    blocker_code NVARCHAR(48) NULL,
    node NVARCHAR(64) NULL,
    mt5_order BIGINT NULL,
    mt5_position BIGINT NULL,
    stale BIT NOT NULL CONSTRAINT DF_app_exec_ledger_stale DEFAULT 0,
    data_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_ledger_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_ledger_updated DEFAULT SYSUTCDATETIME(),
    closed_at DATETIME2 NULL,
    CONSTRAINT UQ_app_exec_ledger_attempt UNIQUE (setup_key, account_id, attempt)
  );
  CREATE INDEX IX_app_exec_ledger_state ON dbo.app_exec_ledger(order_state, position_state);
  CREATE INDEX IX_app_exec_ledger_account ON dbo.app_exec_ledger(account_id, position_state);
END
GO

IF OBJECT_ID(N'dbo.app_exec_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    execution_id NVARCHAR(40) NULL,
    account_id NVARCHAR(64) NULL,
    kind NVARCHAR(32) NOT NULL,
    state NVARCHAR(24) NULL,
    detail NVARCHAR(800) NOT NULL,
    data_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_event_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_exec_event_exec ON dbo.app_exec_event(execution_id, id);
END
GO

-- Every request sent to MT5 (entry, SL/TP modification, partial / full close, pending cancel). request_id makes each idempotent.
IF OBJECT_ID(N'dbo.app_exec_order', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_order (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    request_id NVARCHAR(80) NOT NULL,
    execution_id NVARCHAR(40) NULL,
    account_id NVARCHAR(64) NOT NULL,
    purpose NVARCHAR(16) NOT NULL,
    symbol NVARCHAR(32) NOT NULL,
    order_type NVARCHAR(16) NULL,
    volume FLOAT NULL,
    requested_price FLOAT NULL,
    sl FLOAT NULL,
    tp FLOAT NULL,
    status NVARCHAR(16) NOT NULL,
    retcode INT NULL,
    retcode_text NVARCHAR(200) NULL,
    mt5_order BIGINT NULL,
    mt5_deal BIGINT NULL,
    fill_price FLOAT NULL,
    fill_volume FLOAT NULL,
    spread FLOAT NULL,
    slippage_points FLOAT NULL,
    latency_ms INT NULL,
    request_json NVARCHAR(MAX) NULL,
    result_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_order_created DEFAULT SYSUTCDATETIME(),
    completed_at DATETIME2 NULL,
    CONSTRAINT UQ_app_exec_order_request UNIQUE (request_id)
  );
  CREATE INDEX IX_app_exec_order_exec ON dbo.app_exec_order(execution_id, id);
END
GO

IF OBJECT_ID(N'dbo.app_exec_deal', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_deal (
    account_id NVARCHAR(64) NOT NULL,
    deal_ticket BIGINT NOT NULL,
    execution_id NVARCHAR(40) NULL,
    mt5_order BIGINT NULL,
    mt5_position BIGINT NULL,
    symbol NVARCHAR(32) NOT NULL,
    side NVARCHAR(8) NOT NULL,
    entry NVARCHAR(8) NOT NULL,
    volume FLOAT NOT NULL,
    price FLOAT NOT NULL,
    commission FLOAT NOT NULL CONSTRAINT DF_app_exec_deal_comm DEFAULT 0,
    swap FLOAT NOT NULL CONSTRAINT DF_app_exec_deal_swap DEFAULT 0,
    fee FLOAT NOT NULL CONSTRAINT DF_app_exec_deal_fee DEFAULT 0,
    profit FLOAT NOT NULL CONSTRAINT DF_app_exec_deal_profit DEFAULT 0,
    magic BIGINT NULL,
    comment NVARCHAR(64) NULL,
    reason NVARCHAR(16) NULL,
    deal_time DATETIME2 NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_deal_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_exec_deal PRIMARY KEY (account_id, deal_ticket)
  );
  CREATE INDEX IX_app_exec_deal_exec ON dbo.app_exec_deal(execution_id);
END
GO

-- Continuous comparison with the broker. item_key de-duplicates a recurring finding; resolution records the automatic fix or the operator.
IF OBJECT_ID(N'dbo.app_exec_reconcile', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_reconcile (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    item_key NVARCHAR(160) NOT NULL,
    account_id NVARCHAR(64) NOT NULL,
    execution_id NVARCHAR(40) NULL,
    mt5_ticket BIGINT NULL,
    status NVARCHAR(24) NOT NULL,
    severity NVARCHAR(12) NOT NULL,
    detail NVARCHAR(800) NOT NULL,
    action NVARCHAR(200) NULL,
    data_json NVARCHAR(MAX) NULL,
    occurrences INT NOT NULL CONSTRAINT DF_app_exec_recon_occ DEFAULT 1,
    first_seen DATETIME2 NOT NULL CONSTRAINT DF_app_exec_recon_first DEFAULT SYSUTCDATETIME(),
    last_seen DATETIME2 NOT NULL CONSTRAINT DF_app_exec_recon_last DEFAULT SYSUTCDATETIME(),
    resolution NVARCHAR(24) NULL,
    resolved_by NVARCHAR(64) NULL,
    resolved_at DATETIME2 NULL,
    resolution_note NVARCHAR(400) NULL
  );
  CREATE INDEX IX_app_exec_recon_open ON dbo.app_exec_reconcile(resolved_at, account_id);
  CREATE INDEX IX_app_exec_recon_key ON dbo.app_exec_reconcile(item_key, resolved_at);
END
GO

-- Stage 10 hand-off: one immutable record per completed trade with its full lifecycle and upstream evidence.
IF OBJECT_ID(N'dbo.app_exec_trade', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_exec_trade (
    execution_id NVARCHAR(40) NOT NULL PRIMARY KEY,
    account_id NVARCHAR(64) NOT NULL,
    account_class NVARCHAR(16) NOT NULL,
    currency NVARCHAR(8) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    direction NVARCHAR(8) NOT NULL,
    setup_key NVARCHAR(96) NOT NULL,
    opened_at DATETIME2 NULL,
    closed_at DATETIME2 NULL,
    volume FLOAT NOT NULL,
    entry_expected FLOAT NULL,
    entry_actual FLOAT NULL,
    exit_price FLOAT NULL,
    slippage_points FLOAT NULL,
    realized_pnl FLOAT NOT NULL,
    commission FLOAT NOT NULL,
    swap FLOAT NOT NULL,
    risk_amount FLOAT NULL,
    r_multiple FLOAT NULL,
    duration_sec INT NULL,
    exit_reason NVARCHAR(48) NOT NULL,
    trade_json NVARCHAR(MAX) NOT NULL,
    stage10_status NVARCHAR(16) NOT NULL CONSTRAINT DF_app_exec_trade_s10 DEFAULT N'PUBLISHED',
    published_at DATETIME2 NOT NULL CONSTRAINT DF_app_exec_trade_pub DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_exec_trade_closed ON dbo.app_exec_trade(closed_at DESC);
END
GO

IF OBJECT_ID(N'dbo.trg_app_exec_trade_immutable', N'TR') IS NULL
EXEC(N'
CREATE TRIGGER dbo.trg_app_exec_trade_immutable ON dbo.app_exec_trade
AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
    THROW 51090, ''Stage 9 completed-trade records cannot be deleted'', 1;
  IF UPDATE(execution_id) OR UPDATE(account_id) OR UPDATE(symbol) OR UPDATE(direction) OR UPDATE(volume) OR UPDATE(entry_actual)
     OR UPDATE(exit_price) OR UPDATE(realized_pnl) OR UPDATE(commission) OR UPDATE(swap) OR UPDATE(risk_amount) OR UPDATE(r_multiple)
     OR UPDATE(exit_reason) OR UPDATE(trade_json)
    THROW 51091, ''Stage 9 completed-trade records are immutable'', 1;
END')
GO
