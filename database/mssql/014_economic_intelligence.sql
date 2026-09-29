-- Economic Intelligence persistence. Provider secrets are never stored here; only environment-variable names.
IF OBJECT_ID(N'dbo.app_econ_policy', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_policy (
    id INT NOT NULL PRIMARY KEY,
    policy_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_policy_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_econ_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_event (
    event_id NVARCHAR(80) NOT NULL PRIMARY KEY,
    provider_key NVARCHAR(160) NOT NULL,
    scheduled_at DATETIME2 NOT NULL,
    currency NVARCHAR(8) NOT NULL,
    country NVARCHAR(8) NOT NULL,
    title NVARCHAR(240) NOT NULL,
    impact NVARCHAR(16) NOT NULL,
    series_kind NVARCHAR(32) NOT NULL,
    unit NVARCHAR(16) NULL,
    actual NVARCHAR(40) NULL,
    forecast NVARCHAR(40) NULL,
    previous NVARCHAR(40) NULL,
    status NVARCHAR(16) NOT NULL,
    surprise_json NVARCHAR(MAX) NULL,
    source_mode NVARCHAR(24) NOT NULL,
    revision INT NOT NULL CONSTRAINT DF_app_econ_event_rev DEFAULT 1,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_event_at DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_econ_event_time ON dbo.app_econ_event(scheduled_at);
END
GO

IF OBJECT_ID(N'dbo.app_econ_revision', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_revision (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_id NVARCHAR(80) NOT NULL,
    revision INT NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_revision_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_econ_instrument', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_instrument (
    symbol NVARCHAR(16) NOT NULL PRIMARY KEY,
    state NVARCHAR(32) NOT NULL,
    active_event_id NVARCHAR(80) NULL,
    currency NVARCHAR(8) NULL,
    impact NVARCHAR(16) NULL,
    minutes_to_event INT NULL,
    surprise NVARCHAR(80) NULL,
    spread_condition NVARCHAR(24) NOT NULL,
    volatility_condition NVARCHAR(24) NOT NULL,
    restriction NVARCHAR(32) NOT NULL,
    blocks_new INT NOT NULL,
    revalidation_required INT NOT NULL,
    reason NVARCHAR(400) NOT NULL,
    detail_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_instrument_at DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_econ_audit', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_audit (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_type NVARCHAR(48) NOT NULL,
    event_id NVARCHAR(80) NULL,
    symbol NVARCHAR(16) NULL,
    severity NVARCHAR(16) NOT NULL,
    detail NVARCHAR(400) NOT NULL,
    payload_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_audit_at DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_econ_audit_id ON dbo.app_econ_audit(id);
END
GO

IF OBJECT_ID(N'dbo.app_econ_outcome', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_outcome (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_id NVARCHAR(80) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    outcome_json NVARCHAR(MAX) NOT NULL,
    published INT NOT NULL CONSTRAINT DF_app_econ_outcome_pub DEFAULT 0,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_econ_outcome_at DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_econ_outcome_pub ON dbo.app_econ_outcome(published);
END
GO

IF OBJECT_ID(N'dbo.app_econ_engine', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_econ_engine (
    id INT NOT NULL PRIMARY KEY,
    state NVARCHAR(32) NOT NULL,
    source_mode NVARCHAR(24) NOT NULL,
    reason NVARCHAR(400) NOT NULL,
    heartbeat_at DATETIME2 NOT NULL,
    detail_json NVARCHAR(MAX) NOT NULL
  );
END
GO
