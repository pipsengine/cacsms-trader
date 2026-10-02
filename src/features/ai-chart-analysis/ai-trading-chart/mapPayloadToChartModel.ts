import type { AiChartAnalysisPayload } from '../types';
import type { AnalysisResult } from '../production-v4/types';
import type { ChartModel, Candle, ChannelModel, Direction, StructureAnnotation, SupertrendPoint } from './AITradingChart';

const TF_MS: Record<string, number> = {
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H8: 28_800_000,
  D1: 86_400_000,
};

function toMs(t: number): number {
  return t > 1e12 ? Math.floor(t) : Math.floor(t * 1000);
}

function stDirection(raw: string): SupertrendPoint['direction'] {
  const u = raw.toUpperCase();
  if (u === 'DOWN' || u === 'BEARISH') return 'BEARISH';
  return 'BULLISH';
}

const DISPLAY: Record<string, string> = {
  XAUUSD: 'Gold vs US Dollar',
  EURUSD: 'Euro vs US Dollar',
  GBPUSD: 'British Pound vs US Dollar',
};

/** Prefer server `chartView`; build client-side when bridge has not restarted. */
export function mapPayloadToChartModel(
  payload: AiChartAnalysisPayload,
  analysis?: AnalysisResult | null,
): ChartModel | null {
  const server = payload.chartView as ChartModel | undefined;
  if (server?.candles?.length) {
    return {
      ...server,
      instrumentName: server.instrumentName ?? DISPLAY[payload.symbol] ?? payload.symbol,
      symbol: payload.symbol,
      timeframe: payload.primaryTimeframe ?? server.timeframe ?? 'H1',
    };
  }
  return buildClientChartModel(payload, analysis);
}

function buildClientChartModel(
  payload: AiChartAnalysisPayload,
  analysis?: AnalysisResult | null,
): ChartModel | null {
  const tf = payload.primaryTimeframe ?? 'H1';
  const step = TF_MS[tf] ?? TF_MS.H1!;
  const direction = (payload.direction ?? analysis?.direction ?? 'NEUTRAL').toUpperCase();
  const bull = direction === 'BULLISH';

  let candles: Candle[] = (payload.chart?.candles || [])
    .filter((c) => c.complete !== false)
    .map((c, i) => {
      const range = Math.abs(Number(c.high) - Number(c.low));
      const vol = Number((c as { volume?: number }).volume);
      return {
        time: toMs(Number(c.time)),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number.isFinite(vol) && vol > 0 ? vol : range * 800 + (i % 17 === 0 ? 600 : 0),
        closed: true,
      };
    })
    .sort((a, b) => a.time - b.time);

  if (candles.length < 2) return null;

  const lastTime = candles[candles.length - 1]!.time;
  const future = step * 14;
  const levels = analysis?.levels;
  const hints = payload.chartLevels;
  const lines = payload.chart?.channelLines || payload.chart?.lines || [];

  const channels: ChannelModel[] = [];
  if (lines.length >= 2) {
    const l0 = lines[0]!;
    const l1 = lines[lines.length - 1]!;
    const endT = Math.max(toMs(l1.time), lastTime) + future;
    channels.push({
      id: `${tf}-channel`,
      direction: (direction === 'BEARISH' || direction === 'BULLISH' ? direction : 'NEUTRAL') as Direction,
      upperStart: { time: toMs(l0.time), price: l0.upper },
      upperEnd: { time: endT, price: l1.upper },
      lowerStart: { time: toMs(l0.time), price: l0.lower },
      lowerEnd: { time: endT, price: l1.lower },
      medianStart: l0.mid != null ? { time: toMs(l0.time), price: l0.mid } : undefined,
      medianEnd: l1.mid != null ? { time: endT, price: l1.mid } : undefined,
    });
  }

  const supU = hints?.supplyUpper ?? levels?.supply[0];
  const supL = hints?.supplyLower ?? levels?.supply[1];
  const erzU = hints?.erzUpper ?? levels?.erz[0];
  const erzL = hints?.erzLower ?? levels?.erz[1];
  const n = candles.length;
  const zones: ChartModel['zones'] = [];
  if (supU != null && supL != null) {
    zones.push({
      id: 'supply',
      type: 'SUPPLY',
      label: `${tf} Supply`,
      startTime: candles[Math.max(0, Math.floor(n * 0.38))]!.time,
      endTime: lastTime + step * 6,
      high: Math.max(Number(supU), Number(supL)),
      low: Math.min(Number(supU), Number(supL)),
      state: 'ACTIVE',
    });
  }
  if (erzU != null && erzL != null) {
    zones.push({
      id: 'erz',
      type: 'ERZ',
      label: `${tf} ERZ / Demand`,
      startTime: candles[Math.max(0, Math.floor(n * 0.52))]!.time,
      endTime: lastTime + future,
      high: Math.max(Number(erzU), Number(erzL)),
      low: Math.min(Number(erzU), Number(erzL)),
      state: 'REACTION',
    });
  }

  const structures: StructureAnnotation[] = [];
  const swings = (payload.annotations || [])
    .filter((a) => (a.type === 'HIGH' || a.type === 'LOW') && a.candleTimestamp)
    .sort((a, b) => Number(a.candleTimestamp) - Number(b.candleTimestamp))
    .slice(-3);
  let seq = 3;
  for (const sw of swings) {
    structures.push({
      id: sw.id,
      type: sw.type === 'HIGH' ? 'SWING_HIGH' : 'SWING_LOW',
      time: toMs(Number(sw.candleTimestamp)),
      price: Number(sw.price) || candles[candles.length - 1]!.close,
      label: String(seq),
      sequence: seq,
      priority: 70,
      state: 'OBSERVED',
    });
    seq += 1;
  }
  for (const ann of payload.annotations || []) {
    const t = (ann.type || '').toUpperCase();
    if (t !== 'BOS' && t !== 'CHOCH') continue;
    if (!ann.candleTimestamp) continue;
    structures.push({
      id: ann.id,
      type: t as 'BOS' | 'CHOCH',
      time: toMs(Number(ann.candleTimestamp)),
      price: Number(ann.price) || candles[candles.length - 1]!.close,
      label: t === 'CHOCH' ? 'CHOCH' : 'BOS',
      direction: direction as StructureAnnotation['direction'],
      priority: t === 'BOS' ? 95 : 90,
      state: 'CONFIRMED',
    });
  }

  const horiz: ChartModel['levels'] = [];
  const p2 = hints?.p2 ?? levels?.p2;
  const inv = hints?.invalidation ?? levels?.invalidation;
  const t1 = hints?.t1 ?? levels?.t1;
  const t2 = hints?.t2 ?? levels?.t2;
  if (p2 != null) {
    horiz.push({ id: 'p2', type: 'BREAK', price: Number(p2), label: 'P2 Break', direction: direction as 'BULLISH' });
  }
  if (inv != null) {
    horiz.push({ id: 'invalidation', type: 'INVALIDATION', price: Number(inv), label: 'Invalidation' });
  }
  if (t1 != null) horiz.push({ id: 't1', type: 'TARGET', price: Number(t1), label: 'T1' });
  if (t2 != null) horiz.push({ id: 't2', type: 'TARGET', price: Number(t2), label: 'T2' });

  const lastClose = candles[candles.length - 1]!.close;
  const erzMid = hints?.erzMid ?? (erzU != null && erzL != null ? (Number(erzU) + Number(erzL)) / 2 : lastClose);
  const reaction = bull
    ? Number(erzMid) + (Number(p2 ?? lastClose) - Number(erzMid)) * 0.35
    : Number(erzMid) - (Number(erzMid) - Number(p2 ?? lastClose)) * 0.28;
  const pathPrices = [lastClose, reaction, Number(p2 ?? reaction), Number(t1 ?? reaction), Number(t1 ?? lastClose), Number(t2 ?? t1 ?? lastClose)];
  const offsets = [0, 3, 5, 8, 11, 14];
  const labels = ['CURRENT', 'REACTION', 'RETEST', 'BOS', 'T1', 'T2'] as const;
  const projectedScenario = offsets.slice(0, pathPrices.length).map((off, i) => ({
    id: `scenario-${i}`,
    time: lastTime + step * off,
    price: pathPrices[i]!,
    label: labels[i],
  }));

  const supertrend: SupertrendPoint[] = (payload.chart?.supertrendSeries || []).map((p) => ({
    time: toMs(Number(p.time)),
    value: Number(p.value),
    direction: stDirection(String(p.direction)),
  }));

  return {
    symbol: payload.symbol,
    instrumentName: DISPLAY[payload.symbol] ?? payload.symbol,
    timeframe: tf,
    candles,
    supertrend,
    channels,
    zones,
    structures,
    levels: horiz,
    projectedScenario,
    currentPrice: lastClose,
    timezoneLabel: 'UTC+1',
  };
}
