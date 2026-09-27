import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import type { AccountSummary, Authorization, Opportunity, RiskCounters, RiskState, RiskStateResponse } from '../types';
import { getRiskSnapshot, riskStageStatus, type RiskStageStatus } from './riskStore';

/** Stage 8 → Stage 9 output: immutable execution authorizations only; Stage 8 never submits an order. */
export type Stage8Output = {
  status: RiskStageStatus;
  runAt: string | null;
  opportunities: Opportunity[];
  counters: RiskCounters | null;
  accounts: AccountSummary[];
  pending: Authorization[];
  auto: boolean;
};

export function stage8Output(now = Date.now()): Stage8Output {
  const snap = getRiskSnapshot();
  const s = snap.state;
  const status = riskStageStatus(snap, now);
  const usable = status === 'HEALTHY' || status === 'DEGRADED';
  return {
    status,
    runAt: s?.run?.runAt ?? null,
    opportunities: (s?.opportunities ?? []).filter((o) => o.active),
    counters: s?.run?.counters ?? null,
    accounts: s?.run?.accounts ?? [],
    pending: usable ? (s?.authorizations ?? []).filter((a) => a.status === 'PENDING' && Date.parse(a.expiresAt) > now) : [],
    auto: Boolean(s?.run?.auto),
  };
}

/** Opportunity state for one instrument (best across its active setups), or null when Stage 8 has no active setup for it. */
export function stage8StateFor(symbol: string): RiskState | null {
  const opps = stage8Output().opportunities.filter((o) => o.symbol === symbol);
  if (!opps.length) return null;
  return opps.some((o) => o.state === 'AUTHORIZED') ? 'AUTHORIZED' : opps[0].state;
}

export const riskTone = (s?: RiskState | string | null) =>
  s === 'AUTHORIZED'
    ? 'green'
    : s === 'QUALIFIED'
      ? 'blue'
      : s === 'WAITING' || s === 'EVALUATING' || s === 'STALE'
        ? 'amber'
        : s === 'EXPIRED'
          ? 'gray'
          : s && s.endsWith('_BLOCKED')
            ? 'red'
            : 'gray';

export const riskGateTone = (s?: string) => (s === 'PASS' ? 'green' : s === 'FAIL' ? 'red' : s === 'WAIT' || s === 'STALE' ? 'amber' : 'gray');

const signatures = new Map<string, string>();
let lastRunAt: string | null = null;

function emit(symbol: string | undefined, detail: string, extra: Record<string, unknown>) {
  const routed = routeEvent('RISK_CHANGE');
  eventBus.emit({
    id: `s8-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'RISK_CHANGE',
    symbol,
    at: new Date().toISOString(),
    payload: { source: 'risk', detail, stage: 8, stages: routed.stages, priority: routed.priority, ...extra },
  });
}

/** Publish Stage 8 runs and per-setup state changes; the orchestrator routes RISK_CHANGE to Stages 8–9. */
export function publishStage8(state: RiskStateResponse | null) {
  const run = state?.run;
  if (!state || !run?.runAt) return;
  const firstPass = lastRunAt == null;
  if (run.runAt !== lastRunAt) {
    lastRunAt = run.runAt;
    const c = run.counters;
    emit(
      undefined,
      c
        ? `Stage 8 risk (${run.triggers?.slice(0, 3).join(', ') || 'run'}): ${c.candidates} Stage 7 confirmed · ${c.qualified} setup-qualified · ${c.eligible} account-eligible · ${c.authorized} AUTHORIZED → Execution`
        : run.message,
      { runAt: run.runAt, authorized: c?.authorized ?? 0, created: run.created },
    );
  }
  for (const o of state.opportunities.filter((x) => x.active)) {
    const sig = `${o.state}|${o.reasonCode}|${o.authorizedAccounts}`;
    const prev = signatures.get(o.setupKey);
    signatures.set(o.setupKey, sig);
    if (firstPass || !prev || prev === sig) continue;
    const [pState] = prev.split('|');
    emit(o.symbol, `${o.symbol} ${o.side} risk ${pState} → ${o.state} · ${o.reasonCode}: ${o.reason}`, {
      state: o.state,
      setupKey: o.setupKey,
      score: o.score,
      eligibleAccounts: o.eligibleAccounts,
      authorizedAccounts: o.authorizedAccounts,
    });
  }
}
