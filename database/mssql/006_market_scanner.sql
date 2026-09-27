-- Stage 4 Market Scanner persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_scanner_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_scanner_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    rank_no INT NOT NULL,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    conviction FLOAT NULL,
    raw_score FLOAT NULL,
    confidence FLOAT NULL,
    differential FLOAT NULL,
    macro_bias NVARCHAR(16) NULL,
    relationship NVARCHAR(24) NOT NULL,
    alignment NVARCHAR(24) NOT NULL,
    trajectory NVARCHAR(16) NULL,
    acceleration_state NVARCHAR(16) NULL,
    persistence FLOAT NULL,
    stage1_status NVARCHAR(24) NOT NULL,
    freshness_status NVARCHAR(16) NOT NULL,
    promoted BIT NOT NULL CONSTRAINT DF_app_scanner_instrument_promoted DEFAULT 0,
    promoted_at DATETIME2 NULL,
    reason NVARCHAR(600) NOT NULL,
    obs_date DATE NULL,
    run_id BIGINT NULL,
    detail_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_scanner_instrument_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_scanner_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_scanner_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    run_at DATETIME2 NOT NULL,
    triggers NVARCHAR(400) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    universe INT NOT NULL,
    available INT NOT NULL,
    directional INT NOT NULL,
    promoted INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_scanner_run_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_scanner_run_at ON dbo.app_scanner_run(run_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_scanner_snapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_scanner_snapshot (
    run_id BIGINT NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    rank_no INT NOT NULL,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    conviction FLOAT NULL,
    differential FLOAT NULL,
    confidence FLOAT NULL,
    relationship NVARCHAR(24) NOT NULL,
    stage1_status NVARCHAR(24) NOT NULL,
    promoted BIT NOT NULL,
    CONSTRAINT PK_app_scanner_snapshot PRIMARY KEY (run_id, symbol)
  );
END
GO

IF OBJECT_ID(N'dbo.app_scanner_promotion', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_scanner_promotion (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    action NVARCHAR(16) NOT NULL,
    run_id BIGINT NULL,
    direction NVARCHAR(24) NOT NULL,
    conviction FLOAT NULL,
    differential FLOAT NULL,
    relationship NVARCHAR(24) NOT NULL,
    confidence FLOAT NULL,
    freshness NVARCHAR(16) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    evidence_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_scanner_promotion_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_scanner_promotion_symbol ON dbo.app_scanner_promotion(symbol, created_at DESC);
END
GO
