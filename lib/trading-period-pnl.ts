import { queryPostgres } from '@/lib/postgres';

export const TRADING_PNL_TIMEZONE = 'Africa/Lagos';

export type TradingPeriodPnl = {
  todayUsd: number;
  weekUsd: number;
  monthUsd: number;
  timezone: string;
};

async function resolvePrimaryAccountNumber(accountNumber?: string | null): Promise<string | null> {
  const explicit = String(accountNumber ?? '').trim();
  if (explicit) return explicit;

  const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
  try {
    const response = await fetch(`${bridgeUrl}/terminals`, { cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    const connected = terminals.filter(
      (terminal: { connectionStatus?: string; status?: string }) =>
        String(terminal?.connectionStatus ?? terminal?.status ?? '').toLowerCase() === 'connected',
    );
    const primary = connected.find((item: { enableExecution?: boolean }) => item.enableExecution) ?? connected[0];
    const fromBridge = String(primary?.accountNumber ?? '').trim();
    if (fromBridge) return fromBridge;
  } catch {
    // fall through
  }

  const fallback = await queryPostgres(
    `SELECT account_number FROM trading_accounts ORDER BY updated_at DESC LIMIT 1`,
  );
  return String(fallback.rows[0]?.account_number ?? '').trim() || null;
}

async function loadAccountEquityState(accountNumber: string): Promise<{
  equity: number;
  startingEquityToday: number;
}> {
  const result = await queryPostgres(
    `
      SELECT equity, starting_equity_today
      FROM trading_accounts
      WHERE account_number = $1
      LIMIT 1
    `,
    [accountNumber],
  );
  const row = result.rows[0] as { equity?: string | number; starting_equity_today?: string | number } | undefined;
  const equity = Number(row?.equity ?? 0);
  const startingEquityToday = Number(row?.starting_equity_today ?? equity);
  return {
    equity,
    startingEquityToday: startingEquityToday > 0 ? startingEquityToday : equity,
  };
}

async function sumRealizedClosedPnl(input: {
  accountNumber: string;
  periodStartSql: string;
  beforeDayStart?: boolean;
}): Promise<number> {
  const dayStartSql = `(date_trunc('day', (now() AT TIME ZONE '${TRADING_PNL_TIMEZONE}')::date))::timestamp AT TIME ZONE '${TRADING_PNL_TIMEZONE}'`;
  const beforeClause = input.beforeDayStart
    ? `AND p.closed_at < ${dayStartSql}`
    : '';

  const result = await queryPostgres(
    `
      SELECT COALESCE(SUM(sub.profit_loss), 0)::float AS total
      FROM (
        SELECT DISTINCT ON (p.ticket)
          p.profit_loss
        FROM execution_open_positions p
        JOIN mt5_terminals t ON t.terminal_id = p.terminal_id
        WHERE t.account_number = $1
          AND p.status = 'closed'
          AND p.closed_at IS NOT NULL
          AND p.closed_at >= (${input.periodStartSql})
          ${beforeClause}
        ORDER BY p.ticket, p.closed_at DESC, p.id DESC
      ) sub
    `,
    [input.accountNumber],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function getTradingPeriodPnl(input: {
  accountNumber?: string | null;
  liveEquity?: number | null;
} = {}): Promise<TradingPeriodPnl> {
  const accountNumber = await resolvePrimaryAccountNumber(input.accountNumber);
  if (!accountNumber) {
    return { todayUsd: 0, weekUsd: 0, monthUsd: 0, timezone: TRADING_PNL_TIMEZONE };
  }

  const account = await loadAccountEquityState(accountNumber);
  const currentEquity = Number.isFinite(input.liveEquity) && Number(input.liveEquity) > 0
    ? Number(input.liveEquity)
    : account.equity;
  const todayUsd = Number((currentEquity - account.startingEquityToday).toFixed(2));

  // Week/month: deduped realized closes before today (registry can contain duplicate close rows)
  // plus today's equity delta so open floating is included.
  const weekStartSql = `(date_trunc('week', (now() AT TIME ZONE '${TRADING_PNL_TIMEZONE}')::date))::timestamp AT TIME ZONE '${TRADING_PNL_TIMEZONE}'`;
  const monthStartSql = `(date_trunc('month', (now() AT TIME ZONE '${TRADING_PNL_TIMEZONE}')::date))::timestamp AT TIME ZONE '${TRADING_PNL_TIMEZONE}'`;

  const [closedWeekBeforeToday, closedMonthBeforeToday] = await Promise.all([
    sumRealizedClosedPnl({ accountNumber, periodStartSql: weekStartSql, beforeDayStart: true }),
    sumRealizedClosedPnl({ accountNumber, periodStartSql: monthStartSql, beforeDayStart: true }),
  ]);

  return {
    todayUsd,
    weekUsd: Number((closedWeekBeforeToday + todayUsd).toFixed(2)),
    monthUsd: Number((closedMonthBeforeToday + todayUsd).toFixed(2)),
    timezone: TRADING_PNL_TIMEZONE,
  };
}
