import { analyzeChannels } from '@/lib/channel-detection-engine';
import { analyzeSupportResistance } from '@/lib/support-resistance-engine';
import { analyzeSwingPoints } from '@/lib/swing-point-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, crossover, ema, macd, rsi } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function swingHighLow(window: StrategyPriceCandle[]): { high: number; low: number; highIndex: number; lowIndex: number } {
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let highIndex = 0;
  let lowIndex = 0;
  window.forEach((candle, index) => {
    if (candle.high > high) {
      high = candle.high;
      highIndex = index;
    }
    if (candle.low < low) {
      low = candle.low;
      lowIndex = index;
    }
  });
  return { high, low, highIndex, lowIndex };
}

export const evaluateSwingPullbackStrategyEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(30, parseNumber(config.trendPeriod, 50));
  const pullbackPeriod = Math.max(10, parseNumber(config.pullbackPeriod, 21));
  const tolerancePct = parseNumber(config.tolerancePct, 0.2);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const pullbackEma = ema(closes, pullbackPeriod);
  const last = closes.length - 1;
  const close = closes[last]!;
  const trend = trendEma[last];
  const pullback = pullbackEma[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (trend != null && pullback != null) {
    bias = close > trend ? 'bullish' : close < trend ? 'bearish' : 'neutral';
    const distancePct = Math.abs((close - pullback) / close) * 100;
    const touched = distancePct <= tolerancePct;
    if (bias === 'bullish' && touched && close >= pullback) decision = 'buy';
    if (bias === 'bearish' && touched && close <= pullback) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'swing-pullback-strategy',
    context,
    config: { ...config, trendPeriod, pullbackPeriod, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 40 + (decision !== 'wait' ? 30 : 8),
    reasons: [
      `Swing pullback — EMA(${trendPeriod}) trend + EMA(${pullbackPeriod}) value zone on ${context.timeframe}`,
      decision === 'buy' ? 'Bullish swing pullback reclaimed — continuation long' : decision === 'sell' ? 'Bearish swing pullback rejection — continuation short' : 'No confirmed swing pullback in trend direction',
    ],
    metrics: {
      trendEma: trend != null ? Number(trend.toFixed(5)) : null,
      pullbackEma: pullback != null ? Number(pullback.toFixed(5)) : null,
    },
  });
};

export const evaluateFibonacciSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const swingLookback = Math.max(40, parseNumber(config.swingLookback, 60));
  const minRetracement = parseNumber(config.minRetracement, 0.382);
  const maxRetracement = parseNumber(config.maxRetracement, 0.618);
  const window = candles.slice(-swingLookback);
  const { high, low, highIndex, lowIndex } = swingHighLow(window);
  const range = Math.max(high - low, 0.00001);
  const bullishLeg = lowIndex < highIndex;
  const last = candles[candles.length - 1]!;
  const retrace = bullishLeg ? (high - last.close) / range : (last.close - low) / range;
  const fib50 = bullishLeg ? high - range * 0.5 : low + range * 0.5;
  const inPocket = retrace >= minRetracement && retrace <= maxRetracement;
  let bias: StrategyBias = bullishLeg ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';
  if (bullishLeg && inPocket && last.close >= fib50 && last.close > last.open) {
    decision = 'buy';
  } else if (!bullishLeg && inPocket && last.close <= fib50 && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'fibonacci-swing-trading',
    context,
    config: { ...config, swingLookback, minRetracement, maxRetracement },
    candles,
    decision,
    bias,
    confidence: 36 + (inPocket ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Fibonacci swing — ${swingLookback}-bar impulse with ${(retrace * 100).toFixed(1)}% retracement`,
      inPocket ? `Price in ${(minRetracement * 100).toFixed(0)}–${(maxRetracement * 100).toFixed(0)}% value pocket near ${fib50.toFixed(5)}` : 'Outside Fibonacci swing pocket',
      decision === 'buy' ? 'Bullish swing continuation from Fib zone' : decision === 'sell' ? 'Bearish swing continuation from Fib zone' : 'Awaiting Fibonacci swing confirmation',
    ],
    metrics: {
      retracePct: Number((retrace * 100).toFixed(1)),
      fib50: Number(fib50.toFixed(5)),
      swingHigh: Number(high.toFixed(5)),
      swingLow: Number(low.toFixed(5)),
    },
  });
};

export const evaluateSwingReversalStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(30, parseNumber(config.lookback, 50));
  const rsiPeriod = Math.max(10, parseNumber(config.rsiPeriod, 14));
  const window = candles.slice(-lookback, -1);
  const swingHigh = Math.max(...window.map((item) => item.high));
  const swingLow = Math.min(...window.map((item) => item.low));
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = candles[candles.length - 1]!;
  const rsiNow = rsiSeries[closes.length - 1];
  const brokeDown = last.close < swingLow && rsiNow != null && rsiNow < 35;
  const brokeUp = last.close > swingHigh && rsiNow != null && rsiNow > 65;
  const bullishReversal = rsiNow != null && rsiNow <= 32 && last.close > swingLow && last.close > last.open;
  const bearishReversal = rsiNow != null && rsiNow >= 68 && last.close < swingHigh && last.close < last.open;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishReversal) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishReversal) {
    bias = 'bearish';
    decision = 'sell';
  } else if (brokeUp) {
    bias = 'bullish';
  } else if (brokeDown) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'swing-reversal-strategy',
    context,
    config: { ...config, lookback, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Swing reversal — ${lookback}-bar structure + RSI(${rsiPeriod}) extreme`,
      rsiNow != null ? `RSI ${rsiNow.toFixed(1)} · swing high ${swingHigh.toFixed(5)} / low ${swingLow.toFixed(5)}` : 'RSI unavailable',
      decision === 'buy' ? 'Oversold swing reversal long' : decision === 'sell' ? 'Overbought swing reversal short' : 'No swing reversal trigger',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      swingHigh: Number(swingHigh.toFixed(5)),
      swingLow: Number(swingLow.toFixed(5)),
    },
  });
};

export const evaluateTrendSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(15, parseNumber(config.fastPeriod, 21));
  const slowPeriod = Math.max(fastPeriod + 10, parseNumber(config.slowPeriod, 55));
  const closes = candles.map((item) => item.close);
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const last = closes.length - 1;
  const fast = fastEma[last];
  const slow = slowEma[last];
  const fastPrev = fastEma[Math.max(0, last - 5)];
  const signal = crossover(fastEma[last - 1] ?? null, fast, slowEma[last - 1] ?? null, slow);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (fast != null && slow != null && fastPrev != null) {
    const rising = fast > fastPrev;
    const falling = fast < fastPrev;
    if (closes[last]! > fast && fast > slow && rising) {
      bias = 'bullish';
      decision = signal === 'bullish_cross' || closes[last]! > slow ? 'buy' : 'wait';
      if (decision === 'wait' && closes[last]! > slow && rising) decision = 'buy';
    } else if (closes[last]! < fast && fast < slow && falling) {
      bias = 'bearish';
      decision = signal === 'bearish_cross' || closes[last]! < slow ? 'sell' : 'wait';
      if (decision === 'wait' && closes[last]! < slow && falling) decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'trend-swing-trading',
    context,
    config: { ...config, fastPeriod, slowPeriod },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 28 : 8) + (signal !== 'none' ? 10 : 0),
    reasons: [
      `Trend swing — EMA(${fastPeriod}/${slowPeriod}) multi-day alignment on ${context.timeframe}`,
      decision === 'buy' ? 'Bullish swing trend stack — long' : decision === 'sell' ? 'Bearish swing trend stack — short' : 'Swing trend not aligned for entry',
    ],
    metrics: {
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      slowEma: slow != null ? Number(slow.toFixed(5)) : null,
    },
  });
};

export const evaluateChannelSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const minQuality = parseNumber(config.minQuality, 0.34);
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeChannels(reconstructed);
  const channel = analysis.channels.find((item) => item.qualityScore >= minQuality) ?? analysis.channels[0] ?? null;
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (channel) {
    const mid = (channel.upperEndPrice + channel.lowerEndPrice) / 2;
    if (channel.direction === 'ascending') {
      bias = 'bullish';
      if (last.close > mid && last.close > last.open) decision = 'buy';
    } else if (channel.direction === 'descending') {
      bias = 'bearish';
      if (last.close < mid && last.close < last.open) decision = 'sell';
    } else if (last.close > mid + buffer) {
      bias = 'bullish';
      decision = 'buy';
    } else if (last.close < mid - buffer) {
      bias = 'bearish';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'channel-swing-trading',
    context,
    config: { ...config, minQuality, bufferPct },
    candles,
    decision,
    bias,
    confidence: 34 + (channel ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      channel
        ? `Channel swing — ${channel.direction} channel quality ${(channel.qualityScore * 100).toFixed(0)}%`
        : 'No qualifying swing channel detected',
      decision === 'buy' ? 'Swing long from channel support / ascending structure' : decision === 'sell' ? 'Swing short from channel resistance / descending structure' : 'Awaiting channel swing entry',
    ],
    metrics: {
      channelDirection: channel?.direction ?? 'none',
      qualityScore: channel ? Number((channel.qualityScore * 100).toFixed(1)) : null,
    },
  });
};

export const evaluateHarmonicSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(40, parseNumber(config.lookback, 70));
  const tolerancePct = parseNumber(config.tolerancePct, 0.08);
  const window = candles.slice(-lookback);
  const points = [
    window[Math.floor(window.length * 0.15)],
    window[Math.floor(window.length * 0.4)],
    window[Math.floor(window.length * 0.65)],
    window[Math.floor(window.length * 0.85)],
  ].filter(Boolean) as StrategyPriceCandle[];
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'unconfirmed';
  if (points.length === 4) {
    const [a, b, c, d] = points;
    const ab = Math.abs(b.close - a.close);
    const bc = Math.abs(c.close - b.close);
    const cd = Math.abs(d.close - c.close);
    const bullishAbcd = a.close > b.close && c.close > b.close && d.close > c.close && bc / Math.max(ab, 0.00001) >= 0.382 - tolerancePct && bc / Math.max(ab, 0.00001) <= 0.886 + tolerancePct;
    const bearishAbcd = a.close < b.close && c.close < b.close && d.close < c.close && bc / Math.max(ab, 0.00001) >= 0.382 - tolerancePct && bc / Math.max(ab, 0.00001) <= 0.886 + tolerancePct;
    if (bullishAbcd && last.close > d.close) {
      bias = 'bullish';
      pattern = 'bullish ABCD';
      decision = 'buy';
    } else if (bearishAbcd && last.close < d.close) {
      bias = 'bearish';
      pattern = 'bearish ABCD';
      decision = 'sell';
    } else if (bullishAbcd) {
      bias = 'bullish';
      pattern = 'bullish ABCD forming';
    } else if (bearishAbcd) {
      bias = 'bearish';
      pattern = 'bearish ABCD forming';
    }
  }

  return buildEvaluationResult({
    strategyId: 'harmonic-swing-trading',
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 32 + (pattern.includes('ABCD') ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Harmonic swing — ABCD ratio scan over ${lookback} bars`,
      pattern !== 'unconfirmed' ? `${pattern} harmonic structure detected` : 'No qualifying harmonic swing pattern',
      decision === 'buy' ? 'Bullish harmonic completion — swing long' : decision === 'sell' ? 'Bearish harmonic completion — swing short' : 'Harmonic pattern incomplete',
    ],
    metrics: { pattern },
  });
};

export const evaluateElliottWaveSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(50, parseNumber(config.lookback, 80));
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-lookback));
  const swings = analyzeSwingPoints(reconstructed, { depths: [2, 4, 6], zigzagPercent: 0.1 });
  const recent = swings.swings.slice(-5);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let wavePhase = 'unclear';
  if (recent.length >= 4) {
    const highs = recent.filter((item) => item.swingKind === 'high');
    const lows = recent.filter((item) => item.swingKind === 'low');
    const higherHighs = highs.length >= 2 && highs.at(-1)!.priceLevel > highs.at(-2)!.priceLevel;
    const higherLows = lows.length >= 2 && lows.at(-1)!.priceLevel > lows.at(-2)!.priceLevel;
    const lowerHighs = highs.length >= 2 && highs.at(-1)!.priceLevel < highs.at(-2)!.priceLevel;
    const lowerLows = lows.length >= 2 && lows.at(-1)!.priceLevel < lows.at(-2)!.priceLevel;
    if (higherHighs && higherLows) {
      bias = 'bullish';
      wavePhase = 'impulse wave 3/5 proxy';
      if (last.close > last.open && last.close > (lows.at(-1)?.priceLevel ?? last.close)) decision = 'buy';
    } else if (lowerHighs && lowerLows) {
      bias = 'bearish';
      wavePhase = 'bearish impulse proxy';
      if (last.close < last.open && last.close < (highs.at(-1)?.priceLevel ?? last.close)) decision = 'sell';
    } else if (higherLows && !higherHighs) {
      bias = 'bullish';
      wavePhase = 'corrective wave C completion proxy';
    } else if (lowerHighs && !lowerLows) {
      bias = 'bearish';
      wavePhase = 'corrective wave C completion proxy';
    }
  }

  return buildEvaluationResult({
    strategyId: 'elliott-wave-swing-trading',
    context,
    config: { ...config, lookback },
    candles,
    decision,
    bias,
    confidence: 30 + (recent.length >= 4 ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Elliott wave swing — swing-point hierarchy over ${lookback} bars`,
      wavePhase !== 'unclear' ? `Wave phase: ${wavePhase}` : 'Insufficient swing structure for wave labeling',
      decision === 'buy' ? 'Bullish impulse swing entry' : decision === 'sell' ? 'Bearish impulse swing entry' : 'Awaiting Elliott swing trigger',
    ],
    metrics: {
      swingCount: recent.length,
      wavePhase,
    },
  });
};

export const evaluateMacdSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(20, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(5, parseNumber(config.signalPeriod, 9));
  const closes = candles.map((item) => item.close);
  const { macd: macdLine, signal, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = closes.length - 1;
  const cross = crossover(macdLine[last - 1], macdLine[last], signal[last - 1], signal[last]);
  const hist = histogram[last];
  const histPrev = histogram[last - 1];
  let bias: StrategyBias = hist != null && hist > 0 ? 'bullish' : hist != null && hist < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (cross === 'bullish_cross' || (hist != null && histPrev != null && hist > 0 && hist > histPrev && bias === 'bullish')) {
    decision = 'buy';
  } else if (cross === 'bearish_cross' || (hist != null && histPrev != null && hist < 0 && hist < histPrev && bias === 'bearish')) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'macd-swing-trading',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 38 + (cross !== 'none' ? 22 : 0) + (decision !== 'wait' ? 20 : 0),
    reasons: [
      `MACD swing — MACD(${fastPeriod},${slowPeriod},${signalPeriod}) on ${context.timeframe}`,
      cross !== 'none' ? `${cross.replace('_', ' ')} detected` : hist != null && histPrev != null && Math.abs(hist) > Math.abs(histPrev) ? 'Histogram expansion in trend direction' : 'No MACD swing signal',
      decision === 'buy' ? 'Bullish MACD swing long' : decision === 'sell' ? 'Bearish MACD swing short' : 'MACD neutral for swing entry',
    ],
    metrics: {
      macd: macdLine[last] != null ? Number(macdLine[last]!.toFixed(6)) : null,
      histogram: hist != null ? Number(hist.toFixed(6)) : null,
    },
  });
};

export const evaluateRsiSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 14));
  const oversold = parseNumber(config.oversold, 30);
  const overbought = parseNumber(config.overbought, 70);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const last = closes.length - 1;
  const value = rsiSeries[last];
  const prev = rsiSeries[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (value != null) {
    if (value >= 55) bias = 'bullish';
    else if (value <= 45) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold + 2) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought - 2) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'rsi-swing-trading',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 28 : 0) + (value != null ? Math.min(16, Math.abs(value - 50) / 2) : 0),
    reasons: [
      `RSI swing — RSI(${period}) multi-day mean reversion / momentum (${oversold}/${overbought})`,
      value != null ? `RSI ${value.toFixed(1)}` : 'RSI unavailable',
      decision === 'buy' ? 'Swing long from oversold RSI bounce' : decision === 'sell' ? 'Swing short from overbought RSI fade' : 'RSI mid-zone — wait',
    ],
    metrics: { rsi: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateSupportAndResistanceSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const zoneLookback = Math.max(40, parseNumber(config.zoneLookback, 80));
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
    strategyId: 'support-and-resistance-swing-trading',
    context,
    config: { ...config, zoneLookback, minStrength, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 4) + Math.min(12, zones.length * 2),
    reasons: [
      `S/R swing — ${zones.length} qualified zones from ${zoneLookback}-bar lookback`,
      decision === 'buy'
        ? `Bounce from support zone ${support?.zoneLow.toFixed(5)} – ${support?.zoneHigh.toFixed(5)}`
        : decision === 'sell'
          ? `Rejection from resistance zone ${resistance?.zoneLow.toFixed(5)} – ${resistance?.zoneHigh.toFixed(5)}`
          : 'No S/R swing rejection on latest bar',
    ],
    metrics: {
      zoneCount: zones.length,
      supportZone: support ? Number(support.zoneHigh.toFixed(5)) : null,
      resistanceZone: resistance ? Number(resistance.zoneLow.toFixed(5)) : null,
    },
  });
};

export const evaluateCandlestickSwingTradingEngine: StrategyEngine = (candles, config, context) => {
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
    if (bullishEngulf || morningStar || bullishPin) {
      bias = 'bullish';
      pattern = bullishEngulf ? 'bullish engulfing' : morningStar ? 'morning star' : 'bullish pin';
      decision = 'buy';
    } else if (bearishEngulf || eveningStar || bearishPin) {
      bias = 'bearish';
      pattern = bearishEngulf ? 'bearish engulfing' : eveningStar ? 'evening star' : 'bearish pin';
      decision = 'sell';
    }
  }

  return buildEvaluationResult({
    strategyId: 'candlestick-swing-trading',
    context,
    config: { ...config, wickRatio },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0),
    reasons: [
      'Candlestick swing — multi-bar reversal / continuation patterns',
      pattern !== 'none' ? `Pattern: ${pattern}` : 'No qualifying swing candlestick pattern on latest bars',
      decision === 'buy' ? 'Bullish candlestick swing long' : decision === 'sell' ? 'Bearish candlestick swing short' : 'Awaiting candlestick setup',
    ],
    metrics: { pattern },
  });
};

export const evaluateWeeklySwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(60, parseNumber(config.lookback, 100));
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const priorWindow = candles.slice(-lookback - 1, -1);
  const rangeHigh = priorWindow.length ? Math.max(...priorWindow.map((item) => item.high)) : 0;
  const rangeLow = priorWindow.length ? Math.min(...priorWindow.map((item) => item.low)) : 0;
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > rangeHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < rangeLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > rangeHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < rangeLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'weekly-swing-trading',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 40 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Weekly swing — ${priorWindow.length}-bar weekly proxy breakout on ${context.timeframe}`,
      `Range high ${rangeHigh.toFixed(5)} / low ${rangeLow.toFixed(5)}`,
      decision === 'buy' ? 'Break above weekly swing high' : decision === 'sell' ? 'Break below weekly swing low' : 'Inside weekly swing range',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};

export const evaluatePositionSwingTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(30, parseNumber(config.fastPeriod, 50));
  const slowPeriod = Math.max(fastPeriod + 20, parseNumber(config.slowPeriod, 100));
  const effectiveSlow = Math.min(slowPeriod, Math.max(fastPeriod + 10, candles.length - 5));
  const adxPeriod = Math.max(10, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 20);
  const closes = candles.map((item) => item.close);
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, effectiveSlow);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const last = closes.length - 1;
  const fast = fastEma[last];
  const slow = slowEma[last];
  const adxNow = adxSeries[last];
  const strong = adxNow != null && adxNow >= adxThreshold;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (fast != null && slow != null && closes[last]! > fast && fast > slow && strong) {
    bias = 'bullish';
    decision = 'buy';
  } else if (fast != null && slow != null && closes[last]! < fast && fast < slow && strong) {
    bias = 'bearish';
    decision = 'sell';
  } else if (fast != null && slow != null) {
    bias = fast > slow ? 'bullish' : 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'position-swing-trading',
    context,
    config: { ...config, fastPeriod, slowPeriod: effectiveSlow, adxPeriod, adxThreshold },
    candles,
    decision,
    bias,
    confidence: 38 + (strong ? 12 : 0) + (decision !== 'wait' ? 28 : 6),
    reasons: [
      `Position swing — EMA(${fastPeriod}/${effectiveSlow}) position-style filter + ADX(${adxPeriod})`,
      strong ? `Directional regime ADX ${adxNow!.toFixed(1)}` : 'Weak trend — position swing entries muted',
      decision === 'buy' ? 'Long position swing in bullish EMA stack' : decision === 'sell' ? 'Short position swing in bearish EMA stack' : 'No position swing alignment',
    ],
    metrics: {
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      slowEma: slow != null ? Number(slow.toFixed(5)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
    },
  });
};
