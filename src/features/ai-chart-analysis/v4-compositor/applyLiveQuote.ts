import type { AutonomousSnapshot } from '../v3-e2e/types/autonomous';

/** Patch the forming bar with bridge tick mid — chart viewer only, does not mutate analysis. */
export function applyLiveQuoteToSnapshot(snapshot: AutonomousSnapshot, mid: number): AutonomousSnapshot {
  if (!Number.isFinite(mid)) return snapshot;
  const candles = snapshot.chart.candles;
  if (!candles.length) return snapshot;
  const last = candles[candles.length - 1]!;
  const close = mid;
  const high = Math.max(last.high, mid);
  const low = Math.min(last.low, mid);
  if (last.close === close && last.high === high && last.low === low) return snapshot;
  const nextLast = { ...last, close, high, low };
  return {
    ...snapshot,
    chart: {
      ...snapshot.chart,
      candles: [...candles.slice(0, -1), nextLast],
    },
  };
}
