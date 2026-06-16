import { GOLD_SYMBOL, goldSerialTradingEnabled, isGoldOnlyTradingEngine } from '@/lib/gold-trading-engine';
import { listOpenPositions } from '@/lib/execution-open-positions';
import { queryPostgres } from '@/lib/postgres';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Max minutes an unfilled Gold conditional entry may wait in serial mode (default 30). */
export function goldSerialConditionalMaxMinutes(): number {
  return Math.max(
    10,
    Math.round(
      envNumber(
        'CACSMS_GOLD_CONDITIONAL_ENTRY_MAX_MINUTES',
        envNumber('CACSMS_GOLD_REENTRY_COOLDOWN_MINUTES', 30),
      ),
    ),
  );
}

const PENDING_OPENING_STATES = `('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')`;
const PLACE_ORDER_TYPES = `('PLACE_ORDER', 'PLACEORDER')`;

/**
 * Serial Gold mode: unfilled conditional limits are not real trades but block new entries.
 * Keep at most one pending conditional; cancel stale unfilled orders when flat.
 */
export async function cleanupGoldSerialPendingOrders(): Promise<number> {
  if (!isGoldOnlyTradingEngine() || !goldSerialTradingEnabled()) return 0;

  const openPositions = await listOpenPositions({ limit: 20 }).catch(() => []);
  const hasOpenPositions = openPositions.length > 0;
  const staleMinutes = goldSerialConditionalMaxMinutes();
  let cancelled = 0;

  const superseded = await queryPostgres(
    `
      UPDATE execution_commands c
      SET lifecycle_state = 'CANCELLED',
          last_error = COALESCE(c.last_error, 'superseded_gold_serial_conditional'),
          broker_message = 'superseded_gold_serial_conditional',
          last_updated_at = now()
      FROM (
        SELECT command_id,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM execution_commands
        WHERE upper(symbol) = $1
          AND upper(replace(type, '-', '_')) IN ${PLACE_ORDER_TYPES}
          AND lifecycle_state IN ${PENDING_OPENING_STATES}
      ) ranked
      WHERE c.command_id = ranked.command_id
        AND ranked.rn > 1
      RETURNING c.command_id
    `,
    [GOLD_SYMBOL],
  ).catch(() => ({ rows: [] }));
  cancelled += superseded.rows.length;

  if (!hasOpenPositions) {
    const stale = await queryPostgres(
      `
        UPDATE execution_commands
        SET lifecycle_state = 'CANCELLED',
            last_error = COALESCE(last_error, 'stale_gold_serial_conditional'),
            broker_message = 'stale_gold_serial_conditional',
            last_updated_at = now()
        WHERE upper(symbol) = $1
          AND upper(replace(type, '-', '_')) IN ${PLACE_ORDER_TYPES}
          AND lifecycle_state IN ${PENDING_OPENING_STATES}
          AND COALESCE(broker_message, '') = 'conditional_entry_waiting_for_retracement_confirmation'
          AND created_at < now() - ($2 || ' minutes')::interval
        RETURNING command_id
      `,
      [GOLD_SYMBOL, String(staleMinutes)],
    ).catch(() => ({ rows: [] }));
    cancelled += stale.rows.length;
  }

  return cancelled;
}
