import type { StrategyControlOverviewEntry, StrategyControlRankingRow, StrategyControlSignalSide } from './strategy-control-types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function decisionWeight(decision: StrategyControlSignalSide): number {
  if (decision === 'buy' || decision === 'sell') return 1;
  return 0.35;
}

export function biasCoherence(decision: StrategyControlSignalSide, bias: string): number {
  if (decision === 'buy' && bias === 'bullish') return 1;
  if (decision === 'sell' && bias === 'bearish') return 1;
  if (decision === 'wait' && bias === 'neutral') return 0.7;
  if (decision === 'wait') return 0.5;
  return 0.25;
}

export function compositeScore(entry: StrategyControlOverviewEntry): number {
  if (entry.error) return 0;
  const base = entry.confidence * decisionWeight(entry.decision);
  const coherence = biasCoherence(entry.decision, entry.bias) * 18;
  return Math.round(clamp(base + coherence, 0, 100));
}

export function compositeScoreWithPerformance(
  entry: StrategyControlOverviewEntry,
  performance?: { winRate: number; sampleSize: number; expectancyR: number } | null,
): number {
  let score = compositeScore(entry);
  if (!performance || performance.sampleSize < 3) return score;
  score += Math.round(performance.winRate * 22);
  score += Math.round(clamp(performance.expectancyR * 15, -8, 12));
  return Math.round(clamp(score, 0, 100));
}

export function healthyStrategyEntries(entries: StrategyControlOverviewEntry[]): StrategyControlOverviewEntry[] {
  return entries.filter((item) => !item.error);
}

export function rankStrategyEntries(
  entries: StrategyControlOverviewEntry[],
  limit = 15,
  scoreFn: (entry: StrategyControlOverviewEntry) => number = compositeScore,
): StrategyControlRankingRow[] {
  return [...entries]
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      score: scoreFn(entry),
      decision: entry.decision,
      confidence: entry.confidence,
      bias: entry.bias,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function bookDecisionFromEntries(entries: StrategyControlOverviewEntry[]): StrategyControlSignalSide | 'neutral' {
  const healthy = healthyStrategyEntries(entries);
  const buy = healthy.filter((item) => item.decision === 'buy').length;
  const sell = healthy.filter((item) => item.decision === 'sell').length;
  if (buy > sell * 1.15) return 'buy';
  if (sell > buy * 1.15) return 'sell';
  return 'neutral';
}

export function mapBookSideToAutonomy(decision: StrategyControlSignalSide | 'neutral'): 'BUY' | 'SELL' | 'WAIT' {
  if (decision === 'buy') return 'BUY';
  if (decision === 'sell') return 'SELL';
  return 'WAIT';
}
