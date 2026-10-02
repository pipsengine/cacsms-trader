import type { AiChartAnalysisPayload } from '../types';
import {
  expectedPath,
  priceLocationCopy,
  structureLabel,
  synthesizeEvidence,
  thesisBrief,
} from '../figma/evidenceSynthesis';
import { thesisTitle } from '../figma/mapAnalysis';
import { finiteNumber, normalizeCandles, toChartTimeSeconds } from './chartMath';
import { canonicalizeThesisLevels } from './thesisLevels';
import { directionLabel, marketStateLabel } from './displayFormat';
import type {
  AnalysisResult,
  Annotation,
  Candle,
  Direction,
  Evidence,
  EvidenceKind,
  Reconciliation,
  Scenario,
  Timeframe,
  TradabilityStep,
} from './types';

const TFS: Timeframe[] = ['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'];

function asDir(v?: string): Direction {
  const u = (v || 'NEUTRAL').toUpperCase();
  if (u === 'BULLISH' || u === 'BEARISH' || u === 'MIXED') return u;
  return 'NEUTRAL';
}

function asTf(v?: string): Timeframe {
  const u = (v || 'H1').toUpperCase() as Timeframe;
  return TFS.includes(u) ? u : 'H1';
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapCandles(payload: AiChartAnalysisPayload): Candle[] {
  const raw = (payload.chart?.candles || [])
    .filter((c) => c.complete !== false)
    .map((c) => {
      const time = toChartTimeSeconds(c.time) ?? 0;
      return {
        time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: 0,
        closed: true,
      };
    });
  return normalizeCandles(raw);
}

function candleIndex(candles: Candle[], ts?: number): number {
  if (!ts || !candles.length) return Math.max(0, candles.length - 1);
  const t = ts > 1e12 ? Math.floor(ts / 1000) : ts;
  let best = 0;
  let bestD = Infinity;
  candles.forEach((c, i) => {
    const d = Math.abs(c.time - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function mapAnnotations(payload: AiChartAnalysisPayload, candles: Candle[]): Annotation[] {
  const tone = (type: string): Annotation['tone'] => {
    if (type.includes('INVALIDATION') || type === 'HIGH') return 'bad';
    if (type === 'BOS' || type === 'CHOCH') return 'info';
    if (type === 'ERZ') return 'good';
    return 'neutral';
  };
  return (payload.annotations || [])
    .slice(0, 12)
    .map((a, i) => {
      const fallback = candles[candleIndex(candles, a.candleTimestamp)]?.close;
      const price = finiteNumber(a.price) ?? finiteNumber(fallback);
      return {
        id: a.id || `ann-${i}`,
        kind: a.type,
        label: (a.label || a.type || '').slice(0, 8),
        price: price ?? 0,
        timeIndex: candleIndex(candles, a.candleTimestamp),
        tone: tone((a.type || '').toUpperCase()),
        priority: i,
      };
    })
    .filter((a) => finiteNumber(a.price) !== null);
}

function mapEvidence(payload: AiChartAnalysisPayload): Evidence[] {
  const synth = synthesizeEvidence(payload);
  const rows = [...synth.supporting, ...synth.conflicting, ...synth.missing];
  const kindMap: Record<string, EvidenceKind> = {
    support: 'SUPPORTING',
    conflict: 'CONFLICTING',
    missing: 'MISSING',
  };
  return rows.map((r, i) => ({
    id: `ev-${i}`,
    kind: kindMap[r.kind],
    timeframe: asTf(r.tf),
    label: r.title,
    detail: r.detail,
    source: r.detail,
    priority: 100 - i,
  }));
}

function lastChannelLine(payload: AiChartAnalysisPayload) {
  const lines = payload.chart?.channelLines || payload.chart?.lines || [];
  return lines.length ? lines[lines.length - 1] : null;
}

function bandFromChannel(payload: AiChartAnalysisPayload, range: number) {
  const line = lastChannelLine(payload);
  if (!line) return null;
  const upper = finiteNumber(line.upper);
  const lower = finiteNumber(line.lower);
  if (upper === null || lower === null) return null;
  const width = Math.abs(upper - lower) || range * 0.05;
  return {
    width,
    supply: [upper + width * 0.02, upper - width * 0.12] as [number, number],
    erz: [lower + width * 0.08, lower - width * 0.04] as [number, number],
    mid: (upper + lower) / 2,
    upper,
    lower,
  };
}

function hintsLookLikeFullChannel(
  supU: number | null,
  supL: number | null,
  channelWidth: number,
): boolean {
  if (supU === null || supL === null || channelWidth <= 0) return false;
  return Math.abs(supU - supL) > channelWidth * 0.45;
}

function computeLevels(candles: Candle[], payload: AiChartAnalysisPayload, direction: Direction) {
  const valid = normalizeCandles(candles);
  if (!valid.length) {
    return {
      erz: [0, 0] as [number, number],
      supply: [0, 0] as [number, number],
      p2: 0,
      invalidation: 0,
      t1: 0,
      t2: 0,
    };
  }
  const closes = valid.map((c) => c.close);
  const highs = valid.map((c) => c.high);
  const lows = valid.map((c) => c.low);
  const last = closes[closes.length - 1] ?? 1;
  const maxH = Math.max(...highs, last);
  const minL = Math.min(...lows, last);
  const range = maxH - minL || Math.abs(last) * 0.01 || 1;
  const hints = payload.chartLevels;
  const targetPath = payload.scenarios?.primary?.targetPath;
  const invAnn = payload.annotations?.find((a) => a.type === 'INVALIDATION');
  const invFromAnn = finiteNumber(invAnn?.price);
  const erzAnn = payload.annotations?.find((a) => a.type === 'ERZ');
  const erzPrice = finiteNumber(erzAnn?.price);
  const inv =
    finiteNumber(hints?.invalidation) ??
    invFromAnn ??
    (direction === 'BULLISH' ? minL - range * 0.15 : maxH + range * 0.15);
  const erzLo = finiteNumber(hints?.erzLower);
  const erzHi = finiteNumber(hints?.erzUpper);
  const erzMid =
    finiteNumber(hints?.erzMid) ??
    erzPrice ??
    (erzLo !== null && erzHi !== null ? (erzLo + erzHi) / 2 : null) ??
    (direction === 'BULLISH' ? minL + range * 0.25 : maxH - range * 0.25);
  const channelBand = bandFromChannel(payload, range);
  let erzBand: [number, number] =
    erzLo !== null && erzHi !== null
      ? ([Math.max(erzLo, erzHi), Math.min(erzLo, erzHi)] as [number, number])
      : channelBand?.erz ??
        ([erzMid + range * 0.03, erzMid - range * 0.03] as [number, number]);
  const supU = finiteNumber(hints?.supplyUpper);
  const supL = finiteNumber(hints?.supplyLower);
  let supply: [number, number];
  if (
    supU !== null &&
    supL !== null &&
    !hintsLookLikeFullChannel(supU, supL, channelBand?.width ?? range)
  ) {
    supply = [Math.max(supU, supL), Math.min(supU, supL)] as [number, number];
  } else if (channelBand) {
    supply = channelBand.supply;
  } else {
    supply = [maxH + range * 0.01, maxH - range * 0.06];
  }
  const p2 =
    finiteNumber(hints?.p2) ?? (direction === 'BULLISH' ? last + range * 0.02 : last - range * 0.02);
  const t1FromScenario = finiteNumber(targetPath?.[0]);
  const t2FromScenario = finiteNumber(targetPath?.[1]);
  const t1 =
    finiteNumber(hints?.t1) ??
    t1FromScenario ??
    (direction === 'BULLISH' ? last + range * 0.12 : last - range * 0.12);
  const t2 =
    finiteNumber(hints?.t2) ??
    t2FromScenario ??
    (direction === 'BULLISH' ? last + range * 0.22 : last - range * 0.22);
  const raw = { erz: erzBand, supply, p2, invalidation: inv, t1, t2 };
  return canonicalizeThesisLevels(raw, direction, candles);
}

function mapTradability(payload: AiChartAnalysisPayload): TradabilityStep[] {
  return (payload.tradabilityChain || []).map((s, i) => ({
    id: `t-${i}`,
    label: s.stage.replace(/_/g, ' '),
    detail: s.detail || s.state,
    status: (s.state === 'COMPLETE'
      ? 'COMPLETE'
      : s.state === 'ACTIVE'
        ? 'ACTIVE'
        : s.state === 'FAILED'
          ? 'FAILED'
          : 'PENDING') as TradabilityStep['status'],
  }));
}

function mapReconciliation(payload: AiChartAnalysisPayload): Reconciliation {
  const r = payload.reconciliation;
  const stateRaw = (r?.agreement || 'PARTIAL').toUpperCase();
  let state: Reconciliation['state'] = 'PARTIAL';
  if (stateRaw.includes('AGREE')) state = 'AGREEMENT';
  else if (stateRaw.includes('CONFLICT')) state = 'CONFLICT';
  else if (stateRaw.includes('INSUFFICIENT')) state = 'INSUFFICIENT_DATA';
  return {
    state,
    ai: thesisBrief(payload),
    engine: r?.deterministicEngine || '—',
    difference: r?.conflictDetail || r?.note || '—',
  };
}

function mapScenarios(payload: AiChartAnalysisPayload, direction: Direction): Scenario[] {
  const primary = payload.scenarios?.primary;
  const alt = payload.scenarios?.alternative;
  const inv = payload.annotations?.find((a) => a.type === 'INVALIDATION')?.price;
  const primaryDir = (primary?.direction as Direction) || direction;
  const altDir =
    (alt?.direction as Direction) ||
    (direction === 'BULLISH' ? 'BEARISH' : direction === 'BEARISH' ? 'BULLISH' : 'NEUTRAL');
  return [
    {
      id: 's1',
      name: primary?.title || thesisTitle(payload),
      direction: primaryDir,
      status: primary?.status || 'ACTIVE',
      conditions:
        primary?.conditions ||
        synthesizeEvidence(payload)
          .missing.slice(0, 3)
          .map((m) => m.title),
      invalidation: primary?.invalidation || (inv != null ? String(inv) : 'See chart invalidation'),
      path: primary?.pathLabels || ['ERZ', 'Reaction', 'BOS', 'Retest', 'T1', 'T2'],
    },
    {
      id: 's2',
      name: alt?.title || 'Alternative scenario',
      direction: altDir,
      status: alt?.status || 'ALTERNATIVE',
      conditions: alt?.conditions || ['Invalidation breached', 'HTF realignment'],
      invalidation: alt?.invalidation || 'Scenario reassessment',
      path: alt?.pathLabels || ['Invalidation', 'Correction', 'Reassessment'],
    },
  ];
}

export function mapPayloadToAnalysisResult(payload: AiChartAnalysisPayload, primaryTf: Timeframe): AnalysisResult {
  const candles = mapCandles(payload);
  const direction = asDir(payload.direction);
  const levels = computeLevels(candles, payload, direction);
  const loc = priceLocationCopy(payload);
  const strip = payload.timeframeStrip || [];
  const h1 = strip.find((r) => r.timeframe === 'H1');
  const d1 = strip.find((r) => r.timeframe === 'D1');
  const h8 = strip.find((r) => r.timeframe === 'H8');

  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const change =
    last && prev && finiteNumber(last.close) !== null && finiteNumber(prev.close) !== null
      ? last.close - prev.close
      : 0;
  const changePct = prev?.close && finiteNumber(prev.close) ? (change / prev.close) * 100 : 0;

  const align: string[] = [];
  if (d1?.direction === 'BULLISH') align.push('D1 Bullish');
  if (d1?.direction === 'BEARISH') align.push('D1 Bearish');
  if (h8?.direction === 'BULLISH') align.push('H8 Bullish');
  if (h8?.direction === 'BEARISH') align.push('H8 Bearish');

  const path = expectedPath(payload).map((p) => ({
    label: p.label,
    status: (p.state === 'done' ? 'done' : p.state === 'active' ? 'current' : 'future') as 'done' | 'current' | 'future',
  }));

  return {
    analysisId: payload.analysisId || '—',
    revision: 4,
    symbol: payload.symbol,
    displayName: payload.symbol.startsWith('XAU') ? 'Gold vs US Dollar' : 'FX instrument',
    primaryTimeframe: primaryTf,
    createdAt: payload.analysisTimestamp || '',
    lastClosedAt: payload.analysisTimestamp || '',
    status: (payload.status || 'WATCHING').replace(/_/g, ' '),
    direction,
    marketState: titleCase(payload.marketState || 'Unclear'),
    structure: structureLabel(payload),
    evidenceScore: Math.round(payload.confidence ?? 0),
    thesisTitle: payload.thesisTitle || thesisTitle(payload),
    thesis: payload.thesis || thesisBrief(payload),
    timeframes: strip.map((r) => ({
      timeframe: asTf(r.timeframe),
      direction: asDir(r.direction),
      phase: directionLabel(r.direction),
      regime: marketStateLabel(r.marketState),
      evidenceScore: r.confidence > 0 ? Math.round(r.confidence) : null,
      structure: r.structure || '—',
      lastEvent: r.structure || '—',
      channelPosition: r.priceLocation || '—',
      supertrend: r.supertrend === 'UP' ? 'BULLISH' : r.supertrend === 'DOWN' ? 'BEARISH' : 'NEUTRAL',
      closedAt: payload.analysisTimestamp || '',
    })),
    candles,
    evidence: mapEvidence(payload),
    annotations: mapAnnotations(payload, candles),
    scenarios: mapScenarios(payload, direction),
    tradability: mapTradability(payload),
    reconciliation: mapReconciliation(payload),
    priceLocation: `${loc.title} · ${loc.detail}`,
    supertrend: (() => {
      const row = strip.find((r) => r.timeframe === primaryTf) || h1 || d1;
      const st = (row?.supertrend || '').toUpperCase();
      if (st === 'UP' || st === 'BULLISH') return 'BULLISH' as const;
      if (st === 'DOWN' || st === 'BEARISH') return 'BEARISH' as const;
      return 'NEUTRAL' as const;
    })(),
    htfAlignment: align.length ? align : ['HTF unclear'],
    expectedPath: path,
    ohlc: last
      ? { o: last.open, h: last.high, l: last.low, c: last.close, change, changePct }
      : { o: 0, h: 0, l: 0, c: 0, change: 0, changePct: 0 },
    levels,
    tradable: Boolean(payload.tradable),
    p1State: payload.p1State || '—',
    p2State: payload.p2State || '—',
    opportunity: payload.opportunity || '—',
    chartLines: (payload.chart?.channelLines || payload.chart?.lines || [])
      .map((l) => {
        const time = toChartTimeSeconds(l.time);
        const upper = finiteNumber(l.upper);
        const lower = finiteNumber(l.lower);
        const mid = finiteNumber(l.mid);
        if (time === null || upper === null || lower === null) return null;
        return { time, upper, lower, mid: mid ?? (upper + lower) / 2 };
      })
      .filter((l): l is { time: number; upper: number; lower: number; mid: number } => l !== null),
    supertrendSeries: (payload.chart?.supertrendSeries || [])
      .map((p) => {
        const time = toChartTimeSeconds(p.time);
        const value = finiteNumber(p.value);
        if (time === null || value === null) return null;
        return { time, value, direction: (p.direction || 'UNKNOWN').toUpperCase() };
      })
      .filter((p): p is { time: number; value: number; direction: string } => p !== null),
    dataQuality: payload.dataQuality || payload.marketDataStatus || (candles.length >= 2 ? 'VALID' : 'INSUFFICIENT'),
    regime: payload.regime?.primary?.replace(/_/g, ' ') || 'Unclear',
    analyticalTradability: payload.analyticalTradability,
    opportunityDetail: mapOpportunityDetail(payload),
    modeFocus: payload.modeFocus,
    engines: payload.engines || [],
    contradictions: (payload.contradictions || []).map((c) => c.text || '').filter(Boolean),
  };
}

function mapOpportunityDetail(payload: AiChartAnalysisPayload): AnalysisResult['opportunityDetail'] {
  const raw = payload.opportunityDetail;
  if (!raw || raw.available === false) {
    return { available: false };
  }
  return {
    available: true,
    opportunityId: String(raw.opportunityId || '—'),
    opportunityType: String(raw.opportunityType || payload.opportunity || '—'),
    direction: String(raw.direction || payload.direction || '—'),
    originTimeframe: String(raw.originTimeframe || 'H1'),
    lifecycle: String(raw.lifecycle || '—'),
    zone: raw.zone != null ? String(raw.zone) : undefined,
    distanceToZone: raw.distanceToZone as string | number | undefined,
    reactionState: raw.reactionState != null ? String(raw.reactionState) : undefined,
    breakState: raw.breakState != null ? String(raw.breakState) : undefined,
    retestState: raw.retestState != null ? String(raw.retestState) : undefined,
    invalidation: raw.invalidation != null ? String(raw.invalidation) : undefined,
    blockingRequirements: Array.isArray(raw.blockingRequirements) ? raw.blockingRequirements : [],
  };
}
