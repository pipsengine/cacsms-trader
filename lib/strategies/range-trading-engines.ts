import { analyzeChannels } from '@/lib/channel-detection-engine';
import { analyzeSupportResistance } from '@/lib/support-resistance-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, bollinger, rsi, stochastic, vwap } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rangeMetrics(
  candles: StrategyPriceCandle[],
  lookback: number,
): { rangeHigh: number; rangeLow: number; rangeSize: number; positionPct: number; last: StrategyPriceCandle } {
  const window = candles.slice(-lookback, -1);
  const last = candles[candles.length - 1]!;
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const positionPct = ((last.close - rangeLow) / rangeSize) * 100;
  return { rangeHigh, rangeLow, rangeSize, positionPct, last };
}

export const evaluateHorizontalRangeTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const edgePct = parseNumber(config.edgePct, 15);
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const { rangeHigh, rangeLow, positionPct, last } = rangeMetrics(candles, lookback);
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (last.close > rangeHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < rangeLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct < 50) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'horizontal-range-trading',
    context,
    config: { ...config, lookback, edgePct, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Horizontal range — ${lookback}-bar box fade/break model`,
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)} · price at ${positionPct.toFixed(0)}%`,
      decision === 'buy'
        ? last.close > rangeHigh + buffer ? 'Range breakout long' : 'Fade from lower range edge'
        : decision === 'sell'
          ? last.close < rangeLow - buffer ? 'Range breakdown short' : 'Fade from upper range edge'
          : 'Mid-range — no horizontal range entry',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateBollingerRangeStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const maxBandwidth = parseNumber(config.maxBandwidth, 2.5);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const last = closes.length - 1;
  const close = closes[last]!;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const middle = bands.middle[last];
  const bandwidth = bands.bandwidth[last];
  const ranging = bandwidth != null && bandwidth <= maxBandwidth;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (ranging && upper != null && lower != null && middle != null) {
    if (close <= lower && close >= lower * 0.9995) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close >= upper && close <= upper * 1.0005) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close < middle) {
      bias = 'bullish';
    } else if (close > middle) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-range-strategy',
    context,
    config: { ...config, period, stdDev, maxBandwidth },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0) + (ranging ? 12 : -8),
    reasons: [
      `Bollinger range — trade inside compressed bands (bandwidth ≤ ${maxBandwidth}%)`,
      bandwidth != null ? `Bandwidth ${bandwidth.toFixed(2)}% (${ranging ? 'ranging' : 'expanding'})` : 'Bandwidth unavailable',
      decision === 'buy' ? 'Lower band touch in range — fade long' : decision === 'sell' ? 'Upper band touch in range — fade short' : ranging ? 'Inside range — no band edge touch' : 'Volatility expanded — range model inactive',
    ],
    metrics: {
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
    },
  });
};

export const evaluateOscillatorRangeTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 35));
  const kPeriod = Math.max(5, parseNumber(config.kPeriod, 14));
  const dPeriod = Math.max(2, parseNumber(config.dPeriod, 3));
  const oversold = parseNumber(config.oversold, 25);
  const overbought = parseNumber(config.overbought, 75);
  const { rangeHigh, rangeLow, positionPct, last } = rangeMetrics(candles, lookback);
  const { k, d } = stochastic(candles, kPeriod, dPeriod);
  const lastIndex = candles.length - 1;
  const kNow = k[lastIndex];
  const dNow = d[lastIndex];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (kNow != null && dNow != null) {
    const inRange = last.close <= rangeHigh && last.close >= rangeLow;
    if (inRange && kNow <= oversold && kNow >= dNow) {
      bias = 'bullish';
      decision = 'buy';
    } else if (inRange && kNow >= overbought && kNow <= dNow) {
      bias = 'bearish';
      decision = 'sell';
    } else if (positionPct < 45) {
      bias = 'bullish';
    } else if (positionPct > 55) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'oscillator-range-trading',
    context,
    config: { ...config, lookback, kPeriod, dPeriod, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `Oscillator range — Stochastic(${kPeriod},${dPeriod}) fade inside ${lookback}-bar box`,
      kNow != null ? `%K ${kNow.toFixed(1)} / %D ${dNow?.toFixed(1) ?? 'n/a'} at ${positionPct.toFixed(0)}% of range` : 'Stochastic unavailable',
      decision === 'buy' ? 'Oversold oscillator at range low — range long' : decision === 'sell' ? 'Overbought oscillator at range high — range short' : 'No oscillator range edge signal',
    ],
    metrics: {
      k: kNow != null ? Number(kNow.toFixed(2)) : null,
      d: dNow != null ? Number(dNow.toFixed(2)) : null,
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateChannelTradingEngine: StrategyEngine = (candles, config, context) => {
  const minQuality = parseNumber(config.minQuality, 0.34);
  const edgePct = parseNumber(config.edgePct, 18);
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeChannels(reconstructed);
  const channel = analysis.channels.find((item) => item.qualityScore >= minQuality && item.direction === 'horizontal')
    ?? analysis.channels.find((item) => item.qualityScore >= minQuality)
    ?? analysis.channels[0]
    ?? null;
  const last = candles[candles.length - 1]!;
  const lastIndex = candles.length - 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let upperBound: number | null = null;
  let lowerBound: number | null = null;

  if (channel) {
    const span = Math.max(1, channel.endCandleIndex - channel.startCandleIndex);
    const upperSlope = (channel.upperEndPrice - channel.upperStartPrice) / span;
    const lowerSlope = (channel.lowerEndPrice - channel.lowerStartPrice) / span;
    upperBound = channel.upperStartPrice + upperSlope * (lastIndex - channel.startCandleIndex);
    lowerBound = channel.lowerStartPrice + lowerSlope * (lastIndex - channel.startCandleIndex);
    const channelSize = Math.max(upperBound - lowerBound, 0.00001);
    const positionPct = ((last.close - lowerBound) / channelSize) * 100;
    const buffer = last.close * (bufferPct / 100);

    if (last.close > upperBound + buffer) {
      bias = 'bullish';
      decision = 'buy';
    } else if (last.close < lowerBound - buffer) {
      bias = 'bearish';
      decision = 'sell';
    } else if (positionPct <= edgePct && last.close >= last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (positionPct >= 100 - edgePct && last.close <= last.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (positionPct < 50) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'channel-trading',
    context,
    config: { ...config, minQuality, edgePct, bufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (channel ? 12 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      channel
        ? `Channel range — ${channel.direction} channel quality ${(channel.qualityScore * 100).toFixed(0)}%`
        : 'No qualifying channel for range trading',
      upperBound != null && lowerBound != null
        ? `Channel bounds ${lowerBound.toFixed(5)} – ${upperBound.toFixed(5)}`
        : 'Channel bounds unavailable',
      decision === 'buy' ? 'Channel support fade / upside break' : decision === 'sell' ? 'Channel resistance fade / downside break' : 'Mid-channel — no range entry',
    ],
    metrics: {
      channelDirection: channel?.direction ?? 'none',
      upperBound: upperBound != null ? Number(upperBound.toFixed(5)) : null,
      lowerBound: lowerBound != null ? Number(lowerBound.toFixed(5)) : null,
    },
  });
};

export const evaluateSupportAndResistanceRangeEngine: StrategyEngine = (candles, config, context) => {
  const zoneLookback = Math.max(30, parseNumber(config.zoneLookback, 60));
  const minStrength = parseNumber(config.minStrength, 0.34);
  const edgePct = parseNumber(config.edgePct, 15);
  const reconstructed = strategyCandlesToReconstructed(candles.slice(-zoneLookback));
  const analysis = analyzeSupportResistance(reconstructed);
  const zones = analysis.zones.filter((zone) => zone.strengthScore >= minStrength);
  const support = zones
    .filter((zone) => zone.zoneType === 'support' || zone.zoneType === 'dynamic')
    .sort((a, b) => b.strengthScore - a.strengthScore)[0] ?? null;
  const resistance = zones
    .filter((zone) => zone.zoneType === 'resistance' || zone.zoneType === 'dynamic')
    .sort((a, b) => b.strengthScore - a.strengthScore)[0] ?? null;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (support && resistance) {
    const rangeSize = Math.max(resistance.zoneLow - support.zoneHigh, 0.00001);
    const positionPct = ((last.close - support.zoneHigh) / rangeSize) * 100;
    if (positionPct <= edgePct && last.close >= last.open && last.low <= support.zoneHigh) {
      bias = 'bullish';
      decision = 'buy';
    } else if (positionPct >= 100 - edgePct && last.close <= last.open && last.high >= resistance.zoneLow) {
      bias = 'bearish';
      decision = 'sell';
    } else if (positionPct < 50) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  } else if (support) {
    bias = 'bullish';
  } else if (resistance) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'support-and-resistance-range',
    context,
    config: { ...config, zoneLookback, minStrength, edgePct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0) + Math.min(10, zones.length),
    reasons: [
      `S/R range — fade between qualified support/resistance zones`,
      support && resistance
        ? `Range ${support.zoneHigh.toFixed(5)} – ${resistance.zoneLow.toFixed(5)}`
        : 'Insufficient paired S/R zones',
      decision === 'buy' ? 'Support zone fade in range — long' : decision === 'sell' ? 'Resistance zone fade in range — short' : 'No S/R range edge signal',
    ],
    metrics: {
      supportZone: support ? Number(support.zoneHigh.toFixed(5)) : null,
      resistanceZone: resistance ? Number(resistance.zoneLow.toFixed(5)) : null,
      zoneCount: zones.length,
    },
  });
};

export const evaluateAsianSessionRangeTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const edgePct = parseNumber(config.edgePct, 12);
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback);
  const asianEnd = Math.max(3, Math.floor(window.length / 3));
  const asianWindow = window.slice(0, asianEnd);
  const sessionHigh = Math.max(...asianWindow.map((item) => item.high));
  const sessionLow = Math.min(...asianWindow.map((item) => item.low));
  const rangeSize = Math.max(sessionHigh - sessionLow, 0.00001);
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - sessionLow) / rangeSize) * 100;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (last.close > sessionHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < sessionLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct < 50) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'asian-session-range-trading',
    context,
    config: { ...config, lookback, edgePct, bufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Asian session range — first third of ${lookback}-bar window as session box`,
      `Session ${sessionLow.toFixed(5)} – ${sessionHigh.toFixed(5)} · price at ${positionPct.toFixed(0)}%`,
      decision === 'buy' ? 'Asian range support fade / breakout long' : decision === 'sell' ? 'Asian range resistance fade / breakdown short' : 'Mid Asian range — no entry',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateMeanReversionRangeEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const maxAdx = parseNumber(config.maxAdx, 22);
  const edgePct = parseNumber(config.edgePct, 14);
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const { rangeHigh, rangeLow, positionPct, last } = rangeMetrics(candles, lookback);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const adxNow = adxSeries[closes.length - 1];
  const rsiNow = rsiSeries[closes.length - 1];
  const ranging = adxNow != null && adxNow <= maxAdx;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (ranging && rsiNow != null) {
    if (positionPct <= edgePct && rsiNow <= 42) {
      bias = 'bullish';
      decision = 'buy';
    } else if (positionPct >= 100 - edgePct && rsiNow >= 58) {
      bias = 'bearish';
      decision = 'sell';
    } else if (positionPct < 50) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'mean-reversion-range',
    context,
    config: { ...config, lookback, adxPeriod, maxAdx, edgePct, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (ranging ? 10 : -8),
    reasons: [
      `Mean reversion range — fade edges when ADX ≤ ${maxAdx}`,
      adxNow != null ? `ADX ${adxNow.toFixed(1)} · RSI ${rsiNow?.toFixed(1) ?? 'n/a'} at ${positionPct.toFixed(0)}% of range` : 'Regime filters unavailable',
      decision === 'buy' ? 'Range low fade with mean reversion long bias' : decision === 'sell' ? 'Range high fade with mean reversion short bias' : ranging ? 'Ranging but no edge trigger' : 'Trending regime — range fade suppressed',
    ],
    metrics: {
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      positionPct: Number(positionPct.toFixed(1)),
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};

export const evaluateVwapRangeTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const deviationPct = parseNumber(config.deviationPct, 0.12);
  const edgePct = parseNumber(config.edgePct, 15);
  const vwapSeries = vwap(candles);
  const { rangeHigh, rangeLow, last } = rangeMetrics(candles, lookback);
  const lastIndex = candles.length - 1;
  const vwapNow = vwapSeries[lastIndex];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let deviation = 0;

  if (vwapNow != null && vwapNow !== 0) {
    deviation = ((last.close - vwapNow) / vwapNow) * 100;
    const inBox = last.close <= rangeHigh && last.close >= rangeLow;
    if (inBox && deviation <= -deviationPct && last.close >= last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (inBox && deviation >= deviationPct && last.close <= last.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (inBox && last.close <= rangeLow + (rangeHigh - rangeLow) * (edgePct / 100)) {
      bias = 'bullish';
    } else if (inBox && last.close >= rangeHigh - (rangeHigh - rangeLow) * (edgePct / 100)) {
      bias = 'bearish';
    } else if (deviation < 0) {
      bias = 'bullish';
    } else if (deviation > 0) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'vwap-range-trading',
    context,
    config: { ...config, lookback, deviationPct, edgePct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0) + Math.min(12, Math.abs(deviation) * 4),
    reasons: [
      `VWAP range — oscillate inside ${lookback}-bar box around session VWAP`,
      vwapNow != null ? `Close ${last.close.toFixed(5)} vs VWAP ${vwapNow.toFixed(5)} (${deviation.toFixed(2)}%)` : 'VWAP unavailable',
      decision === 'buy' ? 'Below VWAP in range box — fade long' : decision === 'sell' ? 'Above VWAP in range box — fade short' : 'No VWAP range edge signal',
    ],
    metrics: {
      vwap: vwapNow != null ? Number(vwapNow.toFixed(5)) : null,
      deviationPct: Number(deviation.toFixed(3)),
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};
