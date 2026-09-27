-- Stage 5 HTF Market Vision persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_vision_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_vision_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    status NVARCHAR(24) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    scanner_status NVARCHAR(24) NOT NULL,
    scanner_reason NVARCHAR(300) NULL,
    primary_direction NVARCHAR(16) NOT NULL,
    agreement NVARCHAR(16) NOT NULL,
    phase NVARCHAR(24) NULL,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_vision_instrument_conf DEFAULT 0,
    channel_position FLOAT NULL,
    live_price FLOAT NULL,
    live_position_d1 FLOAT NULL,
    live_position_h8 FLOAT NULL,
    live_at DATETIME2 NULL,
    d1_bar_ts BIGINT NULL,
    h8_bar_ts BIGINT NULL,
    output_json NVARCHAR(MAX) NOT NULL,
    trigger_reason NVARCHAR(200) NULL,
    duration_ms INT NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_vision_instrument_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_vision_channel', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_vision_channel (
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    data_status NVARCHAR(24) NOT NULL,
    data_reason NVARCHAR(400) NOT NULL,
    bars_available INT NOT NULL,
    bars_required INT NOT NULL,
    channel_key NVARCHAR(64) NULL,
    status NVARCHAR(16) NULL,
    direction NVARCHAR(16) NOT NULL,
    lean NVARCHAR(16) NULL,
    confirmed BIT NOT NULL CONSTRAINT DF_app_vision_channel_conf DEFAULT 0,
    phase NVARCHAR(24) NULL,
    position FLOAT NULL,
    upper_now FLOAT NULL,
    lower_now FLOAT NULL,
    slope FLOAT NULL,
    slope_atr20 FLOAT NULL,
    width FLOAT NULL,
    width_atr FLOAT NULL,
    touches_anchor INT NULL,
    touches_opposite INT NULL,
    touch_quality FLOAT NULL,
    parallel_dev FLOAT NULL,
    age_bars INT NULL,
    breakout_side NVARCHAR(8) NULL,
    breakout_ts BIGINT NULL,
    breakout_atr FLOAT NULL,
    atr FLOAT NULL,
    vol_ratio FLOAT NULL,
    vol_state NVARCHAR(16) NULL,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_vision_channel_c DEFAULT 0,
    last_bar_ts BIGINT NULL,
    analysis_json NVARCHAR(MAX) NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_vision_channel_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_vision_channel PRIMARY KEY (symbol, timeframe)
  );
END
GO

IF OBJECT_ID(N'dbo.app_vision_touch', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_vision_touch (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_key NVARCHAR(64) NOT NULL,
    seq INT NOT NULL,
    boundary NVARCHAR(8) NOT NULL,
    role NVARCHAR(16) NOT NULL,
    bar_ts BIGINT NOT NULL,
    price FLOAT NOT NULL,
    line_price FLOAT NOT NULL,
    deviation_atr FLOAT NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_vision_touch_at DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_vision_touch_sym ON dbo.app_vision_touch(symbol, timeframe);
END
GO

IF OBJECT_ID(N'dbo.app_vision_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_vision_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    timeframe NVARCHAR(4) NOT NULL,
    channel_key NVARCHAR(64) NOT NULL,
    event_type NVARCHAR(32) NOT NULL,
    bar_ts BIGINT NOT NULL,
    price FLOAT NULL,
    severity NVARCHAR(12) NOT NULL,
    detail NVARCHAR(600) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_vision_event_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_vision_event UNIQUE (symbol, timeframe, channel_key, event_type, bar_ts)
  );
  CREATE INDEX IX_app_vision_event_created ON dbo.app_vision_event(created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_vision_history', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_vision_history (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    symbol NVARCHAR(16) NOT NULL,
    d1_bar_ts BIGINT NOT NULL,
    h8_bar_ts BIGINT NOT NULL,
    status NVARCHAR(24) NOT NULL,
    primary_direction NVARCHAR(16) NOT NULL,
    agreement NVARCHAR(16) NOT NULL,
    phase NVARCHAR(24) NULL,
    confidence FLOAT NOT NULL,
    d1_status NVARCHAR(16) NULL,
    d1_direction NVARCHAR(16) NULL,
    d1_position FLOAT NULL,
    d1_confidence FLOAT NULL,
    h8_status NVARCHAR(16) NULL,
    h8_direction NVARCHAR(16) NULL,
    h8_position FLOAT NULL,
    h8_confidence FLOAT NULL,
    trigger_reason NVARCHAR(200) NULL,
    analysed_at DATETIME2 NOT NULL CONSTRAINT DF_app_vision_history_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_vision_history UNIQUE (symbol, d1_bar_ts, h8_bar_ts)
  );
END
GO

IF COL_LENGTH(N'dbo.app_vision_instrument', N'live_tick_ts') IS NULL
  ALTER TABLE dbo.app_vision_instrument ADD live_tick_ts BIGINT NULL, live_market_open BIT NULL;
GO
