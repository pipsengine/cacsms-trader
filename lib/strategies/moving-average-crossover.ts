import type {
  MovingAverageCrossoverConfig,
  MovingAverageCrossoverPoint,
  MovingAverageCrossoverResult,
  MovingAverageType,
  StrategySignalSide,
} from './types';

export const DEFAULT_MA_CROSSOVER_CONFIG: MovingAverageCrossoverConfig = {
  symbol: 'EURUSD',
  timeframe: 'M15',
  fastPeriod: 9,
  slowPeriod: 21,
  maType: 'ema',
};

type PriceCandle = {
  close: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function buildMovingAverageSeries(closes: number[], period: number, maType: MovingAverageType): Array<number | null> {
  const series: Array<number | null> = Array.from({ length: closes.length }, () => null);
  if (period <= 0 || closes.length === 0) return series;

  if (maType === 'sma') {
    for (let index = period - 1; index < closes.length; index += 1) {
      const window = closes.slice(index - period + 1, index + 1);
      series[index] = window.reduce((sum, value) => sum + value, 0) / period;
    }
    return series;
  }

  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = 0; index < closes.length; index += 1) {
    if (index < period - 1) continue;
    if (index === period - 1) {
      series[index] = ema;
      continue;
    }
    ema = (closes[index] - ema) * multiplier + ema;
    series[index] = ema;
  }
  return series;
}

function detectCrossover(
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

function decisionFromState(
  latestCross: 'bullish_cross' | 'bearish_cross' | 'none',
  fastMa: number | null,
  slowMa: number | null,
): StrategySignalSide {
  if (latestCross === 'bullish_cross') return 'buy';
  if (latestCross === 'bearish_cross') return 'sell';
  if (fastMa != null && slowMa != null) {
    if (fastMa > slowMa) return 'buy';
    if (fastMa < slowMa) return 'sell';
  }
  return 'wait';
}

export function evaluateMovingAverageCrossover(
  candles: PriceCandle[],
  config: MovingAverageCrossoverConfig,
): MovingAverageCrossoverResult {
  const closes = candles.map((candle) => candle.close);
  const fastSeries = buildMovingAverageSeries(closes, config.fastPeriod, config.maType);
  const slowSeries = buildMovingAverageSeries(closes, config.slowPeriod, config.maType);

  const series: MovingAverageCrossoverPoint[] = closes.map((close, index) => ({
    index,
    close,
    fastMa: fastSeries[index],
    slowMa: slowSeries[index],
    signal: detectCrossover(
      index > 0 ? fastSeries[index - 1] : null,
      fastSeries[index],
      index > 0 ? slowSeries[index - 1] : null,
      slowSeries[index],
    ),
  }));

  const lastIndex = series.length - 1;
  const latest = series[lastIndex];
  const latestSignal = latest?.signal ?? 'none';
  const fastMa = latest?.fastMa ?? null;
  const slowMa = latest?.slowMa ?? null;
  const maSpread = fastMa != null && slowMa != null ? fastMa - slowMa : null;

  let lastCrossover: MovingAverageCrossoverResult['lastCrossover'] = null;
  for (let index = series.length - 1; index >= 1; index -= 1) {
    const point = series[index];
    if (point.signal === 'bullish_cross' || point.signal === 'bearish_cross') {
      lastCrossover = {
        type: point.signal,
        index,
        barsAgo: lastIndex - index,
      };
      break;
    }
  }

  const trendBias = fastMa != null && slowMa != null
    ? fastMa > slowMa
      ? 'bullish'
      : fastMa < slowMa
        ? 'bearish'
        : 'neutral'
    : 'neutral';

  const spreadPct = fastMa != null && slowMa != null && slowMa !== 0
    ? Math.abs((fastMa - slowMa) / slowMa) * 100
    : 0;
  const confidence = clamp(
    40
    + (latestSignal !== 'none' ? 25 : 0)
    + Math.min(20, spreadPct * 400)
    + (lastCrossover && lastCrossover.barsAgo <= 3 ? 15 : lastCrossover && lastCrossover.barsAgo <= 8 ? 8 : 0),
    0,
    100,
  );

  const decision = decisionFromState(latestSignal, fastMa, slowMa);
  const reasons = [
    `${config.maType.toUpperCase()}(${config.fastPeriod}) vs ${config.maType.toUpperCase()}(${config.slowPeriod}) on ${config.timeframe}`,
    trendBias === 'bullish'
      ? 'Fast MA is above slow MA — bullish trend bias'
      : trendBias === 'bearish'
        ? 'Fast MA is below slow MA — bearish trend bias'
        : 'Moving averages are converging — no clear trend bias',
    latestSignal === 'bullish_cross'
      ? 'Fresh bullish crossover detected on the latest bar'
      : latestSignal === 'bearish_cross'
        ? 'Fresh bearish crossover detected on the latest bar'
        : lastCrossover
          ? `Last crossover was ${lastCrossover.type.replace('_', ' ')} ${lastCrossover.barsAgo} bar(s) ago`
          : 'No crossover detected in the loaded candle window',
  ];

  return {
    strategyId: 'moving-average-crossover',
    symbol: config.symbol.toUpperCase(),
    timeframe: config.timeframe,
    config,
    decision,
    confidence: Math.round(confidence),
    trendBias,
    fastMa,
    slowMa,
    maSpread,
    lastCrossover,
    reasons,
    series: series.slice(-40),
    candleCount: candles.length,
    evaluatedAt: new Date().toISOString(),
  };
}
