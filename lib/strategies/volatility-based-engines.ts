import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, bollinger } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function rangeHighLow(candles: StrategyPriceCandle[]): { rangeHigh: number; rangeLow: number } {
  return {
    rangeHigh: Math.max(...candles.map((item) => item.high)),
    rangeLow: Math.min(...candles.map((item) => item.low)),
  };
}

export const evaluateAtrBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const breakMultiple = parseNumber(config.breakMultiple, 1.25);
  const atrSeries = atr(candles, atrPeriod);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const window = candles.slice(-lookback, -1);
  const { rangeHigh, rangeLow } = rangeHighLow(window);
  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(window);
  const lastRange = last.high - last.low;
  const expanding = lastRange >= atrNow * breakMultiple;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (expanding && last.close > rangeHigh && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (expanding && last.close < rangeLow && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > rangeHigh) {
    bias = 'bullish';
  } else if (last.close < rangeLow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'atr-breakout',
    context,
    config: { ...config, atrPeriod, lookback, breakMultiple },
    candles,
    decision,
    bias,
    confidence: 34 + (expanding ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `ATR breakout — ${lookback}-bar range break on ATR(${atrPeriod}) expansion bar`,
      expanding ? `Bar range ${lastRange.toFixed(5)} ≥ ${breakMultiple}× ATR ${atrNow.toFixed(5)}` : 'Latest bar not ATR-expanded',
      decision === 'buy' ? 'Bullish ATR breakout above range' : decision === 'sell' ? 'Bearish ATR breakout below range' : 'No ATR breakout entry',
    ],
    metrics: {
      atr: Number(atrNow.toFixed(5)),
      breakMultiple: Number((lastRange / Math.max(atrNow, 0.00001)).toFixed(2)),
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};

export const evaluateVolatilityCompressionEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const compressionRatio = parseNumber(config.compressionRatio, 0.7);
  const edgePct = parseNumber(config.edgePct, 14);
  const window = candles.slice(-lookback);
  const firstHalf = window.slice(0, Math.floor(window.length / 2));
  const secondHalf = window.slice(Math.floor(window.length / 2));
  const firstAvg = averageCandleRange(firstHalf);
  const secondAvg = averageCandleRange(secondHalf);
  const compressing = firstAvg > 0 && secondAvg / firstAvg <= compressionRatio;
  const { rangeHigh, rangeLow } = rangeHighLow(window);
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - rangeLow) / rangeSize) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (compressing && positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (compressing && positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (compressing && positionPct < 50) {
    bias = 'bullish';
  } else if (compressing && positionPct > 50) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-compression',
    context,
    config: { ...config, lookback, compressionRatio, edgePct },
    candles,
    decision,
    bias,
    confidence: 32 + (compressing ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Volatility compression — ${lookback}-bar range contraction model`,
      compressing ? `Range contracting ${(secondAvg / Math.max(firstAvg, 0.00001)).toFixed(2)}× vs prior half` : 'Volatility not compressing',
      `Price at ${positionPct.toFixed(0)}% of compressed range`,
      decision === 'buy' ? 'Fade lower edge inside compression box' : decision === 'sell' ? 'Fade upper edge inside compression box' : 'Await compression edge fade',
    ],
    metrics: {
      compressionRatio: Number((secondAvg / Math.max(firstAvg, 0.00001)).toFixed(2)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateVolatilityExpansionEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const baselineBars = Math.max(15, parseNumber(config.baselineBars, 30));
  const expansionMultiple = parseNumber(config.expansionMultiple, 1.35);
  const atrSeries = atr(candles, atrPeriod);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const atrNow = atrSeries[lastIndex] ?? 0;
  const atrBaseline = atrSeries[Math.max(0, lastIndex - baselineBars)] ?? atrNow;
  const lastRange = last.high - last.low;
  const atrExpanding = atrBaseline > 0 && atrNow / atrBaseline >= expansionMultiple;
  const barExpanding = atrNow > 0 && lastRange >= atrNow * expansionMultiple;
  const expanding = atrExpanding || barExpanding;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (expanding && last.close > last.open && last.close >= last.low + lastRange * 0.65) {
    bias = 'bullish';
    decision = 'buy';
  } else if (expanding && last.close < last.open && last.close <= last.high - lastRange * 0.65) {
    bias = 'bearish';
    decision = 'sell';
  } else if (expanding && last.close > last.open) {
    bias = 'bullish';
  } else if (expanding && last.close < last.open) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-expansion',
    context,
    config: { ...config, atrPeriod, baselineBars, expansionMultiple },
    candles,
    decision,
    bias,
    confidence: 32 + (expanding ? 16 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `Volatility expansion — ATR(${atrPeriod}) regime shift model`,
      expanding ? `ATR ratio ${(atrNow / Math.max(atrBaseline, 0.00001)).toFixed(2)}× · bar ${(lastRange / Math.max(atrNow, 0.00001)).toFixed(2)}× ATR` : 'No volatility expansion detected',
      decision === 'buy' ? 'Expansion long with bullish close location' : decision === 'sell' ? 'Expansion short with bearish close location' : 'Expansion without directional entry',
    ],
    metrics: {
      atrRatio: Number((atrNow / Math.max(atrBaseline, 0.00001)).toFixed(2)),
      barAtrMultiple: Number((lastRange / Math.max(atrNow, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateVolatilityBollingerSqueezeEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const squeezeThreshold = parseNumber(config.squeezeThreshold, 1.15);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const last = closes.length - 1;
  const bandwidth = bands.bandwidth[last];
  const priorBandwidth = bands.bandwidth[Math.max(0, last - period)] ?? bandwidth;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const close = closes[last]!;
  const squeezed = bandwidth != null && bandwidth <= squeezeThreshold;
  const releasing = priorBandwidth != null && bandwidth != null && bandwidth > priorBandwidth * 1.05;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (releasing && upper != null && close > upper) {
    bias = 'bullish';
    decision = 'buy';
  } else if (releasing && lower != null && close < lower) {
    bias = 'bearish';
    decision = 'sell';
  } else if (squeezed) {
    bias = 'neutral';
  } else if (upper != null && close > upper) {
    bias = 'bullish';
  } else if (lower != null && close < lower) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-squeeze',
    context,
    config: { ...config, period, stdDev, squeezeThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : squeezed ? 8 : 0),
    reasons: [
      `Bollinger squeeze — bandwidth compression → release breakout`,
      bandwidth != null ? `Bandwidth ${bandwidth.toFixed(2)}% (squeeze ≤ ${squeezeThreshold}%)` : 'Bandwidth unavailable',
      squeezed ? 'Squeeze active — volatility coiled' : releasing ? 'Squeeze releasing — expansion trade' : 'No squeeze release on latest bar',
      decision === 'buy' ? 'Upside Bollinger squeeze break' : decision === 'sell' ? 'Downside Bollinger squeeze break' : 'Await squeeze release',
    ],
    metrics: {
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
      squeezed: squeezed ? 1 : 0,
    },
  });
};

export const evaluateImpliedVolatilityTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 50));
  const highIvPercentile = parseNumber(config.highIvPercentile, 75);
  const lowIvPercentile = parseNumber(config.lowIvPercentile, 25);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  const window = atrSeries.slice(Math.max(0, last - lookback), last + 1).filter((value): value is number => value != null);
  const atrNow = atrSeries[last] ?? 0;
  const sorted = [...window].sort((a, b) => a - b);
  const rank = sorted.findIndex((value) => value >= atrNow);
  const percentile = sorted.length > 0 ? ((rank >= 0 ? rank : sorted.length - 1) / Math.max(sorted.length - 1, 1)) * 100 : 50;
  const lastCandle = candles[last]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (percentile >= highIvPercentile && lastCandle.close < lastCandle.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (percentile <= lowIvPercentile && lastCandle.close > lastCandle.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (percentile >= highIvPercentile) {
    bias = 'bearish';
  } else if (percentile <= lowIvPercentile) {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'implied-volatility-trading',
    context,
    config: { ...config, lookback, highIvPercentile, lowIvPercentile },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0) + (percentile <= lowIvPercentile || percentile >= highIvPercentile ? 10 : 0),
    reasons: [
      `Implied volatility trading — ATR percentile IV proxy over ${lookback} bars`,
      `IV proxy percentile ${percentile.toFixed(0)}% (${lowIvPercentile}/${highIvPercentile} thresholds)`,
      decision === 'buy' ? 'Low IV proxy — long volatility expansion candidate' : decision === 'sell' ? 'High IV proxy — short volatility fade' : 'IV proxy in mid-range',
    ],
    metrics: {
      ivPercentile: Number(percentile.toFixed(1)),
      atr: Number(atrNow.toFixed(5)),
    },
  });
};

export const evaluateNewsVolatilityStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 18));
  const spikeMultiple = parseNumber(config.spikeMultiple, 1.7);
  const minBodyPct = parseNumber(config.minBodyPct, 52);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars), lastIndex);
  const quietAvg = averageCandleRange(quietWindow);
  const lastRange = last.high - last.low;
  const spike = quietAvg > 0 && lastRange >= quietAvg * spikeMultiple;
  const bodyPct = lastRange > 0 ? (Math.abs(last.close - last.open) / lastRange) * 100 : 0;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spike && bodyPct >= minBodyPct && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (spike && bodyPct >= minBodyPct && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (spike) {
    bias = last.close > last.open ? 'bullish' : 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'news-volatility-strategy',
    context,
    config: { ...config, quietBars, spikeMultiple, minBodyPct },
    candles,
    decision,
    bias,
    confidence: 32 + (spike ? 16 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `News volatility strategy — ${quietBars}-bar quiet tape + headline vol spike`,
      spike ? `Vol spike ${(lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)}× quiet baseline` : 'No news-style vol spike',
      decision === 'buy' ? 'Bullish news volatility continuation long' : decision === 'sell' ? 'Bearish news volatility continuation short' : 'Spike lacks directional body confirmation',
    ],
    metrics: {
      spikeMultiple: Number((lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)),
      bodyPct: Number(bodyPct.toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{ label: 'news volatility', detail: decision === 'buy' ? 'Bullish vol spike' : 'Bearish vol spike', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};
