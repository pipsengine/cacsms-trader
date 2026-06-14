import { analyzeChannels } from '@/lib/channel-detection-engine';

import type { StrategyPriceCandle } from './strategy-candle-loader';
import { strategyCandlesToReconstructed } from './strategy-candle-adapter';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, bollinger, ema, rsi, vwap } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rollingZScore(closes: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  for (let index = period - 1; index < closes.length; index += 1) {
    const window = closes.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    series[index] = stdDev === 0 ? 0 : (closes[index]! - mean) / stdDev;
  }
  return series;
}

export const evaluateRsiOverboughtOversoldEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 14));
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
    if (value <= oversold) bias = 'bullish';
    else if (value >= overbought) bias = 'bearish';
    else if (value >= 55) bias = 'bullish';
    else if (value <= 45) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'rsi-overbought-oversold',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 32 : 0) + (value != null ? Math.min(16, Math.abs(value - 50) / 3) : 0),
    reasons: [
      `RSI(${period}) overbought/oversold mean reversion (${oversold}/${overbought})`,
      value != null ? `Current RSI ${value.toFixed(1)}` : 'RSI unavailable',
      decision === 'buy' ? 'Bullish snap-back from oversold extreme' : decision === 'sell' ? 'Bearish fade from overbought extreme' : 'No RSI extreme rejection',
    ],
    metrics: { rsi: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateVwapReversionEngine: StrategyEngine = (candles, config, context) => {
  const deviationPct = parseNumber(config.deviationPct, 0.15);
  const vwapSeries = vwap(candles);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const vwapNow = vwapSeries[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let deviation = 0;

  if (vwapNow != null && vwapNow !== 0) {
    deviation = ((close - vwapNow) / vwapNow) * 100;
    if (deviation <= -deviationPct) {
      bias = 'bullish';
      decision = 'buy';
    } else if (deviation >= deviationPct) {
      bias = 'bearish';
      decision = 'sell';
    } else if (deviation > 0) {
      bias = 'bearish';
    } else if (deviation < 0) {
      bias = 'bullish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'vwap-reversion',
    context,
    config: { ...config, deviationPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + Math.min(14, Math.abs(deviation) * 4),
    reasons: [
      `VWAP reversion — fade when price deviates ≥ ${deviationPct}% from session VWAP`,
      vwapNow != null ? `Close ${close.toFixed(5)} vs VWAP ${vwapNow.toFixed(5)} (${deviation.toFixed(2)}%)` : 'VWAP unavailable',
      decision === 'buy' ? 'Price stretched below VWAP — reversion long' : decision === 'sell' ? 'Price stretched above VWAP — reversion short' : 'Price near VWAP fair value',
    ],
    metrics: {
      vwap: vwapNow != null ? Number(vwapNow.toFixed(5)) : null,
      deviationPct: Number(deviation.toFixed(3)),
    },
  });
};

export const evaluateStatisticalReversionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const zThreshold = parseNumber(config.zThreshold, 1.5);
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const maxAdx = parseNumber(config.maxAdx, 22);
  const closes = candles.map((item) => item.close);
  const zScores = rollingZScore(closes, lookback);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const last = closes.length - 1;
  const zNow = zScores[last];
  const adxNow = adxSeries[last];
  const ranging = adxNow != null && adxNow <= maxAdx;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (zNow != null && ranging) {
    if (zNow <= -zThreshold) {
      bias = 'bullish';
      decision = 'buy';
    } else if (zNow >= zThreshold) {
      bias = 'bearish';
      decision = 'sell';
    } else if (zNow < 0) {
      bias = 'bullish';
    } else if (zNow > 0) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'statistical-reversion',
    context,
    config: { ...config, lookback, zThreshold, adxPeriod, maxAdx },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 30 : 0) + (ranging ? 10 : -8) + (zNow != null ? Math.min(12, Math.abs(zNow) * 4) : 0),
    reasons: [
      `Statistical reversion — z-score(${lookback}) fade in low-trend regime ADX ≤ ${maxAdx}`,
      zNow != null ? `Z-score ${zNow.toFixed(2)} (threshold ±${zThreshold})` : 'Z-score unavailable',
      ranging ? `Ranging regime ADX ${adxNow!.toFixed(1)} — reversion favored` : 'Trending regime — statistical reversion suppressed',
      decision === 'buy' ? 'Negative z-score extreme — fade long to mean' : decision === 'sell' ? 'Positive z-score extreme — fade short to mean' : 'No statistical extreme in ranging regime',
    ],
    metrics: {
      zScore: zNow != null ? Number(zNow.toFixed(3)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
    },
  });
};

export const evaluateRangeReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const tolerancePct = parseNumber(config.tolerancePct, 0.06);
  const window = candles.slice(-lookback, -1);
  const last = candles[candles.length - 1]!;
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const tolerance = last.close * (tolerancePct / 100);
  const range = Math.max(rangeHigh - rangeLow, 0.00001);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  const atRangeLow = last.low <= rangeLow + tolerance;
  const atRangeHigh = last.high >= rangeHigh - tolerance;
  const bullishRejection = atRangeLow && lowerWick / range >= 0.25 && last.close > last.open;
  const bearishRejection = atRangeHigh && upperWick / range >= 0.25 && last.close < last.open;

  if (bullishRejection) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishRejection) {
    bias = 'bearish';
    decision = 'sell';
  } else if (atRangeLow) {
    bias = 'bullish';
  } else if (atRangeHigh) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'range-reversal',
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Range reversal — fade extremes of ${lookback}-bar box`,
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)}`,
      decision === 'buy' ? 'Bullish rejection at range low — fade long' : decision === 'sell' ? 'Bearish rejection at range high — fade short' : 'No range extreme rejection on latest bar',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{ label: decision === 'buy' ? 'range low fade' : 'range high fade', detail: 'Range boundary mean reversion', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluateChannelReversionEngine: StrategyEngine = (candles, config, context) => {
  const minQuality = parseNumber(config.minQuality, 0.34);
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const reconstructed = strategyCandlesToReconstructed(candles);
  const analysis = analyzeChannels(reconstructed);
  const channel = analysis.channels.find((item) => item.qualityScore >= minQuality) ?? analysis.channels[0] ?? null;
  const last = candles[candles.length - 1]!;
  const lastIndex = candles.length - 1;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let upperBound = null as number | null;
  let lowerBound = null as number | null;

  if (channel) {
    const span = Math.max(1, channel.endCandleIndex - channel.startCandleIndex);
    const upperSlope = (channel.upperEndPrice - channel.upperStartPrice) / span;
    const lowerSlope = (channel.lowerEndPrice - channel.lowerStartPrice) / span;
    upperBound = channel.upperStartPrice + upperSlope * (lastIndex - channel.startCandleIndex);
    lowerBound = channel.lowerStartPrice + lowerSlope * (lastIndex - channel.startCandleIndex);

    const atLower = last.low <= lowerBound + buffer && last.close > lowerBound;
    const atUpper = last.high >= upperBound - buffer && last.close < upperBound;
    if (atLower && last.close > last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (atUpper && last.close < last.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (last.close < (upperBound + lowerBound) / 2) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'channel-reversion',
    context,
    config: { ...config, minQuality, bufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (channel ? 12 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      channel
        ? `Channel reversion — ${channel.direction} channel quality ${(channel.qualityScore * 100).toFixed(0)}%`
        : 'No qualifying channel for reversion',
      upperBound != null && lowerBound != null
        ? `Projected bounds ${lowerBound.toFixed(5)} – ${upperBound.toFixed(5)}`
        : 'Channel bounds unavailable',
      decision === 'buy' ? 'Fade from channel support with bullish rejection' : decision === 'sell' ? 'Fade from channel resistance with bearish rejection' : 'Awaiting channel boundary fade',
    ],
    metrics: {
      channelDirection: channel?.direction ?? 'none',
      qualityScore: channel ? Number((channel.qualityScore * 100).toFixed(1)) : null,
      upperBound: upperBound != null ? Number(upperBound.toFixed(5)) : null,
      lowerBound: lowerBound != null ? Number(lowerBound.toFixed(5)) : null,
    },
  });
};

export const evaluateZScoreReversionEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(15, parseNumber(config.period, 30));
  const entryZ = parseNumber(config.entryZ, 2);
  const closes = candles.map((item) => item.close);
  const zScores = rollingZScore(closes, period);
  const last = closes.length - 1;
  const zNow = zScores[last];
  const zPrev = zScores[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (zNow != null) {
    if (zNow <= -entryZ) {
      bias = 'bullish';
      decision = 'buy';
    } else if (zNow >= entryZ) {
      bias = 'bearish';
      decision = 'sell';
    } else if (zPrev != null && zPrev <= -entryZ && zNow > zPrev) {
      bias = 'bullish';
      decision = 'buy';
    } else if (zPrev != null && zPrev >= entryZ && zNow < zPrev) {
      bias = 'bearish';
      decision = 'sell';
    } else if (zNow < 0) {
      bias = 'bullish';
    } else if (zNow > 0) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'z-score-reversion',
    context,
    config: { ...config, period, entryZ },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 30 : 0) + (zNow != null ? Math.min(14, Math.abs(zNow) * 5) : 0),
    reasons: [
      `Z-score reversion — fade when |z| ≥ ${entryZ} over ${period} bars`,
      zNow != null ? `Current z-score ${zNow.toFixed(2)}` : 'Z-score unavailable',
      decision === 'buy' ? 'Statistically cheap — mean reversion long' : decision === 'sell' ? 'Statistically rich — mean reversion short' : 'Z-score within normal band',
    ],
    metrics: { zScore: zNow != null ? Number(zNow.toFixed(3)) : null },
  });
};

export const evaluateDeviationReversionEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 21));
  const deviationPct = parseNumber(config.deviationPct, 0.2);
  const closes = candles.map((item) => item.close);
  const baseline = ema(closes, period);
  const last = closes.length - 1;
  const close = closes[last]!;
  const baseNow = baseline[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let deviation = 0;

  if (baseNow != null && baseNow !== 0) {
    deviation = ((close - baseNow) / baseNow) * 100;
    if (deviation <= -deviationPct) {
      bias = 'bullish';
      decision = 'buy';
    } else if (deviation >= deviationPct) {
      bias = 'bearish';
      decision = 'sell';
    } else if (deviation > 0) {
      bias = 'bearish';
    } else {
      bias = 'bullish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'deviation-reversion',
    context,
    config: { ...config, period, deviationPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + Math.min(14, Math.abs(deviation) * 3),
    reasons: [
      `Deviation reversion — fade when price deviates ≥ ${deviationPct}% from EMA(${period})`,
      baseNow != null ? `Close ${close.toFixed(5)} vs EMA ${baseNow.toFixed(5)} (${deviation.toFixed(2)}%)` : 'Baseline EMA unavailable',
      decision === 'buy' ? 'Price below EMA deviation band — snap-back long' : decision === 'sell' ? 'Price above EMA deviation band — snap-back short' : 'Price near EMA fair value',
    ],
    metrics: {
      ema: baseNow != null ? Number(baseNow.toFixed(5)) : null,
      deviationPct: Number(deviation.toFixed(3)),
    },
  });
};

export const evaluateReversionScalpingEngine: StrategyEngine = (candles, config, context) => {
  const bandPeriod = Math.max(10, parseNumber(config.bandPeriod, 14));
  const stdDev = parseNumber(config.stdDev, 1.8);
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 7));
  const oversold = parseNumber(config.oversold, 35);
  const overbought = parseNumber(config.overbought, 65);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, bandPeriod, stdDev);
  const rsiSeries = rsi(closes, rsiPeriod);
  const atrSeries = atr(candles, 10);
  const last = closes.length - 1;
  const close = closes[last]!;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const rsiNow = rsiSeries[last];
  const atrNow = atrSeries[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (lower != null && upper != null && rsiNow != null) {
    if (close <= lower && rsiNow <= oversold) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close >= upper && rsiNow >= overbought) {
      bias = 'bearish';
      decision = 'sell';
    } else if (rsiNow <= 45) {
      bias = 'bullish';
    } else if (rsiNow >= 55) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'reversion-scalping',
    context,
    config: { ...config, bandPeriod, stdDev, rsiPeriod, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 0) + (atrNow != null ? Math.min(10, atrNow * 10000) : 0),
    reasons: [
      `Reversion scalp — tight Bollinger(${bandPeriod}, ${stdDev}) + fast RSI(${rsiPeriod}) fade`,
      rsiNow != null ? `RSI ${rsiNow.toFixed(1)} at band extreme check` : 'RSI unavailable',
      decision === 'buy' ? 'Micro oversold band touch — scalp long fade' : decision === 'sell' ? 'Micro overbought band touch — scalp short fade' : 'No reversion scalp setup on latest bar',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
    },
  });
};
