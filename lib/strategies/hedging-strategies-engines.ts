import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { atr, ema } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function symbolFromContext(context: { symbol: string }, config: Record<string, unknown>): string {
  return String(config.symbol ?? context.symbol ?? 'EURUSD').toUpperCase();
}

function barReturns(candles: StrategyPriceCandle[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const prev = candles[index - 1]!.close;
    returns.push(prev === 0 ? 0 : (candles[index]!.close - prev) / prev);
  }
  return returns;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let denomLeft = 0;
  let denomRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const deltaLeft = left[index]! - meanLeft;
    const deltaRight = right[index]! - meanRight;
    numerator += deltaLeft * deltaRight;
    denomLeft += deltaLeft * deltaLeft;
    denomRight += deltaRight * deltaRight;
  }
  const denominator = Math.sqrt(denomLeft * denomRight);
  return denominator > 0 ? numerator / denominator : 0;
}

function rocPct(candles: StrategyPriceCandle[], bars: number): number {
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const start = closes[Math.max(0, last - bars)]!;
  return start !== 0 ? ((closes[last]! - start) / start) * 100 : 0;
}

function drawdownFromPeak(candles: StrategyPriceCandle[], lookback: number): number {
  const window = candles.slice(-lookback);
  if (window.length === 0) return 0;
  const peak = Math.max(...window.map((item) => item.high));
  const lastClose = window.at(-1)!.close;
  return peak !== 0 ? ((peak - lastClose) / peak) * 100 : 0;
}

function rallyFromTrough(candles: StrategyPriceCandle[], lookback: number): number {
  const window = candles.slice(-lookback);
  if (window.length === 0) return 0;
  const trough = Math.min(...window.map((item) => item.low));
  const lastClose = window.at(-1)!.close;
  return trough !== 0 ? ((lastClose - trough) / trough) * 100 : 0;
}

export const evaluateDirectHedgeEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 5, parseNumber(config.slowPeriod, 34));
  const adversePct = parseNumber(config.adversePct, 0.35);
  const closes = candles.map((item) => item.close);
  const lastIndex = closes.length - 1;
  const fastMa = ema(closes, fastPeriod)[lastIndex];
  const slowMa = ema(closes, slowPeriod)[lastIndex];
  const last = candles[lastIndex]!;
  const primaryBull = (fastMa ?? last.close) > (slowMa ?? last.close);
  const recentMovePct = rocPct(candles.slice(-Math.max(5, Math.floor(fastPeriod / 2))), Math.max(4, Math.floor(fastPeriod / 2)));
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (primaryBull && recentMovePct <= -adversePct) {
    bias = 'bearish';
    decision = 'sell';
  } else if (!primaryBull && recentMovePct >= adversePct) {
    bias = 'bullish';
    decision = 'buy';
  } else if (primaryBull) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'direct-hedge',
    context,
    config: { ...config, fastPeriod, slowPeriod, adversePct },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 34 : 0) + (Math.abs(recentMovePct) >= adversePct ? 12 : 0),
    reasons: [
      'Direct hedge — offset primary trend when adverse short-term move breaches threshold',
      `Primary ${primaryBull ? 'bullish' : 'bearish'} · recent move ${recentMovePct.toFixed(2)}% (adverse ±${adversePct}%)`,
      decision === 'sell' ? 'Hedge short against long exposure' : decision === 'buy' ? 'Hedge long against short exposure' : 'No direct hedge trigger',
    ],
    metrics: {
      recentMovePct: Number(recentMovePct.toFixed(3)),
      primaryTrend: primaryBull ? 1 : 0,
    },
  });
};

export const evaluateMultipleCurrencyHedgeEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(16, parseNumber(config.lookback, 28));
  const divergencePct = parseNumber(config.divergencePct, 0.55);
  const symbol = symbolFromContext(context, config);
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  const fullRoc = rocPct(candles, lookback);
  const half = Math.max(6, Math.floor(lookback / 2));
  const fastRoc = rocPct(candles, half);
  const slowRoc = rocPct(candles.slice(0, -half), lookback - half);
  const basketSpread = Math.abs(fastRoc - slowRoc);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (basketSpread >= divergencePct && fastRoc < 0 && slowRoc > 0 && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (basketSpread >= divergencePct && fastRoc > 0 && slowRoc < 0 && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (fullRoc > 0) {
    bias = 'bullish';
  } else if (fullRoc < 0) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'multiple-currency-hedge',
    context,
    config: { ...config, lookback, divergencePct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 0) + (basketSpread >= divergencePct ? 14 : 0),
    reasons: [
      `Multiple currency hedge — ${base}/${quote} basket momentum divergence proxy`,
      `Fast ROC ${fastRoc.toFixed(2)}% · slow ROC ${slowRoc.toFixed(2)}% · spread ${basketSpread.toFixed(2)}%`,
      decision === 'sell' ? 'Multi-currency hedge short leg' : decision === 'buy' ? 'Multi-currency hedge long leg' : 'Basket divergence below hedge threshold',
    ],
    metrics: {
      basketSpreadPct: Number(basketSpread.toFixed(3)),
      fullRocPct: Number(fullRoc.toFixed(3)),
    },
  });
};

export const evaluateCorrelationHedgeEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(8, parseNumber(config.fastBars, 14));
  const slowBars = Math.max(fastBars + 6, parseNumber(config.slowBars, 36));
  const breakCorrelation = parseNumber(config.breakCorrelation, 0.15);
  const fastWindow = candles.slice(-fastBars);
  const slowWindow = candles.slice(-slowBars);
  const fastReturns = barReturns(fastWindow);
  const slowReturns = barReturns(slowWindow).slice(-fastReturns.length);
  const correlation = pearsonCorrelation(fastReturns, slowReturns);
  const slowMomentum = slowWindow.at(-1)!.close - slowWindow[0]!.close;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = slowMomentum > 0 ? 'bullish' : slowMomentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (correlation <= breakCorrelation && slowMomentum > 0 && last.close < last.open) {
    decision = 'buy';
    bias = 'bullish';
  } else if (correlation <= breakCorrelation && slowMomentum < 0 && last.close > last.open) {
    decision = 'sell';
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'correlation-hedge',
    context,
    config: { ...config, fastBars, slowBars, breakCorrelation },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0) + (correlation <= breakCorrelation ? 12 : 0),
    reasons: [
      'Correlation hedge — deploy when fast/slow return correlation breaks down',
      `Correlation ${correlation.toFixed(2)} (break ≤ ${breakCorrelation}) · slow momentum ${slowMomentum >= 0 ? 'up' : 'down'}`,
      decision === 'buy' ? 'Correlation-break hedge long' : decision === 'sell' ? 'Correlation-break hedge short' : 'Correlation intact — no hedge',
    ],
    metrics: {
      correlation: Number(correlation.toFixed(3)),
      slowMomentum: Number(slowMomentum.toFixed(5)),
    },
  });
};

export const evaluateOptionsHedgeEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const trendBars = Math.max(20, parseNumber(config.trendBars, 30));
  const volSpikeMultiple = parseNumber(config.volSpikeMultiple, 1.45);
  const closes = candles.map((item) => item.close);
  const lastIndex = candles.length - 1;
  const trendMa = ema(closes, trendBars)[lastIndex];
  const atrSeries = atr(candles, atrPeriod);
  const atrNow = atrSeries[lastIndex] ?? 0;
  const atrBaseline = atrSeries[Math.max(0, lastIndex - trendBars)] ?? atrNow;
  const last = candles[lastIndex]!;
  const primaryBull = last.close > (trendMa ?? last.close);
  const volSpike = atrBaseline > 0 && atrNow / atrBaseline >= volSpikeMultiple;
  const adverseBar = primaryBull ? last.close < last.open : last.close > last.open;
  let bias: StrategyBias = primaryBull ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';

  if (volSpike && adverseBar && primaryBull) {
    decision = 'sell';
    bias = 'bearish';
  } else if (volSpike && adverseBar && !primaryBull) {
    decision = 'buy';
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'options-hedge',
    context,
    config: { ...config, atrPeriod, trendBars, volSpikeMultiple },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 32 : 0) + (volSpike ? 14 : 0),
    reasons: [
      'Options hedge — vol spike against primary trend triggers protective leg',
      `ATR ratio ${(atrBaseline > 0 ? atrNow / atrBaseline : 0).toFixed(2)}× (min ${volSpikeMultiple}×) · primary ${primaryBull ? 'long' : 'short'}`,
      decision === 'sell' ? 'Protective put proxy — hedge short' : decision === 'buy' ? 'Protective call proxy — hedge long' : 'No vol-adverse hedge setup',
    ],
    metrics: {
      atrRatio: Number((atrBaseline > 0 ? atrNow / atrBaseline : 0).toFixed(3)),
      primaryTrend: primaryBull ? 1 : 0,
    },
  });
};

export const evaluateSyntheticHedgeEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 10));
  const slowPeriod = Math.max(fastPeriod + 4, parseNumber(config.slowPeriod, 26));
  const spreadPct = parseNumber(config.spreadPct, 0.25);
  const closes = candles.map((item) => item.close);
  const lastIndex = closes.length - 1;
  const fastMa = ema(closes, fastPeriod)[lastIndex] ?? closes[lastIndex]!;
  const slowMa = ema(closes, slowPeriod)[lastIndex] ?? closes[lastIndex]!;
  const spread = slowMa !== 0 ? ((fastMa - slowMa) / slowMa) * 100 : 0;
  const last = candles[lastIndex]!;
  let bias: StrategyBias = spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spread >= spreadPct && last.close < last.open) {
    decision = 'sell';
    bias = 'bearish';
  } else if (spread <= -spreadPct && last.close > last.open) {
    decision = 'buy';
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'synthetic-hedge',
    context,
    config: { ...config, fastPeriod, slowPeriod, spreadPct },
    candles,
    decision,
    bias,
    confidence: 33 + (decision !== 'wait' ? 32 : 0) + (Math.abs(spread) >= spreadPct ? 14 : 0),
    reasons: [
      'Synthetic hedge — EMA spread inversion creates synthetic offset leg',
      `Fast/slow spread ${spread.toFixed(2)}% (threshold ±${spreadPct}%)`,
      decision === 'sell' ? 'Synthetic short hedge leg' : decision === 'buy' ? 'Synthetic long hedge leg' : 'Spread too tight for synthetic hedge',
    ],
    metrics: {
      emaSpreadPct: Number(spread.toFixed(3)),
    },
  });
};

export const evaluatePartialHedgeEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const drawdownPct = parseNumber(config.drawdownPct, 1.2);
  const partialRatio = parseNumber(config.partialRatio, 0.5);
  const closes = candles.map((item) => item.close);
  const lastIndex = closes.length - 1;
  const trendMa = ema(closes, Math.max(15, Math.floor(lookback / 2)))[lastIndex];
  const last = candles[lastIndex]!;
  const primaryBull = last.close > (trendMa ?? last.close);
  const dd = drawdownFromPeak(candles, lookback);
  const rally = rallyFromTrough(candles, lookback);
  const adverseMove = primaryBull ? dd : rally;
  let bias: StrategyBias = primaryBull ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';

  if (primaryBull && dd >= drawdownPct && last.close <= last.open) {
    decision = 'sell';
    bias = 'bearish';
  } else if (!primaryBull && rally >= drawdownPct && last.close >= last.open) {
    decision = 'buy';
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'partial-hedge',
    context,
    config: { ...config, lookback, drawdownPct, partialRatio },
    candles,
    decision,
    bias,
    confidence: 30 + (decision !== 'wait' ? 28 : 0) + Math.min(20, adverseMove * 8),
    reasons: [
      `Partial hedge — activate ${(partialRatio * 100).toFixed(0)}% offset when adverse excursion breaches threshold`,
      `Adverse move ${adverseMove.toFixed(2)}% vs threshold ${drawdownPct}% · primary ${primaryBull ? 'long' : 'short'}`,
      decision === 'sell' ? 'Partial hedge short against long book' : decision === 'buy' ? 'Partial hedge long against short book' : 'Drawdown below partial hedge trigger',
    ],
    metrics: {
      adverseMovePct: Number(adverseMove.toFixed(3)),
      partialRatio: Number(partialRatio.toFixed(2)),
    },
  });
};
