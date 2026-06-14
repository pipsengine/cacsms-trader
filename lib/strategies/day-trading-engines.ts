import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { adx, atr, bollinger, ema, macd, rsi, vwap } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
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

function barReturns(candles: StrategyPriceCandle[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const prior = candles[index - 1]!.close;
    returns.push(prior !== 0 ? ((candles[index]!.close - prior) / prior) * 100 : 0);
  }
  return returns;
}

export const evaluateIntradayTrendTradingEngine: StrategyEngine = (candles, config, context) => {
  const trendPeriod = Math.max(15, parseNumber(config.trendPeriod, 21));
  const filterPeriod = Math.max(trendPeriod + 5, parseNumber(config.filterPeriod, 50));
  const adxPeriod = Math.max(7, parseNumber(config.adxPeriod, 14));
  const adxThreshold = parseNumber(config.adxThreshold, 22);
  const closes = candles.map((item) => item.close);
  const trendEma = ema(closes, trendPeriod);
  const filterEma = ema(closes, filterPeriod);
  const { adx: adxSeries, plusDi, minusDi } = adx(candles, adxPeriod);
  const last = closes.length - 1;
  const trendNow = trendEma[last];
  const trendPrev = trendEma[Math.max(0, last - 5)];
  const filterNow = filterEma[last];
  const adxNow = adxSeries[last];
  const pdi = plusDi[last];
  const mdi = minusDi[last];
  const rising = trendNow != null && trendPrev != null && trendNow > trendPrev;
  const falling = trendNow != null && trendPrev != null && trendNow < trendPrev;
  const strong = adxNow != null && adxNow >= adxThreshold;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (trendNow != null && filterNow != null && closes[last]! > trendNow && closes[last]! > filterNow && rising && strong && pdi != null && mdi != null && pdi > mdi) {
    bias = 'bullish';
    decision = 'buy';
  } else if (trendNow != null && filterNow != null && closes[last]! < trendNow && closes[last]! < filterNow && falling && strong && pdi != null && mdi != null && mdi > pdi) {
    bias = 'bearish';
    decision = 'sell';
  } else if (trendNow != null && closes[last]! > trendNow) {
    bias = 'bullish';
  } else if (trendNow != null && closes[last]! < trendNow) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'intraday-trend-trading',
    context,
    config: { ...config, trendPeriod, filterPeriod, adxPeriod, adxThreshold },
    candles,
    decision,
    bias,
    confidence: 34 + (strong ? 14 : 0) + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Intraday trend — EMA(${trendPeriod}/${filterPeriod}) stack + ADX(${adxPeriod}) filter`,
      adxNow != null ? `ADX ${adxNow.toFixed(1)} (${strong ? 'directional day' : 'weak trend'})` : 'ADX unavailable',
      decision === 'buy'
        ? 'Price above rising EMAs with +DI dominance — intraday long'
        : decision === 'sell'
          ? 'Price below falling EMAs with -DI dominance — intraday short'
          : 'Intraday trend not fully aligned',
    ],
    metrics: {
      trendEma: trendNow != null ? Number(trendNow.toFixed(5)) : null,
      filterEma: filterNow != null ? Number(filterNow.toFixed(5)) : null,
      adx: adxNow != null ? Number(adxNow.toFixed(2)) : null,
    },
  });
};

export const evaluateIntradayBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 48));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const sessionHigh = Math.max(...window.map((item) => item.high));
  const sessionLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > sessionHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < sessionLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > sessionHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < sessionLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'intraday-breakout',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Intraday breakout — ${window.length}-bar session range (excluding latest)`,
      `Range high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy'
        ? 'Close confirmed above intraday range high'
        : decision === 'sell'
          ? 'Close confirmed below intraday range low'
          : 'Price inside intraday range',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
    },
  });
};

export const evaluateMomentumDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(8, parseNumber(config.fastPeriod, 12));
  const slowPeriod = Math.max(17, parseNumber(config.slowPeriod, 26));
  const signalPeriod = Math.max(5, parseNumber(config.signalPeriod, 9));
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const { macd: macdLine, signal: signalLine, histogram } = macd(closes, fastPeriod, slowPeriod, signalPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = closes.length - 1;
  const macdNow = macdLine[last];
  const signalNow = signalLine[last];
  const histNow = histogram[last];
  const histPrev = histogram[last - 1];
  const rsiNow = rsiSeries[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (macdNow != null && signalNow != null && histNow != null && histPrev != null && rsiNow != null) {
    if (macdNow > signalNow && histNow > histPrev && rsiNow > 52) {
      bias = 'bullish';
      decision = 'buy';
    } else if (macdNow < signalNow && histNow < histPrev && rsiNow < 48) {
      bias = 'bearish';
      decision = 'sell';
    } else if (macdNow > signalNow) {
      bias = 'bullish';
    } else if (macdNow < signalNow) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'momentum-day-trading',
    context,
    config: { ...config, fastPeriod, slowPeriod, signalPeriod, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 8),
    reasons: [
      `Momentum day trade — MACD(${fastPeriod},${slowPeriod},${signalPeriod}) + RSI(${rsiPeriod})`,
      macdNow != null && signalNow != null ? `MACD ${macdNow.toFixed(5)} vs signal ${signalNow.toFixed(5)}` : 'MACD unavailable',
      decision === 'buy'
        ? 'Expanding bullish MACD histogram with RSI confirmation'
        : decision === 'sell'
          ? 'Expanding bearish MACD histogram with RSI confirmation'
          : 'Momentum not aligned for day entry',
    ],
    metrics: {
      macd: macdNow != null ? Number(macdNow.toFixed(5)) : null,
      histogram: histNow != null ? Number(histNow.toFixed(5)) : null,
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
    },
  });
};

export const evaluateVwapDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const tolerancePct = parseNumber(config.tolerancePct, 0.06);
  const trendBars = Math.max(3, parseNumber(config.trendBars, 6));
  const vwapSeries = vwap(candles);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const vwapNow = vwapSeries[lastIndex];
  const vwapPrev = vwapSeries[Math.max(0, lastIndex - trendBars)];
  const tolerance = last.close * (tolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (vwapNow != null && vwapPrev != null) {
    const above = last.close > vwapNow;
    const rising = vwapNow > vwapPrev;
    const near = Math.abs(last.close - vwapNow) <= tolerance;
    if (above && rising && last.close > last.open) {
      bias = 'bullish';
      decision = near ? 'buy' : 'buy';
    } else if (!above && !rising && last.close < last.open) {
      bias = 'bearish';
      decision = near ? 'sell' : 'sell';
    } else if (above) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'vwap-day-trading',
    context,
    config: { ...config, tolerancePct, trendBars },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 8),
    reasons: [
      'VWAP day trading — session VWAP trend with directional close',
      vwapNow != null && vwapPrev != null
        ? `VWAP ${vwapNow.toFixed(5)} (${vwapNow > vwapPrev ? 'rising' : 'falling'}) · close ${last.close.toFixed(5)}`
        : 'VWAP unavailable',
      decision === 'buy'
        ? 'Long with price above rising session VWAP'
        : decision === 'sell'
          ? 'Short with price below falling session VWAP'
          : 'No VWAP day-trade alignment',
    ],
    metrics: {
      vwap: vwapNow != null ? Number(vwapNow.toFixed(5)) : null,
      distancePct: vwapNow != null ? Number((Math.abs(last.close - vwapNow) / last.close * 100).toFixed(3)) : null,
    },
  });
};

export const evaluateOpeningSessionTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const openingBars = Math.max(4, parseNumber(config.openingBars, 8));
  const bufferPct = parseNumber(config.bufferPct, 0.035);
  const window = candles.slice(-lookback);
  const openingWindow = window.slice(0, Math.min(openingBars, window.length));
  const openingHigh = Math.max(...openingWindow.map((item) => item.high));
  const openingLow = Math.min(...openingWindow.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > openingHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < openingLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > openingHigh - buffer) {
    bias = 'bullish';
  } else if (last.close < openingLow + buffer) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'opening-session-trading',
    context,
    config: { ...config, lookback, openingBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Opening session — first ${openingWindow.length} bars of ${lookback}-bar intraday window`,
      `Opening high ${openingHigh.toFixed(5)} / low ${openingLow.toFixed(5)}`,
      decision === 'buy'
        ? 'Break above opening session high'
        : decision === 'sell'
          ? 'Break below opening session low'
          : 'Inside opening session range',
    ],
    metrics: {
      openingHigh: Number(openingHigh.toFixed(5)),
      openingLow: Number(openingLow.toFixed(5)),
    },
  });
};

export const evaluateMeanReversionDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(14, parseNumber(config.period, 20));
  const stdDev = parseNumber(config.stdDev, 2);
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const closes = candles.map((item) => item.close);
  const bands = bollinger(closes, period, stdDev);
  const rsiSeries = rsi(closes, rsiPeriod);
  const last = closes.length - 1;
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  const mid = bands.middle[last];
  const close = closes[last]!;
  const rsiNow = rsiSeries[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (upper != null && lower != null && mid != null && rsiNow != null) {
    if (close <= lower && rsiNow < 40) {
      bias = 'bullish';
      decision = 'buy';
    } else if (close >= upper && rsiNow > 60) {
      bias = 'bearish';
      decision = 'sell';
    } else if (close < mid) {
      bias = 'bullish';
    } else if (close > mid) {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'mean-reversion-day-trading',
    context,
    config: { ...config, period, stdDev, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Mean reversion day — Bollinger(${period}, ${stdDev}) + RSI(${rsiPeriod})`,
      upper != null && lower != null ? `Close ${close.toFixed(5)} vs bands ${lower.toFixed(5)} – ${upper.toFixed(5)}` : 'Bands unavailable',
      decision === 'buy'
        ? 'Oversold band touch with RSI confirmation — fade long'
        : decision === 'sell'
          ? 'Overbought band touch with RSI confirmation — fade short'
          : 'No band extreme for day reversion',
    ],
    metrics: {
      upper: upper != null ? Number(upper.toFixed(5)) : null,
      lower: lower != null ? Number(lower.toFixed(5)) : null,
      mid: mid != null ? Number(mid.toFixed(5)) : null,
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
    },
  });
};

export const evaluateGapTradingEngine: StrategyEngine = (candles, config, context) => {
  const sessionBars = Math.max(8, parseNumber(config.sessionBars, 16));
  const minGapPct = parseNumber(config.minGapPct, 0.08);
  const fillTolerancePct = parseNumber(config.fillTolerancePct, 0.03);
  const sessionStart = Math.max(1, candles.length - sessionBars);
  const gapBar = candles[sessionStart];
  const priorBar = candles[sessionStart - 1];
  const last = candles[candles.length - 1]!;
  if (!gapBar || !priorBar) {
    return buildEvaluationResult({
      strategyId: 'gap-trading',
      context,
      config: { ...config, sessionBars, minGapPct, fillTolerancePct },
      candles,
      decision: 'wait',
      bias: 'neutral',
      confidence: 20,
      reasons: ['Insufficient bars for gap detection'],
      metrics: {},
    });
  }
  const gapPct = priorBar.close !== 0 ? ((gapBar.open - priorBar.close) / priorBar.close) * 100 : 0;
  const gapUp = gapPct >= minGapPct;
  const gapDown = gapPct <= -minGapPct;
  const gapLevel = priorBar.close;
  const tolerance = last.close * (fillTolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (gapUp && last.close > gapBar.high) {
    bias = 'bullish';
    decision = 'buy';
  } else if (gapDown && last.close < gapBar.low) {
    bias = 'bearish';
    decision = 'sell';
  } else if (gapUp && last.close <= gapLevel + tolerance && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (gapDown && last.close >= gapLevel - tolerance && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (gapUp) {
    bias = 'bullish';
  } else if (gapDown) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'gap-trading',
    context,
    config: { ...config, sessionBars, minGapPct, fillTolerancePct },
    candles,
    decision,
    bias,
    confidence: 32 + ((gapUp || gapDown) ? 12 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `Gap trading — session open gap vs prior close (${sessionBars}-bar day proxy)`,
      Math.abs(gapPct) >= minGapPct
        ? `${gapUp ? 'Gap up' : 'Gap down'} ${gapPct.toFixed(3)}% · fill level ${gapLevel.toFixed(5)}`
        : `Gap ${gapPct.toFixed(3)}% below minimum ${minGapPct}% threshold`,
      decision === 'buy'
        ? gapDown ? 'Gap fill bounce long' : 'Gap continuation long above gap bar high'
        : decision === 'sell'
          ? gapUp ? 'Gap fill fade short' : 'Gap continuation short below gap bar low'
          : 'No gap trade trigger on latest bar',
    ],
    metrics: {
      gapPct: Number(gapPct.toFixed(4)),
      gapLevel: Number(gapLevel.toFixed(5)),
    },
  });
};

export const evaluateReversalDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const rsiPeriod = Math.max(7, parseNumber(config.rsiPeriod, 14));
  const extremeHigh = parseNumber(config.extremeHigh, 72);
  const extremeLow = parseNumber(config.extremeLow, 28);
  const wickRatio = parseNumber(config.wickRatio, 1.6);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, rsiPeriod);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const rsiNow = rsiSeries[lastIndex];
  const range = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const bearishReversal = rsiNow != null && rsiNow >= extremeHigh && upperWick >= body * wickRatio && last.close < last.open;
  const bullishReversal = rsiNow != null && rsiNow <= extremeLow && lowerWick >= body * wickRatio && last.close > last.open;
  if (bullishReversal) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishReversal) {
    bias = 'bearish';
    decision = 'sell';
  } else if (rsiNow != null && rsiNow >= extremeHigh) {
    bias = 'bearish';
  } else if (rsiNow != null && rsiNow <= extremeLow) {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'reversal-day-trading',
    context,
    config: { ...config, rsiPeriod, extremeHigh, extremeLow, wickRatio },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Reversal day trade — RSI(${rsiPeriod}) extreme + rejection wick`,
      rsiNow != null ? `RSI ${rsiNow.toFixed(1)} (${extremeLow}/${extremeHigh})` : 'RSI unavailable',
      decision === 'buy'
        ? 'Oversold RSI with bullish rejection — reversal long'
        : decision === 'sell'
          ? 'Overbought RSI with bearish rejection — reversal short'
          : 'No intraday reversal confirmation',
    ],
    metrics: {
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      upperWick: Number(upperWick.toFixed(5)),
      lowerWick: Number(lowerWick.toFixed(5)),
    },
  });
};

export const evaluateNewsBasedDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(8, parseNumber(config.quietBars, 16));
  const impulseRatio = parseNumber(config.impulseRatio, 1.8);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars), lastIndex);
  const quietAvg = averageCandleRange(quietWindow);
  const lastRange = last.high - last.low;
  const impulse = quietAvg > 0 && lastRange >= quietAvg * impulseRatio;
  const bullish = impulse && last.close > last.open && (last.close - last.low) / Math.max(lastRange, 0.00001) >= 0.65;
  const bearish = impulse && last.close < last.open && (last.high - last.close) / Math.max(lastRange, 0.00001) >= 0.65;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullish) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearish) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'news-based-day-trading',
    context,
    config: { ...config, quietBars, impulseRatio },
    candles,
    decision,
    bias,
    confidence: 32 + (impulse ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `News-based day trade — ${quietBars}-bar quiet tape + headline impulse bar`,
      impulse
        ? `Impulse ${(lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)}× quiet baseline`
        : 'No event-style displacement on latest bar',
      decision === 'buy'
        ? 'Bullish news impulse day long'
        : decision === 'sell'
          ? 'Bearish news impulse day short'
          : 'Impulse lacks directional close',
    ],
    metrics: {
      impulseMultiple: Number((lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateCorrelationDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const fastBars = Math.max(5, parseNumber(config.fastBars, 8));
  const slowBars = Math.max(fastBars + 3, parseNumber(config.slowBars, 20));
  const minCorrelation = parseNumber(config.minCorrelation, 0.55);
  const fastWindow = candles.slice(-fastBars);
  const slowWindow = candles.slice(-slowBars);
  const fastReturns = barReturns(fastWindow);
  const slowReturns = barReturns(slowWindow).slice(-fastReturns.length);
  const correlation = pearsonCorrelation(fastReturns, slowReturns);
  const fastMomentum = fastWindow.length >= 2
    ? fastWindow.at(-1)!.close - fastWindow[0]!.close
    : 0;
  const alignedBull = correlation >= minCorrelation && fastMomentum > 0;
  const alignedBear = correlation >= minCorrelation && fastMomentum < 0;
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
    strategyId: 'correlation-day-trading',
    context,
    config: { ...config, fastBars, slowBars, minCorrelation },
    candles,
    decision,
    bias,
    confidence: 30 + (Math.abs(correlation) >= minCorrelation ? 16 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [
      `Correlation day trade — ${fastBars}-bar vs ${slowBars}-bar return alignment`,
      `Return correlation ${correlation.toFixed(2)} (min ${minCorrelation})`,
      decision === 'buy'
        ? 'Positive correlation with bullish fast momentum — day long'
        : decision === 'sell'
          ? 'Positive correlation with bearish fast momentum — day short'
          : 'Momentum windows not correlated enough for day entry',
    ],
    metrics: {
      correlation: Number(correlation.toFixed(3)),
      fastMomentum: Number(fastMomentum.toFixed(5)),
    },
  });
};

export const evaluatePivotPointDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const priorBars = Math.max(16, parseNumber(config.priorBars, 24));
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const priorWindow = candles.slice(-priorBars - 1, -1);
  const high = Math.max(...priorWindow.map((item) => item.high));
  const low = Math.min(...priorWindow.map((item) => item.low));
  const close = priorWindow.at(-1)?.close ?? candles[candles.length - 2]?.close ?? 0;
  const pivot = (high + low + close) / 3;
  const r1 = 2 * pivot - low;
  const s1 = 2 * pivot - high;
  const r2 = pivot + (high - low);
  const s2 = pivot - (high - low);
  const last = candles[candles.length - 1]!;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > r1 + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < s1 - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close > pivot && last.close <= r1) {
    bias = 'bullish';
    if (last.low <= pivot + buffer && last.close > last.open) decision = 'buy';
  } else if (last.close < pivot && last.close >= s1) {
    bias = 'bearish';
    if (last.high >= pivot - buffer && last.close < last.open) decision = 'sell';
  } else if (last.close > pivot) {
    bias = 'bullish';
  } else {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'pivot-point-day-trading',
    context,
    config: { ...config, priorBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Pivot day trade — classic floor pivots from prior ${priorWindow.length} bars`,
      `P ${pivot.toFixed(5)} · R1 ${r1.toFixed(5)} · S1 ${s1.toFixed(5)}`,
      decision === 'buy'
        ? last.close > r1 + buffer ? 'Break above R1' : 'Bounce from pivot support zone'
        : decision === 'sell'
          ? last.close < s1 - buffer ? 'Break below S1' : 'Rejection from pivot resistance zone'
          : 'Between pivot levels — no trigger',
    ],
    metrics: {
      pivot: Number(pivot.toFixed(5)),
      r1: Number(r1.toFixed(5)),
      s1: Number(s1.toFixed(5)),
      r2: Number(r2.toFixed(5)),
      s2: Number(s2.toFixed(5)),
    },
  });
};

export const evaluateRangeDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 36));
  const edgePct = parseNumber(config.edgePct, 12);
  const bufferPct = parseNumber(config.bufferPct, 0.03);
  const window = candles.slice(-lookback, -1);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - rangeLow) / rangeSize) * 100;
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > rangeHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close < rangeLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct <= 40) {
    bias = 'bullish';
  } else if (positionPct >= 60) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'range-day-trading',
    context,
    config: { ...config, lookback, edgePct, bufferPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 30 : 6),
    reasons: [
      `Range day trade — ${window.length}-bar intraday box (fade edges / break boundaries)`,
      `Range ${rangeLow.toFixed(5)} – ${rangeHigh.toFixed(5)} · price at ${positionPct.toFixed(0)}%`,
      decision === 'buy'
        ? last.close > rangeHigh + buffer ? 'Range breakout long' : 'Fade from lower range edge'
        : decision === 'sell'
          ? last.close < rangeLow - buffer ? 'Range breakout short' : 'Fade from upper range edge'
          : 'Mid-range — no day range entry',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
    },
  });
};

export const evaluateSmartMoneyDayTradingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const displacementMultiple = parseNumber(config.displacementMultiple, 1.5);
  const atrSeries = atr(candles, 14);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let blockHigh: number | null = null;
  let blockLow: number | null = null;

  for (let index = lastIndex - 3; index >= Math.max(2, lastIndex - lookback); index -= 1) {
    const atrNow = atrSeries[index] ?? 0;
    const body = Math.abs(candles[index]!.close - candles[index]!.open);
    const displacement = body >= atrNow * displacementMultiple;
    if (!displacement) continue;
    const bullish = candles[index]!.close > candles[index]!.open;
    const bearish = candles[index]!.close < candles[index]!.open;
    if (bullish) {
      blockLow = Math.min(candles[index]!.open, candles[index]!.close);
      blockHigh = candles[index]!.high;
      bias = 'bullish';
      if (last.low <= blockHigh && last.close > blockLow) decision = 'buy';
      break;
    }
    if (bearish) {
      blockHigh = Math.max(candles[index]!.open, candles[index]!.close);
      blockLow = candles[index]!.low;
      bias = 'bearish';
      if (last.high >= blockLow && last.close < blockHigh) decision = 'sell';
      break;
    }
  }

  return buildEvaluationResult({
    strategyId: 'smart-money-day-trading',
    context,
    config: { ...config, lookback, displacementMultiple },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 0) + (blockHigh != null ? 10 : 0),
    reasons: [
      'Smart money day trade — displacement order block + intraday mitigation retest',
      blockHigh != null && blockLow != null
        ? `Active block ${blockLow.toFixed(5)} – ${blockHigh.toFixed(5)}`
        : 'No qualifying displacement block in day lookback',
      decision === 'buy'
        ? 'Bullish mitigation into demand block — day long'
        : decision === 'sell'
          ? 'Bearish mitigation into supply block — day short'
          : 'Awaiting institutional block retest',
    ],
    metrics: {
      blockHigh: blockHigh != null ? Number(blockHigh.toFixed(5)) : null,
      blockLow: blockLow != null ? Number(blockLow.toFixed(5)) : null,
    },
    events: decision !== 'wait'
      ? [{
        label: decision === 'buy' ? 'demand block retest' : 'supply block retest',
        detail: 'Smart money mitigation entry',
        tone: decision === 'buy' ? 'emerald' : 'rose',
        barIndex: last.candleIndex,
      }]
      : [],
  });
};
