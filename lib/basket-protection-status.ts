import {
  evaluateBasketProfitLock,
  goldBasketProfitLockActivationUsd,
  goldBasketProfitLockTiers,
  isGoldBasketGroup,
} from '@/lib/gold-basket-management';
import { resolveGoldAdaptiveManagementConfig } from '@/lib/gold-adaptive-management';
import { listOpenPositions } from '@/lib/execution-open-positions';
import { groupOpenPositions } from '@/lib/position-group-management';
import { parsePositionManagementMetadata } from '@/lib/position-management-state';
import { getPositionManagementConfig } from '@/lib/trade-monitor-config';
import { isTradeMonitorEnabled } from '@/lib/trade-monitor-runtime';
import { isGoldSymbol } from '@/lib/gold-trading-engine';

export type BasketProtectionLeg = {
  ticket: string;
  profitLoss: number;
  stopLoss: number | null;
  takeProfit: number | null;
  breakEvenApplied: boolean;
  profitLockApplied: boolean;
  lastLockedSl: number | null;
};

export type BasketProtectionView = {
  basketId: string;
  symbol: string;
  side: string;
  legCount: number;
  floatingProfitUsd: number;
  peakProfitUsd: number;
  lockedProfitUsd: number;
  previousLockedUsd: number;
  activationUsd: number;
  nextTierTriggerUsd: number | null;
  nextTierLockUsd: number | null;
  tierLabel: string | null;
  givebackToCloseUsd: number;
  drawdownFromPeakUsd: number;
  protectionSource: 'ea' | 'server';
  eaManaged: boolean;
  closeArmed: boolean;
  status: 'inactive' | 'armed' | 'locked' | 'reversal' | 'closing';
  statusLabel: string;
  statusDetail: string;
  reversalDetected: boolean;
  lastAction: string | null;
  legs: BasketProtectionLeg[];
  brokerStopLoss: number | null;
  brokerTakeProfit: number | null;
  targetStopLoss: number | null;
  slModificationStatus: string | null;
  slModificationFailures: number;
  lastProtectionTick: string | null;
};

export type TradeProtectionOverview = {
  monitorEnabled: boolean;
  monitorTickMs: number;
  eaLocalBasketLock: boolean;
  eaBasketProtectionEnabled: boolean;
  baskets: BasketProtectionView[];
  orphanLegs: Array<{
    ticket: string;
    symbol: string;
    side: string;
    profitLoss: number;
    trailingPoints: number;
    breakEvenApplied: boolean;
    profitLockApplied: boolean;
    lastLockedSl: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    lastAction: string | null;
  }>;
  summary: {
    basketCount: number;
    totalFloatingUsd: number;
    highestLockedUsd: number;
    anyReversal: boolean;
  };
};

function monitorTickMs(): number {
  const raw = String(process.env.CACSMS_TRADE_MONITOR_TICK_MS ?? '').trim();
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 2_000;
}

function eaLocalBasketLockEnabled(): boolean {
  const raw = String(process.env.CACSMS_EA_LOCAL_BASKET_LOCK ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

type EaBasketSnapshot = {
  symbol: string;
  side: string;
  legCount: number;
  floatingUsd: number;
  peakUsd: number;
  lockedUsd: number;
  drawdownFromPeakUsd: number;
  closeArmed: boolean;
  targetStopLoss: number | null;
  slModificationStatus: string | null;
  slModificationFailures: number;
  lastProtectionTick: string | null;
};

async function fetchEaBasketSnapshots(): Promise<{ enabled: boolean; baskets: EaBasketSnapshot[] }> {
  try {
    const bridgeUrl = process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
    const response = await fetch(`${bridgeUrl}/terminals`, { cache: 'no-store' });
    if (!response.ok) return { enabled: false, baskets: [] };
    const payload = await response.json();
    const terminals = Array.isArray(payload.terminals) ? payload.terminals : [];
    const connected = terminals.filter(
      (terminal: { connectionStatus?: string; status?: string }) =>
        String(terminal?.connectionStatus ?? terminal?.status ?? '').toLowerCase() === 'connected',
    );
    const terminal = connected.find((item: { enableExecution?: boolean }) => item.enableExecution) ?? connected[0];
    if (!terminal) return { enabled: false, baskets: [] };
    const protection = (terminal as { basketProtection?: { enabled?: boolean; baskets?: unknown } }).basketProtection;
    const enabled = Boolean(protection?.enabled);
    const rows = Array.isArray(protection?.baskets) ? protection.baskets : [];
    const baskets = rows
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const symbol = String(row.symbol ?? '').toUpperCase().trim();
        const side = String(row.side ?? 'buy').toLowerCase();
        if (!symbol) return null;
        return {
          symbol,
          side,
          legCount: Number(row.legCount ?? 0),
          floatingUsd: Number(row.floatingUsd ?? 0),
          peakUsd: Number(row.peakUsd ?? 0),
          lockedUsd: Number(row.lockedUsd ?? 0),
          drawdownFromPeakUsd: Number(row.drawdownFromPeakUsd ?? 0),
          closeArmed: Boolean(row.closeArmed),
          targetStopLoss: row.targetStopLoss == null ? null : Number(row.targetStopLoss),
          slModificationStatus: row.slModificationStatus == null ? null : String(row.slModificationStatus),
          slModificationFailures: Number(row.slModificationFailures ?? 0),
          lastProtectionTick: row.lastProtectionTick == null || row.lastProtectionTick === '' ? null : String(row.lastProtectionTick),
        } satisfies EaBasketSnapshot;
      })
      .filter((item): item is EaBasketSnapshot => item != null);
    return { enabled, baskets };
  } catch {
    return { enabled: false, baskets: [] };
  }
}

function resolveNextTier(peakProfitUsd: number, lockedUsd: number): { trigger: number | null; lock: number | null } {
  for (const tier of goldBasketProfitLockTiers()) {
    if (peakProfitUsd + 1e-9 < tier.triggerUsd && tier.lockUsd > lockedUsd) {
      return { trigger: tier.triggerUsd, lock: tier.lockUsd };
    }
  }
  return { trigger: null, lock: null };
}

function basketStatusLabel(input: {
  decision: ReturnType<typeof evaluateBasketProfitLock>;
  activationUsd: number;
}): { status: BasketProtectionView['status']; label: string; detail: string } {
  const { decision, activationUsd } = input;
  if (decision.reversalDetected) {
    return {
      status: 'reversal',
      label: 'Reversal — closing basket',
      detail: `Floating $${decision.floatingProfitUsd.toFixed(2)} at or below locked floor $${decision.lockedProfitUsd.toFixed(2)}.`,
    };
  }
  if (decision.lockedProfitUsd > 0) {
    const cushion = decision.floatingProfitUsd - decision.lockedProfitUsd;
    return {
      status: 'locked',
      label: `Locked at $${decision.lockedProfitUsd.toFixed(0)}`,
      detail: `Peak $${decision.peakProfitUsd.toFixed(2)} · cushion $${cushion.toFixed(2)} before basket close.`,
    };
  }
  if (decision.peakProfitUsd >= activationUsd * 0.5) {
    return {
      status: 'armed',
      label: 'Armed',
      detail: `Peak $${decision.peakProfitUsd.toFixed(2)} · activates at $${activationUsd.toFixed(0)} combined profit.`,
    };
  }
  return {
    status: 'inactive',
    label: 'Watching',
    detail: `Floating $${decision.floatingProfitUsd.toFixed(2)} · lock activates at $${activationUsd.toFixed(0)}.`,
  };
}

export async function getTradeProtectionOverview(): Promise<TradeProtectionOverview> {
  const positions = await listOpenPositions({ limit: 100 });
  const groups = groupOpenPositions(positions);
  const eaSnapshots = await fetchEaBasketSnapshots();
  const basketTickets = new Set<string>();
  const baskets: BasketProtectionView[] = [];
  const activationUsd = goldBasketProfitLockActivationUsd();

  for (const group of groups) {
    if (!isGoldBasketGroup(group)) continue;
    const decision = evaluateBasketProfitLock(group);
    const eaMatch = eaSnapshots.baskets.find(
      (row) => row.symbol === group.symbol.toUpperCase() && row.side === group.side,
    );
    const floatingProfitUsd = eaMatch?.floatingUsd ?? decision.floatingProfitUsd;
    const peakProfitUsd = Math.max(decision.peakProfitUsd, eaMatch?.peakUsd ?? 0);
    const lockedProfitUsd = Math.max(decision.lockedProfitUsd, eaMatch?.lockedUsd ?? 0);
    const drawdownFromPeakUsd = eaMatch?.drawdownFromPeakUsd ?? Math.max(0, peakProfitUsd - floatingProfitUsd);
    const closeArmed = eaMatch?.closeArmed ?? (lockedProfitUsd > 0 && floatingProfitUsd <= lockedProfitUsd + 0.05);
    const mergedDecision = {
      ...decision,
      floatingProfitUsd,
      peakProfitUsd,
      lockedProfitUsd,
      reversalDetected: closeArmed,
    };
    const nextTier = resolveNextTier(peakProfitUsd, lockedProfitUsd);
    const status = basketStatusLabel({ decision: mergedDecision, activationUsd });
    if (closeArmed && status.status !== 'reversal') {
      status.status = 'reversal';
      status.label = 'Reversal — EA closing';
      status.detail = `Floating $${floatingProfitUsd.toFixed(2)} at or below locked floor $${lockedProfitUsd.toFixed(2)}.`;
    }
    const legs: BasketProtectionLeg[] = group.positions.map((position) => {
      const management = parsePositionManagementMetadata(position.metadata);
      basketTickets.add(position.ticket);
      return {
        ticket: position.ticket,
        profitLoss: Number(position.profitLoss ?? 0),
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        breakEvenApplied: management.breakEvenApplied,
        profitLockApplied: management.profitLockApplied,
        lastLockedSl: management.lastLockedSl ?? null,
      };
    });

    baskets.push({
      basketId: decision.basketId,
      symbol: group.symbol,
      side: group.side,
      legCount: eaMatch?.legCount ?? group.positions.length,
      floatingProfitUsd,
      peakProfitUsd,
      lockedProfitUsd,
      previousLockedUsd: decision.previousLockedUsd,
      activationUsd,
      nextTierTriggerUsd: nextTier.trigger,
      nextTierLockUsd: nextTier.lock,
      tierLabel: decision.tierLabel,
      givebackToCloseUsd: Math.max(0, floatingProfitUsd - lockedProfitUsd),
      drawdownFromPeakUsd,
      protectionSource: eaMatch ? 'ea' : 'server',
      eaManaged: Boolean(eaMatch),
      closeArmed,
      status: status.status,
      statusLabel: status.label,
      statusDetail: status.detail,
      reversalDetected: closeArmed,
      lastAction: group.positions[0]?.lastAction ?? null,
      legs,
      brokerStopLoss: legs[0]?.stopLoss ?? null,
      brokerTakeProfit: legs[0]?.takeProfit ?? null,
      targetStopLoss: eaMatch?.targetStopLoss ?? null,
      slModificationStatus: eaMatch?.slModificationStatus ?? null,
      slModificationFailures: eaMatch?.slModificationFailures ?? 0,
      lastProtectionTick: eaMatch?.lastProtectionTick ?? null,
    });
  }

  for (const eaBasket of eaSnapshots.baskets) {
    if (baskets.some((basket) => basket.symbol === eaBasket.symbol && basket.side === eaBasket.side)) continue;
    const mergedDecision = {
      floatingProfitUsd: eaBasket.floatingUsd,
      peakProfitUsd: eaBasket.peakUsd,
      lockedProfitUsd: eaBasket.lockedUsd,
      reversalDetected: eaBasket.closeArmed,
    };
    const status = basketStatusLabel({ decision: mergedDecision as ReturnType<typeof evaluateBasketProfitLock>, activationUsd });
    baskets.push({
      basketId: `${eaBasket.symbol}:${eaBasket.side}`,
      symbol: eaBasket.symbol,
      side: eaBasket.side,
      legCount: eaBasket.legCount,
      floatingProfitUsd: eaBasket.floatingUsd,
      peakProfitUsd: eaBasket.peakUsd,
      lockedProfitUsd: eaBasket.lockedUsd,
      previousLockedUsd: 0,
      activationUsd,
      nextTierTriggerUsd: resolveNextTier(eaBasket.peakUsd, eaBasket.lockedUsd).trigger,
      nextTierLockUsd: resolveNextTier(eaBasket.peakUsd, eaBasket.lockedUsd).lock,
      tierLabel: null,
      givebackToCloseUsd: Math.max(0, eaBasket.floatingUsd - eaBasket.lockedUsd),
      drawdownFromPeakUsd: eaBasket.drawdownFromPeakUsd,
      protectionSource: 'ea',
      eaManaged: true,
      closeArmed: eaBasket.closeArmed,
      status: eaBasket.closeArmed ? 'reversal' : status.status,
      statusLabel: eaBasket.closeArmed ? 'Reversal — EA closing' : status.label,
      statusDetail: status.detail,
      reversalDetected: eaBasket.closeArmed,
      lastAction: null,
      legs: [],
      brokerStopLoss: null,
      brokerTakeProfit: null,
      targetStopLoss: eaBasket.targetStopLoss,
      slModificationStatus: eaBasket.slModificationStatus,
      slModificationFailures: eaBasket.slModificationFailures,
      lastProtectionTick: eaBasket.lastProtectionTick,
    });
  }

  const baseConfig = getPositionManagementConfig();
  const orphanLegs = positions
    .filter((position) => !basketTickets.has(position.ticket))
    .map((position) => {
      const symbol = String(position.symbol ?? 'EURUSD').toUpperCase();
      const management = parsePositionManagementMetadata(position.metadata);
      const goldConfig = isGoldSymbol(symbol)
        ? resolveGoldAdaptiveManagementConfig(baseConfig, {
          symbol,
          favorablePoints: 0,
          riskPoints: baseConfig.defaultRiskPointsGold,
          rMultiple: 0,
          spreadPoints: baseConfig.spreadBufferPoints,
          peakRMultiple: 0,
          breakEvenApplied: management.breakEvenApplied,
        })
        : baseConfig;
      return {
        ticket: position.ticket,
        symbol,
        side: String(position.side ?? 'buy'),
        profitLoss: Number(position.profitLoss ?? 0),
        trailingPoints: goldConfig.trailingPoints,
        breakEvenApplied: management.breakEvenApplied,
        profitLockApplied: management.profitLockApplied,
        lastLockedSl: management.lastLockedSl ?? null,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        lastAction: position.lastAction,
      };
    });

  const totalFloatingUsd = positions.reduce((sum, position) => sum + Number(position.profitLoss ?? 0), 0);

  return {
    monitorEnabled: isTradeMonitorEnabled(),
    monitorTickMs: monitorTickMs(),
    eaLocalBasketLock: eaLocalBasketLockEnabled(),
    eaBasketProtectionEnabled: eaSnapshots.enabled,
    baskets,
    orphanLegs,
    summary: {
      basketCount: baskets.length,
      totalFloatingUsd: Number(totalFloatingUsd.toFixed(2)),
      highestLockedUsd: baskets.reduce((max, basket) => Math.max(max, basket.lockedProfitUsd), 0),
      anyReversal: baskets.some((basket) => basket.reversalDetected),
    },
  };
}
