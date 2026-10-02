-- AI Chart Analysis: immutable analysis runs, timeline events, and outcomes. Additive only.
IF OBJECT_ID(N'dbo.app_ai_analysis_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_ai_analysis_run (
    analysis_id NVARCHAR(64) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    created_at DATETIME2 NOT NULL,
    analysis_timestamp DATETIME2 NOT NULL,
    last_closed_candle_json NVARCHAR(MAX) NULL,
    engine_version NVARCHAR(32) NOT NULL,
    ai_version NVARCHAR(32) NOT NULL,
    opportunity_version NVARCHAR(32) NULL,
    analysis_mode NVARCHAR(32) NOT NULL,
    primary_tf NVARCHAR(8) NOT NULL,
    status NVARCHAR(32) NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    market_state NVARCHAR(32) NOT NULL,
    opportunity_type NVARCHAR(16) NULL,
    confidence REAL NULL,
    tradable INTEGER NOT NULL,
    execution_authorized INTEGER NOT NULL,
    p1_state NVARCHAR(48) NULL,
    p2_state NVARCHAR(48) NULL,
    data_mode NVARCHAR(16) NOT NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    chart_snapshot_json NVARCHAR(MAX) NULL
  );
  CREATE INDEX IX_app_ai_analysis_run_symbol ON dbo.app_ai_analysis_run(symbol, created_at);
  CREATE INDEX IX_app_ai_analysis_run_status ON dbo.app_ai_analysis_run(status, created_at);
END
GO

IF OBJECT_ID(N'dbo.app_ai_analysis_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_ai_analysis_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id NVARCHAR(64) NOT NULL,
    event_ts DATETIME2 NOT NULL,
    kind NVARCHAR(48) NOT NULL,
    detail NVARCHAR(600) NULL,
    state_json NVARCHAR(MAX) NULL
  );
  CREATE INDEX IX_app_ai_analysis_event_aid ON dbo.app_ai_analysis_event(analysis_id, id);
END
GO

IF OBJECT_ID(N'dbo.app_ai_analysis_outcome', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_ai_analysis_outcome (
    analysis_id NVARCHAR(64) NOT NULL PRIMARY KEY,
    outcome NVARCHAR(48) NOT NULL,
    recorded_at DATETIME2 NOT NULL,
    detail NVARCHAR(600) NULL
  );
END
GO

IF OBJECT_ID(N'dbo.app_ai_analysis_seq', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_ai_analysis_seq (
    day_key NVARCHAR(16) NOT NULL PRIMARY KEY,
    next_seq INTEGER NOT NULL
  );
END
GO
