CREATE OR REPLACE VIEW execution_audit_journal AS
SELECT
  'EXECUTION'::text AS source_system,
  e.id::text AS source_id,
  e.created_at AS occurred_at,
  e.severity AS severity,
  e.event_type AS event_type,
  e.message AS message,
  e.payload AS payload,
  c.command_id AS correlation_id,
  c.terminal_id AS terminal_id,
  t.account_number AS account_number,
  a.broker_name AS broker_name,
  a.server_name AS server_name,
  c.environment AS environment,
  c.sandbox_mode AS sandbox_mode
FROM execution_command_events e
JOIN execution_commands c ON c.command_id = e.command_id
LEFT JOIN mt5_terminals t ON t.terminal_id = c.terminal_id
LEFT JOIN trading_accounts a ON a.account_number = t.account_number

UNION ALL

SELECT
  'EA_COMM'::text AS source_system,
  ev.id::text AS source_id,
  ev.created_at AS occurred_at,
  ev.severity AS severity,
  ev.event_type AS event_type,
  ev.message AS message,
  ev.payload AS payload,
  COALESCE(ev.payload->>'commandId', ev.payload->>'intentId', ev.terminal_id) AS correlation_id,
  ev.terminal_id AS terminal_id,
  t.account_number AS account_number,
  a.broker_name AS broker_name,
  a.server_name AS server_name,
  NULL::text AS environment,
  NULL::boolean AS sandbox_mode
FROM ea_comm_events ev
LEFT JOIN mt5_terminals t ON t.terminal_id = ev.terminal_id
LEFT JOIN trading_accounts a ON a.account_number = t.account_number

UNION ALL

SELECT
  'RISK'::text AS source_system,
  r.id::text AS source_id,
  r.created_at AS occurred_at,
  CASE WHEN r.allowed THEN 'INFO' ELSE 'WARNING' END AS severity,
  r.code AS event_type,
  r.message AS message,
  jsonb_build_object(
    'allowed', r.allowed,
    'remainingDailyLossAmount', r.remaining_daily_loss_amount
  ) AS payload,
  COALESCE(r.intent_id, r.account_number) AS correlation_id,
  NULL::text AS terminal_id,
  r.account_number AS account_number,
  a.broker_name AS broker_name,
  a.server_name AS server_name,
  NULL::text AS environment,
  NULL::boolean AS sandbox_mode
FROM risk_decisions r
JOIN trading_accounts a ON a.account_number = r.account_number;

