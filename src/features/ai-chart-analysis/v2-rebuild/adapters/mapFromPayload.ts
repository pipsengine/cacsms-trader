import type { AiChartAnalysisPayload } from '../../types';
import type { AnalysisResult, Timeframe } from '../../production-v4/types';
import { finiteNumber, toChartTimeSeconds } from '../../production-v4/chartMath';
import type { AnalysisState, TimeframeState } from '../types/analysis';
import type { ChartModel, Candle, LineSeries, Marker, Point, Zone } from '../types/chart';

const TF_MS: Record<string, number> = {
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H8: 28_800_000,
  D1: 86_400_000,
};

const NAMES: Record<string, string> = {
  XAUUSD: 'Gold vs US Dollar',
  EURUSD: 'Euro vs US Dollar',
  GBPUSD: 'British Pound vs US Dollar',
};

function toMs(raw: number): number {
  return raw > 1e12 ? Math.floor(raw) : Math.floor(raw * 1000);
}

function fmtPriceLabel(prefix: string, price: number): string {
  return `${prefix} ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pt(time: number, price: number): Point {
  return { time, price };
}

function buildCandles(payload: AiChartAnalysisPayload): Candle[] {
  return (payload.chart?.candles || [])
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
}

function buildChannel(candles: Candle[], payload: AiChartAnalysisPayload): ChartModel['channel'] {
  const lines = payload.chart?.channelLines || payload.chart?.lines || [];
  if (lines.length < 2 || !candles.length) {
    return { upper: [], lower: [] };
  }
  const l0 = lines[0]!;
  const l1 = lines[lines.length - 1]!;
  const endT = Math.max(toMs(l1.time), candles[candles.length - 1]!.time) + (TF_MS[payload.primaryTimeframe ?? 'H1'] ?? 3_600_000) * 14;
  return {
    upper: [pt(toMs(l0.time), l0.upper), pt(endT, l1.upper)],
    lower: [pt(toMs(l0.time), l0.lower), pt(endT, l1.lower)],
    mid:
      l0.mid != null && l1.mid != null
        ? [pt(toMs(l0.time), l0.mid), pt(endT, l1.mid)]
        : undefined,
  };
}

function buildSupertrend(candles: Candle[], payload: AiChartAnalysisPayload): LineSeries[] {
  const raw = payload.chart?.supertrendSeries || [];
  if (!raw.length) return [];
  const points: Point[] = raw
    .map((p) => pt(toMs(Number(p.time)), Number(p.value)))
    .sort((a, b) => a.time - b.time);
  const out: LineSeries[] = [];
  let cur: LineSeries | null = null;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]!;
    const dir = String(p.direction || '').toUpperCase();
    const tone = dir === 'DOWN' || dir === 'BEARISH' ? 'bear' : 'bull';
    const point = points[i]!;
    if (!cur || cur.tone !== tone) {
      if (cur && cur.points.length) out.push(cur);
      cur = { id: `st-${out.length}`, tone, width: 2, points: [point] };
    } else {
      cur.points.push(point);
    }
  }
  if (cur?.points.length) out.push(cur);
  return out.filter((s) => s.points.length >= 2);
}

function candleAt(candles: Candle[], ratio: number): Candle {
  const i = Math.max(0, Math.min(candles.length - 1, Math.floor(candles.length * ratio)));
  return candles[i]!;
}

export function mapPayloadToV2ChartModel(
  payload: AiChartAnalysisPayload,
  analysis: AnalysisResult | null,
  primaryTf: Timeframe,
): ChartModel | null {
  const candles = buildCandles(payload);
  if (candles.length < 2) return null;

  const tf = payload.primaryTimeframe ?? primaryTf ?? 'H1';
  const step = TF_MS[tf] ?? TF_MS.H1!;
  const last = candles[candles.length - 1]!;
  const hints = payload.chartLevels;
  const levels = analysis?.levels;
  const n = candles.length;

  const supU = hints?.supplyUpper ?? levels?.supply[0];
  const supL = hints?.supplyLower ?? levels?.supply[1];
  const erzU = hints?.erzUpper ?? levels?.erz[0];
  const erzL = hints?.erzLower ?? levels?.erz[1];

  const zones: Zone[] = [];
  if (supU != null && supL != null) {
    zones.push({
      id: 'supply',
      from: candleAt(candles, 0.38).time,
      to: last.time + step * 6,
      low: Math.min(Number(supU), Number(supL)),
      high: Math.max(Number(supU), Number(supL)),
      label: `${tf} Supply`,
      tone: 'supply',
    });
  }
  if (erzU != null && erzL != null) {
    zones.push({
      id: 'demand',
      from: candleAt(candles, 0.52).time,
      to: last.time + step * 14,
      low: Math.min(Number(erzU), Number(erzL)),
      high: Math.max(Number(erzU), Number(erzL)),
      label: `${tf} ERZ / Demand`,
      tone: 'demand',
    });
  }

  const p2 = hints?.p2 ?? levels?.p2;
  const inv = hints?.invalidation ?? levels?.invalidation;
  const t1 = hints?.t1 ?? levels?.t1;
  const t2 = hints?.t2 ?? levels?.t2;

  const chartLevels: ChartModel['levels'] = [];
  if (t2 != null) {
    chartLevels.push({
      id: 't2',
      price: Number(t2),
      label: fmtPriceLabel('T2', Number(t2)),
      tone: 'target',
      fromTime: candleAt(candles, 0.72).time,
    });
  }
  if (t1 != null) {
    chartLevels.push({
      id: 't1',
      price: Number(t1),
      label: fmtPriceLabel('T1', Number(t1)),
      tone: 'target',
      fromTime: candleAt(candles, 0.68).time,
    });
  }
  if (inv != null) {
    chartLevels.push({
      id: 'inv',
      price: Number(inv),
      label: fmtPriceLabel('Invalidation', Number(inv)),
      tone: 'invalid',
      fromTime: candleAt(candles, 0.32).time,
    });
  }
  if (p2 != null) {
    chartLevels.push({
      id: 'p2',
      price: Number(p2),
      label: 'P2 Break',
      tone: 'break',
      fromTime: candleAt(candles, 0.58).time,
    });
  }
  chartLevels.push({
    id: 'price',
    price: last.close,
    label: fmtPriceLabel('', last.close).trim(),
    tone: 'price',
  });

  const markers: Marker[] = [];
  const swings = (payload.annotations || [])
    .filter((a) => (a.type === 'HIGH' || a.type === 'LOW') && a.candleTimestamp)
    .sort((a, b) => Number(a.candleTimestamp) - Number(b.candleTimestamp))
    .slice(-3);
  let num = 3;
  for (const sw of swings) {
    markers.push({
      id: sw.id,
      time: toMs(Number(sw.candleTimestamp)),
      price: Number(sw.price) || last.close,
      label: String(num),
      tone: 'number',
      number: num,
    });
    num += 1;
  }
  for (const ann of payload.annotations || []) {
    const t = (ann.type || '').toUpperCase();
    if (t !== 'BOS' && t !== 'CHOCH') continue;
    if (!ann.candleTimestamp) continue;
    markers.push({
      id: ann.id,
      time: toMs(Number(ann.candleTimestamp)),
      price: Number(ann.price) || last.close,
      label: t === 'CHOCH' ? 'CHOCH' : 'BOS',
      tone: t === 'CHOCH' ? 'choch' : 'bos',
    });
  }

  const view = payload.chartView as { projectedScenario?: { time: number; price: number }[] } | undefined;
  let scenario: Point[] = (view?.projectedScenario || []).map((p) => pt(toMs(p.time), Number(p.price)));
  if (scenario.length < 2) {
    const erzMid =
      hints?.erzMid ??
      (erzU != null && erzL != null ? (Number(erzU) + Number(erzL)) / 2 : last.close);
    scenario = [
      pt(last.time, last.close),
      pt(last.time + step * 3, Number(erzMid) + (Number(p2 ?? last.close) - Number(erzMid)) * 0.4),
      pt(last.time + step * 5, Number(p2 ?? last.close)),
      pt(last.time + step * 8, Number(t1 ?? last.close)),
      pt(last.time + step * 11, Number(t1 ?? last.close)),
      pt(last.time + step * 14, Number(t2 ?? t1 ?? last.close)),
    ];
  }

  const prev = candles[n - 2];
  const ohlc: Candle = {
    ...last,
    open: prev ? prev.close : last.open,
  };

  return {
    symbol: payload.symbol,
    name: NAMES[payload.symbol] ?? payload.symbol,
    timeframe: tf,
    ohlc,
    candles,
    supertrend: buildSupertrend(candles, payload),
    channel: buildChannel(candles, payload),
    zones,
    levels: chartLevels,
    markers,
    scenario,
  };
}

export function mapPayloadToV2Analysis(
  payload: AiChartAnalysisPayload,
  analysis: AnalysisResult | null,
  primaryTf: Timeframe,
): AnalysisState {
  const tf = primaryTf ?? 'H1';
  const support = (payload.supportingEvidence || []).slice(0, 8).map((e, i) => ({
    id: `s-${i}`,
    text: e.text || '—',
    tone: 'support' as const,
  }));
  const conflict = (payload.conflictingEvidence || []).slice(0, 6).map((e, i) => ({
    id: `c-${i}`,
    text: e.text || '—',
    tone: 'conflict' as const,
  }));
  const missing = (payload.missingEvidence || []).slice(0, 6).map((e, i) => ({
    id: `m-${i}`,
    text: e.text || '—',
    tone: 'missing' as const,
  }));

  const expectedPath =
    analysis?.expectedPath?.map((step) => ({
      label: step.label,
      state: (step.status === 'done' ? 'complete' : step.status === 'current' ? 'current' : 'pending') as
        | 'complete'
        | 'current'
        | 'pending',
    })) ??
    (payload.scenarios?.primary?.pathLabels || ['ERZ', 'Reaction', 'BOS', 'Retest', 'T1', 'T2']).map((label, i) => ({
      label,
      state: (i < 2 ? 'complete' : i === 2 ? 'current' : 'pending') as 'complete' | 'current' | 'pending',
    }));

  return {
    analysisId: payload.analysisId,
    symbol: payload.symbol,
    timeframe: tf,
    status: (payload.status || analysis?.status || 'SETUP DEVELOPING').replace(/_/g, ' ').toUpperCase(),
    title: payload.thesisTitle || analysis?.thesisTitle || 'Market interpretation',
    summary: payload.thesis || analysis?.thesis || '—',
    direction: (payload.direction || 'NEUTRAL').charAt(0) + (payload.direction || 'neutral').slice(1).toLowerCase(),
    marketState: (payload.marketState || 'UNCLEAR').replace(/_/g, ' '),
    structure: analysis?.structure || '—',
    evidenceScore: Math.round(payload.confidence ?? analysis?.evidenceScore ?? 0),
    support,
    conflict,
    missing,
    location: analysis?.priceLocation?.replace(' · ', '\n') || '—',
    supertrend: analysis?.supertrend === 'BULLISH' ? 'Bullish' : analysis?.supertrend === 'BEARISH' ? 'Bearish' : 'Neutral',
    alignment: analysis?.htfAlignment || [],
    expectedPath,
  };
}

export function mapPayloadToV2Timeframes(
  payload: AiChartAnalysisPayload,
  activeTf: Timeframe,
): TimeframeState[] {
  const strip = payload.timeframeStrip || [];
  const order = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'];
  return order.map((tf) => {
    const row = strip.find((r) => r.timeframe === tf);
    const dir = (row?.direction || 'NEUTRAL').toLowerCase();
    const bear = dir.includes('bear');
    return {
      tf,
      direction: row?.directionShort || row?.direction || '—',
      state: (row?.marketState || row?.structure || '—').replace(/_/g, ' '),
      score: Math.round(row?.confidence ?? 0),
      tone: bear ? 'bear' : 'bull',
      arrow: 'up' as const,
    };
  });
}
