import type { AiChartAnalysisPayload } from '../../types';
import type { AnalysisResult, Timeframe } from '../../production-v4/types';
import { finiteNumber, toChartTimeSeconds } from '../../production-v4/chartMath';
import type { AutonomousSnapshot, AutonomousTimeframe } from '../types/autonomous';

const TF_MS: Record<string, number> = {
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H8: 28_800_000,
  D1: 86_400_000,
};

const TF_ORDER = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'] as const;

function toMs(raw: number): number {
  return raw > 1e12 ? Math.floor(raw) : Math.floor(raw * 1000);
}

function stDir(raw: string): 'BULLISH' | 'BEARISH' {
  const u = raw.toUpperCase();
  return u === 'DOWN' || u === 'BEARISH' ? 'BEARISH' : 'BULLISH';
}

function mapLifecycle(status?: string): AutonomousSnapshot['lifecycle'] {
  const s = (status || '').toUpperCase();
  if (s.includes('CONFIRM')) return 'CONFIRMATION_PENDING';
  if (s.includes('TRADABLE') || s.includes('READY')) return 'NEAR_CONFIRMATION';
  if (s.includes('SETUP') || s.includes('DEVELOP')) return 'SETUP_DEVELOPING';
  if (s.includes('WATCH')) return 'WATCHING';
  return 'SETUP_DEVELOPING';
}

function mapMarketState(ms?: string): AutonomousSnapshot['marketState'] {
  const u = (ms || 'UNCLEAR').toUpperCase().replace(/ /g, '_') as AutonomousSnapshot['marketState'];
  const allowed: AutonomousSnapshot['marketState'][] = [
    'TRENDING',
    'PULLBACK',
    'RANGING',
    'COMPRESSION',
    'BREAKOUT_DEVELOPING',
    'BREAKOUT_CONFIRMED',
    'RETEST',
    'REVERSAL_DEVELOPING',
    'REVERSAL_CONFIRMED',
    'EXHAUSTION',
    'TRANSITION',
    'UNCLEAR',
  ];
  return allowed.includes(u) ? u : 'UNCLEAR';
}

function candleAt(candles: { time: number }[], ratio: number) {
  const i = Math.max(0, Math.min(candles.length - 1, Math.floor(candles.length * ratio)));
  return candles[i]!;
}

type ChartLineRow = { time: number; upper: number; lower: number; mid?: number | null };

type ChartViewChannel = {
  id?: string;
  upperStart?: { time: number; price: number };
  upperEnd?: { time: number; price: number };
  lowerStart?: { time: number; price: number };
  lowerEnd?: { time: number; price: number };
  medianStart?: { time: number; price: number };
  medianEnd?: { time: number; price: number };
};

function channelsFromChartView(view: { channels?: ChartViewChannel[] } | undefined, tf: string) {
  const out: AutonomousSnapshot['chart']['channels'] = [];
  for (const ch of view?.channels || []) {
    if (!ch.upperStart || !ch.upperEnd || !ch.lowerStart || !ch.lowerEnd) continue;
    const entry: AutonomousSnapshot['chart']['channels'][number] = {
      id: ch.id || `${tf}-channel`,
      upper: [
        { time: toMs(ch.upperStart.time), price: ch.upperStart.price },
        { time: toMs(ch.upperEnd.time), price: ch.upperEnd.price },
      ],
      lower: [
        { time: toMs(ch.lowerStart.time), price: ch.lowerStart.price },
        { time: toMs(ch.lowerEnd.time), price: ch.lowerEnd.price },
      ],
    };
    if (ch.medianStart && ch.medianEnd) {
      entry.median = [
        { time: toMs(ch.medianStart.time), price: ch.medianStart.price },
        { time: toMs(ch.medianEnd.time), price: ch.medianEnd.price },
      ];
    }
    out.push(entry);
  }
  return out;
}

function channelsFromLineRows(lines: ChartLineRow[], lastTime: number, step: number, tf: string) {
  if (lines.length < 1) return [] as AutonomousSnapshot['chart']['channels'];
  const sorted = [...lines].sort((a, b) => toMs(a.time) - toMs(b.time));
  const l0 = sorted[0]!;
  const l1 = sorted[sorted.length - 1]!;
  const endT = Math.max(toMs(l1.time), lastTime) + step * 14;
  const ch: AutonomousSnapshot['chart']['channels'][number] = {
    id: `${tf}-channel`,
    upper: [
      { time: toMs(l0.time), price: l0.upper },
      { time: endT, price: l1.upper },
    ],
    lower: [
      { time: toMs(l0.time), price: l0.lower },
      { time: endT, price: l1.lower },
    ],
  };
  if (l0.mid != null && l1.mid != null) {
    ch.median = [
      { time: toMs(l0.time), price: l0.mid },
      { time: endT, price: l1.mid },
    ];
  }
  return [ch];
}

/** Bridge `/latest` payload → v3 AutonomousSnapshot (single immutable view model). */
export function bridgePayloadToSnapshot(
  payload: AiChartAnalysisPayload,
  analysis: AnalysisResult | null,
  primaryTf: Timeframe,
): AutonomousSnapshot | null {
  if (!payload.ok) return null;

  const tf = payload.primaryTimeframe ?? primaryTf ?? 'H1';
  const step = TF_MS[tf] ?? TF_MS.H1!;

  const candles = (payload.chart?.candles || [])
    .filter((c) => c.complete !== false)
    .map((c, i) => {
      const range = Math.abs(c.high - c.low);
      const vol = (c as { volume?: number }).volume;
      return {
        time: toMs(toChartTimeSeconds(c.time) ?? 0),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: finiteNumber(vol) && vol! > 0 ? Number(vol) : 20 + Math.round(range * 800) + (i % 17 === 0 ? 40 : 0),
      };
    })
    .sort((a, b) => a.time - b.time);

  if (candles.length < 2) return null;

  const last = candles[candles.length - 1]!;
  const hints = payload.chartLevels;
  const levels = analysis?.levels;
  const lines = (payload.chart?.channelLines || payload.chart?.lines || []) as ChartLineRow[];
  const chartView = payload.chartView as
    | { channels?: ChartViewChannel[]; projectedScenario?: { time: number; price: number; label?: string }[] }
    | undefined;
  const fromLines = channelsFromLineRows(lines, last.time, step, tf);
  const channels = fromLines.length > 0 ? fromLines : channelsFromChartView(chartView, tf);

  const zones: AutonomousSnapshot['chart']['zones'] = [];
  const supU = hints?.supplyUpper ?? levels?.supply[0];
  const supL = hints?.supplyLower ?? levels?.supply[1];
  if (supU != null && supL != null) {
    zones.push({
      id: 'supply',
      kind: 'SUPPLY',
      label: `${tf} Supply`,
      from: candleAt(candles, 0.38).time,
      to: last.time + step * 6,
      high: Math.max(Number(supU), Number(supL)),
      low: Math.min(Number(supU), Number(supL)),
    });
  }
  const erzU = hints?.erzUpper ?? levels?.erz[0];
  const erzL = hints?.erzLower ?? levels?.erz[1];
  if (erzU != null && erzL != null) {
    zones.push({
      id: 'erz',
      kind: 'ERZ',
      label: `${tf} ERZ / Demand`,
      from: candleAt(candles, 0.52).time,
      to: last.time + step * 14,
      high: Math.max(Number(erzU), Number(erzL)),
      low: Math.min(Number(erzU), Number(erzL)),
    });
  }

  const chartLevels: AutonomousSnapshot['chart']['levels'] = [];
  const p2 = hints?.p2 ?? levels?.p2;
  const inv = hints?.invalidation ?? levels?.invalidation;
  const t1 = hints?.t1 ?? levels?.t1;
  const t2 = hints?.t2 ?? levels?.t2;
  if (t2 != null) chartLevels.push({ id: 't2', kind: 'TARGET', price: Number(t2), label: `T2 ${Number(t2).toFixed(2)}` });
  if (t1 != null) chartLevels.push({ id: 't1', kind: 'TARGET', price: Number(t1), label: `T1 ${Number(t1).toFixed(2)}` });
  if (inv != null) chartLevels.push({ id: 'inv', kind: 'INVALIDATION', price: Number(inv), label: `Invalidation ${Number(inv).toFixed(2)}` });
  if (p2 != null) chartLevels.push({ id: 'p2', kind: 'BREAK', price: Number(p2), label: 'P2 Break' });

  const annotations: AutonomousSnapshot['chart']['annotations'] = [];
  const swings = (payload.annotations || [])
    .filter((a) => (a.type === 'HIGH' || a.type === 'LOW') && a.candleTimestamp)
    .sort((a, b) => Number(a.candleTimestamp) - Number(b.candleTimestamp))
    .slice(-3);
  let seq = 3;
  for (const sw of swings) {
    annotations.push({
      id: sw.id,
      kind: sw.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
      time: toMs(Number(sw.candleTimestamp)),
      price: Number(sw.price) || last.close,
      label: String(seq),
      priority: 70,
    });
    seq += 1;
  }
  for (const ann of payload.annotations || []) {
    const t = (ann.type || '').toUpperCase();
    if (t !== 'BOS' && t !== 'CHOCH') continue;
    if (!ann.candleTimestamp) continue;
    annotations.push({
      id: ann.id,
      kind: t as 'BOS' | 'CHOCH',
      time: toMs(Number(ann.candleTimestamp)),
      price: Number(ann.price) || last.close,
      label: t === 'CHOCH' ? 'CHOCH' : 'BOS',
      priority: t === 'BOS' ? 95 : 90,
    });
  }

  let scenario: AutonomousSnapshot['chart']['scenario'] = (chartView?.projectedScenario || []).map((p, i) => ({
    id: `s-${i}`,
    time: toMs(p.time),
    price: Number(p.price),
    label: p.label || '',
    state: 'PROJECTED' as const,
  }));
  if (scenario.length < 2) {
    const erzMid =
      hints?.erzMid ?? (erzU != null && erzL != null ? (Number(erzU) + Number(erzL)) / 2 : last.close);
    const knots = [
      { t: 0, p: last.close },
      { t: 3, p: Number(erzMid) + (Number(p2 ?? last.close) - Number(erzMid)) * 0.4 },
      { t: 5, p: Number(p2 ?? last.close) },
      { t: 8, p: Number(t1 ?? last.close) },
      { t: 11, p: Number(t1 ?? last.close) },
      { t: 14, p: Number(t2 ?? t1 ?? last.close) },
    ];
    scenario = knots.map((k, i) => ({
      id: `s-${i}`,
      time: last.time + step * k.t,
      price: k.p,
      label: ['CURRENT', 'REACTION', 'RETEST', 'BOS', 'T1', 'T2'][i] || '',
      state: 'PROJECTED' as const,
    }));
  }

  const supertrend = (payload.chart?.supertrendSeries || []).map((p) => ({
    time: toMs(Number(p.time)),
    value: Number(p.value),
    direction: stDir(String(p.direction)),
  }));

  const timeframes: AutonomousTimeframe[] = TF_ORDER.map((t) => {
    const row = payload.timeframeStrip?.find((r) => r.timeframe === t);
    const dir = (row?.direction || 'NEUTRAL').toUpperCase() as AutonomousTimeframe['direction'];
    return {
      timeframe: t,
      direction: dir === 'BEARISH' || dir === 'BULLISH' || dir === 'MIXED' ? dir : 'NEUTRAL',
      marketState: mapMarketState(row?.marketState),
      evidenceScore: row?.confidence ?? null,
      closedBarTime: row?.lastClosedCandleMs ? toMs(row.lastClosedCandleMs) : last.time,
      structure: row?.structure,
      channel: row?.channelState,
      supertrend: row?.supertrend,
    };
  });

  const evidence = [
    ...(payload.supportingEvidence || []).slice(0, 8).map((e, i) => ({
      id: `sup-${i}`,
      kind: 'SUPPORTING' as const,
      source: 'AI' as const,
      text: e.text || '—',
      observedAt: Date.now(),
    })),
    ...(payload.conflictingEvidence || []).slice(0, 6).map((e, i) => ({
      id: `con-${i}`,
      kind: 'CONFLICTING' as const,
      source: 'AI' as const,
      text: e.text || '—',
      observedAt: Date.now(),
    })),
    ...(payload.missingEvidence || []).slice(0, 6).map((e, i) => ({
      id: `mis-${i}`,
      kind: 'MISSING' as const,
      source: 'AI' as const,
      text: e.text || '—',
      observedAt: Date.now(),
    })),
  ];

  const created = payload.analysisTimestamp ? Date.parse(payload.analysisTimestamp) : Date.now();
  const dir = (payload.direction || analysis?.direction || 'NEUTRAL').toUpperCase() as AutonomousSnapshot['direction'];

  return {
    schemaVersion: 1,
    analysisId: payload.analysisId,
    symbol: payload.symbol,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: payload.generatedAtMs ?? Date.now(),
    primaryTimeframe: tf,
    lifecycle: mapLifecycle(payload.status),
    marketState: mapMarketState(payload.marketState),
    direction: dir === 'BEARISH' || dir === 'BULLISH' || dir === 'MIXED' ? dir : 'NEUTRAL',
    structure: analysis?.structure || '—',
    evidenceScore: payload.confidence ?? analysis?.evidenceScore ?? null,
    primaryThesis: {
      type: 'PRIMARY',
      title: payload.thesisTitle || analysis?.thesisTitle || 'Market interpretation',
      summary: payload.thesis || analysis?.thesis || '—',
      invalidationReason: String(inv ?? 'See chart invalidation level'),
    },
    timeframes,
    evidence,
    tradability: (payload.tradabilityChain || []).map((s, i) => ({
      id: `t-${i}`,
      label: s.stage.replace(/_/g, ' '),
      state:
        s.state === 'COMPLETE'
          ? 'COMPLETE'
          : s.state === 'ACTIVE'
            ? 'ACTIVE'
            : s.state === 'FAILED'
              ? 'FAILED'
              : 'PENDING',
      reason: s.detail,
    })),
    reconciliation: (payload.reconciliation?.agreement as AutonomousSnapshot['reconciliation']) || 'PARTIAL',
    nextExpectedEvent: payload.scenarios?.primary?.nextExpectedEvent,
    engineStates: {
      channel: 'ACTIVE',
      supertrend: analysis?.supertrend || '—',
      strength: '—',
      opportunity: payload.opportunity || '—',
      p1p2: `${payload.p1State || '—'} / ${payload.p2State || '—'}`,
      confirmation: payload.tradabilityChain?.find((t) => t.stage.includes('CONFIRM'))?.state || '—',
    },
    chart: {
      candles,
      supertrend,
      channels,
      zones,
      annotations,
      levels: chartLevels,
      scenario,
    },
  };
}
