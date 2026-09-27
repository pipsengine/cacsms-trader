-- MT5 persistence for db_Cacsms-Trader (SQL Server)
IF OBJECT_ID(N'dbo.mt5_accounts', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.mt5_accounts (
    id NVARCHAR(64) NOT NULL PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    account_class NVARCHAR(16) NOT NULL CHECK (account_class IN (N'DEMO', N'LIVE', N'PROP')),
    currency NVARCHAR(8) NOT NULL,
    broker NVARCHAR(200) NOT NULL,
    firm_name NVARCHAR(200) NULL,
    server_name NVARCHAR(200) NOT NULL,
    login NVARCHAR(64) NOT NULL,
    credential_secret_ref NVARCHAR(256) NULL,
    terminal_instance NVARCHAR(64) NOT NULL,
    state NVARCHAR(32) NOT NULL CONSTRAINT DF_mt5_accounts_state DEFAULT N'DISCONNECTED',
    trading_mode NVARCHAR(32) NOT NULL CONSTRAINT DF_mt5_accounts_mode DEFAULT N'ANALYSIS_ONLY',
    trading_enabled BIT NOT NULL CONSTRAINT DF_mt5_accounts_trading DEFAULT 0,
    leverage INT NOT NULL CONSTRAINT DF_mt5_accounts_lev DEFAULT 100,
    risk_profile NVARCHAR(32) NOT NULL CONSTRAINT DF_mt5_accounts_risk DEFAULT N'BALANCED',
    max_concurrent_trades INT NOT NULL CONSTRAINT DF_mt5_accounts_max DEFAULT 2,
    balance FLOAT NOT NULL CONSTRAINT DF_mt5_accounts_bal DEFAULT 0,
    equity FLOAT NOT NULL CONSTRAINT DF_mt5_accounts_eq DEFAULT 0,
    margin FLOAT NOT NULL CONSTRAINT DF_mt5_accounts_mgn DEFAULT 0,
    free_margin FLOAT NOT NULL CONSTRAINT DF_mt5_accounts_fm DEFAULT 0,
    profit FLOAT NOT NULL CONSTRAINT DF_mt5_accounts_pnl DEFAULT 0,
    latency_ms INT NULL,
    last_heartbeat DATETIME2 NULL,
    connected_at DATETIME2 NULL,
    assigned_symbols_json NVARCHAR(MAX) NULL,
    prop_rules_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_mt5_accounts_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_mt5_accounts_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_mt5_accounts_server_login UNIQUE (server_name, login)
  );
END
GO

IF OBJECT_ID(N'dbo.account_balances', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.account_balances (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    account_id NVARCHAR(64) NOT NULL REFERENCES dbo.mt5_accounts(id) ON DELETE CASCADE,
    currency NVARCHAR(8) NOT NULL,
    balance FLOAT NOT NULL,
    equity FLOAT NOT NULL,
    margin FLOAT NOT NULL CONSTRAINT DF_account_balances_mgn DEFAULT 0,
    free_margin FLOAT NOT NULL CONSTRAINT DF_account_balances_fm DEFAULT 0,
    profit FLOAT NOT NULL CONSTRAINT DF_account_balances_pnl DEFAULT 0,
    as_of DATETIME2 NOT NULL CONSTRAINT DF_account_balances_asof DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_account_balances_account ON dbo.account_balances(account_id, as_of DESC);
END
GO

IF OBJECT_ID(N'dbo.mt5_positions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.mt5_positions (
    id NVARCHAR(64) NOT NULL PRIMARY KEY,
    account_id NVARCHAR(64) NOT NULL REFERENCES dbo.mt5_accounts(id) ON DELETE CASCADE,
    cacsms_trade_id NVARCHAR(64) NOT NULL,
    mt5_order_id NVARCHAR(64) NULL,
    mt5_deal_id NVARCHAR(64) NULL,
    mt5_position_id NVARCHAR(64) NOT NULL,
    symbol NVARCHAR(64) NOT NULL,
    side NVARCHAR(8) NOT NULL,
    volume FLOAT NOT NULL,
    entry_price FLOAT NOT NULL,
    current_price FLOAT NOT NULL,
    sl FLOAT NULL,
    tp FLOAT NULL,
    pnl FLOAT NOT NULL CONSTRAINT DF_mt5_positions_pnl DEFAULT 0,
    currency NVARCHAR(8) NOT NULL,
    status NVARCHAR(16) NOT NULL CONSTRAINT DF_mt5_positions_status DEFAULT N'OPEN',
    opened_at DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_mt5_positions_updated DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_mt5_positions_account ON dbo.mt5_positions(account_id, status);
END
GO
