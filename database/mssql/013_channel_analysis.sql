-- Channel Analysis persistence for db_Cacsms-Trader (no seed rows).
-- Candles stay in dbo.app_candles (Stage 1). Only channel geometry, evidence, lifecycle and hierarchy are stored.
IF OBJECT_ID(N'dbo.app_channel_state', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_state (
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_id NVARCHAR(96) NULL,
    status NVARCHAR(16) NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    phase NVARCHAR(24) NULL,
    relationship NVARCHAR(24) NOT NULL,
    parent_timeframe NVARCHAR(4) NULL,
    parent_channel_id NVARCHAR(96) NULL,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_channel_state_conf DEFAULT 0,
    position FLOAT NULL,
    upper_now FLOAT NULL,
    mid_now FLOAT NULL,
    lower_now FLOAT NULL,
    slope FLOAT NULL,
    width FLOAT NULL,
    width_atr FLOAT NULL,
    touch_count INT NOT NULL CONSTRAINT DF_app_channel_state_touch DEFAULT 0,
    touch_quality FLOAT NULL,
    data_status NVARCHAR(24) NOT NULL,
    data_reason NVARCHAR(400) NULL,
    source_timeframe NVARCHAR(4) NOT NULL,
    source_bar_ts BIGINT NULL,
    last_bar_ts BIGINT NULL,
    run_id BIGINT NULL,
    config_version NVARCHAR(40) NOT NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_state_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_channel_state PRIMARY KEY (symbol, timeframe)
  );
  CREATE INDEX IX_app_channel_state_channel ON dbo.app_channel_state(channel_id);
END
GO

IF OBJECT_ID(N'dbo.app_channel_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    run_id BIGINT NULL,
    state_version NVARCHAR(40) NOT NULL,
    primary_direction NVARCHAR(16) NOT NULL,
    intermediate_direction NVARCHAR(16) NOT NULL,
    current_direction NVARCHAR(16) NOT NULL,
    market_state NVARCHAR(24) NOT NULL,
    structural_confidence FLOAT NOT NULL CONSTRAINT DF_app_channel_instrument_conf DEFAULT 0,
    alignment FLOAT NULL,
    live_price FLOAT NULL,
    live_at DATETIME2 NULL,
    hierarchy_json NVARCHAR(MAX) NOT NULL,
    interpretation_json NVARCHAR(MAX) NOT NULL,
    trigger_reason NVARCHAR(200) NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_instrument_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_channel_edge', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_edge (
    symbol NVARCHAR(16) NOT NULL,
    child_timeframe NVARCHAR(4) NOT NULL,
    parent_timeframe NVARCHAR(4) NOT NULL,
    via_timeframe NVARCHAR(4) NULL,
    relationship NVARCHAR(24) NOT NULL,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_channel_edge_conf DEFAULT 0,
    explanation NVARCHAR(400) NOT NULL,
    run_id BIGINT NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_edge_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_channel_edge PRIMARY KEY (symbol, child_timeframe)
  );
END
GO

IF OBJECT_ID(N'dbo.app_channel_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_id NVARCHAR(96) NOT NULL,
    anchor_side NVARCHAR(8) NULL,
    anchor_ts BIGINT NULL,
    direction NVARCHAR(16) NOT NULL,
    last_status NVARCHAR(16) NOT NULL,
    first_status NVARCHAR(16) NOT NULL,
    validated_bar_ts BIGINT NULL,
    broken_bar_ts BIGINT NULL,
    invalidated_bar_ts BIGINT NULL,
    first_seen_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_history_first DEFAULT SYSUTCDATETIME(),
    last_seen_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_history_last DEFAULT SYSUTCDATETIME(),
    replaced_at DATETIME2 NULL,
    config_version NVARCHAR(40) NOT NULL,
    CONSTRAINT UQ_app_channel_history UNIQUE (symbol, timeframe, channel_id)
  );
  CREATE INDEX IX_app_channel_history_sym ON dbo.app_channel_history(symbol, timeframe);
END
GO

IF OBJECT_ID(N'dbo.app_channel_touch', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_touch (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_id NVARCHAR(96) NOT NULL,
    seq INT NOT NULL,
    boundary NVARCHAR(8) NOT NULL,
    role NVARCHAR(16) NOT NULL,
    bar_ts BIGINT NOT NULL,
    price FLOAT NOT NULL,
    line_price FLOAT NOT NULL,
    deviation_atr FLOAT NOT NULL,
    CONSTRAINT UQ_app_channel_touch UNIQUE (symbol, timeframe, channel_id, seq)
  );
  CREATE INDEX IX_app_channel_touch_sym ON dbo.app_channel_touch(symbol, timeframe);
END
GO

IF OBJECT_ID(N'dbo.app_channel_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_id NVARCHAR(96) NOT NULL,
    event_type NVARCHAR(32) NOT NULL,
    bar_ts BIGINT NOT NULL,
    price FLOAT NULL,
    severity NVARCHAR(12) NOT NULL,
    detail NVARCHAR(600) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_event_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_channel_event UNIQUE (symbol, timeframe, channel_id, event_type, bar_ts)
  );
  CREATE INDEX IX_app_channel_event_sym ON dbo.app_channel_event(symbol, created_at);
END
GO

IF OBJECT_ID(N'dbo.app_channel_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_channel_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    trigger_reason NVARCHAR(240) NOT NULL,
    symbols_json NVARCHAR(MAX) NOT NULL,
    analysed INT NOT NULL,
    failed INT NOT NULL,
    new_events INT NOT NULL,
    duration_ms INT NOT NULL,
    config_version NVARCHAR(40) NOT NULL,
    run_at DATETIME2 NOT NULL CONSTRAINT DF_app_channel_run_at DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_channel_run_at ON dbo.app_channel_run(run_at);
END
GO
