/** Client-safe prop firm types and constants (no Node/Postgres imports). */

export type PropFirmRuleStatus = 'ok' | 'warn' | 'error';

export type PropFirmRuleCategory =
  | 'profit_phase_1'
  | 'profit_phase_2'
  | 'max_loss'
  | 'daily_loss'
  | 'trading_days'
  | 'reduced_days'
  | 'news_trading'
  | 'withdrawal'
  | 'daily_buffer';

/** Distinct moderate tint per rule type — matched in the command center dashboard. */
export const PROP_FIRM_RULE_CATEGORY_TONE: Record<PropFirmRuleCategory, string> = {
  profit_phase_1: 'emerald',
  profit_phase_2: 'blue',
  max_loss: 'rose',
  daily_loss: 'orange',
  trading_days: 'cyan',
  reduced_days: 'amber',
  news_trading: 'violet',
  withdrawal: 'purple',
  daily_buffer: 'slate',
};

export interface PropFirmRuleRow {
  category: PropFirmRuleCategory;
  label: string;
  limit: string;
  current: string;
  status: PropFirmRuleStatus;
  progressPercent?: number;
}

export interface PropFirmComplianceView {
  firmName: string;
  rewardNote: string;
  phaseLabel: string;
  profitTargetPercent: number;
  profitProgressPercent: number;
  dailyDrawdownPercent: number;
  dailyDrawdownLimitPercent: number;
  maxDrawdownPercent: number;
  maxDrawdownLimitPercent: number;
  tradingDaysCompleted: number;
  minimumTradingDays: number;
  reducedTradingDays: number;
  newsTradingAllowed: boolean;
  firstWithdrawalDays: number;
  remainingDailyLossAmount: number;
  riskAllowed: boolean;
  riskMessage: string;
  rules: PropFirmRuleRow[];
}

export const FUNDEDNEXT_CHALLENGE_PROFILE = {
  firmName: 'FundedNext',
  rewardNote: '15% Performance Reward (From Challenge Phase)',
  phase1ProfitTargetPercent: 8,
  phase2ProfitTargetPercent: 5,
  maxLossLimitPercent: 10,
  dailyLossLimitPercent: 5,
  minimumTradingDays: 2,
  reducedTradingDays: 5,
  newsTradingAllowed: true,
  firstWithdrawalDays: 21,
} as const;
