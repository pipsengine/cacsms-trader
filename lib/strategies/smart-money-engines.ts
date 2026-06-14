import { analyzeLiquidityZones } from '@/lib/liquidity-zone-engine';
import { analyzeOrderBlocks } from '@/lib/order-block-detection-engine';
import { analyzeMarketStructure } from '@/lib/structure-analysis-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function institutionalTextBias(text: string): StrategyBias {
  const lower = text.toLowerCase();
  if (lower.includes('bullish') || lower.includes('buy')) return 'bullish';
  if (lower.includes('bearish') || lower.includes('sell')) return 'bearish';
  return 'neutral';
}

function candleVolumeProxy(candle: StrategyPriceCandle): number {
  return Math.max(candle.high - candle.low, 0.00001);
}

function premiumDiscountMetrics(candles: StrategyPriceCandle[], lookback: number) {
  const window = candles.slice(-lookback, -1);
  const swingHigh = Math.max(...window.map((item) => item.high));
  const swingLow = Math.min(...window.map((item) => item.low));
  const range = Math.max(swingHigh - swingLow, 0.00001);
  const equilibrium = swingLow + range * 0.5;
  const premiumStart = swingLow + range * 0.5;
  const discountEnd = swingLow + range * 0.5;
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - swingLow) / range) * 100;
  return { swingHigh, swingLow, equilibrium, premiumStart, discountEnd, positionPct, last, range };
}

function detectLiquidityGrab(
  candles: StrategyPriceCandle[],
  lookback: number,
  sweepBufferPct: number,
): { bias: StrategyBias; decision: StrategySignalSide; recentHigh: number; recentLow: number } {
  const window = candles.slice(-lookback - 1, -1);
  const last = candles[candles.length - 1]!;
  const recentHigh = Math.max(...window.map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const sweepBuffer = last.close * (sweepBufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  const bearishGrab = last.high > recentHigh + sweepBuffer && last.close < recentHigh;
  const bullishGrab = last.low < recentLow - sweepBuffer && last.close > recentLow;
  if (bullishGrab) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishGrab) {
    bias = 'bearish';
    decision = 'sell';
  }

  return { bias, decision, recentHigh, recentLow };
}

export const evaluateSmartMoneyConceptsSmcEngine: StrategyEngine = (candles, config, context) => {
  const maxTrapRisk = parseNumber(config.maxTrapRisk, 0.7);
  const minBlockQuality = parseNumber(config.minBlockQuality, 0.42);
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const blocks = analyzeOrderBlocks(reconstructed);
  const liquidity = analyzeLiquidityZones(reconstructed);
  const bias = institutionalTextBias(structure.finalBias.institutionalBias);
  const trapRisk = structure.finalBias.retailTrapRisk;
  const block = blocks.orderBlocks
    .filter((item) => item.qualityScore >= minBlockQuality && item.mitigationStatus !== 'invalidated')
    .sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;
  let decision: StrategySignalSide = 'wait';

  if (trapRisk <= maxTrapRisk) {
    if (structure.finalBias.tradeDecision === 'BUY' || bias === 'bullish') decision = 'buy';
    if (structure.finalBias.tradeDecision === 'SELL' || bias === 'bearish') decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'smart-money-concepts-smc',
    context,
    config: { ...config, maxTrapRisk, minBlockQuality, lookback },
    candles,
    decision,
    bias,
    confidence: 38
      + (decision !== 'wait' ? 28 : 6)
      + Math.round((structure.finalBias.confidenceScore ?? 0) * 20)
      + (block ? 8 : 0),
    reasons: [
      'SMC composite — market structure + order blocks + liquidity narrative',
      structure.finalBias.reasoningText,
      block
        ? `${block.blockType} block ${block.zoneLow.toFixed(5)} – ${block.zoneHigh.toFixed(5)} (${block.mitigationStatus.replace(/_/g, ' ')})`
        : 'No qualifying order block in lookback',
      liquidity.summary.explanation,
      trapRisk > maxTrapRisk ? `Retail trap risk ${(trapRisk * 100).toFixed(0)}% — standing aside` : 'Trap risk within SMC threshold',
    ],
    metrics: {
      phase: structure.phase.phaseState,
      trapRiskPct: Number((trapRisk * 100).toFixed(1)),
      blockQuality: block ? Number((block.qualityScore * 100).toFixed(1)) : null,
      liquidityBias: liquidity.summary.institutionalBias,
    },
  });
};

export const evaluateIctMethodologyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const minGapPct = parseNumber(config.minGapPct, 0.02);
  const minSweepQuality = parseNumber(config.minSweepQuality, 0.4);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const liquidity = analyzeLiquidityZones(reconstructed);
  const last = candles[candles.length - 1]!;
  const lastIndex = candles.length - 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let gapHigh: number | null = null;
  let gapLow: number | null = null;

  for (let index = lastIndex - 2; index >= Math.max(2, lastIndex - lookback); index -= 1) {
    const left = candles[index - 1]!;
    const middle = candles[index]!;
    const right = candles[index + 1]!;
    const bullishGap = right.low > left.high;
    const bearishGap = right.high < left.low;
    const gapSize = bullishGap
      ? ((right.low - left.high) / middle.close) * 100
      : bearishGap
        ? ((left.low - right.high) / middle.close) * 100
        : 0;
    if (gapSize < minGapPct) continue;
    if (bullishGap) {
      gapLow = left.high;
      gapHigh = right.low;
      bias = 'bullish';
      if (last.low <= gapHigh && last.close > gapLow) decision = 'buy';
      break;
    }
    if (bearishGap) {
      gapHigh = left.low;
      gapLow = right.high;
      bias = 'bearish';
      if (last.high >= gapLow && last.close < gapHigh) decision = 'sell';
      break;
    }
  }

  const recentSweep = liquidity.sweeps
    .filter((sweep) => sweep.sweepQualityScore >= minSweepQuality)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0] ?? null;
  if (decision === 'wait' && recentSweep && recentSweep.candleIndex >= candles.length - 3) {
    if (recentSweep.sweepDirection === 'sell_side_sweep' && last.close > last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (recentSweep.sweepDirection === 'buy_side_sweep' && last.close < last.open) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'ict-methodology',
    context,
    config: { ...config, lookback, minGapPct, minSweepQuality },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 6) + (gapHigh != null ? 10 : 0) + (recentSweep ? 8 : 0),
    reasons: [
      'ICT methodology — FVG imbalance + liquidity sweep institutional model',
      gapHigh != null && gapLow != null ? `Active FVG ${gapLow.toFixed(5)} – ${gapHigh.toFixed(5)}` : 'No qualifying FVG in lookback',
      recentSweep
        ? `Liquidity sweep quality ${(recentSweep.sweepQualityScore * 100).toFixed(0)}% (${recentSweep.sweepDirection})`
        : 'No recent institutional sweep',
      decision === 'buy' ? 'ICT long — gap mitigation or sell-side sweep reversal' : decision === 'sell' ? 'ICT short — gap mitigation or buy-side sweep reversal' : 'Awaiting ICT setup',
    ],
    metrics: {
      gapHigh: gapHigh != null ? Number(gapHigh.toFixed(5)) : null,
      gapLow: gapLow != null ? Number(gapLow.toFixed(5)) : null,
      sweepCount: liquidity.sweeps.length,
    },
  });
};

export const evaluateOrderFlowTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 24));
  const imbalanceThreshold = parseNumber(config.imbalanceThreshold, 1.35);
  const window = candles.slice(-lookback);
  const last = candles[candles.length - 1]!;
  let buyPressure = 0;
  let sellPressure = 0;

  for (const candle of window) {
    const volume = candleVolumeProxy(candle);
    const body = candle.close - candle.open;
    if (body >= 0) buyPressure += volume * (1 + Math.abs(body) / volume);
    else sellPressure += volume * (1 + Math.abs(body) / volume);
  }

  const ratio = sellPressure > 0 ? buyPressure / sellPressure : buyPressure;
  const inverseRatio = buyPressure > 0 ? sellPressure / buyPressure : sellPressure;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (ratio >= imbalanceThreshold && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (inverseRatio >= imbalanceThreshold && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (buyPressure > sellPressure) {
    bias = 'bullish';
  } else if (sellPressure > buyPressure) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'order-flow-trading',
    context,
    config: { ...config, lookback, imbalanceThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 6) + Math.min(18, Math.abs(ratio - 1) * 12),
    reasons: [
      `Order flow — ${lookback}-bar buy/sell pressure imbalance (range-volume proxy)`,
      `Buy pressure ${buyPressure.toFixed(2)} / sell pressure ${sellPressure.toFixed(2)}`,
      decision === 'buy' ? 'Aggressive buy-side dominance with bullish close' : decision === 'sell' ? 'Aggressive sell-side dominance with bearish close' : 'Flow balanced — no institutional imbalance entry',
    ],
    metrics: {
      buyPressure: Number(buyPressure.toFixed(2)),
      sellPressure: Number(sellPressure.toFixed(2)),
      imbalanceRatio: Number(ratio.toFixed(2)),
    },
  });
};

export const evaluateFootprintTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(8, parseNumber(config.lookback, 16));
  const deltaThreshold = parseNumber(config.deltaThreshold, 0.55);
  const window = candles.slice(-lookback);
  const last = candles[candles.length - 1]!;
  let cumulativeDelta = 0;
  let maxDelta = 0.00001;

  for (const candle of window) {
    const range = Math.max(candle.high - candle.low, 0.00001);
    const body = candle.close - candle.open;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const delta = (body + lowerWick * 0.5 - upperWick * 0.5) / range;
    cumulativeDelta += delta;
    maxDelta = Math.max(maxDelta, Math.abs(cumulativeDelta));
  }

  const normalizedDelta = cumulativeDelta / lookback;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (normalizedDelta >= deltaThreshold && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (normalizedDelta <= -deltaThreshold && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (normalizedDelta > 0) {
    bias = 'bullish';
  } else if (normalizedDelta < 0) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'footprint-trading',
    context,
    config: { ...config, lookback, deltaThreshold },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 6) + Math.min(20, Math.abs(normalizedDelta) * 30),
    reasons: [
      `Footprint — ${lookback}-bar cumulative delta from wick/body imbalance`,
      `Normalized delta ${normalizedDelta.toFixed(2)} (threshold ±${deltaThreshold})`,
      decision === 'buy' ? 'Positive delta footprint with bullish close' : decision === 'sell' ? 'Negative delta footprint with bearish close' : 'Footprint delta neutral',
    ],
    metrics: {
      cumulativeDelta: Number(cumulativeDelta.toFixed(3)),
      normalizedDelta: Number(normalizedDelta.toFixed(3)),
    },
  });
};

export const evaluateLiquidityTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const minZoneScore = parseNumber(config.minZoneScore, 0.42);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const liquidity = analyzeLiquidityZones(reconstructed);
  const last = candles[candles.length - 1]!;
  const zones = liquidity.liquidityZones.filter((zone) => zone.confidenceScore >= minZoneScore);
  const nearestBuySide = zones
    .filter((zone) => zone.liquiditySide === 'buy_side')
    .sort((a, b) => Math.abs(last.close - a.priceLevel) - Math.abs(last.close - b.priceLevel))[0] ?? null;
  const nearestSellSide = zones
    .filter((zone) => zone.liquiditySide === 'sell_side')
    .sort((a, b) => Math.abs(last.close - a.priceLevel) - Math.abs(last.close - b.priceLevel))[0] ?? null;
  const bias = institutionalTextBias(liquidity.summary.institutionalBias);
  let decision: StrategySignalSide = 'wait';

  if (liquidity.summary.recommendedAction === 'BUY') decision = 'buy';
  if (liquidity.summary.recommendedAction === 'SELL') decision = 'sell';

  if (decision === 'wait' && nearestBuySide && last.low <= nearestBuySide.zoneHigh && last.close > nearestBuySide.zoneLow) {
    decision = 'buy';
  } else if (decision === 'wait' && nearestSellSide && last.high >= nearestSellSide.zoneLow && last.close < nearestSellSide.zoneHigh) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-trading',
    context,
    config: { ...config, lookback, minZoneScore },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 6) + Math.round(liquidity.summary.confidence * 18),
    reasons: [
      'Liquidity trading — institutional pool targeting with sweep/reversal context',
      liquidity.summary.explanation,
      nearestBuySide ? `Nearest buy-side pool ${nearestBuySide.priceLevel.toFixed(5)}` : 'No active buy-side pool',
      nearestSellSide ? `Nearest sell-side pool ${nearestSellSide.priceLevel.toFixed(5)}` : 'No active sell-side pool',
      decision === 'wait' ? 'Awaiting liquidity raid or pool reaction' : `${decision.toUpperCase()} from liquidity model`,
    ],
    metrics: {
      zoneCount: zones.length,
      sweepCount: liquidity.sweeps.length,
      dominantLiquidity: liquidity.summary.dominantLiquidity,
    },
  });
};

export const evaluateMarketMakerModelEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const equalTolerancePct = parseNumber(config.equalTolerancePct, 0.06);
  const window = candles.slice(-lookback, -1);
  const last = candles[candles.length - 1]!;
  const highs = window.map((item) => item.high).sort((a, b) => b - a);
  const lows = window.map((item) => item.low).sort((a, b) => a - b);
  const equalHighs = highs.length >= 2 && Math.abs(highs[0]! - highs[1]!) / last.close <= equalTolerancePct / 100;
  const equalLows = lows.length >= 2 && Math.abs(lows[0]! - lows[1]!) / last.close <= equalTolerancePct / 100;
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const mid = rangeLow + (rangeHigh - rangeLow) * 0.5;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (equalHighs && last.close < rangeHigh && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (equalLows && last.close > rangeLow && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close > mid) {
    bias = 'bearish';
  } else {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'market-maker-model',
    context,
    config: { ...config, lookback, equalTolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 6) + (equalHighs || equalLows ? 10 : 0),
    reasons: [
      'Market maker model — equal highs/lows liquidity engineering + midline distribution',
      equalHighs ? 'Equal highs detected — sell-side liquidity engineered above range' : 'No equal highs cluster',
      equalLows ? 'Equal lows detected — buy-side liquidity engineered below range' : 'No equal lows cluster',
      decision === 'sell' ? 'Rejection from engineered highs — MM distribution short' : decision === 'buy' ? 'Rejection from engineered lows — MM accumulation long' : 'Awaiting liquidity engineering resolution',
    ],
    metrics: {
      equalHighs: equalHighs ? 1 : 0,
      equalLows: equalLows ? 1 : 0,
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};

export const evaluateWyckoffMethodEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(40, parseNumber(config.lookback, 70));
  const maxAdx = parseNumber(config.maxAdx, 24);
  const window = candles.slice(-lookback);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const last = candles[candles.length - 1]!;
  const { adx: adxSeries } = adx(candles, 14);
  const adxValue = adxSeries[candles.length - 1];
  const ranging = adxValue != null && adxValue <= maxAdx;
  const positionPct = ((last.close - rangeLow) / rangeSize) * 100;
  const recentVolume = window.slice(-8).reduce((sum, item) => sum + candleVolumeProxy(item), 0);
  const priorVolume = window.slice(-16, -8).reduce((sum, item) => sum + candleVolumeProxy(item), 0);
  const volumeRising = recentVolume > priorVolume * 1.05;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let phase = 'unknown';

  if (ranging && positionPct <= 35 && volumeRising && last.close > last.open) {
    phase = 'accumulation';
    bias = 'bullish';
    decision = 'buy';
  } else if (ranging && positionPct >= 65 && volumeRising && last.close < last.open) {
    phase = 'distribution';
    bias = 'bearish';
    decision = 'sell';
  } else if (ranging && positionPct < 50) {
    phase = 'accumulation-candidate';
    bias = 'bullish';
  } else if (ranging && positionPct > 50) {
    phase = 'distribution-candidate';
    bias = 'bearish';
  } else {
    phase = 'markup-markdown';
  }

  return buildEvaluationResult({
    strategyId: 'wyckoff-method',
    context,
    config: { ...config, lookback, maxAdx },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6) + (ranging ? 10 : 0),
    reasons: [
      'Wyckoff method — range phase + volume participation scoring',
      `Phase estimate: ${phase.replace(/-/g, ' ')} · price at ${positionPct.toFixed(0)}% of range`,
      adxValue != null ? `ADX ${adxValue.toFixed(1)} — ${ranging ? 'ranging/composite' : 'trending/markup-markdown'}` : 'ADX unavailable',
      decision === 'buy' ? 'Accumulation spring with rising participation — long' : decision === 'sell' ? 'Distribution upthrust with rising participation — short' : 'No Wyckoff phase entry on latest bar',
    ],
    metrics: {
      phase,
      positionPct: Number(positionPct.toFixed(1)),
      adx: adxValue != null ? Number(adxValue.toFixed(1)) : null,
      volumeRising: volumeRising ? 1 : 0,
    },
  });
};

export const evaluateAccumulationDistributionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const compressionPct = parseNumber(config.compressionPct, 1.8);
  const window = candles.slice(-lookback);
  const firstHalf = window.slice(0, Math.floor(window.length / 2));
  const secondHalf = window.slice(Math.floor(window.length / 2));
  const firstRange = Math.max(...firstHalf.map((item) => item.high)) - Math.min(...firstHalf.map((item) => item.low));
  const secondRange = Math.max(...secondHalf.map((item) => item.high)) - Math.min(...secondHalf.map((item) => item.low));
  const compressing = secondRange <= firstRange * (compressionPct / 100 + 0.01);
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - rangeLow) / Math.max(rangeHigh - rangeLow, 0.00001)) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (compressing && positionPct <= 30 && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (compressing && positionPct >= 70 && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct < 50) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'accumulation-distribution',
    context,
    config: { ...config, lookback, compressionPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 6) + (compressing ? 12 : 0),
    reasons: [
      'Accumulation/distribution — range compression with edge participation',
      compressing ? `Range compressing (${compressionPct}% threshold met)` : 'Range expanding — late-cycle risk',
      `Price at ${positionPct.toFixed(0)}% of ${lookback}-bar range`,
      decision === 'buy' ? 'Accumulation at range lows with bullish close' : decision === 'sell' ? 'Distribution at range highs with bearish close' : 'Awaiting A/D edge confirmation',
    ],
    metrics: {
      compressing: compressing ? 1 : 0,
      positionPct: Number(positionPct.toFixed(1)),
      firstRange: Number(firstRange.toFixed(5)),
      secondRange: Number(secondRange.toFixed(5)),
    },
  });
};

export const evaluateManipulationDistributionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 45));
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.025);
  const window = candles.slice(-lookback, -1);
  const last = candles[candles.length - 1]!;
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const buffer = last.close * (sweepBufferPct / 100);
  const spring = last.low < rangeLow - buffer && last.close > rangeLow && last.close > last.open;
  const upthrust = last.high > rangeHigh + buffer && last.close < rangeHigh && last.close < last.open;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spring) {
    bias = 'bullish';
    decision = 'buy';
  } else if (upthrust) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'manipulation-distribution',
    context,
    config: { ...config, lookback, sweepBufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 36 : 0),
    reasons: [
      'Manipulation → distribution — spring/upthrust raid with close-back-inside',
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)}`,
      spring ? 'Spring manipulation below range — bullish reversal' : upthrust ? 'Upthrust manipulation above range — bearish reversal' : 'No manipulation signature on latest bar',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      pattern: spring ? 'spring' : upthrust ? 'upthrust' : 'none',
    },
    events: decision !== 'wait'
      ? [{ label: spring ? 'spring' : 'upthrust', detail: 'Manipulation raid reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluateStopHuntStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 35));
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.025);
  const minWickPct = parseNumber(config.minWickPct, 45);
  const { bias, decision, recentHigh, recentLow } = detectLiquidityGrab(candles, lookback, sweepBufferPct);
  const last = candles[candles.length - 1]!;
  const range = Math.max(last.high - last.low, 0.00001);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const wickPct = Math.max(upperWick, lowerWick) / range * 100;
  let finalDecision = decision;

  if (finalDecision === 'wait' && wickPct >= minWickPct) {
    if (lowerWick >= upperWick && last.close > recentLow) finalDecision = 'buy';
    if (upperWick >= lowerWick && last.close < recentHigh) finalDecision = 'sell';
  }

  const finalBias: StrategyBias = finalDecision === 'buy' ? 'bullish' : finalDecision === 'sell' ? 'bearish' : bias;

  return buildEvaluationResult({
    strategyId: 'stop-hunt-strategy',
    context,
    config: { ...config, lookback, sweepBufferPct, minWickPct },
    candles,
    decision: finalDecision,
    bias: finalBias,
    confidence: 34 + (finalDecision !== 'wait' ? 36 : 0) + (wickPct >= minWickPct ? 8 : 0),
    reasons: [
      `Stop hunt — liquidity raid beyond ${lookback}-bar extremes with rejection wick`,
      `Recent high ${recentHigh.toFixed(5)} / low ${recentLow.toFixed(5)}`,
      finalDecision === 'buy' ? 'Stops hunted below lows — bullish rejection' : finalDecision === 'sell' ? 'Stops hunted above highs — bearish rejection' : 'No stop hunt reversal confirmed',
      `Rejection wick ${wickPct.toFixed(0)}% of bar range`,
    ],
    metrics: {
      recentHigh: Number(recentHigh.toFixed(5)),
      recentLow: Number(recentLow.toFixed(5)),
      wickPct: Number(wickPct.toFixed(1)),
    },
  });
};

export const evaluateInstitutionalCandleModelEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const displacementMultiple = parseNumber(config.displacementMultiple, 1.55);
  const bodyMinPct = parseNumber(config.bodyMinPct, 60);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let signalIndex: number | null = null;

  for (let index = lastIndex; index >= Math.max(0, lastIndex - lookback); index -= 1) {
    const candle = candles[index]!;
    const range = Math.max(candle.high - candle.low, 0.00001);
    const body = Math.abs(candle.close - candle.open);
    const bodyPct = (body / range) * 100;
    const atrNow = atrSeries[index] ?? range;
    const displacement = body >= atrNow * displacementMultiple;
    if (!displacement || bodyPct < bodyMinPct) continue;
    signalIndex = index;
    if (candle.close > candle.open) bias = 'bullish';
    else if (candle.close < candle.open) bias = 'bearish';
    break;
  }

  const last = candles[lastIndex]!;
  if (signalIndex != null && signalIndex < lastIndex) {
    const signal = candles[signalIndex]!;
    if (signal.close > signal.open && last.low <= signal.high && last.close > signal.open) decision = 'buy';
    if (signal.close < signal.open && last.high >= signal.low && last.close < signal.open) decision = 'sell';
  } else if (signalIndex === lastIndex) {
    decision = bias === 'bullish' ? 'buy' : bias === 'bearish' ? 'sell' : 'wait';
  }

  return buildEvaluationResult({
    strategyId: 'institutional-candle-model',
    context,
    config: { ...config, lookback, displacementMultiple, bodyMinPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 32 : 0) + (signalIndex != null ? 10 : 0),
    reasons: [
      'Institutional candle model — displacement body with follow-through retest',
      signalIndex != null ? `Signal bar index ${signalIndex} · ${bias} displacement` : 'No qualifying institutional candle in lookback',
      decision === 'buy' ? 'Bullish displacement with mitigation retest — long' : decision === 'sell' ? 'Bearish displacement with mitigation retest — short' : 'Awaiting institutional candle retest',
    ],
    metrics: {
      signalBarIndex: signalIndex,
      displacementMultiple,
      bodyMinPct,
    },
  });
};

export const evaluatePremiumAndDiscountZonesEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 60));
  const edgePct = parseNumber(config.edgePct, 12);
  const { swingHigh, swingLow, equilibrium, positionPct, last } = premiumDiscountMetrics(candles, lookback);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct < 50) {
    bias = 'bullish';
  } else if (positionPct > 50) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'premium-and-discount-zones',
    context,
    config: { ...config, lookback, edgePct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      'Premium/discount — ICT equilibrium model on swing range',
      `Swing ${swingLow.toFixed(5)} – ${swingHigh.toFixed(5)} · equilibrium ${equilibrium.toFixed(5)}`,
      `Price at ${positionPct.toFixed(0)}% (${positionPct <= 50 ? 'discount' : 'premium'} half)`,
      decision === 'buy' ? 'Discount zone long with bullish close' : decision === 'sell' ? 'Premium zone short with bearish close' : 'Mid-range — no premium/discount entry',
    ],
    metrics: {
      swingHigh: Number(swingHigh.toFixed(5)),
      swingLow: Number(swingLow.toFixed(5)),
      equilibrium: Number(equilibrium.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateSmtDivergenceEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const swingWindow = Math.max(4, parseNumber(config.swingWindow, 8));
  const window = candles.slice(-lookback);
  const swingsHigh: number[] = [];
  const swingsLow: number[] = [];

  for (let index = swingWindow; index < window.length - swingWindow; index += 1) {
    const candle = window[index]!;
    const left = window.slice(index - swingWindow, index);
    const right = window.slice(index + 1, index + swingWindow + 1);
    if (candle.high >= Math.max(...left.map((item) => item.high), ...right.map((item) => item.high))) swingsHigh.push(candle.high);
    if (candle.low <= Math.min(...left.map((item) => item.low), ...right.map((item) => item.low))) swingsLow.push(candle.low);
  }

  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let divergence = 'none';

  if (swingsHigh.length >= 2) {
    const prev = swingsHigh[swingsHigh.length - 2]!;
    const latest = swingsHigh[swingsHigh.length - 1]!;
    if (latest > prev && last.close < prev) {
      divergence = 'bearish SMT';
      bias = 'bearish';
      if (last.close < last.open) decision = 'sell';
    }
  }
  if (swingsLow.length >= 2) {
    const prev = swingsLow[swingsLow.length - 2]!;
    const latest = swingsLow[swingsLow.length - 1]!;
    if (latest < prev && last.close > prev) {
      divergence = 'bullish SMT';
      bias = 'bullish';
      if (last.close > last.open) decision = 'buy';
    }
  }

  return buildEvaluationResult({
    strategyId: 'smt-divergence',
    context,
    config: { ...config, lookback, swingWindow },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 0) + (divergence !== 'none' ? 10 : 0),
    reasons: [
      'SMT divergence — swing failure vs correlated structure proxy',
      divergence !== 'none' ? `${divergence} detected on recent swing sequence` : 'No SMT divergence on latest swings',
      decision === 'buy' ? 'Bullish SMT — lower low failure with bullish close' : decision === 'sell' ? 'Bearish SMT — higher high failure with bearish close' : 'Awaiting SMT divergence confirmation',
    ],
    metrics: {
      divergence,
      swingHighCount: swingsHigh.length,
      swingLowCount: swingsLow.length,
    },
  });
};

export const evaluateKillZonesEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const killZoneBars = Math.max(4, parseNumber(config.killZoneBars, 8));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback);
  const londonWindow = window.slice(Math.floor(window.length / 3), Math.floor(window.length / 3) + killZoneBars);
  const nyWindow = window.slice(Math.floor((window.length * 2) / 3), Math.floor((window.length * 2) / 3) + killZoneBars);
  const activeWindow = nyWindow.length >= 4 ? nyWindow : londonWindow;
  const zoneHigh = Math.max(...activeWindow.map((item) => item.high));
  const zoneLow = Math.min(...activeWindow.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (last.close > zoneHigh + buffer && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < zoneLow - buffer && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > zoneHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < zoneLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'kill-zones',
    context,
    config: { ...config, lookback, killZoneBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      'Kill zones — London/NY session box expansion model',
      `Active kill zone ${zoneLow.toFixed(5)} – ${zoneHigh.toFixed(5)} (${activeWindow.length} bars)`,
      decision === 'buy' ? 'NY/London kill zone upside break — long' : decision === 'sell' ? 'NY/London kill zone downside break — short' : 'Inside kill zone — await expansion',
    ],
    metrics: {
      zoneHigh: Number(zoneHigh.toFixed(5)),
      zoneLow: Number(zoneLow.toFixed(5)),
      killZoneBars: activeWindow.length,
    },
  });
};

export const evaluateJudasSwingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const sessionBars = Math.max(4, parseNumber(config.sessionBars, 8));
  const fakeBreakBufferPct = parseNumber(config.fakeBreakBufferPct, 0.03);
  const window = candles.slice(-lookback);
  const sessionWindow = window.slice(0, sessionBars);
  const sessionHigh = Math.max(...sessionWindow.map((item) => item.high));
  const sessionLow = Math.min(...sessionWindow.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const prior = candles[candles.length - 2]!;
  const buffer = last.close * (fakeBreakBufferPct / 100);
  const fakeBreakUp = prior.close > sessionHigh + buffer && last.close < sessionHigh;
  const fakeBreakDown = prior.close < sessionLow - buffer && last.close > sessionLow;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (fakeBreakDown) {
    bias = 'bullish';
    decision = 'buy';
  } else if (fakeBreakUp) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'judas-swing',
    context,
    config: { ...config, lookback, sessionBars, fakeBreakBufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 36 : 0),
    reasons: [
      'Judas swing — session fake breakout reversal at liquidity pool',
      `Session box ${sessionLow.toFixed(5)} – ${sessionHigh.toFixed(5)}`,
      fakeBreakDown ? 'Fake break below session low — bullish Judas reversal' : fakeBreakUp ? 'Fake break above session high — bearish Judas reversal' : 'No Judas swing on latest bars',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      fakeBreakUp: fakeBreakUp ? 1 : 0,
      fakeBreakDown: fakeBreakDown ? 1 : 0,
    },
    events: decision !== 'wait'
      ? [{ label: 'judas swing', detail: decision === 'buy' ? 'Fake breakdown reversal' : 'Fake breakout reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluatePowerOf3Po3Engine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 60));
  const window = candles.slice(-lookback);
  const third = Math.floor(window.length / 3);
  const accumulation = window.slice(0, third);
  const manipulation = window.slice(third, third * 2);
  const distribution = window.slice(third * 2);
  const accRange = Math.max(...accumulation.map((item) => item.high)) - Math.min(...accumulation.map((item) => item.low));
  const manRange = Math.max(...manipulation.map((item) => item.high)) - Math.min(...manipulation.map((item) => item.low));
  const distRange = Math.max(...distribution.map((item) => item.high)) - Math.min(...distribution.map((item) => item.low));
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  let phase: 'accumulation' | 'manipulation' | 'distribution' | 'unknown' = 'unknown';
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (manRange <= accRange * 1.1 && distRange >= manRange * 1.05) phase = 'distribution';
  else if (manRange >= accRange * 1.15) phase = 'manipulation';
  else phase = 'accumulation';

  if (phase === 'accumulation' && last.close > rangeLow && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (phase === 'distribution' && last.close < rangeHigh && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (phase === 'manipulation') {
    const spring = last.low < rangeLow && last.close > rangeLow;
    const upthrust = last.high > rangeHigh && last.close < rangeHigh;
    if (spring) {
      bias = 'bullish';
      decision = 'buy';
    } else if (upthrust) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'power-of-3-po3',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      'Power of 3 (PO3) — accumulation, manipulation, distribution cycle model',
      `Current phase estimate: ${phase}`,
      `Range segments acc ${accRange.toFixed(5)} / man ${manRange.toFixed(5)} / dist ${distRange.toFixed(5)}`,
      decision === 'buy' ? 'PO3 long — accumulation or manipulation spring' : decision === 'sell' ? 'PO3 short — distribution or manipulation upthrust' : 'Awaiting PO3 phase entry',
    ],
    metrics: {
      phase,
      accRange: Number(accRange.toFixed(5)),
      manRange: Number(manRange.toFixed(5)),
      distRange: Number(distRange.toFixed(5)),
    },
  });
};
