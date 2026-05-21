import { queryPostgres } from '@/lib/postgres';

export type EaCommDirection = 'INBOUND' | 'OUTBOUND';
export type EaCommChannel = 'HEARTBEAT' | 'COMMAND' | 'TICK' | 'AUTH' | 'HANDSHAKE' | 'BRIDGE' | 'ERROR';
export type EaCommSeverity = 'DEBUG' | 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export type EaCommEventRecord = {
  id: string;
  terminalId: string | null;
  direction: EaCommDirection;
  channel: EaCommChannel;
  eventType: string;
  severity: EaCommSeverity;
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export async function appendEaCommEvent(input: {
  terminalId?: string | null;
  direction: EaCommDirection;
  channel: EaCommChannel;
  eventType: string;
  severity: EaCommSeverity;
  message: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await queryPostgres(
    `
      INSERT INTO ea_comm_events (
        terminal_id,
        direction,
        channel,
        event_type,
        severity,
        message,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    [
      input.terminalId ? String(input.terminalId) : null,
      input.direction,
      input.channel,
      String(input.eventType),
      input.severity,
      String(input.message),
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export async function listEaCommEvents(filter: {
  sinceId?: string;
  terminalId?: string;
  channel?: EaCommChannel;
  limit?: number;
}): Promise<EaCommEventRecord[]> {
  const limit = Math.min(500, Math.max(1, Number(filter.limit ?? 200)));
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`terminal_id = $${params.length}`);
  }
  if (filter.channel) {
    params.push(filter.channel);
    conditions.push(`channel = $${params.length}`);
  }
  if (filter.sinceId) {
    params.push(BigInt(filter.sinceId));
    conditions.push(`id > $${params.length}`);
  }

  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await queryPostgres(
    `
      SELECT *
      FROM ea_comm_events
      ${where}
      ORDER BY id ASC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row: any) => ({
    id: String(row.id),
    terminalId: row.terminal_id ? String(row.terminal_id) : null,
    direction: String(row.direction) as EaCommDirection,
    channel: String(row.channel) as EaCommChannel,
    eventType: String(row.event_type),
    severity: String(row.severity) as EaCommSeverity,
    message: String(row.message),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function summarizeEaComm(filter: { windowMinutes?: number } = {}) {
  const minutes = Math.min(24 * 60, Math.max(1, Number(filter.windowMinutes ?? 60)));
  const result = await queryPostgres(
    `
      SELECT
        channel,
        severity,
        event_type,
        count(*)::int AS count
      FROM ea_comm_events
      WHERE created_at > now() - ($1::int * interval '1 minute')
      GROUP BY channel, severity, event_type
      ORDER BY count(*) DESC
      LIMIT 200
    `,
    [minutes],
  );

  const totals = await queryPostgres(
    `
      SELECT
        count(*)::int AS total,
        sum(CASE WHEN severity = 'ERROR' THEN 1 ELSE 0 END)::int AS errors,
        sum(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END)::int AS warnings
      FROM ea_comm_events
      WHERE created_at > now() - ($1::int * interval '1 minute')
    `,
    [minutes],
  );

  return {
    windowMinutes: minutes,
    totals: totals.rows[0] ? { total: Number(totals.rows[0].total), errors: Number(totals.rows[0].errors), warnings: Number(totals.rows[0].warnings) } : { total: 0, errors: 0, warnings: 0 },
    breakdown: result.rows.map((row: any) => ({
      channel: String(row.channel),
      severity: String(row.severity),
      eventType: String(row.event_type),
      count: Number(row.count),
    })),
  };
}
