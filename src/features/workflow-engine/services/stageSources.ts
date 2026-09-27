import { instruments } from '../../../data/market';
import { getMT5Snapshot } from '../../mt5-connection/services/cacsmsMT5Runtime';
import { getHistorySnapshot } from '../../market-data/services/historyStore';
import { executionStageStatus, getExecutionSnapshot } from '../../execution/services/executionStore';
import { getRegimeSnapshot, regimeStageStatus } from '../../historical-regime/services/regimeStore';
import { stage2Output } from '../../currency-strength/services/strengthStage';
import { getScannerSnapshot, scannerStageStatus } from '../../market-scanner/services/scannerStore';
import { getVisionSnapshot, visionStageStatus } from '../../htf-vision/services/visionStore';
import { directionStageStatus, getDirectionSnapshot } from '../../structural-direction/services/directionStore';
import { getH1Snapshot, h1StageStatus } from '../../h1-confirmation/services/confirmStore';
import { getRiskSnapshot, riskStageStatus } from '../../opportunity-risk/services/riskStore';
import { STAGE_DEFINITIONS, type StageDefinition } from '../data/stageDefinitions';
import type { OperationalHealth } from '../types/workflow';

/** One stage engine as seen through its persisted state on the bridge. */
export type StageSource = {
  id: number;
  def: StageDefinition;
  /** Store-level status as reported by the stage's own store. */
  storeStatus: string;
  health: OperationalHealth;
  healthReason: string;
  /** Output may be consumed downstream (engine reachable, published, within its freshness limit). */
  usable: boolean;
  stale: boolean;
  warming: boolean;
  runAt: string | null;
  freshnessSec: number | null;
  latencyMs: number | null;
  latencyLabel: string;
  triggers: string[];
  runs: number | null;
  errors: number | null;
  lastError: string | null;
  message: string;
  running: boolean;
  loading: boolean;
};

type Loose = Record<string, unknown> | null | undefined;

const OFFLINE_RE = /unreachable|failed to fetch|networkerror|econnrefused|load failed|bridge error 50[234]/i;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const ageSec = (iso: string | null, now: number) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
};

function serviceMeta(run: Loose, service: Loose) {
  const r = run ?? {};
  const s = service ?? {};
  return {
    runs: num(s.runs) ?? num(r.runs),
    errors: num(s.errors) ?? num(r.errors),
    lastError: str(s.lastError) ?? str(r.lastError),
    runStatus: str(r.status) ?? str(s.status),
    message: str(r.message) ?? str(s.message) ?? '',
    durationMs: num(r.durationMs),
    triggers: Array.isArray(r.triggers) ? (r.triggers as unknown[]).map(String) : [],
  };
}

type HealthInput = {
  def: StageDefinition;
  storeError: string;
  loading: boolean;
  hasRun: boolean;
  runStatus: string | null;
  runMessage: string;
  freshnessSec: number | null;
  latencyMs: number | null;
  analysisPaused: boolean;
  analysisStage: boolean;
};

/** Operational health from real engine metrics: reachability, publication, freshness vs SLA, run status and latency vs SLA. */
function deriveHealth(h: HealthInput): { health: OperationalHealth; reason: string } {
  if (h.storeError) {
    return OFFLINE_RE.test(h.storeError) ? { health: 'OFFLINE', reason: h.storeError } : { health: 'ERROR', reason: h.storeError };
  }
  if (!h.hasRun) {
    return h.loading ? { health: 'DEGRADED', reason: 'Loading persisted engine state' } : { health: 'OFFLINE', reason: 'The engine has not published a run yet' };
  }
  const pausedOk = h.analysisPaused && h.analysisStage;
  const fSla = h.def.slaFreshnessSec;
  if (!pausedOk && fSla != null && h.freshnessSec != null) {
    if (h.freshnessSec > fSla * 3) return { health: 'ERROR', reason: `Engine silent for ${fmtAge(h.freshnessSec)} (SLA ${fmtAge(fSla)})` };
    if (h.freshnessSec > fSla) return { health: 'DEGRADED', reason: `Last run ${fmtAge(h.freshnessSec)} ago exceeds the ${fmtAge(fSla)} freshness SLA` };
  }
  if (h.runStatus === 'DISCONNECTED') return { health: 'OFFLINE', reason: h.runMessage || 'MT5 terminal disconnected' };
  if (h.runStatus === 'DEGRADED' || h.runStatus === 'STARTING') return { health: 'DEGRADED', reason: h.runMessage || `Engine reports ${h.runStatus}` };
  const lSla = h.def.slaLatencyMs;
  if (lSla != null && h.latencyMs != null && h.latencyMs > lSla * 2) {
    return { health: 'DEGRADED', reason: `Run latency ${h.latencyMs} ms is over 2× the ${lSla} ms SLA` };
  }
  return { health: 'HEALTHY', reason: pausedOk ? 'Engine healthy — analysis paused by the operator' : 'Engine publishing within SLA' };
}

export function fmtAge(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function build(
  def: StageDefinition,
  p: {
    storeStatus: string;
    storeError: string;
    loading: boolean;
    running: boolean;
    runAt: string | null;
    meta: ReturnType<typeof serviceMeta>;
    latencyMs?: number | null;
    latencyLabel?: string;
    freshnessSec?: number | null;
    analysisPaused: boolean;
  },
  now: number,
): StageSource {
  const freshnessSec = p.freshnessSec !== undefined ? p.freshnessSec : ageSec(p.runAt, now);
  const latencyMs = p.latencyMs !== undefined ? p.latencyMs : p.meta.durationMs;
  const analysisStage = def.id >= 2 && def.id <= 8;
  const { health, reason } = deriveHealth({
    def,
    storeError: p.storeError,
    loading: p.loading,
    hasRun: Boolean(p.runAt),
    runStatus: p.meta.runStatus,
    runMessage: p.meta.message,
    freshnessSec,
    latencyMs,
    analysisPaused: p.analysisPaused,
    analysisStage,
  });
  const stale = p.storeStatus === 'STALE';
  return {
    id: def.id,
    def,
    storeStatus: p.storeStatus,
    health,
    healthReason: reason,
    usable: (health === 'HEALTHY' || health === 'DEGRADED') && Boolean(p.runAt) && !stale && !p.storeError,
    stale,
    warming: p.storeStatus === 'WARMING UP' || p.storeStatus === 'WARMING_UP',
    runAt: p.runAt,
    freshnessSec,
    latencyMs,
    latencyLabel: p.latencyLabel ?? 'Last run duration',
    triggers: p.meta.triggers,
    runs: p.meta.runs,
    errors: p.meta.errors,
    lastError: p.meta.lastError,
    message: p.meta.message,
    running: p.running,
    loading: p.loading,
  };
}

const def = (id: number) => STAGE_DEFINITIONS[id - 1];

export function readStageSources(analysisPaused: boolean, now = Date.now()): Record<number, StageSource> {
  const out: Record<number, StageSource> = {};

  // Stage 1 — MT5 feed + historical synchronizer
  const hist = getHistorySnapshot();
  const mt5 = getMT5Snapshot();
  const hs = hist.status;
  const ticks = instruments.map((i) => ageSec(i.lastTickAt ?? null, now)).filter((x): x is number => x != null).sort((a, b) => a - b);
  const medianTick = ticks.length ? ticks[Math.floor(ticks.length / 2)] : null;
  const feedMs = num(mt5.health.feedLatencyMs);
  const s1Meta = {
    runs: null,
    errors: hs ? hs.scheduler.errors : null,
    lastError: hs?.scheduler.lastError ?? null,
    runStatus: hs ? (!hs.provider.connected ? 'DISCONNECTED' : hs.scheduler.recovering || !hs.scheduler.workerAlive ? 'DEGRADED' : 'HEALTHY') : null,
    message: hs ? (hs.provider.connected ? `Provider ${hs.provider.server ?? ''} · ${hs.summary.ready}/${hs.summary.series} series READY` : hs.provider.message || 'MT5 provider offline') : '',
    durationMs: null,
    triggers: [] as string[],
  };
  const s1 = build(
    def(1),
    {
      storeStatus: hs ? 'HEALTHY' : hist.error ? 'ERROR' : 'WAITING',
      storeError: hist.error,
      loading: hist.loading,
      running: Boolean(hs?.queue.current),
      runAt: hs?.scheduler.lastCycleAt ?? (hist.lastFetchAt ? new Date(hist.lastFetchAt).toISOString() : null),
      meta: s1Meta,
      latencyMs: feedMs && feedMs > 0 ? Math.round(feedMs) : null,
      latencyLabel: 'MT5 feed round-trip',
      // In session a quote older than the SLA is a stale feed; out of session the feed is legitimately quiet.
      freshnessSec: hs?.provider.marketOpen ? medianTick : null,
      analysisPaused,
    },
    now,
  );
  out[1] = s1;

  // Stages 2 & 3 — one Stage 2/3 engine run on the bridge
  const reg = getRegimeSnapshot();
  const regRun = reg.state?.run as Loose;
  const regMeta = serviceMeta(regRun, null);
  const s2 = stage2Output(reg, now);
  const regStatus = regimeStageStatus(reg, now);
  out[2] = build(
    def(2),
    {
      storeStatus: s2.state === 'CURRENT' ? 'HEALTHY' : s2.state === 'WARMING_UP' ? 'WARMING UP' : s2.state === 'LOADING' || s2.state === 'EMPTY' ? 'WAITING' : s2.state,
      storeError: reg.error,
      loading: reg.loading,
      running: reg.running,
      runAt: str(regRun?.runAt),
      meta: { ...regMeta, runStatus: regMeta.runStatus === 'WARMING_UP' || regMeta.runStatus === 'BLOCKED' ? null : regMeta.runStatus, durationMs: reg.lastRunLatencyMs ?? regMeta.durationMs },
      analysisPaused,
    },
    now,
  );
  out[3] = build(
    def(3),
    {
      storeStatus: regStatus,
      storeError: reg.error,
      loading: reg.loading,
      running: reg.running,
      runAt: str(regRun?.runAt),
      meta: { ...regMeta, runStatus: regMeta.runStatus === 'WARMING_UP' || regMeta.runStatus === 'BLOCKED' ? null : regMeta.runStatus, durationMs: reg.lastRunLatencyMs ?? regMeta.durationMs },
      analysisPaused,
    },
    now,
  );

  const stores: [number, { state: unknown; loading: boolean; running: boolean; error: string }, string][] = [
    [4, getScannerSnapshot(), scannerStageStatus()],
    [5, getVisionSnapshot(), visionStageStatus()],
    [6, getDirectionSnapshot(), directionStageStatus()],
    [7, getH1Snapshot(), h1StageStatus()],
    [8, getRiskSnapshot(), riskStageStatus()],
  ];
  for (const [id, snap, status] of stores) {
    const st = snap.state as { run?: Loose; service?: Loose } | null;
    out[id] = build(
      def(id),
      { storeStatus: status, storeError: snap.error, loading: snap.loading, running: snap.running, runAt: str(st?.run?.runAt), meta: serviceMeta(st?.run, st?.service), analysisPaused },
      now,
    );
  }

  // Stage 9 — central execution engine; Stage 10 — its trade publication to learning
  const ex = getExecutionSnapshot();
  const run = ex.state?.run;
  const exMeta = serviceMeta(run as Loose, null);
  const ping = num(run?.terminal?.pingMs);
  out[9] = build(
    def(9),
    {
      storeStatus: executionStageStatus(ex, now),
      storeError: ex.error,
      loading: ex.loading,
      running: ex.busy,
      runAt: run?.runAt ?? null,
      meta: exMeta,
      latencyMs: ping,
      latencyLabel: 'MT5 terminal ping',
      analysisPaused,
    },
    now,
  );
  const trades = ex.state?.trades ?? [];
  const lastTrade = trades.map((t) => t.closedAt).filter(Boolean).sort().pop() ?? null;
  out[10] = build(
    def(10),
    {
      storeStatus: executionStageStatus(ex, now),
      storeError: ex.error,
      loading: ex.loading,
      running: false,
      runAt: run?.runAt ?? null,
      meta: { ...exMeta, runStatus: exMeta.runStatus === 'DISCONNECTED' ? 'HEALTHY' : exMeta.runStatus, message: `${trades.length} closed trade record(s)${lastTrade ? ` · last close ${lastTrade}` : ''}` },
      latencyMs: null,
      latencyLabel: 'Not measured',
      analysisPaused,
    },
    now,
  );
  return out;
}
