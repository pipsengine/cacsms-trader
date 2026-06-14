import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, ema } from './indicators';

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

function dxyMappedMomentum(symbol: string, roc: number): number {
  if (symbol.endsWith('USD') && !symbol.startsWith('USD')) return -roc;
  if (symbol.startsWith('USD')) return roc;
  return roc;
}

function correlationAlignedSignal(
  candles: StrategyPriceCandle[],
  fastBars: number,
  slowBars: number,
  minCorrelation: number,
): { correlation: number; fastMomentum: number; alignedBull: boolean; alignedBear: boolean } {
  const fastWindow = candles.slice(-fastBars);
  const slowWindow = candles.slice(-slowBars);
  const fastReturns = barReturns(fastWindow);
  const slowReturns = barReturns(slowWindow).slice(-fastReturns.length);
  const correlation = pearsonCorrelation(fastReturns, slowReturns);
  const fastMomentum = fastWindow.length >= 2 ? fastWindow.at(-1)!.close - fastWindow[0]!.close : 0;
  return {
    correlation,
    fastMomentum,
    alignedBull: correlation >= minCorrelation && fastMomentum > 0,
    alignedBear: correlation >= minCorrelation && fastMomentum < 0,
  };
}

export const evaluateCurrencyCorrelationTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(8, parseNumber(config.fastBars, 16));
  const slowBars = Math.max(fastBars + 5, parseNumber(config.slowBars, 40));
  const minCorrelation = parseNumber(config.minCorrelation, 0.5);
  const { correlation, fastMomentum, alignedBull, alignedBear } = correlationAlignedSignal(candles, fastBars, slowBars, minCorrelation);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (alignedBull && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (alignedBear && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (alignedBull) {
    bias = 'bullish';
  } else if (alignedBear) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'currency-correlation-trading',
    context,
    config: { ...config, fastBars, slowBars, minCorrelation },
    candles,
    decision,
    bias,
    confidence: 32 + (Math.abs(correlation) >= minCorrelation ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Currency correlation — ${fastBars}-bar vs ${slowBars}-bar return alignment proxy`,
      `Return correlation ${correlation.toFixed(2)} (min ${minCorrelation})`,
      decision === 'buy' ? 'Correlated bullish momentum — FX long' : decision === 'sell' ? 'Correlated bearish momentum — FX short' : 'Correlation/momentum not aligned',
    ],
    metrics: {
      correlation: Number(correlation.toFixed(3)),
      fastMomentum: Number(fastMomentum.toFixed(5)),
    },
  });
};

export const evaluateGoldForexCorrelationEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 45));
  const minCorrelation = parseNumber(config.minCorrelation, 0.45);
  const symbol = symbolFromContext(context, config);
  const isGold = symbol.includes('XAU') || symbol.includes('GOLD');
  const fastWindow = candles.slice(-Math.floor(lookback / 2));
  const slowWindow = candles.slice(-lookback);
  const fastReturns = barReturns(fastWindow);
  const slowReturns = barReturns(slowWindow).slice(-fastReturns.length);
  const correlation = pearsonCorrelation(fastReturns, slowReturns);
  const roc = rocPct(candles, lookback);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (isGold) {
    if (correlation >= minCorrelation && roc > 0 && last.close > last.open) {
      bias = 'bullish';
      decision = 'buy';
    } else if (correlation >= minCorrelation && roc < 0 && last.close < last.open) {
      bias = 'bearish';
      decision = 'sell';
    } else if (roc > 0) {
      bias = 'bullish';
    } else if (roc < 0) {
      bias = 'bearish';
    }
  } else if (correlation >= minCorrelation && roc > 0.4 && last.close > last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (correlation >= minCorrelation && roc < -0.4 && last.close < last.open) {
    bias = 'bullish';
    decision = 'buy';
  }

  return buildEvaluationResult({
    strategyId: 'gold-forex-correlation',
    context,
    config: { ...config, lookback, minCorrelation },
    candles,
    decision,
    bias,
    confidence: 34 + (Math.abs(correlation) >= minCorrelation ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Gold-FX correlation — ${isGold ? 'direct gold trend' : 'inverse gold risk proxy'} on ${symbol}`,
      `Return correlation ${correlation.toFixed(2)} · ROC ${roc.toFixed(2)}%`,
      decision === 'buy' ? 'Gold-FX correlation long signal' : decision === 'sell' ? 'Gold-FX correlation short signal' : 'Gold-FX correlation not aligned',
    ],
    metrics: {
      correlation: Number(correlation.toFixed(3)),
      rocPct: Number(roc.toFixed(3)),
      assetType: isGold ? 1 : 0,
    },
  });
};

export const evaluateOilCadCorrelationEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(20, parseNumber(config.trendBars, 40));
  const minTrendPct = parseNumber(config.minTrendPct, 0.9);
  const adxPeriod = Math.max(10, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 20);
  const symbol = symbolFromContext(context, config);
  const isCadPair = symbol.includes('CAD');
  const trend = rocPct(candles, trendBars);
  const commodityProxy = isCadPair ? trend : trend * (symbol.startsWith('USD') && symbol.endsWith('CAD') ? -1 : 1);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const adxNow = adxSeries[candles.length - 1];
  const strong = adxNow != null && adxNow >= adxThreshold;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = commodityProxy > 0 ? 'bullish' : commodityProxy < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (isCadPair && strong && commodityProxy >= minTrendPct && last.close > last.open) {
    decision = symbol.startsWith('USD') && symbol.endsWith('CAD') ? 'sell' : 'buy';
    bias = decision === 'buy' ? 'bullish' : 'bearish';
  } else if (isCadPair && strong && commodityProxy <= -minTrendPct && last.close < last.open) {
    decision = symbol.startsWith('USD') && symbol.endsWith('CAD') ? 'buy' : 'sell';
    bias = decision === 'buy' ? 'bullish' : 'bearish';
  } else if (strong && commodityProxy >= minTrendPct && last.close > last.open) {
    decision = 'buy';
    bias = 'bullish';
  } else if (strong && commodityProxy <= -minTrendPct && last.close < last.open) {
    decision = 'sell';
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'oil-cad-correlation',
    context,
    config: { ...config, trendBars, minTrendPct, adxPeriod, adxThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (strong ? 12 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Oil-CAD correlation — commodity momentum proxy on ${symbol}`,
      `Commodity proxy ${commodityProxy.toFixed(2)}% · ADX ${adxNow?.toFixed(1) ?? 'n/a'}`,
      decision === 'buy' ? 'Oil strength supports CAD long bias' : decision === 'sell' ? 'Oil weakness supports CAD short bias' : 'Oil-CAD correlation below threshold',
    ],
    metrics: {
      commodityProxyPct: Number(commodityProxy.toFixed(3)),
      adx: adxNow != null ? Number(adxNow.toFixed(1)) : null,
    },
  });
};

export const evaluateBondYieldCorrelationEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(10, parseNumber(config.fastBars, 20));
  const slowBars = Math.max(fastBars + 10, parseNumber(config.slowBars, 50));
  const minSpreadPct = parseNumber(config.minSpreadPct, 0.35);
  const fastRoc = rocPct(candles, fastBars);
  const slowRoc = rocPct(candles, slowBars);
  const spread = fastRoc - slowRoc;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = spread > 0 ? 'bearish' : spread < 0 ? 'bullish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spread >= minSpreadPct && last.close < last.open) {
    decision = 'sell';
    bias = 'bearish';
  } else if (spread <= -minSpreadPct && last.close > last.open) {
    decision = 'buy';
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'bond-yield-correlation',
    context,
    config: { ...config, fastBars, slowBars, minSpreadPct },
    candles,
    decision,
    bias,
    confidence: 34 + (Math.abs(spread) >= minSpreadPct ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Bond-yield correlation — fast vs slow ROC spread as yield curve proxy',
      `Fast ROC ${fastRoc.toFixed(2)}% · slow ROC ${slowRoc.toFixed(2)}% · spread ${spread.toFixed(2)}%`,
      decision === 'sell' ? 'Rising yield proxy — FX pressure short' : decision === 'buy' ? 'Falling yield proxy — FX support long' : 'Yield spread below entry threshold',
    ],
    metrics: {
      spreadPct: Number(spread.toFixed(3)),
      fastRocPct: Number(fastRoc.toFixed(3)),
      slowRocPct: Number(slowRoc.toFixed(3)),
    },
  });
};

export const evaluateDollarIndexDxyStrategyEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(20, parseNumber(config.trendBars, 40));
  const minDxyMovePct = parseNumber(config.minDxyMovePct, 0.7);
  const symbol = symbolFromContext(context, config);
  const roc = rocPct(candles, trendBars);
  const dxyProxy = dxyMappedMomentum(symbol, roc);
  const closes = candles.map((item) => item.close);
  const emaNow = ema(closes, Math.max(15, Math.floor(trendBars / 2)))[closes.length - 1];
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (dxyProxy >= minDxyMovePct && last.close > (emaNow ?? last.close) && last.close > last.open) {
    decision = symbol.endsWith('USD') && !symbol.startsWith('USD') ? 'sell' : 'buy';
    bias = decision === 'buy' ? 'bullish' : 'bearish';
  } else if (dxyProxy <= -minDxyMovePct && last.close < (emaNow ?? last.close) && last.close < last.open) {
    decision = symbol.endsWith('USD') && !symbol.startsWith('USD') ? 'buy' : 'sell';
    bias = decision === 'buy' ? 'bullish' : 'bearish';
  } else if (dxyProxy > 0) {
    bias = symbol.endsWith('USD') && !symbol.startsWith('USD') ? 'bearish' : 'bullish';
  } else if (dxyProxy < 0) {
    bias = symbol.endsWith('USD') && !symbol.startsWith('USD') ? 'bullish' : 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'dollar-index-dxy-strategy',
    context,
    config: { ...config, trendBars, minDxyMovePct },
    candles,
    decision,
    bias,
    confidence: 36 + (Math.abs(dxyProxy) >= minDxyMovePct ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `DXY strategy — dollar index proxy mapped for ${symbol}`,
      `DXY proxy move ${dxyProxy.toFixed(2)}% (min ±${minDxyMovePct}%)`,
      decision === 'buy' ? 'DXY-mapped long alignment' : decision === 'sell' ? 'DXY-mapped short alignment' : 'DXY proxy move insufficient',
    ],
    metrics: {
      dxyProxyPct: Number(dxyProxy.toFixed(3)),
      symbolRocPct: Number(roc.toFixed(3)),
    },
  });
};

export const evaluateRiskSentimentCorrelationEngine: StrategyEngine = (candles, config, context) => {
  const momentumBars = Math.max(12, parseNumber(config.momentumBars, 24));
  const volLookback = Math.max(15, parseNumber(config.volLookback, 30));
  const minScore = parseNumber(config.minScore, 0.75);
  const momentum = rocPct(candles, momentumBars);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  const atrNow = atrSeries[last] ?? 0;
  const atrPrev = atrSeries[Math.max(0, last - volLookback)] ?? atrNow;
  const volChange = atrPrev > 0 ? (atrNow - atrPrev) / atrPrev : 0;
  const riskScore = momentum - volChange * 100;
  const lastCandle = candles[last]!;
  let bias: StrategyBias = riskScore > 0 ? 'bullish' : riskScore < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (riskScore >= minScore && lastCandle.close > lastCandle.open) decision = 'buy';
  if (riskScore <= -minScore && lastCandle.close < lastCandle.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'risk-sentiment-correlation',
    context,
    config: { ...config, momentumBars, volLookback, minScore },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0) + Math.min(16, Math.abs(riskScore) * 8),
    reasons: [
      'Risk sentiment correlation — cross-asset risk score from momentum vs vol',
      `Risk score ${riskScore.toFixed(2)} (threshold ±${minScore}) · momentum ${momentum.toFixed(2)}%`,
      decision === 'buy' ? 'Risk-on correlation long' : decision === 'sell' ? 'Risk-off correlation short' : 'Risk sentiment neutral',
    ],
    metrics: {
      riskScore: Number(riskScore.toFixed(3)),
      momentumPct: Number(momentum.toFixed(3)),
    },
  });
};

export const evaluateEquityForexCorrelationEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(8, parseNumber(config.fastBars, 14));
  const slowBars = Math.max(fastBars + 6, parseNumber(config.slowBars, 32));
  const minCorrelation = parseNumber(config.minCorrelation, 0.48);
  const maxVolRatio = parseNumber(config.maxVolRatio, 1.25);
  const { correlation, fastMomentum, alignedBull, alignedBear } = correlationAlignedSignal(candles, fastBars, slowBars, minCorrelation);
  const quietWindow = candles.slice(-slowBars, -fastBars);
  const recentWindow = candles.slice(-fastBars);
  const quietAvg = quietWindow.length > 0
    ? quietWindow.reduce((sum, item) => sum + (item.high - item.low), 0) / quietWindow.length
    : 0;
  const recentAvg = recentWindow.reduce((sum, item) => sum + (item.high - item.low), 0) / Math.max(recentWindow.length, 1);
  const volContained = quietAvg === 0 || recentAvg / quietAvg <= maxVolRatio;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (volContained && alignedBull && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (volContained && alignedBear && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (alignedBull) {
    bias = 'bullish';
  } else if (alignedBear) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'equity-forex-correlation',
    context,
    config: { ...config, fastBars, slowBars, minCorrelation, maxVolRatio },
    candles,
    decision,
    bias,
    confidence: 32 + (volContained ? 10 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Equity-FX correlation — risk-on return alignment with contained volatility',
      `Correlation ${correlation.toFixed(2)} · vol ratio ${(recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)}`,
      decision === 'buy' ? 'Equity risk-on FX long' : decision === 'sell' ? 'Equity risk-off FX short' : 'Equity-FX correlation not confirmed',
    ],
    metrics: {
      correlation: Number(correlation.toFixed(3)),
      volRatio: Number((recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)),
    },
  });
};
