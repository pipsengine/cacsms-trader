-- Stage 3 Historical Regime persistence for db_Cacsms-Trader (no seed rows)
IF OBJECT_ID(N'dbo.app_regime_snapshot', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_regime_snapshot (
    asset NVARCHAR(8) NOT NULL,
    obs_date DATE NOT NULL,
    is_closed BIT NOT NULL,
    q FLOAT NOT NULL,
    m FLOAT NOT NULL,
    w FLOAT NOT NULL,
    d FLOAT NOT NULL,
    macro FLOAT NOT NULL,
    current_strength FLOAT NOT NULL,
    composite FLOAT NOT NULL,
    prev_composite FLOAT NULL,
    momentum FLOAT NULL,
    acceleration FLOAT NULL,
    raw_regime NVARCHAR(24) NULL,
    regime NVARCHAR(24) NULL,
    regime_since DATE NULL,
    candidate NVARCHAR(24) NULL,
    candidate_count INT NOT NULL CONSTRAINT DF_app_regime_snapshot_cc DEFAULT 0,
    candidate_since DATE NULL,
    duration_obs INT NOT NULL CONSTRAINT DF_app_regime_snapshot_dur DEFAULT 0,
    confidence FLOAT NOT NULL CONSTRAINT DF_app_regime_snapshot_conf DEFAULT 0,
    obs_confidence FLOAT NOT NULL CONSTRAINT DF_app_regime_snapshot_oconf DEFAULT 0,
    persistence FLOAT NOT NULL CONSTRAINT DF_app_regime_snapshot_pers DEFAULT 0,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_regime_snapshot_updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_regime_snapshot PRIMARY KEY (asset, obs_date)
  );
END
GO

IF OBJECT_ID(N'dbo.app_regime_transition', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_regime_transition (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    asset NVARCHAR(8) NOT NULL,
    confirmed_at DATE NOT NULL,
    first_seen DATE NOT NULL,
    prev_regime NVARCHAR(24) NOT NULL,
    new_regime NVARCHAR(24) NOT NULL,
    confidence FLOAT NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    evidence_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_regime_transition_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_regime_transition UNIQUE (asset, confirmed_at)
  );
  CREATE INDEX IX_app_regime_transition_confirmed ON dbo.app_regime_transition(confirmed_at DESC);
END
GO

IF OBJECT_ID(N'dbo.app_regime_pair', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_regime_pair (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    base NVARCHAR(8) NOT NULL,
    quote NVARCHAR(8) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    bias NVARCHAR(16) NOT NULL,
    differential FLOAT NOT NULL,
    conviction FLOAT NOT NULL,
    persistence FLOAT NOT NULL,
    momentum FLOAT NOT NULL,
    confidence FLOAT NOT NULL,
    base_regime NVARCHAR(24) NULL,
    quote_regime NVARCHAR(24) NULL,
    relationship NVARCHAR(24) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    obs_date DATE NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_regime_pair_updated DEFAULT SYSUTCDATETIME()
  );
END
GO
