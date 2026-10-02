import type { AnalysisState, TimeframeState } from '../types/analysis';
import type { AutonomousSnapshot } from '../types/autonomous';
import type { ChartModel, Level, LineSeries, Marker, Point } from '../types/chart';

const NAMES: Record<string, string> = {
  XAUUSD: 'Gold vs US Dollar',
  EURUSD: 'Euro vs US Dollar',
  GBPUSD: 'British Pound vs US Dollar',
};

function pt(time: number, price: number): Point {
  return { time, price };
}

function supertrendLines(raw: AutonomousSnapshot['chart']['supertrend']): LineSeries[] {
  if (!raw.length) return [];
  const out: LineSeries[] = [];
  let cur: LineSeries | null = null;
  for (const p of raw) {
    const tone = p.direction === 'BEARISH' ? 'bear' : 'bull';
    const point = pt(p.time, p.value);
    if (!cur || cur.tone !== tone) {
      if (cur && cur.points.length >= 2) out.push(cur);
      cur = { id: `st-${out.length}`, tone, width: 2, points: [point] };
    } else {
      cur.points.push(point);
    }
  }
  if (cur && cur.points.length >= 2) out.push(cur);
  return out;
}

function levelStartTime(candles: { time: number }[], tone: Level['tone']): number | undefined {
  if (!candles.length) return undefined;
  const n = candles.length;
  const idx =
    tone === 'invalid' ? Math.floor(n * 0.32) : tone === 'break' ? Math.floor(n * 0.58) : Math.floor(n * 0.68);
  return candles[Math.max(0, Math.min(n - 1, idx))]!.time;
}

/** AutonomousSnapshot → v3 TradingChart model (reference visual contract). */
export function snapshotToChartModel(snapshot: AutonomousSnapshot): ChartModel {
  const ch = snapshot.chart;
  const candles = ch.candles;
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2];
  const channel0 = ch.channels[0];

  const levels: Level[] = ch.levels.map((l) => {
    const tone =
      l.kind === 'TARGET' ? 'target' : l.kind === 'INVALIDATION' ? 'invalid' : l.kind === 'BREAK' ? 'break' : 'break';
    return {
      id: l.id,
      price: l.price,
      label: l.label,
      tone,
      fromTime: levelStartTime(candles, tone),
    };
  });
  levels.push({
    id: 'live-price',
    price: last.close,
    label: last.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    tone: 'price',
  });

  const markers: Marker[] = ch.annotations.map((a) => {
    if (a.kind === 'SWING_HIGH' || a.kind === 'SWING_LOW') {
      return {
        id: a.id,
        time: a.time,
        price: a.price,
        label: a.label,
        tone: 'number',
        number: Number(a.label) || undefined,
      };
    }
    return {
      id: a.id,
      time: a.time,
      price: a.price,
      label: a.label,
      tone: a.kind === 'CHOCH' ? 'choch' : 'bos',
    };
  });

  const zones = ch.zones.map((z) => ({
    id: z.id,
    from: z.from,
    to: z.to,
    low: z.low,
    high: z.high,
    label: z.label,
    tone: z.kind === 'SUPPLY' ? ('supply' as const) : ('demand' as const),
  }));

  return {
    symbol: snapshot.symbol,
    name: NAMES[snapshot.symbol] ?? snapshot.symbol,
    timeframe: snapshot.primaryTimeframe,
    ohlc: { ...last, open: prev?.close ?? last.open },
    candles,
    supertrend: supertrendLines(ch.supertrend),
    channel: {
      upper: channel0?.upper ?? [],
      lower: channel0?.lower ?? [],
      mid: channel0?.median,
    },
    zones,
    levels,
    markers,
    scenario: ch.scenario.map((s) => pt(s.time, s.price)),
  };
}

export function snapshotToAnalysisPanel(snapshot: AutonomousSnapshot): AnalysisState {
  const support = snapshot.evidence.filter((e) => e.kind === 'SUPPORTING').map((e) => ({ id: e.id, text: e.text, tone: 'support' as const }));
  const conflict = snapshot.evidence.filter((e) => e.kind === 'CONFLICTING').map((e) => ({ id: e.id, text: e.text, tone: 'conflict' as const }));
  const missing = snapshot.evidence.filter((e) => e.kind === 'MISSING').map((e) => ({ id: e.id, text: e.text, tone: 'missing' as const }));

  const pathLabels = ['ERZ', 'Reaction', 'BOS', 'Retest', 'T1', 'T2'];
  const expectedPath = pathLabels.map((label, i) => ({
    label,
    state: (i < 2 ? 'complete' : i === 2 ? 'current' : 'pending') as 'complete' | 'current' | 'pending',
  }));

  return {
    analysisId: snapshot.analysisId,
    symbol: snapshot.symbol,
    timeframe: snapshot.primaryTimeframe,
    status: snapshot.lifecycle.replace(/_/g, ' ').toUpperCase(),
    title: snapshot.primaryThesis.title,
    summary: snapshot.primaryThesis.summary,
    direction: snapshot.direction.charAt(0) + snapshot.direction.slice(1).toLowerCase(),
    marketState: snapshot.marketState.replace(/_/g, ' '),
    structure: snapshot.structure,
    evidenceScore: snapshot.evidenceScore ?? 0,
    support,
    conflict,
    missing,
    location: snapshot.engineStates.opportunity,
    supertrend: snapshot.engineStates.supertrend,
    alignment: snapshot.timeframes.filter((t) => t.direction === 'BULLISH').slice(0, 3).map((t) => `${t.timeframe} ${t.direction}`),
    expectedPath,
  };
}

export function snapshotToTimeframeStrip(snapshot: AutonomousSnapshot, activeTf: string): TimeframeState[] {
  return snapshot.timeframes.map((t) => ({
    tf: t.timeframe,
    direction: t.direction.charAt(0) + t.direction.slice(1).toLowerCase(),
    state: t.marketState.replace(/_/g, ' '),
    score: Math.round(t.evidenceScore ?? 0),
    tone: t.direction === 'BEARISH' ? 'bear' : 'bull',
    arrow: 'up',
  }));
}
