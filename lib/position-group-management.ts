import type { ExecutionOpenPosition } from '@/lib/execution-open-positions';
import { goldBreakEvenAllowed, resolveGoldAdaptiveManagementConfig } from '@/lib/gold-adaptive-management';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import { parsePositionManagementMetadata } from '@/lib/position-management-state';
import { getPositionManagementConfig } from '@/lib/trade-monitor-config';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type PositionGroup = {
  setupGroupId: string;
  symbol: string;
  side: 'buy' | 'sell';
  positions: ExecutionOpenPosition[];
  totalProfitLoss: number;
  peakTotalProfit: number;
  totalVolumeLots: number;
  aggregateRMultiple: number;
  aggregateFavorablePoints: number;
  aggregateRiskPoints: number;
  spreadPoints: number;
  allBreakEvenApplied: boolean;
  groupBreakEvenApplied: boolean;
};

function defaultRiskPoints(symbol: string): number {
  const config = getPositionManagementConfig();
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU') || normalized.startsWith('XAG')) return config.defaultRiskPointsGold;
  return config.defaultRiskPointsForex;
}

function resolveSetupGroupId(position: ExecutionOpenPosition): string | null {
  const metadata = position.metadata ?? {};
  const explicit = String(metadata.setupGroupId ?? '').trim();
  if (explicit) return explicit;
  const commandId = String(position.openCommandId ?? '').trim();
  const batchMatch = commandId.match(/^(autonomy-[a-f0-9-]+)/i);
  return batchMatch?.[1] ?? null;
}

function buildGroupSnapshot(positions: ExecutionOpenPosition[]): Omit<PositionGroup, 'setupGroupId' | 'symbol' | 'side' | 'positions'> {
  let totalProfitLoss = 0;
  let peakTotalProfit = 0;
  let totalVolumeLots = 0;
  let weightedR = 0;
  let weightedFavorable = 0;
  let weightedRisk = 0;
  let allBreakEvenApplied = true;
  let groupBreakEvenApplied = true;

  for (const position of positions) {
    const lots = Math.max(0.01, Number(position.volumeLots ?? 0.01));
    const management = parsePositionManagementMetadata(position.metadata);
    const symbol = String(position.symbol ?? 'EURUSD').toUpperCase();
    const entry = Number(position.entryPrice ?? position.currentPrice ?? 0);
    const side = String(position.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    const point = symbol.startsWith('XAU') ? 0.01 : 0.00001;
    const currentPrice = Number(position.currentPrice ?? entry);
    const favorablePoints = side === 'buy'
      ? Math.max(0, (currentPrice - entry) / point)
      : Math.max(0, (entry - currentPrice) / point);
    const stop = Number(position.stopLoss ?? 0);
    const riskPoints = entry > 0 && stop > 0 && Math.abs(entry - stop) > point
      ? Math.abs(entry - stop) / point
      : defaultRiskPoints(symbol);
    const rMultiple = riskPoints > 0 ? favorablePoints / riskPoints : 0;

    totalProfitLoss += Number(position.profitLoss ?? 0);
    peakTotalProfit += Math.max(Number(position.profitLoss ?? 0), management.peakProfit);
    totalVolumeLots += lots;
    weightedR += rMultiple * lots;
    weightedFavorable += favorablePoints * lots;
    weightedRisk += riskPoints * lots;

    if (!management.breakEvenApplied) allBreakEvenApplied = false;
    if (!Boolean(position.metadata?.groupBreakEvenApplied)) groupBreakEvenApplied = false;
  }

  return {
    totalProfitLoss,
    peakTotalProfit,
    totalVolumeLots,
    aggregateRMultiple: totalVolumeLots > 0 ? weightedR / totalVolumeLots : 0,
    aggregateFavorablePoints: totalVolumeLots > 0 ? weightedFavorable / totalVolumeLots : 0,
    aggregateRiskPoints: totalVolumeLots > 0 ? weightedRisk / totalVolumeLots : 0,
    spreadPoints: getPositionManagementConfig().spreadBufferPoints,
    allBreakEvenApplied,
    groupBreakEvenApplied,
  };
}

export function groupOpenPositions(positions: ExecutionOpenPosition[]): PositionGroup[] {
  const buckets = new Map<string, ExecutionOpenPosition[]>();
  const orphans: ExecutionOpenPosition[] = [];

  for (const position of positions) {
    const setupGroupId = resolveSetupGroupId(position);
    if (!setupGroupId) {
      orphans.push(position);
      continue;
    }
    const bucket = buckets.get(setupGroupId) ?? [];
    bucket.push(position);
    buckets.set(setupGroupId, bucket);
  }

  // Fallback: batch siblings opened close together without persisted setupGroupId metadata.
  orphans.sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime());
  for (const position of orphans) {
    const symbol = String(position.symbol ?? '').toUpperCase();
    const side = String(position.side ?? 'buy').toLowerCase();
    const openedAt = new Date(position.openedAt).getTime();
    let matchedKey: string | null = null;
    for (const [key, grouped] of buckets.entries()) {
      const anchor = grouped[0];
      if (!anchor) continue;
      const sameSymbol = String(anchor.symbol ?? '').toUpperCase() === symbol;
      const sameSide = String(anchor.side ?? '').toLowerCase() === side;
      const closeInTime = Math.abs(new Date(anchor.openedAt).getTime() - openedAt) <= 120_000;
      if (sameSymbol && sameSide && closeInTime) {
        matchedKey = key;
        break;
      }
    }
    const key = matchedKey ?? `${symbol}:${side}:${Math.floor(openedAt / 120_000)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(position);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([setupGroupId, grouped]) => {
    const symbol = String(grouped[0]?.symbol ?? 'XAUUSD').toUpperCase();
    const side = String(grouped[0]?.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
    return {
      setupGroupId,
      symbol,
      side,
      positions: grouped,
      ...buildGroupSnapshot(grouped),
    };
  });
}

export function evaluateGroupBreakeven(group: PositionGroup): {
  shouldApply: boolean;
  reason: string;
  bufferPoints: number;
} {
  if (group.positions.length < 1) {
    return { shouldApply: false, reason: 'Group has no open legs.', bufferPoints: 0 };
  }
  if (group.allBreakEvenApplied || group.groupBreakEvenApplied) {
    return { shouldApply: false, reason: 'Group break-even already applied.', bufferPoints: 0 };
  }

  const baseConfig = getPositionManagementConfig();
  const goldConfig = resolveGoldAdaptiveManagementConfig(baseConfig, {
    symbol: group.symbol,
    favorablePoints: group.aggregateFavorablePoints,
    riskPoints: group.aggregateRiskPoints,
    rMultiple: group.aggregateRMultiple,
    spreadPoints: group.spreadPoints,
    peakRMultiple: group.aggregateRMultiple,
    breakEvenApplied: false,
  });

  const expectedLegs = Math.max(
    group.positions.length,
    ...group.positions.map((position) => Number(position.metadata?.legCount ?? 0)),
  );
  const minSubstantialUsd = envNumber(
    'CACSMS_GOLD_GROUP_BE_MIN_USD',
    Math.max(3, baseConfig.minPeakProfitUsd * Math.max(1, expectedLegs * 0.6)),
  );
  const minSubstantialR = envNumber('CACSMS_GOLD_GROUP_BE_MIN_R', Math.max(0.12, goldConfig.standardBreakEvenR * 0.35));
  const substantial =
    group.totalProfitLoss >= minSubstantialUsd
    && (group.aggregateRMultiple >= minSubstantialR || group.totalProfitLoss >= minSubstantialUsd * 1.25)
    && group.peakTotalProfit >= minSubstantialUsd * 0.75;

  if (!substantial) {
    return {
      shouldApply: false,
      reason: `Group profit $${group.totalProfitLoss.toFixed(2)} / ${group.aggregateRMultiple.toFixed(2)}R below substantial threshold.`,
      bufferPoints: goldConfig.spreadBufferPoints,
    };
  }

  if (
    isGoldSymbol(group.symbol)
    && group.totalProfitLoss < minSubstantialUsd * 1.35
    && !goldBreakEvenAllowed(
      {
        symbol: group.symbol,
        favorablePoints: group.aggregateFavorablePoints,
        riskPoints: group.aggregateRiskPoints,
        rMultiple: group.aggregateRMultiple,
        spreadPoints: group.spreadPoints,
        peakRMultiple: group.aggregateRMultiple,
        breakEvenApplied: false,
      },
      goldConfig.standardBreakEvenR,
    )
  ) {
    return {
      shouldApply: false,
      reason: 'Group break-even waiting for spread/volatility confirmation.',
      bufferPoints: goldConfig.spreadBufferPoints,
    };
  }

  return {
    shouldApply: true,
    reason: `Group of ${group.positions.length} legs reached $${group.totalProfitLoss.toFixed(2)} combined profit (${group.aggregateRMultiple.toFixed(2)}R weighted) — applying intelligent break-even across the stack.`,
    bufferPoints: goldConfig.spreadBufferPoints,
  };
}
