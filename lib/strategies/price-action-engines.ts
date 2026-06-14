import { analyzeLiquidityZones } from '@/lib/liquidity-zone-engine';
import { analyzeOrderBlocks } from '@/lib/order-block-detection-engine';
import { analyzeMarketStructure } from '@/lib/structure-analysis-engine';
import { analyzeSupportResistance } from '@/lib/support-resistance-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr } from './indicators';

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

export const evaluateSupportAndResistanceEngine: StrategyEngine = (candles, config, context) => {
  const zoneLookback = Math.max(30, parseNumber(config.zoneLookback, 60));
  const minStrength = parseNumber(config.minStrength, 0.35);
  const tolerancePct = parseNumber(config.tolerancePct, 0.06);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-zoneLookback));
  const analysis = analyzeSupportResistance(reconstructed);
  const zones = analysis.zones.filter((zone) => zone.strengthScore >= minStrength);
  const last = candles[candles.length - 1]!;
  const tolerance = last.close * (tolerancePct / 100);
  const support = zones
    .filter((zone) => zone.zoneType === 'support' || zone.zoneType === 'dynamic')
    .sort((a, b) => Math.abs(last.close - b.zoneHigh) - Math.abs(last.close - a.zoneHigh))[0] ?? null;
  const resistance = zones
    .filter((zone) => zone.zoneType === 'resistance' || zone.zoneType === 'dynamic')
    .sort((a, b) => Math.abs(last.close - a.zoneLow) - Math.abs(last.close - b.zoneLow))[0] ?? null;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (support && last.low <= support.zoneHigh + tolerance && last.close > support.zoneHigh && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (resistance && last.high >= resistance.zoneLow - tolerance && last.close < resistance.zoneLow && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (support && last.close > support.zoneLow) {
    bias = 'bullish';
  } else if (resistance && last.close < resistance.zoneHigh) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'support-and-resistance',
    context,
    config: { ...config, zoneLookback, minStrength, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 4) + Math.min(12, zones.length * 2),
    reasons: [
      `Price action S/R — ${zones.length} qualified zones from ${zoneLookback}-bar lookback`,
      decision === 'buy'
        ? `Bounce from support ${support?.zoneLow.toFixed(5)} – ${support?.zoneHigh.toFixed(5)}`
        : decision === 'sell'
          ? `Rejection from resistance ${resistance?.zoneLow.toFixed(5)} – ${resistance?.zoneHigh.toFixed(5)}`
          : 'No S/R rejection on latest bar',
    ],
    metrics: {
      zoneCount: zones.length,
      supportZone: support ? Number(support.zoneHigh.toFixed(5)) : null,
      resistanceZone: resistance ? Number(resistance.zoneLow.toFixed(5)) : null,
    },
  });
};

export const evaluateSupplyAndDemandEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 50));
  const minQuality = parseNumber(config.minQuality, 0.42);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const analysis = analyzeOrderBlocks(reconstructed);
  const activeBlocks = analysis.orderBlocks.filter(
    (block) => block.qualityScore >= minQuality && block.mitigationStatus !== 'invalidated',
  );
  const last = candles[candles.length - 1]!;
  const demand = activeBlocks
    .filter((block) => block.blockType === 'bullish')
    .sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;
  const supply = activeBlocks
    .filter((block) => block.blockType === 'bearish')
    .sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (demand && last.low <= demand.zoneHigh && last.close > demand.zoneLow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (supply && last.high >= supply.zoneLow && last.close < supply.zoneHigh) {
    bias = 'bearish';
    decision = 'sell';
  } else if (demand) {
    bias = 'bullish';
  } else if (supply) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'supply-and-demand',
    context,
    config: { ...config, lookback, minQuality },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 6) + Math.min(14, (demand?.qualityScore ?? supply?.qualityScore ?? 0) * 20),
    reasons: [
      'Supply & demand — institutional order block zones with mitigation retest',
      demand
        ? `Demand zone ${demand.zoneLow.toFixed(5)} – ${demand.zoneHigh.toFixed(5)} (quality ${(demand.qualityScore * 100).toFixed(0)}%)`
        : supply
          ? `Supply zone ${supply.zoneLow.toFixed(5)} – ${supply.zoneHigh.toFixed(5)} (quality ${(supply.qualityScore * 100).toFixed(0)}%)`
          : 'No qualified supply/demand block in lookback',
      decision === 'buy' ? 'Price mitigating into demand — long bias' : decision === 'sell' ? 'Price mitigating into supply — short bias' : 'Awaiting zone retest',
    ],
    metrics: {
      demandZone: demand ? Number(demand.zoneHigh.toFixed(5)) : null,
      supplyZone: supply ? Number(supply.zoneLow.toFixed(5)) : null,
      blockCount: activeBlocks.length,
    },
  });
};

export const evaluateCandlestickTradingEngine: StrategyEngine = (candles, config, context) => {
  const wickRatio = parseNumber(config.wickRatio, 2);
  const last = candles.length - 1;
  const c2 = candles[last]!;
  const c1 = candles[last - 1];
  const c0 = candles[last - 2];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (c1 && c0) {
    const bullishEngulf = c1.close < c1.open && c2.close > c2.open && c2.close >= c1.open && c2.open <= c1.close;
    const bearishEngulf = c1.close > c1.open && c2.close < c2.open && c2.close <= c1.open && c2.open >= c1.close;
    const morningStar = c0.close < c0.open && Math.abs(c1.close - c1.open) < (c0.high - c0.low) * 0.35 && c2.close > c2.open && c2.close > (c0.open + c0.close) / 2;
    const eveningStar = c0.close > c0.open && Math.abs(c1.close - c1.open) < (c0.high - c0.low) * 0.35 && c2.close < c2.open && c2.close < (c0.open + c0.close) / 2;
    const body = Math.abs(c2.close - c2.open);
    const lowerWick = Math.min(c2.open, c2.close) - c2.low;
    const upperWick = c2.high - Math.max(c2.open, c2.close);
    const bullishPin = lowerWick >= body * wickRatio && c2.close > c2.open;
    const bearishPin = upperWick >= body * wickRatio && c2.close < c2.open;
    const hammer = lowerWick >= body * 1.8 && upperWick <= body * 0.5;
    const shootingStar = upperWick >= body * 1.8 && lowerWick <= body * 0.5;

    if (bullishEngulf || morningStar || bullishPin || hammer) {
      bias = 'bullish';
      pattern = bullishEngulf ? 'bullish engulfing' : morningStar ? 'morning star' : hammer ? 'hammer' : 'bullish pin';
      decision = 'buy';
    } else if (bearishEngulf || eveningStar || bearishPin || shootingStar) {
      bias = 'bearish';
      pattern = bearishEngulf ? 'bearish engulfing' : eveningStar ? 'evening star' : shootingStar ? 'shooting star' : 'bearish pin';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'candlestick-trading',
    context,
    config: { ...config, wickRatio },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0),
    reasons: [
      'Candlestick trading — multi-bar reversal and rejection patterns',
      pattern !== 'none' ? `Pattern: ${pattern}` : 'No qualifying candlestick pattern on latest bars',
      decision === 'buy' ? 'Bullish candlestick long' : decision === 'sell' ? 'Bearish candlestick short' : 'Awaiting candlestick setup',
    ],
    metrics: { pattern },
  });
};

export const evaluateEngulfingPatternEngine: StrategyEngine = (candles, config, context) => {
  const minBodyPct = parseNumber(config.minBodyPct, 55);
  const last = candles.length - 1;
  const current = candles[last]!;
  const prior = candles[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (prior) {
    const currentRange = Math.max(current.high - current.low, 0.00001);
    const priorRange = Math.max(prior.high - prior.low, 0.00001);
    const currentBodyPct = (Math.abs(current.close - current.open) / currentRange) * 100;
    const priorBodyPct = (Math.abs(prior.close - prior.open) / priorRange) * 100;
    const bullishEngulf = prior.close < prior.open
      && current.close > current.open
      && currentBodyPct >= minBodyPct
      && priorBodyPct >= minBodyPct * 0.6
      && current.close >= prior.open
      && current.open <= prior.close;
    const bearishEngulf = prior.close > prior.open
      && current.close < current.open
      && currentBodyPct >= minBodyPct
      && priorBodyPct >= minBodyPct * 0.6
      && current.close <= prior.open
      && current.open >= prior.close;

    if (bullishEngulf) {
      bias = 'bullish';
      decision = 'buy';
      pattern = 'bullish engulfing';
    } else if (bearishEngulf) {
      bias = 'bearish';
      decision = 'sell';
      pattern = 'bearish engulfing';
    }
  }

  return buildEvaluationResult({
    strategyId: 'engulfing-pattern',
    context,
    config: { ...config, minBodyPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 34 : 0),
    reasons: [
      `Engulfing pattern — body dominance ≥ ${minBodyPct}% of range`,
      pattern !== 'none' ? `${pattern} confirmed on latest bar` : 'No qualifying engulfing on latest bar',
      decision === 'buy' ? 'Bullish engulfing — momentum reversal long' : decision === 'sell' ? 'Bearish engulfing — momentum reversal short' : 'Awaiting engulfing setup',
    ],
    metrics: { pattern },
    events: decision !== 'wait'
      ? [{ label: pattern, detail: 'Engulfing reversal entry', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateInsideBarStrategyEngine: StrategyEngine = (candles, config, context) => {
  const motherLookback = Math.max(3, parseNumber(config.motherLookback, 5));
  const last = candles.length - 1;
  const breakout = candles[last]!;
  const inside = candles[last - 1];
  const mother = candles[last - 2];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (inside && mother) {
    const isInside = inside.high <= mother.high && inside.low >= mother.low;
    const bullishBreak = isInside && breakout.close > mother.high && breakout.close > breakout.open;
    const bearishBreak = isInside && breakout.close < mother.low && breakout.close < breakout.open;
    if (bullishBreak) {
      bias = 'bullish';
      decision = 'buy';
    } else if (bearishBreak) {
      bias = 'bearish';
      decision = 'sell';
    } else if (isInside) {
      bias = breakout.close >= mother.close ? 'bullish' : 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'inside-bar-strategy',
    context,
    config: { ...config, motherLookback },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : isInsideBarPending(inside, mother) ? 8 : 0),
    reasons: [
      'Inside bar — compression within mother bar followed by directional breakout',
      mother && inside
        ? `Mother range ${mother.low.toFixed(5)} – ${mother.high.toFixed(5)}`
        : 'Insufficient bars for inside bar setup',
      decision === 'buy'
        ? 'Bullish inside bar breakout above mother high'
        : decision === 'sell'
          ? 'Bearish inside bar breakout below mother low'
          : 'No confirmed inside bar breakout on latest bar',
    ],
    metrics: {
      motherHigh: mother ? Number(mother.high.toFixed(5)) : null,
      motherLow: mother ? Number(mother.low.toFixed(5)) : null,
    },
  });
};

function isInsideBarPending(
  inside: StrategyPriceCandle | undefined,
  mother: StrategyPriceCandle | undefined,
): boolean {
  return Boolean(inside && mother && inside.high <= mother.high && inside.low >= mother.low);
}

export const evaluateFakeyPatternEngine: StrategyEngine = (candles, config, context) => {
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.03);
  const last = candles.length - 1;
  const fakey = candles[last]!;
  const inside = candles[last - 1];
  const mother = candles[last - 2];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let fakeyType = 'none';

  if (inside && mother) {
    const isInside = inside.high <= mother.high && inside.low >= mother.low;
    const buffer = fakey.close * (sweepBufferPct / 100);
    const bullishFakey = isInside
      && fakey.low < mother.low - buffer
      && fakey.close > mother.low
      && fakey.close > fakey.open;
    const bearishFakey = isInside
      && fakey.high > mother.high + buffer
      && fakey.close < mother.high
      && fakey.close < fakey.open;

    if (bullishFakey) {
      bias = 'bullish';
      decision = 'buy';
      fakeyType = 'bullish fakey';
    } else if (bearishFakey) {
      bias = 'bearish';
      decision = 'sell';
      fakeyType = 'bearish fakey';
    }
  }

  return buildEvaluationResult({
    strategyId: 'fakey-pattern',
    context,
    config: { ...config, sweepBufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 36 : 0),
    reasons: [
      'Fakey pattern — false breakout from inside bar with close-back reversal',
      fakeyType !== 'none' ? `${fakeyType} — stop hunt then rejection` : 'No fakey reversal on latest bar',
      decision === 'buy' ? 'Bullish fakey long after false break below mother low' : decision === 'sell' ? 'Bearish fakey short after false break above mother high' : 'Awaiting fakey setup',
    ],
    metrics: { fakeyType },
    events: decision !== 'wait'
      ? [{ label: fakeyType, detail: 'False breakout reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateMarketStructureTradingEngine: StrategyEngine = (candles, config, context) => {
  const maxTrapRisk = parseNumber(config.maxTrapRisk, 0.68);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const bias = institutionalTextBias(structure.finalBias.institutionalBias);
  const trapRisk = structure.finalBias.retailTrapRisk;
  let decision: StrategySignalSide = 'wait';

  if (trapRisk <= maxTrapRisk) {
    if (structure.finalBias.tradeDecision === 'BUY' || bias === 'bullish') decision = 'buy';
    if (structure.finalBias.tradeDecision === 'SELL' || bias === 'bearish') decision = 'sell';
  }

  const lastBos = structure.bos.at(-1);
  const lastChoch = structure.choch.at(-1);

  return buildEvaluationResult({
    strategyId: 'market-structure-trading',
    context,
    config: { ...config, maxTrapRisk },
    candles,
    decision,
    bias,
    confidence: 36
      + (decision !== 'wait' ? 30 : 8)
      + Math.round((structure.finalBias.confidenceScore ?? 0) * 24)
      + (trapRisk > maxTrapRisk ? -14 : 0),
    reasons: [
      'Market structure trading — swing hierarchy + BOS/CHOCH institutional bias',
      structure.finalBias.reasoningText,
      lastBos ? `Last BOS: ${lastBos.direction} at ${lastBos.priceLevel.toFixed(5)}` : 'No recent BOS',
      lastChoch ? `Last CHOCH: ${lastChoch.direction}` : 'No recent CHOCH',
      trapRisk > maxTrapRisk ? `Retail trap risk ${(trapRisk * 100).toFixed(0)}% exceeds threshold — standing aside` : 'Trap risk within acceptable range',
    ],
    metrics: {
      phase: structure.phase.phaseState,
      trapRiskPct: Number((trapRisk * 100).toFixed(1)),
      bosCount: structure.bos.length,
      chochCount: structure.choch.length,
    },
  });
};

export const evaluateLiquiditySweepStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const minSweepQuality = parseNumber(config.minSweepQuality, 0.45);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const liquidity = analyzeLiquidityZones(reconstructed);
  const last = candles[candles.length - 1]!;
  const recentSweep = liquidity.sweeps
    .filter((sweep) => sweep.sweepQualityScore >= minSweepQuality)
    .sort((a, b) => b.candleIndex - a.candleIndex)[0] ?? null;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (recentSweep && recentSweep.candleIndex >= candles.length - 3) {
    if (recentSweep.sweepDirection === 'sell_side_sweep') {
      bias = 'bullish';
      if (last.close > last.open) decision = 'buy';
    } else if (recentSweep.sweepDirection === 'buy_side_sweep') {
      bias = 'bearish';
      if (last.close < last.open) decision = 'sell';
    }
  }

  if (decision === 'wait') {
    const window = candles.slice(-lookback - 1, -1);
    const recentHigh = Math.max(...window.map((item) => item.high));
    const recentLow = Math.min(...window.map((item) => item.low));
    const sweepBuffer = last.close * 0.0002;
    const bullishSweep = last.low < recentLow - sweepBuffer && last.close > recentLow;
    const bearishSweep = last.high > recentHigh + sweepBuffer && last.close < recentHigh;
    if (bullishSweep) {
      bias = 'bullish';
      decision = 'buy';
    } else if (bearishSweep) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-sweep-strategy',
    context,
    config: { ...config, lookback, minSweepQuality },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0) + (recentSweep ? Math.min(14, recentSweep.sweepQualityScore * 20) : 0),
    reasons: [
      'Liquidity sweep — equal highs/lows raid with reversal confirmation',
      recentSweep
        ? `Recent sweep quality ${(recentSweep.sweepQualityScore * 100).toFixed(0)}% (${recentSweep.sweepDirection})`
        : 'No institutional sweep detected in lookback',
      decision === 'buy' ? 'Buy-side liquidity swept — bullish reversal' : decision === 'sell' ? 'Sell-side liquidity swept — bearish reversal' : 'Awaiting liquidity sweep reversal',
    ],
    metrics: {
      sweepCount: liquidity.sweeps.length,
      zoneCount: liquidity.liquidityZones.length,
    },
    events: decision !== 'wait'
      ? [{ label: 'liquidity sweep', detail: decision === 'buy' ? 'Buy-side sweep reversal' : 'Sell-side sweep reversal', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluateMitigationBlockStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 55));
  const minQuality = parseNumber(config.minQuality, 0.44);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const analysis = analyzeOrderBlocks(reconstructed);
  const mitigating = analysis.orderBlocks.filter(
    (block) => block.qualityScore >= minQuality
      && (block.mitigationStatus === 'partial_mitigation' || block.mitigationStatus === 'fresh'),
  );
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let selected = mitigating.sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;

  if (selected?.blockType === 'bullish' && last.low <= selected.zoneHigh && last.close > selected.zoneLow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (selected?.blockType === 'bearish' && last.high >= selected.zoneLow && last.close < selected.zoneHigh) {
    bias = 'bearish';
    decision = 'sell';
  } else if (selected?.blockType === 'bullish') {
    bias = 'bullish';
  } else if (selected?.blockType === 'bearish') {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'mitigation-block-strategy',
    context,
    config: { ...config, lookback, minQuality },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 34 : 6) + (selected ? Math.min(12, selected.mitigationPercentage * 0.2) : 0),
    reasons: [
      'Mitigation block — order block retest with partial/full mitigation scoring',
      selected
        ? `${selected.blockType} block ${selected.zoneLow.toFixed(5)} – ${selected.zoneHigh.toFixed(5)} (${selected.mitigationStatus.replace(/_/g, ' ')})`
        : 'No fresh/partial mitigation block in lookback',
      decision === 'buy' ? 'Bullish mitigation into demand block' : decision === 'sell' ? 'Bearish mitigation into supply block' : 'Awaiting block mitigation retest',
    ],
    metrics: {
      mitigationStatus: selected?.mitigationStatus ?? 'none',
      mitigationPct: selected ? Number(selected.mitigationPercentage.toFixed(1)) : null,
      qualityScore: selected ? Number((selected.qualityScore * 100).toFixed(1)) : null,
    },
  });
};

export const evaluateBreakerBlockStrategyEngine: StrategyEngine = (candles, config, context) => {
  const zoneLookback = Math.max(30, parseNumber(config.zoneLookback, 60));
  const breakTolerancePct = parseNumber(config.breakTolerancePct, 0.05);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-zoneLookback));
  const analysis = analyzeSupportResistance(reconstructed);
  const last = candles[candles.length - 1]!;
  const tolerance = last.close * (breakTolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let breakerLevel: number | null = null;
  let breakerType = 'none';

  for (const zone of analysis.zones.sort((a, b) => b.strengthScore - a.strengthScore).slice(0, 8)) {
    const wasSupport = zone.zoneType === 'support' || zone.zoneType === 'dynamic';
    const wasResistance = zone.zoneType === 'resistance' || zone.zoneType === 'dynamic';
    const brokeBelowSupport = wasSupport && last.close < zone.zoneLow - tolerance;
    const brokeAboveResistance = wasResistance && last.close > zone.zoneHigh + tolerance;
    const retestBrokenSupport = brokeBelowSupport && Math.abs(last.high - zone.zoneLow) <= tolerance && last.close < zone.zoneLow;
    const retestBrokenResistance = brokeAboveResistance && Math.abs(last.low - zone.zoneHigh) <= tolerance && last.close > zone.zoneHigh;

    if (retestBrokenResistance) {
      bias = 'bullish';
      decision = 'buy';
      breakerLevel = zone.zoneHigh;
      breakerType = 'bullish breaker';
      break;
    }
    if (retestBrokenSupport) {
      bias = 'bearish';
      decision = 'sell';
      breakerLevel = zone.zoneLow;
      breakerType = 'bearish breaker';
      break;
    }
    if (brokeAboveResistance) bias = 'bullish';
    if (brokeBelowSupport) bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'breaker-block-strategy',
    context,
    config: { ...config, zoneLookback, breakTolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 35 : 6),
    reasons: [
      'Breaker block — failed S/R zone flip with retest confirmation',
      breakerType !== 'none'
        ? `${breakerType} at ${breakerLevel?.toFixed(5)} — zone polarity flipped`
        : 'No breaker block retest on latest bar',
      decision === 'buy' ? 'Broken resistance retest as support — long' : decision === 'sell' ? 'Broken support retest as resistance — short' : 'Awaiting breaker retest',
    ],
    metrics: {
      breakerType,
      breakerLevel: breakerLevel != null ? Number(breakerLevel.toFixed(5)) : null,
    },
  });
};

export const evaluateInstitutionalCandleTradingEngine: StrategyEngine = (candles, config, context) => {
  const displacementMultiple = parseNumber(config.displacementMultiple, 1.55);
  const bodyMinPct = parseNumber(config.bodyMinPct, 58);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const range = Math.max(last.high - last.low, 0.00001);
  const body = Math.abs(last.close - last.open);
  const bodyPct = (body / range) * 100;
  const atrNow = atrSeries[lastIndex] ?? range;
  const displacement = body >= atrNow * displacementMultiple;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (displacement && bodyPct >= bodyMinPct) {
    if (last.close > last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (last.close < last.open) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'institutional-candle-trading',
    context,
    config: { ...config, displacementMultiple, bodyMinPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 0) + (displacement ? Math.min(16, bodyPct / 4) : 0),
    reasons: [
      `Institutional candle — displacement ≥ ${displacementMultiple}× ATR with body ≥ ${bodyMinPct}% of range`,
      displacement
        ? `Displacement candle body ${body.toFixed(5)} vs ATR ${atrNow.toFixed(5)} (${bodyPct.toFixed(0)}% body)`
        : 'Latest bar lacks institutional displacement signature',
      decision === 'buy' ? 'Bullish displacement — smart money long impulse' : decision === 'sell' ? 'Bearish displacement — smart money short impulse' : 'Awaiting displacement candle',
    ],
    metrics: {
      bodyPct: Number(bodyPct.toFixed(1)),
      displacementRatio: Number((body / Math.max(atrNow, 0.00001)).toFixed(2)),
    },
    events: decision !== 'wait'
      ? [{ label: 'displacement candle', detail: decision === 'buy' ? 'Bullish institutional impulse' : 'Bearish institutional impulse', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluateIctTradingStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 55));
  const minConfluence = Math.max(2, parseNumber(config.minConfluence, 2));
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const orderBlocks = analyzeOrderBlocks(reconstructed);
  const liquidity = analyzeLiquidityZones(reconstructed);
  const last = candles[candles.length - 1]!;
  let bullishScore = 0;
  let bearishScore = 0;

  if (structure.finalBias.tradeDecision === 'BUY') bullishScore += 1;
  if (structure.finalBias.tradeDecision === 'SELL') bearishScore += 1;
  if (structure.bos.at(-1)?.direction === 'bullish') bullishScore += 1;
  if (structure.bos.at(-1)?.direction === 'bearish') bearishScore += 1;

  const demandBlock = orderBlocks.orderBlocks.find((block) => block.blockType === 'bullish' && block.qualityScore >= 0.42);
  const supplyBlock = orderBlocks.orderBlocks.find((block) => block.blockType === 'bearish' && block.qualityScore >= 0.42);
  if (demandBlock && last.low <= demandBlock.zoneHigh && last.close > demandBlock.zoneLow) bullishScore += 1;
  if (supplyBlock && last.high >= supplyBlock.zoneLow && last.close < supplyBlock.zoneHigh) bearishScore += 1;
  if (liquidity.sweeps.some((sweep) => sweep.sweepDirection === 'sell_side_sweep')) bullishScore += 1;
  if (liquidity.sweeps.some((sweep) => sweep.sweepDirection === 'buy_side_sweep')) bearishScore += 1;

  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishScore >= minConfluence && bullishScore > bearishScore) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishScore >= minConfluence && bearishScore > bullishScore) {
    bias = 'bearish';
    decision = 'sell';
  } else if (bullishScore > bearishScore) {
    bias = 'bullish';
  } else if (bearishScore > bullishScore) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'ict-trading-strategy',
    context,
    config: { ...config, lookback, minConfluence },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 8) + Math.min(18, Math.max(bullishScore, bearishScore) * 6),
    reasons: [
      `ICT trading — multi-pillar confluence (min ${minConfluence} signals)`,
      `Bullish score ${bullishScore} / bearish score ${bearishScore} (BOS, OB, liquidity, bias)`,
      structure.finalBias.reasoningText,
      decision === 'buy' ? 'ICT bullish confluence — long bias' : decision === 'sell' ? 'ICT bearish confluence — short bias' : 'Insufficient ICT confluence',
    ],
    metrics: {
      bullishScore,
      bearishScore,
      bosCount: structure.bos.length,
      blockCount: orderBlocks.orderBlocks.length,
      sweepCount: liquidity.sweeps.length,
    },
  });
};

export const evaluateBosBreakOfStructureEngine: StrategyEngine = (candles, config, context) => {
  const minValidation = parseNumber(config.minValidation, 0.52);
  const maxFalseBreakRisk = parseNumber(config.maxFalseBreakRisk, 0.62);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const lastBos = structure.bos.at(-1) ?? null;
  const lastIndex = candles.length - 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (lastBos
    && lastBos.candleIndex >= lastIndex - 2
    && lastBos.validationScore >= minValidation
    && lastBos.falseBreakRisk <= maxFalseBreakRisk) {
    if (lastBos.direction === 'bullish') {
      bias = 'bullish';
      decision = 'buy';
    } else {
      bias = 'bearish';
      decision = 'sell';
    }
  } else if (lastBos?.direction === 'bullish') {
    bias = 'bullish';
  } else if (lastBos?.direction === 'bearish') {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'bos-break-of-structure',
    context,
    config: { ...config, minValidation, maxFalseBreakRisk },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 8) + (lastBos ? Math.min(16, lastBos.validationScore * 20) : 0),
    reasons: [
      'BOS (Break of Structure) — swing level displacement with validation scoring',
      lastBos
        ? `${lastBos.direction} BOS at ${lastBos.priceLevel.toFixed(5)} — validation ${(lastBos.validationScore * 100).toFixed(0)}%`
        : 'No break of structure detected',
      lastBos && lastBos.falseBreakRisk > maxFalseBreakRisk
        ? `False-break risk ${(lastBos.falseBreakRisk * 100).toFixed(0)}% exceeds threshold`
        : decision === 'buy'
          ? 'Confirmed bullish BOS — continuation long'
          : decision === 'sell'
            ? 'Confirmed bearish BOS — continuation short'
            : 'Awaiting validated BOS',
    ],
    metrics: {
      bosCount: structure.bos.length,
      validationPct: lastBos ? Number((lastBos.validationScore * 100).toFixed(1)) : null,
      falseBreakRiskPct: lastBos ? Number((lastBos.falseBreakRisk * 100).toFixed(1)) : null,
    },
    events: decision !== 'wait' && lastBos
      ? [{ label: `${lastBos.direction} BOS`, detail: lastBos.explanationText, tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: lastBos.candleIndex }]
      : [],
  });
};

export const evaluateChochChangeOfCharacterEngine: StrategyEngine = (candles, config, context) => {
  const minValidation = parseNumber(config.minValidation, 0.5);
  const maxFalseBreakRisk = parseNumber(config.maxFalseBreakRisk, 0.65);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const structure = analyzeMarketStructure(reconstructed, String(config.timeframe ?? context.timeframe));
  const lastChoch = structure.choch.at(-1) ?? null;
  const lastIndex = candles.length - 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (lastChoch
    && lastChoch.candleIndex >= lastIndex - 3
    && lastChoch.validationScore >= minValidation
    && lastChoch.falseBreakRisk <= maxFalseBreakRisk) {
    if (lastChoch.direction === 'bullish') {
      bias = 'bullish';
      decision = 'buy';
    } else {
      bias = 'bearish';
      decision = 'sell';
    }
  } else if (lastChoch?.direction === 'bullish') {
    bias = 'bullish';
  } else if (lastChoch?.direction === 'bearish') {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'choch-change-of-character',
    context,
    config: { ...config, minValidation, maxFalseBreakRisk },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 32 : 8) + (lastChoch ? Math.min(14, lastChoch.validationScore * 18) : 0),
    reasons: [
      'CHOCH (Change of Character) — structural trend reversal after failed continuation',
      lastChoch
        ? `${lastChoch.direction} CHOCH at ${lastChoch.priceLevel.toFixed(5)} — validation ${(lastChoch.validationScore * 100).toFixed(0)}%`
        : 'No change of character detected',
      decision === 'buy'
        ? 'Bullish CHOCH — reversal long bias'
        : decision === 'sell'
          ? 'Bearish CHOCH — reversal short bias'
          : 'Awaiting validated CHOCH',
    ],
    metrics: {
      chochCount: structure.choch.length,
      validationPct: lastChoch ? Number((lastChoch.validationScore * 100).toFixed(1)) : null,
      falseBreakRiskPct: lastChoch ? Number((lastChoch.falseBreakRisk * 100).toFixed(1)) : null,
    },
    events: decision !== 'wait' && lastChoch
      ? [{ label: `${lastChoch.direction} CHOCH`, detail: lastChoch.explanationText, tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: lastChoch.candleIndex }]
      : [],
  });
};
