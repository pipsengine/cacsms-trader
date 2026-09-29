import type { Instrument } from '../../../types';
import { assessInstrument } from '../../market-data/services/stage1Gate';
import { getInstrumentHistoryGate } from '../../market-data/services/historyStore';
import type { Stage2Output } from '../../currency-strength/services/strengthStage';
import { getPairRegime } from '../../historical-regime/services/regimeStore';
import type { ScannerInstrument } from '../../market-scanner/types';
import type { VisionInstrument, TfSummary } from '../../htf-vision/types';
import type { DirectionDecision } from '../../structural-direction/types';
import type { H1Decision } from '../../h1-confirmation/types';
import type { Opportunity } from '../../opportunity-risk/types';
import type { Execution } from '../../execution/types';
import { stageName } from '../data/stageDefinitions';
import type {
  DecisionQueueItem,
  EvidenceFreshness,
  InstrumentTrace,
  PipelineState,
  TraceDecision,
  TraceDirection,
  TraceField,
  WorldModelRecord,
  WorldTile,
} from '../types/workflow';
import type { StageSource } from './stageSources';
import { fmtAge } from './stageSources';

/** Everything the per-instrument walk needs, read once per snapshot. */
export type InstrumentContext = {
  now: number;
  analysisPaused: boolean;
  sources: Record<number, StageSource>;
  s2: Stage2Output;
  scanner: Map<string, ScannerInstrument>;
  vision: Map<string, VisionInstrument>;
  direction: Map<string, DirectionDecision>;
  h1: Map<string, H1Decision>;
  opportunities: Map<string, Opportunity[]>;
  open: Map<string, Execution[]>;
  queued: Map<string, Execution[]>;
  control: { newEntries: boolean; state: string | null; reason: string };
  accountOpenRiskPct: number | null;
  economic?: Map<string, { state: string; activeEvent: string | null; activeEventId?: string | null; affectedCurrency: string | null; impact: string | null; scheduledAt?: string | null; minutesToEvent: number | null; actual?: string | null; forecast?: string | null; previous?: string | null; surprise: string | null; marketReactionScore?: number | null; spreadCondition: string; volatilityCondition: string; restriction: string; revalidationRequired: boolean; calendarFeedHealth?: string; mt5Health?: string; updatedAt: string | null; blocksNewEntries: boolean; reason: string }>;
};

type Gate = {
  id: number;
  pass: boolean;
  state: PipelineState;
  reason: string;
  waitingFor: string;
  nextAction: string;
  confidence: number | null;
  since: string | null;
  rejected?: boolean;
};

const ok = (id: number, reason: string, confidence: number | null = null, since: string | null = null): Gate => ({
  id,
  pass: true,
  state: 'READY',
  reason,
  waitingFor: '',
  nextAction: '',
  confidence,
  since,
});

const hold = (id: number, state: PipelineState, reason: string, waitingFor: string, nextAction: string, extra: Partial<Gate> = {}): Gate => ({
  id,
  pass: false,
  state,
  reason,
  waitingFor,
  nextAction,
  confidence: null,
  since: null,
  ...extra,
});

const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ') : '—');
const dirOf = (s: string | null | undefined): TraceDirection =>
  !s ? 'NEUTRAL' : /BULL|BUY|LONG/.test(s) ? 'LONG' : /BEAR|SELL|SHORT/.test(s) ? 'SHORT' : 'NEUTRAL';

/** A stage engine that cannot be consumed holds every instrument at that stage, whatever the per-instrument record says. */
function sourceGate(id: number, ctx: InstrumentContext): Gate | null {
  if (ctx.analysisPaused && id >= 2 && id <= 8) {
    return hold(id, 'PAUSED', 'Analysis paused by the operator', 'Operator resumes analysis', 'Pending triggers run on resume');
  }
  const s = ctx.sources[id];
  if (s.usable) return null;
  if (s.stale) return hold(id, 'STALE', `Stage ${id} output stale (${fmtAge(s.freshnessSec)} old)`, `Fresh Stage ${id} run`, `Stage ${id} engine re-publishes`);
  if (s.warming) return hold(id, 'WARMING_UP', `Stage ${id} warming up — ${s.message || 'collecting observations'}`, `Stage ${id} warm-up`, 'Continues as closed candles arrive');
  return hold(id, 'BLOCKED', `Stage ${id} ${s.health}: ${s.healthReason}`, `Stage ${id} engine recovery`, `Restore Stage ${id} (${s.def.name})`);
}

function gate1(i: Instrument): Gate {
  const g = assessInstrument(i);
  if (g.pass) return ok(1, g.reason);
  const since = i.lastTickAt ?? null;
  if (g.quality === 'CLOSED') return hold(1, 'WAITING', `S1 CLOSED — ${g.reason}`, 'FX market open', 'Resumes automatically at the session open', { since });
  if (g.quality === 'STALE') return hold(1, 'STALE', `S1 STALE — ${g.reason}`, 'Fresh MT5 tick', 'Held until the feed recovers', { since });
  if (g.quality === 'HISTORY') {
    const warming = g.history === 'WARMING_UP' || g.history === 'SYNCING';
    return hold(1, warming ? 'WARMING_UP' : 'BLOCKED', `S1 HISTORY ${g.history} — ${getInstrumentHistoryGate(i.symbol).reason}`, `History ${human(g.history)} → READY`, 'Historical synchronizer sync / repair');
  }
  return hold(1, 'BLOCKED', `S1 INVALID — ${g.reason}`, 'Valid broker quote', 'Broker quote validation');
}

function gate2(symbol: string, ctx: InstrumentContext): Gate {
  const pair = ctx.s2.pairs.find((p) => p.symbol === symbol);
  if (ctx.s2.state === 'WARMING_UP') return hold(2, 'WARMING_UP', 'Strength warming up — collecting closed D1 observations', 'Strength warm-up', 'Continues on each D1 close');
  if (ctx.s2.state === 'STALE') return hold(2, 'STALE', `Strength stale — last D1 ${ctx.s2.obsDate ?? '—'}`, 'Next D1 strength publication', 'Stage 2 re-publishes on the D1 close');
  if (!pair || pair.differential == null) return hold(2, 'WAITING', 'No strength differential for this pair', 'Strength differential', 'Stage 2 publication');
  return ok(2, `Differential ${pair.differential.toFixed(2)} (${pair.base} vs ${pair.quote})`);
}

function gate3(symbol: string): Gate {
  const p = getPairRegime(symbol);
  if (!p) return hold(3, 'WAITING', 'No pair regime yet', 'Pair regime classification', 'Stage 3 run');
  if (p.status !== 'READY') return hold(3, 'WARMING_UP', `Regime warming up${p.reason ? ` — ${p.reason}` : ''}`, 'Regime warm-up', 'Continues on each D1 close');
  return ok(3, `${p.bias}${p.conviction != null ? ` · conviction ${Math.round(p.conviction)}` : ''}`, p.confidence ?? p.conviction ?? null, p.updatedAt);
}

function gate4(s: ScannerInstrument | undefined): Gate {
  if (!s) return hold(4, 'WAITING', 'Not ranked by the Market Scanner yet', 'Stage 4 ranking', 'Next re-rank');
  const conf = s.conviction ?? null;
  if (s.state === 'PROMOTED') return ok(4, `PROMOTED #${s.rank} · ${human(s.direction)}`, conf, s.promotedAt);
  if (s.state === 'STALE') return hold(4, 'STALE', `S4 STALE — ${s.reason}`, 'Fresh scanner evidence', 'Re-rank on the next freshness change', { confidence: conf });
  if (s.state === 'BLOCKED') return hold(4, 'BLOCKED', `S4 BLOCKED — ${s.reason}`, human(s.stage1?.status) === 'READY' ? 'Scanner gate' : `Stage 1 ${human(s.stage1?.status)}`, 'Re-rank when the block clears', { confidence: conf });
  if (s.state === 'INSUFFICIENT_DATA') return hold(4, 'WARMING_UP', `S4 INSUFFICIENT DATA — ${s.reason}`, 'Enough strength / regime history', 'Continues as history accrues', { confidence: conf });
  return hold(4, 'WAITING', `S4 ${s.state} — ${s.promotion?.reason || s.reason}`, `Promotion (${s.state} → PROMOTED)`, 'Re-rank on the next strength / regime / candle change', { confidence: conf });
}

function gate5(v: VisionInstrument | undefined): Gate {
  if (!v) return hold(5, 'WAITING', 'No HTF analysis yet', 'HTF Market Vision run', 'Stage 5 analyses on promotion');
  const conf = v.confidence ?? null;
  if (v.d1?.status === 'INVALIDATED') return hold(5, 'INVALIDATED', `D1 channel INVALIDATED — ${v.reason}`, 'New D1 channel', 'Stage 5 rebuilds the channel on D1 closes', { confidence: conf });
  if (v.status === 'WARMING_UP') return hold(5, 'WARMING_UP', `S5 WARMING UP — ${v.reason}`, 'Enough D1/H8 bars', 'Continues on D1/H8 closes', { confidence: conf });
  if (v.status === 'STALE') return hold(5, 'STALE', `S5 STALE — ${v.reason}`, 'Fresh D1/H8 data', 'Re-analysis on the next close', { confidence: conf });
  if (v.status !== 'READY') return hold(5, 'BLOCKED', `S5 ${human(v.status)} — ${v.reason}`, 'Valid D1/H8 history', 'History repair', { confidence: conf });
  if (!v.d1?.confirmed) return hold(5, 'WAITING', `D1 channel ${human(v.d1?.status)} — not confirmed`, 'Confirmed D1 channel', 'Re-analysis on D1/H8 closes', { confidence: conf });
  return ok(5, `D1 ${human(v.d1.direction)} ${human(v.d1.status)} · H8 ${human(v.h8?.direction)} · ${human(v.agreement)}`, conf, v.analysedAt ?? null);
}

function gate6(d: DirectionDecision | undefined): Gate {
  if (!d) return hold(6, 'WAITING', 'No structural decision yet', 'Structural Direction decision', 'Stage 6 evaluates Stage 5 output');
  const conf = d.confidence ?? null;
  const code = d.reasonCode ? `${d.reasonCode}: ` : '';
  if (d.readyForH1) return ok(6, `READY_FOR_H1 · ${human(d.direction)} · ${human(d.alignment)}`, conf, d.readySince ?? d.changedAt ?? null);
  if (d.state === 'INVALIDATED') return hold(6, 'INVALIDATED', `S6 INVALIDATED — ${code}${d.reason}`, 'New structure', 'Re-evaluated on the next D1/H8 change', { confidence: conf, since: d.changedAt ?? null });
  if (d.state === 'STALE') return hold(6, 'STALE', `S6 STALE — ${code}${d.reason}`, 'Fresh Stage 5 structure', 'Re-evaluated when Stage 5 re-publishes', { confidence: conf, since: d.changedAt ?? null });
  if (d.state === 'BLOCKED') return hold(6, 'BLOCKED', `S6 BLOCKED — ${code}${d.reason}`, human(d.reasonCode), 'Re-evaluated when the upstream block clears', { confidence: conf, since: d.changedAt ?? null });
  if (d.state === 'CONFLICT') return hold(6, 'BLOCKED', `S6 CONFLICT — ${code}${d.reason}`, 'Scanner and structure agreement', 'Re-evaluated on structure / strength change', { confidence: conf, since: d.changedAt ?? null, rejected: true });
  return hold(6, 'WAITING', `S6 ${human(d.state)} — ${code}${d.reason}`, d.alignment === 'PULLBACK' ? 'H8 pullback into value → READY_FOR_H1' : 'READY_FOR_H1 hand-off', 'Re-evaluated on H8 / D1 closes', { confidence: conf, since: d.changedAt ?? null });
}

function gate7(h: H1Decision | undefined): Gate {
  if (!h) return hold(7, 'WAITING', 'No H1 evaluation yet', 'H1 Confirmation evaluation', 'Stage 7 monitors Stage 6 hand-offs');
  const conf = h.score ?? null;
  const code = h.reasonCode ? `${h.reasonCode}: ` : '';
  const since = h.changedAt ?? null;
  if (h.state === 'CONFIRMED' && h.confirmed) return ok(7, `CONFIRMED · ${human(h.phase)} · score ${Math.round(h.score)}`, conf, h.confirmedSince ?? since);
  if (h.state === 'INVALIDATED') return hold(7, 'INVALIDATED', `S7 INVALIDATED — ${code}${h.reason}`, 'New Stage 6 hand-off', 'Setup discarded', { confidence: conf, since });
  if (h.state === 'REJECTED') return hold(7, 'BLOCKED', `S7 REJECTED — ${code}${h.reason}`, 'New H1 setup', 'Re-evaluated on the next H1 close', { confidence: conf, since, rejected: true });
  if (h.state === 'STALE') return hold(7, 'STALE', `S7 STALE — ${code}${h.reason}`, 'Fresh H1 data', 'Re-evaluated on the next H1 close', { confidence: conf, since });
  if (h.state === 'WARMING_UP') return hold(7, 'WARMING_UP', `S7 WARMING UP — ${code}${h.reason}`, 'Enough H1 bars', 'Continues on H1 closes', { confidence: conf, since });
  if (h.state === 'BLOCKED') return hold(7, 'BLOCKED', `S7 BLOCKED — ${code}${h.reason}`, human(h.reasonCode), 'Re-evaluated when the block clears', { confidence: conf, since });
  if (h.state === 'WAITING_FOR_STAGE6') return hold(7, 'WAITING', 'Waiting for a Stage 6 READY_FOR_H1 hand-off', 'Stage 6 hand-off', 'Stage 6 re-evaluation', { confidence: conf, since });
  return hold(7, 'RUNNING', `S7 ${human(h.state)} — ${code}${h.reason}`, 'H1 BOS / CHoCH confirmation', 'Monitoring every H1 close and live BOS attempts', { confidence: conf, since });
}

function gate8(opps: Opportunity[] | undefined): Gate {
  if (!opps?.length) return hold(8, 'WAITING', 'No active Stage 8 setup', 'Stage 8 evaluation of the H1 confirmation', 'Stage 8 run on the Stage 7 change');
  const auth = opps.find((o) => o.state === 'AUTHORIZED');
  const o = auth ?? opps[0];
  const conf = o.confidence ?? o.score ?? null;
  if (auth) return ok(8, `AUTHORIZED ${auth.side} · ${auth.authorizedAccounts} account(s) · risk ${auth.proposedRiskPct ?? '—'}%`, conf, auth.confirmedSince);
  const why = `${o.reasonCode}: ${o.reason}`;
  if (o.state.endsWith('_BLOCKED')) return hold(8, 'BLOCKED', `S8 ${human(o.state)} — ${why}`, human(o.reasonCode), 'Re-evaluated on account / exposure / price change', { confidence: conf, since: o.confirmedSince });
  if (o.state === 'STALE') return hold(8, 'STALE', `S8 STALE — ${why}`, 'Fresh Stage 7 / market data', 'Re-evaluated on the next H1 close', { confidence: conf });
  if (o.state === 'EXPIRED') return hold(8, 'INVALIDATED', `S8 EXPIRED — ${why}`, 'New Stage 7 confirmation', 'Setup discarded', { confidence: conf });
  return hold(8, 'WAITING', `S8 ${human(o.state)} — ${why}`, human(o.reasonCode), 'Stage 8 re-evaluation', { confidence: conf, since: o.confirmedSince });
}

function gate9(symbol: string, ctx: InstrumentContext): Gate {
  const open = ctx.open.get(symbol) ?? [];
  if (open.length) {
    const x = open[0];
    return ok(9, `${x.direction} ${x.positionState} · ${x.accountName ?? x.accountId}`, null, x.filledAt ?? x.createdAt ?? null);
  }
  const q = ctx.queued.get(symbol) ?? [];
  if (!q.length) return hold(9, 'WAITING', 'No Stage 8 authorization in the Stage 9 queue', 'Stage 8 authorization', 'Stage 9 picks it up on the next 2 s cycle');
  const x = q[0];
  if (!ctx.control.newEntries) {
    return hold(9, 'BLOCKED', `S9 ${human(ctx.control.state)} — ${ctx.control.reason}`, `Clear ${human(ctx.control.state)}`, 'Authorization waits (or expires) while new entries are blocked', { since: x.createdAt ?? null });
  }
  return hold(9, 'RUNNING', `S9 ${human(x.orderState)} — ${x.stateReason ?? 'revalidating before submission'}`, 'Stage 9 revalidation + MT5 submission', 'Revalidate → consume → order_send → reconcile', { since: x.createdAt ?? null });
}

function field(value: string, source: StageSource, hasValue: boolean, liveOk: boolean, ctx: InstrumentContext, at: string | null, detail: string): TraceField {
  const freshness: EvidenceFreshness = !hasValue
    ? 'NONE'
    : source.stale || source.health === 'ERROR' || source.health === 'OFFLINE'
      ? 'STALE'
      : !liveOk || (ctx.analysisPaused && source.id >= 2 && source.id <= 8)
        ? 'LAST_KNOWN'
        : 'LIVE';
  return { value: hasValue ? value : '—', freshness, source: `S${source.id} ${source.def.short}`, at, detail };
}

const tfValue = (t: TfSummary | undefined, status: string | undefined) =>
  !t ? '—' : status !== 'READY' ? human(t.dataStatus) : `${human(t.direction)}${t.status ? ` · ${human(t.status)}` : ''}`;

const sinceMemo = new Map<string, { key: string; since: string }>();

export function buildTrace(i: Instrument, ctx: InstrumentContext): InstrumentTrace {
  const sym = i.symbol;
  const sc = ctx.scanner.get(sym);
  const v = ctx.vision.get(sym);
  const d = ctx.direction.get(sym);
  const h = ctx.h1.get(sym);
  const opps = ctx.opportunities.get(sym);

  const raw: Gate[] = [
    gate1(i),
    sourceGate(2, ctx) ?? gate2(sym, ctx),
    sourceGate(3, ctx) ?? gate3(sym),
    sourceGate(4, ctx) ?? gate4(sc),
    sourceGate(5, ctx) ?? gate5(v),
    sourceGate(6, ctx) ?? gate6(d),
    sourceGate(7, ctx) ?? gate7(h),
    sourceGate(8, ctx) ?? gate8(opps),
    ctx.sources[9].usable ? gate9(sym, ctx) : hold(9, 'BLOCKED', `Stage 9 ${ctx.sources[9].health}: ${ctx.sources[9].healthReason}`, 'Central execution engine', 'Restore the Stage 9 engine / MT5 connection'),
  ];
  // Analysis depth ignores upstream gates: it is what the engines last concluded, not what the live path allows.
  const analysisDepth = raw.reduce((m, g) => (g.pass && g.id >= 4 ? Math.max(m, g.id) : m), 0);

  const open = (ctx.open.get(sym) ?? []).length > 0;
  let stagesPassed = 0;
  for (const g of raw) {
    if (!g.pass) break;
    stagesPassed = g.id;
  }
  let current: Gate;
  let currentGate: number;
  if (open) {
    stagesPassed = Math.max(stagesPassed, 8);
    currentGate = 9;
    current = { ...raw[8], state: 'RUNNING', pass: true };
  } else if (stagesPassed >= 9) {
    currentGate = 9;
    current = raw[8];
  } else {
    currentGate = stagesPassed + 1;
    current = raw[currentGate - 1];
  }

  const decision: TraceDecision = open
    ? 'OPEN'
    : current.state === 'INVALIDATED'
      ? 'INVALIDATED'
      : current.rejected
        ? 'REJECTED'
        : currentGate === 9 && raw[7].pass && ctx.control.newEntries && current.state !== 'BLOCKED'
          ? 'READY'
          : current.state === 'BLOCKED' || current.state === 'STALE'
            ? 'BLOCKED'
            : 'WAIT';

  const oppBest = opps?.find((o) => o.state === 'AUTHORIZED') ?? opps?.[0];
  const direction = [dirOf(oppBest?.side), dirOf(h?.expectedDirection), dirOf(d?.expectedDirection), dirOf(sc?.direction)].find((x) => x !== 'NEUTRAL') ?? 'NEUTRAL';

  let confidence: number | null = null;
  let confidenceSource = '';
  for (let k = Math.min(currentGate, 8); k >= 3; k -= 1) {
    const c = raw[k - 1].confidence;
    if (c != null && Number.isFinite(c)) {
      confidence = Math.round(c);
      confidenceSource = `S${k}`;
      break;
    }
  }

  const s1ok = raw[0].pass;
  const src = ctx.sources;
  const leg = (a: string | undefined) => ctx.s2.assets.find((x) => x.asset === a);
  const bl = leg(sc?.baseAsset);
  const ql = leg(sc?.quoteAsset);
  const pair = ctx.s2.pairs.find((p) => p.symbol === sym);
  const reg = getPairRegime(sym);
  const oppState = oppBest ? human(oppBest.state) : 'NO SETUP';
  const macroBias = sc?.macroBias ?? (pair?.differential != null ? (pair.differential > 0 ? 'BULLISH' : pair.differential < 0 ? 'BEARISH' : 'NEUTRAL') : '');
  const trace: InstrumentTrace = {
    symbol: sym,
    assetClass: i.kind === 'GOLD' ? 'METAL' : 'FX',
    currentGate,
    gateName: stageName(currentGate),
    stagesPassed,
    analysisDepth,
    state: current.state,
    decision,
    direction,
    confidence,
    confidenceSource,
    blocker: open ? (s1ok ? '' : `${raw[0].reason} — position managed on last confirmed data`) : current.reason,
    waitingFor: open ? 'Exit (SL / TP / trailing / structural)' : current.waitingFor,
    nextAction: open ? 'Stage 9 manages SL/TP/trailing; Stage 10 records the trade on exit' : current.nextAction,
    liveEligible: s1ok,
    macro: field(
      `${human(macroBias)}${pair?.differential != null ? ` · ${pair.differential > 0 ? '+' : ''}${pair.differential.toFixed(2)}` : ''}`,
      src[2],
      Boolean(macroBias),
      s1ok,
      ctx,
      ctx.s2.runAt,
      bl && ql ? `${bl.asset} ${bl.composite?.toFixed(2) ?? '—'} (${human(bl.macroBias)}) vs ${ql.asset} ${ql.composite?.toFixed(2) ?? '—'} (${human(ql.macroBias)}) · D1 ${ctx.s2.obsDate ?? '—'}` : `D1 ${ctx.s2.obsDate ?? '—'}`,
    ),
    regime: field(
      reg ? (reg.status === 'READY' ? `${reg.bias}${reg.conviction != null ? ` · ${Math.round(reg.conviction)}` : ''}` : 'WARMING UP') : '',
      src[3],
      Boolean(reg),
      s1ok,
      ctx,
      reg?.updatedAt ?? null,
      reg ? `${reg.baseRegime ?? '—'} vs ${reg.quoteRegime ?? '—'} · ${human(reg.relationship)}${reg.reason ? ` · ${reg.reason}` : ''}` : 'No pair regime',
    ),
    d1: field(tfValue(v?.d1, v?.status), src[5], Boolean(v), s1ok, ctx, v?.analysedAt ?? null, v ? `${v.d1?.dataReason || v.reason} · confidence ${v.d1?.confidence ?? '—'}` : 'No HTF analysis'),
    h8: field(tfValue(v?.h8, v?.status), src[5], Boolean(v), s1ok, ctx, v?.analysedAt ?? null, v ? `${v.h8?.dataReason || v.reason} · confidence ${v.h8?.confidence ?? '—'}` : 'No HTF analysis'),
    h1: field(h ? `${human(h.state)}${h.score ? ` · ${Math.round(h.score)}` : ''}` : '', src[7], Boolean(h), s1ok, ctx, h?.evaluatedAt ?? null, h ? `${h.reasonCode ?? ''} ${h.reason}`.trim() : 'No H1 evaluation'),
    risk: field(oppState, src[8], true, s1ok, ctx, src[8].runAt, oppBest ? `${oppBest.tradeType && oppBest.tradeType !== 'NONE' ? `${human(oppBest.tradeType)} · ` : ''}${oppBest.reasonCode}: ${oppBest.reason}` : 'No active Stage 8 setup for this instrument'),
    legLine: d?.marketLeg && d.marketLeg.currentLeg !== 'UNRESOLVED'
      ? `D1 ${human(d.marketLeg.dominantTrend)} · H8 ${human(v?.h8?.relationship ?? v?.h8?.direction)} · H1 ${v?.nested?.h1Status && v.nested.h1Status !== 'NOT_DETECTED' ? `${human(v.nested.h1Direction)} CHANNEL` : 'NOT DETECTED'} · Parent ${d.marketLeg.channelPosition?.toFixed(0) ?? '—'}% · ${human(d.setupRelationship ?? d.marketLeg.relationship)} · ${human(d.marketLeg.tradeType)}${d.marketLeg.expectedDestination ? ` · ${human(d.marketLeg.expectedDestination)}` : ''}`
      : v?.nested ? `D1 ${human(v.primaryDirection)} · H1 ${v.nested.h1Status && v.nested.h1Status !== 'NOT_DETECTED' ? human(v.nested.h1Direction) : 'NOT DETECTED'} · ${human(v.nested.relationship)}` : undefined,
    updatedAt: [sc?.updatedAt, v?.analysedAt, d?.evaluatedAt, h?.evaluatedAt, i.lastTickAt].filter((x): x is string => Boolean(x)).sort().pop() ?? null,
    since: null,
    ageSec: null,
  };
  const econ = ctx.economic?.get(sym);
  if (econ?.blocksNewEntries && !open && trace.decision === 'READY') {
    trace.decision = 'BLOCKED';
    trace.blocker = econ.reason;
    trace.waitingFor = 'Economic event gate';
    trace.nextAction = econ.restriction;
  }
  if (econ) {
    trace.risk = { ...trace.risk, detail: `${trace.risk.detail} · Economic ${econ.restriction}: ${econ.reason}` };
  }

  const key = `${currentGate}|${trace.state}|${decision}`;
  const memo = sinceMemo.get(sym);
  if (!memo || memo.key !== key) sinceMemo.set(sym, { key, since: current.since ?? new Date(ctx.now).toISOString() });
  trace.since = sinceMemo.get(sym)!.since;
  const t = Date.parse(trace.since);
  trace.ageSec = Number.isFinite(t) ? Math.max(0, Math.round((ctx.now - t) / 1000)) : null;
  return trace;
}

/** Instruments that are actively progressing (live path at Stage 5+ or an open position), plus last-known Stage 4+ analysis held upstream. */
export function buildQueue(traces: InstrumentTrace[]): DecisionQueueItem[] {
  const rows: DecisionQueueItem[] = [];
  for (const t of traces) {
    const live = t.currentGate >= 5 || t.decision === 'OPEN';
    if (!live && t.analysisDepth < 4) continue;
    rows.push({
      symbol: t.symbol,
      stage: live ? t.currentGate : Math.min(t.analysisDepth + 1, 9),
      stageName: stageName(live ? t.currentGate : Math.min(t.analysisDepth + 1, 9)),
      state: t.state,
      decision: t.decision,
      direction: t.direction,
      confidence: t.confidence,
      waitingFor: live ? t.waitingFor || t.blocker : t.blocker,
      since: t.since,
      ageSec: t.ageSec,
      nextAction: t.nextAction,
      live,
    });
  }
  return rows.sort((a, b) => Number(b.live) - Number(a.live) || b.stage - a.stage || (b.confidence ?? -1) - (a.confidence ?? -1));
}

function tile(key: string, label: string, stage: number, f: { value: string; sub: string; at: string | null; freshness: EvidenceFreshness; evidence: string[] }): WorldTile {
  return { key, label, stage, value: f.value, sub: f.sub, updatedAt: f.at, freshness: f.freshness, evidence: f.evidence.filter(Boolean) };
}

export function buildWorld(i: Instrument, t: InstrumentTrace, ctx: InstrumentContext): WorldModelRecord {
  const sym = i.symbol;
  const g1 = assessInstrument(i);
  const hist = getInstrumentHistoryGate(sym);
  const sc = ctx.scanner.get(sym);
  const v = ctx.vision.get(sym);
  const d = ctx.direction.get(sym);
  const h = ctx.h1.get(sym);
  const oppBest = ctx.opportunities.get(sym)?.find((o) => o.state === 'AUTHORIZED') ?? ctx.opportunities.get(sym)?.[0];
  const open = ctx.open.get(sym) ?? [];
  const s9 = ctx.sources[9];
  const quoteFresh: EvidenceFreshness = !i.bid || !i.ask ? 'NONE' : g1.pass ? 'LIVE' : g1.quality === 'STALE' ? 'STALE' : 'LAST_KNOWN';
  const tiles: WorldTile[] = [
    tile('quote', 'Quote & feed', 1, {
      value: i.bid && i.ask ? `${i.bid} / ${i.ask}` : 'NO QUOTE',
      sub: `Spread ${i.spread ?? '—'} · tick ${fmtAge(g1.freshnessSec)} old`,
      at: i.lastTickAt ?? null,
      freshness: quoteFresh,
      evidence: [`Stage 1 gate: ${g1.pass ? 'PASS' : 'FAIL'} — ${g1.reason}`, `Quality ${g1.quality} · history ${hist.code}: ${hist.reason}`, `Last tick ${i.lastTickAt ?? '—'}`],
    }),
    tile('strength', 'Currency strength', 2, {
      value: t.macro.value,
      sub: t.macro.detail,
      at: t.macro.at,
      freshness: t.macro.freshness,
      evidence: [
        `Stage 2 state ${ctx.s2.state} · D1 ${ctx.s2.obsDate ?? '—'}`,
        sc?.base ? `${sc.base.asset}: composite ${sc.base.composite.toFixed(2)} · macro ${sc.base.macro?.toFixed(2) ?? '—'} · ${sc.base.trajectory}` : '',
        sc?.quote ? `${sc.quote.asset}: composite ${sc.quote.composite.toFixed(2)} · macro ${sc.quote.macro?.toFixed(2) ?? '—'} · ${sc.quote.trajectory}` : '',
      ],
    }),
    tile('regime', 'Historical regime', 3, { value: t.regime.value, sub: t.regime.detail, at: t.regime.at, freshness: t.regime.freshness, evidence: [t.regime.detail] }),
    tile('scanner', 'Scanner rank', 4, {
      value: sc ? `${sc.state} #${sc.rank}` : '—',
      sub: sc ? `${human(sc.direction)} · conviction ${sc.conviction?.toFixed(0) ?? '—'}` : 'Not ranked',
      at: sc?.updatedAt ?? null,
      freshness: field('', ctx.sources[4], Boolean(sc), g1.pass, ctx, null, '').freshness,
      evidence: sc ? [sc.reason, ...(sc.promotion?.rules ?? []).map((r) => `${r.pass ? '✓' : '✗'} ${r.label}: ${r.detail}`)] : [],
    }),
    tile('d1', 'D1 channel', 5, { value: t.d1.value, sub: v?.d1 ? `Position ${v.d1.position?.toFixed(0) ?? '—'}% · ${human(v.d1.phase)}` : '—', at: t.d1.at, freshness: t.d1.freshness, evidence: [t.d1.detail, ...(v?.invalidation ?? []).map((x) => `Invalidation: ${x}`)] }),
    tile('h8', 'H8 channel', 5, { value: t.h8.value, sub: v?.h8 ? `Position ${v.h8.position?.toFixed(0) ?? '—'}% · ${human(v.h8.phase)}` : '—', at: t.h8.at, freshness: t.h8.freshness, evidence: [t.h8.detail, v ? `Agreement ${human(v.agreement)}` : ''] }),
    tile('structure', 'Structural direction', 6, {
      value: d?.marketLeg ? `${human(d.marketLeg.dominantTrend)} · ${human(d.marketLeg.currentLeg)}` : d ? human(d.state) : '—',
      sub: d?.marketLeg
        ? `${human(d.marketLeg.tradeType)} · ${human(d.marketLeg.relationship)} · reversal ${human(d.marketLeg.reversalState)}`
        : d ? `${human(d.direction)} · ${human(d.alignment)} · zone ${human(d.zone?.name)}` : 'No decision',
      at: d?.evaluatedAt ?? null,
      freshness: field('', ctx.sources[6], Boolean(d), g1.pass, ctx, null, '').freshness,
      evidence: d ? [
        d.marketLeg ? `HTF ${human(d.marketLeg.dominantTrend)} · leg ${human(d.marketLeg.currentLeg)} · LTF ${human(d.marketLeg.ltfTrend)} · ${human(d.marketLeg.tradeType)} · destination ${human(d.marketLeg.expectedDestination)} · reversal ${human(d.marketLeg.reversalState)}` : '',
        d.marketLeg ? `${d.marketLeg.reasonCode}: ${d.marketLeg.reason}` : '',
        `${d.reasonCode ?? ''} ${d.reason}`.trim(),
        ...(d.conflicts ?? []).map((c) => `Conflict: ${c}`),
        ...(d.invalidation ?? []).map((x) => `Invalidation: ${x}`),
      ].filter(Boolean) : [],
    }),
    tile('h1', 'H1 confirmation', 7, {
      value: t.h1.value,
      sub: h ? `${human(h.phase)} · invalidation ${h.invalidationLevel ?? '—'}` : 'No evaluation',
      at: t.h1.at,
      freshness: t.h1.freshness,
      evidence: h ? [t.h1.detail, ...Object.values(h.gates ?? {}).filter((g) => g.mandatory).map((g) => `${g.status} ${g.label}: ${g.detail}`)] : [],
    }),
    tile('risk', 'Opportunity & risk', 8, {
      value: t.risk.value,
      sub: oppBest ? `${oppBest.side} · score ${Math.round(oppBest.score)} · ${oppBest.eligibleAccounts} eligible` : 'No active setup',
      at: t.risk.at,
      freshness: t.risk.freshness,
      evidence: oppBest ? [t.risk.detail, ...oppBest.setupFailures.map((f) => `${f.state} ${f.code}: ${f.reason}`)] : [t.risk.detail],
    }),
    tile('exposure', 'Position & exposure', 9, {
      value: open.length ? `${open.length} OPEN` : 'FLAT',
      sub: `Control ${human(ctx.control.state)} · account open risk ${ctx.accountOpenRiskPct != null ? `${ctx.accountOpenRiskPct.toFixed(2)}%` : '—'}`,
      at: s9.runAt,
      freshness: s9.usable ? 'LIVE' : s9.runAt ? 'STALE' : 'NONE',
      evidence: [...open.map((x) => `${x.direction} ${x.positionState} · ${x.openVolume ?? x.authVolume} lots · ${x.accountName ?? x.accountId}`), `New entries ${ctx.control.newEntries ? 'allowed' : 'blocked'} — ${ctx.control.reason}`],
    }),
  ];
  const econ = ctx.economic?.get(sym);
  if (econ) {
    tiles.push(tile('economic', 'Economic risk', 8, {
      value: econ.restriction,
      sub: `${econ.state} · ${econ.affectedCurrency ?? '—'} ${econ.impact ?? ''} · ${econ.minutesToEvent ?? '—'}m`,
      at: econ.updatedAt,
      freshness: econ.updatedAt ? 'LIVE' : 'NONE',
      evidence: [econ.reason, econ.activeEvent || '', `Spread ${econ.spreadCondition} · volatility ${econ.volatilityCondition}`, econ.revalidationRequired ? 'Structure revalidation required' : ''],
    }));
  }
  return {
    symbol: sym, bid: i.bid, ask: i.ask, spread: i.spread, decision: t.decision, confidence: t.confidence, tiles,
    economicRisk: econ ? {
      state: econ.state, activeEvent: econ.activeEvent, activeEventId: econ.activeEventId, affectedCurrency: econ.affectedCurrency,
      currency: econ.affectedCurrency, impact: econ.impact, scheduledAt: econ.scheduledAt, minutesToEvent: econ.minutesToEvent,
      actual: econ.actual, forecast: econ.forecast, previous: econ.previous, surprise: econ.surprise,
      marketReactionScore: econ.marketReactionScore, spreadCondition: econ.spreadCondition, spreadState: econ.spreadCondition,
      volatilityCondition: econ.volatilityCondition, volatilityState: econ.volatilityCondition, restriction: econ.restriction,
      revalidationRequired: econ.revalidationRequired, calendarFeedHealth: econ.calendarFeedHealth, mt5Health: econ.mt5Health,
      updatedAt: econ.updatedAt,
    } : undefined,
  };
}
