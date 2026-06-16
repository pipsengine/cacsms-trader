import type { PositionGroup } from '@/lib/position-group-management';
import { isGoldSymbol } from '@/lib/gold-trading-engine';

export type BasketProfitLockTier = {
  triggerUsd: number;
  lockUsd: number;
};

export type BasketManagementDecision = {
  action: 'hold' | 'close_all' | 'update_lock';
  reason: string;
  lockedProfitUsd: number;
  peakProfitUsd: number;
  tierLabel: string | null;
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
    ?? '20:15,50:40,100:85,200:170,500:450',
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
    { triggerUsd: 20, lockUsd: 15 },
    { triggerUsd: 50, lockUsd: 40 },
    { triggerUsd: 100, lockUsd: 85 },
    { triggerUsd: 200, lockUsd: 170 },
  ];
}

export function goldBasketProfitLockActivationUsd(): number {
  return Math.max(5, envNumber('CACSMS_GOLD_BASKET_PROFIT_LOCK_START_USD', 20));
}

export function isGoldBasketGroup(group: PositionGroup): boolean {
  if (!isGoldSymbol(group.symbol)) return false;
  const expectedLegs = Math.max(
    ...group.positions.map((position) => Number(position.metadata?.legCount ?? 0)),
    group.positions.length,
  );
  const batchEntry = group.positions.some((position) => Boolean(position.metadata?.batchEntry));
  const basketManaged = group.positions.some((position) => Boolean(position.metadata?.basketManaged));
  return batchEntry || basketManaged || expectedLegs >= 5;
}

export function resolveBasketLockedProfit(peakProfitUsd: number, currentLockedUsd = 0): {
  lockedProfitUsd: number;
  tierLabel: string | null;
} {
  let locked = Math.max(0, currentLockedUsd);
  let tierLabel: string | null = null;
  for (const tier of goldBasketProfitLockTiers()) {
    if (peakProfitUsd >= tier.triggerUsd) {
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
  let peakProfitUsd = group.peakTotalProfit;
  let lockedProfitUsd = 0;
  let basketId = group.setupGroupId;

  for (const position of group.positions) {
    const metadata = position.metadata ?? {};
    peakProfitUsd = Math.max(
      peakProfitUsd,
      Number(metadata.basketPeakProfitUsd ?? 0),
      Number(position.profitLoss ?? 0),
    );
    lockedProfitUsd = Math.max(lockedProfitUsd, Number(metadata.basketLockedProfitUsd ?? 0));
    basketId = String(metadata.basketId ?? basketId);
  }

  peakProfitUsd = Math.max(peakProfitUsd, group.totalProfitLoss);
  return { peakProfitUsd, lockedProfitUsd, basketId };
}

export function evaluateBasketProfitLock(group: PositionGroup): BasketManagementDecision {
  if (!isGoldBasketGroup(group)) {
    return {
      action: 'hold',
      reason: 'Not a Gold basket-managed group.',
      lockedProfitUsd: 0,
      peakProfitUsd: group.totalProfitLoss,
      tierLabel: null,
    };
  }

  const state = readGroupBasketState(group);
  const { lockedProfitUsd, tierLabel } = resolveBasketLockedProfit(state.peakProfitUsd, state.lockedProfitUsd);
  const activation = goldBasketProfitLockActivationUsd();

  if (state.peakProfitUsd < activation) {
    return {
      action: 'hold',
      reason: `Basket profit $${group.totalProfitLoss.toFixed(2)} below activation $${activation}.`,
      lockedProfitUsd: 0,
      peakProfitUsd: state.peakProfitUsd,
      tierLabel: null,
    };
  }

  if (lockedProfitUsd > 0 && group.totalProfitLoss <= lockedProfitUsd) {
    return {
      action: 'close_all',
      reason: `Basket profit reversed to $${group.totalProfitLoss.toFixed(2)} — securing locked profit $${lockedProfitUsd.toFixed(2)} across ${group.positions.length} legs.`,
      lockedProfitUsd,
      peakProfitUsd: state.peakProfitUsd,
      tierLabel,
    };
  }

  if (lockedProfitUsd > state.lockedProfitUsd) {
    return {
      action: 'update_lock',
      reason: `Basket peak $${state.peakProfitUsd.toFixed(2)} — progressive lock raised to $${lockedProfitUsd.toFixed(2)} (${tierLabel ?? 'tier'}).`,
      lockedProfitUsd,
      peakProfitUsd: state.peakProfitUsd,
      tierLabel,
    };
  }

  return {
    action: 'hold',
    reason: `Basket floating $${group.totalProfitLoss.toFixed(2)} · locked floor $${lockedProfitUsd.toFixed(2)} · peak $${state.peakProfitUsd.toFixed(2)}.`,
    lockedProfitUsd,
    peakProfitUsd: state.peakProfitUsd,
    tierLabel,
  };
}

export function basketMetadataPatch(input: {
  basketId: string;
  peakProfitUsd: number;
  lockedProfitUsd: number;
  tierLabel?: string | null;
}): Record<string, unknown> {
  return {
    basketId: input.basketId,
    basketManaged: true,
    basketPeakProfitUsd: input.peakProfitUsd,
    basketLockedProfitUsd: input.lockedProfitUsd,
    basketLockTier: input.tierLabel ?? null,
    basketLastEvaluatedAt: new Date().toISOString(),
  };
}
