import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, ema, rsi, sma } from './indicators';

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

export const evaluateMacroTrendTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastTarget = Math.max(50, parseNumber(config.fastPeriod, 100));
  const slowTarget = Math.max(fastTarget + 20, parseNumber(config.slowPeriod, 200));
  const adxPeriod = Math.max(10, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 22);
  const stack = emaStackBias(candles, fastTarget, slowTarget);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const adxNow = adxSeries[candles.length - 1];
  const strong = adxNow != null && adxNow >= adxThreshold;
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && strong) decision = 'buy';
  if (stack.bias === 'bearish' && strong) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'macro-trend-trading',
    context,
    config: { ...config, fastPeriod: stack.fastPeriod, slowPeriod: stack.slowPeriod, adxPeriod, adxThreshold },
    candles,
    decision,
    bias: stack.bias,
    confidence: 40 + (strong ? 14 : 0) + (decision !== 'wait' ? 28 : 6),
    reasons: [
      `Macro trend — EMA(${stack.fastPeriod}/${stack.slowPeriod}) on ${context.timeframe} with ADX(${adxPeriod}) filter`,
      strong ? `Directional macro regime ADX ${adxNow!.toFixed(1)}` : 'Macro trend strength below threshold',
      decision === 'buy' ? 'Long macro trend alignment' : decision === 'sell' ? 'Short macro trend alignment' : 'Macro trend not actionable',
    ],
    metrics: {
      fastEma: stack.fast != null ? Number(stack.fast.toFixed(5)) : null,
      slowEma: stack.slow != null ? Number(stack.slow.toFixed(5)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
      emaSlopePct: Number(stack.slopePct.toFixed(4)),
    },
  });
};

export const evaluateFundamentalPositionTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendTarget = Math.max(60, parseNumber(config.trendPeriod, 100));
  const consolidationBars = Math.max(15, parseNumber(config.consolidationBars, 30));
  const expansionRatio = parseNumber(config.expansionRatio, 1.25);
  const stack = emaStackBias(candles, trendTarget, trendTarget + 40);
  const baseline = candles.slice(-consolidationBars - 1, -1);
  const recent = candles.slice(-3);
  const baselineAvg = averageCandleRange(baseline);
  const recentAvg = averageCandleRange(recent);
  const expanding = baselineAvg > 0 && recentAvg / baselineAvg >= expansionRatio;
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && expanding && last.close > last.open) decision = 'buy';
  if (stack.bias === 'bearish' && expanding && last.close < last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'fundamental-position-trading',
    context,
    config: { ...config, trendPeriod: stack.fastPeriod, consolidationBars, expansionRatio },
    candles,
    decision,
    bias: stack.bias,
    confidence: 36 + (expanding ? 14 : 0) + (decision !== 'wait' ? 28 : 6),
    reasons: [
      'Fundamental position proxy — macro EMA bias + post-consolidation expansion',
      expanding
        ? `Range expanding ${(recentAvg / Math.max(baselineAvg, 0.00001)).toFixed(2)}× after ${consolidationBars}-bar base`
        : 'No fundamental-style expansion phase detected',
      decision === 'buy' ? 'Long position on bullish macro expansion' : decision === 'sell' ? 'Short position on bearish macro expansion' : 'Awaiting macro expansion confirmation',
    ],
    metrics: {
      trendEma: stack.fast != null ? Number(stack.fast.toFixed(5)) : null,
      expansionMultiple: Number((recentAvg / Math.max(baselineAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateCarryTradeStrategyEngine: StrategyEngine = (candles, config, context) => {
  const trendTarget = Math.max(40, parseNumber(config.trendPeriod, 80));
  const rocBars = Math.max(20, parseNumber(config.rocBars, 40));
  const minRocPct = parseNumber(config.minRocPct, 1.5);
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const prior = closes[Math.max(0, last - rocBars)]!;
  const rocPct = prior !== 0 ? ((closes[last]! - prior) / prior) * 100 : 0;
  const stack = emaStackBias(candles, trendTarget, trendTarget + 30);
  const window = candles.slice(-rocBars);
  const higherLows = window.length >= 4
    && window.slice(-Math.floor(window.length / 2)).every((candle, index, slice) => index === 0 || candle.low >= slice[index - 1]!.low * 0.998);
  const lowerHighs = window.length >= 4
    && window.slice(-Math.floor(window.length / 2)).every((candle, index, slice) => index === 0 || candle.high <= slice[index - 1]!.high * 1.002);
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && rocPct >= minRocPct && higherLows) decision = 'buy';
  if (stack.bias === 'bearish' && rocPct <= -minRocPct && lowerHighs) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'carry-trade-strategy',
    context,
    config: { ...config, trendPeriod: stack.fastPeriod, rocBars, minRocPct },
    candles,
    decision,
    bias: stack.bias,
    confidence: 38 + (Math.abs(rocPct) >= minRocPct ? 14 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      `Carry trade proxy — sustained ${rocBars}-bar drift + EMA(${stack.fastPeriod}) trend filter`,
      `ROC ${rocPct.toFixed(2)}% (min ${minRocPct}%)`,
      decision === 'buy' ? 'Positive carry drift long — higher lows intact' : decision === 'sell' ? 'Negative carry drift short — lower highs intact' : 'No carry-style drift entry',
    ],
    metrics: { rocPct: Number(rocPct.toFixed(3)) },
  });
};

export const evaluateLongTermTrendFollowingEngine: StrategyEngine = (candles, config, context) => {
  const fastTarget = Math.max(40, parseNumber(config.fastPeriod, 50));
  const slowTarget = Math.max(80, parseNumber(config.slowPeriod, 100));
  const structureLookback = Math.max(30, parseNumber(config.structureLookback, 60));
  const stack = emaStackBias(candles, fastTarget, slowTarget);
  const window = candles.slice(-structureLookback);
  const swingHigh = Math.max(...window.map((item) => item.high));
  const swingLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && last.close > swingHigh * 0.998 && last.close > stack.fast!) decision = 'buy';
  if (stack.bias === 'bearish' && last.close < swingLow * 1.002 && last.close < stack.fast!) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'long-term-trend-following',
    context,
    config: { ...config, fastPeriod: stack.fastPeriod, slowPeriod: stack.slowPeriod, structureLookback },
    candles,
    decision,
    bias: stack.bias,
    confidence: 40 + (decision !== 'wait' ? 28 : 8),
    reasons: [
      `Long-term trend follow — EMA(${stack.fastPeriod}/${stack.slowPeriod}) + ${structureLookback}-bar structure`,
      decision === 'buy' ? 'Bullish long-term trend with structure support' : decision === 'sell' ? 'Bearish long-term trend with structure breakdown' : 'Long-term trend staged — no entry trigger',
    ],
    metrics: {
      swingHigh: Number(swingHigh.toFixed(5)),
      swingLow: Number(swingLow.toFixed(5)),
    },
  });
};

export const evaluateEconomicCycleTradingEngine: StrategyEngine = (candles, config, context) => {
  const shortTarget = Math.max(20, parseNumber(config.shortPeriod, 30));
  const longTarget = Math.max(60, parseNumber(config.longPeriod, 90));
  const closes = candles.map((item) => item.close);
  const shortPeriod = adaptiveEmaPeriod(shortTarget, closes.length, 15);
  const longPeriod = adaptiveEmaPeriod(longTarget, closes.length, shortPeriod + 15);
  const shortMa = sma(closes, shortPeriod);
  const longMa = sma(closes, longPeriod);
  const last = closes.length - 1;
  const shortNow = shortMa[last];
  const longNow = longMa[last];
  const shortPrev = shortMa[Math.max(0, last - 15)];
  const longPrev = longMa[Math.max(0, last - 15)];
  const expansion = shortNow != null && longNow != null && shortPrev != null && longPrev != null
    && shortNow > longNow && shortNow > shortPrev && longNow > longPrev;
  const contraction = shortNow != null && longNow != null && shortPrev != null && longPrev != null
    && shortNow < longNow && shortNow < shortPrev && longNow < longPrev;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (expansion) {
    bias = 'bullish';
    decision = 'buy';
  } else if (contraction) {
    bias = 'bearish';
    decision = 'sell';
  } else if (shortNow != null && longNow != null) {
    bias = shortNow > longNow ? 'bullish' : 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'economic-cycle-trading',
    context,
    config: { ...config, shortPeriod, longPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Economic cycle proxy — SMA(${shortPeriod}/${longPeriod}) expansion/contraction phase on ${context.timeframe}`,
      expansion ? 'Expansion phase — cyclical long bias' : contraction ? 'Contraction phase — cyclical short bias' : 'Transitional cycle phase',
    ],
    metrics: {
      shortMa: shortNow != null ? Number(shortNow.toFixed(5)) : null,
      longMa: longNow != null ? Number(longNow.toFixed(5)) : null,
    },
  });
};

export const evaluateCentralBankPolicyTradingEngine: StrategyEngine = (candles, config, context) => {
  const driftBars = Math.max(30, parseNumber(config.driftBars, 60));
  const quietBars = Math.max(10, parseNumber(config.quietBars, 20));
  const minDriftPct = parseNumber(config.minDriftPct, 2);
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const driftStart = closes[Math.max(0, last - driftBars)]!;
  const driftPct = driftStart !== 0 ? ((closes[last]! - driftStart) / driftStart) * 100 : 0;
  const quietWindow = candles.slice(Math.max(0, last - quietBars - 10), Math.max(0, last - 10));
  const recentWindow = candles.slice(-10);
  const quietAvg = averageCandleRange(quietWindow);
  const recentAvg = averageCandleRange(recentWindow);
  const policyDrift = Math.abs(driftPct) >= minDriftPct && recentAvg <= quietAvg * 1.15;
  let bias: StrategyBias = driftPct > 0 ? 'bullish' : driftPct < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  const lastCandle = candles[last]!;
  if (policyDrift && driftPct >= minDriftPct && lastCandle.close >= lastCandle.open) decision = 'buy';
  if (policyDrift && driftPct <= -minDriftPct && lastCandle.close <= lastCandle.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'central-bank-policy-trading',
    context,
    config: { ...config, driftBars, quietBars, minDriftPct },
    candles,
    decision,
    bias,
    confidence: 34 + (policyDrift ? 16 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      `Central bank policy proxy — ${driftBars}-bar policy drift with low-volatility glide path`,
      `Drift ${driftPct.toFixed(2)}% over ${driftBars} bars (min ${minDriftPct}%)`,
      decision === 'buy' ? 'Dovish drift long — sustained bid with controlled volatility' : decision === 'sell' ? 'Hawkish drift short — sustained offer with controlled volatility' : 'No policy drift entry',
    ],
    metrics: { driftPct: Number(driftPct.toFixed(3)) },
  });
};

export const evaluateInterestRateDifferentialStrategyEngine: StrategyEngine = (candles, config, context) => {
  const fastRocBars = Math.max(15, parseNumber(config.fastRocBars, 25));
  const slowRocBars = Math.max(fastRocBars + 10, parseNumber(config.slowRocBars, 60));
  const minSpreadPct = parseNumber(config.minSpreadPct, 0.8);
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const fastStart = closes[Math.max(0, last - fastRocBars)]!;
  const slowStart = closes[Math.max(0, last - slowRocBars)]!;
  const fastRoc = fastStart !== 0 ? ((closes[last]! - fastStart) / fastStart) * 100 : 0;
  const slowRoc = slowStart !== 0 ? ((closes[last]! - slowStart) / slowStart) * 100 : 0;
  const spread = fastRoc - slowRoc;
  let bias: StrategyBias = spread > 0 ? 'bullish' : spread < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (spread >= minSpreadPct && fastRoc > 0) decision = 'buy';
  if (spread <= -minSpreadPct && fastRoc < 0) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'interest-rate-differential-strategy',
    context,
    config: { ...config, fastRocBars, slowRocBars, minSpreadPct },
    candles,
    decision,
    bias,
    confidence: 36 + (Math.abs(spread) >= minSpreadPct ? 16 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      'Rate differential proxy — fast vs slow ROC spread as carry momentum',
      `Fast ROC ${fastRoc.toFixed(2)}% · slow ROC ${slowRoc.toFixed(2)}% · spread ${spread.toFixed(2)}%`,
      decision === 'buy' ? 'Positive differential long — accelerating outperformance' : decision === 'sell' ? 'Negative differential short — decelerating underperformance' : 'Differential below entry threshold',
    ],
    metrics: {
      fastRoc: Number(fastRoc.toFixed(3)),
      slowRoc: Number(slowRoc.toFixed(3)),
      spread: Number(spread.toFixed(3)),
    },
  });
};

export const evaluateInflationBasedPositionTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendTarget = Math.max(50, parseNumber(config.trendPeriod, 80));
  const impulseRatio = parseNumber(config.impulseRatio, 1.4);
  const rsiPeriod = Math.max(10, parseNumber(config.rsiPeriod, 14));
  const stack = emaStackBias(candles, trendTarget, trendTarget + 35);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const atrNow = atrSeries[lastIndex] ?? averageCandleRange(candles.slice(-14));
  const lastRange = last.high - last.low;
  const expanding = atrNow > 0 && lastRange >= atrNow * impulseRatio;
  const rsiSeries = rsi(candles.map((item) => item.close), rsiPeriod);
  const rsiNow = rsiSeries[lastIndex];
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && expanding && rsiNow != null && rsiNow >= 55 && last.close > last.open) decision = 'buy';
  if (stack.bias === 'bearish' && expanding && rsiNow != null && rsiNow <= 45 && last.close < last.open) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'inflation-based-position-trading',
    context,
    config: { ...config, trendPeriod: stack.fastPeriod, impulseRatio, rsiPeriod },
    candles,
    decision,
    bias: stack.bias,
    confidence: 36 + (expanding ? 12 : 0) + (decision !== 'wait' ? 28 : 0),
    reasons: [
      'Inflation hedge proxy — macro trend + volatility expansion + momentum confirmation',
      expanding ? `Impulse bar ${(lastRange / Math.max(atrNow, 0.00001)).toFixed(2)}× ATR` : 'No inflation-style expansion bar',
      decision === 'buy' ? 'Long inflation-hedge momentum position' : decision === 'sell' ? 'Short inflation-relief momentum position' : 'No inflation-based position trigger',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      expansionAtr: Number((lastRange / Math.max(atrNow, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateCommodityCurrencyPositionTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendTarget = Math.max(40, parseNumber(config.trendPeriod, 70));
  const momentumBars = Math.max(15, parseNumber(config.momentumBars, 30));
  const adxPeriod = Math.max(10, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 20);
  const stack = emaStackBias(candles, trendTarget, trendTarget + 30);
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const momentumStart = closes[Math.max(0, last - momentumBars)]!;
  const momentumPct = momentumStart !== 0 ? ((closes[last]! - momentumStart) / momentumStart) * 100 : 0;
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const adxNow = adxSeries[last];
  const strong = adxNow != null && adxNow >= adxThreshold;
  let decision: StrategySignalSide = 'wait';
  if (stack.bias === 'bullish' && momentumPct > 0 && strong) decision = 'buy';
  if (stack.bias === 'bearish' && momentumPct < 0 && strong) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'commodity-currency-position-trading',
    context,
    config: { ...config, trendPeriod: stack.fastPeriod, momentumBars, adxPeriod, adxThreshold },
    candles,
    decision,
    bias: stack.bias,
    confidence: 38 + (strong ? 12 : 0) + (decision !== 'wait' ? 26 : 0),
    reasons: [
      `Commodity currency proxy — EMA(${stack.fastPeriod}) trend + ${momentumBars}-bar commodity momentum + ADX`,
      `Momentum ${momentumPct.toFixed(2)}% · ADX ${adxNow?.toFixed(1) ?? 'n/a'}`,
      decision === 'buy' ? 'Long commodity-linked currency strength' : decision === 'sell' ? 'Short commodity-linked currency weakness' : 'No commodity currency position signal',
    ],
    metrics: {
      momentumPct: Number(momentumPct.toFixed(3)),
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
    },
  });
};
