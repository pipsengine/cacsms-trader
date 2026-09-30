-- Campaign learning events. Additive. Production parameters are not stored here and are not updated from these rows.

IF OBJECT_ID(N'dbo.app_campaign_event', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_campaign_event (
    id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    event_key NVARCHAR(160) NOT NULL,
    campaign_id NVARCHAR(40) NULL,
    symbol NVARCHAR(16) NULL,
    family NVARCHAR(48) NULL,
    tit_level NVARCHAR(8) NULL,
    kind NVARCHAR(48) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL CONSTRAINT DF_app_campaign_event_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_app_campaign_event_key UNIQUE (event_key)
  );
  CREATE INDEX IX_app_campaign_event_symbol ON dbo.app_campaign_event(symbol, kind);
END
GO
