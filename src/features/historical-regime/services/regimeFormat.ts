import type { RegimeName, RegimeSnapshot, RegimeStageStatus } from '../types';

export type RegimeGroup = 'BULLISH' | 'BEARISH' | 'TRANSITION' | 'NEUTRAL' | 'UNKNOWN';

export const ASSET_COLORS: Record<string, string> = {
  USD: '#5aa9ff',
  EUR: '#61e6aa',
  GBP: '#c38bff',
  JPY: '#ff838d',
  CHF: '#ffd36d',
  CAD: '#ff9f5a',
  AUD: '#35c8e6',
  NZD: '#9fb2c8',
  XAU: '#f5c542',
};

export const REGIME_HELP: Record<RegimeName, string> = {
  Accelerating: 'Strength above the level band with positive momentum that is itself rising.',
  Strengthening: 'Momentum above the adaptive band while strength is at or above neutral.',
  Persistent: 'Strength held beyond the level band with flat momentum — an established regime.',
  Stable: 'Strength and momentum both inside their bands — no directional regime.',
  Deteriorating: 'Still positive strength, but momentum has turned down through the band.',
  Weakening: 'Momentum below the negative band while strength is at or below neutral.',
  Recovering: 'Negative strength with momentum turning up through the band.',
  Reversing: 'Macro (Q/M) and current (W/D) strength disagree beyond the band, momentum following the current leg.',
};

export function regimeGroup(regime: RegimeName | null | undefined, s: number | null | undefined): RegimeGroup {
  if (regime === 'Strengthening' || regime === 'Accelerating' || (regime === 'Persistent' && (s ?? 0) > 0)) return 'BULLISH';
  if (regime === 'Weakening' || regime === 'Deteriorating' || regime === 'Persistent') return 'BEARISH';
  if (regime === 'Recovering' || regime === 'Reversing') return 'TRANSITION';
  if (regime === 'Stable') return 'NEUTRAL';
  return 'UNKNOWN';
}

export function regimeTone(regime: RegimeName | null | undefined, s?: number | null): string {
  const g = regimeGroup(regime, s);
  return g === 'BULLISH' ? 'green' : g === 'BEARISH' ? 'red' : g === 'TRANSITION' ? 'amber' : g === 'NEUTRAL' ? 'gray' : 'blue';
}

export function regimeColor(regime: RegimeName | null | undefined, s?: number | null): string {
  const g = regimeGroup(regime, s);
  return g === 'BULLISH' ? '#2fbf83' : g === 'BEARISH' ? '#e0606c' : g === 'TRANSITION' ? '#e2b04a' : g === 'NEUTRAL' ? '#5c6f82' : '#243447';
}

export function stageTone(s: RegimeStageStatus): string {
  if (s === 'HEALTHY' || s === 'RUNNING') return 'green';
  if (s === 'WARMING UP' || s === 'STALE' || s === 'WAITING') return 'amber';
  return 'red';
}

export function signed(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

export function num(n: number | null | undefined, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}${suffix}`;
}

export function ago(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export type TimelineSegment = { regime: RegimeName | null; from: string; to: string; count: number; meanS: number };

export function timelineSegments(rows: RegimeSnapshot[]): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  for (const r of rows) {
    if (!r.closed) continue;
    const s = r.composite ?? 0;
    const last = out[out.length - 1];
    if (last && last.regime === r.regime) {
      last.to = r.date;
      last.meanS = (last.meanS * last.count + s) / (last.count + 1);
      last.count += 1;
    } else {
      out.push({ regime: r.regime, from: r.date, to: r.date, count: 1, meanS: s });
    }
  }
  return out;
}
