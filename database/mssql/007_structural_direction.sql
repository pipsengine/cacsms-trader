-- Stage 6 Structural Direction persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_direction_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_direction_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(40) NOT NULL,
    reason NVARCHAR(500) NOT NULL,
    structural_phase NVARCHAR(24) NULL,
    alignment NVARCHAR(16) NOT NULL,
    confidence FLOAT NOT NULL,
    channel_position FLOAT NULL,
    zone NVARCHAR(24) NULL,
    ready_for_h1 BIT NOT NULL CONSTRAINT DF_app_direction_instrument_ready DEFAULT 0,
    ready_since DATETIME2 NULL,
    scanner_state NVARCHAR(24) NULL,
    vision_status NVARCHAR(24) NULL,
    d1_status NVARCHAR(16) NULL,
    d1_direction NVARCHAR(24) NULL,
    h8_status NVARCHAR(16) NULL,
    h8_direction NVARCHAR(24) NULL,
    freshness_status NVARCHAR(16) NOT NULL,
    trigger_reason NVARCHAR(200) NULL,
    decision_json NVARCHAR(MAX) NOT NULL,
    changed_at DATETIME2 NOT NULL,
    evaluated_at DATETIME2 NOT NULL CONSTRAINT DF_app_direction_instrument_evaluated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_direction_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_direction_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    state NVARCHAR(24) NOT NULL,
    direction NVARCHAR(24) NOT NULL,
    reason_code NVARCHAR(40) NOT NULL,
    structural_phase NVARCHAR(24) NULL,
    alignment NVARCHAR(16) NOT NULL,
    confidence FLOAT NOT NULL,
    channel_position FLOAT NULL,
    d1_status NVARCHAR(16) NULL,
    d1_direction NVARCHAR(24) NULL,
    h8_status NVARCHAR(16) NULL,
    h8_direction NVARCHAR(24) NULL,
    prev_state NVARCHAR(24) NULL,
    prev_direction NVARCHAR(24) NULL,
    trigger_reason NVARCHAR(200) NULL,
    explanation NVARCHAR(900) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_direction_history_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_direction_history_symbol ON dbo.app_direction_history(symbol, created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_direction_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_direction_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    run_at DATETIME2 NOT NULL,
    triggers NVARCHAR(400) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    candidates INT NOT NULL,
    aligned INT NOT NULL,
    pullback_waiting INT NOT NULL,
    conflicts INT NOT NULL,
    blocked INT NOT NULL,
    ready INT NOT NULL,
    changed INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_direction_run_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_direction_run_at ON dbo.app_direction_run(run_at DESC);
END
GO
