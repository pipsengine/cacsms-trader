import {
  GOLD_SYMBOL,
  goldMaxConcurrentPositions,
  goldSerialTradingEnabled,
  isGoldOnlyTradingEngine,
  isGoldSymbol,
} from '@/lib/gold-trading-engine';
import { listOpenPositions } from '@/lib/execution-open-positions';
import { queryPostgres } from '@/lib/postgres';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Max minutes an unfilled Gold conditional entry may wait before auto-cancel (default 30). */
export function goldConditionalEntryMaxMinutes(): number {
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

/** @deprecated Use goldConditionalEntryMaxMinutes */
export function goldSerialConditionalMaxMinutes(): number {
  return goldConditionalEntryMaxMinutes();
}

const PENDING_OPENING_STATES = `('QUEUED', 'ROUTING', 'SENT', 'ACKNOWLEDGED')`;
const PLACE_ORDER_TYPES = `('PLACE_ORDER', 'PLACEORDER')`;
const VIRTUAL_CONDITIONAL = 'conditional_entry_waiting_for_retracement_confirmation';

/**
 * Virtual retracement limits are not broker positions but were blocking the risk gate.
 * Cancel duplicates/stale conditionals and keep only what scaling rules allow.
 */
export async function cleanupGoldPendingOrders(): Promise<number> {
  if (!isGoldOnlyTradingEngine()) return 0;

  const openPositions = await listOpenPositions({ limit: 50 }).catch(() => []);
  const goldOpenCount = openPositions.filter((p) => isGoldSymbol(String(p.symbol ?? ''))).length;
  const serialMode = goldSerialTradingEnabled();
  const maxConcurrent = goldMaxConcurrentPositions();
  const maxPendingConditionals = serialMode
    ? 1
    : Math.max(1, maxConcurrent - goldOpenCount);
  const staleMinutes = goldConditionalEntryMaxMinutes();
  let cancelled = 0;

  const stale = await queryPostgres(
    `
      UPDATE execution_commands
      SET lifecycle_state = 'CANCELLED',
          last_error = COALESCE(last_error, 'stale_gold_conditional'),
          broker_message = 'stale_gold_conditional',
          last_updated_at = now()
      WHERE upper(symbol) = $1
        AND upper(replace(type, '-', '_')) IN ${PLACE_ORDER_TYPES}
        AND lifecycle_state IN ${PENDING_OPENING_STATES}
        AND COALESCE(broker_message, '') = $2
        AND created_at < now() - ($3 || ' minutes')::interval
      RETURNING command_id
    `,
    [GOLD_SYMBOL, VIRTUAL_CONDITIONAL, String(staleMinutes)],
  ).catch(() => ({ rows: [] }));
  cancelled += stale.rows.length;

  const superseded = await queryPostgres(
    `
      UPDATE execution_commands c
      SET lifecycle_state = 'CANCELLED',
          last_error = COALESCE(c.last_error, 'superseded_gold_conditional'),
          broker_message = 'superseded_gold_conditional',
          last_updated_at = now()
      FROM (
        SELECT command_id,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM execution_commands
        WHERE upper(symbol) = $1
          AND upper(replace(type, '-', '_')) IN ${PLACE_ORDER_TYPES}
          AND lifecycle_state IN ${PENDING_OPENING_STATES}
          AND COALESCE(broker_message, '') = $2
      ) ranked
      WHERE c.command_id = ranked.command_id
        AND ranked.rn > $3
      RETURNING c.command_id
    `,
    [GOLD_SYMBOL, VIRTUAL_CONDITIONAL, maxPendingConditionals],
  ).catch(() => ({ rows: [] }));
  cancelled += superseded.rows.length;

  if (goldOpenCount === 0) {
    const flatSuperseded = await queryPostgres(
      `
        UPDATE execution_commands c
        SET lifecycle_state = 'CANCELLED',
            last_error = COALESCE(c.last_error, 'flat_gold_conditional_superseded'),
            broker_message = 'flat_gold_conditional_superseded',
            last_updated_at = now()
        FROM (
          SELECT command_id,
                 ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
          FROM execution_commands
          WHERE upper(symbol) = $1
            AND upper(replace(type, '-', '_')) IN ${PLACE_ORDER_TYPES}
            AND lifecycle_state IN ${PENDING_OPENING_STATES}
            AND COALESCE(broker_message, '') = $2
        ) ranked
        WHERE c.command_id = ranked.command_id
          AND ranked.rn > 1
        RETURNING c.command_id
      `,
      [GOLD_SYMBOL, VIRTUAL_CONDITIONAL],
    ).catch(() => ({ rows: [] }));
    cancelled += flatSuperseded.rows.length;
  }

  return cancelled;
}

/** @deprecated Use cleanupGoldPendingOrders */
export async function cleanupGoldSerialPendingOrders(): Promise<number> {
  return cleanupGoldPendingOrders();
}
