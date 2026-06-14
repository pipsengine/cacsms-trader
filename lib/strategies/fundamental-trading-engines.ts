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

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function adaptiveEmaPeriod(target: number, candleCount: number, minPeriod: number): number {
  return Math.max(minPeriod, Math.min(target, candleCount - 5));
}

function emaStackBias(
  candles: StrategyPriceCandle[],
  fastTarget: number,
  slowTarget: number,
): {
  bias: StrategyBias;
  fast: number | null;
  slow: number | null;
  fastPeriod: number;
  slowPeriod: number;
  slopePct: number;
} {
  const closes = candles.map((item) => item.close);
  const fastPeriod = adaptiveEmaPeriod(fastTarget, closes.length, 20);
  const slowPeriod = adaptiveEmaPeriod(Math.max(slowTarget, fastPeriod + 10), closes.length, fastPeriod + 10);
  const fastSeries = ema(closes, fastPeriod);
  const slowSeries = ema(closes, slowPeriod);
  const last = closes.length - 1;
  const fast = fastSeries[last] ?? null;
  const slow = slowSeries[last] ?? null;
  const fastPrev = fastSeries[Math.max(0, last - 10)] ?? null;
  const close = closes[last]!;
  const slopePct = fast != null && fastPrev != null && fastPrev !== 0 ? ((fast - fastPrev) / fastPrev) * 100 : 0;
  let bias: StrategyBias = 'neutral';
  if (fast != null && slow != null) {
    if (close > fast && fast > slow && slopePct >= 0) bias = 'bullish';
    else if (close < fast && fast < slow && slopePct <= 0) bias = 'bearish';
    else if (fast > slow) bias = 'bullish';
    else if (fast < slow) bias = 'bearish';
  }
  return { bias, fast, slow, fastPeriod, slowPeriod, slopePct };
}

function rocPct(closes: number[], bars: number): number {
  const last = closes.length - 1;
  const start = closes[Math.max(0, last - bars)]!;
  return start !== 0 ? ((closes[last]! - start) / start) * 100 : 0;
}

function eventExpansionSignal(
  candles: StrategyPriceCandle[],
  quietBars: number,
  expansionRatio: number,
): { expanding: boolean; quietAvg: number; recentAvg: number; last: StrategyPriceCandle } {
  const last = candles[candles.length - 1]!;
  const quietWindow = candles.slice(Math.max(0, candles.length - quietBars - 4), Math.max(0, candles.length - 4));
  const recentWindow = candles.slice(-4);
  const quietAvg = averageCandleRange(quietWindow);
  const recentAvg = averageCandleRange(recentWindow);
  const expanding = quietAvg > 0 && recentAvg / quietAvg >= expansionRatio;
  return { expanding, quietAvg, recentAvg, last };
}

export const evaluateInterestRateTradingEngine: StrategyEngine = (candles, config, context) => {
  const driftBars = Math.max(25, parseNumber(config.driftBars, 50));
  const minDriftPct = parseNumber(config.minDriftPct, 1.2);
  const stack = emaStackBias(candles, 40, 80);
  const closes = candles.map((item) => item.close);
  const drift = rocPct(closes, driftBars);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = drift > 0 ? 'bullish' : drift < 0 ? 'bearish' : stack.bias;
  let decision: StrategySignalSide = 'wait';
  if (drift >= minDriftPct && stack.bias === 'bullish' && last.close > last.open) decision = 'buy';
  if (drift <= -minDriftPct && stack.bias === 'bearish' && last.close < last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'interest-rate-trading',
    context,
    config: { ...config, driftBars, minDriftPct },
    candles,
    decision,
    bias,
    confidence: 36 + (Math.abs(drift) >= minDriftPct ? 14 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      `Interest rate trading — ${driftBars}-bar rate-expectation drift + EMA(${stack.fastPeriod}) bias`,
      `Drift ${drift.toFixed(2)}% (min ±${minDriftPct}%)`,
      decision === 'buy' ? 'Rate-cut / dovish drift long — sustained bid' : decision === 'sell' ? 'Rate-hike / hawkish drift short — sustained offer' : 'No rate drift entry',
    ],
    metrics: { driftPct: Number(drift.toFixed(3)) },
  });
};

export const evaluateCentralBankTradingEngine: StrategyEngine = (candles, config, context) => {
  const driftBars = Math.max(30, parseNumber(config.driftBars, 55));
  const quietBars = Math.max(10, parseNumber(config.quietBars, 18));
  const minDriftPct = parseNumber(config.minDriftPct, 1.5);
  const closes = candles.map((item) => item.close);
  const drift = rocPct(closes, driftBars);
  const quietWindow = candles.slice(Math.max(0, candles.length - quietBars - 8), Math.max(0, candles.length - 8));
  const recentWindow = candles.slice(-8);
  const quietAvg = averageCandleRange(quietWindow);
  const recentAvg = averageCandleRange(recentWindow);
  const policyGlide = Math.abs(drift) >= minDriftPct && recentAvg <= quietAvg * 1.2;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = drift > 0 ? 'bullish' : drift < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (policyGlide && drift >= minDriftPct && last.close >= last.open) decision = 'buy';
  if (policyGlide && drift <= -minDriftPct && last.close <= last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'central-bank-trading',
    context,
    config: { ...config, driftBars, quietBars, minDriftPct },
    candles,
    decision,
    bias,
    confidence: 34 + (policyGlide ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Central bank trading — policy drift with controlled-volatility glide path',
      `Drift ${drift.toFixed(2)}% over ${driftBars} bars · vol ratio ${(recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)}`,
      decision === 'buy' ? 'Dovish CB glide long' : decision === 'sell' ? 'Hawkish CB glide short' : 'No central bank drift entry',
    ],
    metrics: { driftPct: Number(drift.toFixed(3)), volRatio: Number((recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)) },
  });
};

export const evaluateCpiTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(12, parseNumber(config.quietBars, 24));
  const expansionRatio = parseNumber(config.expansionRatio, 1.35);
  const minBodyPct = parseNumber(config.minBodyPct, 55);
  const { expanding, quietAvg, recentAvg, last } = eventExpansionSignal(candles, quietBars, expansionRatio);
  const range = Math.max(last.high - last.low, 0.00001);
  const bodyPct = (Math.abs(last.close - last.open) / range) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (expanding && bodyPct >= minBodyPct && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (expanding && bodyPct >= minBodyPct && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'cpi-trading',
    context,
    config: { ...config, quietBars, expansionRatio, minBodyPct },
    candles,
    decision,
    bias,
    confidence: 34 + (expanding ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      'CPI trading — inflation release expansion after quiet consolidation proxy',
      expanding
        ? `Vol expansion ${(recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)}× after ${quietBars}-bar quiet base`
        : 'No CPI-style volatility expansion',
      decision === 'buy' ? 'Hot CPI directional long (surprise expansion up)' : decision === 'sell' ? 'Soft CPI directional short' : 'Awaiting CPI release expansion',
    ],
    metrics: {
      expansionMultiple: Number((recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)),
      bodyPct: Number(bodyPct.toFixed(1)),
    },
  });
};

export const evaluateNfpTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(10, parseNumber(config.quietBars, 20));
  const shockMultiple = parseNumber(config.shockMultiple, 1.6);
  const minDisplacementPct = parseNumber(config.minDisplacementPct, 0.12);
  const { expanding, quietAvg, recentAvg, last } = eventExpansionSignal(candles, quietBars, shockMultiple);
  const displacementPct = quietAvg > 0 ? ((last.close - candles[candles.length - 2]!.close) / Math.max(last.close, 0.00001)) * 100 : 0;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (expanding && displacementPct >= minDisplacementPct) {
    bias = 'bullish';
    decision = 'buy';
  } else if (expanding && displacementPct <= -minDisplacementPct) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'nfp-trading',
    context,
    config: { ...config, quietBars, shockMultiple, minDisplacementPct },
    candles,
    decision,
    bias,
    confidence: 35 + (expanding ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      'NFP trading — employment shock bar after pre-release quiet period',
      expanding ? `Shock expansion ${(recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)}×` : 'No NFP-style shock detected',
      `Bar displacement ${displacementPct.toFixed(2)}% (min ±${minDisplacementPct}%)`,
      decision === 'buy' ? 'Strong NFP surprise long' : decision === 'sell' ? 'Weak NFP surprise short' : 'Awaiting NFP shock entry',
    ],
    metrics: {
      displacementPct: Number(displacementPct.toFixed(3)),
      shockMultiple: Number((recentAvg / Math.max(quietAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateGdpTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(40, parseNumber(config.trendBars, 70));
  const minGrowthPct = parseNumber(config.minGrowthPct, 1.8);
  const stack = emaStackBias(candles, 50, 100);
  const closes = candles.map((item) => item.close);
  const growth = rocPct(closes, trendBars);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = growth > 0 ? 'bullish' : growth < 0 ? 'bearish' : stack.bias;
  let decision: StrategySignalSide = 'wait';
  if (growth >= minGrowthPct && stack.bias === 'bullish' && last.close > stack.fast!) decision = 'buy';
  if (growth <= -minGrowthPct && stack.bias === 'bearish' && last.close < stack.fast!) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'gdp-trading',
    context,
    config: { ...config, trendBars, minGrowthPct },
    candles,
    decision,
    bias,
    confidence: 38 + (Math.abs(growth) >= minGrowthPct ? 14 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      `GDP trading — ${trendBars}-bar macro growth drift + EMA(${stack.fastPeriod}/${stack.slowPeriod}) filter`,
      `Growth proxy ${growth.toFixed(2)}% (min ±${minGrowthPct}%)`,
      decision === 'buy' ? 'Above-trend GDP growth long' : decision === 'sell' ? 'Below-trend GDP contraction short' : 'No GDP growth entry',
    ],
    metrics: { growthPct: Number(growth.toFixed(3)) },
  });
};

export const evaluateInflationTradingEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(10, parseNumber(config.atrPeriod, 14));
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const expansionThreshold = parseNumber(config.expansionThreshold, 1.2);
  const atrSeries = atr(candles, atrPeriod);
  const last = candles.length - 1;
  const atrNow = atrSeries[last] ?? 0;
  const atrPrev = atrSeries[Math.max(0, last - lookback)] ?? atrNow;
  const inflating = atrPrev > 0 && atrNow / atrPrev >= expansionThreshold;
  const closes = candles.map((item) => item.close);
  const momentum = rocPct(closes, Math.floor(lookback / 2));
  const lastCandle = candles[last]!;
  let bias: StrategyBias = inflating && momentum > 0 ? 'bearish' : inflating && momentum < 0 ? 'bullish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (inflating && momentum >= 0.8 && lastCandle.close < lastCandle.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (inflating && momentum <= -0.8 && lastCandle.close > lastCandle.open) {
    bias = 'bullish';
    decision = 'buy';
  }

  return buildEvaluationResult({
    strategyId: 'inflation-trading',
    context,
    config: { ...config, atrPeriod, lookback, expansionThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (inflating ? 14 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Inflation trading — volatility expansion + momentum inflation proxy',
      inflating ? `ATR expanded ${(atrNow / Math.max(atrPrev, 0.00001)).toFixed(2)}×` : 'No inflationary vol expansion',
      `Momentum ${momentum.toFixed(2)}%`,
      decision === 'sell' ? 'Inflationary pressure fade short' : decision === 'buy' ? 'Disinflation reversal long' : 'No inflation regime entry',
    ],
    metrics: {
      atrRatio: Number((atrNow / Math.max(atrPrev, 0.00001)).toFixed(3)),
      momentumPct: Number(momentum.toFixed(3)),
    },
  });
};

export const evaluateEmploymentDataTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(12, parseNumber(config.quietBars, 22));
  const releaseBars = Math.max(2, parseNumber(config.releaseBars, 3));
  const minMovePct = parseNumber(config.minMovePct, 0.15);
  const quietWindow = candles.slice(-quietBars - releaseBars, -releaseBars);
  const releaseWindow = candles.slice(-releaseBars);
  const quietAvg = averageCandleRange(quietWindow);
  const releaseAvg = averageCandleRange(releaseWindow);
  const closes = candles.map((item) => item.close);
  const movePct = rocPct(closes, releaseBars);
  const expanding = quietAvg > 0 && releaseAvg / quietAvg >= 1.25;
  let bias: StrategyBias = movePct > 0 ? 'bullish' : movePct < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  const last = candles[candles.length - 1]!;
  if (expanding && movePct >= minMovePct && last.close > last.open) decision = 'buy';
  if (expanding && movePct <= -minMovePct && last.close < last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'employment-data-trading',
    context,
    config: { ...config, quietBars, releaseBars, minMovePct },
    candles,
    decision,
    bias,
    confidence: 34 + (expanding ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `Employment data trading — ${releaseBars}-bar release window after ${quietBars}-bar quiet base`,
      expanding ? `Release expansion ${(releaseAvg / Math.max(quietAvg, 0.00001)).toFixed(2)}×` : 'No employment release expansion',
      `Move ${movePct.toFixed(2)}% (min ±${minMovePct}%)`,
      decision === 'buy' ? 'Strong employment data long' : decision === 'sell' ? 'Weak employment data short' : 'Awaiting employment release entry',
    ],
    metrics: {
      movePct: Number(movePct.toFixed(3)),
      expansionMultiple: Number((releaseAvg / Math.max(quietAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateGeopoliticalTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const spikeMultiple = parseNumber(config.spikeMultiple, 1.75);
  const minWickPct = parseNumber(config.minWickPct, 40);
  const window = candles.slice(-lookback, -1);
  const baseline = averageCandleRange(window);
  const last = candles[candles.length - 1]!;
  const lastRange = last.high - last.low;
  const spike = baseline > 0 && lastRange / baseline >= spikeMultiple;
  const range = Math.max(lastRange, 0.00001);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const wickPct = (Math.max(upperWick, lowerWick) / range) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (spike && wickPct >= minWickPct && lowerWick > upperWick && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (spike && wickPct >= minWickPct && upperWick > lowerWick && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (spike) {
    bias = last.close < last.open ? 'bearish' : 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'geopolitical-trading',
    context,
    config: { ...config, lookback, spikeMultiple, minWickPct },
    candles,
    decision,
    bias,
    confidence: 33 + (spike ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      'Geopolitical trading — risk spike bar with rejection wick after stable baseline',
      spike ? `Vol spike ${(lastRange / Math.max(baseline, 0.00001)).toFixed(2)}× baseline` : 'No geopolitical vol spike',
      `Rejection wick ${wickPct.toFixed(0)}%`,
      decision === 'buy' ? 'Geopolitical dip-buy rejection long' : decision === 'sell' ? 'Geopolitical risk-off short' : 'Awaiting geopolitical spike resolution',
    ],
    metrics: {
      spikeMultiple: Number((lastRange / Math.max(baseline, 0.00001)).toFixed(2)),
      wickPct: Number(wickPct.toFixed(1)),
    },
  });
};

export const evaluateTradeBalanceTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendBars = Math.max(30, parseNumber(config.trendBars, 55));
  const minTrendPct = parseNumber(config.minTrendPct, 1.4);
  const adxPeriod = Math.max(10, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 22);
  const closes = candles.map((item) => item.close);
  const trend = rocPct(closes, trendBars);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const adxNow = adxSeries[candles.length - 1];
  const strong = adxNow != null && adxNow >= adxThreshold;
  let bias: StrategyBias = trend > 0 ? 'bullish' : trend < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  const last = candles[candles.length - 1]!;
  if (strong && trend >= minTrendPct && last.close > last.open) decision = 'buy';
  if (strong && trend <= -minTrendPct && last.close < last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'trade-balance-trading',
    context,
    config: { ...config, trendBars, minTrendPct, adxPeriod, adxThreshold },
    candles,
    decision,
    bias,
    confidence: 36 + (strong ? 12 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Trade balance trading — sustained current-account trend strength proxy',
      `Trend ${trend.toFixed(2)}% over ${trendBars} bars · ADX ${adxNow?.toFixed(1) ?? 'n/a'}`,
      decision === 'buy' ? 'Surplus trend long — export strength' : decision === 'sell' ? 'Deficit trend short — import pressure' : 'No trade balance trend entry',
    ],
    metrics: {
      trendPct: Number(trend.toFixed(3)),
      adx: adxNow != null ? Number(adxNow.toFixed(1)) : null,
    },
  });
};

export const evaluateYieldDifferentialTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastRocBars = Math.max(15, parseNumber(config.fastRocBars, 25));
  const slowRocBars = Math.max(fastRocBars + 10, parseNumber(config.slowRocBars, 55));
  const minSpreadPct = parseNumber(config.minSpreadPct, 0.75);
  const closes = candles.map((item) => item.close);
  const fastRoc = rocPct(closes, fastRocBars);
  const slowRoc = rocPct(closes, slowRocBars);
  const spread = fastRoc - slowRoc;
  let bias: StrategyBias = spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (spread >= minSpreadPct && fastRoc > 0) decision = 'buy';
  if (spread <= -minSpreadPct && fastRoc < 0) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'yield-differential-trading',
    context,
    config: { ...config, fastRocBars, slowRocBars, minSpreadPct },
    candles,
    decision,
    bias,
    confidence: 36 + (Math.abs(spread) >= minSpreadPct ? 16 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      'Yield differential trading — fast vs slow ROC spread as yield gap proxy',
      `Fast ROC ${fastRoc.toFixed(2)}% · slow ROC ${slowRoc.toFixed(2)}% · spread ${spread.toFixed(2)}%`,
      decision === 'buy' ? 'Widening yield differential long' : decision === 'sell' ? 'Narrowing yield differential short' : 'Spread below entry threshold',
    ],
    metrics: {
      spreadPct: Number(spread.toFixed(3)),
      fastRocPct: Number(fastRoc.toFixed(3)),
      slowRocPct: Number(slowRoc.toFixed(3)),
    },
  });
};

export const evaluateMonetaryPolicyStrategyEngine: StrategyEngine = (candles, config, context) => {
  const fastTarget = Math.max(30, parseNumber(config.fastPeriod, 50));
  const slowTarget = Math.max(fastTarget + 20, parseNumber(config.slowPeriod, 100));
  const driftBars = Math.max(25, parseNumber(config.driftBars, 45));
  const stack = emaStackBias(candles, fastTarget, slowTarget);
  const drift = rocPct(candles.map((item) => item.close), driftBars);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = stack.bias;
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && drift > 0 && last.close > stack.fast!) decision = 'buy';
  if (stack.bias === 'bearish' && drift < 0 && last.close < stack.fast!) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'monetary-policy-strategy',
    context,
    config: { ...config, fastPeriod: stack.fastPeriod, slowPeriod: stack.slowPeriod, driftBars },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 28 : 8),
    reasons: [
      `Monetary policy strategy — EMA(${stack.fastPeriod}/${stack.slowPeriod}) + ${driftBars}-bar policy drift`,
      `Policy drift ${drift.toFixed(2)}% · slope ${stack.slopePct.toFixed(3)}%`,
      decision === 'buy' ? 'Accommodative policy drift long' : decision === 'sell' ? 'Restrictive policy drift short' : 'Policy bias without entry trigger',
    ],
    metrics: {
      driftPct: Number(drift.toFixed(3)),
      emaSlopePct: Number(stack.slopePct.toFixed(4)),
    },
  });
};

export const evaluateRiskOnRiskOffTradingEngine: StrategyEngine = (candles, config, context) => {
  const momentumBars = Math.max(10, parseNumber(config.momentumBars, 20));
  const volLookback = Math.max(15, parseNumber(config.volLookback, 30));
  const riskOnThreshold = parseNumber(config.riskOnThreshold, 0.9);
  const closes = candles.map((item) => item.close);
  const momentum = rocPct(closes, momentumBars);
  const atrSeries = atr(candles, 14);
  const last = candles.length - 1;
  const atrNow = atrSeries[last] ?? 0;
  const atrPrev = atrSeries[Math.max(0, last - volLookback)] ?? atrNow;
  const volChange = atrPrev > 0 ? (atrNow - atrPrev) / atrPrev : 0;
  const riskOnScore = momentum - volChange * 100;
  let bias: StrategyBias = riskOnScore > 0 ? 'bullish' : riskOnScore < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  const lastCandle = candles[last]!;
  if (riskOnScore >= riskOnThreshold && lastCandle.close > lastCandle.open) decision = 'buy';
  if (riskOnScore <= -riskOnThreshold && lastCandle.close < lastCandle.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'risk-on-risk-off-trading',
    context,
    config: { ...config, momentumBars, volLookback, riskOnThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 0) + Math.min(18, Math.abs(riskOnScore) * 8),
    reasons: [
      'Risk-on / risk-off — momentum minus volatility penalty score',
      `Risk score ${riskOnScore.toFixed(2)} (threshold ±${riskOnThreshold}) · momentum ${momentum.toFixed(2)}%`,
      volChange > 0 ? `Vol rising ${(volChange * 100).toFixed(1)}% — risk-off pressure` : `Vol stable/falling — risk-on supportive`,
      decision === 'buy' ? 'Risk-on long — momentum with contained vol' : decision === 'sell' ? 'Risk-off short — negative momentum + vol stress' : 'Risk regime neutral',
    ],
    metrics: {
      riskOnScore: Number(riskOnScore.toFixed(3)),
      momentumPct: Number(momentum.toFixed(3)),
      volChangePct: Number((volChange * 100).toFixed(2)),
    },
  });
};
