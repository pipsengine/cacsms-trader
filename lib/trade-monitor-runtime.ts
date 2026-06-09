import crypto from 'node:crypto';

import { dispatchExecutionCommand } from '@/lib/execution-dispatch';
import { listOpenPositions, updatePositionEvaluation } from '@/lib/execution-open-positions';
import { isExecutionEnabled } from '@/lib/execution-policy';
import { parsePositionManagementMetadata } from '@/lib/position-management-state';
import { syncOpenPositionLiveMetrics } from '@/lib/position-profit-sync';
import { getPositionManagementConfig } from '@/lib/trade-monitor-config';
import {
  TradeMonitoringEngine,
  type EnrichedTradeSnapshot,
  type TradeManagementAction,
} from '@/services/trade-monitor-service/src/trade-monitoring-engine';

let lastTickAt = 0;
let engine = new TradeMonitoringEngine(getPositionManagementConfig());

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
      sandboxMode: true,
      environment: 'DEMO',
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
  return { lastActionAt: now };
}

function shouldSkipCooldown(position: Awaited<ReturnType<typeof listOpenPositions>>[number], urgent: boolean): boolean {
  if (!position.lastEvaluatedAt) return false;
  const config = getPositionManagementConfig();
  const elapsedSec = (Date.now() - new Date(position.lastEvaluatedAt).getTime()) / 1000;
  return elapsedSec < (urgent ? config.urgentCooldownSec : config.normalCooldownSec);
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

  engine = new TradeMonitoringEngine(getPositionManagementConfig());
  const sync = await syncOpenPositionLiveMetrics();
  const positions = await listOpenPositions({ limit: 100 });
  let actions = 0;
  let dispatched = 0;

  for (const position of positions) {
    const snapshot = buildEnrichedSnapshot(position);
    const decision = engine.evaluatePosition(snapshot);
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
    if (ok) dispatched += 1;

    await updatePositionEvaluation({
      id: position.id,
      currentPrice: snapshot.currentPrice,
      profitLoss: snapshot.profitLoss,
      lastAction: decision.action,
      lastActionReason: decision.reason,
      metadata: metadataAfterAction(decision),
    });
  }

  return {
    evaluated: positions.length,
    actions,
    dispatched,
    synced: sync.updated,
  };
}
