export interface PositionManagementConfig {
  microBreakEvenR: number;
  standardBreakEvenR: number;
  profitLockStartR: number;
  profitLockRetainRatio: number;
  partialCloseR: number;
  partialCloseFraction: number;
  profitReversalGivebackRatio: number;
  minPeakProfitUsd: number;
  spreadBufferPoints: number;
  trailingPoints: number;
  urgentCooldownSec: number;
  normalCooldownSec: number;
  maxMinutesOpen: number;
  defaultRiskPointsForex: number;
  defaultRiskPointsGold: number;
  defaultRiskPointsIndex: number;
}

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getPositionManagementConfig(): PositionManagementConfig {
  return {
    microBreakEvenR: envNumber('CACSMS_TRADE_MONITOR_MICRO_BE_R', 0.25),
    standardBreakEvenR: envNumber('CACSMS_TRADE_MONITOR_STANDARD_BE_R', 0.75),
    profitLockStartR: envNumber('CACSMS_TRADE_MONITOR_PROFIT_LOCK_R', 1),
    profitLockRetainRatio: envNumber('CACSMS_TRADE_MONITOR_PROFIT_LOCK_RETAIN', 0.65),
    partialCloseR: envNumber('CACSMS_TRADE_MONITOR_PARTIAL_CLOSE_R', 2),
    partialCloseFraction: envNumber('CACSMS_TRADE_MONITOR_PARTIAL_CLOSE_FRACTION', 0.5),
    profitReversalGivebackRatio: envNumber('CACSMS_TRADE_MONITOR_REVERSAL_GIVEBACK', 0.8),
    minPeakProfitUsd: envNumber('CACSMS_TRADE_MONITOR_MIN_PEAK_PROFIT_USD', 0.5),
    spreadBufferPoints: envNumber('CACSMS_TRADE_MONITOR_SPREAD_BUFFER_POINTS', 2),
    trailingPoints: envNumber('CACSMS_TRADE_MONITOR_TRAILING_POINTS', 150),
    urgentCooldownSec: envNumber('CACSMS_TRADE_MONITOR_URGENT_COOLDOWN_SEC', 12),
    normalCooldownSec: envNumber('CACSMS_TRADE_MONITOR_NORMAL_COOLDOWN_SEC', 45),
    maxMinutesOpen: envNumber('CACSMS_TRADE_MONITOR_MAX_MINUTES', 480),
    defaultRiskPointsForex: envNumber('CACSMS_TRADE_MONITOR_DEFAULT_RISK_FOREX_POINTS', 100),
    defaultRiskPointsGold: envNumber('CACSMS_TRADE_MONITOR_DEFAULT_RISK_GOLD_POINTS', 500),
    defaultRiskPointsIndex: envNumber('CACSMS_TRADE_MONITOR_DEFAULT_RISK_INDEX_POINTS', 300),
  };
}
