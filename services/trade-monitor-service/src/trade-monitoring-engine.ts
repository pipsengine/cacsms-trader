import type { TradeIntent } from '../../../packages/shared-types';
import type { PositionManagementConfig } from '../../../lib/trade-monitor-config';
import type { PositionManagementMetadata } from '../../../lib/position-management-state';
import { goldBreakEvenAllowed, resolveGoldAdaptiveManagementConfig } from '../../../lib/gold-adaptive-management';
import { isGoldSymbol } from '../../../lib/gold-trading-engine';

export interface OpenTradeSnapshot {
  ticket: string;
  intent: TradeIntent;
  currentPrice: number;
  profitLoss: number;
  openedAt: string;
  lastUpdatedAt: string;
}

export type TradeManagementActionType =
  | 'hold'
  | 'move_to_break_even'
  | 'profit_lock_stop'
  | 'profit_reversal_guard'
  | 'partial_close'
  | 'trail_stop'
  | 'time_exit'
  | 'invalid_setup_exit';

export interface TradeManagementAction {
  ticket: string;
  action: TradeManagementActionType;
  reason: string;
  priority: number;
  urgent: boolean;
  stopLoss?: number;
  bufferPoints?: number;
  trailingPoints?: number;
  partialCloseFraction?: number;
}

export interface EnrichedTradeSnapshot extends OpenTradeSnapshot {
  symbol: string;
  side: 'buy' | 'sell';
  volumeLots: number;
  point: number;
  spreadPoints: number;
  bufferPoints: number;
  currentSl: number;
  favorablePoints: number;
  riskPoints: number;
  rMultiple: number;
  management: PositionManagementMetadata;
}

export class TradeMonitoringEngine {
  constructor(private readonly config: PositionManagementConfig) {}

  trackLiveProfitLoss(trade: OpenTradeSnapshot): number {
    return trade.profitLoss;
  }

  evaluatePosition(snapshot: EnrichedTradeSnapshot, now = new Date()): TradeManagementAction {
    const candidates: TradeManagementAction[] = [
      this.evaluateProfitReversalGuard(snapshot),
      this.evaluateProfitLockStop(snapshot),
      this.evaluateBreakEven(snapshot),
      this.evaluatePartialClose(snapshot),
      this.evaluateTrailingStop(snapshot),
      this.evaluateTimeBasedExit(snapshot, now),
    ].filter((item) => item.action !== 'hold');

    if (candidates.length === 0) {
      return action(snapshot, 'hold', 'No management threshold reached.', 0, false);
    }

    return candidates.sort((a, b) => b.priority - a.priority)[0];
  }

  evaluateProfitReversalGuard(snapshot: EnrichedTradeSnapshot): TradeManagementAction {
    const peak = snapshot.management.peakProfit;
    const minPeak = this.config.minPeakProfitUsd;
    if (peak < minPeak) {
      return action(snapshot, 'hold', 'Profit reversal guard inactive — no meaningful peak profit recorded.', 0, false);
    }

    const givebackThreshold = peak * (1 - this.config.profitReversalGivebackRatio);
    const slProtecting = isStopProtectingEntry(snapshot);

    if (snapshot.profitLoss <= 0 && snapshot.management.wasEverProfitable && !slProtecting) {
      return {
        ticket: snapshot.ticket,
        action: 'profit_reversal_guard',
        reason: `Position was +$${peak.toFixed(2)} and is now $${snapshot.profitLoss.toFixed(2)} without protective stop — emergency break-even.`,
        priority: 100,
        urgent: true,
        bufferPoints: this.config.spreadBufferPoints,
      };
    }

    if (
      snapshot.profitLoss > 0
      && snapshot.profitLoss <= givebackThreshold
      && snapshot.management.peakRMultiple >= this.config.profitLockStartR
    ) {
      const lockedSl = computeLockedStopLoss(snapshot, this.config.profitLockRetainRatio * 1.1);
      if (lockedSl != null && isImprovedStop(snapshot, lockedSl)) {
        return {
          ticket: snapshot.ticket,
          action: 'profit_lock_stop',
          reason: `Profit giveback from peak $${peak.toFixed(2)} — ratcheting stop to lock gains.`,
          priority: 95,
          urgent: true,
          stopLoss: lockedSl,
        };
      }
    }

    return action(snapshot, 'hold', 'Profit reversal guard not triggered.', 0, false);
  }

  evaluateBreakEven(snapshot: EnrichedTradeSnapshot): TradeManagementAction {
    const config = isGoldSymbol(snapshot.symbol)
      ? resolveGoldAdaptiveManagementConfig(this.config, {
          symbol: snapshot.symbol,
          favorablePoints: snapshot.favorablePoints,
          riskPoints: snapshot.riskPoints,
          rMultiple: snapshot.rMultiple,
          spreadPoints: snapshot.spreadPoints,
          peakRMultiple: snapshot.management.peakRMultiple,
          breakEvenApplied: snapshot.management.breakEvenApplied,
        })
      : this.config;

    if (snapshot.management.breakEvenApplied || isStopProtectingEntry(snapshot)) {
      return action(snapshot, 'hold', 'Break-even already applied.', 0, false);
    }

    if (snapshot.rMultiple >= config.standardBreakEvenR) {
      if (
        isGoldSymbol(snapshot.symbol) &&
        !goldBreakEvenAllowed(
          {
            symbol: snapshot.symbol,
            favorablePoints: snapshot.favorablePoints,
            riskPoints: snapshot.riskPoints,
            rMultiple: snapshot.rMultiple,
            spreadPoints: snapshot.spreadPoints,
            peakRMultiple: snapshot.management.peakRMultiple,
            breakEvenApplied: snapshot.management.breakEvenApplied,
          },
          config.standardBreakEvenR,
        )
      ) {
        return action(snapshot, 'hold', 'Gold break-even waiting for structure/volatility confirmation.', 0, false);
      }
      return {
        ticket: snapshot.ticket,
        action: 'move_to_break_even',
        reason: `Trade reached ${snapshot.rMultiple.toFixed(2)}R — adaptive break-even with spread buffer.`,
        priority: 70,
        urgent: false,
        bufferPoints: config.spreadBufferPoints,
      };
    }

    if (
      !isGoldSymbol(snapshot.symbol) &&
      (snapshot.rMultiple >= config.microBreakEvenR || snapshot.profitLoss >= config.minPeakProfitUsd)
    ) {
      return {
        ticket: snapshot.ticket,
        action: 'move_to_break_even',
        reason: `Micro-profit threshold reached (${snapshot.rMultiple.toFixed(2)}R) — early break-even lock.`,
        priority: 60,
        urgent: false,
        bufferPoints: config.spreadBufferPoints,
      };
    }

    return action(snapshot, 'hold', 'Break-even threshold not reached.', 0, false);
  }

  evaluateProfitLockStop(snapshot: EnrichedTradeSnapshot): TradeManagementAction {
    if (snapshot.rMultiple < this.config.profitLockStartR) {
      return action(snapshot, 'hold', 'Profit lock threshold not reached.', 0, false);
    }

    const lockedSl = computeLockedStopLoss(snapshot, this.config.profitLockRetainRatio);
    if (lockedSl == null || !isImprovedStop(snapshot, lockedSl)) {
      return action(snapshot, 'hold', 'Profit lock stop already at optimal level.', 0, false);
    }

    return {
      ticket: snapshot.ticket,
      action: 'profit_lock_stop',
      reason: `Locking ${Math.round(this.config.profitLockRetainRatio * 100)}% of peak favorable move (${snapshot.management.peakFavorablePoints.toFixed(0)} pts).`,
      priority: 75,
      urgent: false,
      stopLoss: lockedSl,
    };
  }

  evaluatePartialClose(snapshot: EnrichedTradeSnapshot, closeAtR = this.config.partialCloseR): TradeManagementAction {
    if (snapshot.management.partialCloseApplied) {
      return action(snapshot, 'hold', 'Partial close already applied.', 0, false);
    }
    if (snapshot.rMultiple < closeAtR) {
      return action(snapshot, 'hold', 'Partial close threshold not reached.', 0, false);
    }
    return {
      ticket: snapshot.ticket,
      action: 'partial_close',
      reason: `Trade reached ${snapshot.rMultiple.toFixed(2)}R — scaling out to protect equity.`,
      priority: 50,
      urgent: false,
      partialCloseFraction: this.config.partialCloseFraction,
    };
  }

  evaluateTrailingStop(snapshot: EnrichedTradeSnapshot): TradeManagementAction {
    const config = isGoldSymbol(snapshot.symbol)
      ? resolveGoldAdaptiveManagementConfig(this.config, {
          symbol: snapshot.symbol,
          favorablePoints: snapshot.favorablePoints,
          riskPoints: snapshot.riskPoints,
          rMultiple: snapshot.rMultiple,
          spreadPoints: snapshot.spreadPoints,
          peakRMultiple: snapshot.management.peakRMultiple,
          breakEvenApplied: snapshot.management.breakEvenApplied,
        })
      : this.config;

    if (!snapshot.management.profitLockApplied && snapshot.rMultiple < config.profitLockStartR) {
      return action(snapshot, 'hold', 'Trailing stop waits for profit lock stage.', 0, false);
    }
    if (snapshot.profitLoss <= 0) {
      return action(snapshot, 'hold', 'Trailing stop waits for positive P/L.', 0, false);
    }
    return {
      ticket: snapshot.ticket,
      action: 'trail_stop',
      reason: 'Profitable trade under active profit protection — adaptive trailing stop refresh.',
      priority: 35,
      urgent: false,
      trailingPoints: config.trailingPoints,
    };
  }

  evaluateTimeBasedExit(snapshot: EnrichedTradeSnapshot, now = new Date()): TradeManagementAction {
    const minutesOpen = (now.getTime() - new Date(snapshot.openedAt).getTime()) / 60000;
    return minutesOpen >= this.config.maxMinutesOpen
      ? action(snapshot, 'time_exit', 'Maximum trade duration reached.', 20, false)
      : action(snapshot, 'hold', 'Trade duration is within limit.', 0, false);
  }

  evaluateInvalidSetupExit(trade: OpenTradeSnapshot, setupStillValid: boolean): TradeManagementAction {
    return setupStillValid
      ? action(trade, 'hold', 'Setup remains valid.', 0, false)
      : action(trade, 'invalid_setup_exit', 'Original setup has been invalidated.', 80, true);
  }
}

function action(
  trade: OpenTradeSnapshot,
  actionName: TradeManagementActionType,
  reason: string,
  priority: number,
  urgent: boolean,
): TradeManagementAction {
  return { ticket: trade.ticket, action: actionName, reason, priority, urgent };
}

function isStopProtectingEntry(snapshot: EnrichedTradeSnapshot): boolean {
  const entry = snapshot.intent.entryPrice ?? snapshot.currentPrice;
  const buffer = snapshot.point * Math.max(1, snapshot.bufferPoints);
  if (snapshot.currentSl <= 0) return false;
  if (snapshot.side === 'buy') return snapshot.currentSl >= entry + buffer;
  return snapshot.currentSl <= entry - buffer;
}

function isImprovedStop(snapshot: EnrichedTradeSnapshot, nextSl: number): boolean {
  if (!Number.isFinite(nextSl) || nextSl <= 0) return false;
  if (snapshot.currentSl <= 0) return true;
  return snapshot.side === 'buy' ? nextSl > snapshot.currentSl + snapshot.point : nextSl < snapshot.currentSl - snapshot.point;
}

function computeLockedStopLoss(snapshot: EnrichedTradeSnapshot, retainRatio: number): number | null {
  const entry = snapshot.intent.entryPrice ?? snapshot.currentPrice;
  const lockDistance = snapshot.management.peakFavorablePoints * snapshot.point * retainRatio;
  const buffer = snapshot.point * Math.max(1, snapshot.bufferPoints);
  if (lockDistance <= 0) return null;

  if (snapshot.side === 'buy') {
    return entry + lockDistance + buffer;
  }
  return entry - lockDistance - buffer;
}
