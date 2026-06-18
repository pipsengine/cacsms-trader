import crypto from 'node:crypto';

import { logBasketProfitLockEvent } from '@/lib/basket-profit-lock-log';
import { dispatchExecutionCommand } from '@/lib/execution-dispatch';
import { hasPendingManagementCommand } from '@/lib/execution-bridge-store';
import { resolveExecutionAccountContext } from '@/lib/execution-account-context';
import { listOpenPositions, updatePositionEvaluation } from '@/lib/execution-open-positions';
import { isExecutionEnabled } from '@/lib/execution-policy';
import { parsePositionManagementMetadata } from '@/lib/position-management-state';
import { syncOpenPositionLiveMetrics } from '@/lib/position-profit-sync';
import { evaluateGroupBreakeven, groupOpenPositions } from '@/lib/position-group-management';
import {
  basketMetadataPatch,
  evaluateBasketProfitLock,
  goldBasketMinLegs,
  isGoldBasketGroup,
} from '@/lib/gold-basket-management';
import { isGoldSymbol } from '@/lib/gold-trading-engine';
import { getPositionManagementConfig } from '@/lib/trade-monitor-config';
import { goldPartialCloseStages, resolveGoldAdaptiveManagementConfig } from '@/lib/gold-adaptive-management';
import { readGoldRewardRiskPlan } from '@/lib/gold-dynamic-reward-risk';
import {
  TradeMonitoringEngine,
  type EnrichedTradeSnapshot,
  type TradeManagementAction,
} from '@/services/trade-monitor-service/src/trade-monitoring-engine';

let lastTickAt = 0;

function eaLocalBasketLockEnabled(): boolean {
  const raw = String(process.env.CACSMS_EA_LOCAL_BASKET_LOCK ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function tradeMonitorTickMs(): number {
  const raw = String(process.env.CACSMS_TRADE_MONITOR_TICK_MS ?? '').trim();
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 2_000;
}

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function isTradeMonitorEnabled(): boolean {
  return envBool('CACSMS_ENABLE_TRADE_MONITOR', true) && isExecutionEnabled();
}

function defaultRiskPoints(symbol: string): number {
  const config = getPositionManagementConfig();
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith('XAU') || normalized.startsWith('XAG')) return config.defaultRiskPointsGold;
  if (['US30', 'NASDAQ100', 'NAS100', 'SP500', 'SPX500', 'US500'].includes(normalized)) {
    return config.defaultRiskPointsIndex;
  }
  return config.defaultRiskPointsForex;
}

function buildEnrichedSnapshot(position: Awaited<ReturnType<typeof listOpenPositions>>[number]): EnrichedTradeSnapshot {
  const config = getPositionManagementConfig();
  const entry = position.entryPrice ?? position.currentPrice ?? 0;
  const side = String(position.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
  const symbol = String(position.symbol ?? 'EURUSD').toUpperCase();
  const point = symbol.startsWith('XAU') ? 0.01 : symbol.startsWith('BTC') ? 1 : 0.00001;
  const currentPrice = position.currentPrice ?? entry;
  const favorablePoints = side === 'buy'
    ? Math.max(0, (currentPrice - entry) / point)
    : Math.max(0, (entry - currentPrice) / point);
  const stop = position.stopLoss ?? 0;
  const riskPoints = entry > 0 && stop > 0 && Math.abs(entry - stop) > point
    ? Math.abs(entry - stop) / point
    : defaultRiskPoints(symbol);

  return {
    ticket: position.ticket,
    intent: {
      intentId: position.openCommandId,
      terminalId: position.terminalId,
      accountNumber: 'unknown',
      symbol,
      side,
      orderKind: 'market',
      requestedVolumeLots: position.volumeLots ?? 0.01,
      entryPrice: entry,
      stopLoss: stop || entry,
      takeProfit: position.takeProfit ?? entry,
      strategyId: 'trade-monitor',
      setupScore: 0,
      riskAmount: 0,
      rewardRiskRatio: 1,
      createdAt: position.openedAt,
    },
    currentPrice,
    profitLoss: position.profitLoss,
    openedAt: position.openedAt,
    lastUpdatedAt: new Date().toISOString(),
    symbol,
    side,
    volumeLots: position.volumeLots ?? 0.01,
    point,
    spreadPoints: config.spreadBufferPoints,
    bufferPoints: config.spreadBufferPoints,
    currentSl: stop,
    favorablePoints,
    riskPoints,
    rMultiple: riskPoints > 0 ? favorablePoints / riskPoints : 0,
    management: parsePositionManagementMetadata(position.metadata),
    positionMetadata: (position.metadata ?? {}) as Record<string, unknown>,
  };
}

async function dispatchBasketCloseCommand(input: {
  terminalId: string;
  ticket: string;
  symbol: string;
  basketId: string;
  reason: string;
}): Promise<boolean> {
  const account = await resolveExecutionAccountContext(input.terminalId);
  try {
    await dispatchExecutionCommand({
      commandId: `basket-close-${input.basketId}-${input.ticket}-${Date.now()}`,
      terminalId: input.terminalId,
      type: 'close_order',
      payload: {
        ticket: input.ticket,
        symbol: input.symbol,
        reason: input.reason,
        source: 'BASKET_PROFIT_LOCK',
        basketId: input.basketId,
      },
      sandboxMode: account?.sandboxMode ?? true,
      environment: account?.environment ?? 'DEMO',
      dedupeKey: `BASKET_CLOSE:${input.basketId}:${input.ticket}:${Math.floor(Date.now() / 3_000)}`,
      skipRiskGate: true,
      source: 'TRADE_MONITOR',
    });
    return true;
  } catch {
    return false;
  }
}

async function persistBasketEvaluation(input: {
  group: Awaited<ReturnType<typeof groupOpenPositions>>[number];
  basketDecision: ReturnType<typeof evaluateBasketProfitLock>;
  basketPatch: Record<string, unknown>;
  lastAction: string;
  lastActionReason: string;
}): Promise<void> {
  for (const position of input.group.positions) {
    await updatePositionEvaluation({
      id: position.id,
      currentPrice: position.currentPrice,
      profitLoss: position.profitLoss,
      lastAction: input.lastAction,
      lastActionReason: input.lastActionReason,
      metadata: input.basketPatch,
    });
  }
}

async function logBasketDecision(
  group: Awaited<ReturnType<typeof groupOpenPositions>>[number],
  decision: ReturnType<typeof evaluateBasketProfitLock>,
): Promise<void> {
  const terminalId = String(group.positions[0]?.terminalId ?? '').trim();
  if (!terminalId) return;

  if (decision.peakIncreased) {
    await logBasketProfitLockEvent({
      event: 'max_floating_profit',
      basketId: decision.basketId,
      terminalId,
      symbol: group.symbol,
      legCount: group.positions.length,
      floatingProfitUsd: decision.floatingProfitUsd,
      peakProfitUsd: decision.peakProfitUsd,
      lockedProfitUsd: decision.lockedProfitUsd,
      previousLockedUsd: decision.previousLockedUsd,
      tierLabel: decision.tierLabel,
      message: `Max floating profit updated to $${decision.peakProfitUsd.toFixed(2)} for basket ${decision.basketId}.`,
    });
  }

  if (decision.action === 'activate_lock') {
    await logBasketProfitLockEvent({
      event: 'lock_activated',
      basketId: decision.basketId,
      terminalId,
      symbol: group.symbol,
      legCount: group.positions.length,
      floatingProfitUsd: decision.floatingProfitUsd,
      peakProfitUsd: decision.peakProfitUsd,
      lockedProfitUsd: decision.lockedProfitUsd,
      previousLockedUsd: decision.previousLockedUsd,
      tierLabel: decision.tierLabel,
      message: decision.reason,
    });
  }

  if (decision.action === 'raise_lock') {
    await logBasketProfitLockEvent({
      event: 'lock_raised',
      basketId: decision.basketId,
      terminalId,
      symbol: group.symbol,
      legCount: group.positions.length,
      floatingProfitUsd: decision.floatingProfitUsd,
      peakProfitUsd: decision.peakProfitUsd,
      lockedProfitUsd: decision.lockedProfitUsd,
      previousLockedUsd: decision.previousLockedUsd,
      tierLabel: decision.tierLabel,
      message: decision.reason,
    });
  }

  if (decision.reversalDetected) {
    await logBasketProfitLockEvent({
      event: 'reversal_detected',
      basketId: decision.basketId,
      terminalId,
      symbol: group.symbol,
      legCount: group.positions.length,
      floatingProfitUsd: decision.floatingProfitUsd,
      peakProfitUsd: decision.peakProfitUsd,
      lockedProfitUsd: decision.lockedProfitUsd,
      previousLockedUsd: decision.previousLockedUsd,
      tierLabel: decision.tierLabel,
      message: decision.reason,
    });
  }
}

async function dispatchManagementCommand(input: {
  terminalId: string;
  type: string;
  ticket: string;
  symbol: string;
  payload: Record<string, unknown>;
  reason: string;
}): Promise<boolean> {
  const normalizedType = input.type.trim().toLowerCase().replaceAll('-', '_');
  if (await hasPendingManagementCommand({
    terminalId: input.terminalId,
    ticket: input.ticket,
    type: normalizedType,
  })) {
    return false;
  }

  const account = await resolveExecutionAccountContext(input.terminalId);
  try {
    await dispatchExecutionCommand({
      commandId: `mgmt-${crypto.randomUUID()}`,
      terminalId: input.terminalId,
      type: input.type,
      payload: {
        ...input.payload,
        ticket: input.ticket,
        symbol: input.symbol,
        reason: input.reason,
        source: 'TRADE_MONITOR',
      },
      sandboxMode: account?.sandboxMode ?? true,
      environment: account?.environment ?? 'DEMO',
      dedupeKey: `MGMT:${normalizedType}:${input.terminalId}:${input.ticket}`,
      skipRiskGate: true,
      source: 'TRADE_MONITOR',
    });
    return true;
  } catch {
    return false;
  }
}

function metadataAfterAction(action: TradeManagementAction): Record<string, unknown> {
  const now = new Date().toISOString();
  if (action.action === 'move_to_break_even' || action.action === 'profit_reversal_guard') {
    return { breakEvenApplied: true, lastActionAt: now };
  }
  if (action.action === 'profit_lock_stop') {
    return {
      profitLockApplied: true,
      breakEvenApplied: true,
      lastLockedSl: action.stopLoss ?? null,
      lastActionAt: now,
    };
  }
  if (action.action === 'partial_close') {
    return { lastActionAt: now };
  }
  return { lastActionAt: now };
}

function shouldSkipCooldown(position: Awaited<ReturnType<typeof listOpenPositions>>[number], urgent: boolean): boolean {
  if (!position.lastEvaluatedAt) return false;
  const config = getPositionManagementConfig();
  const elapsedSec = (Date.now() - new Date(position.lastEvaluatedAt).getTime()) / 1000;
  return elapsedSec < (urgent ? config.urgentCooldownSec : config.normalCooldownSec);
}

function isBasketManagedPosition(
  position: Awaited<ReturnType<typeof listOpenPositions>>[number],
  positions: Awaited<ReturnType<typeof listOpenPositions>>,
): boolean {
  const metadata = position.metadata ?? {};
  if (Boolean(metadata.basketManaged)) return true;
  if (Boolean(metadata.batchEntry) && Number(metadata.legCount ?? 0) >= goldBasketMinLegs()) return true;

  const symbol = String(position.symbol ?? '').toUpperCase();
  if (!isGoldSymbol(symbol)) return false;
  const side = String(position.side ?? 'buy').toLowerCase();
  const openedAt = new Date(position.openedAt).getTime();
  const siblings = positions.filter((candidate) => {
    if (String(candidate.symbol ?? '').toUpperCase() !== symbol) return false;
    if (String(candidate.side ?? 'buy').toLowerCase() !== side) return false;
    return Math.abs(new Date(candidate.openedAt).getTime() - openedAt) <= 120_000;
  });
  return siblings.length >= goldBasketMinLegs();
}

export async function runTradeMonitorTick(now = Date.now(), options?: { force?: boolean }): Promise<{
  evaluated: number;
  actions: number;
  dispatched: number;
  synced: number;
}> {
  if (!isTradeMonitorEnabled()) {
    return { evaluated: 0, actions: 0, dispatched: 0, synced: 0 };
  }

  const throttleMs = options?.force ? 0 : tradeMonitorTickMs();
  if (now - lastTickAt < throttleMs) {
    return { evaluated: 0, actions: 0, dispatched: 0, synced: 0 };
  }
  lastTickAt = now;

  const sync = await syncOpenPositionLiveMetrics();
  const positions = await listOpenPositions({ limit: 100 });
  const basketManagedTickets = new Set(
    positions
      .filter((position) => isBasketManagedPosition(position, positions))
      .map((position) => position.ticket),
  );
  let actions = 0;
  let dispatched = 0;

  for (const group of groupOpenPositions(positions)) {
    if (!isGoldBasketGroup(group)) continue;

    const basketDecision = evaluateBasketProfitLock(group);
    const lockActivatedAt = basketDecision.action === 'activate_lock'
      ? new Date().toISOString()
      : String(group.positions[0]?.metadata?.basketLockActivatedAt ?? '') || null;
    const basketPatch = basketMetadataPatch({
      basketId: basketDecision.basketId,
      peakProfitUsd: basketDecision.peakProfitUsd,
      lockedProfitUsd: basketDecision.lockedProfitUsd,
      tierLabel: basketDecision.tierLabel,
      lockActivatedAt,
    });

    await logBasketDecision(group, basketDecision);

    if (basketDecision.action === 'close_all') {
      if (!eaLocalBasketLockEnabled()) {
        let closedLegs = 0;
        for (const position of group.positions) {
          actions += 1;
          const ok = await dispatchBasketCloseCommand({
            terminalId: position.terminalId,
            ticket: position.ticket,
            symbol: group.symbol,
            basketId: basketDecision.basketId,
            reason: basketDecision.reason,
          });
          if (ok) {
            dispatched += 1;
            closedLegs += 1;
          }
        }

        if (closedLegs > 0) {
          const terminalId = String(group.positions[0]?.terminalId ?? '').trim();
          if (terminalId) {
            await logBasketProfitLockEvent({
              event: 'basket_closed',
              basketId: basketDecision.basketId,
              terminalId,
              symbol: group.symbol,
              legCount: group.positions.length,
              floatingProfitUsd: basketDecision.floatingProfitUsd,
              peakProfitUsd: basketDecision.peakProfitUsd,
              lockedProfitUsd: basketDecision.lockedProfitUsd,
              previousLockedUsd: basketDecision.previousLockedUsd,
              tierLabel: basketDecision.tierLabel,
              message: `Basket ${basketDecision.basketId} closed (${closedLegs}/${group.positions.length} legs dispatched) at locked floor $${basketDecision.lockedProfitUsd.toFixed(2)}.`,
            });
          }
        }
      }

      await persistBasketEvaluation({
        group,
        basketDecision,
        basketPatch,
        lastAction: eaLocalBasketLockEnabled() ? 'basket_profit_lock_ea_delegated' : 'basket_profit_lock_close',
        lastActionReason: eaLocalBasketLockEnabled()
          ? `${basketDecision.reason} Delegated to EA OnTick protection.`
          : basketDecision.reason,
      });
      continue;
    }

    const lastAction = basketDecision.action === 'activate_lock'
      ? 'basket_profit_lock_activated'
      : basketDecision.action === 'raise_lock'
        ? 'basket_profit_lock_raised'
        : 'basket_profit_lock_hold';

    await persistBasketEvaluation({
      group,
      basketDecision,
      basketPatch,
      lastAction,
      lastActionReason: basketDecision.reason,
    });
  }

  for (const group of groupOpenPositions(positions)) {
    if (isGoldBasketGroup(group)) continue;
    const groupDecision = evaluateGroupBreakeven(group);
    if (!groupDecision.shouldApply) continue;

    for (const position of group.positions) {
      const management = parsePositionManagementMetadata(position.metadata);
      if (management.breakEvenApplied || Boolean(position.metadata?.groupBreakEvenApplied)) continue;
      if (shouldSkipCooldown(position, true)) continue;

      actions += 1;
      const ok = await dispatchManagementCommand({
        terminalId: position.terminalId,
        type: 'move_to_breakeven',
        ticket: position.ticket,
        symbol: group.symbol,
        payload: { bufferPoints: groupDecision.bufferPoints },
        reason: groupDecision.reason,
      });
      if (ok) {
        dispatched += 1;
        await updatePositionEvaluation({
          id: position.id,
          currentPrice: position.currentPrice,
          profitLoss: position.profitLoss,
          lastAction: 'move_to_break_even',
          lastActionReason: groupDecision.reason,
          metadata: {
            groupBreakEvenRequested: true,
            groupProfitUsd: group.totalProfitLoss,
            groupRMultiple: group.aggregateRMultiple,
            lastActionAt: new Date().toISOString(),
          },
        });
      }
    }
  }

  for (const position of positions) {
    if (basketManagedTickets.has(position.ticket)) {
      continue;
    }

    const snapshot = buildEnrichedSnapshot(position);
    const config = resolveGoldAdaptiveManagementConfig(getPositionManagementConfig(), {
      symbol: snapshot.symbol,
      favorablePoints: snapshot.favorablePoints,
      riskPoints: snapshot.riskPoints,
      rMultiple: snapshot.rMultiple,
      spreadPoints: snapshot.spreadPoints,
      peakRMultiple: snapshot.management.peakRMultiple,
      breakEvenApplied: snapshot.management.breakEvenApplied,
      rewardRiskPlan: readGoldRewardRiskPlan(snapshot.positionMetadata),
    });
    const decision = new TradeMonitoringEngine(config).evaluatePosition(snapshot);
    if (decision.action === 'hold') {
      await updatePositionEvaluation({
        id: position.id,
        currentPrice: snapshot.currentPrice,
        profitLoss: snapshot.profitLoss,
        lastAction: 'hold',
        lastActionReason: decision.reason,
      });
      continue;
    }

    if (shouldSkipCooldown(position, decision.urgent)) continue;

    actions += 1;
    let commandType = '';
    const payload: Record<string, unknown> = {
      ticket: position.ticket,
      symbol: snapshot.symbol,
      reason: decision.reason,
    };

    switch (decision.action) {
      case 'move_to_break_even':
      case 'profit_reversal_guard':
        commandType = 'move_to_breakeven';
        payload.bufferPoints = decision.bufferPoints ?? getPositionManagementConfig().spreadBufferPoints;
        break;
      case 'profit_lock_stop':
        commandType = 'modify_order';
        payload.stopLoss = decision.stopLoss;
        break;
      case 'partial_close':
        commandType = 'partial_close';
        payload.volumeLots = Math.max(
          0.01,
          Number(((position.volumeLots ?? 0.01) * (decision.partialCloseFraction ?? 0.5)).toFixed(2)),
        );
        break;
      case 'trail_stop':
        commandType = 'set_trailing_stop';
        payload.trailingPoints = decision.trailingPoints ?? getPositionManagementConfig().trailingPoints;
        break;
      case 'time_exit':
      case 'invalid_setup_exit':
        commandType = 'close_order';
        break;
      default:
        continue;
    }

    const ok = await dispatchManagementCommand({
      terminalId: position.terminalId,
      type: commandType,
      ticket: position.ticket,
      symbol: snapshot.symbol,
      payload,
      reason: decision.reason,
    });
    if (ok) {
      dispatched += 1;
      const actionMetadata = metadataAfterAction(decision);
      if (decision.action === 'partial_close') {
        const currentStage = parsePositionManagementMetadata(position.metadata).partialCloseStage ?? 0;
        const stages = goldPartialCloseStages({ metadata: position.metadata as Record<string, unknown> });
        const nextStage = currentStage + 1;
        Object.assign(actionMetadata, {
          partialCloseStage: nextStage,
          partialCloseApplied: stages.length > 0 ? nextStage >= stages.length : true,
        });
      }
      await updatePositionEvaluation({
        id: position.id,
        currentPrice: snapshot.currentPrice,
        profitLoss: snapshot.profitLoss,
        lastAction: decision.action,
        lastActionReason: decision.reason,
        metadata: actionMetadata,
      });
    }
  }

  return {
    evaluated: positions.length,
    actions,
    dispatched,
    synced: sync.updated,
  };
}
