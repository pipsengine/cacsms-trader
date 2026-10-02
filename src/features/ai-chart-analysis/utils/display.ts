import type { StripTf, TimeframeStripRow } from '../types';

export function tfCardTitle(row: TimeframeStripRow): string {
  const d = row.direction === 'BULLISH' ? 'Bullish' : row.direction === 'BEARISH' ? 'Bearish' : 'Neutral';
  const ms = (row.marketState || '').replace(/_/g, ' ');
  if (ms.toLowerCase().includes('pullback') || ms.toLowerCase().includes('correction')) {
    return `${d} Pullback`;
  }
  if (ms.toLowerCase().includes('reversal')) {
    return `${d} Reversal Reaction`;
  }
  if (ms.toLowerCase().includes('developing')) {
    return `${d} Developing`;
  }
  if (row.direction === 'BULLISH' || row.direction === 'BEARISH') {
    return `${d} Trending`;
  }
  return ms || 'Unclear';
}

export function tfCardSub(row: TimeframeStripRow): string {
  const loc = row.priceLocation || '';
  if (loc) return loc.replace(/_/g, ' ');
  const ms = row.marketState.replace(/_/g, ' ');
  return ms === 'TRENDING' ? 'Mid channel' : ms;
}

export function directionArrow(direction: string): 'up' | 'down' | 'flat' {
  if (direction === 'BULLISH') return 'up';
  if (direction === 'BEARISH') return 'down';
  return 'flat';
}

export function statusTone(status?: string): 'green' | 'amber' | 'red' | 'blue' {
  const s = (status || '').toUpperCase();
  if (s.includes('CONFIRM') || s.includes('TRADABLE') || s === 'NEAR_CONFIRMATION') return 'green';
  if (s.includes('INVALID') || s.includes('FAILED')) return 'red';
  if (s.includes('DEVELOP') || s.includes('WATCH') || s.includes('PENDING')) return 'amber';
  return 'blue';
}

export function formatStructure(structure?: string): string {
  if (!structure) return '—';
  if (structure.includes('HH')) return 'HH → HL';
  if (structure.includes('LH')) return 'LH → LL';
  return structure.replace(/_/g, ' ');
}

export function ohlcFromCandles(candles: { open: number; high: number; low: number; close: number }[]) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : last;
  const ch = last.close - prev.close;
  const pct = prev.close ? (ch / prev.close) * 100 : 0;
  return { ...last, change: ch, changePct: pct };
}

export const EXPECTED_PATH = ['ERZ', 'Reaction', 'BOS', 'Retest', 'T1', 'T2'] as const;

export function pathStepActive(step: string, chain: { stage: string; state: string }[] | undefined): boolean {
  const map: Record<string, string[]> = {
    ERZ: ['LOCATION'],
    Reaction: ['REACTION'],
    BOS: ['STRUCTURAL_CONFIRMATION'],
    Retest: ['RETEST'],
    T1: ['ENTRY_REFINEMENT', 'TRADABLE'],
    T2: ['TRADABLE'],
  };
  const stages = map[step] || [];
  return stages.some((s) => chain?.find((c) => c.stage === s)?.state === 'COMPLETE');
}

export function htfAlignment(strip: TimeframeStripRow[] | undefined): string {
  const d1 = strip?.find((r) => r.timeframe === 'D1');
  const h8 = strip?.find((r) => r.timeframe === 'H8');
  if (!d1 || !h8) return '—';
  const a = d1.direction === 'BULLISH' ? 'Bullish' : d1.direction === 'BEARISH' ? 'Bearish' : '?';
  const b = h8.direction === 'BULLISH' ? 'Bullish' : h8.direction === 'BEARISH' ? 'Bearish' : '?';
  return `D1 ${a} · H8 ${b}`;
}
