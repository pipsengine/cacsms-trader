-- Notification settings and outbox. Additive only. No SMTP secrets are stored here.
IF OBJECT_ID(N'dbo.app_notification_settings', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_notification_settings (
    id INT NOT NULL PRIMARY KEY,
    master_enabled INTEGER NOT NULL,
    fx_enabled INTEGER NOT NULL,
    xau_enabled INTEGER NOT NULL,
    recipient NVARCHAR(320) NOT NULL,
    policies_json NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2 NOT NULL
  );
END
GO

IF OBJECT_ID(N'dbo.app_notification_outbox', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_notification_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id NVARCHAR(40) NOT NULL,
    event_key NVARCHAR(240) NOT NULL,
    candidate_id NVARCHAR(80) NULL,
    campaign_id NVARCHAR(80) NULL,
    symbol NVARCHAR(16) NULL,
    tit_level NVARCHAR(8) NULL,
    event_type NVARCHAR(64) NOT NULL,
    category NVARCHAR(32) NOT NULL,
    recipient NVARCHAR(320) NOT NULL,
    subject NVARCHAR(300) NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(16) NOT NULL,
    attempt_count INT NOT NULL,
    last_error NVARCHAR(400) NULL,
    created_at DATETIME2 NOT NULL,
    last_attempt_at DATETIME2 NULL,
    sent_at DATETIME2 NULL,
    next_attempt_at DATETIME2 NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS UX_app_notification_outbox_event ON dbo.app_notification_outbox(event_key);
  CREATE INDEX IX_app_notification_outbox_status ON dbo.app_notification_outbox(status, created_at);
END
GO
