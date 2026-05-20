import type { TradeIntent } from "../../../packages/shared-types";

export interface OpenTradeSnapshot {
  ticket: string;
  intent: TradeIntent;
  currentPrice: number;
  profitLoss: number;
  openedAt: string;
  lastUpdatedAt: string;
}

export interface TradeManagementAction {
  ticket: string;
  action: "hold" | "move_to_break_even" | "partial_close" | "trail_stop" | "time_exit" | "invalid_setup_exit";
  reason: string;
}

export class TradeMonitoringEngine {
  trackLiveProfitLoss(trade: OpenTradeSnapshot): number {
    return trade.profitLoss;
  }

  evaluateBreakEven(trade: OpenTradeSnapshot): TradeManagementAction {
    const risk = Math.abs((trade.intent.entryPrice ?? trade.currentPrice) - trade.intent.stopLoss);
    const reward = Math.abs(trade.currentPrice - (trade.intent.entryPrice ?? trade.currentPrice));
    if (risk > 0 && reward >= risk) {
      return action(trade, "move_to_break_even", "Trade reached 1R.");
    }
    return action(trade, "hold", "Break-even threshold not reached.");
  }

  evaluatePartialClose(trade: OpenTradeSnapshot, closeAtR = 2): TradeManagementAction {
    const entry = trade.intent.entryPrice ?? trade.currentPrice;
    const risk = Math.abs(entry - trade.intent.stopLoss);
    const reward = Math.abs(trade.currentPrice - entry);
    return risk > 0 && reward >= risk * closeAtR
      ? action(trade, "partial_close", `Trade reached ${closeAtR}R.`)
      : action(trade, "hold", "Partial close threshold not reached.");
  }

  evaluateTrailingStop(trade: OpenTradeSnapshot): TradeManagementAction {
    return trade.profitLoss > 0
      ? action(trade, "trail_stop", "Profitable trade qualifies for trailing stop review.")
      : action(trade, "hold", "Trailing stop waits for positive P/L.");
  }

  evaluateTimeBasedExit(trade: OpenTradeSnapshot, maxMinutesOpen: number, now = new Date()): TradeManagementAction {
    const minutesOpen = (now.getTime() - new Date(trade.openedAt).getTime()) / 60000;
    return minutesOpen >= maxMinutesOpen
      ? action(trade, "time_exit", "Maximum trade duration reached.")
      : action(trade, "hold", "Trade duration is within limit.");
  }

  evaluateInvalidSetupExit(trade: OpenTradeSnapshot, setupStillValid: boolean): TradeManagementAction {
    return setupStillValid
      ? action(trade, "hold", "Setup remains valid.")
      : action(trade, "invalid_setup_exit", "Original setup has been invalidated.");
  }
}

function action(trade: OpenTradeSnapshot, actionName: TradeManagementAction["action"], reason: string): TradeManagementAction {
  return {
    ticket: trade.ticket,
    action: actionName,
    reason,
  };
}
