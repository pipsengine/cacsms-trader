import { appendExecutionEvent } from '@/lib/execution-bridge-store';

export type BasketProfitLockLogEvent =
  | 'max_floating_profit'
  | 'lock_activated'
  | 'lock_raised'
  | 'reversal_detected'
  | 'basket_closed';

export type BasketProfitLockLogInput = {
  event: BasketProfitLockLogEvent;
  basketId: string;
  terminalId: string;
  symbol: string;
  legCount: number;
  floatingProfitUsd: number;
  peakProfitUsd: number;
  lockedProfitUsd: number;
  previousLockedUsd?: number;
  tierLabel?: string | null;
  message: string;
};

function eventSeverity(event: BasketProfitLockLogEvent): 'INFO' | 'WARNING' | 'SUCCESS' {
  if (event === 'reversal_detected') return 'WARNING';
  if (event === 'basket_closed') return 'SUCCESS';
  return 'INFO';
}

export async function logBasketProfitLockEvent(input: BasketProfitLockLogInput): Promise<void> {
  const payload = {
    basketId: input.basketId,
    symbol: input.symbol,
    legCount: input.legCount,
    floatingProfitUsd: Number(input.floatingProfitUsd.toFixed(2)),
    peakProfitUsd: Number(input.peakProfitUsd.toFixed(2)),
    lockedProfitUsd: Number(input.lockedProfitUsd.toFixed(2)),
    previousLockedUsd: input.previousLockedUsd == null
      ? null
      : Number(input.previousLockedUsd.toFixed(2)),
    tierLabel: input.tierLabel ?? null,
    event: input.event,
  };

  console.info(
    `[BASKET_PROFIT_LOCK] ${input.event} basket=${input.basketId} `
    + `float=$${payload.floatingProfitUsd} peak=$${payload.peakProfitUsd} `
    + `lock=$${payload.lockedProfitUsd} — ${input.message}`,
  );

  await appendExecutionEvent({
    commandId: `basket-lock-${input.basketId}`,
    terminalId: input.terminalId,
    lifecycleState: 'ACKNOWLEDGED',
    eventType: `BASKET_PROFIT_LOCK_${input.event.toUpperCase()}`,
    severity: eventSeverity(input.event),
    message: input.message,
    payload,
  }).catch(() => null);
}
