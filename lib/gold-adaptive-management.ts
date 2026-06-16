import type { PositionManagementConfig } from '@/lib/trade-monitor-config';
import { isGoldSymbol } from '@/lib/gold-trading-engine';

function envNumber(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type GoldAdaptiveManagementInput = {
  symbol: string;
  favorablePoints: number;
  riskPoints: number;
  rMultiple: number;
  spreadPoints: number;
  peakRMultiple: number;
  breakEvenApplied: boolean;
};

/** Gold adaptive trade management — disables fixed-pip micro BE; uses R + spread/slippage buffers. */
export function resolveGoldAdaptiveManagementConfig(
  base: PositionManagementConfig,
  input: GoldAdaptiveManagementInput,
): PositionManagementConfig {
  if (!isGoldSymbol(input.symbol)) return base;

  const spreadBuffer = Math.max(base.spreadBufferPoints, input.spreadPoints, envNumber('CACSMS_GOLD_BE_SPREAD_BUFFER', 3));
  const slippageBuffer = envNumber('CACSMS_GOLD_BE_SLIPPAGE_BUFFER', 2);
  const volatilityFactor = input.riskPoints > 0 ? Math.min(1.4, Math.max(0.85, input.riskPoints / 500)) : 1;
  const standardBeR = Math.max(
    envNumber('CACSMS_GOLD_STANDARD_BE_R', 0.85),
    Math.min(1.35, 0.75 * volatilityFactor + spreadBuffer / Math.max(input.riskPoints, 50)),
  );
  const profitLockR = Math.max(base.profitLockStartR, standardBeR + 0.25);
  const trailingPoints = Math.max(
    spreadBuffer * 4,
    Math.round(input.riskPoints * envNumber('CACSMS_GOLD_TRAIL_RISK_FRACTION', 0.32)),
    envNumber('CACSMS_GOLD_MIN_TRAIL_POINTS', 80),
  );

  return {
    ...base,
    microBreakEvenR: 999,
    standardBreakEvenR: standardBeR,
    profitLockStartR: profitLockR,
    spreadBufferPoints: spreadBuffer,
    trailingPoints,
    minPeakProfitUsd: Math.max(base.minPeakProfitUsd, spreadBuffer * 0.05),
  };
}

export function goldBreakEvenAllowed(input: GoldAdaptiveManagementInput, standardBeR: number): boolean {
  if (!isGoldSymbol(input.symbol)) return true;
  const spreadBuffer = Math.max(input.spreadPoints, envNumber('CACSMS_GOLD_BE_SPREAD_BUFFER', 3));
  const slippageBuffer = envNumber('CACSMS_GOLD_BE_SLIPPAGE_BUFFER', 2);
  const minFavorable = spreadBuffer + slippageBuffer + input.riskPoints * 0.08;
  return (
    input.rMultiple >= standardBeR &&
    input.favorablePoints >= minFavorable &&
    input.peakRMultiple >= standardBeR * 0.95
  );
}
