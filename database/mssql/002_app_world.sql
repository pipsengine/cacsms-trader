-- App world state for db_Cacsms-Trader (no mock seed rows)
IF OBJECT_ID(N'dbo.app_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_settings (
    [key] NVARCHAR(128) NOT NULL PRIMARY KEY,
    [value] NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_settings_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_instruments', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_instruments (
    symbol NVARCHAR(32) NOT NULL PRIMARY KEY,
    kind NVARCHAR(16) NOT NULL,
    bid FLOAT NOT NULL CONSTRAINT DF_app_instruments_bid DEFAULT 0,
    ask FLOAT NOT NULL CONSTRAINT DF_app_instruments_ask DEFAULT 0,
    spread FLOAT NOT NULL CONSTRAINT DF_app_instruments_spread DEFAULT 0,
    change_pct FLOAT NOT NULL CONSTRAINT DF_app_instruments_chg DEFAULT 0,
    d1 NVARCHAR(16) NOT NULL CONSTRAINT DF_app_instruments_d1 DEFAULT N'NEUTRAL',
    h8 NVARCHAR(16) NOT NULL CONSTRAINT DF_app_instruments_h8 DEFAULT N'NEUTRAL',
    h1 NVARCHAR(32) NOT NULL CONSTRAINT DF_app_instruments_h1 DEFAULT N'Waiting',
    score FLOAT NOT NULL CONSTRAINT DF_app_instruments_score DEFAULT 0,
    state NVARCHAR(16) NOT NULL CONSTRAINT DF_app_instruments_state DEFAULT N'WAIT',
    strength_diff FLOAT NOT NULL CONSTRAINT DF_app_instruments_diff DEFAULT 0,
    channel_pos FLOAT NOT NULL CONSTRAINT DF_app_instruments_pos DEFAULT 50,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_instruments_conf DEFAULT 0,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_instruments_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_currency_strength', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_currency_strength (
    code NVARCHAR(8) NOT NULL PRIMARY KEY,
    q FLOAT NOT NULL CONSTRAINT DF_app_cs_q DEFAULT 0,
    m FLOAT NOT NULL CONSTRAINT DF_app_cs_m DEFAULT 0,
    score FLOAT NOT NULL CONSTRAINT DF_app_cs_score DEFAULT 0,
    trend NVARCHAR(32) NOT NULL CONSTRAINT DF_app_cs_trend DEFAULT N'Stable',
    classification NVARCHAR(32) NOT NULL CONSTRAINT DF_app_cs_class DEFAULT N'NEUTRAL',
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_cs_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_positions', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_positions (
    id NVARCHAR(64) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(32) NOT NULL,
    side NVARCHAR(8) NOT NULL,
    entry_price FLOAT NOT NULL,
    current_price FLOAT NOT NULL,
    sl FLOAT NOT NULL,
    tp FLOAT NOT NULL,
    size_lots FLOAT NOT NULL,
    risk_pct FLOAT NOT NULL CONSTRAINT DF_app_positions_risk DEFAULT 0,
    pnl FLOAT NOT NULL CONSTRAINT DF_app_positions_pnl DEFAULT 0,
    status NVARCHAR(16) NOT NULL CONSTRAINT DF_app_positions_status DEFAULT N'ACTIVE',
    opened_at NVARCHAR(64) NULL,
    account_id NVARCHAR(64) NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_positions_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_events', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_events (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    ts DATETIME2 NOT NULL CONSTRAINT DF_app_events_ts DEFAULT SYSUTCDATETIME(),
    severity NVARCHAR(16) NOT NULL CONSTRAINT DF_app_events_sev DEFAULT N'INFO',
    source NVARCHAR(64) NOT NULL CONSTRAINT DF_app_events_src DEFAULT N'SYSTEM',
    message NVARCHAR(1000) NOT NULL
  );
  CREATE INDEX IX_app_events_ts ON dbo.app_events(ts DESC);
END
GO
