import { calculateLotSize } from '@/packages/risk-core';
import type { ExecutionAccountContext } from '@/lib/execution-account-context';
import { getAutonomyThresholdProfile } from '@/lib/autonomy-account-profiles';
import type { AutonomousDecisionOutput } from '@/lib/autonomy-types';
import { loadPropFirmRiskRulesFromEnv } from '@/lib/execution-risk-gate';
import { resolvePropFirmSizingEquity } from '@/lib/execution-risk-limits';
import type { RiskState } from '@/packages/shared-types';
import { getTradingStyleProfile } from '@/lib/trading-styles/registry';
import type { TradingStyleId } from '@/lib/trading-styles/types';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function defaultPipValue(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized.includes('XAU') || normalized.includes('GOLD')) {
    return envNumber('CACSMS_PIP_VALUE_XAUUSD', 1);
  }
  if (normalized.includes('JPY')) {
    return envNumber('CACSMS_PIP_VALUE_JPY', 0.67);
  }
  return envNumber('CACSMS_PIP_VALUE_FX', 10);
}

function defaultStopPips(symbol: string, timeframe: string): number {
  const normalized = symbol.toUpperCase();
  const tf = timeframe.toUpperCase();
  if (normalized.includes('XAU')) {
    if (tf === 'M15') return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU_M15', 120);
    if (tf === 'H1') return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU_H1', 220);
    return envNumber('CACSMS_DEFAULT_STOP_PIPS_XAU', 180);
  }
  return envNumber('CACSMS_DEFAULT_STOP_PIPS_FX', 25);
}

function estimateStopPips(
  symbol: string,
  timeframe: string,
  stopLoss: number | null,
  side: 'BUY' | 'SELL',
  entryPrice?: number | null,
): number {
  if (!stopLoss || stopLoss <= 0) {
    return defaultStopPips(symbol, timeframe);
  }
  const referencePrice = entryPrice && entryPrice > 0
    ? entryPrice
    : envNumber('CACSMS_AUTONOMY_REFERENCE_PRICE', 0);
  if (referencePrice <= 0) {
    return defaultStopPips(symbol, timeframe);
  }
  const distance = Math.abs(referencePrice - stopLoss);
  const normalized = symbol.toUpperCase();
  if (normalized.includes('XAU')) {
    return Math.max(20, Math.round(distance * 10));
  }
  const pipSize = normalized.includes('JPY') ? 0.01 : 0.0001;
  return Math.max(8, Math.round(distance / pipSize));
}

export function resolveAutonomousVolumeLots(input: {
  decision: Pick<AutonomousDecisionOutput, 'symbol' | 'timeframe' | 'decision' | 'stopLoss' | 'tradingStyle' | 'capitalAllocation'>;
  account: ExecutionAccountContext;
  entryPrice?: number | null;
  tradingStyle?: TradingStyleId;
}): { lots: number; riskAmount: number; stopPips: number; method: 'fixed' | 'equity_risk' } {
  const fallbackLots = envNumber('CACSMS_AUTONOMY_DEFAULT_LOTS', 0.01);
  const rules = loadPropFirmRiskRulesFromEnv();
  const profile = getAutonomyThresholdProfile(input.account.accountClass);
  const styleId = input.tradingStyle ?? input.decision.tradingStyle;
  const styleRiskPercent = styleId ? getTradingStyleProfile(styleId).riskPerTradePercent : null;
  const allocationMultiplier = Math.max(0, Math.min(1, Number(input.decision.capitalAllocation?.riskMultiplier ?? 1)));
  const liveEquity = Math.max(input.account.equity, input.account.balance, 0);

  if (allocationMultiplier <= 0) {
    return { lots: 0, riskAmount: 0, stopPips: 0, method: 'fixed' };
  }

  if (liveEquity <= 0) {
    return { lots: fallbackLots, riskAmount: 0, stopPips: 0, method: 'fixed' };
  }

  const riskState: RiskState = {
    startingEquityToday: liveEquity,
    currentEquity: liveEquity,
    peakEquityAllTime: liveEquity,
    currentBalance: input.account.balance,
    tradesOpenedToday: 0,
    openTrades: 0,
    consecutiveLosses: 0,
    monthlyProfitPercent: 0,
    killSwitchActive: false,
    highImpactNewsBlocked: false,
  };
  const sizingEquity = resolvePropFirmSizingEquity(riskState, rules);

  const side = input.decision.decision === 'SELL' ? 'SELL' : 'BUY';
  const stopPips = estimateStopPips(
    input.decision.symbol,
    input.decision.timeframe,
    input.decision.stopLoss,
    side,
    input.entryPrice,
  );
  const pipValue = defaultPipValue(input.decision.symbol);

  try {
    const sized = calculateLotSize({
      accountEquity: sizingEquity,
      riskPercent: (styleRiskPercent ?? profile.riskPerTradePercent) * allocationMultiplier,
      stopLossPips: stopPips,
      pipValuePerLot: pipValue,
      minLot: envNumber('CACSMS_MIN_LOT_SIZE', 0.01),
      maxLot: Math.min(rules.maxLotSize, envNumber('CACSMS_MAX_AUTONOMY_LOT_SIZE', rules.maxLotSize)),
      lotStep: envNumber('CACSMS_LOT_STEP', 0.01),
    });
    return {
      lots: sized.normalizedLots,
      riskAmount: sized.riskAmount,
      stopPips,
      method: 'equity_risk',
    };
  } catch {
    return { lots: fallbackLots, riskAmount: 0, stopPips, method: 'fixed' };
  }
}
