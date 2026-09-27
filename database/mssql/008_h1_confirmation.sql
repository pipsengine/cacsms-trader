-- Stage 7 H1 Confirmation persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_h1_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_h1_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(48) NOT NULL,
    reason NVARCHAR(500) NOT NULL,
    phase NVARCHAR(24) NULL,
    score FLOAT NOT NULL,
    invalidation_level FLOAT NULL,
    stage6_state NVARCHAR(24) NULL,
    h1_data_status NVARCHAR(24) NULL,
    h1_last_ts BIGINT NULL,
    confirmed BIT NOT NULL CONSTRAINT DF_app_h1_instrument_confirmed DEFAULT 0,
    confirmed_since DATETIME2 NULL,
    trigger_reason NVARCHAR(200) NULL,
    decision_json NVARCHAR(MAX) NOT NULL,
    changed_at DATETIME2 NOT NULL,
    evaluated_at DATETIME2 NOT NULL CONSTRAINT DF_app_h1_instrument_evaluated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_h1_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_h1_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    event_type NVARCHAR(24) NOT NULL,
    side NVARCHAR(8) NOT NULL,
    bar_ts BIGINT NOT NULL,
    level FLOAT NULL,
    price FLOAT NULL,
    detail NVARCHAR(400) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_h1_event_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_h1_event UNIQUE (symbol, event_type, side, bar_ts)
  );
  CREATE INDEX IX_app_h1_event_symbol ON dbo.app_h1_event(symbol, bar_ts DESC);
END
GO

IF OBJECT_ID(N'dbo.app_h1_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_h1_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(48) NOT NULL,
    phase NVARCHAR(24) NULL,
    score FLOAT NOT NULL,
    invalidation_level FLOAT NULL,
    stage6_state NVARCHAR(24) NULL,
    prev_state NVARCHAR(24) NULL,
    trigger_reason NVARCHAR(200) NULL,
    explanation NVARCHAR(1200) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_h1_history_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_h1_history_symbol ON dbo.app_h1_history(symbol, created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_h1_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_h1_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    run_at DATETIME2 NOT NULL,
    triggers NVARCHAR(400) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    candidates INT NOT NULL,
    monitoring INT NOT NULL,
    confirmed INT NOT NULL,
    rejected INT NOT NULL,
    invalidated INT NOT NULL,
    blocked INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_h1_run_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_h1_run_at ON dbo.app_h1_run(run_at DESC);
END
GO
