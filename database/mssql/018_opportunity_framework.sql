-- Opportunity framework: one row per classified opportunity and an append-only transition audit. Additive only.
-- Existing opportunity, campaign and stage tables are untouched; historical rows keep their original labels and are read
-- through opportunity_types.legacy_type (framework_version records which taxonomy produced a row).
IF OBJECT_ID(N'dbo.app_opportunity_hypothesis', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_opportunity_hypothesis (
    opportunity_id NVARCHAR(40) NOT NULL PRIMARY KEY,
    framework_version NVARCHAR(16) NOT NULL,
    opportunity_type NVARCHAR(8) NOT NULL,
    opportunity_context NVARCHAR(200) NULL,
    route NVARCHAR(48) NOT NULL,
    mode NVARCHAR(16) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    parent_tf NVARCHAR(8) NULL,
    child_tf NVARCHAR(8) NULL,
    execution_tf NVARCHAR(8) NULL,
    channel_id NVARCHAR(120) NULL,
    channel_role NVARCHAR(48) NULL,
    trigger_type NVARCHAR(48) NULL,
    trigger_ts BIGINT NULL,
    trigger_price FLOAT NULL,
    contract_id NVARCHAR(40) NOT NULL,
    confirmation_state NVARCHAR(40) NOT NULL,
    detector_state NVARCHAR(80) NULL,
    lifecycle NVARCHAR(24) NOT NULL,
    required_json NVARCHAR(MAX) NULL,
    satisfied_json NVARCHAR(MAX) NULL,
    missing_json NVARCHAR(MAX) NULL,
    optional_json NVARCHAR(MAX) NULL,
    invalidation_reason NVARCHAR(400) NULL,
    confidence FLOAT NULL,
    entry_quality NVARCHAR(16) NULL,
    campaign_id NVARCHAR(40) NULL,
    episode_id NVARCHAR(40) NULL,
    revision INT NOT NULL,
    risk_group NVARCHAR(40) NULL,
    counterfactual_json NVARCHAR(MAX) NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    discovered_at DATETIME2 NOT NULL,
    updated_at DATETIME2 NOT NULL,
    closed_at DATETIME2 NULL
  );
  CREATE INDEX IX_app_opportunity_hypothesis_open ON dbo.app_opportunity_hypothesis(closed_at, symbol);
  CREATE INDEX IX_app_opportunity_hypothesis_type ON dbo.app_opportunity_hypothesis(opportunity_type, lifecycle);
END
GO

IF OBJECT_ID(N'dbo.app_opportunity_transition', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_opportunity_transition (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id NVARCHAR(40) NOT NULL,
    opportunity_type NVARCHAR(8) NOT NULL,
    symbol NVARCHAR(16) NOT NULL,
    episode_id NVARCHAR(40) NULL,
    mode NVARCHAR(16) NOT NULL,
    from_lifecycle NVARCHAR(24) NULL,
    to_lifecycle NVARCHAR(24) NOT NULL,
    from_state NVARCHAR(80) NULL,
    to_state NVARCHAR(80) NULL,
    confirmation_state NVARCHAR(40) NULL,
    revision INT NOT NULL,
    detail NVARCHAR(600) NULL,
    created_at DATETIME2 NOT NULL
  );
  CREATE INDEX IX_app_opportunity_transition_opp ON dbo.app_opportunity_transition(opportunity_id, id);
  CREATE INDEX IX_app_opportunity_transition_time ON dbo.app_opportunity_transition(created_at);
END
GO
