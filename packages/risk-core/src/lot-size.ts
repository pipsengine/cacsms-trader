import type { LotSizeInput, LotSizeResult } from "../../shared-types";

export function calculateLotSize(input: LotSizeInput): LotSizeResult {
  if (input.accountEquity <= 0) {
    throw new Error("Account equity must be greater than zero.");
  }

  if (input.riskPercent <= 0) {
    throw new Error("Risk percent must be greater than zero.");
  }

  if (input.stopLossPips <= 0 || input.pipValuePerLot <= 0) {
    throw new Error("Stop loss pips and pip value must be greater than zero.");
  }

  if (input.minLot <= 0 || input.maxLot < input.minLot || input.lotStep <= 0) {
    throw new Error("Invalid lot constraints.");
  }

  const riskAmount = input.accountEquity * (input.riskPercent / 100);
  const rawLots = riskAmount / (input.stopLossPips * input.pipValuePerLot);
  const steppedLots = Math.floor(rawLots / input.lotStep) * input.lotStep;
  const normalizedLots = clamp(roundLots(steppedLots), input.minLot, input.maxLot);

  return {
    lots: normalizedLots,
    riskAmount,
    normalizedLots,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundLots(value: number): number {
  return Number(value.toFixed(2));
}
