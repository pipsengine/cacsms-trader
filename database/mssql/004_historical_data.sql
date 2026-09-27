-- Stage 1 Historical Data: validated MT5 candles, series checkpoints, sync job queue and audit (no seed rows).
-- Candle timestamps are broker server time (MT5 rates epoch), stored as open_ts seconds.
IF OBJECT_ID(N'dbo.app_candles', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_candles (
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    open_ts BIGINT NOT NULL,
    open_time AS DATEADD(SECOND, CAST(open_ts AS INT), CONVERT(DATETIME2(0), '1970-01-01T00:00:00', 126)) PERSISTED,
    [open] FLOAT NOT NULL,
    high FLOAT NOT NULL,
    low FLOAT NOT NULL,
    [close] FLOAT NOT NULL,
    tick_volume BIGINT NOT NULL CONSTRAINT DF_app_candles_vol DEFAULT 0,
    spread INT NULL,
    source NVARCHAR(16) NOT NULL,
    ingested_at DATETIME2 NOT NULL CONSTRAINT DF_app_candles_ingested DEFAULT SYSUTCDATETIME(),
    revised_at DATETIME2 NULL,
    CONSTRAINT PK_app_candles PRIMARY KEY CLUSTERED (symbol, timeframe, open_ts)
  );
END
GO

IF OBJECT_ID(N'dbo.app_hist_series', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_hist_series (
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    status NVARCHAR(24) NOT NULL,
    reason NVARCHAR(400) NULL,
    candle_count INT NOT NULL CONSTRAINT DF_app_hist_series_cnt DEFAULT 0,
    earliest_ts BIGINT NULL,
    latest_ts BIGINT NULL,
    provider_latest_ts BIGINT NULL,
    required_depth INT NOT NULL,
    min_required INT NOT NULL,
    provider_depth INT NULL,
    provider_exhausted BIT NOT NULL CONSTRAINT DF_app_hist_series_exh DEFAULT 0,
    completeness FLOAT NULL,
    quality_score FLOAT NULL,
    integrity_errors INT NOT NULL CONSTRAINT DF_app_hist_series_ie DEFAULT 0,
    missing_bars INT NOT NULL CONSTRAINT DF_app_hist_series_mb DEFAULT 0,
    gaps_json NVARCHAR(MAX) NULL,
    provider_gaps_json NVARCHAR(MAX) NULL,
    issues_json NVARCHAR(MAX) NULL,
    source NVARCHAR(16) NULL,
    source_note NVARCHAR(400) NULL,
    last_sync_at DATETIME2 NULL,
    last_success_at DATETIME2 NULL,
    last_validated_at DATETIME2 NULL,
    last_repair_at DATETIME2 NULL,
    last_error NVARCHAR(800) NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_hist_series_upd DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_hist_series PRIMARY KEY (symbol, timeframe)
  );
END
GO

IF OBJECT_ID(N'dbo.app_hist_job', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_hist_job (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    job_type NVARCHAR(16) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    trigger_source NVARCHAR(24) NOT NULL,
    priority INT NOT NULL,
    state NVARCHAR(16) NOT NULL,
    attempts INT NOT NULL CONSTRAINT DF_app_hist_job_att DEFAULT 0,
    max_attempts INT NOT NULL CONSTRAINT DF_app_hist_job_max DEFAULT 5,
    fetched INT NOT NULL CONSTRAINT DF_app_hist_job_f DEFAULT 0,
    inserted INT NOT NULL CONSTRAINT DF_app_hist_job_i DEFAULT 0,
    revised INT NOT NULL CONSTRAINT DF_app_hist_job_r DEFAULT 0,
    checkpoint_ts BIGINT NULL,
    message NVARCHAR(800) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_hist_job_created DEFAULT SYSUTCDATETIME(),
    started_at DATETIME2 NULL,
    finished_at DATETIME2 NULL,
    next_attempt_at DATETIME2 NULL
  );
  CREATE INDEX IX_app_hist_job_state ON dbo.app_hist_job (state, priority, id);
  CREATE INDEX IX_app_hist_job_series ON dbo.app_hist_job (symbol, timeframe, id DESC);
END
GO

IF OBJECT_ID(N'dbo.app_hist_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_hist_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    at DATETIME2 NOT NULL CONSTRAINT DF_app_hist_event_at DEFAULT SYSUTCDATETIME(),
    kind NVARCHAR(32) NOT NULL,
    severity NVARCHAR(8) NOT NULL,
    symbol NVARCHAR(16) NULL,
    timeframe NVARCHAR(4) NULL,
    job_id BIGINT NULL,
    message NVARCHAR(800) NOT NULL,
    detail_json NVARCHAR(MAX) NULL
  );
  CREATE INDEX IX_app_hist_event_kind ON dbo.app_hist_event (kind, id DESC);
END
GO
