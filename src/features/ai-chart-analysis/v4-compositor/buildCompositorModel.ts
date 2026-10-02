import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';
import { buildSafePriceDomain, formatPrice } from './autonomousAdapter';
import {
  MARGIN_L,
  MARGIN_T,
  VOL_MAX_H,
  makeIndexX,
  makePriceY,
  plotHeight,
  plotWidth,
} from './compositorLayout';

export type CompositorChannelLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  dash: string;
  width: number;
};

export type CompositorZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: 'sup' | 'dem';
};

export type CompositorLevel = {
  y: number;
  xStart: number;
  tone: 'red' | 'green';
  line1: string;
  line2?: string;
};

export type CompositorMarker =
  | { kind: 'label'; x: number; y: number; text: string; color: string }
  | { kind: 'swing'; x: number; y: number; num: string; fill: string };

export type CompositorModel = {
  symbol: string;
  n: number;
  pMin: number;
  pMax: number;
  candles: Array<{ o: number; h: number; l: number; c: number; v: number; vh: number }>;
  gridPrices: number[];
  channelLines: CompositorChannelLine[];
  zones: CompositorZone[];
  stPaths: Array<{ d: string; color: string }>;
  scenarioPath: string;
  scenarioArrows: string[];
  levels: CompositorLevel[];
  p2?: { y: number; xStart: number };
  markers: CompositorMarker[];
  priceLine: { y: number; label: string };
  timeLabels: string[];
  priceLabels: string[];
};

function timeToIndex(candles: { time: number }[], t: number): number {
  if (!candles.length) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < candles.length; i++) {
    const d = Math.abs(candles[i]!.time - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function timeToPlotIndex(candles: { time: number }[], t: number, n: number): number {
  if (!candles.length) return 0;
  const last = candles[candles.length - 1]!;
  const first = candles[0]!;
  const step = (last.time - first.time) / Math.max(1, n - 1);
  if (t <= last.time + step * 0.5) return timeToIndex(candles, t);
  const ahead = Math.round((t - last.time) / Math.max(step, 1));
  return n + ahead;
}

function levelStartIndex(candles: { time: number }[], tone: 'red' | 'green' | 'neutral', n: number): number {
  const idx =
    tone === 'red' ? Math.floor(n * 0.32) : tone === 'neutral' ? Math.floor(n * 0.58) : Math.floor(n * 0.68);
  return Math.max(0, Math.min(n - 1, idx));
}

function collectOverlays(snapshot: AutonomousSnapshot): number[] {
  const ch = snapshot.chart;
  const out: number[] = [];
  for (const c of ch.candles) out.push(c.high, c.low, c.open, c.close);
  for (const z of ch.zones) out.push(z.high, z.low);
  for (const l of ch.levels) out.push(l.price);
  for (const s of ch.scenario) out.push(s.price);
  for (const st of ch.supertrend) out.push(st.value);
  for (const a of ch.annotations) out.push(a.price);
  for (const channel of ch.channels) {
    for (const p of channel.upper) out.push(p.price);
    for (const p of channel.lower) out.push(p.price);
    for (const p of channel.median ?? []) out.push(p.price);
  }
  return out;
}

export function buildCompositorModel(snapshot: AutonomousSnapshot): CompositorModel {
  const ch = snapshot.chart;
  const candles = ch.candles;
  const n = candles.length;
  const x = makeIndexX(n);
  const domain = buildSafePriceDomain(snapshot.symbol, candles, collectOverlays(snapshot));
  const pMin = domain.min;
  const pMax = domain.max;
  const y = makePriceY(pMin, pMax);
  const pw = plotWidth();
  const ph = plotHeight();

  const maxVol = Math.max(1, ...candles.map((c) => c.volume));
  const mappedCandles = candles.map((c) => ({
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
    vh: (c.volume / maxVol) * VOL_MAX_H,
  }));

  const channelLines: CompositorChannelLine[] = [];
  const channel0 = ch.channels[0];
  if (channel0) {
    const endIdx = n + 12;
    const u0 = channel0.upper[0];
    const u1 = channel0.upper[channel0.upper.length - 1];
    const l0 = channel0.lower[0];
    const l1 = channel0.lower[channel0.lower.length - 1];
    if (u0 && u1) {
      channelLines.push({
        x1: x(timeToIndex(candles, u0.time)),
        y1: y(u0.price),
        x2: x(endIdx),
        y2: y(u1.price),
        stroke: '#c7d1da',
        dash: '6 4',
        width: 1.4,
      });
    }
    if (l0 && l1) {
      channelLines.push({
        x1: x(timeToIndex(candles, l0.time)),
        y1: y(l0.price),
        x2: x(endIdx),
        y2: y(l1.price),
        stroke: '#c7d1da',
        dash: '6 4',
        width: 1.4,
      });
    }
    const m0 = channel0.median?.[0];
    const m1 = channel0.median?.[channel0.median.length - 1];
    if (m0 && m1) {
      channelLines.push({
        x1: x(timeToIndex(candles, m0.time)),
        y1: y(m0.price),
        x2: x(endIdx),
        y2: y(m1.price),
        stroke: '#8095a5',
        dash: '5 5',
        width: 1,
      });
    }
  }

  const zones: CompositorZone[] = ch.zones.map((z) => {
    const i1 = timeToIndex(candles, z.from);
    const i2 = Math.max(i1 + 1, timeToPlotIndex(candles, z.to, n));
    const x1 = x(i1);
    const x2 = x(i2);
    const yHi = y(z.high);
    const yLo = y(z.low);
    return {
      x: x1,
      y: yHi,
      w: Math.max(2, x2 - x1),
      h: Math.max(2, yLo - yHi),
      label: z.label,
      kind: z.kind === 'SUPPLY' ? 'sup' : 'dem',
    };
  });

  const stPaths: Array<{ d: string; color: string }> = [];
  if (ch.supertrend.length) {
    let curDir: string | null = null;
    let parts: string[] = [];
    const flush = () => {
      if (parts.length >= 2) {
        stPaths.push({
          d: parts.join(' '),
          color: curDir === 'BEARISH' ? '#ff3155' : '#00df8e',
        });
      }
      parts = [];
    };
    for (const p of ch.supertrend) {
      const idx = timeToIndex(candles, p.time);
      const xx = x(idx);
      const yy = y(p.value);
      const seg = `${parts.length ? 'L' : 'M'}${xx} ${yy}`;
      if (curDir && curDir !== p.direction) {
        flush();
        parts.push(`M${xx} ${yy}`);
      } else {
        parts.push(seg);
      }
      curDir = p.direction;
    }
    flush();
  }

  const scenarioPts = ch.scenario
    .filter((s) => Number.isFinite(s.price))
    .map((s) => ({
      x: x(timeToPlotIndex(candles, s.time, n)),
      y: y(s.price),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const scenarioPath =
    scenarioPts.length >= 2
      ? scenarioPts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
      : '';

  const scenarioArrows: string[] = [];
  for (let i = 1; i < scenarioPts.length; i++) {
    const a = scenarioPts[i - 1]!;
    const b = scenarioPts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const wing = i === scenarioPts.length - 1 ? 7 : 5;
    const back = i === scenarioPts.length - 1 ? 12 : 8;
    const tipX = b.x;
    const tipY = b.y;
    const bx = tipX - ux * back;
    const by = tipY - uy * back;
    scenarioArrows.push(
      `M ${bx + px * wing} ${by + py * wing} L ${tipX} ${tipY} L ${bx - px * wing} ${by - py * wing} Z`,
    );
  }

  const levels: CompositorLevel[] = [];
  let p2: CompositorModel['p2'];
  for (const l of ch.levels) {
    if (l.kind === 'BREAK') {
      p2 = { y: y(l.price), xStart: x(levelStartIndex(candles, 'neutral', n)) };
      continue;
    }
    const tone = l.kind === 'INVALIDATION' ? 'red' : 'green';
    const start = levelStartIndex(candles, tone, n);
    if (l.kind === 'INVALIDATION') {
      levels.push({
        y: y(l.price),
        xStart: x(start),
        tone,
        line1: 'Invalidation',
        line2: formatPrice(snapshot.symbol, l.price),
      });
    } else {
      levels.push({
        y: y(l.price),
        xStart: x(start),
        tone,
        line1: l.label.split(/\s+/).slice(0, 2).join(' ') || l.label,
      });
    }
  }

  const last = candles[candles.length - 1]!;
  const priceLine = {
    y: y(last.close),
    label: formatPrice(snapshot.symbol, last.close),
  };

  const markers: CompositorMarker[] = [];
  for (const a of ch.annotations) {
    const xi = x(timeToIndex(candles, a.time));
    const yi = y(a.price);
    if (a.kind === 'SWING_HIGH' || a.kind === 'SWING_LOW') {
      markers.push({
        kind: 'swing',
        x: xi,
        y: yi,
        num: a.label,
        fill: a.kind === 'SWING_HIGH' ? '#ff4d5b' : '#45d9ee',
      });
    } else {
      markers.push({
        kind: 'label',
        x: xi,
        y: yi,
        text: a.label,
        color: a.kind === 'CHOCH' ? '#ff3b5c' : '#10c8ff',
      });
    }
  }

  const gridPrices = Array.from({ length: 8 }, (_, i) => pMin + ((pMax - pMin) * i) / 7);
  const priceLabels = gridPrices.map((p) => formatPrice(snapshot.symbol, p));

  const timeLabels: string[] = [];
  for (let i = 0; i < 11; i++) {
    const idx = Math.floor((i / 10) * (n - 1));
    const t = candles[idx]?.time ?? last.time;
    const d = new Date(t);
    timeLabels.push(
      i % 2 === 0
        ? String(d.getUTCDate())
        : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }),
    );
  }

  return {
    symbol: snapshot.symbol,
    n,
    pMin,
    pMax,
    candles: mappedCandles,
    gridPrices,
    channelLines,
    zones,
    stPaths,
    scenarioPath,
    scenarioArrows,
    levels,
    p2,
    markers,
    priceLine,
    timeLabels,
    priceLabels,
  };
}
