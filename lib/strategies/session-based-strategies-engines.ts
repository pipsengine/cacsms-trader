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

function sessionThirds(window: StrategyPriceCandle[]): {
  asian: StrategyPriceCandle[];
  london: StrategyPriceCandle[];
  newYork: StrategyPriceCandle[];
} {
  const third = Math.max(3, Math.floor(window.length / 3));
  return {
    asian: window.slice(0, third),
    london: window.slice(third, third * 2),
    newYork: window.slice(third * 2),
  };
}

function rangeHighLow(candles: StrategyPriceCandle[]): { high: number; low: number } {
  if (candles.length === 0) return { high: 0, low: 0 };
  return {
    high: Math.max(...candles.map((item) => item.high)),
    low: Math.min(...candles.map((item) => item.low)),
  };
}

function rocPct(candles: StrategyPriceCandle[]): number {
  if (candles.length < 2) return 0;
  const start = candles[0]!.close;
  const end = candles.at(-1)!.close;
  return start !== 0 ? ((end - start) / start) * 100 : 0;
}

function sessionBreakoutDecision(
  sessionRange: { high: number; low: number },
  last: StrategyPriceCandle,
  bufferPct: number,
): { bias: StrategyBias; decision: StrategySignalSide } {
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (last.close > sessionRange.high - buffer) {
    bias = 'bullish';
    if (last.close > sessionRange.high) decision = 'buy';
  } else if (last.close < sessionRange.low + buffer) {
    bias = 'bearish';
    if (last.close < sessionRange.low) decision = 'sell';
  }
  return { bias, decision };
}

export const evaluateAsianSessionStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback);
  const { asian } = sessionThirds(window);
  const sessionRange = rangeHighLow(asian);
  const last = candles[candles.length - 1]!;
  const { bias, decision } = sessionBreakoutDecision(sessionRange, last, bufferPct);

  return buildEvaluationResult({
    strategyId: 'asian-session-strategy',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 8),
    reasons: [
      `Asian session — range from first third of ${lookback}-bar window`,
      `High ${sessionRange.high.toFixed(5)} / low ${sessionRange.low.toFixed(5)}`,
      decision === 'buy' ? 'Asian range breakout long' : decision === 'sell' ? 'Asian range breakout short' : 'Inside Asian session range',
    ],
    metrics: {
      sessionHigh: Number(sessionRange.high.toFixed(5)),
      sessionLow: Number(sessionRange.low.toFixed(5)),
    },
  });
};

export const evaluateLondonSessionStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const minMomentumPct = parseNumber(config.minMomentumPct, 0.15);
  const window = candles.slice(-lookback);
  const { london } = sessionThirds(window);
  const momentum = rocPct(london);
  const sessionRange = rangeHighLow(london);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (momentum >= minMomentumPct && last.close > sessionRange.high * 0.999 && last.close > last.open) {
    decision = 'buy';
  } else if (momentum <= -minMomentumPct && last.close < sessionRange.low * 1.001 && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'london-session-strategy',
    context,
    config: { ...config, lookback, minMomentumPct },
    candles,
    decision,
    bias,
    confidence: 37 + (decision !== 'wait' ? 30 : 0) + Math.min(12, Math.abs(momentum) * 25),
    reasons: [
      'London session — middle-third momentum with range alignment',
      `London momentum ${momentum.toFixed(2)}% (min ±${minMomentumPct}%)`,
      decision === 'buy' ? 'London momentum long' : decision === 'sell' ? 'London momentum short' : 'London session lacks momentum trigger',
    ],
    metrics: {
      londonMomentumPct: Number(momentum.toFixed(3)),
    },
  });
};

export const evaluateNewYorkSessionStrategyEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const window = candles.slice(-lookback);
  const { newYork } = sessionThirds(window);
  const sessionRange = rangeHighLow(newYork);
  const last = candles[candles.length - 1]!;
  const { bias, decision } = sessionBreakoutDecision(sessionRange, last, bufferPct);

  return buildEvaluationResult({
    strategyId: 'new-york-session-strategy',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 32 : 8),
    reasons: [
      'New York session — final third range breakout model',
      `NY high ${sessionRange.high.toFixed(5)} / low ${sessionRange.low.toFixed(5)}`,
      decision === 'buy' ? 'NY session breakout long' : decision === 'sell' ? 'NY session breakout short' : 'Price inside NY session range',
    ],
    metrics: {
      sessionHigh: Number(sessionRange.high.toFixed(5)),
      sessionLow: Number(sessionRange.low.toFixed(5)),
    },
  });
};

export const evaluateLondonNewYorkOverlapEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const minOverlapPct = parseNumber(config.minOverlapPct, 0.2);
  const window = candles.slice(-lookback);
  const third = Math.max(4, Math.floor(window.length / 3));
  const overlap = window.slice(third - Math.floor(third / 3), third + Math.floor(third / 3));
  const overlapMomentum = rocPct(overlap);
  const overlapRange = rangeHighLow(overlap);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = overlapMomentum > 0 ? 'bullish' : overlapMomentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (Math.abs(overlapMomentum) >= minOverlapPct && overlapMomentum > 0 && last.close > overlapRange.high * 0.999) {
    decision = 'buy';
  } else if (Math.abs(overlapMomentum) >= minOverlapPct && overlapMomentum < 0 && last.close < overlapRange.low * 1.001) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'london-new-york-overlap',
    context,
    config: { ...config, lookback, minOverlapPct },
    candles,
    decision,
    bias,
    confidence: 38 + (decision !== 'wait' ? 28 : 0) + Math.min(14, Math.abs(overlapMomentum) * 20),
    reasons: [
      'London–New York overlap — blended middle-window momentum burst',
      `Overlap momentum ${overlapMomentum.toFixed(2)}% (min ±${minOverlapPct}%)`,
      decision === 'buy' ? 'Overlap momentum long' : decision === 'sell' ? 'Overlap momentum short' : 'Overlap flow insufficient',
    ],
    metrics: {
      overlapMomentumPct: Number(overlapMomentum.toFixed(3)),
    },
  });
};

export const evaluateTokyoBreakoutEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(15, parseNumber(config.lookback, 30));
  const tokyoBars = Math.max(4, parseNumber(config.tokyoBars, 8));
  const bufferPct = parseNumber(config.bufferPct, 0.05);
  const window = candles.slice(-lookback);
  const tokyoWindow = window.slice(0, Math.min(tokyoBars, window.length));
  const sessionRange = rangeHighLow(tokyoWindow);
  const last = candles[candles.length - 1]!;
  const atrSeries = atr(candles, 14);
  const atrNow = atrSeries[candles.length - 1] ?? 0;
  const expanding = (last.high - last.low) >= atrNow * 0.9;
  const { bias, decision: baseDecision } = sessionBreakoutDecision(sessionRange, last, bufferPct);
  const decision: StrategySignalSide = expanding ? baseDecision : 'wait';

  return buildEvaluationResult({
    strategyId: 'tokyo-breakout',
    context,
    config: { ...config, lookback, tokyoBars, bufferPct },
    candles,
    decision,
    bias,
    confidence: 35 + (decision !== 'wait' ? 34 : 0) + (expanding ? 10 : 0),
    reasons: [
      `Tokyo breakout — first ${tokyoWindow.length} bars as Tokyo box`,
      `Tokyo high ${sessionRange.high.toFixed(5)} / low ${sessionRange.low.toFixed(5)}`,
      decision === 'buy' ? 'Tokyo range expansion long' : decision === 'sell' ? 'Tokyo range expansion short' : 'No Tokyo breakout expansion',
    ],
    metrics: {
      tokyoHigh: Number(sessionRange.high.toFixed(5)),
      tokyoLow: Number(sessionRange.low.toFixed(5)),
    },
  });
};

export const evaluateSessionMomentumEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const activeThird = Math.max(0, Math.min(2, parseNumber(config.activeThird, 2)));
  const minMomentumPct = parseNumber(config.minMomentumPct, 0.22);
  const window = candles.slice(-lookback);
  const third = Math.max(4, Math.floor(window.length / 3));
  const activeWindow = window.slice(activeThird * third, (activeThird + 1) * third);
  const momentum = rocPct(activeWindow);
  const closes = candles.map((item) => item.close);
  const trendMa = ema(closes, Math.max(12, Math.floor(lookback / 3)))[closes.length - 1];
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = momentum > 0 ? 'bullish' : momentum < 0 ? 'bearish' : 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (momentum >= minMomentumPct && last.close > (trendMa ?? last.close) && last.close > last.open) {
    decision = 'buy';
  } else if (momentum <= -minMomentumPct && last.close < (trendMa ?? last.close) && last.close < last.open) {
    decision = 'sell';
  }

  return buildEvaluationResult({
    strategyId: 'session-momentum',
    context,
    config: { ...config, lookback, activeThird, minMomentumPct },
    candles,
    decision,
    bias,
    confidence: 36 + (decision !== 'wait' ? 30 : 0) + Math.min(14, Math.abs(momentum) * 18),
    reasons: [
      `Session momentum — third ${activeThird + 1} ROC with EMA trend filter`,
      `Session momentum ${momentum.toFixed(2)}% (min ±${minMomentumPct}%)`,
      decision === 'buy' ? 'Session momentum long' : decision === 'sell' ? 'Session momentum short' : 'Session momentum below threshold',
    ],
    metrics: {
      sessionMomentumPct: Number(momentum.toFixed(3)),
      activeThird,
    },
  });
};

export const evaluateSessionReversalEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(18, parseNumber(config.lookback, 36));
  const edgePct = parseNumber(config.edgePct, 12);
  const window = candles.slice(-lookback);
  const third = Math.max(4, Math.floor(window.length / 3));
  const activeWindow = window.slice(third, third * 2);
  const sessionRange = rangeHighLow(activeWindow);
  const span = sessionRange.high - sessionRange.low;
  const last = candles[candles.length - 1]!;
  const upperEdge = sessionRange.high - span * (edgePct / 100);
  const lowerEdge = sessionRange.low + span * (edgePct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';

  if (last.close >= upperEdge && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  } else if (last.close <= lowerEdge && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (last.close >= upperEdge) {
    bias = 'bearish';
  } else if (last.close <= lowerEdge) {
    bias = 'bullish';
  }

  return buildEvaluationResult({
    strategyId: 'session-reversal',
    context,
    config: { ...config, lookback, edgePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : 0) + (span > 0 ? 10 : 0),
    reasons: [
      'Session reversal — fade extremes at session box edges',
      `Upper edge ${upperEdge.toFixed(5)} · lower edge ${lowerEdge.toFixed(5)}`,
      decision === 'sell' ? 'Upper-edge session fade short' : decision === 'buy' ? 'Lower-edge session fade long' : 'Mid-session — no reversal edge',
    ],
    metrics: {
      sessionSpan: Number(span.toFixed(5)),
      edgePct,
    },
  });
};
