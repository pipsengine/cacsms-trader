import { allPairs, instruments, positions } from '../../../data/market';
import type { Instrument } from '../../../types';
import { createWorldState, type WorldState } from '../../../engine/worldModel';
import { executionGate, routeEvent, type GateResult, type MarketEvent } from '../../../engine/orchestrator';
import { qualifyRisk } from '../../../engine/risk';
import { eventBus, type TradingEvent } from '../../../services/eventBus';
import { decisionAudit } from '../../../services/decisionAudit';
import { brokerGateway, type GatewayMode } from '../../../services/brokerGateway';
import { SYSTEM } from '../../../config/system';
import { assertExecutionSafe } from '../../mt5-connection/services/mt5ConnectionAdapter';
import { getMT5Snapshot, getStage9ExecutionSummary } from '../../mt5-connection/services/cacsmsMT5Runtime';
import { assessInstrument } from '../../market-data/services/stage1Gate';
import { getHistorySnapshot, historyReadyCount } from '../../market-data/services/historyStore';
import { STAGE_DEFINITIONS } from '../data/stageDefinitions';
import { getPairRegime, getRegimeSnapshot, regimeRunAgeMs, regimeStageStatus } from '../../historical-regime/services/regimeStore';
import type { RegimeStageStatus } from '../../historical-regime/types';
import { stage2Output } from '../../currency-strength/services/strengthStage';
import type { DataState } from '../../currency-strength/services/strengthModel';
import { getVisionSnapshot, visionRunAgeMs, visionStageStatus, type VisionStageStatus } from '../../htf-vision/services/visionStore';
import { stage5Output } from '../../htf-vision/services/visionStage';
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

/** Resolve instrument from persisted market state — never invent mock quotes. */
export function resolveInstrument(symbol: string): Instrument {
  const existing = instruments.find((i) => i.symbol === symbol);
  if (existing) return existing;

  const gold = symbol === 'XAUUSD';
  return {
    symbol,
    kind: gold ? 'GOLD' : 'FX',
    bid: 0,
    ask: 0,
    spread: 0,
    change: 0,
    d1: 'NEUTRAL',
    h8: 'NEUTRAL',
    h1: 'Waiting',
    score: 0,
    state: 'WAIT',
    strengthDiff: 0,
    channelPos: 50,
    confidence: 0,
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
  const stage1 = assessInstrument(i);
  if (!stage1.pass || i.state === 'BLOCKED') return 'BLOCKED';
  if (i.state === 'READY' && riskApproved) return 'READY';
  return 'WAIT';
}

function resolveEngineMode(): GatewayMode {
  const mt5 = getMT5Snapshot();
  const connected = mt5.accounts.filter((a) => a.state === 'HEALTHY' || a.state === 'DEGRADED');
  if (!connected.length) {
    brokerGateway.mode = 'SIMULATION';
    return 'SIMULATION';
  }
  if (connected.some((a) => a.accountClass === 'LIVE')) {
    brokerGateway.mode = 'LIVE';
    return 'LIVE';
  }
  brokerGateway.mode = 'PAPER';
  return 'PAPER';
}

function feedLatencyMs(): number {
  const ms = getMT5Snapshot().health.feedLatencyMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
}

function eventsPerMinute(): number {
  const cutoff = Date.now() - 60_000;
  return eventBus.recent(1000).filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= cutoff;
  }).length;
}

function pushStageLatency(id: number, ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  stageLatency.set(id, Math.round(ms));
  const hist = stageLatencyHistory.get(id) ?? [];
  hist.push(Math.round(ms));
  stageLatencyHistory.set(id, hist.slice(-12));
}

const REGIME_STAGE_STATUS: Record<RegimeStageStatus, StageStatus> = {
  WAITING: 'waiting',
  'WARMING UP': 'warming',
  RUNNING: 'running',
  HEALTHY: 'healthy',
  STALE: 'stale',
  BLOCKED: 'blocked',
  ERROR: 'error',
};

const STRENGTH_STAGE_STATUS: Record<DataState, StageStatus> = {
  LOADING: 'waiting',
  DISCONNECTED: 'error',
  ERROR: 'error',
  EMPTY: 'waiting',
  WARMING_UP: 'warming',
  STALE: 'stale',
  CURRENT: 'healthy',
};

const VISION_STAGE_STATUS: Record<VisionStageStatus, StageStatus> = {
  WAITING: 'waiting',
  HEALTHY: 'healthy',
  DEGRADED: 'running',
  STALE: 'stale',
  ERROR: 'error',
};

function regimeLabel(symbol: string): string {
  const p = getPairRegime(symbol);
  if (!p) return getRegimeSnapshot().state ? 'NO DATA' : 'WAITING';
  if (p.status !== 'READY') return 'WARMING UP';
  return p.conviction != null ? `${p.bias} · ${Math.round(p.conviction)}` : p.bias;
}

function regimeStageDetail() {
  const snap = getRegimeSnapshot();
  const s = snap.state;
  const assets = s?.assets ?? [];
  const classified = assets.filter((a) => a.latest?.regime);
  const pairsReady = (s?.pairs ?? []).filter((p) => p.status === 'READY').length;
  const confidence = classified.length
    ? Math.round(classified.reduce((a, x) => a + (x.latest?.confidence ?? 0), 0) / classified.length)
    : 0;
  const obs = assets.map((a) => a.observations);
  const minObs = obs.length ? Math.min(...obs.map((o) => o.collected)) : 0;
  const required = obs[0]?.required ?? 0;
  const age = regimeRunAgeMs(snap);
  return {
    status: regimeStageStatus(snap),
    classified: classified.length,
    total: assets.length,
    pairsReady,
    pairsTotal: s?.pairs.length ?? 0,
    transitions: s?.transitions.length ?? 0,
    confidence,
    minObs,
    required,
    bars: assets[0]?.bars.collected ?? null,
    latency: snap.lastRunLatencyMs ?? s?.run?.durationMs ?? 0,
    freshnessSec: age == null ? 0 : Math.round(age / 1000),
    updatedAt: s?.run?.runAt,
    message: snap.error || s?.run?.message || '',
  };
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
let errors = 0;
const stageFailures = new Map<number, number>();
const stageProcessed = new Map<number, number>();
const stageLatency = new Map<number, number>();
const stageLatencyHistory = new Map<number, number[]>();
const stageUpdated = new Map<number, string>();
const worldCache = new Map<string, WorldState>();
let deps: RuntimeDeps = {
  getAuto: () => true,
  setAuto: () => undefined,
  getRiskLimit: () => SYSTEM.safety.defaultRiskPct,
  getPositions: () => positions,
};

/**
 * Candle closes persisted by the historical synchronizer and Stage 2 strength publications advance
 * the stages the orchestrator routes them to.
 */
(
  [
    'MN_CLOSE',
    'W1_CLOSE',
    'D1_CLOSE',
    'H8_CLOSE',
    'H1_CLOSE',
    'M15_CLOSE',
    'M5_CLOSE',
    'DATA_EVENT',
    'STRENGTH_CHANGE',
    'STRUCTURE_CHANGE',
    'CHANNEL_APPROACH',
    'CHANNEL_BREAK',
  ] as const
).forEach((type) =>
  eventBus.on(type, (e) => {
    const src = e.payload.source;
    if ((src !== 'history' && src !== 'strength' && src !== 'vision') || !Array.isArray(e.payload.stages)) return;
    for (const stage of e.payload.stages as number[]) {
      stageProcessed.set(stage, (stageProcessed.get(stage) ?? 0) + 1);
      stageUpdated.set(stage, e.at);
    }
  }),
);

function emit(type: TradingEvent['type'], symbol: string | undefined, payload: Record<string, unknown>, stage: number) {
  const event: TradingEvent = {
    id: `wf-${cycle}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    symbol,
    at: iso(),
    payload: { ...payload, stage },
  };
  eventBus.emit(event);
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

  const stage1 = assessInstrument(instrument);
  const riskLabel = !stage1.pass
    ? `S1 ${stage1.quality}`
    : approved
      ? 'PASS'
      : risk.reasons[0]
        ? 'BLOCK'
        : 'WATCH';
  const trace: InstrumentTrace = {
    symbol,
    assetClass: instrument.kind === 'GOLD' ? 'METAL' : 'FX',
    macro:
      world.macro.bias === 'BULLISH' || world.macro.bias === 'BEARISH' || world.macro.bias === 'NEUTRAL'
        ? world.macro.bias
        : 'NEUTRAL',
    regime: regimeLabel(symbol),
    d1: world.d1.direction === 'BULLISH' ? 'ASCENDING' : world.d1.direction === 'BEARISH' ? 'DESCENDING' : 'RANGE',
    h8: world.h8.direction === 'BULLISH' ? 'ASCENDING' : world.h8.direction === 'BEARISH' ? 'DESCENDING' : 'RANGE',
    h1: mapH1(world.h1.phase),
    risk: riskLabel,
    decision,
    confidence,
    updatedAt: new Date(world.updatedAt).toISOString(),
    stage: !stage1.pass ? 1 : stage,
  };

  const heat = deps.getPositions().filter((p) => p.status === 'ACTIVE').reduce((a, p) => a + p.risk, 0);
  const available = Math.max(0, +(SYSTEM.safety.dailyLossLimitPct - heat).toFixed(2));

  const record: WorldModelRecord = {
    symbol,
    bid: instrument.bid,
    ask: instrument.ask,
    spread: instrument.spread,
    strength: world.macro.bias,
    regime: trace.regime,
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

  if (id === 1) {
    if (!instruments.length) return 'waiting';
    const liveQuotes = instruments.filter((i) => i.bid > 0 && i.ask > 0).length;
    if (!liveQuotes) return 'waiting';
    const pass = instruments.filter((i) => assessInstrument(i).pass).length;
    if (pass === 0) return 'blocked';
    return 'running';
  }

  if (id === 2) return STRENGTH_STAGE_STATUS[stage2Output().state];
  if (id === 3) return REGIME_STAGE_STATUS[regimeStageStatus()];
  if (id === 5) return VISION_STAGE_STATUS[visionStageStatus()];

  if (id === 9 && !executionEnabled) return 'blocked';
  if (id === 9 && !deps.getAuto()) return 'waiting';
  if (id >= 8 && traces.every((t) => t.decision === 'WAIT' || t.decision === 'BLOCKED')) return 'waiting';
  const active = traces.filter((t) => t.stage >= id).length;
  if (active === 0 && id > 4) return 'waiting';
  // Downstream stages wait while Stage 1 has no pass-through instruments.
  if (id > 1 && traces.every((t) => t.decision === 'BLOCKED' && t.stage <= 1)) return 'waiting';
  return 'running';
}

function buildStages(traces: InstrumentTrace[]): StageRuntime[] {
  const now = iso();
  const feedMs = feedLatencyMs();
  const mode = resolveEngineMode();
  const liveCount = instruments.filter((i) => i.bid > 0 && i.ask > 0).length;
  const stage1Pass = instruments.filter((i) => assessInstrument(i).pass).length;
  const hist = historyReadyCount();
  const histStatus = getHistorySnapshot().status;
  const histLabel = histStatus
    ? `History READY ${hist.ready}/${hist.total} · series ${histStatus.summary.ready}/${histStatus.summary.series}`
    : 'History status loading';

  if (feedMs > 0) pushStageLatency(1, feedMs);

  return STAGE_DEFINITIONS.map((def) => {
    const id = def.id;
    const related = traces.filter((t) => (id === 1 ? true : t.stage >= id));
    const confidence = related.length
      ? Math.round(related.reduce((a, t) => a + t.confidence, 0) / related.length)
      : 0;
    const latency = stageLatency.get(id) ?? (id === 1 ? feedMs : 0);
    const freshness = Math.max(
      0,
      Math.round((Date.now() - new Date(stageUpdated.get(id) ?? now).getTime()) / 1000),
    );
    const processed =
      stageProcessed.get(id) ??
      (id === 1 ? liveCount : related.filter((t) => t.decision !== 'BLOCKED' || t.stage >= id).length);
    const failed = stageFailures.get(id) ?? 0;
    const status = stageStatus(id, traces);

    const input =
      id === 1
        ? [
            'Broker/MT5 feed adapter',
            `Live quotes ${liveCount}/${allPairs.length}`,
            histStatus ? `Historical store ${histStatus.summary.candles.toLocaleString()} candles` : 'Historical store —',
            `Mode ${mode}`,
          ]
        : [
            `Stage ${id - 1} committed output`,
            `Market World Model v${cycle}`,
            'Orchestrator freshness check',
          ];

    const output =
      id === 1
        ? [
            `Validated snapshots ${liveCount}`,
            histLabel,
            `Stage 1 pass ${stage1Pass}/${allPairs.length}`,
          ]
        : id === 2
          ? ['Currency & XAU strength matrix']
          : id === 3
            ? ['Regime classification & persistence']
            : id === 4
              ? [`Ranked ${allPairs.length}-instrument candidate list`]
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
          ? id === 1
            ? stage1Pass === 0 && liveCount > 0
              ? hist.ready === 0
                ? `Stage 1 fail-closed — ${histLabel}; no instrument has complete, valid, fresh history`
                : 'Stage 1 fail-closed — no valid+fresh instrument'
              : 'Execution permission disabled — fail-closed'
            : 'Execution permission disabled — fail-closed'
          : status === 'waiting'
            ? 'Awaiting qualifying upstream event'
            : status === 'error'
              ? 'Stage degraded — retries in progress'
              : 'Processing current market state';

    stageUpdated.set(id, stageUpdated.get(id) ?? now);

    if (id === 2 && status !== 'paused') {
      const s2 = stage2Output();
      const r = regimeStageDetail();
      const ready = s2.assets.filter((a) => a.composite != null);
      const s2Conf = ready.length ? Math.round(ready.reduce((a, x) => a + (x.confidence ?? 0), 0) / ready.length) : 0;
      return {
        id,
        name: def.name,
        status,
        confidence: s2Conf,
        latencyMs: r.latency,
        latencyHistory: stageLatencyHistory.get(3) ?? (r.latency > 0 ? [r.latency] : []),
        freshnessSec: r.freshnessSec,
        input: [
          'MT5 D1 closes · 28 FX + XAUUSD (Stage 1 history)',
          'Basket-relative Q63/M21/W5/D1 returns',
          s2.obsDate ? `Latest closed D1 ${s2.obsDate}` : 'Latest closed D1 —',
        ],
        output: [
          `Strength ${ready.length}/9 assets · macro (Q+M) + current (W+D)`,
          s2.strongest && s2.weakest
            ? `Strongest ${s2.strongest} · weakest ${s2.weakest} · spread ${s2.spread?.toFixed(2)}`
            : 'Strong/weak spread —',
          `Differentials ${s2.pairs.filter((p) => p.differential != null).length}/${s2.pairs.length} → Historical Regime, Market Scanner`,
        ],
        message:
          status === 'waiting'
            ? 'Awaiting first strength snapshot from the MT5 bridge'
            : status === 'warming'
              ? 'Warming up — collecting closed D1 observations; no strength fabricated'
              : status === 'stale'
                ? `Strength output stale — last D1 close ${s2.obsDate ?? '—'}`
                : status === 'error'
                  ? r.message || 'Strength engine unavailable'
                  : 'Strength matrix current',
        updatedAt: r.updatedAt ?? now,
        processed: stageProcessed.get(2) ?? ready.length,
        failed,
      };
    }

    if (id === 3 && status !== 'paused') {
      const r = regimeStageDetail();
      if (r.latency > 0 && stageLatency.get(3) !== r.latency) pushStageLatency(3, r.latency);
      const updatedAt = r.updatedAt ?? now;
      return {
        id,
        name: def.name,
        status,
        confidence: r.confidence,
        latencyMs: r.latency,
        latencyHistory: stageLatencyHistory.get(3) ?? (r.latency > 0 ? [r.latency] : []),
        freshnessSec: r.freshnessSec,
        input: [
          'Stage 2 strength trajectories · 8 currencies + XAU',
          r.bars != null ? `D1 bars ${r.bars}` : 'D1 bars —',
          `Closed observations ${r.minObs}/${r.required} required`,
        ],
        output: [
          `Regimes ${r.classified}/${r.total || 9} assets`,
          `Pair intelligence ${r.pairsReady}/${r.pairsTotal} → Market Scanner`,
          `Transitions recorded ${r.transitions}`,
        ],
        message:
          status === 'waiting'
            ? 'Awaiting first regime run from the MT5 bridge'
            : status === 'warming'
              ? `Warming up — ${r.minObs}/${r.required} closed observations; no classification fabricated`
              : status === 'stale'
                ? `Regime output stale (${r.freshnessSec}s since last run)`
                : r.message || 'Regime classification current',
        updatedAt,
        processed: r.classified,
        failed,
      };
    }

    if (id === 5 && status !== 'paused') {
      const snap = getVisionSnapshot();
      const s5 = stage5Output();
      const run = snap.state?.run;
      const ready = s5.instruments.filter((v) => v.status === 'READY');
      const scored = ready.filter((v) => v.d1?.confirmed);
      const conf = scored.length ? Math.round(scored.reduce((a, v) => a + v.confidence, 0) / scored.length) : 0;
      const lat = run?.durationMs ?? 0;
      if (lat > 0 && stageLatency.get(5) !== lat) pushStageLatency(5, lat);
      const age = visionRunAgeMs(snap);
      const breaks = s5.instruments.filter((v) => v.d1?.breakout || v.h8?.breakout).length;
      return {
        id,
        name: def.name,
        status,
        confidence: conf,
        latencyMs: lat,
        latencyHistory: stageLatencyHistory.get(5) ?? (lat > 0 ? [lat] : []),
        freshnessSec: age == null ? 0 : Math.round(age / 1000),
        input: [
          `Market Scanner qualified ${s5.qualified}/${s5.instruments.length || allPairs.length}`,
          'Stage 1 validated D1/H8 closed candles',
          run?.triggers?.length ? `Triggers ${run.triggers.slice(0, 3).join(', ')}` : 'Triggers —',
        ],
        output: [
          `Confirmed D1 channels ${s5.confirmedD1} · READY ${ready.length}/${s5.instruments.length}`,
          `D1/H8 agree ${s5.agree} · conflict ${s5.conflict} · breakouts ${breaks}`,
          'Channel, phase, position, confidence → Structural Direction',
        ],
        message:
          status === 'waiting'
            ? 'Awaiting first HTF Market Vision run from the MT5 bridge'
            : status === 'stale'
              ? `Vision output stale (${age == null ? '—' : Math.round(age / 60000)}m since last run)`
              : status === 'error'
                ? snap.error || 'Vision engine unavailable'
                : run?.message || 'Channel structure current',
        updatedAt: run?.runAt ?? now,
        processed: stageProcessed.get(5) ?? s5.instruments.length,
        failed: failed + (run?.failedNow ?? 0),
      };
    }

    return {
      id,
      name: def.name,
      status,
      confidence,
      latencyMs: latency,
      latencyHistory: stageLatencyHistory.get(id) ?? (latency > 0 ? [latency] : []),
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
    emit('TICK', undefined, { detail: 'Workflow engine attached — awaiting DB/MT5 market state' }, 1);
  }

  return eventBus.recent(45).map((e) => {
    const stage = typeof e.payload.stage === 'number' ? e.payload.stage : 1;
    const histSeverity = e.payload.source === 'history' ? e.payload.severity : undefined;
    const severity: WorkflowEvent['severity'] =
      histSeverity === 'ERROR'
        ? 'error'
        : histSeverity === 'WARNING' || e.type === 'SPREAD_SPIKE' || e.type === 'RISK_EVENT'
          ? 'warning'
          : e.type === 'CHANNEL_BREAK' || e.type === 'POSITION_EVENT'
            ? 'success'
            : 'info';
    const latencyMs = typeof e.payload.latencyMs === 'number' ? e.payload.latencyMs : undefined;
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
      ...(latencyMs != null ? { latencyMs } : {}),
    };
  });
}

function evaluateExecutionPermission(): { permitted: boolean; reason: string } {
  if (!deps.getAuto()) {
    return { permitted: false, reason: 'Autonomous trading paused — new executions disabled' };
  }

  const mt5 = getMT5Snapshot();
  const stage9 = getStage9ExecutionSummary();
  if (stage9.orderGateway !== 'READY' || !stage9.globalTradingEnabled) {
    return { permitted: false, reason: 'MT5 Stage 9 gateway not ready — fail-closed' };
  }
  const eligible = mt5.accounts.find((a) => assertExecutionSafe(mt5, a.id).ok);
  if (!eligible) {
    return { permitted: false, reason: 'No MT5 account passes Stage 9 execution safety checks' };
  }
  if (brokerGateway.mode === 'LIVE' && eligible.accountClass === 'LIVE') {
    return { permitted: false, reason: 'Live broker bridge not configured — fail-closed' };
  }

  // Stage 1: at least one instrument must pass market-data freshness/validity (instrument-scoped).
  const stage1Pass = instruments.some((i) => assessInstrument(i).pass);
  if (instruments.length && !stage1Pass) {
    return { permitted: false, reason: 'Stage 1 BLOCKED — no instrument has valid+fresh market data' };
  }

  const gates: GateResult[] = allPairs.map((symbol) => {
    const { instrument, world } = ensureWorld(symbol);
    const risk = riskFor(instrument);
    const s1 = assessInstrument(instrument);
    const pass =
      s1.pass &&
      world.dataQuality > 0 &&
      (risk.approved || instrument.score >= 80) &&
      world.updatedAt > Date.now() - 60_000;
    return {
      pass: s1.pass && world.dataQuality > 0 && (pass || instrument.state !== 'BLOCKED'),
      stage: !s1.pass ? 1 : risk.approved ? 8 : 7,
      reason: !s1.pass ? s1.reason : risk.approved ? 'Risk approved' : risk.reasons[0] ?? 'Awaiting confirmation',
      confidence: instrument.confidence,
    };
  });
  const freshnessGate: GateResult = {
    pass: [...worldCache.values()].every((w) => Date.now() - w.updatedAt < 120_000) || worldCache.size === 0,
    stage: 1,
    reason: 'Upstream market data freshness',
    confidence: 98,
  };
  const mt5Gate: GateResult = {
    pass: true,
    stage: 9,
    reason: `MT5 account ${eligible.name} ready (${eligible.currency})`,
    confidence: 94,
  };
  const result = executionGate([freshnessGate, ...gates.filter((g) => g.pass).slice(0, 3), mt5Gate]);
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

  const liveCount = instruments.filter((i) => i.bid > 0 && i.ask > 0).length;
  stageProcessed.set(1, liveCount);
  stageUpdated.set(1, iso());
  const feedMs = feedLatencyMs();
  if (feedMs > 0) pushStageLatency(1, feedMs);

  const stages = buildStages(instrumentRows);
  const recent = eventBus.recent(50);
  const queueDepth = recent.filter((e) => Date.now() - Date.parse(e.at) < 5_000).length;

  return {
    stages,
    instruments: instrumentRows,
    events: toWorkflowEvents(),
    world: worldRows,
    engine: {
      running: !monitoringPaused,
      executionEnabled,
      mode: resolveEngineMode(),
      cycle,
      lastHeartbeat,
      queueDepth,
      throughput: eventsPerMinute(),
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
    const targets = symbol ? [symbol] : [...allPairs];
    const started = performance.now();
    for (const s of targets) {
      worldCache.delete(s);
      const { instrument, world } = ensureWorld(s);
      const risk = riskFor(instrument);
      const routed = routeEvent('H1_CLOSE');
      const elapsed = Math.max(0, Math.round(performance.now() - started));
      for (const stage of routed.stages) {
        stageProcessed.set(stage, (stageProcessed.get(stage) ?? 0) + 1);
        stageUpdated.set(stage, iso());
        pushStageLatency(stage, elapsed || feedLatencyMs());
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
    const started = performance.now();
    stageFailures.set(stage, Math.max(0, (stageFailures.get(stage) ?? 1) - 1));
    stageProcessed.set(stage, (stageProcessed.get(stage) ?? 0) + allPairs.length);
    stageUpdated.set(stage, iso());
    pushStageLatency(stage, Math.max(0, Math.round(performance.now() - started)) || feedLatencyMs());
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
