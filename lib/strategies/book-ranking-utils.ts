import type { StrategyControlOverviewEntry, StrategyControlRankingRow } from './strategy-control-types';

export function topStrategyInGroup(
  entries: StrategyControlOverviewEntry[],
  group: string,
): StrategyControlOverviewEntry | null {
  return entries
    .filter((item) => !item.error && item.group === group)
    .sort((left, right) => {
      const leftScore = (left.decision !== 'wait' ? 100 : 0) + left.confidence;
      const rightScore = (right.decision !== 'wait' ? 100 : 0) + right.confidence;
      return rightScore - leftScore;
    })[0] ?? null;
}

export function attachGroupLeaders(
  rankings: StrategyControlRankingRow[],
  entries: StrategyControlOverviewEntry[],
): StrategyControlRankingRow[] {
  return rankings.map((row) => {
    if (row.id !== row.group) return row;
    const leader = topStrategyInGroup(entries, row.group);
    if (!leader) return row;
    return { ...row, linkStrategyId: leader.id };
  });
}

export function strategyRankingHref(row: StrategyControlRankingRow): string | null {
  const target = row.linkStrategyId ?? (row.id !== row.group ? row.id : null);
  if (!target) return null;
  return `/institutional-strategy-intelligence/${row.group}/${target}`;
}

export function decisionEntropy(buy: number, sell: number, wait: number): number {
  const total = buy + sell + wait;
  if (total <= 0) return 0;
  const probs = [buy, sell, wait].map((count) => count / total).filter((value) => value > 0);
  const entropy = -probs.reduce((sum, probability) => sum + probability * Math.log2(probability), 0);
  return Number(entropy.toFixed(3));
}
