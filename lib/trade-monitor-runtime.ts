import crypto from 'node:crypto';
import { dispatchExecutionCommand } from '@/lib/execution-dispatch';
import { listOpenPositions, updatePositionEvaluation } from '@/lib/execution-open-positions';
import { isExecutionEnabled } from '@/lib/execution-policy';
import { TradeMonitoringEngine, type OpenTradeSnapshot } from '@/services/trade-monitor-service/src/trade-monitoring-engine';

const engine = new TradeMonitoringEngine();
let lastTickAt = 0;

function envBool(name: string, fallback = false): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function isTradeMonitorEnabled(): boolean {
  return envBool('CACSMS_ENABLE_TRADE_MONITOR', true) && isExecutionEnabled();
}

function toSnapshot(position: Awaited<ReturnType<typeof listOpenPositions>>[number]): OpenTradeSnapshot {
  const entry = position.entryPrice ?? position.currentPrice ?? 0;
  const side = String(position.side ?? 'buy').toLowerCase() === 'sell' ? 'sell' : 'buy';
  return {
    ticket: position.ticket,
    intent: {
      intentId: position.openCommandId,
      terminalId: position.terminalId,
      accountNumber: 'unknown',
      symbol: position.symbol ?? 'EURUSD',
      side,
      orderKind: 'market',
      requestedVolumeLots: position.volumeLots ?? 0.01,
      entryPrice: entry,
      stopLoss: position.stopLoss ?? entry,
      takeProfit: position.takeProfit ?? entry,
      strategyId: 'trade-monitor',
      setupScore: 0,
      riskAmount: 0,
      rewardRiskRatio: 1,
      createdAt: position.openedAt,
    },
    currentPrice: position.currentPrice ?? entry,
    profitLoss: position.profitLoss,
    openedAt: position.openedAt,
    lastUpdatedAt: new Date().toISOString(),
  };
}

async function dispatchManagementCommand(input: {
  terminalId: string;
  type: string;
  ticket: string;
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

export async function runTradeMonitorTick(now = Date.now()): Promise<{
  evaluated: number;
  actions: number;
  dispatched: number;
}> {
  if (!isTradeMonitorEnabled()) {
    return { evaluated: 0, actions: 0, dispatched: 0 };
  }
  if (now - lastTickAt < 10_000) {
    return { evaluated: 0, actions: 0, dispatched: 0 };
  }
  lastTickAt = now;

  const positions = await listOpenPositions({ limit: 100 });
  let actions = 0;
  let dispatched = 0;

  for (const position of positions) {
    const snapshot = toSnapshot(position);
    const breakEven = engine.evaluateBreakEven(snapshot);
    const partial = engine.evaluatePartialClose(snapshot, 2);
    const trailing = engine.evaluateTrailingStop(snapshot);
    const timeExit = engine.evaluateTimeBasedExit(snapshot, envNumber('CACSMS_TRADE_MONITOR_MAX_MINUTES', 240));

    if (position.lastEvaluatedAt && Date.now() - new Date(position.lastEvaluatedAt).getTime() < 60_000) {
      continue;
    }

    const candidates = [breakEven, partial, trailing, timeExit].filter((item) => item.action !== 'hold');
    const chosen = candidates[0];
    if (!chosen) {
      await updatePositionEvaluation({
        id: position.id,
        currentPrice: snapshot.currentPrice,
        profitLoss: snapshot.profitLoss,
        lastAction: 'hold',
        lastActionReason: 'No management threshold reached.',
      });
      continue;
    }

    actions += 1;
    let commandType = '';
    let payload: Record<string, unknown> = { ticket: position.ticket, reason: chosen.reason };

    switch (chosen.action) {
      case 'move_to_break_even':
        commandType = 'move_to_breakeven';
        break;
      case 'partial_close':
        commandType = 'partial_close';
        payload.volumeLots = Math.max(0.01, Number(((position.volumeLots ?? 0.01) / 2).toFixed(2)));
        break;
      case 'trail_stop':
        commandType = 'set_trailing_stop';
        payload.trailingPoints = envNumber('CACSMS_TRADE_MONITOR_TRAILING_POINTS', 150);
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
      payload,
      reason: chosen.reason,
    });
    if (ok) dispatched += 1;

    await updatePositionEvaluation({
      id: position.id,
      currentPrice: snapshot.currentPrice,
      profitLoss: snapshot.profitLoss,
      lastAction: chosen.action,
      lastActionReason: chosen.reason,
    });
  }

  return { evaluated: positions.length, actions, dispatched };
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
