-- Stage 8 Opportunities & Risk persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_risk_opportunity', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_opportunity (
    setup_key NVARCHAR(96) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    state NVARCHAR(24) NOT NULL,
    setup_state NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(48) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    score FLOAT NOT NULL,
    confidence FLOAT NULL,
    entry_price FLOAT NULL,
    stop_loss FLOAT NULL,
    take_profit FLOAT NULL,
    reward_risk FLOAT NULL,
    eligible_accounts INT NOT NULL CONSTRAINT DF_app_risk_opp_elig DEFAULT 0,
    authorized_accounts INT NOT NULL CONSTRAINT DF_app_risk_opp_auth DEFAULT 0,
    proposed_risk_pct FLOAT NULL,
    active BIT NOT NULL CONSTRAINT DF_app_risk_opp_active DEFAULT 1,
    confirmed_since DATETIME2 NULL,
    expires_at DATETIME2 NULL,
    trigger_reason NVARCHAR(200) NULL,
    opportunity_json NVARCHAR(MAX) NOT NULL,
    first_seen DATETIME2 NOT NULL CONSTRAINT DF_app_risk_opp_first DEFAULT SYSUTCDATETIME(),
    changed_at DATETIME2 NOT NULL,
    evaluated_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_opp_eval DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_risk_opp_active ON dbo.app_risk_opportunity(active, evaluated_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_risk_account_eval', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_account_eval (
    setup_key NVARCHAR(96) NOT NULL,
    account_id NVARCHAR(64) NOT NULL,
    state NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(48) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    volume FLOAT NULL,
    risk_amount FLOAT NULL,
    risk_currency NVARCHAR(8) NULL,
    risk_pct FLOAT NULL,
    margin_required FLOAT NULL,
    eval_json NVARCHAR(MAX) NOT NULL,
    changed_at DATETIME2 NOT NULL,
    evaluated_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_acct_eval DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_risk_account_eval PRIMARY KEY (setup_key, account_id)
  );
END
GO

IF OBJECT_ID(N'dbo.app_risk_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    setup_key NVARCHAR(96) NOT NULL,
    account_id NVARCHAR(64) NULL,
    symbol NVARCHAR(16) NOT NULL,
    state NVARCHAR(24) NOT NULL,
    prev_state NVARCHAR(24) NULL,
    reason_code NVARCHAR(48) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    score FLOAT NULL,
    volume FLOAT NULL,
    risk_pct FLOAT NULL,
    trigger_reason NVARCHAR(200) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_hist_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_risk_history_key ON dbo.app_risk_history(setup_key, id DESC);
END
GO

IF OBJECT_ID(N'dbo.app_risk_exposure', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_exposure (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    account_id NVARCHAR(64) NOT NULL,
    open_risk_pct FLOAT NOT NULL,
    pending_risk_pct FLOAT NOT NULL,
    daily_loss_pct FLOAT NULL,
    drawdown_pct FLOAT NULL,
    equity FLOAT NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_exposure_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_risk_exposure_acct ON dbo.app_risk_exposure(account_id, id DESC);
END
GO

-- Immutable Stage 9 execution authorizations. Terms never change; only status transitions are recorded.
IF OBJECT_ID(N'dbo.app_risk_authorization', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_authorization (
    execution_id NVARCHAR(40) NOT NULL PRIMARY KEY,
    setup_key NVARCHAR(96) NOT NULL,
    attempt INT NOT NULL,
    account_id NVARCHAR(64) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    broker_symbol NVARCHAR(32) NOT NULL,
    direction NVARCHAR(8) NOT NULL,
    volume FLOAT NOT NULL,
    entry_policy_json NVARCHAR(MAX) NOT NULL,
    stop_loss FLOAT NOT NULL,
    take_profit FLOAT NULL,
    risk_amount FLOAT NOT NULL,
    risk_currency NVARCHAR(8) NOT NULL,
    risk_pct FLOAT NOT NULL,
    expires_at DATETIME2 NOT NULL,
    source_json NVARCHAR(MAX) NOT NULL,
    evidence_json NVARCHAR(MAX) NOT NULL,
    authorization_json NVARCHAR(MAX) NOT NULL,
    config_hash NVARCHAR(16) NOT NULL,
    authorized_at DATETIME2 NOT NULL,
    status NVARCHAR(16) NOT NULL,
    status_reason NVARCHAR(400) NULL,
    status_at DATETIME2 NOT NULL,
    CONSTRAINT UQ_app_risk_authorization UNIQUE (setup_key, account_id, attempt)
  );
  CREATE INDEX IX_app_risk_authorization_status ON dbo.app_risk_authorization(status, expires_at);
END
GO

IF OBJECT_ID(N'dbo.trg_app_risk_authorization_immutable', N'TR') IS NULL
EXEC(N'
CREATE TRIGGER dbo.trg_app_risk_authorization_immutable ON dbo.app_risk_authorization
AFTER UPDATE, DELETE AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
    THROW 51080, ''Stage 8 execution authorizations cannot be deleted'', 1;
  IF UPDATE(setup_key) OR UPDATE(attempt) OR UPDATE(account_id) OR UPDATE(symbol) OR UPDATE(broker_symbol) OR UPDATE(direction)
     OR UPDATE(volume) OR UPDATE(entry_policy_json) OR UPDATE(stop_loss) OR UPDATE(take_profit) OR UPDATE(risk_amount)
     OR UPDATE(risk_currency) OR UPDATE(risk_pct) OR UPDATE(expires_at) OR UPDATE(source_json) OR UPDATE(evidence_json)
     OR UPDATE(authorization_json) OR UPDATE(config_hash) OR UPDATE(authorized_at)
    THROW 51081, ''Stage 8 execution authorization terms are immutable'', 1;
END')
GO

IF OBJECT_ID(N'dbo.app_risk_authorization_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_authorization_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    execution_id NVARCHAR(40) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    reason NVARCHAR(400) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_auth_event_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_risk_auth_event ON dbo.app_risk_authorization_event(execution_id, id);
END
GO

IF OBJECT_ID(N'dbo.app_risk_config_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_config_audit (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    changed_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_cfg_audit DEFAULT SYSUTCDATETIME(),
    actor NVARCHAR(64) NOT NULL,
    changed_keys NVARCHAR(600) NOT NULL,
    critical BIT NOT NULL,
    before_hash NVARCHAR(16) NOT NULL,
    after_hash NVARCHAR(16) NOT NULL,
    before_json NVARCHAR(MAX) NOT NULL,
    after_json NVARCHAR(MAX) NOT NULL,
    reason NVARCHAR(400) NULL
  );
END
GO

IF OBJECT_ID(N'dbo.app_risk_approval', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_approval (
    setup_key NVARCHAR(96) NOT NULL,
    account_id NVARCHAR(64) NOT NULL,
    approved_by NVARCHAR(64) NOT NULL,
    approved_at DATETIME2 NOT NULL CONSTRAINT DF_app_risk_approval_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_risk_approval PRIMARY KEY (setup_key, account_id)
  );
END
GO

IF OBJECT_ID(N'dbo.app_risk_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_risk_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    run_at DATETIME2 NOT NULL,
    triggers NVARCHAR(400) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    candidates INT NOT NULL,
    qualified INT NOT NULL,
    authorized INT NOT NULL,
    blocked INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json NVARCHAR(MAX) NULL
  );
END
GO
