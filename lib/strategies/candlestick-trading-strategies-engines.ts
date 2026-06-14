import type { StrategyPriceCandle } from './strategy-candle-loader';
import {
  buildEvaluationResult,
  type StrategyEngine,
  type StrategyBias,
  type StrategySignalSide,
} from './evaluation';

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bodySize(c: StrategyPriceCandle): number {
  return Math.abs(c.close - c.open);
}

function candleRange(c: StrategyPriceCandle): number {
  return c.high - c.low;
}

function isBullish(c: StrategyPriceCandle): boolean {
  return c.close > c.open;
}

function isBearish(c: StrategyPriceCandle): boolean {
  return c.close < c.open;
}

function upperWick(c: StrategyPriceCandle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: StrategyPriceCandle): number {
  return Math.min(c.open, c.close) - c.low;
}

export const evaluateDojiEngine: StrategyEngine = (candles, config, context) => {
  const maxBodyPct = parseNumber(config.maxBodyPct, 12);
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2];
  const range = candleRange(last);
  const bodyPct = range > 0 ? (bodySize(last) / range) * 100 : 100;
  const doji = bodyPct <= maxBodyPct;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (doji && prev && last.close > prev.close && last.close > last.open) {
    bias = 'bullish';
    decision = 'buy';
  } else if (doji && prev && last.close < prev.close && last.close < last.open) {
    bias = 'bearish';
    decision = 'sell';
  }
  return buildEvaluationResult({
    strategyId: 'doji',
    context,
    config: { ...config, maxBodyPct },
    candles,
    decision,
    bias,
    confidence: 32 + (doji ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: ['Doji — indecision candle with minimal body', doji ? `Body ${bodyPct.toFixed(1)}% of range` : 'Not a doji', decision !== 'wait' ? 'Doji reversal confirmation' : 'Doji without confirmation'],
    metrics: { bodyPct: Number(bodyPct.toFixed(2)) },
  });
};

export const evaluateMorningStarEngine: StrategyEngine = (candles, config, context) => {
  const maxStarBodyPct = parseNumber(config.maxStarBodyPct, 35);
  if (candles.length < 3) {
    return buildEvaluationResult({ strategyId: 'morning-star', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles for morning star'] });
  }
  const [first, star, third] = candles.slice(-3);
  const starBodyPct = candleRange(star!) > 0 ? (bodySize(star!) / candleRange(star!)) * 100 : 100;
  const pattern = isBearish(first!) && starBodyPct <= maxStarBodyPct && isBullish(third!) && third!.close > (first!.open + first!.close) / 2;
  const decision: StrategySignalSide = pattern && third!.close > third!.open ? 'buy' : 'wait';
  return buildEvaluationResult({
    strategyId: 'morning-star',
    context,
    config: { ...config, maxStarBodyPct },
    candles,
    decision,
    bias: pattern ? 'bullish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 32 : pattern ? 10 : 0),
    reasons: ['Morning star — bearish + star + bullish reversal', pattern ? 'Three-candle morning star detected' : 'No morning star', decision === 'buy' ? 'Morning star long entry' : 'Awaiting morning star'],
    metrics: { starBodyPct: Number(starBodyPct.toFixed(2)) },
  });
};

export const evaluateEveningStarEngine: StrategyEngine = (candles, config, context) => {
  const maxStarBodyPct = parseNumber(config.maxStarBodyPct, 35);
  if (candles.length < 3) {
    return buildEvaluationResult({ strategyId: 'evening-star', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles for evening star'] });
  }
  const [first, star, third] = candles.slice(-3);
  const starBodyPct = candleRange(star!) > 0 ? (bodySize(star!) / candleRange(star!)) * 100 : 100;
  const pattern = isBullish(first!) && starBodyPct <= maxStarBodyPct && isBearish(third!) && third!.close < (first!.open + first!.close) / 2;
  const decision: StrategySignalSide = pattern && third!.close < third!.open ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'evening-star',
    context,
    config: { ...config, maxStarBodyPct },
    candles,
    decision,
    bias: pattern ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 32 : pattern ? 10 : 0),
    reasons: ['Evening star — bullish + star + bearish reversal', pattern ? 'Three-candle evening star detected' : 'No evening star', decision === 'sell' ? 'Evening star short entry' : 'Awaiting evening star'],
    metrics: { starBodyPct: Number(starBodyPct.toFixed(2)) },
  });
};

export const evaluateHammerEngine: StrategyEngine = (candles, config, context) => {
  const minWickRatio = parseNumber(config.minWickRatio, 2);
  const last = candles[candles.length - 1]!;
  const body = bodySize(last);
  const lower = lowerWick(last);
  const upper = upperWick(last);
  const hammer = body > 0 && lower / body >= minWickRatio && upper <= body * 0.5;
  const decision: StrategySignalSide = hammer && last.close >= last.open ? 'buy' : 'wait';
  return buildEvaluationResult({
    strategyId: 'hammer',
    context,
    config: { ...config, minWickRatio },
    candles,
    decision,
    bias: hammer ? 'bullish' : 'neutral',
    confidence: 35 + (decision !== 'wait' ? 30 : hammer ? 10 : 0),
    reasons: ['Hammer — long lower wick rejection', hammer ? `Lower wick ${(lower / Math.max(body, 0.00001)).toFixed(1)}× body` : 'Not a hammer', decision === 'buy' ? 'Hammer bullish reversal' : 'No hammer entry'],
    metrics: { wickRatio: Number((lower / Math.max(body, 0.00001)).toFixed(2)) },
  });
};

export const evaluateShootingStarEngine: StrategyEngine = (candles, config, context) => {
  const minWickRatio = parseNumber(config.minWickRatio, 2);
  const last = candles[candles.length - 1]!;
  const body = bodySize(last);
  const upper = upperWick(last);
  const lower = lowerWick(last);
  const shooting = body > 0 && upper / body >= minWickRatio && lower <= body * 0.5;
  const decision: StrategySignalSide = shooting && last.close <= last.open ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'shooting-star',
    context,
    config: { ...config, minWickRatio },
    candles,
    decision,
    bias: shooting ? 'bearish' : 'neutral',
    confidence: 35 + (decision !== 'wait' ? 30 : shooting ? 10 : 0),
    reasons: ['Shooting star — long upper wick rejection', shooting ? `Upper wick ${(upper / Math.max(body, 0.00001)).toFixed(1)}× body` : 'Not a shooting star', decision === 'sell' ? 'Shooting star bearish reversal' : 'No shooting star entry'],
    metrics: { wickRatio: Number((upper / Math.max(body, 0.00001)).toFixed(2)) },
  });
};

export const evaluateHaramiEngine: StrategyEngine = (candles, config, context) => {
  const maxInsidePct = parseNumber(config.maxInsidePct, 100);
  if (candles.length < 2) {
    return buildEvaluationResult({ strategyId: 'harami', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles for harami'] });
  }
  const [prev, last] = candles.slice(-2);
  const inside = last!.high <= prev!.high && last!.low >= prev!.low;
  const bodyInside = bodySize(last!) <= bodySize(prev!) * (maxInsidePct / 100);
  const bullish = isBearish(prev!) && inside && bodyInside && isBullish(last!);
  const bearish = isBullish(prev!) && inside && bodyInside && isBearish(last!);
  const decision: StrategySignalSide = bullish ? 'buy' : bearish ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'harami',
    context,
    config: { ...config, maxInsidePct },
    candles,
    decision,
    bias: bullish ? 'bullish' : bearish ? 'bearish' : 'neutral',
    confidence: 33 + (decision !== 'wait' ? 32 : inside ? 8 : 0),
    reasons: ['Harami — inside bar contained within prior body', inside ? 'Inside bar detected' : 'No inside bar', decision === 'buy' ? 'Bullish harami' : decision === 'sell' ? 'Bearish harami' : 'No harami signal'],
    metrics: { insideBar: inside ? 1 : 0 },
  });
};

export const evaluateTweezerTopBottomEngine: StrategyEngine = (candles, config, context) => {
  const tolerancePct = parseNumber(config.tolerancePct, 0.08);
  if (candles.length < 2) {
    return buildEvaluationResult({ strategyId: 'tweezer-top-bottom', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles for tweezer'] });
  }
  const [prev, last] = candles.slice(-2);
  const highDiff = Math.abs(prev!.high - last!.high) / Math.max(prev!.high, 0.00001) * 100;
  const lowDiff = Math.abs(prev!.low - last!.low) / Math.max(prev!.low, 0.00001) * 100;
  const tweezerTop = highDiff <= tolerancePct && isBullish(prev!) && isBearish(last!);
  const tweezerBottom = lowDiff <= tolerancePct && isBearish(prev!) && isBullish(last!);
  const decision: StrategySignalSide = tweezerBottom ? 'buy' : tweezerTop ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'tweezer-top-bottom',
    context,
    config: { ...config, tolerancePct },
    candles,
    decision,
    bias: tweezerBottom ? 'bullish' : tweezerTop ? 'bearish' : 'neutral',
    confidence: 34 + (decision !== 'wait' ? 32 : 0),
    reasons: ['Tweezer top/bottom — matching highs or lows', tweezerTop ? 'Tweezer top detected' : tweezerBottom ? 'Tweezer bottom detected' : 'No tweezer pattern', decision !== 'wait' ? 'Tweezer reversal entry' : 'Awaiting tweezer'],
    metrics: { highDiffPct: Number(highDiff.toFixed(3)), lowDiffPct: Number(lowDiff.toFixed(3)) },
  });
};

export const evaluateThreeSoldiersEngine: StrategyEngine = (candles, config, context) => {
  const minBodyPct = parseNumber(config.minBodyPct, 45);
  if (candles.length < 3) {
    return buildEvaluationResult({ strategyId: 'three-soldiers', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles'] });
  }
  const trio = candles.slice(-3);
  const soldiers = trio.every((c) => isBullish(c) && (candleRange(c) > 0 ? (bodySize(c) / candleRange(c)) * 100 >= minBodyPct : false))
    && trio[1]!.close > trio[0]!.close && trio[2]!.close > trio[1]!.close;
  return buildEvaluationResult({
    strategyId: 'three-soldiers',
    context,
    config: { ...config, minBodyPct },
    candles,
    decision: soldiers ? 'buy' : 'wait',
    bias: soldiers ? 'bullish' : 'neutral',
    confidence: 36 + (soldiers ? 34 : 0),
    reasons: ['Three soldiers — three consecutive bullish bodies', soldiers ? 'Three white soldiers pattern' : 'No three soldiers', soldiers ? 'Continuation long' : 'Awaiting three soldiers'],
    metrics: { pattern: soldiers ? 1 : 0 },
  });
};

export const evaluateThreeCrowsEngine: StrategyEngine = (candles, config, context) => {
  const minBodyPct = parseNumber(config.minBodyPct, 45);
  if (candles.length < 3) {
    return buildEvaluationResult({ strategyId: 'three-crows', context, config, candles, decision: 'wait', bias: 'neutral', confidence: 20, reasons: ['Insufficient candles'] });
  }
  const trio = candles.slice(-3);
  const crows = trio.every((c) => isBearish(c) && (candleRange(c) > 0 ? (bodySize(c) / candleRange(c)) * 100 >= minBodyPct : false))
    && trio[1]!.close < trio[0]!.close && trio[2]!.close < trio[1]!.close;
  return buildEvaluationResult({
    strategyId: 'three-crows',
    context,
    config: { ...config, minBodyPct },
    candles,
    decision: crows ? 'sell' : 'wait',
    bias: crows ? 'bearish' : 'neutral',
    confidence: 36 + (crows ? 34 : 0),
    reasons: ['Three crows — three consecutive bearish bodies', crows ? 'Three black crows pattern' : 'No three crows', crows ? 'Continuation short' : 'Awaiting three crows'],
    metrics: { pattern: crows ? 1 : 0 },
  });
};
