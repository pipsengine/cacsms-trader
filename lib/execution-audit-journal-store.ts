import { queryPostgres } from '@/lib/postgres';

export type AuditSourceSystem = 'EXECUTION' | 'EA_COMM' | 'RISK';
export type AuditSeverity = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type ExecutionAuditEvent = {
  key: string;
  sourceSystem: AuditSourceSystem;
  sourceId: string;
  occurredAt: string;
  severity: AuditSeverity;
  eventType: string;
  message: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  terminalId: string | null;
  accountNumber: string | null;
  brokerName: string | null;
  serverName: string | null;
  environment: string | null;
  sandboxMode: boolean | null;
};

export async function listExecutionAuditEvents(filter: {
  sinceTs?: string;
  untilTs?: string;
  terminalId?: string;
  accountNumber?: string;
  brokerName?: string;
  environment?: string;
  sourceSystem?: AuditSourceSystem;
  severity?: AuditSeverity;
  correlationId?: string;
  query?: string;
  order?: 'asc' | 'desc';
  limit?: number;
}): Promise<ExecutionAuditEvent[]> {
  const limit = Math.min(5000, Math.max(1, Number(filter.limit ?? 250)));
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.sinceTs) {
    params.push(filter.sinceTs);
    conditions.push(`occurred_at > $${params.length}::timestamptz`);
  }
  if (filter.untilTs) {
    params.push(filter.untilTs);
    conditions.push(`occurred_at <= $${params.length}::timestamptz`);
  }
  if (filter.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`terminal_id = $${params.length}`);
  }
  if (filter.accountNumber) {
    params.push(filter.accountNumber);
    conditions.push(`account_number = $${params.length}`);
  }
  if (filter.brokerName) {
    params.push(filter.brokerName);
    conditions.push(`broker_name = $${params.length}`);
  }
  if (filter.environment) {
    params.push(filter.environment);
    conditions.push(`environment = $${params.length}`);
  }
  if (filter.sourceSystem) {
    params.push(filter.sourceSystem);
    conditions.push(`source_system = $${params.length}`);
  }
  if (filter.severity) {
    params.push(filter.severity);
    conditions.push(`severity = $${params.length}`);
  }
  if (filter.correlationId) {
    params.push(filter.correlationId);
    conditions.push(`correlation_id = $${params.length}`);
  }

  const query = String(filter.query ?? '').trim();
  if (query) {
    params.push(`%${query}%`);
    const token = `$${params.length}`;
    conditions.push(`(message ILIKE ${token} OR event_type ILIKE ${token} OR correlation_id ILIKE ${token} OR terminal_id ILIKE ${token} OR account_number ILIKE ${token} OR broker_name ILIKE ${token})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = filter.order === 'asc' ? 'ASC' : 'DESC';
  params.push(limit);

  const result = await queryPostgres(
    `
      SELECT *
      FROM execution_audit_journal
      ${where}
      ORDER BY occurred_at ${order}, source_system ${order}, source_id ${order}
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row: any) => mapAuditRow(row));
}

export async function getExecutionAuditTimeline(input: { correlationId: string; limit?: number }): Promise<ExecutionAuditEvent[]> {
  const correlationId = String(input.correlationId ?? '').trim();
  if (!correlationId) return [];
  const limit = Math.min(2000, Math.max(1, Number(input.limit ?? 600)));

  const result = await queryPostgres(
    `
      SELECT *
      FROM execution_audit_journal
      WHERE correlation_id = $1
      ORDER BY occurred_at ASC, source_system ASC, source_id ASC
      LIMIT $2
    `,
    [correlationId, limit],
  );
  return result.rows.map((row: any) => mapAuditRow(row));
}

export async function summarizeExecutionAudit(input: { windowMinutes?: number } = {}) {
  const minutes = Math.min(24 * 60, Math.max(1, Number(input.windowMinutes ?? 180)));
  const totals = await queryPostgres(
    `
      SELECT
        count(*)::int AS total,
        sum(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END)::int AS errors,
        sum(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END)::int AS warnings,
        sum(CASE WHEN source_system = 'EXECUTION' THEN 1 ELSE 0 END)::int AS execution_events,
        sum(CASE WHEN source_system = 'EA_COMM' THEN 1 ELSE 0 END)::int AS ea_events,
        sum(CASE WHEN source_system = 'RISK' THEN 1 ELSE 0 END)::int AS risk_events
      FROM execution_audit_journal
      WHERE occurred_at > now() - ($1::int * interval '1 minute')
    `,
    [minutes],
  );

  const topIncidents = await queryPostgres(
    `
      SELECT
        correlation_id,
        max(occurred_at) AS last_seen_at,
        count(*)::int AS event_count,
        sum(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END)::int AS error_count,
        sum(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END)::int AS warning_count
      FROM execution_audit_journal
      WHERE occurred_at > now() - ($1::int * interval '1 minute')
        AND (severity = 'ERROR' OR severity = 'WARNING')
        AND correlation_id IS NOT NULL
      GROUP BY correlation_id
      ORDER BY error_count DESC, warning_count DESC, last_seen_at DESC
      LIMIT 30
    `,
    [minutes],
  );

  const brokerDiagnostics = await queryPostgres(
    `
      SELECT
        broker_name,
        count(*)::int AS total,
        sum(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END)::int AS errors,
        sum(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END)::int AS warnings
      FROM execution_audit_journal
      WHERE occurred_at > now() - ($1::int * interval '1 minute')
        AND broker_name IS NOT NULL
      GROUP BY broker_name
      ORDER BY errors DESC, warnings DESC, total DESC
      LIMIT 20
    `,
    [minutes],
  );

  const terminalDiagnostics = await queryPostgres(
    `
      SELECT
        terminal_id,
        count(*)::int AS total,
        sum(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END)::int AS errors,
        sum(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END)::int AS warnings
      FROM execution_audit_journal
      WHERE occurred_at > now() - ($1::int * interval '1 minute')
        AND terminal_id IS NOT NULL
      GROUP BY terminal_id
      ORDER BY errors DESC, warnings DESC, total DESC
      LIMIT 20
    `,
    [minutes],
  );

  return {
    windowMinutes: minutes,
    totals: totals.rows[0]
      ? {
          total: Number(totals.rows[0].total),
          errors: Number(totals.rows[0].errors),
          warnings: Number(totals.rows[0].warnings),
          executionEvents: Number(totals.rows[0].execution_events),
          eaEvents: Number(totals.rows[0].ea_events),
          riskEvents: Number(totals.rows[0].risk_events),
        }
      : { total: 0, errors: 0, warnings: 0, executionEvents: 0, eaEvents: 0, riskEvents: 0 },
    incidents: topIncidents.rows.map((row: any) => ({
      correlationId: row.correlation_id ? String(row.correlation_id) : null,
      lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : new Date().toISOString(),
      eventCount: Number(row.event_count ?? 0),
      errorCount: Number(row.error_count ?? 0),
      warningCount: Number(row.warning_count ?? 0),
    })),
    brokerDiagnostics: brokerDiagnostics.rows.map((row: any) => ({
      brokerName: String(row.broker_name),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
      warnings: Number(row.warnings ?? 0),
    })),
    terminalDiagnostics: terminalDiagnostics.rows.map((row: any) => ({
      terminalId: String(row.terminal_id),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
      warnings: Number(row.warnings ?? 0),
    })),
  };
}

function mapAuditRow(row: any): ExecutionAuditEvent {
  const sourceSystem = String(row.source_system) as AuditSourceSystem;
  const sourceId = String(row.source_id);
  const occurredAt = row.occurred_at ? new Date(row.occurred_at).toISOString() : new Date().toISOString();
  const key = `${sourceSystem}:${sourceId}`;
  return {
    key,
    sourceSystem,
    sourceId,
    occurredAt,
    severity: String(row.severity) as AuditSeverity,
    eventType: String(row.event_type),
    message: String(row.message),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    correlationId: row.correlation_id ? String(row.correlation_id) : null,
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    accountNumber: row.account_number ? String(row.account_number) : null,
    brokerName: row.broker_name ? String(row.broker_name) : null,
    serverName: row.server_name ? String(row.server_name) : null,
    environment: row.environment ? String(row.environment) : null,
    sandboxMode: row.sandbox_mode == null ? null : Boolean(row.sandbox_mode),
  };
}

