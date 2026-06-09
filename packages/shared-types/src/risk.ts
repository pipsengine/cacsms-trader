export interface PropFirmRiskRules {
  dailyDrawdownPercent: number;
  maxDrawdownPercent: number;
  riskPerTradePercent: number;
  dailyTradeLimitEnabled: boolean;
  maxTradesPerDay: number;
  maxOpenTrades: number;
  maxLotSize: number;
  maxCurrencyExposurePercent: number;
  maxCorrelatedExposurePercent: number;
  minRewardRiskRatio: number;
  stopAfterConsecutiveLosses: number;
  stopTradingAfterDailyTargetHit: boolean;
  monthlyProfitTargetPercent: number;
  newsBlackoutMinutesBefore: number;
  newsBlackoutMinutesAfter: number;
}

export interface RiskState {
  startingEquityToday: number;
  currentEquity: number;
  peakEquityAllTime: number;
  currentBalance: number;
  tradesOpenedToday: number;
  openTrades: number;
  consecutiveLosses: number;
  monthlyProfitPercent: number;
  killSwitchActive: boolean;
  highImpactNewsBlocked: boolean;
}

export type RiskDecisionCode =
  | "kill_switch_active"
  | "daily_drawdown_exceeded"
  | "max_drawdown_exceeded"
  | "monthly_target_reached"
  | "max_trades_per_day"
  | "max_open_trades"
  | "consecutive_loss_limit"
  | "news_blackout"
  | "reward_risk_too_low"
  | "lot_size_too_high"
  | "max_open_exposure"
  | "correlation_protection"
  | "allowed";

export interface RiskDecision {
  allowed: boolean;
  code: RiskDecisionCode;
  message: string;
  remainingDailyLossAmount: number;
}

export interface LotSizeInput {
  accountEquity: number;
  riskPercent: number;
  stopLossPips: number;
  pipValuePerLot: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
}

export interface LotSizeResult {
  lots: number;
  riskAmount: number;
  normalizedLots: number;
}
