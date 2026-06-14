import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import {
  adx,
  atr,
  bollinger,
  crossover,
  donchian,
  ema,
  ichimoku,
  macd,
  rsi,
  sma,
} from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function medianPrice(candle: StrategyPriceCandle): number {
  return (candle.high + candle.low) / 2;
}

function smmaSeries(values: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: values.length }, () => null);
  if (period <= 0 || values.length < period) return series;
  let sum = values.slice(0, period).reduce((acc, value) => acc + value, 0);
  let prev = sum / period;
  series[period - 1] = prev;
  for (let index = period; index < values.length; index += 1) {
    prev = (prev * (period - 1) + values[index]!) / period;
    series[index] = prev;
  }
  return series;
}

function cciSeries(candles: StrategyPriceCandle[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: candles.length }, () => null);
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const typical = window.map((item) => (item.high + item.low + item.close) / 3);
    const mean = typical.reduce((sum, value) => sum + value, 0) / period;
    const meanDev = typical.reduce((sum, value) => sum + Math.abs(value - mean), 0) / period;
    const current = typical.at(-1)!;
    series[index] = meanDev === 0 ? 0 : (current - mean) / (0.015 * meanDev);
  }
  return series;
}

function williamsRSeries(candles: StrategyPriceCandle[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: candles.length }, () => null);
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const range = highest - lowest;
    series[index] = range === 0 ? -50 : ((highest - candles[index]!.close) / range) * -100;
  }
  return series;
}

function momentumSeries(closes: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  for (let index = period; index < closes.length; index += 1) {
    const prior = closes[index - period]!;
    series[index] = prior === 0 ? 0 : ((closes[index]! - prior) / prior) * 100;
  }
  return series;
}

function parabolicSarSeries(
  candles: StrategyPriceCandle[],
  step: number,
  maxStep: number,
): { sar: Array<number | null>; trend: Array<'bullish' | 'bearish' | null> } {
  const sar: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const trend: Array<'bullish' | 'bearish' | null> = Array.from({ length: candles.length }, () => null);
  if (candles.length < 3) return { sar, trend };

  let isLong = candles[1]!.close >= candles[0]!.close;
  let af = step;
  let ep = isLong ? Math.max(candles[0]!.high, candles[1]!.high) : Math.min(candles[0]!.low, candles[1]!.low);
  let currentSar = isLong ? Math.min(candles[0]!.low, candles[1]!.low) : Math.max(candles[0]!.high, candles[1]!.high);

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index]!;
    const prevSar = currentSar;
    currentSar = prevSar + af * (ep - prevSar);

    if (isLong) {
      currentSar = Math.min(currentSar, candles[index - 1]!.low, index > 1 ? candles[index - 2]!.low : candles[index - 1]!.low);
      if (candle.low < currentSar) {
        isLong = false;
        currentSar = ep;
        ep = candle.low;
        af = step;
      } else if (candle.high > ep) {
        ep = candle.high;
        af = Math.min(maxStep, af + step);
      }
    } else {
      currentSar = Math.max(currentSar, candles[index - 1]!.high, index > 1 ? candles[index - 2]!.high : candles[index - 1]!.high);
      if (candle.high > currentSar) {
        isLong = true;
        currentSar = ep;
        ep = candle.high;
        af = step;
      } else if (candle.low < ep) {
        ep = candle.low;
        af = Math.min(maxStep, af + step);
      }
    }

    sar[index] = currentSar;
    trend[index] = isLong ? 'bullish' : 'bearish';
  }

  return { sar, trend };
}

function keltnerSeries(
  candles: StrategyPriceCandle[],
  period: number,
  multiplier: number,
): { middle: Array<number | null>; upper: Array<number | null>; lower: Array<number | null> } {
  const closes = candles.map((item) => item.close);
  const middle = ema(closes, period);
  const atrSeries = atr(candles, period);
  const upper: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const lower: Array<number | null> = Array.from({ length: candles.length }, () => null);
  for (let index = 0; index < candles.length; index += 1) {
    if (middle[index] != null && atrSeries[index] != null) {
      upper[index] = middle[index]! + multiplier * atrSeries[index]!;
      lower[index] = middle[index]! - multiplier * atrSeries[index]!;
    }
  }
  return { middle, upper, lower };
}

export const evaluateMacdStrategyEngine: StrategyEngine = (candles, config, context) => {
  const closes = candles.map((item) => item.close);
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(3, parseNumber(config.signalPeriod, 9));
  const { macd: macdLine, signal, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = closes.length - 1;
  const cross = crossover(macdLine[last - 1], macdLine[last], signal[last - 1], signal[last]);
  const hist = histogram[last];
  let bias: StrategyBias = hist != null && hist > 0 ? 'bullish' : hist != null && hist < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (cross === 'bullish_cross') decision = 'buy';
  else if (cross === 'bearish_cross') decision = 'sell';
  else if (hist != null && hist > 0 && macdLine[last] != null && macdLine[last]! > 0) decision = 'buy';
  else if (hist != null && hist < 0 && macdLine[last] != null && macdLine[last]! < 0) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'macd-strategy',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 38 + (cross !== 'none' ? 28 : 0) + Math.min(18, Math.abs(hist ?? 0) * 8000),
    reasons: [
      `MACD(${fastPeriod},${slowPeriod},${signalPeriod}) signal-line crossover model`,
      cross !== 'none' ? `Fresh ${cross.replace('_', ' ')}` : 'No fresh MACD crossover on latest bar',
      hist != null && hist > 0 ? 'Positive histogram — bullish momentum' : hist != null && hist < 0 ? 'Negative histogram — bearish momentum' : 'Histogram neutral',
    ],
    metrics: {
      macd: macdLine[last] != null ? Number(macdLine[last]!.toFixed(6)) : null,
      signal: signal[last] != null ? Number(signal[last]!.toFixed(6)) : null,
      histogram: hist != null ? Number(hist.toFixed(6)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'MACD / signal crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateBollingerBandsStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const last = closes.length - 1;
  const close = closes[last]!;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const middle = bands.middle[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (upper != null && lower != null && middle != null) {
    if (close <= lower) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close >= upper) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close > middle) {
      bias = 'bullish';
    } else if (close < middle) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'bollinger-bands-strategy',
    context,
    config: { ...config, period, stdDev },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6) + (bands.bandwidth[last] != null ? Math.min(12, bands.bandwidth[last]!) : 0),
    reasons: [
      `Bollinger Bands(${period}, ${stdDev}) touch / mean-reversion model`,
      upper != null && lower != null ? `Close ${close.toFixed(5)} vs bands ${lower.toFixed(5)} – ${upper.toFixed(5)}` : 'Bands unavailable',
      decision === 'buy' ? 'Price at lower band — snap-back long bias' : decision === 'sell' ? 'Price at upper band — fade short bias' : 'Price inside bands — no extreme touch',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      middle: middle != null ? Number(middle.toFixed(5)) : null,
      bandwidth: bands.bandwidth[last] != null ? Number(bands.bandwidth[last]!.toFixed(3)) : null,
    },
  });
};

export const evaluateAtrStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const expansionRatio = parseNumber(config.expansionRatio, 1.25);
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const atrSeries = atr(candles, period);
  const last = candles.length - 1;
  const atrNow = atrSeries[last];
  const atrPrev = atrSeries[Math.max(0, last - lookback)];
  const window = candles.slice(-lookback);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const close = candles[last]!.close;
  const expanding = atrNow != null && atrPrev != null && atrPrev > 0 && atrNow / atrPrev >= expansionRatio;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (expanding) {
    if (close > rangeHigh) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close < rangeLow) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close > (rangeHigh + rangeLow) / 2) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'atr-strategy',
    context,
    config: { ...config, period, expansionRatio, lookback },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 4) + (expanding ? 12 : 0),
    reasons: [
      `ATR(${period}) volatility expansion breakout over ${lookback} bars`,
      atrNow != null && atrPrev != null ? `ATR ${atrNow.toFixed(5)} vs ${atrPrev.toFixed(5)} (${expanding ? 'expanding' : 'contracting'})` : 'ATR unavailable',
      decision === 'buy' ? 'Volatility expansion with close above range high' : decision === 'sell' ? 'Volatility expansion with close below range low' : 'No ATR expansion breakout',
    ],
    metrics: {
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
      expansion: atrNow != null && atrPrev != null && atrPrev > 0 ? Number((atrNow / atrPrev).toFixed(2)) : null,
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
    },
  });
};

export const evaluateAdxStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const threshold = parseNumber(config.threshold, 25);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, period);
  const last = candles.length - 1;
  const adxValue = adxSeries[last];
  const pdi = plusDi[last];
  const mdi = minusDi[last];
  const strongTrend = adxValue != null && adxValue >= threshold;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (pdi != null && mdi != null) {
    bias = pdi > mdi ? 'bullish' : pdi < mdi ? 'bearish' : 'neutral';
    if (strongTrend && bias === 'bullish') decision = 'buy';
    if (strongTrend && bias === 'bearish') decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'adx-strategy',
    context,
    config: { ...config, period, threshold },
    candles,
    decision,
    bias,
    confidence: 34 + (strongTrend ? 28 : 0) + (adxValue != null ? Math.min(22, adxValue / 2) : 0),
    reasons: [
      `ADX(${period}) directional strength filter (threshold ${threshold})`,
      adxValue != null ? `ADX ${adxValue.toFixed(1)} · +DI ${pdi?.toFixed(1) ?? '—'} / -DI ${mdi?.toFixed(1) ?? '—'}` : 'ADX unavailable',
      decision === 'buy' ? 'Strong trend with +DI dominance — long' : decision === 'sell' ? 'Strong trend with -DI dominance — short' : strongTrend ? 'Trend strong but DI conflict' : 'Trend strength below threshold',
    ],
    metrics: {
      adx: adxValue != null ? Number(adxValue.toFixed(2)) : null,
      plusDi: pdi != null ? Number(pdi.toFixed(2)) : null,
      minusDi: mdi != null ? Number(mdi.toFixed(2)) : null,
    },
  });
};

export const evaluateCciStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const oversold = parseNumber(config.oversold, -100);
  const overbought = parseNumber(config.overbought, 100);
  const cciValues = cciSeries(candles, period);
  const last = candles.length - 1;
  const value = cciValues[last];
  const prev = cciValues[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (value != null) {
    if (value >= 50) bias = 'bullish';
    else if (value <= -50) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'cci-strategy',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (value != null ? Math.min(16, Math.abs(value) / 8) : 0),
    reasons: [
      `CCI(${period}) cyclical momentum (${oversold}/${overbought} bands)`,
      value != null ? `Current CCI ${value.toFixed(1)}` : 'CCI unavailable',
      decision === 'buy' ? 'Bullish reversal from oversold CCI zone' : decision === 'sell' ? 'Bearish reversal from overbought CCI zone' : 'No CCI band rejection',
    ],
    metrics: { cci: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateParabolicSarStrategyEngine: StrategyEngine = (candles, config, context) => {
  const step = parseNumber(config.step, 0.02);
  const maxStep = parseNumber(config.maxStep, 0.2);
  const { sar, trend } = parabolicSarSeries(candles, step, maxStep);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const sarNow = sar[last];
  const sarPrev = sar[last - 1];
  const trendNow = trend[last];
  const trendPrev = trend[last - 1];
  const flipped = trendNow != null && trendPrev != null && trendNow !== trendPrev;
  let bias: StrategyBias = trendNow === 'bullish' ? 'bullish' : trendNow === 'bearish' ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (flipped && trendNow === 'bullish') decision = 'buy';
  else if (flipped && trendNow === 'bearish') decision = 'sell';
  else if (trendNow === 'bullish' && sarNow != null && close > sarNow) decision = 'buy';
  else if (trendNow === 'bearish' && sarNow != null && close < sarNow) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'parabolic-sar-strategy',
    context,
    config: { ...config, step, maxStep },
    candles,
    decision,
    bias,
    confidence: 36 + (flipped ? 30 : decision !== 'wait' ? 18 : 0),
    reasons: [
      `Parabolic SAR(${step}/${maxStep}) trend-following stop-and-reverse`,
      sarNow != null ? `SAR ${sarNow.toFixed(5)} vs close ${close.toFixed(5)} (${trendNow ?? 'undefined'})` : 'SAR unavailable',
      flipped ? `Fresh flip to ${trendNow} regime` : decision !== 'wait' ? `Price aligned with ${trendNow} SAR` : 'No SAR flip or alignment signal',
    ],
    metrics: {
      sar: sarNow != null ? Number(sarNow.toFixed(5)) : null,
      trend: trendNow ?? null,
    },
    events: flipped
      ? [{ label: `${trendNow} flip`, detail: 'Parabolic SAR regime change', tone: trendNow === 'bullish' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateIchimokuStrategyEngine: StrategyEngine = (candles, config, context) => {
  const tenkanPeriod = Math.max(5, parseNumber(config.tenkanPeriod, 9));
  const kijunPeriod = Math.max(tenkanPeriod + 1, parseNumber(config.kijunPeriod, 26));
  const senkouBPeriod = Math.max(kijunPeriod + 1, parseNumber(config.senkouBPeriod, 52));
  const { tenkan, kijun, senkouA, senkouB } = ichimoku(candles, tenkanPeriod, kijunPeriod, senkouBPeriod, 26);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const spanA = senkouA[last];
  const spanB = senkouB[last];
  const tenkanNow = tenkan[last];
  const kijunNow = kijun[last];
  const cloudTop = spanA != null && spanB != null ? Math.max(spanA, spanB) : null;
  const cloudBottom = spanA != null && spanB != null ? Math.min(spanA, spanB) : null;
  const aboveCloud = cloudTop != null && close > cloudTop;
  const belowCloud = cloudBottom != null && close < cloudBottom;
  const tkCross = crossover(tenkan[last - 1], tenkanNow, kijun[last - 1], kijunNow);
  const tenkanAboveKijun = tenkanNow != null && kijunNow != null && tenkanNow > kijunNow;
  let bias: StrategyBias = aboveCloud ? 'bullish' : belowCloud ? 'bearish' : tenkanAboveKijun ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';

  if (tkCross === 'bullish_cross' && aboveCloud) decision = 'buy';
  else if (tkCross === 'bearish_cross' && belowCloud) decision = 'sell';
  else if (aboveCloud && tenkanAboveKijun) decision = 'buy';
  else if (belowCloud && tenkanNow != null && kijunNow != null && tenkanNow < kijunNow) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'ichimoku-strategy',
    context,
    config: { ...config, tenkanPeriod, kijunPeriod, senkouBPeriod },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 28 : 8) + (tkCross !== 'none' ? 10 : 0),
    reasons: [
      `Ichimoku(${tenkanPeriod}/${kijunPeriod}/${senkouBPeriod}) cloud + TK cross model`,
      aboveCloud ? 'Price above cloud — bullish regime' : belowCloud ? 'Price below cloud — bearish regime' : 'Price inside cloud — neutral',
      tkCross !== 'none' ? `Tenkan/Kijun ${tkCross.replace('_', ' ')}` : 'No fresh TK crossover',
    ],
    metrics: {
      tenkan: tenkanNow != null ? Number(tenkanNow.toFixed(5)) : null,
      kijun: kijunNow != null ? Number(kijunNow.toFixed(5)) : null,
      cloudTop: cloudTop != null ? Number(cloudTop.toFixed(5)) : null,
      cloudBottom: cloudBottom != null ? Number(cloudBottom.toFixed(5)) : null,
    },
    events: tkCross !== 'none'
      ? [{ label: tkCross.replace('_', ' '), detail: 'Tenkan / Kijun crossover', tone: tkCross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateMovingAverageStrategyEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 10));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 30));
  const maType = String(config.maType ?? 'ema');
  const closes = candles.map((item) => item.close);
  const fast = maType === 'sma' ? sma(closes, fastPeriod) : ema(closes, fastPeriod);
  const slow = maType === 'sma' ? sma(closes, slowPeriod) : ema(closes, slowPeriod);
  const last = closes.length - 1;
  const cross = crossover(fast[last - 1], fast[last], slow[last - 1], slow[last]);
  const close = closes[last]!;
  const fastNow = fast[last];
  const slowNow = slow[last];
  let bias: StrategyBias = fastNow != null && slowNow != null && fastNow > slowNow ? 'bullish' : fastNow != null && slowNow != null && fastNow < slowNow ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (cross === 'bullish_cross') decision = 'buy';
  else if (cross === 'bearish_cross') decision = 'sell';
  else if (fastNow != null && close > fastNow && fastNow > (slowNow ?? fastNow)) decision = 'buy';
  else if (fastNow != null && close < fastNow && fastNow < (slowNow ?? fastNow)) decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'moving-average-strategy',
    context,
    config: { ...config, fastPeriod, slowPeriod, maType },
    candles,
    decision,
    bias,
    confidence: 36 + (cross !== 'none' ? 28 : decision !== 'wait' ? 16 : 0),
    reasons: [
      `${maType.toUpperCase()}(${fastPeriod}/${slowPeriod}) crossover + price alignment`,
      cross !== 'none' ? `Fresh ${cross.replace('_', ' ')}` : 'No fresh MA crossover',
      decision === 'buy' ? 'Price above rising MA stack — long bias' : decision === 'sell' ? 'Price below falling MA stack — short bias' : 'Awaiting MA signal',
    ],
    metrics: {
      fastMa: fastNow != null ? Number(fastNow.toFixed(5)) : null,
      slowMa: slowNow != null ? Number(slowNow.toFixed(5)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'Moving average crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateKeltnerChannelStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const multiplier = parseNumber(config.multiplier, 1.5);
  const channels = keltnerSeries(candles, period, multiplier);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const upper = channels.upper[last];
  const lower = channels.lower[last];
  const middle = channels.middle[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (upper != null && lower != null && middle != null) {
    if (close >= upper) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close <= lower) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close > middle) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'keltner-channel-strategy',
    context,
    config: { ...config, period, multiplier },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Keltner Channel EMA(${period}) ± ${multiplier}× ATR breakout model`,
      upper != null && lower != null ? `Close ${close.toFixed(5)} vs channel ${lower.toFixed(5)} – ${upper.toFixed(5)}` : 'Channel unavailable',
      decision === 'buy' ? 'Close above upper Keltner — momentum long' : decision === 'sell' ? 'Close below lower Keltner — momentum short' : 'Price inside Keltner channel',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      middle: middle != null ? Number(middle.toFixed(5)) : null,
    },
  });
};

export const evaluateDonchianChannelStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(10, parseNumber(config.period, 20));
  const channels = donchian(candles, period);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const upper = channels.upper[last];
  const lower = channels.lower[last];
  const middle = channels.middle[last];
  const prevUpper = channels.upper[last - 1];
  const prevLower = channels.lower[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (upper != null && lower != null) {
    if (close >= upper) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close <= lower) {
      bias = 'bearish';
      decision = 'sell';
    } else if (prevUpper != null && close > prevUpper) {
      bias = 'bullish';
      decision = 'buy';
    } else if (prevLower != null && close < prevLower) {
      bias = 'bearish';
      decision = 'sell';
    } else if (middle != null && close > middle) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'donchian-channel-strategy',
    context,
    config: { ...config, period },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Donchian Channel(${period}) breakout / turtle-style model`,
      upper != null && lower != null ? `Channel ${lower.toFixed(5)} – ${upper.toFixed(5)}` : 'Channel unavailable',
      decision === 'buy' ? 'Breakout above Donchian upper — long' : decision === 'sell' ? 'Breakdown below Donchian lower — short' : 'No Donchian breakout',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      middle: middle != null ? Number(middle.toFixed(5)) : null,
    },
  });
};

export const evaluateMomentumIndicatorStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 12));
  const threshold = parseNumber(config.threshold, 0);
  const closes = candles.map((item) => item.close);
  const momentum = momentumSeries(closes, period);
  const last = closes.length - 1;
  const value = momentum[last];
  const prev = momentum[last - 1];
  let bias: StrategyBias = value != null && value > threshold ? 'bullish' : value != null && value < threshold ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (prev != null && value != null) {
    if (prev <= threshold && value > threshold) decision = 'buy';
    else if (prev >= threshold && value < threshold) decision = 'sell';
    else if (value > threshold && value > prev) decision = 'buy';
    else if (value < threshold && value < prev) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'momentum-indicator-strategy',
    context,
    config: { ...config, period, threshold },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 30 : 0) + (value != null ? Math.min(15, Math.abs(value)) : 0),
    reasons: [
      `Momentum ROC(${period}) zero-line crossover model`,
      value != null ? `Momentum ${value.toFixed(2)}% (threshold ${threshold})` : 'Momentum unavailable',
      decision === 'buy' ? 'Positive momentum acceleration — long' : decision === 'sell' ? 'Negative momentum acceleration — short' : 'Momentum near zero line',
    ],
    metrics: { momentum: value != null ? Number(value.toFixed(3)) : null },
  });
};

export const evaluateWilliamsRStrategyEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 14));
  const oversold = parseNumber(config.oversold, -80);
  const overbought = parseNumber(config.overbought, -20);
  const wrSeries = williamsRSeries(candles, period);
  const last = candles.length - 1;
  const value = wrSeries[last];
  const prev = wrSeries[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (value != null) {
    if (value >= -50) bias = 'bullish';
    else if (value <= -50) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'williams-r-strategy',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + (value != null ? Math.min(14, Math.abs(value + 50) / 4) : 0),
    reasons: [
      `Williams %R(${period}) oversold/overbought reversal (${oversold}/${overbought})`,
      value != null ? `Current %R ${value.toFixed(1)}` : 'Williams %R unavailable',
      decision === 'buy' ? 'Bullish reversal from oversold %R zone' : decision === 'sell' ? 'Bearish reversal from overbought %R zone' : 'No %R band rejection',
    ],
    metrics: { williamsR: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateTdiStrategyEngine: StrategyEngine = (candles, config, context) => {
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 13));
  const bandPeriod = Math.max(10, parseNumber(config.bandPeriod, 34));
  const bandMult = parseNumber(config.bandMult, 1.6185);
  const signalPeriod = Math.max(2, parseNumber(config.signalPeriod, 7));
  const closes = candles.map((item) => item.close);
  const rsiValues = rsi(closes, rsiPeriod);
  const rsiNumeric = rsiValues.map((value) => value ?? 50);
  const bands = bollinger(rsiNumeric, bandPeriod, bandMult);
  const priceLine = sma(rsiNumeric, 2);
  const signalLine = sma(rsiNumeric, signalPeriod);
  const marketBase = sma(rsiNumeric, bandPeriod);
  const last = closes.length - 1;
  const priceNow = priceLine[last];
  const signalNow = signalLine[last];
  const baseNow = marketBase[last];
  const rsiNow = rsiValues[last];
  const cross = crossover(priceLine[last - 1], priceNow, signalLine[last - 1], signalNow);
  let bias: StrategyBias = rsiNow != null && rsiNow >= 50 ? 'bullish' : rsiNow != null && rsiNow <= 50 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (cross === 'bullish_cross' && baseNow != null && priceNow != null && priceNow > baseNow) decision = 'buy';
  else if (cross === 'bearish_cross' && baseNow != null && priceNow != null && priceNow < baseNow) decision = 'sell';
  else if (rsiNow != null && rsiNow <= 32 && cross === 'bullish_cross') decision = 'buy';
  else if (rsiNow != null && rsiNow >= 68 && cross === 'bearish_cross') decision = 'sell';

  const upper = bands.upper[last];
  const lower = bands.lower[last];

  return buildEvaluationResult({
    strategyId: 'tdi-strategy',
    context,
    config: { ...config, rsiPeriod, bandPeriod, bandMult, signalPeriod },
    candles,
    decision,
    bias,
    confidence: 37 + (cross !== 'none' ? 28 : 0) + (rsiNow != null ? Math.min(12, Math.abs(rsiNow - 50) / 4) : 0),
    reasons: [
      `TDI — RSI(${rsiPeriod}) + Bollinger(${bandPeriod},${bandMult}) + signal(${signalPeriod})`,
      cross !== 'none' ? `Price/signal ${cross.replace('_', ' ')}` : 'No TDI price/signal crossover',
      rsiNow != null ? `RSI price line ${rsiNow.toFixed(1)} · base ${baseNow?.toFixed(1) ?? '—'}` : 'TDI components unavailable',
      decision === 'buy' ? 'TDI bullish cross above market base — long' : decision === 'sell' ? 'TDI bearish cross below market base — short' : 'Awaiting TDI crossover',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      upperBand: upper != null ? Number(upper.toFixed(2)) : null,
      lowerBand: lower != null ? Number(lower.toFixed(2)) : null,
      marketBase: baseNow != null ? Number(baseNow.toFixed(2)) : null,
    },
    events: cross !== 'none'
      ? [{ label: cross.replace('_', ' '), detail: 'TDI price / signal crossover', tone: cross === 'bullish_cross' ? 'emerald' : 'rose', barIndex: last }]
      : [],
  });
};

export const evaluateAlligatorIndicatorStrategyEngine: StrategyEngine = (candles, config, context) => {
  const jawPeriod = Math.max(8, parseNumber(config.jawPeriod, 13));
  const teethPeriod = Math.max(5, parseNumber(config.teethPeriod, 8));
  const lipsPeriod = Math.max(3, parseNumber(config.lipsPeriod, 5));
  const medians = candles.map(medianPrice);
  const jaw = smmaSeries(medians, jawPeriod);
  const teeth = smmaSeries(medians, teethPeriod);
  const lips = smmaSeries(medians, lipsPeriod);
  const last = candles.length - 1;
  const close = candles[last]!.close;
  const jawNow = jaw[last];
  const teethNow = teeth[last];
  const lipsNow = lips[last];
  const alignedBull = lipsNow != null && teethNow != null && jawNow != null && lipsNow > teethNow && teethNow > jawNow;
  const alignedBear = lipsNow != null && teethNow != null && jawNow != null && lipsNow < teethNow && teethNow < jawNow;
  let bias: StrategyBias = alignedBull ? 'bullish' : alignedBear ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (alignedBull && close > lipsNow!) decision = 'buy';
  else if (alignedBear && close < lipsNow!) decision = 'sell';
  else if (lipsNow != null && teethNow != null && crossover(lips[last - 1], lipsNow, teeth[last - 1], teethNow) === 'bullish_cross') decision = 'buy';
  else if (lipsNow != null && teethNow != null && crossover(lips[last - 1], lipsNow, teeth[last - 1], teethNow) === 'bearish_cross') decision = 'sell';

  return buildEvaluationResult({
    strategyId: 'alligator-indicator-strategy',
    context,
    config: { ...config, jawPeriod, teethPeriod, lipsPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 28 : alignedBull || alignedBear ? 10 : 0),
    reasons: [
      `Alligator SMMA(${lipsPeriod}/${teethPeriod}/${jawPeriod}) on median price`,
      alignedBull ? 'Lines aligned bullish (lips > teeth > jaw)' : alignedBear ? 'Lines aligned bearish (lips < teeth < jaw)' : 'Alligator lines intertwined — sleeping',
      decision === 'buy' ? 'Alligator awake bullish — price above lips' : decision === 'sell' ? 'Alligator awake bearish — price below lips' : 'Awaiting alligator alignment breakout',
    ],
    metrics: {
      jaw: jawNow != null ? Number(jawNow.toFixed(5)) : null,
      teeth: teethNow != null ? Number(teethNow.toFixed(5)) : null,
      lips: lipsNow != null ? Number(lipsNow.toFixed(5)) : null,
    },
  });
};
