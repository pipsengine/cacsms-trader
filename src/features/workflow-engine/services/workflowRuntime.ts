import { allPairs, instruments, positions, strengths } from '../../../data/market';
import type { Instrument } from '../../../types';
import { createWorldState, type WorldState } from '../../../engine/worldModel';
import { executionGate, routeEvent, type GateResult, type MarketEvent } from '../../../engine/orchestrator';
import { qualifyRisk } from '../../../engine/risk';
import { eventBus, type TradingEvent } from '../../../services/eventBus';
import { decisionAudit } from '../../../services/decisionAudit';
import { brokerGateway } from '../../../services/brokerGateway';
import { SYSTEM } from '../../../config/system';
import { STAGE_DEFINITIONS } from '../data/stageDefinitions';
import type {
  InstrumentTrace,
  StageRuntime,
  StageStatus,
  WorkflowEvent,
  WorkflowSnapshot,
  WorldModelRecord,
} from '../types/workflow';

type RuntimeDeps = {
  getAuto: () => boolean;
  setAuto: (v: boolean) => void;
  getRiskLimit: () => number;
  getPositions: () => typeof positions;
};

const iso = () => new Date().toISOString();
const strengthOf = (code: string) => strengths.find((s) => s.code === code)?.score ?? 0;

function hash(symbol: string) {
  return [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
}

/** Expand the 12 detailed fixtures to the full 29-instrument universe using strength differentials. */
export function resolveInstrument(symbol: string): Instrument {
  const existing = instruments.find((i) => i.symbol === symbol);
  if (existing) return existing;

  const gold = symbol === 'XAUUSD';
  const base = gold ? 'XAU' : symbol.slice(0, 3);
  const quote = gold ? 'USD' : symbol.slice(3, 6);
  const diff = +(strengthOf(base) - strengthOf(quote)).toFixed(1);
  const h = hash(symbol);
  const score = Math.max(55, Math.min(95, Math.round(62 + Math.abs(diff) * 2.2 + (h % 9))));
  const confidence = Math.max(60, Math.min(96, score - 2 + (h % 5)));
  const d1 = diff > 2 ? 'BULLISH' : diff < -2 ? 'BEARISH' : 'NEUTRAL';
  const h8 = Math.abs(diff) > 1.5 ? d1 : 'NEUTRAL';
  const h1 =
    score >= 86 && Math.abs(diff) > 8
      ? 'Confirmed'
      : score >= 78
        ? 'Pullback'
        : Math.abs(diff) < 2
          ? 'Range'
          : 'Waiting';
  const state =
    h1 === 'Confirmed' && score >= 80
      ? 'READY'
      : score < 68
        ? 'BLOCKED'
        : 'WAIT';

  const mid = gold
    ? 2030 + (h % 40) + Math.abs(diff)
    : base === 'JPY' || quote === 'JPY'
      ? 90 + (h % 100) + Math.abs(diff)
      : 0.65 + (h % 80) / 100 + Math.abs(diff) / 100;

  const digits = gold || quote === 'JPY' || base === 'JPY' ? 2 : 5;
  const spread = gold ? 1.9 : quote === 'JPY' ? 1.8 : 1.0;
  const bid = +mid.toFixed(digits);
  const ask = +(mid + (gold ? 0.19 : quote === 'JPY' ? 0.018 : 0.00008)).toFixed(digits);

  return {
    symbol,
    kind: gold ? 'GOLD' : 'FX',
    bid,
    ask,
    spread,
    change: +(((h % 17) - 8) / 20).toFixed(2),
    d1,
    h8,
    h1,
    score,
    state,
    strengthDiff: diff,
    channelPos: Math.max(8, Math.min(88, 20 + (h % 55))),
    confidence,
  };
}

function mapH1(phase: string) {
  const p = phase.toUpperCase();
  if (p.includes('CONFIRM') || p.includes('BOS')) return 'CONFIRMED';
  if (p.includes('PULL')) return 'PULLBACK';
  if (p.includes('CHOCH')) return 'CHOCH';
  return 'WAIT';
}

function mapDecision(i: Instrument, riskApproved: boolean, open: boolean): InstrumentTrace['decision'] {
  if (open) return 'OPEN';
  if (i.state === 'BLOCKED' || !riskApproved) return 'BLOCKED';
  if (i.state === 'READY' && riskApproved) return 'READY';
  return 'WAIT';
}

function currentStage(i: Instrument, riskApproved: boolean, open: boolean) {
  if (open) return 9;
  if (i.state === 'READY' && riskApproved) return 8;
  if (i.h1 === 'Confirmed') return 7;
  if (i.d1 !== 'NEUTRAL' && i.h8 !== 'NEUTRAL') return 6;
  if (Math.abs(i.strengthDiff) > 3) return 5;
  if (Math.abs(i.strengthDiff) > 1) return 4;
  return 3;
}

let cycle = 1;
let monitoringPaused = false;
let executionEnabled = false;
let lastHeartbeat = iso();
let queueDepth = 0;
let errors = 0;
const stageFailures = new Map<number, number>();
const stageProcessed = new Map<number, number>();
const stageLatency = new Map<number, number>();
const stageUpdated = new Map<number, string>();
const worldCache = new Map<string, WorldState>();
let deps: RuntimeDeps = {
  getAuto: () => true,
  setAuto: () => undefined,
  getRiskLimit: () => SYSTEM.safety.defaultRiskPct,
  getPositions: () => positions,
};

function emit(type: TradingEvent['type'], symbol: string | undefined, payload: Record<string, unknown>, stage: number) {
  const event: TradingEvent = {
    id: `wf-${cycle}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    symbol,
    at: iso(),
    payload: { ...payload, stage },
  };
  eventBus.emit(event);
  queueDepth = Math.max(0, eventBus.recent(50).length % 9);
  lastHeartbeat = iso();
}

function ensureWorld(symbol: string) {
  const instrument = resolveInstrument(symbol);
  const existing = worldCache.get(symbol);
  if (existing && Date.now() - existing.updatedAt < 800) return { instrument, world: existing };
  const world = createWorldState(instrument);
  worldCache.set(symbol, world);
  return { instrument, world };
}

function riskFor(instrument: Instrument) {
  const openRisk = deps
    .getPositions()
    .filter((p) => p.status === 'ACTIVE')
    .reduce((a, p) => a + p.risk, 0);
  return qualifyRisk({
    setupScore: instrument.score,
    spreadOk: instrument.spread <= (instrument.kind === 'GOLD' ? 3 : 2.5),
    volatilityOk: Math.abs(instrument.change) < 1.5,
    rr: instrument.state === 'READY' ? 2.2 : 1.6,
    portfolioHeat: openRisk,
    clusterExposure: instrument.symbol.includes('USD') ? 1.1 : 0.4,
    riskPerTrade: deps.getRiskLimit(),
  });
}

function buildTrace(symbol: string): { trace: InstrumentTrace; world: WorldModelRecord } {
  const { instrument, world } = ensureWorld(symbol);
  const risk = riskFor(instrument);
  const open = deps.getPositions().some((p) => p.symbol === symbol && p.status === 'ACTIVE');
  const approved = open || risk.approved || (instrument.state === 'READY' && instrument.score >= 84);
  const decision = mapDecision(instrument, approved, open);
  const stage = currentStage(instrument, approved, open);
  const confidence = Math.round((instrument.confidence + world.d1.confidence + world.h8.confidence) / 3);

  const trace: InstrumentTrace = {
    symbol,
    assetClass: instrument.kind === 'GOLD' ? 'METAL' : 'FX',
    macro:
      world.macro.bias === 'BULLISH' || world.macro.bias === 'BEARISH' || world.macro.bias === 'NEUTRAL'
        ? world.macro.bias
        : 'NEUTRAL',
    regime: world.regime.state,
    d1: world.d1.direction === 'BULLISH' ? 'ASCENDING' : world.d1.direction === 'BEARISH' ? 'DESCENDING' : 'RANGE',
    h8: world.h8.direction === 'BULLISH' ? 'ASCENDING' : world.h8.direction === 'BEARISH' ? 'DESCENDING' : 'RANGE',
    h1: mapH1(world.h1.phase),
    risk: approved ? 'PASS' : risk.reasons[0] ? 'BLOCK' : 'WATCH',
    decision,
    confidence,
    updatedAt: new Date(world.updatedAt).toISOString(),
    stage,
  };

  const heat = deps.getPositions().filter((p) => p.status === 'ACTIVE').reduce((a, p) => a + p.risk, 0);
  const available = Math.max(0, +(SYSTEM.safety.dailyLossLimitPct - heat).toFixed(2));

  const record: WorldModelRecord = {
    symbol,
    bid: instrument.bid,
    ask: instrument.ask,
    spread: instrument.spread,
    strength: world.macro.bias,
    regime: world.regime.state,
    d1: trace.d1,
    h8: trace.h8,
    h1: trace.h1,
    exposure: heat > 1.5 ? 'HIGH' : heat > 0.6 ? 'MODERATE' : 'LOW',
    riskAvailable: available,
    decision,
    confidence,
    version: cycle,
    updatedAt: trace.updatedAt,
  };

  return { trace, world: record };
}

function stageStatus(id: number, traces: InstrumentTrace[]): StageStatus {
  if (monitoringPaused) return 'paused';
  if ((stageFailures.get(id) ?? 0) > 4) return 'error';
  if (id === 9 && !executionEnabled) return 'blocked';
  if (id === 9 && !deps.getAuto()) return 'waiting';
  if (id >= 8 && traces.every((t) => t.decision === 'WAIT' || t.decision === 'BLOCKED')) return 'waiting';
  const active = traces.filter((t) => t.stage >= id).length;
  if (active === 0 && id > 4) return 'waiting';
  return 'running';
}

function buildStages(traces: InstrumentTrace[]): StageRuntime[] {
  const now = iso();
  return STAGE_DEFINITIONS.map((def) => {
    const id = def.id;
    const related = traces.filter((t) => t.stage >= id || id <= 2);
    const confidence = related.length
      ? Math.round(related.reduce((a, t) => a + t.confidence, 0) / related.length)
      : 70;
    const latency =
      stageLatency.get(id) ??
      Math.max(12, Math.min(def.slaMs, Math.round(def.slaMs * (0.35 + (cycle % 7) * 0.05))));
    const freshness = Math.max(
      0,
      Math.round((Date.now() - new Date(stageUpdated.get(id) ?? now).getTime()) / 1000),
    );
    const processed = stageProcessed.get(id) ?? cycle * allPairs.length + id * 11;
    const failed = stageFailures.get(id) ?? 0;
    const status = stageStatus(id, traces);

    const input =
      id === 1
        ? ['Broker/feed adapter', `Universe ${SYSTEM.universe.total} instruments`, `Mode ${SYSTEM.mode}`]
        : [
            `Stage ${id - 1} committed output`,
            `Market World Model v${cycle}`,
            'Orchestrator freshness check',
          ];

    const output =
      id === 1
        ? ['Validated bid/ask/spread snapshot', 'Session & quality flags']
        : id === 2
          ? ['Currency & XAU strength matrix']
          : id === 3
            ? ['Regime classification & persistence']
            : id === 4
              ? ['Ranked 29-instrument candidate list']
              : id === 5
                ? ['D1/H8 channel vision state']
                : id === 6
                  ? ['Structural directional bias']
                  : id === 7
                    ? ['H1 BOS/CHoCH confirmation state']
                    : id === 8
                      ? ['Qualified / rejected setups', 'Risk budget allocation']
                      : id === 9
                        ? executionEnabled
                          ? ['Position/order management state']
                          : ['Execution gated (fail-closed)']
                        : ['Decision audit & calibration feedback'];

    const message =
      status === 'paused'
        ? 'Monitoring paused — observation queues held'
        : status === 'blocked'
          ? 'Execution permission disabled — fail-closed'
          : status === 'waiting'
            ? 'Awaiting qualifying upstream event'
            : status === 'error'
              ? 'Stage degraded — retries in progress'
              : 'Processing current market state';

    return {
      id,
      name: def.name,
      status,
      confidence,
      latencyMs: latency,
      freshnessSec: freshness,
      input,
      output,
      message,
      updatedAt: stageUpdated.get(id) ?? now,
      processed,
      failed,
    };
  });
}

let seeded = false;
function toWorkflowEvents(): WorkflowEvent[] {
  if (!seeded) {
    seeded = true;
    emit('TICK', undefined, { detail: 'Workflow engine attached to Market World Model' }, 1);
    emit('STRENGTH_CHANGE', undefined, { detail: 'Currency & XAU strength matrix loaded' }, 2);
    emit('H8_CLOSE', allPairs[0], { detail: 'HTF vision refresh for primary instruments' }, 5);
  }

  return eventBus.recent(45).map((e, i) => {
    const stage = typeof e.payload.stage === 'number' ? e.payload.stage : 1 + (i % 10);
    const severity: WorkflowEvent['severity'] =
      e.type === 'SPREAD_SPIKE' || e.type === 'RISK_EVENT'
        ? 'warning'
        : e.type === 'CHANNEL_BREAK' || e.type === 'POSITION_EVENT'
          ? 'success'
          : 'info';
    return {
      id: e.id,
      time: e.at,
      severity,
      stage,
      symbol: e.symbol,
      event: e.type,
      detail:
        typeof e.payload.detail === 'string'
          ? e.payload.detail
          : typeof e.payload.reason === 'string'
            ? e.payload.reason
            : 'World model / stage state updated',
      latencyMs: typeof e.payload.latencyMs === 'number' ? e.payload.latencyMs : 20 + ((i * 11) % 180),
    };
  });
}

function evaluateExecutionPermission(): { permitted: boolean; reason: string } {
  if (brokerGateway.mode === 'LIVE') {
    return { permitted: false, reason: 'Live broker adapter not configured — fail-closed' };
  }
  if (!deps.getAuto()) {
    return { permitted: false, reason: 'Autonomous trading paused — new executions disabled' };
  }
  const gates: GateResult[] = allPairs.slice(0, 8).map((symbol, idx) => {
    const { instrument, world } = ensureWorld(symbol);
    const risk = riskFor(instrument);
    const pass = world.dataQuality > 99 && (risk.approved || instrument.score >= 80) && world.updatedAt > Date.now() - 60_000;
    return {
      pass: idx === 0 ? world.dataQuality > 99 : pass || instrument.state !== 'BLOCKED',
      stage: risk.approved ? 8 : 7,
      reason: risk.approved ? 'Risk approved' : risk.reasons[0] ?? 'Awaiting confirmation',
      confidence: instrument.confidence,
    };
  });
  const freshnessGate: GateResult = {
    pass: [...worldCache.values()].every((w) => Date.now() - w.updatedAt < 120_000) || worldCache.size === 0,
    stage: 1,
    reason: 'Upstream market data freshness',
    confidence: 98,
  };
  const result = executionGate([freshnessGate, ...gates.slice(0, 3)]);
  return { permitted: result.permitted, reason: result.reason };
}

export function bindWorkflowDeps(next: RuntimeDeps) {
  deps = next;
}

export function getWorkflowSnapshot(): WorkflowSnapshot {
  cycle += 1;
  lastHeartbeat = iso();

  // Keep world model warm for the full universe each refresh.
  const built = allPairs.map((symbol) => buildTrace(symbol));
  const instrumentRows = built.map((b) => b.trace);
  const worldRows = built.map((b) => b.world);
  const stages = buildStages(instrumentRows);

  // Light autonomous tick while monitoring is active — keeps telemetry alive without mutating trading logic.
  if (!monitoringPaused && cycle % 4 === 0) {
    const routed = routeEvent('TICK' as MarketEvent);
    emit('TICK', instrumentRows[cycle % instrumentRows.length]?.symbol, {
      detail: `Orchestrator routed ${routed.event} → stages ${routed.stages.join(',')}`,
      latencyMs: 18 + (cycle % 40),
      stages: routed.stages,
    }, routed.stages[0] ?? 1);
  }

  const throughput = Math.round(90 + instrumentRows.filter((t) => t.stage >= 5).length * 3 + (deps.getAuto() ? 20 : 0));

  return {
    stages,
    instruments: instrumentRows,
    events: toWorkflowEvents(),
    world: worldRows,
    engine: {
      running: !monitoringPaused,
      executionEnabled,
      mode: SYSTEM.mode,
      cycle,
      lastHeartbeat,
      queueDepth,
      throughput,
      errors,
    },
  };
}

export const workflowActions = {
  pause() {
    monitoringPaused = true;
    emit('RISK_EVENT', undefined, { detail: 'Workflow monitoring paused' }, 10);
  },
  resume() {
    monitoringPaused = false;
    emit('TICK', undefined, { detail: 'Workflow monitoring resumed' }, 1);
  },
  setExecution(enabled: boolean) {
    if (enabled) {
      const gate = evaluateExecutionPermission();
      if (!gate.permitted) {
        executionEnabled = false;
        errors += 1;
        emit('RISK_EVENT', undefined, { detail: `Execution denied: ${gate.reason}`, reason: gate.reason }, 9);
        return;
      }
      executionEnabled = true;
      // Align with existing autonomous flag when user explicitly enables execution.
      if (!deps.getAuto()) deps.setAuto(true);
      emit('POSITION_EVENT', undefined, { detail: 'Execution permission enabled (simulation fail-closed gates passed)' }, 9);
    } else {
      executionEnabled = false;
      emit('RISK_EVENT', undefined, { detail: 'Execution permission revoked' }, 9);
    }
  },
  reevaluate(symbol?: string) {
    const targets = symbol ? [symbol] : allPairs.slice(0, 8);
    for (const s of targets) {
      worldCache.delete(s);
      const { instrument, world } = ensureWorld(s);
      const risk = riskFor(instrument);
      const routed = routeEvent('H1_CLOSE');
      for (const stage of routed.stages) {
        stageProcessed.set(stage, (stageProcessed.get(stage) ?? 0) + 1);
        stageUpdated.set(stage, iso());
        stageLatency.set(stage, 20 + (hash(s + stage) % 90));
      }
      decisionAudit.append({
        id: `audit-${s}-${Date.now()}`,
        symbol: s,
        decision: instrument.state === 'READY' && risk.approved ? 'QUALIFIED' : instrument.state === 'BLOCKED' ? 'BLOCKED' : 'WAIT',
        reason: risk.approved ? 'Re-evaluation passed risk gates' : risk.reasons[0] ?? 'Awaiting confirmation',
        confidence: instrument.confidence,
        evidence: [
          { source: 'worldModel', value: world.macro.bias, confidence: world.d1.confidence, timestamp: iso() },
          { source: 'risk', value: risk.approved, confidence: instrument.score, timestamp: iso() },
        ],
        createdAt: iso(),
      });
      emit('H1_CLOSE', s, {
        detail: `Re-evaluated ${s} · stages ${routed.stages.join(',')}`,
        latencyMs: stageLatency.get(routed.stages[0] ?? 7),
      }, routed.stages[0] ?? 7);
    }
    cycle += 2;
  },
  retry(stage: number) {
    stageFailures.set(stage, Math.max(0, (stageFailures.get(stage) ?? 1) - 1));
    stageProcessed.set(stage, (stageProcessed.get(stage) ?? 0) + allPairs.length);
    stageUpdated.set(stage, iso());
    stageLatency.set(stage, 15 + (stage * 9) % 60);
    const event: MarketEvent =
      stage <= 1 ? 'TICK' : stage <= 4 ? 'MONTH_CLOSE' : stage <= 6 ? 'H8_CLOSE' : stage <= 8 ? 'H1_CLOSE' : 'POSITION_EVENT';
    const routed = routeEvent(event);
    emit(event === 'MONTH_CLOSE' ? 'MN_CLOSE' : event, undefined, {
      detail: `Stage ${stage} retry · orchestrator ${routed.event}`,
      latencyMs: stageLatency.get(stage),
    }, stage);
    cycle += 1;
  },
};
