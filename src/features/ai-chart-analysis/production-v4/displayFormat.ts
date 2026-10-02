import type { Direction } from './types';

export function directionLabel(d: string | undefined): string {
  const u = (d || '').toUpperCase();
  if (u === 'BULLISH') return 'Bullish';
  if (u === 'BEARISH') return 'Bearish';
  if (u === 'MIXED') return 'Mixed';
  if (u === 'NEUTRAL' || u === 'UNKNOWN') return 'Unclear';
  return u.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function marketStateLabel(ms: string | undefined): string {
  if (!ms || ms === 'UNKNOWN' || ms === 'UNCLEAR') return 'Unclear';
  return ms
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function evidenceScoreDisplay(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score) || score <= 0) {
    return '—';
  }
  return `${Math.round(score)}%`;
}

export function supertrendClass(d: Direction | string): string {
  const u = String(d).toUpperCase();
  if (u === 'BULLISH') return 'up';
  if (u === 'BEARISH') return 'down';
  return 'flat';
}

export function humanizeEngineState(raw: string): string {
  if (!raw || raw === '—') return '—';
  return raw
    .replace(/^P1_/, 'P1 · ')
    .replace(/^P2_/, 'P2 · ')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
