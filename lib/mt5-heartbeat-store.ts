import { queryPostgres } from '@/lib/postgres';

type HeartbeatPayload = Record<string, unknown>;

type TerminalRow = {
  terminal_id: string;
  account_number: string;
  broker_name: string;
  server_name: string;
  mode: string;
  currency: string;
  balance: string | number;
  equity: string | number;
  margin: string | number;
  free_margin: string | number;
  open_trade_count: number;
  connection_status: string;
  last_tick_time: Date | string;
  terminal_time: Date | string;
  mt5_server_time: Date | string;
  nigeria_time: Date | string;
  latency_ms: number;
  open_orders: number;
  version: string;
  last_heartbeat_at: Date | string;
  sequence?: string | number;
  first_seen_at?: Date | string;
  average_latency_ms?: string | number | null;
  missed_sequence_count?: string | number | null;
};

type HeartbeatRow = {
  sequence: string | number;
  received_at: Date | string;
  sent_at: Date | string | null;
  latency_ms: number;
  balance: string | number;
  equity: string | number;
  open_orders: number;
  connection_status: string;
  mt5_server_time: Date | string;
  terminal_time: Date | string;
  nigeria_time: Date | string;
  last_tick_time: Date | string;
};

function text(value: unknown, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback = 0): number {
  return Math.round(numeric(value, fallback));
}

function isoDate(value: unknown, fallback = new Date()): string {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback.toISOString();
}

function accountMode(value: unknown): 'demo' | 'live' | 'prop_firm' {
  const normalized = text(value).toLowerCase().replaceAll('-', '_');
  if (normalized === 'live') return 'live';
  if (normalized === 'prop_firm' || normalized === 'propfirm') return 'prop_firm';
  return 'demo';
}

function connectionStatus(value: unknown): 'connected' | 'degraded' | 'disconnected' {
  const normalized = text(value).toLowerCase();
  if (normalized === 'degraded' || normalized === 'disconnected') return normalized;
  return 'connected';
}

function heartbeatStatus(row: Pick<TerminalRow, 'connection_status' | 'last_heartbeat_at'>) {
  const ageMs = Math.max(0, Date.now() - Date.parse(String(row.last_heartbeat_at)));
  if (ageMs > 30_000 || row.connection_status === 'disconnected') return 'disconnected';
  if (ageMs > 15_000 || row.connection_status === 'degraded') return 'degraded';
  return 'connected';
}

export async function recordTerminalHeartbeat(payload: HeartbeatPayload) {
  const now = new Date();
  const terminalId = text(payload.terminalId);
  const accountNumber = text(payload.accountNumber);
  const brokerName = text(payload.brokerName, 'Unknown broker');
  const serverName = text(payload.serverName, 'Unassigned server');
  const status = connectionStatus(payload.connectionStatus ?? payload.status);
  const receivedAt = now.toISOString();
  const lastTickTime = isoDate(payload.lastTickTime ?? payload.mt5ServerTime, now);
  const terminalTime = isoDate(payload.terminalTime, now);
  const mt5ServerTime = isoDate(payload.mt5ServerTime, now);
  const nigeriaTime = isoDate(payload.nigeriaTime, now);
  const balance = numeric(payload.balance);
  const equity = numeric(payload.equity, balance);
  const margin = numeric(payload.margin);
  const freeMargin = numeric(payload.freeMargin);
  const openOrders = integer(payload.openOrders);
  const sequence = integer(payload.sequence);
  const latencyMs = Math.max(0, integer(payload.latencyMs ?? resolveLatencyMs(payload.sentAt, receivedAt)));
  const version = text(payload.version, 'unknown');

  if (!terminalId) throw new Error('terminalId is required.');
  if (!accountNumber) throw new Error('accountNumber is required.');

  await queryPostgres(
    `
      INSERT INTO trading_accounts (
        account_number,
        broker_name,
        server_name,
        mode,
        currency,
        balance,
        equity,
        margin,
        free_margin,
        peak_equity_today,
        starting_equity_today,
        peak_equity_all_time,
        open_trade_count,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $7, $7, $10, now())
      ON CONFLICT (account_number) DO UPDATE SET
        broker_name = EXCLUDED.broker_name,
        server_name = EXCLUDED.server_name,
        mode = EXCLUDED.mode,
        currency = EXCLUDED.currency,
        balance = EXCLUDED.balance,
        equity = EXCLUDED.equity,
        margin = EXCLUDED.margin,
        free_margin = EXCLUDED.free_margin,
        peak_equity_today = GREATEST(trading_accounts.peak_equity_today, EXCLUDED.equity),
        peak_equity_all_time = GREATEST(trading_accounts.peak_equity_all_time, EXCLUDED.equity),
        open_trade_count = EXCLUDED.open_trade_count,
        updated_at = now()
    `,
    [
      accountNumber,
      brokerName,
      serverName,
      accountMode(payload.accountType ?? payload.mode ?? payload.environment),
      text(payload.currency, 'USD'),
      balance,
      equity,
      margin,
      freeMargin,
      openOrders,
    ],
  );

  await queryPostgres(
    `
      INSERT INTO mt5_terminals (
        terminal_id,
        account_number,
        connection_status,
        last_tick_time,
        terminal_time,
        mt5_server_time,
        nigeria_time,
        latency_ms,
        open_orders,
        version,
        last_heartbeat_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (terminal_id) DO UPDATE SET
        account_number = EXCLUDED.account_number,
        connection_status = EXCLUDED.connection_status,
        last_tick_time = EXCLUDED.last_tick_time,
        terminal_time = EXCLUDED.terminal_time,
        mt5_server_time = EXCLUDED.mt5_server_time,
        nigeria_time = EXCLUDED.nigeria_time,
        latency_ms = EXCLUDED.latency_ms,
        open_orders = EXCLUDED.open_orders,
        version = EXCLUDED.version,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at
    `,
    [
      terminalId,
      accountNumber,
      status,
      lastTickTime,
      terminalTime,
      mt5ServerTime,
      nigeriaTime,
      latencyMs,
      openOrders,
      version,
      receivedAt,
    ],
  );

  await queryPostgres(
    `
      INSERT INTO mt5_heartbeats (
        terminal_id,
        account_number,
        sequence,
        connection_status,
        sent_at,
        received_at,
        last_tick_time,
        terminal_time,
        mt5_server_time,
        nigeria_time,
        latency_ms,
        open_orders,
        balance,
        equity,
        margin,
        free_margin,
        version,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `,
    [
      terminalId,
      accountNumber,
      sequence,
      status,
      payload.sentAt ? isoDate(payload.sentAt, now) : null,
      receivedAt,
      lastTickTime,
      terminalTime,
      mt5ServerTime,
      nigeriaTime,
      latencyMs,
      openOrders,
      balance,
      equity,
      margin,
      freeMargin,
      version,
      payload,
    ],
  );

  const terminal = await getTerminalSnapshot(terminalId);
  return terminal;
}

export async function listTerminalSnapshots() {
  const result = await queryPostgres(`
    SELECT
      t.*,
      a.broker_name,
      a.server_name,
      a.mode,
      a.currency,
      a.balance,
      a.equity,
      a.margin,
      a.free_margin,
      a.open_trade_count,
      hb.sequence,
      first_hb.first_seen_at,
      stats.average_latency_ms,
      stats.missed_sequence_count
    FROM mt5_terminals t
    JOIN trading_accounts a ON a.account_number = t.account_number
    LEFT JOIN LATERAL (
      SELECT sequence
      FROM mt5_heartbeats
      WHERE terminal_id = t.terminal_id
      ORDER BY received_at DESC
      LIMIT 1
    ) hb ON true
    LEFT JOIN LATERAL (
      SELECT min(received_at) AS first_seen_at
      FROM mt5_heartbeats
      WHERE terminal_id = t.terminal_id
    ) first_hb ON true
    LEFT JOIN LATERAL (
      SELECT
        avg(latency_ms) AS average_latency_ms,
        greatest(0, max(sequence) - min(sequence) + 1 - count(*)) AS missed_sequence_count
      FROM mt5_heartbeats
      WHERE terminal_id = t.terminal_id
        AND received_at > now() - interval '1 hour'
    ) stats ON true
    ORDER BY t.last_heartbeat_at DESC
  `);

  return result.rows.map((row) => mapTerminal(row as TerminalRow));
}

export async function getTerminalSnapshot(terminalId: string) {
  const result = await queryPostgres(
    `
      SELECT
        t.*,
        a.broker_name,
        a.server_name,
        a.mode,
        a.currency,
        a.balance,
        a.equity,
        a.margin,
        a.free_margin,
        a.open_trade_count,
        hb.sequence,
        first_hb.first_seen_at,
        stats.average_latency_ms,
        stats.missed_sequence_count
      FROM mt5_terminals t
      JOIN trading_accounts a ON a.account_number = t.account_number
      LEFT JOIN LATERAL (
        SELECT sequence
        FROM mt5_heartbeats
        WHERE terminal_id = t.terminal_id
        ORDER BY received_at DESC
        LIMIT 1
      ) hb ON true
      LEFT JOIN LATERAL (
        SELECT min(received_at) AS first_seen_at
        FROM mt5_heartbeats
        WHERE terminal_id = t.terminal_id
      ) first_hb ON true
      LEFT JOIN LATERAL (
        SELECT
          avg(latency_ms) AS average_latency_ms,
          greatest(0, max(sequence) - min(sequence) + 1 - count(*)) AS missed_sequence_count
        FROM mt5_heartbeats
        WHERE terminal_id = t.terminal_id
          AND received_at > now() - interval '1 hour'
      ) stats ON true
      WHERE t.terminal_id = $1
    `,
    [terminalId],
  );

  if (!result.rows[0]) return null;
  return mapTerminal(result.rows[0] as TerminalRow);
}

export async function getTerminalHeartbeatHistory(terminalId: string, limit = 100) {
  const result = await queryPostgres(
    `
      SELECT
        sequence,
        received_at,
        sent_at,
        latency_ms,
        balance,
        equity,
        open_orders,
        connection_status,
        mt5_server_time,
        terminal_time,
        nigeria_time,
        last_tick_time
      FROM mt5_heartbeats
      WHERE terminal_id = $1
      ORDER BY received_at DESC
      LIMIT $2
    `,
    [terminalId, limit],
  );

  return result.rows.map((row) => mapHistory(row as HeartbeatRow)).reverse();
}

function mapTerminal(row: TerminalRow) {
  const receivedAt = new Date(row.last_heartbeat_at).toISOString();
  const heartbeatAgeMs = Math.max(0, Date.now() - Date.parse(receivedAt));
  const latencyMs = Number(row.latency_ms ?? 0);
  const averageLatencyMs = Math.round(Number(row.average_latency_ms ?? latencyMs));

  return {
    terminalId: row.terminal_id,
    computerName: row.terminal_id,
    computerId: row.terminal_id,
    accountNumber: row.account_number,
    brokerName: row.broker_name,
    serverName: row.server_name,
    accountType: row.mode,
    currency: row.currency,
    balance: Number(row.balance ?? 0),
    equity: Number(row.equity ?? 0),
    margin: Number(row.margin ?? 0),
    freeMargin: Number(row.free_margin ?? 0),
    openOrders: Number(row.open_orders ?? row.open_trade_count ?? 0),
    status: heartbeatStatus(row),
    connectionStatus: row.connection_status,
    heartbeatAgeMs,
    latencyMs,
    averageLatencyMs,
    jitterMs: Math.max(0, Math.abs(latencyMs - averageLatencyMs)),
    ewmaLatencyMs: averageLatencyMs,
    stabilityScore: Math.max(0, 100 - Math.min(50, Math.round(heartbeatAgeMs / 1000) * 3) - Math.min(30, Math.round(latencyMs / 150))),
    missedSequenceCount: Number(row.missed_sequence_count ?? 0),
    sequence: Number(row.sequence ?? 0),
    heartbeatIntervalSeconds: 5,
    receivedAt,
    firstSeenAt: row.first_seen_at ? new Date(row.first_seen_at).toISOString() : receivedAt,
    lastTickTime: new Date(row.last_tick_time).toISOString(),
    mt5ServerTime: new Date(row.mt5_server_time).toISOString(),
    terminalTime: new Date(row.terminal_time).toISOString(),
    nigeriaTime: new Date(row.nigeria_time).toISOString(),
    version: row.version,
  };
}

function mapHistory(row: HeartbeatRow) {
  return {
    sequence: Number(row.sequence ?? 0),
    receivedAt: new Date(row.received_at).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : '',
    latencyMs: Number(row.latency_ms ?? 0),
    balance: Number(row.balance ?? 0),
    equity: Number(row.equity ?? 0),
    openOrders: Number(row.open_orders ?? 0),
    connectionStatus: row.connection_status,
    mt5ServerTime: new Date(row.mt5_server_time).toISOString(),
    terminalTime: new Date(row.terminal_time).toISOString(),
    nigeriaTime: new Date(row.nigeria_time).toISOString(),
    lastTickTime: new Date(row.last_tick_time).toISOString(),
  };
}

function resolveLatencyMs(sentAt: unknown, receivedAt: string) {
  const sentAtMs = Date.parse(String(sentAt ?? ''));
  const receivedAtMs = Date.parse(receivedAt);
  return Number.isFinite(sentAtMs) && Number.isFinite(receivedAtMs)
    ? Math.max(0, receivedAtMs - sentAtMs)
    : 0;
}
