import type { PositionGroup } from '@/lib/position-group-management';
import { isGoldSymbol } from '@/lib/gold-trading-engine';

export type BasketProfitLockTier = {
  triggerUsd: number;
  lockUsd: number;
};

export type BasketManagementDecision = {
  action: 'hold' | 'close_all' | 'activate_lock' | 'raise_lock';
  basketId: string;
  reason: string;
  floatingProfitUsd: number;
  lockedProfitUsd: number;
  previousLockedUsd: number;
  peakProfitUsd: number;
  tierLabel: string | null;
  reversalDetected: boolean;
  peakIncreased: boolean;
};

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Progressive basket profit-lock tiers: triggerUsd:lockUsd pairs. */
export function goldBasketProfitLockTiers(): BasketProfitLockTier[] {
  const raw = String(
    process.env.CACSMS_GOLD_BASKET_PROFIT_LOCK_TIERS
    ?? '20:20,50:40,100:80,200:170,500:450',
  ).trim();
  const tiers = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [trigger, lock] = part.split(':').map((value) => Number(value.trim()));
      if (!Number.isFinite(trigger) || !Number.isFinite(lock) || trigger <= 0 || lock < 0) return null;
      return { triggerUsd: trigger, lockUsd: lock };
    })
    .filter((tier): tier is BasketProfitLockTier => tier != null)
    .sort((a, b) => a.triggerUsd - b.triggerUsd);
  if (tiers.length > 0) return tiers;
  return [
    { triggerUsd: 20, lockUsd: 20 },
    { triggerUsd: 50, lockUsd: 40 },
    { triggerUsd: 100, lockUsd: 80 },
    { triggerUsd: 200, lockUsd: 170 },
  ];
}

export function goldBasketProfitLockActivationUsd(): number {
  return Math.max(5, envNumber('CACSMS_GOLD_BASKET_PROFIT_LOCK_START_USD', 20));
}

export function goldBasketMinLegs(): number {
  return Math.max(2, envNumber('CACSMS_GOLD_BASKET_MIN_LEGS', 2));
}

export function isGoldBasketGroup(group: PositionGroup): boolean {
  if (!isGoldSymbol(group.symbol)) return false;
  const expectedLegs = Math.max(
    ...group.positions.map((position) => Number(position.metadata?.legCount ?? 0)),
    group.positions.length,
  );
  const batchEntry = group.positions.some((position) => Boolean(position.metadata?.batchEntry));
  const basketManaged = group.positions.some((position) => Boolean(position.metadata?.basketManaged));
  return batchEntry || basketManaged || expectedLegs >= goldBasketMinLegs();
}

/** Lock floor from peak profit — never reduces below the prior locked amount. */
export function resolveBasketLockedProfit(peakProfitUsd: number, currentLockedUsd = 0): {
  lockedProfitUsd: number;
  tierLabel: string | null;
} {
  let locked = Math.max(0, currentLockedUsd);
  let tierLabel: string | null = null;
  for (const tier of goldBasketProfitLockTiers()) {
    if (peakProfitUsd + 1e-9 >= tier.triggerUsd) {
      locked = Math.max(locked, tier.lockUsd);
      tierLabel = `$${tier.triggerUsd}→lock $${tier.lockUsd}`;
    }
  }
  return { lockedProfitUsd: locked, tierLabel };
}

export function readGroupBasketState(group: PositionGroup): {
  peakProfitUsd: number;
  lockedProfitUsd: number;
  basketId: string;
} {
  let storedPeak = 0;
  let lockedProfitUsd = 0;
  let basketId = group.setupGroupId;

  for (const position of group.positions) {
    const metadata = position.metadata ?? {};
    storedPeak = Math.max(storedPeak, Number(metadata.basketPeakProfitUsd ?? 0));
    lockedProfitUsd = Math.max(lockedProfitUsd, Number(metadata.basketLockedProfitUsd ?? 0));
    basketId = String(metadata.basketId ?? metadata.setupGroupId ?? basketId);
  }

  const floatingProfitUsd = group.totalProfitLoss;
  const peakProfitUsd = Math.max(storedPeak, floatingProfitUsd);

  return { peakProfitUsd, lockedProfitUsd, basketId };
}

export function evaluateBasketProfitLock(group: PositionGroup): BasketManagementDecision {
  const floatingProfitUsd = group.totalProfitLoss;

  if (!isGoldBasketGroup(group)) {
    return {
      action: 'hold',
      basketId: group.setupGroupId,
      reason: 'Not a Gold basket-managed group.',
      floatingProfitUsd,
      lockedProfitUsd: 0,
      previousLockedUsd: 0,
      peakProfitUsd: floatingProfitUsd,
      tierLabel: null,
      reversalDetected: false,
      peakIncreased: false,
    };
  }

  const state = readGroupBasketState(group);
  const previousLockedUsd = state.lockedProfitUsd;
  const previousPeakUsd = state.peakProfitUsd;
  const peakProfitUsd = Math.max(previousPeakUsd, floatingProfitUsd);
  const peakIncreased = peakProfitUsd > previousPeakUsd + 1e-9;
  const { lockedProfitUsd, tierLabel } = resolveBasketLockedProfit(peakProfitUsd, previousLockedUsd);
  const activation = goldBasketProfitLockActivationUsd();

  const base = {
    basketId: state.basketId,
    floatingProfitUsd,
    lockedProfitUsd,
    previousLockedUsd,
    peakProfitUsd,
    tierLabel,
    reversalDetected: false,
    peakIncreased,
  };

  if (lockedProfitUsd > 0 && floatingProfitUsd <= lockedProfitUsd + 1e-9) {
    return {
      ...base,
      action: 'close_all',
      reversalDetected: true,
      reason: `Basket reversal: floating profit $${floatingProfitUsd.toFixed(2)} fell to locked floor $${lockedProfitUsd.toFixed(2)} — closing all ${group.positions.length} legs immediately.`,
    };
  }

  if (lockedProfitUsd > previousLockedUsd + 1e-9) {
    const action = previousLockedUsd <= 0 ? 'activate_lock' : 'raise_lock';
    return {
      ...base,
      action,
      reason: action === 'activate_lock'
        ? `Basket profit lock activated at peak $${peakProfitUsd.toFixed(2)} — floor locked at $${lockedProfitUsd.toFixed(2)} (${tierLabel ?? 'tier'}).`
        : `Basket profit lock raised to $${lockedProfitUsd.toFixed(2)} after peak $${peakProfitUsd.toFixed(2)} (${tierLabel ?? 'tier'}).`,
    };
  }

  if (peakProfitUsd < activation) {
    return {
      ...base,
      action: 'hold',
      reason: `Basket floating $${floatingProfitUsd.toFixed(2)} · peak $${peakProfitUsd.toFixed(2)} below activation $${activation}.`,
    };
  }

  return {
    ...base,
    action: 'hold',
    reason: `Basket floating $${floatingProfitUsd.toFixed(2)} · locked floor $${lockedProfitUsd.toFixed(2)} · peak $${peakProfitUsd.toFixed(2)}.`,
  };
}

export function basketMetadataPatch(input: {
  basketId: string;
  peakProfitUsd: number;
  lockedProfitUsd: number;
  tierLabel?: string | null;
  lockActivatedAt?: string | null;
}): Record<string, unknown> {
  return {
    basketId: input.basketId,
    basketManaged: true,
    basketPeakProfitUsd: input.peakProfitUsd,
    basketLockedProfitUsd: input.lockedProfitUsd,
    basketLockTier: input.tierLabel ?? null,
    basketLockActivatedAt: input.lockActivatedAt ?? null,
    basketLastEvaluatedAt: new Date().toISOString(),
  };
}
