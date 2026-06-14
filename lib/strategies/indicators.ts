import type { StrategyPriceCandle } from './strategy-candle-loader';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sma(closes: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  if (period <= 0) return series;
  for (let index = period - 1; index < closes.length; index += 1) {
    const window = closes.slice(index - period + 1, index + 1);
    series[index] = window.reduce((sum, value) => sum + value, 0) / period;
  }
  return series;
}

export function ema(closes: number[], period: number): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  if (period <= 0 || closes.length < period) return series;
  const multiplier = 2 / (period + 1);
  let value = closes.slice(0, period).reduce((sum, close) => sum + close, 0) / period;
  series[period - 1] = value;
  for (let index = period; index < closes.length; index += 1) {
    value = (closes[index] - value) * multiplier + value;
    series[index] = value;
  }
  return series;
}

export function rsi(closes: number[], period = 14): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  if (closes.length <= period) return series;

  let gainSum = 0;
  let lossSum = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum += Math.abs(delta);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  series[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    series[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return series;
}

export function atr(candles: StrategyPriceCandle[], period = 14): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: candles.length }, () => null);
  if (candles.length <= period) return series;

  const trs: number[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    if (index === 0) {
      trs.push(candles[index].high - candles[index].low);
      continue;
    }
    const highLow = candles[index].high - candles[index].low;
    const highClose = Math.abs(candles[index].high - candles[index - 1].close);
    const lowClose = Math.abs(candles[index].low - candles[index - 1].close);
    trs.push(Math.max(highLow, highClose, lowClose));
  }

  let atrValue = trs.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series[period - 1] = atrValue;
  for (let index = period; index < candles.length; index += 1) {
    atrValue = (atrValue * (period - 1) + trs[index]) / period;
    series[index] = atrValue;
  }
  return series;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: Array<number | null>; signal: Array<number | null>; histogram: Array<number | null> } {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const macdLine: Array<number | null> = closes.map((_, index) => {
    if (fast[index] == null || slow[index] == null) return null;
    return fast[index]! - slow[index]!;
  });
  const macdValues = macdLine.map((value) => value ?? 0);
  const signalLine = ema(macdValues, signalPeriod);
  const histogram = macdLine.map((value, index) => {
    if (value == null || signalLine[index] == null) return null;
    return value - signalLine[index]!;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

export function bollinger(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): { middle: Array<number | null>; upper: Array<number | null>; lower: Array<number | null>; bandwidth: Array<number | null> } {
  const middle = sma(closes, period);
  const upper: Array<number | null> = Array.from({ length: closes.length }, () => null);
  const lower: Array<number | null> = Array.from({ length: closes.length }, () => null);
  const bandwidth: Array<number | null> = Array.from({ length: closes.length }, () => null);

  for (let index = period - 1; index < closes.length; index += 1) {
    const window = closes.slice(index - period + 1, index + 1);
    const mean = middle[index]!;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[index] = mean + stdDevMultiplier * stdDev;
    lower[index] = mean - stdDevMultiplier * stdDev;
    bandwidth[index] = mean === 0 ? null : ((upper[index]! - lower[index]!) / mean) * 100;
  }
  return { middle, upper, lower, bandwidth };
}

export function supertrend(
  candles: StrategyPriceCandle[],
  period = 10,
  multiplier = 2,
): { trend: Array<'bullish' | 'bearish' | null>; value: Array<number | null> } {
  const atrSeries = atr(candles, period);
  const trend: Array<'bullish' | 'bearish' | null> = Array.from({ length: candles.length }, () => null);
  const value: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const upperBand: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const lowerBand: Array<number | null> = Array.from({ length: candles.length }, () => null);

  for (let index = 0; index < candles.length; index += 1) {
    if (atrSeries[index] == null) continue;
    const hl2 = (candles[index].high + candles[index].low) / 2;
    upperBand[index] = hl2 + multiplier * atrSeries[index]!;
    lowerBand[index] = hl2 - multiplier * atrSeries[index]!;
  }

  for (let index = period; index < candles.length; index += 1) {
    if (upperBand[index] == null || lowerBand[index] == null) continue;
    const prevTrend = trend[index - 1];
    const prevValue = value[index - 1];
    const close = candles[index].close;

    let nextUpper = upperBand[index]!;
    let nextLower = lowerBand[index]!;
    if (index > 0 && upperBand[index - 1] != null && close <= upperBand[index - 1]!) {
      nextUpper = Math.min(nextUpper, upperBand[index - 1]!);
    }
    if (index > 0 && lowerBand[index - 1] != null && close >= lowerBand[index - 1]!) {
      nextLower = Math.max(nextLower, lowerBand[index - 1]!);
    }

    if (prevTrend === 'bullish') {
      if (close < nextLower) {
        trend[index] = 'bearish';
        value[index] = nextUpper;
      } else {
        trend[index] = 'bullish';
        value[index] = nextLower;
      }
    } else if (prevTrend === 'bearish') {
      if (close > nextUpper) {
        trend[index] = 'bullish';
        value[index] = nextLower;
      } else {
        trend[index] = 'bearish';
        value[index] = nextUpper;
      }
    } else if (close > nextUpper) {
      trend[index] = 'bullish';
      value[index] = nextLower;
    } else {
      trend[index] = 'bearish';
      value[index] = nextUpper;
    }

    if (prevValue != null && trend[index] === prevTrend) {
      value[index] = prevTrend === 'bullish'
        ? Math.max(nextLower, prevValue)
        : Math.min(nextUpper, prevValue);
    }
  }

  return { trend, value };
}

export function crossover(
  fastPrev: number | null,
  fastCurr: number | null,
  slowPrev: number | null,
  slowCurr: number | null,
): 'bullish_cross' | 'bearish_cross' | 'none' {
  if (fastPrev == null || fastCurr == null || slowPrev == null || slowCurr == null) return 'none';
  if (fastPrev <= slowPrev && fastCurr > slowCurr) return 'bullish_cross';
  if (fastPrev >= slowPrev && fastCurr < slowCurr) return 'bearish_cross';
  return 'none';
}

function wilderSmoothNext(previous: number, current: number, period: number): number {
  return (previous * (period - 1) + current) / period;
}

export function adx(
  candles: StrategyPriceCandle[],
  period = 14,
): { adx: Array<number | null>; plusDi: Array<number | null>; minusDi: Array<number | null> } {
  const length = candles.length;
  const adxSeries: Array<number | null> = Array.from({ length }, () => null);
  const plusDi: Array<number | null> = Array.from({ length }, () => null);
  const minusDi: Array<number | null> = Array.from({ length }, () => null);
  if (length <= period + 1) return { adx: adxSeries, plusDi, minusDi };

  let trSum = 0;
  let plusDmSum = 0;
  let minusDmSum = 0;
  const dxValues: Array<{ index: number; value: number }> = [];

  for (let index = 1; index < length; index += 1) {
    const upMove = candles[index].high - candles[index - 1].high;
    const downMove = candles[index - 1].low - candles[index].low;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const highLow = candles[index].high - candles[index].low;
    const highClose = Math.abs(candles[index].high - candles[index - 1].close);
    const lowClose = Math.abs(candles[index].low - candles[index - 1].close);
    const trueRange = Math.max(highLow, highClose, lowClose);

    if (index < period) {
      trSum += trueRange;
      plusDmSum += plusDm;
      minusDmSum += minusDm;
      continue;
    }

    if (index === period) {
      trSum += trueRange;
      plusDmSum += plusDm;
      minusDmSum += minusDm;
    } else {
      trSum = wilderSmoothNext(trSum, trueRange, period);
      plusDmSum = wilderSmoothNext(plusDmSum, plusDm, period);
      minusDmSum = wilderSmoothNext(minusDmSum, minusDm, period);
    }

    const pdi = trSum === 0 ? 0 : (100 * plusDmSum) / trSum;
    const mdi = trSum === 0 ? 0 : (100 * minusDmSum) / trSum;
    plusDi[index] = pdi;
    minusDi[index] = mdi;
    const diSum = pdi + mdi;
    dxValues.push({ index, value: diSum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / diSum });
  }

  if (dxValues.length < period) return { adx: adxSeries, plusDi, minusDi };

  let adxValue = dxValues.slice(0, period).reduce((sum, item) => sum + item.value, 0) / period;
  adxSeries[dxValues[period - 1]!.index] = adxValue;
  for (let index = period; index < dxValues.length; index += 1) {
    adxValue = wilderSmoothNext(adxValue, dxValues[index]!.value, period);
    adxSeries[dxValues[index]!.index] = adxValue;
  }

  return { adx: adxSeries, plusDi, minusDi };
}

export function stochastic(
  candles: StrategyPriceCandle[],
  kPeriod = 14,
  dPeriod = 3,
): { k: Array<number | null>; d: Array<number | null> } {
  const k: Array<number | null> = Array.from({ length: candles.length }, () => null);
  for (let index = kPeriod - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - kPeriod + 1, index + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    const range = highest - lowest;
    k[index] = range === 0 ? 50 : ((candles[index].close - lowest) / range) * 100;
  }
  const kValues = k.map((value) => value ?? 50);
  const dRaw = sma(kValues, dPeriod);
  return { k, d: dRaw };
}

export function donchian(
  candles: StrategyPriceCandle[],
  period = 20,
): { upper: Array<number | null>; lower: Array<number | null>; middle: Array<number | null> } {
  const upper: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const lower: Array<number | null> = Array.from({ length: candles.length }, () => null);
  const middle: Array<number | null> = Array.from({ length: candles.length }, () => null);
  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const high = Math.max(...window.map((item) => item.high));
    const low = Math.min(...window.map((item) => item.low));
    upper[index] = high;
    lower[index] = low;
    middle[index] = (high + low) / 2;
  }
  return { upper, lower, middle };
}

function periodMidline(candles: StrategyPriceCandle[], index: number, period: number): number | null {
  if (index < period - 1) return null;
  const window = candles.slice(index - period + 1, index + 1);
  const high = Math.max(...window.map((item) => item.high));
  const low = Math.min(...window.map((item) => item.low));
  return (high + low) / 2;
}

export function ichimoku(
  candles: StrategyPriceCandle[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26,
): {
  tenkan: Array<number | null>;
  kijun: Array<number | null>;
  senkouA: Array<number | null>;
  senkouB: Array<number | null>;
} {
  const length = candles.length;
  const tenkan: Array<number | null> = Array.from({ length }, () => null);
  const kijun: Array<number | null> = Array.from({ length }, () => null);
  const senkouA: Array<number | null> = Array.from({ length }, () => null);
  const senkouB: Array<number | null> = Array.from({ length }, () => null);

  for (let index = 0; index < length; index += 1) {
    tenkan[index] = periodMidline(candles, index, tenkanPeriod);
    kijun[index] = periodMidline(candles, index, kijunPeriod);
  }

  for (let index = 0; index < length; index += 1) {
    const source = index - displacement;
    if (source < 0) continue;
    if (tenkan[source] != null && kijun[source] != null) {
      senkouA[index] = (tenkan[source]! + kijun[source]!) / 2;
    }
    senkouB[index] = periodMidline(candles, source, senkouBPeriod);
  }

  return { tenkan, kijun, senkouA, senkouB };
}
