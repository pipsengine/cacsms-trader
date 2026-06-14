import type { StrategyPriceCandle } from './strategy-candle-loader';
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

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function newsImpulseSignal(
  candles: StrategyPriceCandle[],
  quietBars: number,
  impulseRatio: number,
  closeLocationMin = 0.65,
): {
  impulse: boolean;
  bullish: boolean;
  bearish: boolean;
  quietAvg: number;
  lastRange: number;
  last: StrategyPriceCandle;
  impulseMultiple: number;
} {
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars), lastIndex);
  const quietAvg = averageCandleRange(quietWindow);
  const lastRange = last.high - last.low;
  const impulseMultiple = quietAvg > 0 ? lastRange / quietAvg : 0;
  const impulse = quietAvg > 0 && lastRange >= quietAvg * impulseRatio;
  const bullish = impulse && last.close > last.open && (last.close - last.low) / Math.max(lastRange, 0.00001) >= closeLocationMin;
  const bearish = impulse && last.close < last.open && (last.high - last.close) / Math.max(lastRange, 0.00001) >= closeLocationMin;
  return { impulse, bullish, bearish, quietAvg, lastRange, last, impulseMultiple };
}

function impulseEvaluation(
  strategyId: string,
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
  context: Parameters<StrategyEngine>[2],
  quietBars: number,
  impulseRatio: number,
  closeLocationMin: number,
  label: string,
  longReason: string,
  shortReason: string,
) {
  const signal = newsImpulseSignal(candles, quietBars, impulseRatio, closeLocationMin);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (signal.bullish) {
    bias = 'bullish';
    decision = 'buy';
  } else if (signal.bearish) {
    bias = 'bearish';
    decision = 'sell';
  } else if (signal.impulse && signal.last.close > signal.last.open) {
    bias = 'bullish';
  } else if (signal.impulse && signal.last.close < signal.last.open) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId,
    context,
    config: { ...config, quietBars, impulseRatio, closeLocationMin },
    candles,
    decision,
    bias,
    confidence: 30 + (signal.impulse ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `${label} — ${quietBars}-bar quiet tape + headline impulse bar`,
      signal.impulse
        ? `Impulse ${signal.impulseMultiple.toFixed(2)}× quiet baseline (${signal.lastRange.toFixed(5)} vs ${signal.quietAvg.toFixed(5)})`
        : 'No event-style displacement on latest bar',
      decision === 'buy' ? longReason : decision === 'sell' ? shortReason : 'Impulse lacks decisive close location',
    ],
    metrics: {
      impulseMultiple: Number(signal.impulseMultiple.toFixed(2)),
      quietAvgRange: Number(signal.quietAvg.toFixed(5)),
    },
    events: decision !== 'wait'
      ? [{ label: 'news impulse', detail: decision === 'buy' ? 'Bullish headline impulse' : 'Bearish headline impulse', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: signal.last.candleIndex }]
      : [],
  });
}

export const evaluateNfpStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(8, parseNumber(config.quietBars, 14));
  const impulseRatio = parseNumber(config.impulseRatio, 1.85);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.68);
  return impulseEvaluation(
    'nfp-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'NFP strategy',
    'Strong NFP headline impulse long',
    'Weak NFP headline impulse short',
  );
};

export const evaluateFomcStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(12, parseNumber(config.quietBars, 20));
  const impulseRatio = parseNumber(config.impulseRatio, 1.7);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.62);
  return impulseEvaluation(
    'fomc-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'FOMC strategy',
    'Dovish FOMC impulse long',
    'Hawkish FOMC impulse short',
  );
};

export const evaluateCpiStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 18));
  const impulseRatio = parseNumber(config.impulseRatio, 1.75);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.65);
  return impulseEvaluation(
    'cpi-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'CPI strategy',
    'Hot CPI headline impulse long',
    'Soft CPI headline impulse short',
  );
};

export const evaluateEcbStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 16));
  const impulseRatio = parseNumber(config.impulseRatio, 1.65);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.63);
  return impulseEvaluation(
    'ecb-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'ECB strategy',
    'Dovish ECB headline impulse long',
    'Hawkish ECB headline impulse short',
  );
};

export const evaluateBoeStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 16));
  const impulseRatio = parseNumber(config.impulseRatio, 1.68);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.64);
  return impulseEvaluation(
    'boe-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'BOE strategy',
    'Dovish BOE headline impulse long',
    'Hawkish BOE headline impulse short',
  );
};

export const evaluateBojStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 18));
  const impulseRatio = parseNumber(config.impulseRatio, 1.72);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.64);
  return impulseEvaluation(
    'boj-strategy',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'BOJ strategy',
    'Dovish BOJ headline impulse long',
    'Hawkish BOJ headline impulse short',
  );
};

export const evaluateRateDecisionTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(14, parseNumber(config.quietBars, 24));
  const impulseRatio = parseNumber(config.impulseRatio, 1.6);
  const followThroughBars = Math.max(1, parseNumber(config.followThroughBars, 2));
  const signal = newsImpulseSignal(candles, quietBars, impulseRatio, 0.6);
  const followWindow = candles.slice(-followThroughBars);
  const followBull = followWindow.every((bar) => bar.close >= bar.open);
  const followBear = followWindow.every((bar) => bar.close <= bar.open);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (signal.bullish && followBull) {
    bias = 'bullish';
    decision = 'buy';
  } else if (signal.bearish && followBear) {
    bias = 'bearish';
    decision = 'sell';
  } else if (signal.impulse && signal.last.close > signal.last.open) {
    bias = 'bullish';
  } else if (signal.impulse && signal.last.close < signal.last.open) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'rate-decision-trading',
    context,
    config: { ...config, quietBars, impulseRatio, followThroughBars },
    candles,
    decision,
    bias,
    confidence: 32 + (signal.impulse ? 14 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `Rate decision trading — ${quietBars}-bar pre-decision quiet + announcement impulse`,
      signal.impulse ? `Impulse ${signal.impulseMultiple.toFixed(2)}× with ${followThroughBars}-bar follow-through filter` : 'No rate decision impulse',
      decision === 'buy' ? 'Rate cut / dovish decision follow-through long' : decision === 'sell' ? 'Rate hike / hawkish decision follow-through short' : 'Awaiting rate decision impulse + follow-through',
    ],
    metrics: {
      impulseMultiple: Number(signal.impulseMultiple.toFixed(2)),
      followThroughBars,
    },
  });
};

export const evaluateFlashNewsTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(4, parseNumber(config.quietBars, 6));
  const impulseRatio = parseNumber(config.impulseRatio, 2.4);
  const closeLocationMin = parseNumber(config.closeLocationMin, 0.72);
  return impulseEvaluation(
    'flash-news-trading',
    candles,
    config,
    context,
    quietBars,
    impulseRatio,
    closeLocationMin,
    'Flash news trading',
    'Flash headline spike long',
    'Flash headline spike short',
  );
};

export const evaluateVolatilitySpikeTradingEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const spikeMultiple = parseNumber(config.spikeMultiple, 1.65);
  const atrSeries = atr(candles, atrPeriod);
  const last = candles.length - 1;
  const atrNow = atrSeries[last] ?? 0;
  const atrBaseline = atrSeries[Math.max(0, last - lookback)] ?? atrNow;
  const lastCandle = candles[last]!;
  const lastRange = lastCandle.high - lastCandle.low;
  const spike = atrBaseline > 0 && (atrNow / atrBaseline >= spikeMultiple || lastRange >= atrBaseline * spikeMultiple);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (spike && lastCandle.close > lastCandle.open && lastRange > 0 && (lastCandle.close - lastCandle.low) / lastRange >= 0.6) {
    bias = 'bullish';
    decision = 'buy';
  } else if (spike && lastCandle.close < lastCandle.open && lastRange > 0 && (lastCandle.high - lastCandle.close) / lastRange >= 0.6) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-spike-trading',
    context,
    config: { ...config, atrPeriod, lookback, spikeMultiple },
    candles,
    decision,
    bias,
    confidence: 32 + (spike ? 18 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      'Volatility spike trading — ATR/range expansion on headline event bar',
      spike ? `Vol spike ${(atrNow / Math.max(atrBaseline, 0.00001)).toFixed(2)}× baseline ATR` : 'No volatility spike on latest bar',
      decision === 'buy' ? 'Bullish vol spike continuation long' : decision === 'sell' ? 'Bearish vol spike continuation short' : 'Spike without directional close',
    ],
    metrics: {
      atrRatio: Number((atrNow / Math.max(atrBaseline, 0.00001)).toFixed(2)),
      lastRange: Number(lastRange.toFixed(5)),
    },
  });
};

export const evaluateNewsFadeStrategyEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(8, parseNumber(config.quietBars, 14));
  const impulseRatio = parseNumber(config.impulseRatio, 1.8);
  const fadeWickPct = parseNumber(config.fadeWickPct, 42);
  const lastIndex = candles.length - 1;
  const impulseBar = candles[lastIndex - 1];
  const last = candles[lastIndex]!;
  if (!impulseBar) {
    return buildEvaluationResult({
      strategyId: 'news-fade-strategy',
      context,
      config: { ...config, quietBars, impulseRatio, fadeWickPct },
      candles,
      decision: 'wait',
      bias: 'neutral',
      confidence: 20,
      reasons: ['News fade strategy — insufficient bars for impulse + fade sequence'],
      metrics: {},
    });
  }

  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars - 1), lastIndex - 1);
  const quietAvg = averageCandleRange(quietWindow);
  const impulseRange = impulseBar.high - impulseBar.low;
  const impulse = quietAvg > 0 && impulseRange >= quietAvg * impulseRatio;
  const range = Math.max(last.high - last.low, 0.00001);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const wickPct = (Math.max(upperWick, lowerWick) / range) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (impulse && impulseBar.close > impulseBar.open && wickPct >= fadeWickPct && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (impulse && impulseBar.close < impulseBar.open && wickPct >= fadeWickPct && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  }

  return buildEvaluationResult({
    strategyId: 'news-fade-strategy',
    context,
    config: { ...config, quietBars, impulseRatio, fadeWickPct },
    candles,
    decision,
    bias,
    confidence: 32 + (impulse ? 14 : 0) + (decision !== 'wait' ? 34 : 0),
    reasons: [
      'News fade strategy — fade overstretched headline impulse with rejection bar',
      impulse ? `Prior impulse ${(impulseRange / Math.max(quietAvg, 0.00001)).toFixed(2)}× quiet base` : 'No qualifying prior news impulse',
      `Fade rejection wick ${wickPct.toFixed(0)}% (min ${fadeWickPct}%)`,
      decision === 'buy' ? 'Fade bearish overreaction — reversal long' : decision === 'sell' ? 'Fade bullish overreaction — reversal short' : 'Awaiting news fade rejection setup',
    ],
    metrics: {
      impulseMultiple: Number((impulseRange / Math.max(quietAvg, 0.00001)).toFixed(2)),
      fadeWickPct: Number(wickPct.toFixed(1)),
    },
    events: decision !== 'wait'
      ? [{ label: 'news fade', detail: decision === 'buy' ? 'Fade bearish headline spike' : 'Fade bullish headline spike', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};
