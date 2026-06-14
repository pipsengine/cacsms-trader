import { analyzeOrderBlocks } from '@/lib/order-block-detection-engine';
import { analyzeTrendlines } from '@/lib/trendline-detection-engine';
import { analyzeSwingPoints } from '@/lib/swing-point-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, ema, macd, rsi } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function findLocalExtremes(
  candles: StrategyPriceCandle[],
  lookback: number,
): { highs: Array<{ index: number; price: number }>; lows: Array<{ index: number; price: number }> } {
  const start = Math.max(2, candles.length - lookback);
  const highs: Array<{ index: number; price: number }> = [];
  const lows: Array<{ index: number; price: number }> = [];
  for (let index = start; index < candles.length - 2; index += 1) {
    const prev = candles[index - 1]!;
    const curr = candles[index]!;
    const next = candles[index + 1]!;
    if (curr.high >= prev.high && curr.high >= next.high) highs.push({ index, price: curr.high });
    if (curr.low <= prev.low && curr.low <= next.low) lows.push({ index, price: curr.low });
  }
  return { highs, lows };
}

export const evaluateDoubleTopBottomEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 60));
  const tolerancePct = parseNumber(config.tolerancePct, 0.12);
  const window = candles.slice(-lookback);
  const { highs, lows } = findLocalExtremes(window, lookback);
  const last = candles[candles.length - 1]!;
  const tolerance = last.close * (tolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (highs.length >= 2) {
    const h1 = highs.at(-2)!;
    const h2 = highs.at(-1)!;
    const doubleTop = Math.abs(h1.price - h2.price) <= tolerance && h2.index > h1.index && last.close < Math.min(h1.price, h2.price) - tolerance * 0.5;
    if (doubleTop) {
      bias = 'bearish';
      pattern = 'double top';
      decision = 'sell';
    }
  }
  if (lows.length >= 2 && decision === 'wait') {
    const l1 = lows.at(-2)!;
    const l2 = lows.at(-1)!;
    const doubleBottom = Math.abs(l1.price - l2.price) <= tolerance && l2.index > l1.index && last.close > Math.max(l1.price, l2.price) + tolerance * 0.5;
    if (doubleBottom) {
      bias = 'bullish';
      pattern = 'double bottom';
      decision = 'buy';
    }
  }

  return buildEvaluationResult({
    strategyId: 'double-top-bottom',
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : pattern !== 'none' ? 8 : 0),
    reasons: [
      `Double top/bottom — dual swing extreme detection over ${lookback} bars`,
      pattern !== 'none' ? `${pattern} confirmed with neckline break` : 'No double top/bottom reversal on latest bar',
      decision === 'buy' ? 'Double bottom neckline break — reversal long' : decision === 'sell' ? 'Double top neckline break — reversal short' : 'Awaiting dual-extreme pattern',
    ],
    metrics: { pattern, swingHighs: highs.length, swingLows: lows.length },
  });
};

export const evaluateHeadAndShouldersEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(40, parseNumber(config.lookback, 70));
  const tolerancePct = parseNumber(config.tolerancePct, 0.15);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const swings = analyzeSwingPoints(reconstructed, { depths: [2, 4], zigzagPercent: 0.1 });
  const highs = swings.swings.filter((item) => item.swingKind === 'high').slice(-3);
  const lows = swings.swings.filter((item) => item.swingKind === 'low').slice(-3);
  const last = candles[candles.length - 1]!;
  const tolerance = last.close * (tolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (highs.length === 3) {
    const [left, head, right] = highs;
    const headShoulders = head.priceLevel > left.priceLevel && head.priceLevel > right.priceLevel
      && Math.abs(left.priceLevel - right.priceLevel) <= tolerance;
    if (headShoulders && last.close < Math.min(left.priceLevel, right.priceLevel)) {
      bias = 'bearish';
      pattern = 'head and shoulders';
      decision = 'sell';
    }
  }
  if (lows.length === 3 && decision === 'wait') {
    const [left, head, right] = lows;
    const inverseHs = head.priceLevel < left.priceLevel && head.priceLevel < right.priceLevel
      && Math.abs(left.priceLevel - right.priceLevel) <= tolerance;
    if (inverseHs && last.close > Math.max(left.priceLevel, right.priceLevel)) {
      bias = 'bullish';
      pattern = 'inverse head and shoulders';
      decision = 'buy';
    }
  }

  return buildEvaluationResult({
    strategyId: 'head-and-shoulders',
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 32 : pattern !== 'none' ? 10 : 0),
    reasons: [
      'Head and shoulders — three-swing reversal pattern with neckline break',
      pattern !== 'none' ? `${pattern} structure confirmed` : 'No H&S reversal pattern detected',
      decision === 'buy' ? 'Inverse H&S breakout — reversal long' : decision === 'sell' ? 'H&S breakdown — reversal short' : 'Awaiting H&S completion',
    ],
    metrics: { pattern },
  });
};

function detectDivergence(
  prices: number[],
  indicator: Array<number | null>,
  lookback: number,
): 'bullish' | 'bearish' | 'none' {
  const last = prices.length - 1;
  const start = Math.max(0, last - lookback);
  let priceHighIdx = start;
  let priceLowIdx = start;
  for (let index = start; index <= last; index += 1) {
    if (prices[index]! >= prices[priceHighIdx]!) priceHighIdx = index;
    if (prices[index]! <= prices[priceLowIdx]!) priceLowIdx = index;
  }
  const priorHighStart = Math.max(start, priceHighIdx - Math.floor(lookback / 2));
  let priorHighIdx = priorHighStart;
  for (let index = priorHighStart; index < priceHighIdx; index += 1) {
    if (prices[index]! >= prices[priorHighIdx]!) priorHighIdx = index;
  }
  const priorLowStart = Math.max(start, priceLowIdx - Math.floor(lookback / 2));
  let priorLowIdx = priorLowStart;
  for (let index = priorLowStart; index < priceLowIdx; index += 1) {
    if (prices[index]! <= prices[priorLowIdx]!) priorLowIdx = index;
  }
  const indHighNow = indicator[priceHighIdx];
  const indHighPrev = indicator[priorHighIdx];
  const indLowNow = indicator[priceLowIdx];
  const indLowPrev = indicator[priorLowIdx];
  if (indHighNow != null && indHighPrev != null && prices[priceHighIdx]! > prices[priorHighIdx]! && indHighNow < indHighPrev) {
    return 'bearish';
  }
  if (indLowNow != null && indLowPrev != null && prices[priceLowIdx]! < prices[priorLowIdx]! && indLowNow > indLowPrev) {
    return 'bullish';
  }
  return 'none';
}

export const evaluateRsiDivergenceEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const divergence = detectDivergence(closes, rsiSeries, lookback);
  const rsiNow = rsiSeries[closes.length - 1];
  let bias: StrategyBias = divergence === 'bullish' ? 'bullish' : divergence === 'bearish' ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = divergence === 'bullish' ? 'buy' : divergence === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'rsi-divergence',
    context,
    config: { ...config, period, lookback },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 32 : 0) + (rsiNow != null ? Math.min(12, Math.abs(rsiNow - 50) / 4) : 0),
    reasons: [
      `RSI(${period}) divergence scan over ${lookback} bars`,
      divergence === 'bullish' ? 'Bullish divergence — price lower low, RSI higher low' : divergence === 'bearish' ? 'Bearish divergence — price higher high, RSI lower high' : 'No RSI divergence detected',
      decision === 'buy' ? 'Bullish RSI divergence reversal long' : decision === 'sell' ? 'Bearish RSI divergence reversal short' : 'Awaiting RSI divergence setup',
    ],
    metrics: {
      divergence,
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
    },
  });
};

export const evaluateMacdDivergenceEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 35));
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(3, parseNumber(config.signalPeriod, 9));
  const closes = candles.map((item) => item.close);
  const { histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const divergence = detectDivergence(closes, histogram, lookback);
  const histNow = histogram[closes.length - 1];
  let bias: StrategyBias = divergence === 'bullish' ? 'bullish' : divergence === 'bearish' ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = divergence === 'bullish' ? 'buy' : divergence === 'bearish' ? 'sell' : 'wait';

  return buildEvaluationResult({
    strategyId: 'macd-divergence',
    context,
    config: { ...config, lookback, fastPeriod, slowPeriod, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `MACD histogram divergence over ${lookback} bars`,
      divergence === 'bullish' ? 'Bullish MACD divergence — momentum exhaustion to upside' : divergence === 'bearish' ? 'Bearish MACD divergence — momentum exhaustion to downside' : 'No MACD divergence detected',
      decision === 'buy' ? 'Bullish MACD divergence reversal long' : decision === 'sell' ? 'Bearish MACD divergence reversal short' : 'Awaiting MACD divergence',
    ],
    metrics: {
      divergence,
      histogram: histNow != null ? Number(histNow.toFixed(6)) : null,
    },
  });
};

export const evaluateExhaustionReversalEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(20, parseNumber(config.trendPeriod, 50));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const extensionBars = Math.max(5, parseNumber(config.extensionBars, 10));
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = candles.length - 1;
  const lastCandle = candles[last]!;
  const trendNow = trendEma[last];
  const rsiNow = rsiSeries[last];
  const startClose = closes[Math.max(0, last - extensionBars)]!;
  const extensionPct = startClose !== 0 ? ((lastCandle.close - startClose) / startClose) * 100 : 0;
  const range = Math.max(lastCandle.high - lastCandle.low, 0.00001);
  const upperWick = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
  const lowerWick = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (trendNow != null && rsiNow != null) {
    const extendedUp = extensionPct >= 0.25 && lastCandle.close > trendNow && rsiNow >= 70 && upperWick / range >= 0.35;
    const extendedDown = extensionPct <= -0.25 && lastCandle.close < trendNow && rsiNow <= 30 && lowerWick / range >= 0.35;
    if (extendedUp && lastCandle.close < lastCandle.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (extendedDown && lastCandle.close > lastCandle.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (extendedUp) {
      bias = 'bearish';
    } else if (extendedDown) {
      bias = 'bullish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'exhaustion-reversal',
    context,
    config: { ...config, trendPeriod, rsiPeriod, extensionBars },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (rsiNow != null ? Math.min(14, Math.abs(rsiNow - 50) / 3) : 0),
    reasons: [
      `Exhaustion reversal — ${extensionBars}-bar extension + RSI(${rsiPeriod}) extreme rejection`,
      rsiNow != null ? `Extension ${extensionPct.toFixed(2)}% · RSI ${rsiNow.toFixed(1)}` : 'Extension metrics unavailable',
      decision === 'buy' ? 'Downside exhaustion with bullish rejection — reversal long' : decision === 'sell' ? 'Upside exhaustion with bearish rejection — reversal short' : 'No exhaustion reversal signal',
    ],
    metrics: {
      extensionPct: Number(extensionPct.toFixed(3)),
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
    },
  });
};

export const evaluateClimacticReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const climaxRatio = parseNumber(config.climaxRatio, 2.5);
  const trendBars = Math.max(8, parseNumber(config.trendBars, 15));
  const last = candles[candles.length - 1]!;
  const baseline = candles.slice(-lookback - 1, -1);
  const trendWindow = candles.slice(-trendBars - 1, -1);
  const avgRange = averageCandleRange(baseline);
  const lastRange = last.high - last.low;
  const climax = avgRange > 0 && lastRange >= avgRange * climaxRatio;
  const trendUp = trendWindow.length > 0 && trendWindow[0]!.close < last.open;
  const trendDown = trendWindow.length > 0 && trendWindow[0]!.close > last.open;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (climax && trendUp && last.close < last.open && last.close <= last.low + lastRange * 0.35) {
    bias = 'bearish';
    decision = 'sell';
  } else if (climax && trendDown && last.close > last.open && last.close >= last.high - lastRange * 0.35) {
    bias = 'bullish';
    decision = 'buy';
  } else if (climax && trendUp) {
    bias = 'bearish';
  } else if (climax && trendDown) {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'climactic-reversal',
    context,
    config: { ...config, lookback, climaxRatio, trendBars },
    candles,
    decision,
    bias,
    confidence: 35 + (climax ? 14 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `Climactic reversal — ${climaxRatio}× range spike after ${trendBars}-bar trend`,
      climax ? `Climax bar ${(lastRange / Math.max(avgRange, 0.00001)).toFixed(2)}× average range` : 'No climactic range expansion',
      decision === 'buy' ? 'Selling climax with bullish close — reversal long' : decision === 'sell' ? 'Buying climax with bearish close — reversal short' : 'No climactic reversal confirmation',
    ],
    metrics: {
      climaxRatioActual: avgRange > 0 ? Number((lastRange / avgRange).toFixed(2)) : null,
    },
  });
};

export const evaluateTrendlineReversalEngine: StrategyEngine = (candles, config, context) => {
  const minValidity = parseNumber(config.minValidity, 0.42);
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeTrendlines(reconstructed);
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  const line = analysis.trendlines.find((item) => item.validityScore >= minValidity) ?? analysis.trendlines[0] ?? null;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let projected: number | null = null;

  if (line) {
    const span = Math.max(1, line.endCandleIndex - line.startCandleIndex);
    const slope = (line.endPrice - line.startPrice) / span;
    projected = line.startPrice + slope * (last.candleIndex - line.startCandleIndex);
    const nearLine = Math.abs(last.close - projected) <= buffer;
    const rejectionUp = nearLine && last.low <= projected - buffer && last.close > projected && last.close > last.open;
    const rejectionDown = nearLine && last.high >= projected + buffer && last.close < projected && last.close < last.open;
    if (line.direction === 'bearish' && rejectionUp) {
      bias = 'bullish';
      decision = 'buy';
    } else if (line.direction === 'bullish' && rejectionDown) {
      bias = 'bearish';
      decision = 'sell';
    } else if (line.direction === 'bearish') {
      bias = 'bullish';
    } else if (line.direction === 'bullish') {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'trendline-reversal',
    context,
    config: { ...config, minValidity, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (line ? Math.round(line.validityScore * 18) : 0),
    reasons: [
      'Trendline reversal — rejection at validated trendline boundary',
      line ? `${line.direction} trendline validity ${(line.validityScore * 100).toFixed(0)}%` : 'No qualifying trendline',
      projected != null ? `Projected line ${projected.toFixed(5)} vs close ${last.close.toFixed(5)}` : 'Projection unavailable',
      decision === 'buy' ? 'Bullish rejection at descending trendline — reversal long' : decision === 'sell' ? 'Bearish rejection at ascending trendline — reversal short' : 'No trendline rejection',
    ],
    metrics: {
      projectedLine: projected != null ? Number(projected.toFixed(5)) : null,
      validity: line ? Number((line.validityScore * 100).toFixed(1)) : null,
    },
  });
};

export const evaluateFibonacciReversalEngine: StrategyEngine = (candles, config, context) => {
  const swingLookback = Math.max(30, parseNumber(config.swingLookback, 55));
  const extensionLevel = parseNumber(config.extensionLevel, 0.786);
  const window = candles.slice(-swingLookback);
  const high = Math.max(...window.map((item) => item.high));
  const low = Math.min(...window.map((item) => item.low));
  const range = Math.max(high - low, 0.00001);
  const last = candles[candles.length - 1]!;
  const mid = (high + low) / 2;
  const bullishLeg = window.findIndex((item) => item.low === low) < window.findIndex((item) => item.high === high);
  const extUp = high + range * (extensionLevel - 0.618);
  const extDown = low - range * (extensionLevel - 0.618);
  let bias: StrategyBias = last.close > mid ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';

  if (bullishLeg && last.high >= high + range * 0.05 && last.close < high && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (!bullishLeg && last.low <= low - range * 0.05 && last.close > low && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close >= extUp && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close <= extDown && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  }

  return buildEvaluationResult({
    strategyId: 'fibonacci-reversal',
    context,
    config: { ...config, swingLookback, extensionLevel },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `Fibonacci reversal — extension/rejection beyond ${(extensionLevel * 100).toFixed(1)}% zone`,
      `Swing range ${low.toFixed(5)} – ${high.toFixed(5)}`,
      decision === 'buy' ? 'Fibonacci extension rejection — reversal long' : decision === 'sell' ? 'Fibonacci extension rejection — reversal short' : 'No Fibonacci reversal at extension zone',
    ],
    metrics: {
      swingHigh: Number(high.toFixed(5)),
      swingLow: Number(low.toFixed(5)),
      extensionUp: Number(extUp.toFixed(5)),
      extensionDown: Number(extDown.toFixed(5)),
    },
  });
};

export const evaluateHarmonicReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(35, parseNumber(config.lookback, 65));
  const tolerancePct = parseNumber(config.tolerancePct, 0.1);
  const window = candles.slice(-lookback);
  const points = [
    window[Math.floor(window.length * 0.12)],
    window[Math.floor(window.length * 0.35)],
    window[Math.floor(window.length * 0.58)],
    window[Math.floor(window.length * 0.82)],
  ].filter(Boolean) as StrategyPriceCandle[];
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (points.length === 4) {
    const [x, a, b, c] = points;
    const xa = Math.abs(a.close - x.close);
    const ab = Math.abs(b.close - a.close);
    const bc = Math.abs(c.close - b.close);
    const bullishBat = x.close > a.close && b.close > a.close && c.close > b.close && ab / Math.max(xa, 0.00001) >= 0.38 - tolerancePct && bc / Math.max(ab, 0.00001) >= 0.38;
    const bearishBat = x.close < a.close && b.close < a.close && c.close < b.close && ab / Math.max(xa, 0.00001) >= 0.38 - tolerancePct && bc / Math.max(ab, 0.00001) >= 0.38;
    if (bullishBat && last.close > c.close && last.close > last.open) {
      bias = 'bullish';
      pattern = 'bullish harmonic reversal';
      decision = 'buy';
    } else if (bearishBat && last.close < c.close && last.close < last.open) {
      bias = 'bearish';
      pattern = 'bearish harmonic reversal';
      decision = 'sell';
    } else if (bullishBat) {
      bias = 'bullish';
      pattern = 'bullish harmonic forming';
    } else if (bearishBat) {
      bias = 'bearish';
      pattern = 'bearish harmonic forming';
    }
  }

  return buildEvaluationResult({
    strategyId: 'harmonic-reversal',
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : pattern !== 'none' ? 10 : 0),
    reasons: [
      `Harmonic reversal — XABCD ratio completion over ${lookback} bars`,
      pattern !== 'none' ? pattern : 'No harmonic reversal pattern detected',
      decision === 'buy' ? 'Bullish harmonic completion — reversal long' : decision === 'sell' ? 'Bearish harmonic completion — reversal short' : 'Awaiting harmonic reversal completion',
    ],
    metrics: { pattern },
  });
};

export const evaluateSupplyDemandReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(25, parseNumber(config.lookback, 50));
  const minQuality = parseNumber(config.minQuality, 0.42);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const analysis = analyzeOrderBlocks(reconstructed);
  const blocks = analysis.orderBlocks.filter((block) => block.qualityScore >= minQuality);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const demand = blocks.filter((block) => block.blockType === 'bullish').sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;
  const supply = blocks.filter((block) => block.blockType === 'bearish').sort((a, b) => b.qualityScore - a.qualityScore)[0] ?? null;

  if (demand && last.low <= demand.zoneHigh && last.close > demand.zoneHigh && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (supply && last.high >= supply.zoneLow && last.close < supply.zoneLow && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (demand) {
    bias = 'bullish';
  } else if (supply) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'supply-demand-reversal',
    context,
    config: { ...config, lookback, minQuality },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (demand || supply ? 10 : 0),
    reasons: [
      'Supply/demand reversal — order block rejection with close-back confirmation',
      decision === 'buy'
        ? `Demand block rejection ${demand?.zoneLow.toFixed(5)} – ${demand?.zoneHigh.toFixed(5)}`
        : decision === 'sell'
          ? `Supply block rejection ${supply?.zoneLow.toFixed(5)} – ${supply?.zoneHigh.toFixed(5)}`
          : 'No supply/demand reversal rejection on latest bar',
    ],
    metrics: {
      demandZone: demand ? Number(demand.zoneHigh.toFixed(5)) : null,
      supplyZone: supply ? Number(supply.zoneLow.toFixed(5)) : null,
    },
  });
};

export const evaluateVReversalEngine: StrategyEngine = (candles, config, context) => {
  const legBars = Math.max(4, parseNumber(config.legBars, 8));
  const minLegPct = parseNumber(config.minLegPct, 0.2);
  const last = candles.length - 1;
  const lastCandle = candles[last]!;
  const firstLeg = candles.slice(last - legBars * 2, last - legBars);
  const secondLeg = candles.slice(last - legBars, last + 1);
  const firstMove = firstLeg.length > 0 && secondLeg.length > 0
    ? ((firstLeg.at(-1)!.close - firstLeg[0]!.close) / firstLeg[0]!.close) * 100
    : 0;
  const secondMove = firstLeg.length > 0 && secondLeg.length > 0
    ? ((secondLeg.at(-1)!.close - secondLeg[0]!.close) / secondLeg[0]!.close) * 100
    : 0;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';

  if (firstMove <= -minLegPct && secondMove >= minLegPct && lastCandle.close > lastCandle.open) {
    bias = 'bullish';
    pattern = 'V-bottom';
    decision = 'buy';
  } else if (firstMove >= minLegPct && secondMove <= -minLegPct && lastCandle.close < lastCandle.open) {
    bias = 'bearish';
    pattern = 'V-top';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'v-reversal',
    context,
    config: { ...config, legBars, minLegPct },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `V-reversal — ${legBars}-bar leg symmetry with ≥ ${minLegPct}% move each side`,
      pattern !== 'none' ? `${pattern} detected (${firstMove.toFixed(2)}% → ${secondMove.toFixed(2)}%)` : 'No V-reversal structure on latest bars',
      decision === 'buy' ? 'V-bottom reversal — sharp recovery long' : decision === 'sell' ? 'V-top reversal — sharp rejection short' : 'Awaiting V-reversal pattern',
    ],
    metrics: {
      pattern,
      firstLegPct: Number(firstMove.toFixed(3)),
      secondLegPct: Number(secondMove.toFixed(3)),
    },
  });
};

export const evaluateCountertrendTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(30, parseNumber(config.trendPeriod, 50));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const maxAdx = parseNumber(config.maxAdx, 24);
  const oversold = parseNumber(config.oversold, 32);
  const overbought = parseNumber(config.overbought, 68);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const last = closes.length - 1;
  const lastCandle = candles[last]!;
  const trendNow = trendEma[last];
  const rsiNow = rsiSeries[last];
  const adxNow = adxSeries[last];
  const weakTrend = adxNow != null && adxNow <= maxAdx;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (trendNow != null && rsiNow != null && weakTrend) {
    if (lastCandle.close < trendNow && rsiNow <= oversold && lastCandle.close > lastCandle.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (lastCandle.close > trendNow && rsiNow >= overbought && lastCandle.close < lastCandle.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (lastCandle.close < trendNow) {
      bias = 'bullish';
    } else if (lastCandle.close > trendNow) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'countertrend-trading',
    context,
    config: { ...config, trendPeriod, rsiPeriod, adxPeriod, maxAdx, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (weakTrend ? 10 : -6),
    reasons: [
      `Countertrend — fade EMA(${trendPeriod}) stretch when ADX ≤ ${maxAdx}`,
      rsiNow != null && adxNow != null ? `RSI ${rsiNow.toFixed(1)} · ADX ${adxNow.toFixed(1)}` : 'Indicators unavailable',
      decision === 'buy' ? 'Countertrend long against weak downtrend stretch' : decision === 'sell' ? 'Countertrend short against weak uptrend stretch' : weakTrend ? 'Weak trend but no countertrend trigger' : 'Trend too strong for countertrend fade',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
      trendEma: trendNow != null ? Number(trendNow.toFixed(5)) : null,
    },
  });
};
