import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, bollinger, ema, macd, rsi } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function rateOfChange(closes: number[], bars: number): number {
  const last = closes.length - 1;
  const prior = closes[last - bars];
  if (prior == null || prior === 0) return 0;
  return ((closes[last]! - prior) / prior) * 100;
}

function volumeProxy(candle: StrategyPriceCandle): number {
  return Math.max(candle.high - candle.low, 0.00001);
}

export const evaluateMomentumBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const rocBars = Math.max(5, parseNumber(config.rocBars, 10));
  const closes = candles.map((item) => item.close);
  const window = candles.slice(-lookback, -1);
  const last = candles[candles.length - 1]!;
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const buffer = last.close * (bufferPct / 100);
  const roc = rateOfChange(closes, rocBars);
  let bias: StrategyBias = roc > 0 ? 'bullish' : roc < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (last.close > rangeHigh + buffer && roc > 0) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < rangeLow - buffer && roc < 0) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > rangeHigh) {
    bias = 'bullish';
  } else if (last.close < rangeLow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'momentum-breakout',
    context,
    config: { ...config, lookback, bufferPct, rocBars },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 32 : 6) + Math.min(14, Math.abs(roc) * 6),
    reasons: [
      `Momentum breakout — ${lookback}-bar range break with ${rocBars}-bar ROC confirmation`,
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)} · ROC ${roc.toFixed(2)}%`,
      decision === 'buy' ? 'Bullish momentum breakout above range high' : decision === 'sell' ? 'Bearish momentum breakdown below range low' : 'No momentum breakout on latest bar',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      rocPct: Number(roc.toFixed(3)),
    },
    events: decision !== 'wait'
      ? [{ label: decision === 'buy' ? 'momentum breakout long' : 'momentum breakout short', detail: 'Range break with ROC alignment', tone: decision === 'buy' ? 'emerald' : 'rose', barIndex: last.candleIndex }]
      : [],
  });
};

export const evaluateVolumeMomentumEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(10, parseNumber(config.lookback, 20));
  const expansionRatio = parseNumber(config.expansionRatio, 1.4);
  const rocBars = Math.max(4, parseNumber(config.rocBars, 8));
  const closes = candles.map((item) => item.close);
  const last = candles[candles.length - 1]!;
  const baseline = candles.slice(-lookback - 1, -1);
  const avgVolumeProxy = baseline.reduce((sum, candle) => sum + volumeProxy(candle), 0) / Math.max(baseline.length, 1);
  const currentVolumeProxy = volumeProxy(last);
  const volumeExpanded = avgVolumeProxy > 0 && currentVolumeProxy >= avgVolumeProxy * expansionRatio;
  const roc = rateOfChange(closes, rocBars);
  let bias: StrategyBias = roc > 0 ? 'bullish' : roc < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (volumeExpanded && roc > 0 && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (volumeExpanded && roc < 0 && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (volumeExpanded && last.close > last.open) {
    bias = 'bullish';
  } else if (volumeExpanded && last.close < last.open) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volume-momentum',
    context,
    config: { ...config, lookback, expansionRatio, rocBars },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (volumeExpanded ? 12 : 0),
    reasons: [
      `Volume momentum — range-proxy expansion ≥ ${expansionRatio}× with directional ROC`,
      `Volume proxy ${currentVolumeProxy.toFixed(5)} vs baseline ${avgVolumeProxy.toFixed(5)} (${volumeExpanded ? 'expanded' : 'normal'})`,
      decision === 'buy' ? 'Expanding participation with bullish close — momentum long' : decision === 'sell' ? 'Expanding participation with bearish close — momentum short' : 'No volume-momentum alignment',
    ],
    metrics: {
      volumeRatio: avgVolumeProxy > 0 ? Number((currentVolumeProxy / avgVolumeProxy).toFixed(2)) : null,
      rocPct: Number(roc.toFixed(3)),
    },
  });
};

export const evaluateNewsMomentumEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(6, parseNumber(config.quietBars, 12));
  const impulseRatio = parseNumber(config.impulseRatio, 2);
  const followThroughBars = Math.max(1, parseNumber(config.followThroughBars, 2));
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars - followThroughBars), lastIndex - followThroughBars);
  const followWindow = candles.slice(Math.max(0, lastIndex - followThroughBars + 1), lastIndex + 1);
  const quietAvgRange = averageCandleRange(quietWindow);
  const impulseBar = candles[Math.max(0, lastIndex - followThroughBars + 1)] ?? last;
  const impulseRange = impulseBar.high - impulseBar.low;
  const impulse = quietAvgRange > 0 && impulseRange >= quietAvgRange * impulseRatio;
  const bullishImpulse = impulse && impulseBar.close > impulseBar.open;
  const bearishImpulse = impulse && impulseBar.close < impulseBar.open;
  const followBull = followWindow.every((candle) => candle.close >= candle.open) && last.close > impulseBar.close;
  const followBear = followWindow.every((candle) => candle.close <= candle.open) && last.close < impulseBar.close;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (bullishImpulse && followBull) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishImpulse && followBear) {
    bias = 'bearish';
    decision = 'sell';
  } else if (bullishImpulse) {
    bias = 'bullish';
  } else if (bearishImpulse) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'news-momentum',
    context,
    config: { ...config, quietBars, impulseRatio, followThroughBars },
    candles,
    decision,
    bias,
    confidence: 34 + (impulse ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `News momentum — post-event impulse with ${followThroughBars}-bar follow-through`,
      quietAvgRange > 0
        ? `Impulse ${(impulseRange / quietAvgRange).toFixed(2)}× quiet baseline`
        : 'Quiet baseline unavailable',
      decision === 'buy' ? 'Bullish event impulse with follow-through continuation' : decision === 'sell' ? 'Bearish event impulse with follow-through continuation' : 'No confirmed news momentum continuation',
    ],
    metrics: {
      impulseMultiple: quietAvgRange > 0 ? Number((impulseRange / quietAvgRange).toFixed(2)) : null,
      followThroughBars,
    },
  });
};

export const evaluateMacdMomentumEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(3, parseNumber(config.signalPeriod, 9));
  const minHistogramBars = Math.max(2, parseNumber(config.minHistogramBars, 3));
  const closes = candles.map((item) => item.close);
  const { macd: macdLine, signal, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const last = closes.length - 1;
  const histNow = histogram[last];
  const macdNow = macdLine[last];
  const signalNow = signal[last];
  let expandingBull = 0;
  let expandingBear = 0;
  for (let index = last - minHistogramBars + 1; index <= last; index += 1) {
    const current = histogram[index];
    const previous = histogram[index - 1];
    if (current != null && previous != null && current > 0 && current > previous) expandingBull += 1;
    if (current != null && previous != null && current < 0 && current < previous) expandingBear += 1;
  }
  let bias: StrategyBias = histNow != null && histNow > 0 ? 'bullish' : histNow != null && histNow < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (macdNow != null && signalNow != null && expandingBull >= minHistogramBars - 1 && macdNow > signalNow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (macdNow != null && signalNow != null && expandingBear >= minHistogramBars - 1 && macdNow < signalNow) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'macd-momentum',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod, minHistogramBars },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 30 : 8) + Math.min(14, Math.abs(histNow ?? 0) * 6000),
    reasons: [
      `MACD momentum — expanding histogram over ${minHistogramBars} bars`,
      macdNow != null && signalNow != null ? `MACD ${macdNow.toFixed(5)} vs signal ${signalNow.toFixed(5)}` : 'MACD unavailable',
      decision === 'buy' ? 'Sustained bullish histogram expansion — momentum long' : decision === 'sell' ? 'Sustained bearish histogram expansion — momentum short' : 'No MACD momentum expansion',
    ],
    metrics: {
      histogram: histNow != null ? Number(histNow.toFixed(6)) : null,
      expandingBars: decision === 'buy' ? expandingBull : decision === 'sell' ? expandingBear : 0,
    },
  });
};

export const evaluateRsiMomentumEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(7, parseNumber(config.period, 14));
  const momentumFloor = parseNumber(config.momentumFloor, 55);
  const momentumCeiling = parseNumber(config.momentumCeiling, 45);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const last = closes.length - 1;
  const rsiNow = rsiSeries[last];
  const rsiPrev = rsiSeries[last - 1];
  const rsiStart = rsiSeries[Math.max(0, last - 5)];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (rsiNow != null && rsiPrev != null && rsiStart != null) {
    if (rsiNow >= momentumFloor && rsiNow > rsiPrev && rsiNow > rsiStart) {
      bias = 'bullish';
      decision = 'buy';
    } else if (rsiNow <= momentumCeiling && rsiNow < rsiPrev && rsiNow < rsiStart) {
      bias = 'bearish';
      decision = 'sell';
    } else if (rsiNow >= 50) {
      bias = 'bullish';
    } else if (rsiNow <= 50) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'rsi-momentum',
    context,
    config: { ...config, period, momentumFloor, momentumCeiling },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 30 : 0) + (rsiNow != null ? Math.min(16, Math.abs(rsiNow - 50) / 3) : 0),
    reasons: [
      `RSI momentum — sustained push above ${momentumFloor} / below ${momentumCeiling}`,
      rsiNow != null ? `RSI ${rsiNow.toFixed(1)} (${rsiStart != null ? `from ${rsiStart.toFixed(1)}` : 'n/a'})` : 'RSI unavailable',
      decision === 'buy' ? 'RSI momentum regime long — rising above midline band' : decision === 'sell' ? 'RSI momentum regime short — falling below midline band' : 'No RSI momentum thrust',
    ],
    metrics: { rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null },
  });
};

export const evaluateVolatilityMomentumEngine: StrategyEngine = (candles, config, context) => {
  const atrPeriod = Math.max(7, parseNumber(config.atrPeriod, 14));
  const expansionRatio = parseNumber(config.expansionRatio, 1.3);
  const lookback = Math.max(8, parseNumber(config.lookback, 16));
  const atrSeries = atr(candles, atrPeriod);
  const last = candles.length - 1;
  const atrNow = atrSeries[last];
  const atrPrev = atrSeries[Math.max(0, last - lookback)];
  const lastCandle = candles[last]!;
  const expanding = atrNow != null && atrPrev != null && atrPrev > 0 && atrNow / atrPrev >= expansionRatio;
  const bullish = lastCandle.close > lastCandle.open && lastCandle.close > candles[last - 1]?.close;
  const bearish = lastCandle.close < lastCandle.open && lastCandle.close < candles[last - 1]?.close;
  let bias: StrategyBias = expanding && bullish ? 'bullish' : expanding && bearish ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (expanding && bullish) {
    decision = 'buy';
  } else if (expanding && bearish) {
    decision = 'sell';
  } else if (bullish) {
    bias = 'bullish';
  } else if (bearish) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'volatility-momentum',
    context,
    config: { ...config, atrPeriod, expansionRatio, lookback },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + (expanding ? 12 : 0),
    reasons: [
      `Volatility momentum — ATR(${atrPeriod}) expansion ≥ ${expansionRatio}× with directional close`,
      atrNow != null && atrPrev != null ? `ATR ${atrNow.toFixed(5)} vs ${atrPrev.toFixed(5)} (${expanding ? 'expanding' : 'stable'})` : 'ATR unavailable',
      decision === 'buy' ? 'Volatility expansion with bullish continuation' : decision === 'sell' ? 'Volatility expansion with bearish continuation' : 'No volatility momentum signal',
    ],
    metrics: {
      atr: atrNow != null ? Number(atrNow.toFixed(5)) : null,
      expansion: atrNow != null && atrPrev != null && atrPrev > 0 ? Number((atrNow / atrPrev).toFixed(2)) : null,
    },
  });
};

export const evaluateCurrencyStrengthMomentumEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 13));
  const slowPeriod = Math.max(fastPeriod + 5, parseNumber(config.slowPeriod, 34));
  const strengthBars = Math.max(5, parseNumber(config.strengthBars, 10));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 20);
  const closes = candles.map((item) => item.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const { adx: adxSeries } = adx(candles, adxPeriod);
  const last = closes.length - 1;
  const close = closes[last]!;
  const fastNow = fast[last];
  const slowNow = slow[last];
  const adxNow = adxSeries[last];
  const roc = rateOfChange(closes, strengthBars);
  const slopePct = fastNow != null && fast[last - strengthBars] != null && fast[last - strengthBars]! !== 0
    ? ((fastNow - fast[last - strengthBars]!) / fast[last - strengthBars]!) * 100
    : 0;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const strong = adxNow != null && adxNow >= adxThreshold;

  if (strong && fastNow != null && slowNow != null && close > fastNow && fastNow > slowNow && roc > 0 && slopePct > 0) {
    bias = 'bullish';
    decision = 'buy';
  } else if (strong && fastNow != null && slowNow != null && close < fastNow && fastNow < slowNow && roc < 0 && slopePct < 0) {
    bias = 'bearish';
    decision = 'sell';
  } else if (fastNow != null && slowNow != null && fastNow > slowNow) {
    bias = 'bullish';
  } else if (fastNow != null && slowNow != null && fastNow < slowNow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'currency-strength-momentum',
    context,
    config: { ...config, fastPeriod, slowPeriod, strengthBars, adxPeriod, adxThreshold },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 30 : 0) + (strong ? 10 : 0) + Math.min(12, Math.abs(roc) * 4),
    reasons: [
      `Currency strength momentum — EMA(${fastPeriod}/${slowPeriod}) stack + ${strengthBars}-bar ROC thrust`,
      strong ? `Directional strength ADX ${adxNow!.toFixed(1)} · ROC ${roc.toFixed(2)}%` : 'Trend strength below ADX threshold',
      decision === 'buy' ? 'Relative strength acceleration — momentum long' : decision === 'sell' ? 'Relative weakness acceleration — momentum short' : 'No currency strength momentum alignment',
    ],
    metrics: {
      rocPct: Number(roc.toFixed(3)),
      slopePct: Number(slopePct.toFixed(3)),
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
    },
  });
};

export const evaluateRelativeStrengthMomentumEngine: StrategyEngine = (candles, config, context) => {
  const baselinePeriod = Math.max(20, parseNumber(config.baselinePeriod, 50));
  const rsPeriod = Math.max(10, parseNumber(config.rsPeriod, 20));
  const rsThreshold = parseNumber(config.rsThreshold, 1.02);
  const closes = candles.map((item) => item.close);
  const baseline = ema(closes, baselinePeriod);
  const last = closes.length - 1;
  const close = closes[last]!;
  const baseNow = baseline[last];
  const basePrev = baseline[last - rsPeriod];
  let relativeStrength = 1;
  let rsSlope = 0;
  if (baseNow != null && baseNow !== 0) {
    relativeStrength = close / baseNow;
  }
  if (baseNow != null && basePrev != null && basePrev !== 0) {
    rsSlope = (baseNow - basePrev) / basePrev;
  }
  const priorClose = closes[last - rsPeriod];
  const performance = priorClose != null && priorClose !== 0 ? close / priorClose : 1;
  let bias: StrategyBias = relativeStrength >= 1 ? 'bullish' : 'bearish';
  let decision: StrategySignalSide = 'wait';

  if (relativeStrength >= rsThreshold && performance >= rsThreshold && rsSlope >= 0) {
    bias = 'bullish';
    decision = 'buy';
  } else if (relativeStrength <= (2 - rsThreshold) && performance <= (2 - rsThreshold) && rsSlope <= 0) {
    bias = 'bearish';
    decision = 'sell';
  }

  const bands = bollinger(closes, rsPeriod, 2);
  const bandwidth = bands.bandwidth[last];

  return buildEvaluationResult({
    strategyId: 'relative-strength-momentum',
    context,
    config: { ...config, baselinePeriod, rsPeriod, rsThreshold },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 0) + Math.min(14, Math.abs(relativeStrength - 1) * 200),
    reasons: [
      `Relative strength momentum — price vs EMA(${baselinePeriod}) baseline`,
      baseNow != null ? `Relative strength ${relativeStrength.toFixed(4)} (threshold ${rsThreshold})` : 'Baseline unavailable',
      decision === 'buy' ? 'Outperforming baseline with rising relative strength — long' : decision === 'sell' ? 'Underperforming baseline with falling relative strength — short' : 'Relative strength near equilibrium',
    ],
    metrics: {
      relativeStrength: Number(relativeStrength.toFixed(4)),
      performanceRatio: Number(performance.toFixed(4)),
      bandwidth: bandwidth != null ? Number(bandwidth.toFixed(3)) : null,
    },
  });
};
