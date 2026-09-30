-- Multi-resolution opportunity snapshots. Existing stage tables are not modified.
IF OBJECT_ID(N'dbo.app_opportunity_run', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_opportunity_run (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    summary_json NVARCHAR(MAX) NOT NULL,
    snapshot_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_opportunity_run_at DEFAULT SYSUTCDATETIME()
  );
END
GO
