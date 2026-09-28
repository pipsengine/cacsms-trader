-- Durable autonomy control plane for the existing S1-S10 engines.
-- The SQLite adapter applies this migration to database/db_cacsms-trader.db.

IF OBJECT_ID(N'dbo.app_auto_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_auto_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_key NVARCHAR(160) NULL,
    event_type NVARCHAR(64) NOT NULL,
    source NVARCHAR(32) NOT NULL,
    stage INT NULL,
    symbol NVARCHAR(16) NULL,
    account_id NVARCHAR(64) NULL,
    severity NVARCHAR(12) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    trigger_json NVARCHAR(MAX) NULL,
    payload_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_auto_event_created DEFAULT SYSUTCDATETIME(),
    processed_at DATETIME2 NULL,
    error NVARCHAR(800) NULL
  );
  CREATE INDEX IX_app_auto_event_pending ON dbo.app_auto_event(status, id);
  CREATE INDEX IX_app_auto_event_subject ON dbo.app_auto_event(symbol, stage, id);
END
GO

IF OBJECT_ID(N'dbo.app_auto_job', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_auto_job (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    job_key NVARCHAR(180) NOT NULL,
    event_id BIGINT NULL,
    stage INT NOT NULL,
    symbol NVARCHAR(16) NULL,
    account_id NVARCHAR(64) NULL,
    action NVARCHAR(64) NOT NULL,
    state NVARCHAR(16) NOT NULL,
    priority INT NOT NULL,
    attempt INT NOT NULL CONSTRAINT DF_app_auto_job_attempt DEFAULT 0,
    max_attempts INT NOT NULL CONSTRAINT DF_app_auto_job_max_attempt DEFAULT 5,
    input_version NVARCHAR(80) NULL,
    not_before DATETIME2 NULL,
    lease_owner NVARCHAR(64) NULL,
    lease_until DATETIME2 NULL,
    blocker_code NVARCHAR(64) NULL,
    blocker NVARCHAR(800) NULL,
    payload_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_auto_job_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_auto_job_updated DEFAULT SYSUTCDATETIME(),
    completed_at DATETIME2 NULL,
    CONSTRAINT UQ_app_auto_job_key UNIQUE (job_key)
  );
  CREATE INDEX IX_app_auto_job_ready ON dbo.app_auto_job(state, not_before, priority, id);
END
GO

IF OBJECT_ID(N'dbo.app_world_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_world_instrument (
    symbol NVARCHAR(16) NOT NULL,
    stage INT NOT NULL,
    engine_health NVARCHAR(16) NOT NULL,
    pipeline_state NVARCHAR(24) NOT NULL,
    confidence FLOAT NULL,
    freshness NVARCHAR(16) NOT NULL,
    input_version NVARCHAR(80) NULL,
    output_version NVARCHAR(80) NULL,
    trigger NVARCHAR(240) NULL,
    current_action NVARCHAR(240) NULL,
    next_action NVARCHAR(300) NULL,
    blocker_code NVARCHAR(64) NULL,
    blocker NVARCHAR(800) NULL,
    dependencies_json NVARCHAR(MAX) NULL,
    evidence_json NVARCHAR(MAX) NULL,
    evaluated_at DATETIME2 NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_world_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_world_instrument PRIMARY KEY (symbol, stage)
  );
  CREATE INDEX IX_app_world_stage_state ON dbo.app_world_instrument(stage, pipeline_state);
END
GO

IF OBJECT_ID(N'dbo.app_auto_checkpoint', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_auto_checkpoint (
    checkpoint_key NVARCHAR(100) NOT NULL PRIMARY KEY,
    value_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_auto_checkpoint_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_learning_evaluation', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_learning_evaluation (
    evaluation_key NVARCHAR(160) NOT NULL PRIMARY KEY,
    kind NVARCHAR(24) NOT NULL,
    execution_id NVARCHAR(40) NULL,
    setup_key NVARCHAR(96) NULL,
    account_id NVARCHAR(64) NULL,
    symbol NVARCHAR(16) NOT NULL,
    decision NVARCHAR(32) NOT NULL,
    outcome NVARCHAR(32) NULL,
    confidence FLOAT NULL,
    expected_json NVARCHAR(MAX) NULL,
    actual_json NVARCHAR(MAX) NULL,
    evidence_json NVARCHAR(MAX) NOT NULL,
    recommendation_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_learning_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_learning_symbol ON dbo.app_learning_evaluation(symbol, created_at);
END
GO

IF OBJECT_ID(N'dbo.app_learning_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_learning_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    run_at DATETIME2 NOT NULL,
    trigger_reason NVARCHAR(240) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    trades_evaluated INT NOT NULL,
    rejections_evaluated INT NOT NULL,
    recommendations INT NOT NULL,
    duration_ms INT NOT NULL,
    summary_json NVARCHAR(MAX) NOT NULL
  );
END
GO

IF OBJECT_ID(N'dbo.app_auto_decision', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_auto_decision (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_id BIGINT NULL,
    job_id BIGINT NULL,
    stage INT NOT NULL,
    symbol NVARCHAR(16) NULL,
    account_id NVARCHAR(64) NULL,
    trigger_reason NVARCHAR(240) NULL,
    inputs_json NVARCHAR(MAX) NULL,
    decision NVARCHAR(32) NOT NULL,
    confidence FLOAT NULL,
    reason NVARCHAR(800) NULL,
    blocker_code NVARCHAR(64) NULL,
    blocker NVARCHAR(800) NULL,
    next_action NVARCHAR(300) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_auto_decision_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_auto_decision_subject ON dbo.app_auto_decision(symbol, stage, id);
END
GO
