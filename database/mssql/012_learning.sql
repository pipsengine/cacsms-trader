-- Stage 10 candidate parameters and version history.
-- Production risk configuration is not updated by these tables.

IF OBJECT_ID(N'dbo.app_learning_proposal', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_learning_proposal (
    proposal_key NVARCHAR(80) NOT NULL PRIMARY KEY,
    parameter NVARCHAR(64) NOT NULL,
    lifecycle NVARCHAR(16) NOT NULL,
    direction NVARCHAR(16) NOT NULL,
    reason NVARCHAR(600) NOT NULL,
    sample_size INT NOT NULL,
    required_size INT NOT NULL,
    production_value FLOAT NULL,
    candidate_value FLOAT NULL,
    applied BIT NOT NULL CONSTRAINT DF_app_learning_proposal_applied DEFAULT 0,
    evidence_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_learning_proposal_created DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL CONSTRAINT DF_app_learning_proposal_updated DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID(N'dbo.app_learning_version', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_learning_version (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    version_label NVARCHAR(40) NOT NULL,
    kind NVARCHAR(16) NOT NULL,
    parameters_json NVARCHAR(MAX) NOT NULL,
    metrics_json NVARCHAR(MAX) NULL,
    predecessor_id BIGINT NULL,
    comparison NVARCHAR(32) NULL,
    note NVARCHAR(600) NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_learning_version_created DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX IX_app_learning_version_kind ON dbo.app_learning_version(kind, id DESC);
END
GO
