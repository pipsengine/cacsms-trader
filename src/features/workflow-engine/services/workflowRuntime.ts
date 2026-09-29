import { allPairs, instruments } from '../../../data/market';
import type { Instrument } from '../../../types';
import { eventBus, type TradingEvent, type TradingEventType } from '../../../services/eventBus';
import { bridgeAutonomyRun } from '../../mt5-connection/services/mt5BridgeClient';
import { getMT5Snapshot, subscribeMT5 } from '../../mt5-connection/services/cacsmsMT5Runtime';
import { getExecutionSnapshot, loadExecution, reconcileNow, setControlNow, subscribeExecution } from '../../execution/services/executionStore';
import { stage9Output } from '../../execution/services/executionStage';
import type { ControlPatch } from '../../execution/services/executionClient';
import { getHistorySnapshot, historyReadyCount, refreshHistory, subscribeHistory } from '../../market-data/services/historyStore';
import { getRegimeSnapshot, refreshRegime, subscribeRegime } from '../../historical-regime/services/regimeStore';
import { stage2Output } from '../../currency-strength/services/strengthStage';
import { refreshScanner, subscribeScanner } from '../../market-scanner/services/scannerStore';
import { stage4Output } from '../../market-scanner/services/scannerStage';
import { refreshVision, subscribeVision } from '../../htf-vision/services/visionStore';
import { stage5Output } from '../../htf-vision/services/visionStage';
import { refreshDirection, subscribeDirection } from '../../structural-direction/services/directionStore';
import { stage6Output } from '../../structural-direction/services/directionStage';
import { refreshH1, subscribeH1 } from '../../h1-confirmation/services/confirmStore';
import { stage7Output } from '../../h1-confirmation/services/confirmStage';
import { refreshRisk, subscribeRisk } from '../../opportunity-risk/services/riskStore';
import { stage8Output } from '../../opportunity-risk/services/riskStage';
import type { Opportunity } from '../../opportunity-risk/types';
import type { Execution } from '../../execution/types';
import { STAGE_DEFINITIONS } from '../data/stageDefinitions';
import { getAutonomySnapshot } from './autonomyStore';
import type {
  AccountView,
  ActionResult,
  ControlCommand,
  EngineMode,
  EngineRuntime,
  InstrumentTrace,
  OrchestratorIndicator,
  PipelineState,
  StageDependency,
  StageRuntime,
  WorkflowSnapshot,
} from '../types/workflow';
import { fmtAge, readStageSources, type StageSource } from './stageSources';
import { buildQueue, buildTrace, buildWorld, type InstrumentContext } from './instrumentModel';
import { toWorkflowEvent } from './eventModel';
import { getEconomicSnapshot, subscribeEconomic } from '../../economic-intelligence/services/economicStore';

/** Resolve an instrument from the persisted market state; a symbol without a quote fails Stage 1 — nothing is invented. */
export function resolveInstrument(symbol: string): Instrument {
  const existing = instruments.find((i) => i.symbol === symbol);
  if (existing) return existing;
  return {
    symbol,
    kind: symbol === 'XAUUSD' ? 'GOLD' : 'FX',
    bid: 0,
    ask: 0,
    spread: 0,
    change: 0,
    d1: 'NEUTRAL',
    h8: 'NEUTRAL',
    h1: 'WAITING_FOR_STAGE6',
    score: 0,
    state: 'WAIT',
    strengthDiff: 0,
    channelPos: 0,
    confidence: 0,
  };
}

const iso = (t = Date.now()) => new Date(t).toISOString();
const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');
const byKey = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
};

const lastSuccess = new Map<number, string>();
const latencyHistory = new Map<number, number[]>();
const lastLatencyRun = new Map<number, string>();

function recordLatency(src: StageSource) {
  if (src.latencyMs == null) return;
  const key = `${src.runAt}|${src.latencyMs}`;
  if (src.id !== 1 && src.id !== 9 && lastLatencyRun.get(src.id) === key) return;
  lastLatencyRun.set(src.id, key);
  latencyHistory.set(src.id, [...(latencyHistory.get(src.id) ?? []), src.latencyMs].slice(-16));
}

function stageConfidence(id: number): number | null {
  switch (id) {
    case 1:
      return getHistorySnapshot().status?.summary.quality ?? null;
    case 2:
      return avg(stage2Output().assets.filter((a) => a.composite != null).map((a) => a.confidence));
    case 3:
      return avg((getRegimeSnapshot().state?.assets ?? []).filter((a) => a.latest?.regime).map((a) => a.latest?.confidence));
    case 4:
      return avg(stage4Output().promoted.map((i) => i.conviction));
    case 5:
      return avg(stage5Output().instruments.filter((v) => v.status === 'READY' && v.d1?.confirmed).map((v) => v.confidence));
    case 6:
      return avg(stage6Output().ready.map((h) => h.confidence));
    case 7:
      return avg(stage7Output().confirmed.map((h) => h.confidence));
    case 8:
      return avg(stage8Output().opportunities.filter((o) => o.components.length).map((o) => o.score));
    default:
      return null;
  }
}

function stageIO(id: number, traces: InstrumentTrace[]): { input: string[]; output: string[]; activity: string } {
  const pass1 = traces.filter((t) => t.liveEligible).length;
  switch (id) {
    case 1: {
      const hs = getHistorySnapshot().status;
      const hr = historyReadyCount();
      const live = instruments.filter((i) => i.bid > 0 && i.ask > 0).length;
      return {
        input: [`MT5 provider ${hs?.provider.connected ? `connected · ${hs.provider.server ?? ''}` : 'OFFLINE'}`, `Live quotes ${live}/${allPairs.length}`, hs ? `Historical store ${hs.summary.candles.toLocaleString()} candles` : 'Historical store —'],
        output: [`Stage 1 pass ${pass1}/${allPairs.length} (valid + fresh + history READY)`, `History READY ${hr.ready}/${hr.total} instruments · ${hs?.summary.ready ?? 0}/${hs?.summary.series ?? 0} series`, `Market ${hs?.provider.marketOpen ? 'OPEN' : 'CLOSED'}`],
        activity: hs?.queue.current ? `History ${hs.queue.current.type} ${hs.queue.current.symbol} ${hs.queue.current.timeframe} (${hs.queue.current.runningSec}s)` : `Scheduler ${hs?.scheduler.running ? 'running' : 'idle'} · last cycle ${hs?.scheduler.lastCycleAt ?? '—'}`,
      };
    }
    case 2: {
      const s2 = stage2Output();
      const ready = s2.assets.filter((a) => a.composite != null);
      return {
        input: ['Stage 1 closed D1 candles · 28 FX + XAUUSD', 'Basket-relative Q63/M21/W5/D1 returns', `Latest closed D1 ${s2.obsDate ?? '—'}`],
        output: [`Strength ${ready.length}/9 assets`, s2.strongest && s2.weakest ? `Strongest ${s2.strongest} · weakest ${s2.weakest} · spread ${s2.spread?.toFixed(2)}` : 'Strong/weak spread —', `Differentials ${s2.pairs.filter((p) => p.differential != null).length}/${s2.pairs.length} → Regime, Scanner`],
        activity: `State ${s2.state}`,
      };
    }
    case 3: {
      const s = getRegimeSnapshot().state;
      const assets = s?.assets ?? [];
      const obs = assets.map((a) => a.observations.collected);
      return {
        input: ['Stage 2 strength trajectories · 8 currencies + XAU', `Closed observations ${obs.length ? Math.min(...obs) : 0}/${assets[0]?.observations.required ?? 0} required`],
        output: [`Regimes ${assets.filter((a) => a.latest?.regime).length}/${assets.length || 9} assets`, `Pair intelligence ${(s?.pairs ?? []).filter((p) => p.status === 'READY').length}/${s?.pairs.length ?? 0} → Scanner`, `Transitions recorded ${s?.transitions.length ?? 0}`],
        activity: s?.run?.message ?? '—',
      };
    }
    case 4: {
      const s4 = stage4Output();
      const c = s4.counters;
      return {
        input: [c ? `Stage 1 available ${c.available}/${c.universe}` : 'Stage 1 readiness —', 'Stage 2/3 strength & regimes'],
        output: [c ? `Ranked ${c.universe} · directional ${c.directional} · qualified ${s4.qualified}` : 'Ranking —', `Promoted ${s4.promoted.length}${s4.promoted.length ? ` (${s4.promoted.slice(0, 4).map((i) => i.symbol).join(', ')})` : ''} → HTF Vision`, `Blocked / stale / insufficient ${s4.blocked}`],
        activity: getScannerRunMessage(),
      };
    }
    case 5: {
      const s5 = stage5Output();
      const ready = s5.instruments.filter((v) => v.status === 'READY');
      return {
        input: [`Stage 4 promoted ${s5.qualified}/${s5.instruments.length || allPairs.length}`, 'Stage 1 validated D1/H8 closed candles'],
        output: [`Confirmed D1 channels ${s5.confirmedD1} · READY ${ready.length}/${s5.instruments.length}`, `D1/H8 agree ${s5.agree} · conflict ${s5.conflict}`, 'Channel, phase, position → Structural Direction'],
        activity: `${s5.instruments.length} instruments analysed`,
      };
    }
    case 6: {
      const s6 = stage6Output();
      const c = s6.counters;
      return {
        input: ['Stage 4 promotions + Stage 5 D1 authority / H8 phase'],
        output: [c ? `Candidates ${c.candidates} · aligned ${c.aligned} · pullback/waiting ${c.pullbackWaiting}` : 'Decisions —', c ? `Conflicts ${c.conflicts} · blocked ${c.blocked} · stale ${c.stale}` : '—', `READY_FOR_H1 ${s6.ready.length} → H1 Confirmation`],
        activity: `${s6.decisions.length} decisions held`,
      };
    }
    case 7: {
      const s7 = stage7Output();
      const c = s7.counters;
      return {
        input: ['Stage 6 READY_FOR_H1 hand-offs', 'Stage 1 validated closed H1 candles'],
        output: [c ? `Candidates ${c.candidates} · monitoring ${c.monitoring} · rejected ${c.rejected} · invalidated ${c.invalidated}` : 'Evaluations —', `CONFIRMED ${s7.confirmed.length} → Opportunities & Risk`],
        activity: c ? `${c.monitoring} setup(s) monitored on H1` : '—',
      };
    }
    case 8: {
      const s8 = stage8Output();
      const c = s8.counters;
      return {
        input: ['Stage 7 CONFIRMED hand-offs', `${s8.accounts.length} account(s) · trading ${s8.auto ? 'RUNNING' : 'PAUSED'}`],
        output: [c ? `Qualified ${c.qualified} · waiting ${c.waiting} · blocked ${c.blocked} · stale ${c.stale} · expired ${c.expired}` : 'Qualification —', `AUTHORIZED ${s8.pending.length} → Execution & Positions`],
        activity: `${s8.opportunities.length} active setup(s)`,
      };
    }
    case 9: {
      const s9 = stage9Output();
      const run = getExecutionSnapshot().state?.run;
      const sum = run?.summary;
      return {
        input: [`Stage 8 AUTHORIZED ${stage8Output().pending.length}`, `Control ${human(s9.control)} · execution ${s9.executionEnabled ? 'ENABLED' : 'DISABLED'} · trading ${s9.tradingEnabled ? 'RUNNING' : 'PAUSED'}`, run?.terminal ? `MT5 ${run.terminal.login}@${run.terminal.server} · ${run.reconciled ? 'reconciled' : 'reconciliation pending'}` : 'MT5 terminal not attached'],
        output: [`Queue ${s9.queue.length} · open ${s9.open.length}`, sum ? `Positions ${sum.stage9Positions} Stage 9 + ${sum.externalPositions} external · open P&L ${sum.openPnl.toFixed(2)} ${sum.currency ?? ''}` : 'Positions —', `Findings open ${s9.findings.length}`],
        activity: run?.message ?? '—',
      };
    }
    default: {
      const s9 = stage9Output();
      const published = s9.trades.filter((t) => t.stage10Status === 'PUBLISHED').length;
      return {
        input: ['Stage 9 closed trades with deal evidence'],
        output: [`Trade records ${s9.trades.length} · published ${published}`, 'Performance attribution → Performance page'],
        activity: `${s9.trades.length - published} record(s) awaiting publication`,
      };
    }
  }
}

function getScannerRunMessage() {
  return stage4Output().counters ? `${stage4Output().counters?.directional ?? 0} directional` : '—';
}

function buildStages(sources: Record<number, StageSource>, traces: InstrumentTrace[], analysisPaused: boolean, newEntries: boolean, controlReason: string, controlState: string | null): StageRuntime[] {
  const out: StageRuntime[] = [];
  const s9 = stage9Output();
  for (const def of STAGE_DEFINITIONS) {
    const id = def.id;
    const src = sources[id];
    recordLatency(src);
    if (src.health === 'HEALTHY' && src.runAt) lastSuccess.set(id, src.runAt);

    const reached = traces.filter((t) => t.stagesPassed >= id - 1 || t.decision === 'OPEN');
    const passed = traces.filter((t) => t.stagesPassed >= id);
    const atGate = traces.filter((t) => t.currentGate === id);
    const counts = {
      processed: id === 1 ? traces.length : reached.length,
      passed: passed.length,
      blocked: atGate.filter((t) => t.state === 'BLOCKED' || t.state === 'STALE').length,
      failed: atGate.filter((t) => t.decision === 'REJECTED' || t.decision === 'INVALIDATED').length,
    };

    const dependencies: StageDependency[] = def.deps.map((d) => {
      const up = out[d - 1];
      const okDep = up.health !== 'OFFLINE' && up.health !== 'ERROR' && up.state !== 'STALE' && up.state !== 'PAUSED' && (up.state !== 'BLOCKED' && up.state !== 'WAITING' ? true : up.counts.passed > 0);
      const detail = okDep ? `${up.counts.passed} instrument(s) passed Stage ${d}` : `${up.health !== 'HEALTHY' ? `${up.health}: ${up.healthReason}` : `${up.state}: ${up.stateReason}`}`;
      return { id: d, name: up.name, ok: okDep, detail };
    });
    // The live path is blocked when an upstream stage passes nothing on; this propagates down the chain.
    const blockedDep = dependencies.find((d) => !d.ok) ?? null;
    const upBlocked = blockedDep ? out[blockedDep.id - 1] : null;
    const blockedBy = blockedDep ? { ...blockedDep, detail: upBlocked?.blockedBy && upBlocked.blockedBy.id < blockedDep.id ? `${blockedDep.detail} (root: Stage ${upBlocked.blockedBy.id})` : blockedDep.detail } : null;

    let state: PipelineState;
    let stateReason: string;
    const running = atGate.filter((t) => t.state === 'RUNNING').length;
    if ((src.health === 'OFFLINE' || src.health === 'ERROR') && id !== 10) {
      state = src.runAt ? 'STALE' : 'IDLE';
      stateReason = src.runAt ? `Engine ${src.health} — last output ${fmtAge(src.freshnessSec)} old is not used downstream` : `Engine ${src.health} — no output`;
    } else if (analysisPaused && id >= 2 && id <= 8) {
      state = 'PAUSED';
      stateReason = 'Analysis paused by the operator — pending triggers run on resume; positions are still managed';
    } else if (src.running && id !== 1 && id !== 9) {
      state = 'RUNNING';
      stateReason = 'Run in progress';
    } else if (src.stale) {
      state = 'STALE';
      stateReason = `Output ${fmtAge(src.freshnessSec)} old exceeds the freshness limit — not consumed downstream`;
    } else if (src.warming) {
      state = 'WARMING_UP';
      stateReason = src.message || 'Collecting closed observations';
    } else if (id === 1) {
      if (counts.passed > 0) {
        state = 'RUNNING';
        stateReason = `Streaming · ${counts.passed}/${traces.length} valid + fresh`;
      } else {
        const q = traces.map((t) => t.state);
        state = q.every((x) => x === 'WAITING') ? 'WAITING' : q.some((x) => x === 'STALE') ? 'STALE' : q.some((x) => x === 'WARMING_UP') ? 'WARMING_UP' : 'BLOCKED';
        stateReason = `0/${traces.length} valid + fresh — ${atGate[0]?.blocker ?? 'no quotes'}`;
      }
    } else if (id === 9) {
      if (s9.open.length) {
        state = 'RUNNING';
        stateReason = `Managing ${s9.open.length} position(s)${newEntries ? '' : ` · new entries blocked (${human(controlState)})`}`;
      } else if (!newEntries) {
        state = 'BLOCKED';
        stateReason = `New entries blocked — ${human(controlState)}: ${controlReason}`;
      } else if (s9.queue.length) {
        state = 'RUNNING';
        stateReason = `${s9.queue.length} authorization(s) in revalidation / submission`;
      } else if (blockedBy) {
        state = upBlocked?.state === 'WAITING' ? 'WAITING' : 'BLOCKED';
        stateReason = `Blocked by Stage ${blockedBy.id} — ${blockedBy.detail}`;
      } else {
        state = 'IDLE';
        stateReason = 'No Stage 8 authorization to execute';
      }
    } else if (id === 10) {
      const learning = getAutonomySnapshot()?.learning;
      const status = learning?.status || 'WAITING';
      state = status === 'LEARNING' || status === 'VALIDATING' ? 'RUNNING' : status === 'HEALTHY' ? 'READY' : status === 'DEGRADED' || status === 'BLOCKED' ? 'BLOCKED' : 'WAITING';
      stateReason = learning?.summary?.message || 'Stage 10 is collecting stored evidence. Production parameters stay unchanged.';
    } else if (blockedBy && counts.passed === 0) {
      state = upBlocked?.state === 'WAITING' || upBlocked?.state === 'WARMING_UP' ? 'WAITING' : 'BLOCKED';
      stateReason = `Live path blocked by Stage ${blockedBy.id} (${blockedBy.name}) — ${blockedBy.detail}. Analysis continues on the last closed candles but nothing is passed on.`;
    } else if (counts.passed > 0) {
      state = 'READY';
      stateReason = `${counts.passed} instrument(s) passed → Stage ${id + 1}`;
    } else if (running) {
      state = 'RUNNING';
      stateReason = `${running} instrument(s) being monitored at this gate`;
    } else {
      state = 'WAITING';
      stateReason = atGate.length ? `${atGate.length} instrument(s) held here — ${atGate[0].blocker}` : 'No instrument has reached this stage';
    }

    const fSla = def.slaFreshnessSec;
    const lSla = def.slaLatencyMs;
    const io = stageIO(id, traces);
    const bridgeOk = src.health !== 'OFFLINE';
    const depDown = def.deps.map((d) => sources[d]).find((u) => u.health === 'OFFLINE' || u.health === 'ERROR');
    const rerun =
      id === 10
        ? { allowed: false, reason: 'Stage 10 records are written by the Stage 9 engine on each close' }
        : !bridgeOk
          ? { allowed: false, reason: `Engine OFFLINE — ${src.healthReason}` }
          : analysisPaused && id >= 2 && id <= 8
            ? { allowed: false, reason: 'Analysis is paused — resume analysis first' }
            : src.running
              ? { allowed: false, reason: 'A run is already in progress' }
              : depDown && id !== 9
                ? { allowed: false, reason: `Dependency Stage ${depDown.id} is ${depDown.health}` }
                : { allowed: true, reason: id === 1 ? 'Re-reads the historical synchronizer state (read-only)' : id === 9 ? 'Requests a full MT5 reconciliation on the central engine (no orders)' : `Runs the Stage ${id} engine on the bridge; downstream stages re-run from its triggers` };

    out.push({
      id,
      name: def.name,
      description: def.description,
      health: src.health,
      healthReason: src.healthReason,
      state,
      stateReason,
      blockedBy: state === 'BLOCKED' || state === 'WAITING' ? blockedBy : null,
      confidence: stageConfidence(id),
      latencyMs: src.latencyMs,
      latencyLabel: src.latencyLabel,
      latencyHistory: latencyHistory.get(id) ?? [],
      freshnessSec: src.freshnessSec,
      sla: {
        latencyMs: lSla,
        freshnessSec: fSla,
        latencyOk: lSla == null || src.latencyMs == null ? null : src.latencyMs <= lSla,
        freshnessOk: fSla == null || src.freshnessSec == null ? null : src.freshnessSec <= fSla,
        note: def.slaNote,
      },
      counts,
      input: io.input,
      output: io.output,
      dependencies,
      triggers: src.triggers.length ? [`Last run: ${src.triggers.slice(0, 4).join(', ')}`, ...def.triggers] : def.triggers,
      invalidation: def.invalidation,
      activity: src.running ? 'Run in progress' : io.activity,
      lastRunAt: src.runAt,
      lastSuccessAt: lastSuccess.get(id) ?? null,
      lastError: src.lastError,
      message: src.message || src.healthReason,
      runs: src.runs,
      errors: src.errors,
      running: src.running,
      rerun,
    });
  }
  return out;
}

function engineMode(): { mode: EngineMode; source: string } {
  const run = getExecutionSnapshot().state?.run;
  const mt5 = getMT5Snapshot();
  const attachedId = run?.terminal?.accountId ?? null;
  const attached = attachedId ? mt5.accounts.find((a) => a.id === attachedId) : undefined;
  if (attached && run?.connected) return { mode: attached.accountClass, source: `Stage 9 attached account ${attached.name} (${attached.login}@${attached.server}) · account class ${attached.accountClass}` };
  const connected = mt5.accounts.filter((a) => a.state === 'HEALTHY' || a.state === 'DEGRADED');
  if (connected.length) {
    const cls = connected.some((a) => a.accountClass === 'LIVE') ? 'LIVE' : connected.some((a) => a.accountClass === 'PROP') ? 'PROP' : 'DEMO';
    return { mode: cls, source: `${connected.length} connected MT5 account(s); the Stage 9 engine has not attached a terminal account` };
  }
  return { mode: 'SIMULATION', source: 'No broker account connected — no order can reach a broker' };
}

function accountViews(): AccountView[] {
  const mt5 = getMT5Snapshot();
  const s8 = stage8Output().accounts;
  const attachedId = getExecutionSnapshot().state?.run?.terminal?.accountId ?? null;
  return mt5.accounts.map((a) => {
    const e = s8.find((x) => x.accountId === a.id);
    return {
      id: a.id,
      name: a.name,
      accountClass: a.accountClass,
      currency: a.currency,
      connection: a.state,
      tradingMode: e?.tradingMode ?? a.tradingMode,
      tradingEnabled: e?.tradingEnabled ?? a.tradingEnabled,
      eligibility: e?.status ?? 'NOT EVALUATED',
      issues: (e?.issues ?? []).map((i) => `${i.code}: ${i.reason}`),
      equity: e?.equity ?? (a.equity || null),
      attached: a.id === attachedId,
    };
  });
}

function indicators(stages: StageRuntime[], traces: InstrumentTrace[], engine: Omit<EngineRuntime, 'indicators'>): OrchestratorIndicator[] {
  const paused = engine.analysisPaused;
  const down = stages.filter((s) => s.health === 'OFFLINE' || s.health === 'ERROR');
  const depBlocked = stages.filter((s) => s.blockedBy);
  const staleStages = stages.filter((s) => s.sla.freshnessOk === false && !(paused && s.id >= 2 && s.id <= 8));
  const s1Stale = traces.filter((t) => t.state === 'STALE' && t.currentGate === 1).length;
  // A downstream result on an instrument whose live path is not clear is a stale signal; it must never be READY.
  const violations = traces.filter((t) => t.decision === 'READY' && (!t.liveEligible || t.stagesPassed < 8));
  const heldWithAnalysis = traces.filter((t) => !t.liveEligible && t.analysisDepth >= 4).length;
  const lastEventAge = engine.lastEventAt ? Math.round((Date.now() - Date.parse(engine.lastEventAt)) / 1000) : null;
  return [
    {
      key: 'deps',
      label: 'Dependency scheduling',
      status: paused ? 'PAUSED' : down.length ? 'FAIL' : depBlocked.length ? 'GATED' : 'OK',
      detail: down.length
        ? `Stage ${down.map((s) => s.id).join(', ')} ${down[0].health} — dependants held`
        : depBlocked.length
          ? `Stage ${depBlocked.map((s) => s.id).join(', ')} held by upstream (root Stage ${Math.min(...depBlocked.map((s) => s.blockedBy!.id))})`
          : 'Every stage has its upstream output',
    },
    {
      key: 'fresh',
      label: 'Freshness validation',
      status: staleStages.length ? 'WARN' : 'OK',
      detail: staleStages.length ? `Freshness SLA breached: Stage ${staleStages.map((s) => s.id).join(', ')}` : `All stages within freshness SLA${s1Stale ? ` · ${s1Stale} instrument(s) with a stale feed held at Stage 1` : ''}`,
    },
    {
      key: 'route',
      label: 'Event routing',
      status: engine.bridgeReachable ? (lastEventAge == null || lastEventAge > 900 ? 'WARN' : 'OK') : 'FAIL',
      detail: !engine.bridgeReachable ? 'Bridge unreachable — no events routed' : `${engine.throughput}/min on the bus · last event ${lastEventAge == null ? '—' : `${fmtAge(lastEventAge)} ago`}`,
    },
    {
      key: 'stale',
      label: 'Stale-signal prevention',
      status: violations.length ? 'FAIL' : 'OK',
      detail: violations.length ? `${violations.length} READY decision(s) without a clear live path: ${violations.map((t) => t.symbol).join(', ')}` : `0 stale signals downstream${heldWithAnalysis ? ` · ${heldWithAnalysis} instrument(s) with last-known Stage 4+ analysis held upstream` : ''}`,
    },
    {
      key: 'retry',
      label: 'Retry / fail-safe handling',
      status: engine.failedJobs ? 'FAIL' : engine.retries ? 'WARN' : 'OK',
      detail: `${engine.retries} retrying · ${engine.failedJobs} failed job(s) · ${engine.serviceErrors} service error(s) since start`,
    },
    {
      key: 'exec',
      label: 'Execution permissions',
      status: engine.emergencyStop ? 'FAIL' : engine.newEntries ? 'OK' : 'GATED',
      detail: engine.newEntries ? 'Stage 9 accepting Stage 8 authorizations' : `${human(engine.control)} — ${engine.controlReason}`,
    },
  ];
}

export function getWorkflowSnapshot(now = Date.now()): WorkflowSnapshot {
  const ex = getExecutionSnapshot();
  const run = ex.state?.run;
  const ctrl = ex.state?.control;
  const control = run?.control;
  const analysisPaused = Boolean(ctrl?.analysisPaused);
  const sources = readStageSources(analysisPaused, now);
  const s9 = stage9Output(now);
  const newEntries = Boolean(control?.newEntries) && sources[9].usable;
  const controlReason = control?.reason ?? (sources[9].usable ? 'No control state published' : sources[9].healthReason);

  const ctx: InstrumentContext = {
    now,
    analysisPaused,
    sources,
    s2: stage2Output(),
    scanner: new Map(stage4Output().instruments.map((x) => [x.symbol, x])),
    vision: new Map(stage5Output().instruments.map((x) => [x.symbol, x])),
    direction: new Map(stage6Output().decisions.map((x) => [x.symbol, x])),
    h1: new Map(stage7Output().decisions.map((x) => [x.symbol, x])),
    opportunities: byKey<Opportunity>(stage8Output().opportunities, (o) => o.symbol),
    open: byKey<Execution>(s9.open, (x) => x.instrument),
    queued: byKey<Execution>(s9.queue, (x) => x.instrument),
    control: { newEntries, state: control?.state ?? null, reason: controlReason },
    accountOpenRiskPct: run?.summary?.openRiskPct ?? null,
    economic: new Map((getEconomicSnapshot()?.instruments ?? []).map((row) => [row.symbol, {
      state: row.state,
      activeEvent: row.detail.title || row.activeEventId,
      activeEventId: row.activeEventId,
      affectedCurrency: row.currency,
      impact: row.impact,
      scheduledAt: row.detail.scheduledAt || null,
      minutesToEvent: row.minutesToEvent,
      actual: row.detail.actual || null,
      forecast: row.detail.forecast || null,
      previous: row.detail.previous || null,
      surprise: row.surprise,
      marketReactionScore: row.detail.marketReactionScore ?? null,
      spreadCondition: row.spreadCondition,
      volatilityCondition: row.volatilityCondition,
      restriction: row.restriction,
      revalidationRequired: row.revalidationRequired,
      calendarFeedHealth: row.detail.calendarFeedHealth,
      mt5Health: row.detail.mt5Health,
      updatedAt: row.updatedAt,
      blocksNewEntries: row.blocksNewEntries,
      reason: row.reason,
    }])),
  };

  const instrumentsNow = allPairs.map((s) => resolveInstrument(s));
  const traces = instrumentsNow.map((i) => buildTrace(i, ctx));
  const world = instrumentsNow.map((i, n) => buildWorld(i, traces[n], ctx));
  const stages = buildStages(sources, traces, analysisPaused, newEntries, controlReason, control?.state ?? null);

  const busEvents = eventBus.recent(1000);
  const events = busEvents.map(toWorkflowEvent);
  const cutoff = now - 60_000;
  const throughput = busEvents.filter((e) => Date.parse(e.at) >= cutoff).length;

  const hs = getHistorySnapshot().status;
  const counts = hs?.queue.counts ?? {};
  const activeJobs = [
    ...(hs?.queue.current ? [`History ${hs.queue.current.type} ${hs.queue.current.symbol} ${hs.queue.current.timeframe}`] : []),
    ...Object.values(sources)
      .filter((s) => s.running && s.id !== 1)
      .map((s) => `Stage ${s.id} ${s.def.short} run`),
  ];
  const mode = engineMode();
  const heartbeatAge = run?.runAt ? Math.max(0, Math.round((now - Date.parse(run.runAt)) / 1000)) : null;
  const serviceErrors = [1, 4, 5, 6, 7, 8, 9].reduce((a, id) => a + (sources[id].errors ?? 0), 0);
  const base: Omit<EngineRuntime, 'indicators'> = {
    bridgeReachable: !Object.values(sources).every((s) => s.health === 'OFFLINE'),
    mode: mode.mode,
    modeSource: mode.source,
    analysisPaused,
    tradingEnabled: Boolean(ex.state?.tradingEnabled),
    executionEnabled: Boolean(ctrl?.executionEnabled),
    emergencyStop: Boolean(ctrl?.emergencyStop),
    newEntries,
    management: Boolean(control?.management),
    control: control?.state ?? (sources[9].usable ? 'UNKNOWN' : 'OFFLINE'),
    controlReason,
    controlFlags: control?.flags ?? [],
    cycle: run?.runs ?? null,
    node: run?.node ?? null,
    lastHeartbeat: run?.runAt ?? null,
    heartbeatAgeSec: heartbeatAge,
    activeJobs,
    queuedJobs: (counts.QUEUED ?? 0) + (counts.RETRYING ?? 0),
    queuedAuthorizations: s9.queue.length,
    retries: counts.RETRYING ?? 0,
    failedJobs: counts.FAILED ?? 0,
    engineErrors: stages.filter((s) => s.health === 'ERROR' || s.health === 'OFFLINE').length,
    serviceErrors,
    throughput,
    lastEventAt: busEvents[0]?.at ?? null,
    accounts: accountViews(),
    controlUpdatedAt: ctrl?.updatedAt ?? null,
    controlUpdatedBy: ctrl?.updatedBy ?? null,
  };
  const engine: EngineRuntime = { ...base, indicators: indicators(stages, traces, base) };

  return {
    generatedAt: iso(now),
    stages,
    instruments: traces,
    queue: buildQueue(traces),
    events,
    world,
    engine,
    kpis: {
      monitored: traces.length,
      liveEligible: traces.filter((t) => t.liveEligible).length,
      blockedInstruments: traces.filter((t) => t.decision === 'BLOCKED').length,
      waitingInstruments: traces.filter((t) => t.decision === 'WAIT').length,
      readyCandidates: traces.filter((t) => t.decision === 'READY').length,
      openPositions: s9.open.length,
      engineErrors: engine.engineErrors,
      degradedStages: stages.filter((s) => s.health === 'DEGRADED').length,
    },
  };
}

function audit(detail: string, stage: number, extra: Record<string, unknown> = {}, type: TradingEvent['type'] = 'RISK_EVENT', symbol?: string) {
  eventBus.emit({
    id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    symbol,
    at: iso(),
    payload: { source: 'workflow', detail, stage, audit: true, ...extra },
  });
}

const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Every action here only asks the bridge orchestrator to process. None of them sequence the pipeline or bypass a gate. */
export const workflowActions = {
  /** Refresh = reconcile the page with the persisted engine state (read-only; no stage is re-run). */
  async reconcile(): Promise<ActionResult> {
    const results = await Promise.allSettled([refreshHistory(), refreshRegime(), refreshScanner(), refreshVision(), refreshDirection(), refreshH1(), refreshRisk(), loadExecution()]);
    const failed = results.filter((r) => r.status === 'rejected').length;
    return failed ? { ok: false, message: `${failed} store(s) failed to reload` } : { ok: true, message: 'Reconciled with the persisted engine state' };
  },

  async rerunStage(stage: number): Promise<ActionResult> {
    const snap = getWorkflowSnapshot();
    const s = snap.stages[stage - 1];
    if (!s) return { ok: false, message: `Unknown stage ${stage}` };
    if (!s.rerun.allowed) return { ok: false, message: s.rerun.reason };
    if (stage === 1) {
      try {
        await refreshHistory();
      } catch (e) {
        return { ok: false, message: errOf(e) };
      }
      return { ok: true, message: 'Reloaded Stage 1 status. The historical synchronizer keeps running on the bridge.' };
    }
    if (stage === 9) {
      try {
        await reconcileNow();
      } catch (e) {
        return { ok: false, message: errOf(e) };
      }
      return { ok: true, message: 'Reconciliation requested. Stage 9 still applies authorization, freshness and risk checks.' };
    }
    audit(`Diagnostic reprocess of Stage ${stage} queued on the orchestrator`, stage, {}, 'DATA_EVENT');
    const queued = await bridgeAutonomyRun({ stage, reason: `Diagnostic reprocess of Stage ${stage}` });
    return queued.ok ? { ok: true, message: queued.message } : { ok: false, message: queued.message };
  },

  /** Ask the orchestrator to reprocess. The browser does not sequence stages or bypass a gate. */
  async reevaluate(symbol?: string): Promise<ActionResult> {
    const snap = getWorkflowSnapshot();
    if (snap.engine.analysisPaused) return { ok: false, message: 'Analysis is paused — resume analysis before re-evaluating' };
    const target = symbol ?? `all ${allPairs.length} instruments`;
    audit(`Diagnostic reprocess of ${target} queued on the orchestrator`, symbol ? 5 : 4, {}, 'DATA_EVENT', symbol);
    const queued = await bridgeAutonomyRun({
      reason: symbol ? `Diagnostic reprocess ${symbol}` : 'Diagnostic reprocess',
      ...(symbol ? { symbol } : {}),
    });
    return queued.ok ? { ok: true, message: queued.message } : { ok: false, message: queued.message };
  },

  /** Operator controls are applied and audited by the central engine; this page never pauses protection. */
  async control(cmd: ControlCommand, reason: string): Promise<ActionResult> {
    const map: Record<ControlCommand, [ControlPatch, string]> = {
      PAUSE_NEW_TRADES: [{ tradingEnabled: false }, 'Pause new trades'],
      RESUME_NEW_TRADES: [{ tradingEnabled: true }, 'Resume new trades'],
      PAUSE_ANALYSIS: [{ analysisPaused: true }, 'Pause analysis'],
      RESUME_ANALYSIS: [{ analysisPaused: false }, 'Resume analysis'],
      EMERGENCY_STOP: [{ emergencyStop: true }, 'Emergency stop'],
      RELEASE_EMERGENCY: [{ emergencyStop: false }, 'Release emergency stop'],
      ENABLE_EXECUTION: [{ executionEnabled: true }, 'Enable Stage 9 execution'],
      DISABLE_EXECUTION: [{ executionEnabled: false }, 'Disable Stage 9 execution'],
    };
    const [patch, label] = map[cmd];
    const why = reason.trim() || `${label} from the Workflow Engine`;
    try {
      const r = await setControlNow(patch, why);
      const state = getExecutionSnapshot().state?.run?.control?.state ?? null;
      audit(`${label}${r.changed.length ? '' : ' (no change)'} — applied by the central engine · control ${human(state)} · ${why}`, cmd.includes('ANALYSIS') ? 4 : 9, {
        control: state,
        critical: cmd === 'EMERGENCY_STOP',
      });
      return { ok: true, message: r.changed.length ? `${label} applied by the central engine` : `${label}: already in that state` };
    } catch (e) {
      audit(`${label} NOT applied: ${errOf(e)}`, 9, { severity: 'ERROR' });
      return { ok: false, message: errOf(e) };
    }
  },
};

const BUS_TYPES: TradingEventType[] = [
  'TICK', 'H1_CLOSE', 'H8_CLOSE', 'D1_CLOSE', 'W1_CLOSE', 'MN_CLOSE', 'M15_CLOSE', 'M5_CLOSE', 'DATA_EVENT', 'CHANNEL_APPROACH', 'CHANNEL_BREAK',
  'STRENGTH_CHANGE', 'SCANNER_CHANGE', 'STRUCTURE_CHANGE', 'DIRECTION_CHANGE', 'CONFIRMATION_CHANGE', 'RISK_CHANGE', 'SPREAD_SPIKE', 'POSITION_EVENT', 'RISK_EVENT',
  'ECON_EVENT_UPCOMING', 'ECON_EVENT_WATCH', 'ECON_PRE_EVENT_GATE', 'ECON_RELEASED', 'ECON_RELEASE_WINDOW', 'ECON_ACTUAL_RECEIVED', 'ECON_SURPRISE_CALCULATED', 'ECON_VOLATILITY_SPIKE', 'ECON_MARKET_SHOCK', 'ECON_SPREAD_SPIKE', 'ECON_REVALIDATION_REQUESTED', 'ECON_STRUCTURE_INVALIDATED', 'ECON_NORMALIZED', 'ECON_FEED_SYNCED', 'ECON_FEED_STALE', 'ECON_FEED_FAILED',
];

/** Subscribe to every store the snapshot reads plus the event bus; the stores themselves are owned by the app-level runtime. */
export function subscribeWorkflowSources(cb: () => void): () => void {
  const offs = [
    subscribeHistory(cb),
    subscribeRegime(cb),
    subscribeScanner(cb),
    subscribeVision(cb),
    subscribeDirection(cb),
    subscribeH1(cb),
    subscribeRisk(cb),
    subscribeExecution(cb),
    subscribeEconomic(cb),
    subscribeMT5(() => cb()),
    ...BUS_TYPES.map((t) => eventBus.on(t, () => cb())),
  ];
  return () => offs.forEach((off) => void off());
}
