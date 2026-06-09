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
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$7,'open',now(),now())
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

export async function listOpenPositions(filter?: { terminalId?: string; limit?: number }): Promise<ExecutionOpenPosition[]> {
  const params: Array<string | number> = [];
  const conditions = [`status IN ('open', 'partial')`];
  if (filter?.terminalId) {
    params.push(filter.terminalId);
    conditions.push(`terminal_id = $${params.length}`);
  }
  params.push(Math.min(200, Math.max(1, Number(filter?.limit ?? 100))));
  try {
    const result = await queryPostgres(
      `
        SELECT *
        FROM execution_open_positions
        WHERE ${conditions.join(' AND ')}
        ORDER BY opened_at DESC
        LIMIT $${params.length}
      `,
      params,
    );
    return result.rows.map((row) => mapRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function updatePositionEvaluation(input: {
  id: string;
  currentPrice?: number | null;
  profitLoss?: number;
  lastAction: string;
  lastActionReason: string;
}): Promise<void> {
  await queryPostgres(
    `
      UPDATE execution_open_positions
      SET current_price = COALESCE($2, current_price),
          profit_loss = COALESCE($3, profit_loss),
          last_evaluated_at = now(),
          last_action = $4,
          last_action_reason = $5,
          updated_at = now()
      WHERE id = $1
    `,
    [input.id, input.currentPrice ?? null, input.profitLoss ?? null, input.lastAction, input.lastActionReason],
  ).catch(() => null);
}
