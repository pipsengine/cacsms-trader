import type { PropFirmRiskRules, RiskDecision, RiskState } from "../../shared-types";

interface EvaluateRiskInput {
  rules: PropFirmRiskRules;
  state: RiskState;
  requestedLots: number;
  rewardRiskRatio: number;
}

export function evaluatePropFirmRisk(input: EvaluateRiskInput): RiskDecision {
  const { rules, state } = input;
  const remainingDailyLossAmount = getRemainingDailyLossAmount(rules, state);

  if (state.killSwitchActive) {
    return block("kill_switch_active", "Emergency kill switch is active.", remainingDailyLossAmount);
  }

  if (remainingDailyLossAmount <= 0) {
    return block("daily_drawdown_exceeded", "Daily drawdown limit has been reached.", remainingDailyLossAmount);
  }

  if (getTotalDrawdownPercent(state) >= rules.maxDrawdownPercent) {
    return block("max_drawdown_exceeded", "Maximum drawdown limit has been reached.", remainingDailyLossAmount);
  }

  if (rules.stopTradingAfterDailyTargetHit && state.monthlyProfitPercent >= rules.monthlyProfitTargetPercent) {
    return block("monthly_target_reached", "Monthly profit target reached. Trading is locked.", remainingDailyLossAmount);
  }

  if (state.tradesOpenedToday >= rules.maxTradesPerDay) {
    return block("max_trades_per_day", "Maximum trades per day reached.", remainingDailyLossAmount);
  }

  if (state.openTrades >= rules.maxOpenTrades) {
    return block("max_open_trades", "Maximum open trades reached.", remainingDailyLossAmount);
  }

  if (state.consecutiveLosses >= rules.stopAfterConsecutiveLosses) {
    return block("consecutive_loss_limit", "Consecutive loss limit reached.", remainingDailyLossAmount);
  }

  if (state.highImpactNewsBlocked) {
    return block("news_blackout", "High-impact news blackout is active.", remainingDailyLossAmount);
  }

  if (input.rewardRiskRatio < rules.minRewardRiskRatio) {
    return block("reward_risk_too_low", "Reward/risk ratio is below the configured minimum.", remainingDailyLossAmount);
  }

  if (input.requestedLots > rules.maxLotSize) {
    return block("lot_size_too_high", "Requested lot size exceeds the configured maximum.", remainingDailyLossAmount);
  }

  return {
    allowed: true,
    code: "allowed",
    message: "Risk checks passed.",
    remainingDailyLossAmount,
  };
}

export function getRemainingDailyLossAmount(rules: PropFirmRiskRules, state: RiskState): number {
  const dailyLossLimit = state.startingEquityToday * (rules.dailyDrawdownPercent / 100);
  const currentLoss = Math.max(0, state.startingEquityToday - state.currentEquity);
  return Number(Math.max(0, dailyLossLimit - currentLoss).toFixed(2));
}

export function getTotalDrawdownPercent(state: RiskState): number {
  if (state.peakEquityAllTime <= 0) {
    return 0;
  }

  return Number((((state.peakEquityAllTime - state.currentEquity) / state.peakEquityAllTime) * 100).toFixed(2));
}

function block(code: RiskDecision["code"], message: string, remainingDailyLossAmount: number): RiskDecision {
  return {
    allowed: false,
    code,
    message,
    remainingDailyLossAmount,
  };
}
