import type { AiChartAnalysisPayload, StripTf } from '../types';
import {
  expectedPath,
  formatThesis,
  priceLocationCopy,
  structureLabel,
  synthesizeEvidence,
  thesisBrief,
} from './evidenceSynthesis';
import type { AnalysisView, ChartCandle, ChartMarker, Direction, Status, Step, TF, TFState } from './types';

const TF_SET = new Set<string>(['YTD', 'Q', 'MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5']);

function asTf(v: string | undefined, fallback: TF = 'H1'): TF {
  const u = (v || fallback).toUpperCase();
  return (TF_SET.has(u) ? u : fallback) as TF;
}

function asDirection(v: string | undefined): Direction {
  const u = (v || 'NEUTRAL').toUpperCase();
  if (u === 'BULLISH' || u === 'BEARISH' || u === 'MIXED') return u;
  return 'NEUTRAL';
}

function asStatus(v: string | undefined): Status {
  const u = (v || 'WATCHING').toUpperCase();
  const allowed: Status[] = [
    'WATCHING',
    'SETUP_DEVELOPING',
    'NEAR_CONFIRMATION',
    'CONFIRMATION_PENDING',
    'CONFIRMED',
    'INVALIDATED',
    'EXPIRED',
    'COMPLETED',
    'NO_OPPORTUNITY',
  ];
  return allowed.includes(u as Status) ? (u as Status) : 'WATCHING';
}

function tfLabel(row: { directionShort?: string; marketState?: string; direction?: string }): string {
  const s = row.directionShort || '';
  if (s === '↑' || row.direction === 'BULLISH') return 'Bullish';
  if (s === '↓' || row.direction === 'BEARISH') return 'Bearish';
  if (s === 'PB') return 'Pullback';
  if (s === 'REV') return 'Reversal';
  if (s === '↔') return 'Range';
  return row.marketState?.replace(/_/g, ' ') || 'Neutral';
}

function tfDirClass(d: string): 'bullish' | 'bearish' | 'mixed' {
  if (d === 'BULLISH') return 'bullish';
  if (d === 'BEARISH') return 'bearish';
  return 'mixed';
}

function mapTfs(payload: AiChartAnalysisPayload): TFState[] {
  return (payload.timeframeStrip || []).map((r) => ({
    tf: asTf(r.timeframe),
    direction: asDirection(r.direction),
    short: tfDirectionLabel(r),
    structure: r.marketState?.replace(/_/g, ' ') || r.structure || 'UNCLEAR',
    confidence: Math.round(r.confidence || 0),
    summary: r.priceLocation || r.channelState || '',
  }));
}

function tfDirectionLabel(row: { directionShort?: string; direction?: string; marketState?: string }): string {
  const s = row.directionShort || '';
  if (s === '↑' || row.direction === 'BULLISH') return '↗ Bullish';
  if (s === '↓' || row.direction === 'BEARISH') return '↘ Bearish';
  if (s === 'PB') return 'Pullback';
  if (s === 'REV') return 'Reversal';
  if (row.direction === 'UNKNOWN' || row.direction === 'NEUTRAL') return '—';
  return row.marketState?.replace(/_/g, ' ') || 'Unclear';
}

function mapSteps(payload: AiChartAnalysisPayload): Step[] {
  const mapState = (s: string): Step['state'] => {
    if (s === 'COMPLETE') return 'done';
    if (s === 'ACTIVE') return 'active';
    if (s === 'FAILED') return 'blocked';
    return 'pending';
  };
  return (payload.tradabilityChain || []).map((s) => ({
    label: s.stage.replace(/_/g, ' '),
    state: mapState(s.state),
    detail: s.detail || s.state,
  }));
}

function mapCandles(payload: AiChartAnalysisPayload): ChartCandle[] {
  const raw = payload.chart?.candles || [];
  return raw
    .filter((c) => c.complete !== false)
    .map((c) => ({
      time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
}

const MARKER_PRIORITY: Record<string, number> = {
  INVALIDATION: 0,
  ERZ: 1,
  BOS: 2,
  CHOCH: 2,
  BREAKOUT: 3,
  RETEST: 3,
  CHANNEL: 4,
  TOUCH: 4,
  HIGH: 5,
  LOW: 5,
};

function mapMarkers(payload: AiChartAnalysisPayload): ChartMarker[] {
  const sorted = [...(payload.annotations || [])].sort(
    (a, b) => (MARKER_PRIORITY[a.type] ?? 9) - (MARKER_PRIORITY[b.type] ?? 9),
  );
  return sorted.slice(0, 10).map((a) => {
    const t = a.candleTimestamp ? (a.candleTimestamp > 1e12 ? Math.floor(a.candleTimestamp / 1000) : a.candleTimestamp) : 0;
    const bull = (a.type || '').includes('BOS') || a.thesisRelation === 'CONFIRMATION';
    const label = (a.label || a.type || '•').slice(0, 12);
    return {
      time: t,
      position: bull ? ('belowBar' as const) : ('aboveBar' as const),
      shape: bull ? ('arrowUp' as const) : ('circle' as const),
      text: label,
    };
  });
}

export function thesisTitle(payload: AiChartAnalysisPayload): string {
  const dir = payload.direction === 'BULLISH' ? 'Bullish' : payload.direction === 'BEARISH' ? 'Bearish' : 'Neutral';
  const ms = (payload.marketState || '').toLowerCase().replace(/_/g, ' ');
  if (ms.includes('pullback')) return `${dir} continuation (pullback)`;
  if (ms.includes('breakout')) return `${dir} breakout developing`;
  return `${dir} ${ms || 'analysis'}`;
}

function fmtWhen(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : iso;
}

export function mapPayloadToAnalysisView(payload: AiChartAnalysisPayload): AnalysisView {
  const strip = payload.timeframeStrip || [];
  const d1 = strip.find((r) => r.timeframe === 'D1');
  const h8 = strip.find((r) => r.timeframe === 'H8');
  const h1 = strip.find((r) => r.timeframe === 'H1');
  const align: string[] = [];
  if (d1?.direction === 'BULLISH') align.push('D1 Bullish');
  if (d1?.direction === 'BEARISH') align.push('D1 Bearish');
  if (h8?.direction === 'BULLISH') align.push('H8 Bullish');
  if (h8?.direction === 'BEARISH') align.push('H8 Bearish');

  const invAnn = (payload.annotations || []).find((a) => a.type === 'INVALIDATION');
  const invalidation = invAnn?.price != null ? String(invAnn.price) : '—';
  const synth = synthesizeEvidence(payload);
  const evidence = [...synth.supporting, ...synth.conflicting, ...synth.missing];
  const thesisText = formatThesis(payload);
  const locCopy = priceLocationCopy(payload);
  const chartLines = (payload.chart?.lines || []) as { time: number; upper: number; lower: number; mid: number }[];

  return {
    id: payload.analysisId || '—',
    symbol: payload.symbol,
    created: fmtWhen(payload.analysisTimestamp),
    updated: fmtWhen(payload.analysisTimestamp),
    direction: asDirection(payload.direction),
    status: asStatus(payload.status),
    opportunity: payload.opportunity || '—',
    confidence: Math.round(payload.confidence ?? 0),
    primaryTf: asTf(payload.primaryTimeframe, 'H1'),
    entryTf: asTf('M15', 'M15'),
    marketState: (payload.marketState || 'UNCLEAR')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    thesis: thesisText || payload.thesis || '',
    thesisBrief: thesisBrief(payload),
    thesisTitle: thesisTitle(payload),
    invalidation,
    target: 'See tradability chain / framework targets',
    engineState: payload.reconciliation?.deterministicEngine || '—',
    agreement: payload.reconciliation?.agreement || '—',
    p1State: payload.p1State || '—',
    p2State: payload.p2State || '—',
    tradable: Boolean(payload.tradable),
    priceLocation: locCopy.title,
    priceLocationDetail: locCopy.detail,
    chartLines,
    supertrendLabel:
      h1?.supertrend === 'UP'
        ? '↗ Bullish'
        : h1?.supertrend === 'DOWN'
          ? '↘ Bearish'
          : d1?.supertrend === 'UP'
            ? '↗ Bullish'
            : d1?.supertrend === 'DOWN'
              ? '↘ Bearish'
              : '—',
    htfAlignment: align.length ? align : ['HTF unclear'],
    tfs: mapTfs(payload),
    evidence,
    evidenceCounts: synth.counts,
    evidenceExtra: synth.extra,
    rawEvidence: synth.raw,
    pathSteps: expectedPath(payload),
    structureLabel: structureLabel(payload),
    steps: mapSteps(payload),
    candles: mapCandles(payload),
    markers: mapMarkers(payload),
    timeline: (payload.timelineEvents || []).map((ev) => ({
      time: ev.timestamp,
      title: ev.kind,
      detail: ev.detail || '',
    })),
  };
}

export function ohlcFromCandles(candles: ChartCandle[]) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const ch = last.close - prev.close;
  const pct = prev.close ? (ch / prev.close) * 100 : 0;
  return { ...last, change: ch, changePct: pct };
}

export function tfStripClass(row: TFState, selected: TF): string {
  return `tf ${tfDirClass(row.direction)}${row.tf === selected ? ' selected' : ''}`;
}

export type { StripTf };
