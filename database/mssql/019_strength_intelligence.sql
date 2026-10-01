-- Live Strength Intelligence persistence for db_Cacsms-Trader
IF OBJECT_ID(N'dbo.intelligence_strength_snapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_strength_snapshot (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    snapshot_time DATETIME2 NOT NULL,
    sequence BIGINT NOT NULL,
    asset NVARCHAR(8) NOT NULL,
    ytd FLOAT NOT NULL,
    hy FLOAT NOT NULL,
    q FLOAT NOT NULL,
    mn FLOAT NOT NULL,
    w FLOAT NOT NULL,
    d FLOAT NOT NULL,
    h8 FLOAT NOT NULL,
    h1 FLOAT NOT NULL,
    m15 FLOAT NOT NULL,
    m5 FLOAT NOT NULL,
    m1 FLOAT NOT NULL,
    composite FLOAT NOT NULL,
    rank INT NOT NULL,
    previous_rank INT NULL,
    rank_change INT NOT NULL,
    trend NVARCHAR(12) NOT NULL,
    velocity FLOAT NOT NULL,
    acceleration FLOAT NOT NULL,
    persistence FLOAT NOT NULL,
    agreement FLOAT NOT NULL,
    data_quality FLOAT NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_strength_snapshot_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_intelligence_strength_snapshot_time_asset ON dbo.intelligence_strength_snapshot(snapshot_time DESC, asset);
  CREATE INDEX IX_intelligence_strength_snapshot_asset_time ON dbo.intelligence_strength_snapshot(asset, snapshot_time DESC);
END
GO

IF OBJECT_ID(N'dbo.intelligence_strength_rollup', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_strength_rollup (
    bucket_time DATETIME2 NOT NULL,
    resolution NVARCHAR(12) NOT NULL,
    asset NVARCHAR(8) NOT NULL,
    open_strength FLOAT NULL,
    high_strength FLOAT NULL,
    low_strength FLOAT NULL,
    close_strength FLOAT NULL,
    avg_strength FLOAT NULL,
    samples INT NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_strength_rollup_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_intelligence_strength_rollup PRIMARY KEY (bucket_time, resolution, asset)
  );
END
GO

IF OBJECT_ID(N'dbo.intelligence_model_version', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_model_version (
    model_version NVARCHAR(80) NOT NULL PRIMARY KEY,
    status NVARCHAR(24) NOT NULL,
    trained_at DATETIME2 NULL,
    metrics_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_model_version_created DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.intelligence_prediction', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.intelligence_prediction (
    prediction_id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    model_version NVARCHAR(80) NOT NULL,
    prediction_time DATETIME2 NOT NULL,
    asset NVARCHAR(8) NOT NULL,
    horizon NVARCHAR(12) NOT NULL,
    current_strength FLOAT NOT NULL,
    predicted_strength FLOAT NOT NULL,
    predicted_direction NVARCHAR(16) NOT NULL,
    lower_bound FLOAT NULL,
    upper_bound FLOAT NULL,
    p_strengthening FLOAT NOT NULL,
    p_weakening FLOAT NOT NULL,
    p_neutral FLOAT NOT NULL,
    confidence FLOAT NOT NULL,
    feature_snapshot_json NVARCHAR(MAX) NULL,
    actual_strength FLOAT NULL,
    actual_direction NVARCHAR(16) NULL,
    absolute_error FLOAT NULL,
    squared_error FLOAT NULL,
    direction_correct BIT NULL,
    interval_covered BIT NULL,
    evaluated_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_intelligence_prediction_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_intelligence_prediction_asset_horizon ON dbo.intelligence_prediction(asset, horizon, prediction_time DESC);
  CREATE INDEX IX_intelligence_prediction_eval ON dbo.intelligence_prediction(evaluated_at, prediction_time);
END
GO

