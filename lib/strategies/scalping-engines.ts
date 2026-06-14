import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';
import { crossover, ema, rsi, stochastic, vwap } from './indicators';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function averageCandleRange(candles: StrategyPriceCandle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / candles.length;
}

function microEmaCrossSignal(
  candles: StrategyPriceCandle[],
  fastPeriod: number,
  slowPeriod: number,
): { bias: StrategyBias; decision: StrategySignalSide; fast: number | null; slow: number | null; signal: ReturnType<typeof crossover> } {
  const closes = candles.map((item) => item.close);
  const fastSeries = ema(closes, fastPeriod);
  const slowSeries = ema(closes, slowPeriod);
  const last = closes.length - 1;
  const fast = fastSeries[last] ?? null;
  const slow = slowSeries[last] ?? null;
  const signal = crossover(fastSeries[last - 1] ?? null, fast, slowSeries[last - 1] ?? null, slow);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (fast != null && slow != null) {
    bias = fast > slow ? 'bullish' : fast < slow ? 'bearish' : 'neutral';
    if (signal === 'bullish_cross') decision = 'buy';
    else if (signal === 'bearish_cross') decision = 'sell';
    else if (bias === 'bullish' && closes[last]! > fast) decision = 'buy';
    else if (bias === 'bearish' && closes[last]! < fast) decision = 'sell';
  }
  return { bias, decision, fast, slow, signal };
}

export const evaluate1MinuteScalpingEngine: StrategyEngine = (candles, config, context) => {
  const scalpBars = Math.max(3, parseNumber(config.scalpBars, 4));
  const fastPeriod = Math.max(3, parseNumber(config.fastPeriod, 5));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 8));
  const micro = candles.slice(-scalpBars);
  const microHigh = Math.max(...micro.map((item) => item.high));
  const microLow = Math.min(...micro.map((item) => item.low));
  const { bias, decision, fast, slow, signal } = microEmaCrossSignal(candles, fastPeriod, slowPeriod);
  const last = candles[candles.length - 1]!;
  const microBreakUp = last.close > microHigh && last.close > last.open;
  const microBreakDown = last.close < microLow && last.close < last.open;
  let finalDecision = decision;
  if (finalDecision === 'wait' && microBreakUp && bias === 'bullish') finalDecision = 'buy';
  if (finalDecision === 'wait' && microBreakDown && bias === 'bearish') finalDecision = 'sell';

  return buildEvaluationResult({
    strategyId: '1-minute-scalping',
    context,
    config: { ...config, scalpBars, fastPeriod, slowPeriod },
    candles,
    decision: finalDecision,
    bias,
    confidence: 34 + (finalDecision !== 'wait' ? 32 : 6) + (signal !== 'none' ? 10 : 0),
    reasons: [
      `1-minute scalp proxy on ${context.timeframe} — ${scalpBars}-bar micro structure + EMA(${fastPeriod}/${slowPeriod})`,
      `Micro range ${microLow.toFixed(5)} – ${microHigh.toFixed(5)}`,
      finalDecision === 'buy'
        ? 'Micro breakout long with fast EMA alignment'
        : finalDecision === 'sell'
          ? 'Micro breakout short with fast EMA alignment'
          : 'No qualifying 1-minute scalp entry on latest bar',
    ],
    metrics: {
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      slowEma: slow != null ? Number(slow.toFixed(5)) : null,
      microHigh: Number(microHigh.toFixed(5)),
      microLow: Number(microLow.toFixed(5)),
    },
  });
};

export const evaluate5MinuteScalpingEngine: StrategyEngine = (candles, config, context) => {
  const scalpBars = Math.max(5, parseNumber(config.scalpBars, 8));
  const fastPeriod = Math.max(5, parseNumber(config.fastPeriod, 8));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 13));
  const window = candles.slice(-scalpBars, -1);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const { bias, decision, fast, slow, signal } = microEmaCrossSignal(candles, fastPeriod, slowPeriod);
  const last = candles[candles.length - 1]!;
  let finalDecision = decision;
  if (finalDecision === 'wait' && last.close > rangeHigh && bias !== 'bearish') finalDecision = 'buy';
  if (finalDecision === 'wait' && last.close < rangeLow && bias !== 'bullish') finalDecision = 'sell';

  return buildEvaluationResult({
    strategyId: '5-minute-scalping',
    context,
    config: { ...config, scalpBars, fastPeriod, slowPeriod },
    candles,
    decision: finalDecision,
    bias,
    confidence: 36 + (finalDecision !== 'wait' ? 30 : 8) + (signal !== 'none' ? 8 : 0),
    reasons: [
      `5-minute scalp proxy — ${scalpBars}-bar range + EMA(${fastPeriod}/${slowPeriod}) on ${context.timeframe}`,
      `Scalp box high ${rangeHigh.toFixed(5)} / low ${rangeLow.toFixed(5)}`,
      finalDecision === 'buy'
        ? 'Break above 5m scalp range with trend alignment'
        : finalDecision === 'sell'
          ? 'Break below 5m scalp range with trend alignment'
          : 'Inside 5-minute scalp range — wait',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      slowEma: slow != null ? Number(slow.toFixed(5)) : null,
    },
  });
};

export const evaluateTickScalpingEngine: StrategyEngine = (candles, config, context) => {
  const impulseRatio = parseNumber(config.impulseRatio, 1.6);
  const baselineBars = Math.max(5, parseNumber(config.baselineBars, 10));
  const last = candles[candles.length - 1]!;
  const baseline = candles.slice(Math.max(0, candles.length - baselineBars - 1), candles.length - 1);
  const baselineAvg = averageCandleRange(baseline);
  const lastRange = last.high - last.low;
  const tickImpulse = baselineAvg > 0 && lastRange >= baselineAvg * impulseRatio;
  const closeNearHigh = lastRange > 0 && (last.close - last.low) / lastRange >= 0.75;
  const closeNearLow = lastRange > 0 && (last.high - last.close) / lastRange >= 0.75;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (tickImpulse && closeNearHigh && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (tickImpulse && closeNearLow && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'tick-scalping',
    context,
    config: { ...config, impulseRatio, baselineBars },
    candles,
    decision,
    bias,
    confidence: 32 + (tickImpulse ? 14 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      'Tick scalp — displacement bar versus micro baseline range',
      tickImpulse
        ? `Impulse bar ${(lastRange / Math.max(baselineAvg, 0.00001)).toFixed(2)}× baseline average range`
        : 'Latest bar lacks tick-level displacement',
      decision === 'buy'
        ? 'Aggressive close near high — micro tick long'
        : decision === 'sell'
          ? 'Aggressive close near low — micro tick short'
          : 'No tick scalp signal',
    ],
    metrics: {
      lastRange: Number(lastRange.toFixed(5)),
      baselineAvgRange: Number(baselineAvg.toFixed(5)),
      impulseMultiple: Number((lastRange / Math.max(baselineAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateSpreadScalpingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(6, parseNumber(config.lookback, 12));
  const edgePct = parseNumber(config.edgePct, 15);
  const window = candles.slice(-lookback);
  const rangeHigh = Math.max(...window.map((item) => item.high));
  const rangeLow = Math.min(...window.map((item) => item.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0.00001);
  const avgRange = averageCandleRange(window);
  const tight = rangeSize <= avgRange * lookback * 0.85;
  const last = candles[candles.length - 1]!;
  const positionPct = ((last.close - rangeLow) / rangeSize) * 100;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (tight && positionPct <= edgePct && last.close >= last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (tight && positionPct >= 100 - edgePct && last.close <= last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (positionPct <= 35) {
    bias = 'bullish';
  } else if (positionPct >= 65) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'spread-scalping',
    context,
    config: { ...config, lookback, edgePct },
    candles,
    decision,
    bias,
    confidence: 30 + (tight ? 12 : 0) + (decision !== 'wait' ? 34 : 4),
    reasons: [
      `Spread scalp — fade micro-range edges (${lookback}-bar tight range)`,
      tight
        ? `Compressed range ${rangeSize.toFixed(5)} · price at ${positionPct.toFixed(0)}% of box`
        : `Range not tight enough for spread scalp (${rangeSize.toFixed(5)})`,
      decision === 'buy'
        ? 'Long from lower spread edge with bullish close'
        : decision === 'sell'
          ? 'Short from upper spread edge with bearish close'
          : 'Mid-range — no spread edge entry',
    ],
    metrics: {
      rangeHigh: Number(rangeHigh.toFixed(5)),
      rangeLow: Number(rangeLow.toFixed(5)),
      positionPct: Number(positionPct.toFixed(1)),
      tightRange: tight ? 'yes' : 'no',
    },
  });
};

export const evaluateOrderFlowScalpingEngine: StrategyEngine = (candles, config, context) => {
  const flowBars = Math.max(3, parseNumber(config.flowBars, 5));
  const minSameDirection = Math.max(2, parseNumber(config.minSameDirection, 3));
  const recent = candles.slice(-flowBars);
  const bullishBars = recent.filter((item) => item.close > item.open).length;
  const bearishBars = recent.filter((item) => item.close < item.open).length;
  const risingRange = recent.length >= 2
    && averageCandleRange(recent.slice(-2)) >= averageCandleRange(recent.slice(0, -2)) * 1.05;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishBars >= minSameDirection && risingRange) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishBars >= minSameDirection && risingRange) {
    bias = 'bearish';
    decision = 'sell';
  } else if (bullishBars > bearishBars) {
    bias = 'bullish';
  } else if (bearishBars > bullishBars) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'order-flow-scalping',
    context,
    config: { ...config, flowBars, minSameDirection },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 34 : 6) + Math.min(12, Math.abs(bullishBars - bearishBars) * 3),
    reasons: [
      `Order-flow scalp proxy — ${flowBars}-bar directional pressure + expanding range`,
      `${bullishBars} bullish / ${bearishBars} bearish closes in flow window`,
      decision === 'buy'
        ? 'Sustained buy-side pressure with range expansion'
        : decision === 'sell'
          ? 'Sustained sell-side pressure with range expansion'
          : 'Order flow not one-sided enough for scalp entry',
    ],
    metrics: {
      bullishBars,
      bearishBars,
      rangeExpanding: risingRange ? 'yes' : 'no',
    },
  });
};

export const evaluateDomScalpingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(8, parseNumber(config.lookback, 15));
  const touchTolerancePct = parseNumber(config.touchTolerancePct, 0.03);
  const window = candles.slice(-lookback, -1);
  const levelHigh = Math.max(...window.map((item) => item.high));
  const levelLow = Math.min(...window.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const tolerance = last.close * (touchTolerancePct / 100);
  const touchesHigh = window.filter((item) => Math.abs(item.high - levelHigh) <= tolerance).length;
  const touchesLow = window.filter((item) => Math.abs(item.low - levelLow) <= tolerance).length;
  const absorbedAtHigh = touchesHigh >= 2 && last.close < levelHigh - tolerance && last.close < last.open;
  const absorbedAtLow = touchesLow >= 2 && last.close > levelLow + tolerance && last.close > last.open;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (absorbedAtLow) {
    bias = 'bullish';
    decision = 'buy';
  } else if (absorbedAtHigh) {
    bias = 'bearish';
    decision = 'sell';
  } else if (touchesLow >= 2) {
    bias = 'bullish';
  } else if (touchesHigh >= 2) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'dom-scalping',
    context,
    config: { ...config, lookback, touchTolerancePct },
    candles,
    decision,
    bias,
    confidence: 30 + (decision !== 'wait' ? 36 : 4) + Math.min(10, (touchesHigh + touchesLow) * 2),
    reasons: [
      `DOM scalp proxy — repeated level absorption over ${lookback} bars`,
      `Level high ${levelHigh.toFixed(5)} (${touchesHigh} touches) / low ${levelLow.toFixed(5)} (${touchesLow} touches)`,
      decision === 'buy'
        ? 'Bid absorption at level low — bounce scalp long'
        : decision === 'sell'
          ? 'Offer absorption at level high — fade scalp short'
          : 'No DOM-style absorption reversal on latest bar',
    ],
    metrics: {
      levelHigh: Number(levelHigh.toFixed(5)),
      levelLow: Number(levelLow.toFixed(5)),
      touchesHigh,
      touchesLow,
    },
  });
};

export const evaluateMomentumScalpingEngine: StrategyEngine = (candles, config, context) => {
  const rocBars = Math.max(3, parseNumber(config.rocBars, 5));
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 7));
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const prior = closes[last - rocBars];
  const roc = prior != null && prior !== 0 ? ((closes[last]! - prior) / prior) * 100 : 0;
  const rsiSeries = rsi(closes, rsiPeriod);
  const rsiNow = rsiSeries[last];
  const rsiPrev = rsiSeries[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (roc > 0.04 && rsiNow != null && rsiPrev != null && rsiNow > 50 && rsiNow > rsiPrev) {
    bias = 'bullish';
    decision = 'buy';
  } else if (roc < -0.04 && rsiNow != null && rsiPrev != null && rsiNow < 50 && rsiNow < rsiPrev) {
    bias = 'bearish';
    decision = 'sell';
  } else if (roc > 0) {
    bias = 'bullish';
  } else if (roc < 0) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'momentum-scalping',
    context,
    config: { ...config, rocBars, rsiPeriod },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6) + Math.min(14, Math.abs(roc) * 80),
    reasons: [
      `Momentum scalp — ${rocBars}-bar ROC + RSI(${rsiPeriod}) micro confirmation`,
      `ROC ${roc.toFixed(3)}% · RSI ${rsiNow?.toFixed(1) ?? 'n/a'}`,
      decision === 'buy'
        ? 'Positive momentum with rising RSI above midline'
        : decision === 'sell'
          ? 'Negative momentum with falling RSI below midline'
          : 'Momentum not aligned for scalp entry',
    ],
    metrics: {
      rocPct: Number(roc.toFixed(4)),
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
    },
  });
};

export const evaluateEmaScalpingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(3, parseNumber(config.fastPeriod, 5));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 9));
  const { bias, decision, fast, slow, signal } = microEmaCrossSignal(candles, fastPeriod, slowPeriod);

  return buildEvaluationResult({
    strategyId: 'ema-scalping',
    context,
    config: { ...config, fastPeriod, slowPeriod },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 8) + (signal !== 'none' ? 12 : 0),
    reasons: [
      `EMA scalp — fast EMA(${fastPeriod}) / EMA(${slowPeriod}) micro trend execution`,
      fast != null && slow != null ? `Fast ${fast.toFixed(5)} vs slow ${slow.toFixed(5)}` : 'EMA values unavailable',
      decision === 'buy'
        ? 'Bullish EMA stack / cross — scalp long'
        : decision === 'sell'
          ? 'Bearish EMA stack / cross — scalp short'
          : signal !== 'none'
            ? 'EMA cross detected but close not confirming'
            : 'No EMA scalp signal',
    ],
    metrics: {
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      slowEma: slow != null ? Number(slow.toFixed(5)) : null,
    },
    events: signal !== 'none'
      ? [{ label: signal.replace('_', ' '), detail: 'Micro EMA crossover', tone: signal === 'bullish_cross' ? 'emerald' : 'rose', barIndex: candles.length - 1 }]
      : [],
  });
};

export const evaluateVwapScalpingEngine: StrategyEngine = (candles, config, context) => {
  const tolerancePct = parseNumber(config.tolerancePct, 0.05);
  const vwapSeries = vwap(candles);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const vwapNow = vwapSeries[lastIndex];
  const vwapPrev = vwapSeries[lastIndex - 1];
  const tolerance = last.close * (tolerancePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (vwapNow != null && vwapPrev != null) {
    const above = last.close > vwapNow;
    const nearVwap = Math.abs(last.close - vwapNow) <= tolerance;
    const vwapRising = vwapNow > vwapPrev;
    if (nearVwap && vwapRising && last.close > last.open && last.low <= vwapNow + tolerance) {
      bias = 'bullish';
      decision = 'buy';
    } else if (nearVwap && !vwapRising && last.close < last.open && last.high >= vwapNow - tolerance) {
      bias = 'bearish';
      decision = 'sell';
    } else if (above) {
      bias = 'bullish';
    } else {
      bias = 'bearish';
    }
  }

  return buildEvaluationResult({
    strategyId: 'vwap-scalping',
    context,
    config: { ...config, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      'VWAP scalp — session VWAP bounce with range-volume proxy',
      vwapNow != null ? `VWAP ${vwapNow.toFixed(5)} · close ${last.close.toFixed(5)}` : 'VWAP unavailable',
      decision === 'buy'
        ? 'Bullish rejection off rising VWAP — scalp long'
        : decision === 'sell'
          ? 'Bearish rejection off falling VWAP — scalp short'
          : 'Price not at actionable VWAP retest zone',
    ],
    metrics: {
      vwap: vwapNow != null ? Number(vwapNow.toFixed(5)) : null,
      distancePct: vwapNow != null ? Number((Math.abs(last.close - vwapNow) / last.close * 100).toFixed(3)) : null,
    },
  });
};

export const evaluateRsiScalpingEngine: StrategyEngine = (candles, config, context) => {
  const period = Math.max(5, parseNumber(config.period, 7));
  const oversold = parseNumber(config.oversold, 25);
  const overbought = parseNumber(config.overbought, 75);
  const closes = candles.map((item) => item.close);
  const rsiSeries = rsi(closes, period);
  const last = closes.length - 1;
  const value = rsiSeries[last];
  const prev = rsiSeries[last - 1];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (value != null) {
    if (value >= 55) bias = 'bullish';
    else if (value <= 45) bias = 'bearish';
    if (prev != null && prev <= oversold && value > oversold) decision = 'buy';
    if (prev != null && prev >= overbought && value < overbought) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'rsi-scalping',
    context,
    config: { ...config, period, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0) + (value != null ? Math.min(18, Math.abs(value - 50) / 2) : 0),
    reasons: [
      `RSI(${period}) micro mean-reversion scalp (${oversold}/${overbought})`,
      value != null ? `RSI ${value.toFixed(1)}` : 'RSI unavailable',
      decision === 'buy'
        ? 'Bullish RSI bounce from oversold — scalp long'
        : decision === 'sell'
          ? 'Bearish RSI fade from overbought — scalp short'
          : 'RSI mid-zone — no scalp trigger',
    ],
    metrics: { rsi: value != null ? Number(value.toFixed(2)) : null },
  });
};

export const evaluateStochasticScalpingEngine: StrategyEngine = (candles, config, context) => {
  const kPeriod = Math.max(5, parseNumber(config.kPeriod, 5));
  const dPeriod = Math.max(2, parseNumber(config.dPeriod, 3));
  const oversold = parseNumber(config.oversold, 25);
  const overbought = parseNumber(config.overbought, 75);
  const { k, d } = stochastic(candles, kPeriod, dPeriod);
  const last = candles.length - 1;
  const kNow = k[last];
  const kPrev = k[last - 1];
  const dNow = d[last];
  const dPrev = d[last - 1];
  const cross = crossover(kPrev, kNow, dPrev, dNow);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (kNow != null) {
    if (kNow >= 55) bias = 'bullish';
    else if (kNow <= 45) bias = 'bearish';
    if (cross === 'bullish_cross' && kNow <= oversold + 10) decision = 'buy';
    if (cross === 'bearish_cross' && kNow >= overbought - 10) decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'stochastic-scalping',
    context,
    config: { ...config, kPeriod, dPeriod, oversold, overbought },
    candles,
    decision,
    bias,
    confidence: 34 + (cross !== 'none' ? 30 : 0) + (kNow != null ? Math.min(16, Math.abs(kNow - 50) / 2) : 0),
    reasons: [
      `Stochastic(${kPeriod}, ${dPeriod}) fast scalp crossover`,
      kNow != null && dNow != null ? `%K ${kNow.toFixed(1)} / %D ${dNow.toFixed(1)}` : 'Stochastic unavailable',
      decision === 'buy'
        ? 'Bullish stochastic cross from low zone'
        : decision === 'sell'
          ? 'Bearish stochastic cross from high zone'
          : cross !== 'none'
            ? 'Cross detected outside scalp zones'
            : 'No stochastic scalp signal',
    ],
    metrics: {
      k: kNow != null ? Number(kNow.toFixed(2)) : null,
      d: dNow != null ? Number(dNow.toFixed(2)) : null,
    },
  });
};

export const evaluatePriceActionScalpingEngine: StrategyEngine = (candles, config, context) => {
  const wickRatio = parseNumber(config.wickRatio, 1.8);
  const last = candles.length - 1;
  const candle = candles[last]!;
  const prior = candles[last - 1];
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const bullishEngulf = prior != null
    && prior.close < prior.open
    && candle.close > candle.open
    && candle.close >= prior.open
    && candle.open <= prior.close;
  const bearishEngulf = prior != null
    && prior.close > prior.open
    && candle.close < candle.open
    && candle.close <= prior.open
    && candle.open >= prior.close;
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const bullishPin = lowerWick >= body * wickRatio && candle.close > candle.open;
  const bearishPin = upperWick >= body * wickRatio && candle.close < candle.open;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullishEngulf || bullishPin) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishEngulf || bearishPin) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'price-action-scalping',
    context,
    config: { ...config, wickRatio },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 34 : 0),
    reasons: [
      'Price-action scalp — engulfing / pin rejection on latest bar',
      bullishEngulf
        ? 'Bullish engulfing — scalp long'
        : bearishEngulf
          ? 'Bearish engulfing — scalp short'
          : bullishPin
            ? 'Bullish pin rejection — scalp long'
            : bearishPin
              ? 'Bearish pin rejection — scalp short'
              : 'No qualifying PA pattern on latest bar',
    ],
    metrics: {
      pattern: bullishEngulf ? 'bullish engulfing' : bearishEngulf ? 'bearish engulfing' : bullishPin ? 'bullish pin' : bearishPin ? 'bearish pin' : 'none',
      range: Number(range.toFixed(5)),
    },
  });
};

export const evaluateLiquidityGrabScalpingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(8, parseNumber(config.lookback, 12));
  const sweepBufferPct = parseNumber(config.sweepBufferPct, 0.015);
  const window = candles.slice(-lookback - 1, -1);
  const last = candles[candles.length - 1]!;
  const recentHigh = Math.max(...window.map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const sweepBuffer = last.close * (sweepBufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const bullishGrab = last.low < recentLow - sweepBuffer && last.close > recentLow;
  const bearishGrab = last.high > recentHigh + sweepBuffer && last.close < recentHigh;
  if (bullishGrab) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearishGrab) {
    bias = 'bearish';
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'liquidity-grab-scalping',
    context,
    config: { ...config, lookback, sweepBufferPct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 36 : 0),
    reasons: [
      `Liquidity grab scalp — ${lookback}-bar micro pool sweep + reversal`,
      `Pool high ${recentHigh.toFixed(5)} / low ${recentLow.toFixed(5)}`,
      bullishGrab
        ? 'Micro sweep below lows with close back inside — long scalp'
        : bearishGrab
          ? 'Micro sweep above highs with close back inside — short scalp'
          : 'No liquidity grab scalp on latest bar',
    ],
    metrics: {
      recentHigh: Number(recentHigh.toFixed(5)),
      recentLow: Number(recentLow.toFixed(5)),
    },
  });
};

export const evaluateNewsScalpingEngine: StrategyEngine = (candles, config, context) => {
  const quietBars = Math.max(4, parseNumber(config.quietBars, 8));
  const impulseRatio = parseNumber(config.impulseRatio, 2);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex]!;
  const quietWindow = candles.slice(Math.max(0, lastIndex - quietBars), lastIndex);
  const quietAvg = averageCandleRange(quietWindow);
  const lastRange = last.high - last.low;
  const impulse = quietAvg > 0 && lastRange >= quietAvg * impulseRatio;
  const bullish = impulse && last.close > last.open && (last.close - last.low) / Math.max(lastRange, 0.00001) >= 0.7;
  const bearish = impulse && last.close < last.open && (last.high - last.close) / Math.max(lastRange, 0.00001) >= 0.7;
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
    strategyId: 'news-scalping',
    context,
    config: { ...config, quietBars, impulseRatio },
    candles,
    decision,
    bias,
    confidence: 30 + (impulse ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: [
      `News scalp — ${quietBars}-bar quiet tape + displacement impulse`,
      impulse
        ? `Impulse ${(lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)}× quiet baseline`
        : 'No event-style displacement on latest bar',
      decision === 'buy'
        ? 'Bullish news impulse scalp long'
        : decision === 'sell'
          ? 'Bearish news impulse scalp short'
          : 'Impulse lacks directional close confirmation',
    ],
    metrics: {
      impulseMultiple: Number((lastRange / Math.max(quietAvg, 0.00001)).toFixed(2)),
    },
  });
};

export const evaluateSessionScalpingEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(12, parseNumber(config.lookback, 24));
  const sessionBars = Math.max(4, parseNumber(config.sessionBars, 6));
  const bufferPct = parseNumber(config.bufferPct, 0.025);
  const window = candles.slice(-lookback);
  const sessionWindow = window.slice(0, Math.min(sessionBars, window.length));
  const sessionHigh = Math.max(...sessionWindow.map((item) => item.high));
  const sessionLow = Math.min(...sessionWindow.map((item) => item.low));
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
    strategyId: 'session-scalping',
    context,
    config: { ...config, lookback, sessionBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 6),
    reasons: [
      `Session scalp — opening ${sessionWindow.length}-bar box inside ${lookback}-bar window`,
      `Session high ${sessionHigh.toFixed(5)} / low ${sessionLow.toFixed(5)}`,
      decision === 'buy'
        ? 'Scalp long on session high break'
        : decision === 'sell'
          ? 'Scalp short on session low break'
          : 'Inside session box — wait for break',
    ],
    metrics: {
      sessionHigh: Number(sessionHigh.toFixed(5)),
      sessionLow: Number(sessionLow.toFixed(5)),
    },
  });
};

export const evaluateHighFrequencyScalpingEngine: StrategyEngine = (candles, config, context) => {
  const alignBars = Math.max(2, parseNumber(config.alignBars, 3));
  const fastPeriod = Math.max(3, parseNumber(config.fastPeriod, 4));
  const recent = candles.slice(-alignBars);
  const allBullish = recent.every((item) => item.close > item.open);
  const allBearish = recent.every((item) => item.close < item.open);
  const closes = candles.map((item) => item.close);
  const fastEma = ema(closes, fastPeriod);
  const last = closes.length - 1;
  const fast = fastEma[last];
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (allBullish && fast != null && closes[last]! > fast) {
    bias = 'bullish';
    decision = 'buy';
  } else if (allBearish && fast != null && closes[last]! < fast) {
    bias = 'bearish';
    decision = 'sell';
  } else if (fast != null) {
    bias = closes[last]! > fast ? 'bullish' : 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'high-frequency-scalping',
    context,
    config: { ...config, alignBars, fastPeriod },
    candles,
    decision,
    bias,
    confidence: 32 + (decision !== 'wait' ? 36 : 6),
    reasons: [
      `HFT scalp proxy — ${alignBars}-bar alignment + EMA(${fastPeriod}) filter`,
      allBullish ? 'Consecutive bullish micro bars' : allBearish ? 'Consecutive bearish micro bars' : 'Mixed micro bar direction',
      decision === 'buy'
        ? 'High-frequency bullish alignment — scalp long'
        : decision === 'sell'
          ? 'High-frequency bearish alignment — scalp short'
          : 'Micro structure not aligned for HFT scalp',
    ],
    metrics: {
      fastEma: fast != null ? Number(fast.toFixed(5)) : null,
      alignedBars: allBullish ? alignBars : allBearish ? -alignBars : 0,
    },
  });
};

export const evaluateAlgorithmicScalpingEngine: StrategyEngine = (candles, config, context) => {
  const fastPeriod = Math.max(3, parseNumber(config.fastPeriod, 5));
  const slowPeriod = Math.max(fastPeriod + 1, parseNumber(config.slowPeriod, 9));
  const rsiPeriod = Math.max(5, parseNumber(config.rsiPeriod, 7));
  const minScore = parseNumber(config.minScore, 2);
  const closes = candles.map((item) => item.close);
  const last = closes.length - 1;
  const { bias: emaBias, fast, slow } = microEmaCrossSignal(candles, fastPeriod, slowPeriod);
  const rsiSeries = rsi(closes, rsiPeriod);
  const rsiNow = rsiSeries[last];
  const priorClose = closes[last - 3];
  const roc = priorClose != null && priorClose !== 0 ? ((closes[last]! - priorClose) / priorClose) * 100 : 0;
  let bullScore = 0;
  let bearScore = 0;
  if (emaBias === 'bullish') bullScore += 1;
  if (emaBias === 'bearish') bearScore += 1;
  if (fast != null && slow != null && fast > slow) bullScore += 1;
  if (fast != null && slow != null && fast < slow) bearScore += 1;
  if (rsiNow != null && rsiNow > 52) bullScore += 1;
  if (rsiNow != null && rsiNow < 48) bearScore += 1;
  if (roc > 0.03) bullScore += 1;
  if (roc < -0.03) bearScore += 1;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (bullScore >= minScore && bullScore > bearScore) {
    bias = 'bullish';
    decision = 'buy';
  } else if (bearScore >= minScore && bearScore > bullScore) {
    bias = 'bearish';
    decision = 'sell';
  } else if (bullScore > bearScore) {
    bias = 'bullish';
  } else if (bearScore > bullScore) {
    bias = 'bearish';
  }

  return buildEvaluationResult({
    strategyId: 'algorithmic-scalping',
    context,
    config: { ...config, fastPeriod, slowPeriod, rsiPeriod, minScore },
    candles,
    decision,
    bias,
    confidence: 28 + Math.max(bullScore, bearScore) * 12 + (decision !== 'wait' ? 20 : 0),
    reasons: [
      'Algorithmic scalp — fused EMA trend + RSI + ROC micro score',
      `Bull score ${bullScore} / bear score ${bearScore} (min ${minScore})`,
      decision === 'buy'
        ? 'Composite algorithmic long signal'
        : decision === 'sell'
          ? 'Composite algorithmic short signal'
          : 'Composite score below execution threshold',
    ],
    metrics: {
      bullScore,
      bearScore,
      rsi: rsiNow != null ? Number(rsiNow.toFixed(2)) : null,
      rocPct: Number(roc.toFixed(4)),
    },
  });
};
