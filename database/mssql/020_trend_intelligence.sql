-- Trend Intelligence persistence for db_Cacsms-Trader
IF OBJECT_ID(N'dbo.intelligence_trend_current', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_trend_current (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    asset NVARCHAR(8) NOT NULL,
    timeframe NVARCHAR(8) NOT NULL,
    direction NVARCHAR(64) NOT NULL,
    trend_score FLOAT NOT NULL,
    strength FLOAT NOT NULL,
    alignment FLOAT NOT NULL,
    persistence FLOAT NOT NULL,
    momentum FLOAT NOT NULL,
    acceleration FLOAT NOT NULL,
    structure_state NVARCHAR(120) NOT NULL,
    tit_state NVARCHAR(40) NOT NULL,
    data_quality NVARCHAR(32) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_trend_current_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_intelligence_trend_current UNIQUE (asset, timeframe)
  );
  CREATE INDEX IX_intelligence_trend_current_asset_tf ON dbo.intelligence_trend_current(asset, timeframe);
END
GO

IF OBJECT_ID(N'dbo.intelligence_trend_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_trend_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    snapshot_time DATETIME2 NOT NULL,
    sequence BIGINT NOT NULL,
    asset NVARCHAR(8) NOT NULL,
    overall_direction NVARCHAR(24) NOT NULL,
    strength FLOAT NOT NULL,
    alignment FLOAT NOT NULL,
    persistence FLOAT NOT NULL,
    momentum FLOAT NOT NULL,
    acceleration FLOAT NOT NULL,
    regime NVARCHAR(40) NOT NULL,
    tit_state NVARCHAR(40) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_trend_history_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_intelligence_trend_history_asset_time ON dbo.intelligence_trend_history(asset, snapshot_time DESC);
  CREATE INDEX IX_intelligence_trend_history_time_asset ON dbo.intelligence_trend_history(snapshot_time DESC, asset);
END
GO

IF OBJECT_ID(N'dbo.intelligence_trend_transition', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_trend_transition (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    asset NVARCHAR(8) NOT NULL,
    timeframe NVARCHAR(8) NOT NULL,
    previous_trend NVARCHAR(64) NULL,
    new_trend NVARCHAR(64) NOT NULL,
    trend_score FLOAT NOT NULL,
    strength FLOAT NOT NULL,
    alignment FLOAT NOT NULL,
    persistence FLOAT NOT NULL,
    momentum FLOAT NOT NULL,
    event_type NVARCHAR(40) NOT NULL,
    regime NVARCHAR(40) NOT NULL,
    tit_state NVARCHAR(40) NOT NULL,
    price FLOAT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_trend_transition_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_intelligence_trend_transition_asset_tf_time ON dbo.intelligence_trend_transition(asset, timeframe, created_at DESC);
  CREATE INDEX IX_intelligence_trend_transition_time ON dbo.intelligence_trend_transition(created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.intelligence_trend_metadata', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_trend_metadata (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    snapshot_time DATETIME2 NOT NULL,
    config_json NVARCHAR(MAX) NOT NULL,
    weights_json NVARCHAR(MAX) NOT NULL,
    feature_count INT NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_trend_metadata_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_intelligence_trend_metadata_time ON dbo.intelligence_trend_metadata(snapshot_time DESC);
END
GO

