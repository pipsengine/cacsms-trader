import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';

export type ChartViewport = { from: number; to: number };

const MIN_BARS = 28;

export function clampViewport(from: number, to: number, barCount: number): ChartViewport {
  const n = Math.max(1, barCount);
  let f = Math.max(0, Math.floor(from));
  let t = Math.min(n - 1, Math.floor(to));
  if (t - f + 1 < MIN_BARS) {
    t = Math.min(n - 1, f + MIN_BARS - 1);
    if (t - f + 1 < MIN_BARS) f = Math.max(0, t - MIN_BARS + 1);
  }
  if (t < f) t = f;
  return { from: f, to: t };
}

export function defaultViewport(barCount: number): ChartViewport {
  const n = Math.max(1, barCount);
  const visible = Math.min(n, 92);
  return clampViewport(n - visible, n - 1, n);
}

export function sliceSnapshotForViewport(snapshot: AutonomousSnapshot, vp: ChartViewport): AutonomousSnapshot {
  const all = snapshot.chart.candles;
  const from = Math.max(0, Math.min(all.length - 1, vp.from));
  const to = Math.max(from, Math.min(all.length - 1, vp.to));
  const candles = all.slice(from, to + 1);
  const t0 = candles[0]?.time ?? 0;
  const t1 = candles[candles.length - 1]?.time ?? t0;
  const pad = Math.max(1, Math.round((t1 - t0) * 0.02));

  const inWindow = (t: number) => t >= t0 - pad && t <= t1 + pad;

  return {
    ...snapshot,
    chart: {
      ...snapshot.chart,
      candles,
      supertrend: snapshot.chart.supertrend.filter((p) => inWindow(p.time)),
      annotations: snapshot.chart.annotations.filter((a) => inWindow(a.time)),
      // Keep projected knots after the last visible bar (AI expected path extends forward in time).
      scenario: snapshot.chart.scenario.filter((s) => s.time >= t0 - pad),
      zones: snapshot.chart.zones
        .map((z) => ({
          ...z,
          from: Math.max(z.from, t0),
          to: Math.min(z.to, t1 + pad * 4),
        }))
        .filter((z) => z.to >= t0 && z.from <= t1),
    },
  };
}

export function indexAtPlotX(
  plotX: number,
  barCount: number,
  marginL: number,
  plotW: number,
): number {
  const n = Math.max(1, barCount);
  const raw = ((plotX - marginL) / plotW) * (n + 12);
  return Math.max(0, Math.min(n - 1, Math.round(raw)));
}

export function barsForRangePreset(preset: string, total: number): number {
  const caps: Record<string, number> = {
    '1D': 24,
    '1W': 24 * 7,
    '1M': 24 * 30,
    '3M': 24 * 90,
    '6M': 24 * 180,
    '1Y': 24 * 365,
    '5Y': total,
  };
  const cap = caps[preset] ?? total;
  return Math.min(total, Math.max(MIN_BARS, cap));
}
