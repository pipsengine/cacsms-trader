import crypto from 'node:crypto';

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
  isGoldBasketGroup,
} from '@/lib/gold-basket-management';
import { getPositionManagementConfig } from '@/lib/trade-monitor-config';
import { goldPartialCloseStages, resolveGoldAdaptiveManagementConfig } from '@/lib/gold-adaptive-management';
import { readGoldRewardRiskPlan } from '@/lib/gold-dynamic-reward-risk';
import {
  TradeMonitoringEngine,
  type EnrichedTradeSnapshot,
  type TradeManagementAction,
} from '@/services/trade-monitor-service/src/trade-monitoring-engine';

let lastTickAt = 0;

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

function isBasketManagedPosition(position: Awaited<ReturnType<typeof listOpenPositions>>[number]): boolean {
  const metadata = position.metadata ?? {};
  return Boolean(metadata.basketManaged || (metadata.batchEntry && Number(metadata.legCount ?? 0) >= 5));
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

  const throttleMs = options?.force ? 0 : 5_000;
  if (now - lastTickAt < throttleMs) {
    return { evaluated: 0, actions: 0, dispatched: 0, synced: 0 };
  }
  lastTickAt = now;

  const sync = await syncOpenPositionLiveMetrics();
  const positions = await listOpenPositions({ limit: 100 });
  const basketManagedTickets = new Set(
    positions.filter((position) => isBasketManagedPosition(position)).map((position) => position.ticket),
  );
  let actions = 0;
  let dispatched = 0;

  for (const group of groupOpenPositions(positions)) {
    if (!isGoldBasketGroup(group)) continue;

    const basketDecision = evaluateBasketProfitLock(group);
    const basketPatch = basketMetadataPatch({
      basketId: group.setupGroupId,
      peakProfitUsd: basketDecision.peakProfitUsd,
      lockedProfitUsd: basketDecision.lockedProfitUsd,
      tierLabel: basketDecision.tierLabel,
    });

    if (basketDecision.action === 'close_all') {
      for (const position of group.positions) {
        if (shouldSkipCooldown(position, true)) continue;
        actions += 1;
        const ok = await dispatchManagementCommand({
          terminalId: position.terminalId,
          type: 'close_order',
          ticket: position.ticket,
          symbol: group.symbol,
          payload: { reason: basketDecision.reason },
          reason: basketDecision.reason,
        });
        if (ok) {
          dispatched += 1;
          await updatePositionEvaluation({
            id: position.id,
            currentPrice: position.currentPrice,
            profitLoss: position.profitLoss,
            lastAction: 'basket_profit_lock_close',
            lastActionReason: basketDecision.reason,
            metadata: basketPatch,
          });
        }
      }
      continue;
    }

    if (basketDecision.action === 'update_lock' || basketDecision.lockedProfitUsd > 0) {
      for (const position of group.positions) {
        await updatePositionEvaluation({
          id: position.id,
          currentPrice: position.currentPrice,
          profitLoss: position.profitLoss,
          lastAction: basketDecision.action === 'update_lock' ? 'basket_profit_lock_update' : 'basket_hold',
          lastActionReason: basketDecision.reason,
          metadata: basketPatch,
        });
      }
    }

    const groupDecision = evaluateGroupBreakeven(group);
    if (groupDecision.shouldApply) {
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
              ...basketPatch,
              groupBreakEvenRequested: true,
              groupBreakEvenApplied: true,
              groupProfitUsd: group.totalProfitLoss,
              groupRMultiple: group.aggregateRMultiple,
              lastActionAt: new Date().toISOString(),
            },
          });
        }
      }
    }
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
      await updatePositionEvaluation({
        id: position.id,
        currentPrice: position.currentPrice,
        profitLoss: position.profitLoss,
        lastAction: 'basket_managed_hold',
        lastActionReason: 'Basket-level management active — individual leg actions suppressed.',
      });
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
