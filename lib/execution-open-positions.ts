import type { PositionManagementMetadata } from '@/lib/position-management-state';
import { queryPostgres } from '@/lib/postgres';

export type ExecutionOpenPosition = {
  id: string;
  terminalId: string;
  ticket: string;
  openCommandId: string;
  symbol: string | null;
  side: string | null;
  volumeLots: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  currentPrice: number | null;
  profitLoss: number;
  status: 'open' | 'partial' | 'closed';
  openedAt: string;
  closedAt: string | null;
  lastEvaluatedAt: string | null;
  lastAction: string | null;
  lastActionReason: string | null;
  metadata: Record<string, unknown>;
};

function mapRow(row: Record<string, unknown>): ExecutionOpenPosition {
  return {
    id: String(row.id),
    terminalId: String(row.terminal_id),
    ticket: String(row.ticket),
    openCommandId: String(row.open_command_id),
    symbol: row.symbol ? String(row.symbol) : null,
    side: row.side ? String(row.side) : null,
    volumeLots: row.volume_lots == null ? null : Number(row.volume_lots),
    entryPrice: row.entry_price == null ? null : Number(row.entry_price),
    stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
    takeProfit: row.take_profit == null ? null : Number(row.take_profit),
    currentPrice: row.current_price == null ? null : Number(row.current_price),
    profitLoss: Number(row.profit_loss ?? 0),
    status: String(row.status ?? 'open') as ExecutionOpenPosition['status'],
    openedAt: new Date(String(row.opened_at)).toISOString(),
    closedAt: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
    lastEvaluatedAt: row.last_evaluated_at ? new Date(String(row.last_evaluated_at)).toISOString() : null,
    lastAction: row.last_action ? String(row.last_action) : null,
    lastActionReason: row.last_action_reason ? String(row.last_action_reason) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function trackOpenPositionFromFill(input: {
  terminalId: string;
  commandId: string;
  ticket: string;
  symbol?: string | null;
  side?: string | null;
  volumeLots?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!input.ticket || !input.terminalId || !input.commandId) return;
  await queryPostgres(
    `
      INSERT INTO execution_open_positions (
        terminal_id,
        ticket,
        open_command_id,
        symbol,
        side,
        volume_lots,
        entry_price,
        stop_loss,
        take_profit,
        current_price,
        status,
        opened_at,
        updated_at,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,'open',now(),now(),$10::jsonb)
      ON CONFLICT (terminal_id, ticket) WHERE status IN ('open', 'partial') DO NOTHING
    `,
    [
      input.terminalId,
      input.ticket,
      input.commandId,
      input.symbol ?? null,
      input.side ?? null,
      input.volumeLots ?? null,
      input.entryPrice ?? null,
      input.stopLoss ?? null,
      input.takeProfit ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  ).catch(() => null);
}

export async function markPositionClosed(input: {
  terminalId: string;
  ticket: string;
  partial?: boolean;
}): Promise<void> {
  await queryPostgres(
    `
      UPDATE execution_open_positions
      SET status = $3,
          closed_at = CASE WHEN $3 = 'closed' THEN now() ELSE closed_at END,
          updated_at = now()
      WHERE terminal_id = $1
        AND ticket = $2
        AND status IN ('open', 'partial')
    `,
    [input.terminalId, input.ticket, input.partial ? 'partial' : 'closed'],
  ).catch(() => null);
}

export type OpenPositionFilter = {
  terminalId?: string;
  accountNumber?: string;
};

export type OpenPositionMetrics = {
  trackedOpen: number;
  terminalOpen: number;
  openOrders: number;
  positions: ExecutionOpenPosition[];
};

function appendPositionFilter(
  params: Array<string | number>,
  conditions: string[],
  filter?: OpenPositionFilter,
  alias = 'p',
) {
  if (filter?.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`${alias}.terminal_id = $${params.length}`);
  }
  if (filter?.accountNumber) {
    params.push(filter.accountNumber);
    conditions.push(`EXISTS (
      SELECT 1
      FROM mt5_terminals t
      WHERE t.terminal_id = ${alias}.terminal_id
        AND t.account_number = $${params.length}
    )`);
  }
}

async function countTrackedOpenPositions(filter?: OpenPositionFilter): Promise<number> {
  try {
    const params: Array<string | number> = [];
    const conditions = [`p.status IN ('open', 'partial')`];
    appendPositionFilter(params, conditions, filter, 'p');
    const result = await queryPostgres(
      `SELECT COUNT(*)::int AS count FROM execution_open_positions p WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return Number((result.rows[0] as { count?: number })?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function alignTrackedPositionsWithTerminal(terminalOpen: number, filter?: OpenPositionFilter): Promise<number> {
  try {
    if (terminalOpen <= 0) {
      const liveOpen = await loadBridgeTerminalOpenCount(filter?.terminalId);
      if (liveOpen != null && liveOpen > 0) {
        terminalOpen = liveOpen;
      }
    }

    const params: Array<string | number> = [];
    const conditions = [`p.status IN ('open', 'partial')`];
    appendPositionFilter(params, conditions, filter, 'p');
    if (terminalOpen <= 0) {
      const result = await queryPostgres(
        `
          UPDATE execution_open_positions
          SET status = 'closed',
              closed_at = now(),
              updated_at = now()
          WHERE id IN (
            SELECT p.id
            FROM execution_open_positions p
            WHERE ${conditions.join(' AND ')}
          )
          RETURNING id
        `,
        params,
      );
      return result.rows.length;
    }

    params.push(terminalOpen);
    const result = await queryPostgres(
      `
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY opened_at DESC, id DESC) AS row_number
          FROM execution_open_positions p
          WHERE ${conditions.join(' AND ')}
        )
        UPDATE execution_open_positions p
        SET status = 'closed',
            closed_at = now(),
            updated_at = now()
        FROM ranked r
        WHERE p.id = r.id
          AND r.row_number > $${params.length}
        RETURNING p.id
      `,
      params,
    );
    return result.rows.length;
  } catch {
    return 0;
  }
}

export async function reconcileOpenPositionsFromExecutedCommands(terminalOpen: number, filter?: OpenPositionFilter): Promise<number> {
  try {
    const trackedOpen = await countTrackedOpenPositions(filter);
    const slotsRemaining = Math.max(0, terminalOpen - trackedOpen);
    if (slotsRemaining <= 0) return 0;

    const params: Array<string | number> = [];
    const conditions = [
      `upper(replace(c.type, '-', '_')) IN ('PLACE_ORDER', 'PLACEORDER')`,
      `c.lifecycle_state IN ('EXECUTED', 'ACKNOWLEDGED')`,
      `c.ticket IS NOT NULL`,
      `btrim(c.ticket) <> ''`,
      `c.created_at >= now() - interval '7 days'`,
    ];
    if (filter?.terminalId) {
      params.push(filter.terminalId);
      conditions.push(`c.terminal_id = $${params.length}`);
    }
    if (filter?.accountNumber) {
      params.push(filter.accountNumber);
      conditions.push(`EXISTS (
        SELECT 1
        FROM mt5_terminals t
        WHERE t.terminal_id = c.terminal_id
          AND t.account_number = $${params.length}
      )`);
    }
    params.push(slotsRemaining);

    const result = await queryPostgres(
      `
        SELECT
          c.command_id,
          c.terminal_id,
          c.ticket,
          c.symbol,
          c.side,
          c.executed_volume_lots,
          c.executed_price,
          c.payload
        FROM execution_commands c
        WHERE ${conditions.join(' AND ')}
          AND NOT EXISTS (
            SELECT 1
            FROM execution_open_positions p
            WHERE p.terminal_id = c.terminal_id
              AND p.ticket = c.ticket
              AND p.status IN ('open', 'partial')
          )
        ORDER BY c.created_at DESC
        LIMIT $${params.length}
      `,
      params,
    );

    let inserted = 0;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload as Record<string, unknown>
        : {};
      await trackOpenPositionFromFill({
        terminalId: String(row.terminal_id),
        commandId: String(row.command_id),
        ticket: String(row.ticket),
        symbol: row.symbol ? String(row.symbol) : String(payload.symbol ?? ''),
        side: row.side ? String(row.side) : String(payload.side ?? ''),
        volumeLots: row.executed_volume_lots == null ? null : Number(row.executed_volume_lots),
        entryPrice: row.executed_price == null ? null : Number(row.executed_price),
        stopLoss: Number(payload.sl ?? payload.stopLoss ?? 0) || null,
        takeProfit: Number(payload.tp ?? payload.takeProfit ?? 0) || null,
        metadata: {
          setupGroupId: payload.setupGroupId ?? payload.decisionLogId ?? null,
          legIndex: payload.legIndex ?? null,
          legCount: payload.legCount ?? null,
          batchEntry: payload.batchEntry ?? false,
        },
      });
      inserted += 1;
    }
    return inserted;
  } catch {
    return 0;
  }
}

type LiveBridgeTerminal = {
  terminalId?: string;
  connectionStatus?: string;
  enableExecution?: boolean;
  openPositions?: number;
  openOrders?: number;
  openPositionSnapshots?: unknown;
  balance?: number;
  equity?: number;
  margin?: number;
};

function resolveLiveBridgeTerminal(
  terminals: LiveBridgeTerminal[],
  terminalId?: string | null,
): LiveBridgeTerminal | null {
  const connected = terminals.filter(
    (terminal) => String(terminal?.connectionStatus ?? '').toLowerCase() === 'connected',
  );
  return terminalId
    ? connected.find((terminal) => String(terminal.terminalId) === terminalId) ?? null
    : connected.find((terminal) => terminal.enableExecution) ?? connected[0] ?? null;
}

function countLiveBridgeOpenPositions(terminal: LiveBridgeTerminal | null): number | null {
  if (!terminal) return null;
  const snapshots = Array.isArray(terminal.openPositionSnapshots) ? terminal.openPositionSnapshots.length : 0;
  const reported = Number(terminal.openPositions ?? terminal.openOrders ?? NaN);
  const resolved = Math.max(
    Number.isFinite(reported) ? reported : 0,
    snapshots,
  );
  return Number.isFinite(resolved) ? Math.max(0, resolved) : null;
}

async function fetchLiveBridgeTerminals(): Promise<LiveBridgeTerminal[]> {
  try {
    const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
    const response = await fetch(`${bridgeUrl}/terminal-operations`, { cache: 'no-store' });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.terminals) ? payload.terminals as LiveBridgeTerminal[] : [];
  } catch {
    return [];
  }
}

async function loadBridgeTerminalOpenCount(terminalId?: string | null): Promise<number | null> {
  const terminals = await fetchLiveBridgeTerminals();
  return countLiveBridgeOpenPositions(resolveLiveBridgeTerminal(terminals, terminalId));
}

async function getTerminalOpenOrderCount(filter?: OpenPositionFilter): Promise<number> {
  try {
    const liveOpen = await loadBridgeTerminalOpenCount(filter?.terminalId);
    if (liveOpen != null) return liveOpen;

    const params: string[] = [];
    const conditions = [`t.connection_status IN ('connected', 'degraded')`];
    if (filter?.terminalId) {
      params.push(filter.terminalId);
      conditions.push(`t.terminal_id = $${params.length}`);
    }
    if (filter?.accountNumber) {
      params.push(filter.accountNumber);
      conditions.push(`t.account_number = $${params.length}`);
    }
    const result = await queryPostgres(
      `
        SELECT
          GREATEST(t.open_orders, 0)::int AS open_orders,
          COALESCE(a.margin, 0)::numeric AS margin
        FROM mt5_terminals t
        JOIN trading_accounts a ON a.account_number = t.account_number
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.last_heartbeat_at DESC NULLS LAST
        LIMIT 1
      `,
      params,
    );
    const row = result.rows[0] as { open_orders?: number; margin?: number } | undefined;
    if (!row) return 0;
    const openOrders = Number(row.open_orders ?? 0);
    if (openOrders > 0) return openOrders;
    const margin = Number(row.margin ?? 0);
    return margin > 0 ? Math.max(1, Math.round(margin / 2.8)) : 0;
  } catch {
    return 0;
  }
}

/** Reconcile Postgres position registry with the live terminal before gating or monitoring. */
export async function syncOpenPositionRegistry(filter?: OpenPositionFilter): Promise<OpenPositionMetrics> {
  return getOpenPositionMetrics(filter);
}

async function isAccountFlat(filter?: OpenPositionFilter): Promise<boolean> {
  const terminals = await fetchLiveBridgeTerminals();
  const liveTerminal = resolveLiveBridgeTerminal(terminals, filter?.terminalId);
  const liveOpen = countLiveBridgeOpenPositions(liveTerminal);
  if (liveOpen != null && liveOpen > 0) return false;

  if (liveTerminal) {
    const balance = Number(liveTerminal.balance ?? 0);
    const equity = Number(liveTerminal.equity ?? 0);
    const margin = Number(liveTerminal.margin ?? 0);
    if (margin > 0.01 || Math.abs(equity - balance) > 0.5) return false;
    if (margin <= 0 && Math.abs(equity - balance) < 0.05) return true;
  }

  if (!filter?.accountNumber) return false;
  try {
    const result = await queryPostgres(
      `SELECT balance, equity, margin FROM trading_accounts WHERE account_number = $1 LIMIT 1`,
      [filter.accountNumber],
    );
    const row = result.rows[0] as { balance?: number; equity?: number; margin?: number } | undefined;
    if (!row) return false;
    const balance = Number(row.balance ?? 0);
    const equity = Number(row.equity ?? 0);
    const margin = Number(row.margin ?? 0);
    return margin <= 0 && Math.abs(equity - balance) < 0.05;
  } catch {
    return false;
  }
}

export async function getOpenPositionMetrics(filter?: OpenPositionFilter): Promise<OpenPositionMetrics> {
  const { syncOpenPositionLiveMetrics } = await import('./position-profit-sync');
  await syncOpenPositionLiveMetrics().catch(() => null);

  let terminalOpen = await getTerminalOpenOrderCount(filter);
  if (await isAccountFlat(filter)) {
    terminalOpen = 0;
  }
  await alignTrackedPositionsWithTerminal(terminalOpen, filter);
  await reconcileOpenPositionsFromExecutedCommands(terminalOpen, filter);
  const positions = await listOpenPositions({ ...filter, limit: 100 });
  const trackedOpen = positions.length;
  return {
    trackedOpen,
    terminalOpen,
    openOrders: terminalOpen > 0 ? terminalOpen : trackedOpen,
    positions,
  };
}

export async function listOpenPositions(filter?: OpenPositionFilter & { limit?: number }): Promise<ExecutionOpenPosition[]> {
  const params: Array<string | number> = [];
  const conditions = [`p.status IN ('open', 'partial')`];
  appendPositionFilter(params, conditions, filter, 'p');
  params.push(Math.min(200, Math.max(1, Number(filter?.limit ?? 100))));
  try {
    const result = await queryPostgres(
      `
        SELECT p.*
        FROM execution_open_positions p
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.opened_at DESC
        LIMIT $${params.length}
      `,
      params,
    );
    return result.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function getOpenPositionExposureForSymbol(
  symbol: string,
  filter?: OpenPositionFilter,
): Promise<{ count: number; volumeLots: number }> {
  const normalized = symbol.toUpperCase().trim();
  if (!normalized) return { count: 0, volumeLots: 0 };
  const metrics = await getOpenPositionMetrics(filter);
  const matching = metrics.positions.filter((position) => position.symbol?.toUpperCase() === normalized);
  return {
    count: matching.length,
    volumeLots: Number(matching.reduce((sum, position) => sum + Number(position.volumeLots ?? 0), 0).toFixed(4)),
  };
}

export async function countUnprotectedOpenPositions(filter?: OpenPositionFilter): Promise<number> {
  const params: Array<string | number> = [];
  const conditions = [
    `p.status IN ('open', 'partial')`,
    `(p.stop_loss IS NULL OR p.stop_loss <= 0 OR p.take_profit IS NULL OR p.take_profit <= 0)`,
  ];
  appendPositionFilter(params, conditions, filter, 'p');
  try {
    const result = await queryPostgres(
      `
        SELECT COUNT(*)::int AS count
        FROM execution_open_positions p
        WHERE ${conditions.join(' AND ')}
      `,
      params,
    );
    return Number((result.rows[0] as { count?: number })?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function updatePositionEvaluation(input: {
  id: string;
  currentPrice?: number | null;
  profitLoss?: number;
  lastAction: string;
  lastActionReason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await queryPostgres(
    `
      UPDATE execution_open_positions
      SET current_price = COALESCE($2, current_price),
          profit_loss = COALESCE($3, profit_loss),
          last_evaluated_at = now(),
          last_action = $4,
          last_action_reason = $5,
          metadata = CASE WHEN $6::jsonb IS NULL THEN metadata ELSE metadata || $6::jsonb END,
          updated_at = now()
      WHERE id = $1
    `,
    [
      input.id,
      input.currentPrice ?? null,
      input.profitLoss ?? null,
      input.lastAction,
      input.lastActionReason,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  ).catch(() => null);
}

export async function updatePositionLiveMetrics(input: {
  id: string;
  currentPrice: number;
  profitLoss: number;
  stopLoss?: number | null;
  metadata: PositionManagementMetadata | Record<string, unknown>;
}): Promise<void> {
  await queryPostgres(
    `
      UPDATE execution_open_positions
      SET current_price = $2,
          profit_loss = $3,
          stop_loss = COALESCE($4, stop_loss),
          metadata = metadata || $5::jsonb,
          updated_at = now()
      WHERE id = $1
    `,
    [
      input.id,
      input.currentPrice,
      input.profitLoss,
      input.stopLoss ?? null,
      JSON.stringify(input.metadata),
    ],
  ).catch(() => null);
}
