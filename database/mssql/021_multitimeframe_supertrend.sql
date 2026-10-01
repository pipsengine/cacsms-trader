-- Multitimeframe Supertrend persistence for db_Cacsms-Trader
IF OBJECT_ID(N'dbo.trader_supertrend_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.trader_supertrend_settings (
    settings_key NVARCHAR(32) NOT NULL PRIMARY KEY,
    atr_multiplier FLOAT NOT NULL,
    atr_period INT NOT NULL,
    trigger_candle NVARCHAR(16) NOT NULL,
    revision INT NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_trader_supertrend_settings_updated DEFAULT SYSUTCDATETIME(),
    updated_by NVARCHAR(128) NOT NULL
  );
  CREATE INDEX IX_trader_supertrend_settings_revision ON dbo.trader_supertrend_settings(revision);
END
GO

IF OBJECT_ID(N'dbo.trader_supertrend_settings_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.trader_supertrend_settings_audit (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    actor_id NVARCHAR(128) NOT NULL,
    before_json NVARCHAR(MAX) NOT NULL,
    after_json NVARCHAR(MAX) NOT NULL,
    configuration_version INT NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_trader_supertrend_settings_audit_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_trader_supertrend_settings_audit_created ON dbo.trader_supertrend_settings_audit(created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.trader_supertrend_snapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.trader_supertrend_snapshot (
    symbol NVARCHAR(32) NOT NULL,
    timeframe NVARCHAR(8) NOT NULL,
    direction NVARCHAR(12) NOT NULL,
    supertrend_value FLOAT NULL,
    atr_value FLOAT NULL,
    confirmed_close FLOAT NULL,
    bars_since_flip INT NULL,
    last_flip_time DATETIME2 NULL,
    last_closed_time DATETIME2 NULL,
    settings_revision INT NOT NULL,
    sequence BIGINT NOT NULL,
    calculated_at DATETIME2 NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    CONSTRAINT PK_trader_supertrend_snapshot PRIMARY KEY (symbol, timeframe)
  );
  CREATE INDEX IX_trader_supertrend_snapshot_symbol_revision ON dbo.trader_supertrend_snapshot(symbol, settings_revision);
  CREATE INDEX IX_trader_supertrend_snapshot_calculated ON dbo.trader_supertrend_snapshot(calculated_at DESC);
END
GO

IF OBJECT_ID(N'dbo.trader_supertrend_transition', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.trader_supertrend_transition (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(32) NOT NULL,
    timeframe NVARCHAR(8) NOT NULL,
    previous_direction NVARCHAR(12) NOT NULL,
    new_direction NVARCHAR(12) NOT NULL,
    price FLOAT NULL,
    supertrend_value FLOAT NULL,
    atr_value FLOAT NULL,
    settings_revision INT NOT NULL,
    event_time DATETIME2 NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_trader_supertrend_transition_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_trader_supertrend_transition_symbol_time ON dbo.trader_supertrend_transition(symbol, timeframe, event_time DESC);
  CREATE INDEX IX_trader_supertrend_transition_revision ON dbo.trader_supertrend_transition(settings_revision, event_time DESC);
END
GO

