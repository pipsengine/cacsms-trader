import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { ControlStateName, Execution, ExecutionStateResponse, ExecTrade, OrderState, PositionState, ReconFinding } from '../types';
import { executionStageStatus, getExecutionSnapshot, type ExecutionStageStatus } from './executionStore';

export const OPEN_POSITION_STATES: PositionState[] = ['OPEN', 'PROTECTED', 'MANAGING', 'PARTIAL_EXIT', 'BREAKEVEN', 'TRAILING', 'EXIT_PENDING', 'ERROR'];
export const IN_FLIGHT_STATES: OrderState[] = ['SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN', 'RECONCILING'];
export const PRE_SUBMIT_STATES: OrderState[] = ['AUTHORIZED', 'QUEUED', 'REVALIDATING'];

/** Stage 9 → Stage 10 output: broker-confirmed positions and closed trades, all read from the central engine's persisted state. */
export type Stage9Output = {
  status: ExecutionStageStatus;
  runAt: string | null;
  control: ControlStateName | null;
  newEntries: boolean;
  executionEnabled: boolean;
  tradingEnabled: boolean;
  open: Execution[];
  queue: Execution[];
  trades: ExecTrade[];
  findings: ReconFinding[];
};

export function stage9Output(now = Date.now()): Stage9Output {
  const snap = getExecutionSnapshot();
  const s = snap.state;
  const ledger = s?.ledger ?? [];
  return {
    status: executionStageStatus(snap, now),
    runAt: s?.run?.runAt ?? null,
    control: s?.run?.control?.state ?? null,
    newEntries: Boolean(s?.run?.control?.newEntries),
    executionEnabled: Boolean(s?.control?.executionEnabled),
    tradingEnabled: Boolean(s?.tradingEnabled),
    open: ledger.filter((x) => x.positionState && OPEN_POSITION_STATES.includes(x.positionState)),
    queue: [...ledger.filter((x) => !x.positionState && [...PRE_SUBMIT_STATES, ...IN_FLIGHT_STATES].includes(x.orderState)), ...(s?.pendingAuthorizations ?? [])],
    trades: s?.trades ?? [],
    findings: s?.reconciliation.open ?? [],
  };
}

export const orderTone = (s?: OrderState | string | null) =>
  s === 'FILLED'
    ? 'green'
    : s === 'PARTIALLY_FILLED' || s === 'ACKNOWLEDGED' || s === 'SUBMITTING'
      ? 'blue'
      : s === 'UNKNOWN' || s === 'RECONCILING' || s === 'REVALIDATING' || s === 'QUEUED'
        ? 'amber'
        : s === 'REJECTED'
          ? 'red'
          : s === 'AUTHORIZED'
            ? 'green'
            : 'gray';

export const positionTone = (s?: PositionState | string | null) =>
  s === 'PROTECTED' || s === 'BREAKEVEN' || s === 'TRAILING'
    ? 'green'
    : s === 'OPEN' || s === 'MANAGING' || s === 'PARTIAL_EXIT'
      ? 'blue'
      : s === 'EXIT_PENDING' || s === 'STALE'
        ? 'amber'
        : s === 'ERROR' || s === 'CONNECTION_LOST'
          ? 'red'
          : 'gray';

export const controlTone = (s?: ControlStateName | string | null) =>
  s === 'RUNNING' ? 'green' : s === 'EMERGENCY_STOP' || s === 'MT5_DISCONNECTED' ? 'red' : s ? 'amber' : 'gray';

export const severityTone = (s?: string | null) => (s === 'BLOCKING' ? 'red' : s === 'WARNING' ? 'amber' : 'blue');

const signatures = new Map<string, string>();
const publishedTrades = new Set<string>();
let lastControl: string | null = null;
let primed = false;

function emit(symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent('POSITION_EVENT');
  eventBus.emit({
    id: `s9-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'POSITION_EVENT',
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'execution', detail, stage: 9, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/** Publish Stage 9 control changes, execution/position transitions and Stage 10 trade publications; the orchestrator routes POSITION_EVENT to Stages 9–10. */
export function publishStage9(state: ExecutionStateResponse | null) {
  const run = state?.run;
  if (!state || !run?.runAt) return;
  const control = run.control?.state ?? null;
  if (control !== lastControl) {
    emit(undefined, `Stage 9 ${control ?? 'UNKNOWN'} — ${run.control?.reason ?? run.message}`, { control });
    lastControl = control;
  }
  for (const x of state.ledger) {
    const sig = `${x.orderState}|${x.positionState ?? ''}`;
    const prev = signatures.get(x.executionId);
    signatures.set(x.executionId, sig);
    if (!primed || prev === sig) continue;
    const [pOrder, pPos] = (prev ?? '|').split('|');
    const from = prev ? `${pPos || pOrder} → ` : '';
    emit(x.instrument, `${x.instrument} ${x.direction} ${x.executionId}: ${from}${x.positionState ?? x.orderState}${x.stateReason ? ` · ${x.stateReason}` : ''}`, {
      executionId: x.executionId,
      orderState: x.orderState,
      positionState: x.positionState,
      accountId: x.accountId,
    });
  }
  for (const t of state.trades) {
    if (publishedTrades.has(t.executionId)) continue;
    publishedTrades.add(t.executionId);
    if (!primed) continue;
    emit(
      t.symbol,
      `${t.symbol} ${t.direction} closed · ${t.exitReason} · ${t.realizedPnl.toFixed(2)} ${t.currency}${t.rMultiple != null ? ` (${t.rMultiple.toFixed(2)}R)` : ''} → Stage 10 ${t.stage10Status}`,
      { executionId: t.executionId, stage10: t.stage10Status },
    );
  }
  primed = true;
}
