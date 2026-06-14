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

function windowThirds(window: StrategyPriceCandle[]) {
  const third = Math.max(3, Math.floor(window.length / 3));
  return {
    early: window.slice(0, third),
    mid: window.slice(third, third * 2),
    late: window.slice(third * 2),
    third,
  };
}

function harmonicPoints(window: StrategyPriceCandle[], ratios: number[]): StrategyPriceCandle[] {
  return ratios.map((ratio) => window[Math.floor(window.length * ratio)]!).filter(Boolean);
}

function ratio(a: number, b: number): number {
  return b !== 0 ? a / b : 0;
}

function convergingTriangle(window: StrategyPriceCandle[]): {
  valid: boolean;
  kind: string;
  apexHigh: number;
  apexLow: number;
} {
  const { early, mid, late } = windowThirds(window);
  const pattern = late.length >= 2 ? late : window.slice(-Math.max(3, Math.floor(window.length / 4)));
  const earlyHigh = Math.max(...early.map((item) => item.high));
  const midHigh = Math.max(...mid.map((item) => item.high));
  const lateHigh = Math.max(...pattern.map((item) => item.high));
  const earlyLow = Math.min(...early.map((item) => item.low));
  const midLow = Math.min(...mid.map((item) => item.low));
  const lateLow = Math.min(...pattern.map((item) => item.low));
  const convergingHighs = earlyHigh > midHigh && midHigh >= lateHigh * 0.998;
  const convergingLows = earlyLow < midLow && midLow <= lateLow * 1.002;
  const ascending = convergingLows && !convergingHighs;
  const descending = convergingHighs && !convergingLows;
  const symmetrical = convergingHighs && convergingLows;
  const valid = symmetrical || ascending || descending;
  const kind = symmetrical ? 'symmetrical' : ascending ? 'ascending' : descending ? 'descending' : 'unconfirmed';
  return { valid, kind, apexHigh: Math.max(lateHigh, midHigh), apexLow: Math.min(lateLow, midLow) };
}

function breakoutFromRange(
  rangeHigh: number,
  rangeLow: number,
  last: StrategyPriceCandle,
  bufferPct: number,
  valid: boolean,
): { bias: StrategyBias; decision: StrategySignalSide } {
  const buffer = last.close * (bufferPct / 100);
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  if (valid && last.close > rangeHigh + buffer) {
    bias = 'bullish';
    decision = 'buy';
  } else if (valid && last.close < rangeLow - buffer) {
    bias = 'bearish';
    decision = 'sell';
  } else if (valid && last.close > rangeHigh - buffer) {
    bias = 'bullish';
  } else if (valid && last.close < rangeLow + buffer) {
    bias = 'bearish';
  }
  return { bias, decision };
}

export const evaluateTrianglePatternsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const { valid, kind, apexHigh, apexLow } = convergingTriangle(window);
  const last = candles[candles.length - 1]!;
  const { bias, decision } = breakoutFromRange(apexHigh, apexLow, last, bufferPct, valid);
  return buildEvaluationResult({
    strategyId: 'triangle-patterns',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 32 + (valid ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [`Triangle patterns — ${kind} over ${lookback} bars`, valid ? `Apex ${apexHigh.toFixed(5)} / ${apexLow.toFixed(5)}` : 'No converging triangle', decision !== 'wait' ? 'Triangle breakout confirmed' : 'Awaiting triangle breakout'],
    metrics: { patternKind: kind, apexHigh: Number(apexHigh.toFixed(5)), apexLow: Number(apexLow.toFixed(5)) },
  });
};

export const evaluateWedgePatternsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(24, parseNumber(config.lookback, 48));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const { early, mid, late } = windowThirds(window);
  const earlyHigh = Math.max(...early.map((item) => item.high));
  const lateHigh = Math.max(...late.map((item) => item.high));
  const earlyLow = Math.min(...early.map((item) => item.low));
  const lateLow = Math.min(...late.map((item) => item.low));
  const risingWedge = earlyHigh < lateHigh && earlyLow < lateLow && (lateHigh - lateLow) < (earlyHigh - earlyLow) * 0.85;
  const fallingWedge = earlyHigh > lateHigh && earlyLow > lateLow && (lateHigh - lateLow) < (earlyHigh - earlyLow) * 0.85;
  const valid = risingWedge || fallingWedge;
  const kind = risingWedge ? 'rising' : fallingWedge ? 'falling' : 'unconfirmed';
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  const buffer = last.close * (bufferPct / 100);
  if (fallingWedge && last.close > lateHigh - buffer && last.close > last.open) {
    bias = 'bullish';
    if (last.close > lateHigh + buffer) decision = 'buy';
  } else if (risingWedge && last.close < lateLow + buffer && last.close < last.open) {
    bias = 'bearish';
    if (last.close < lateLow - buffer) decision = 'sell';
  }
  return buildEvaluationResult({
    strategyId: 'wedge-patterns',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 33 + (valid ? 12 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: [`Wedge patterns — ${kind} wedge scan`, valid ? 'Converging wedge structure detected' : 'No wedge structure', decision === 'buy' ? 'Falling wedge breakout long' : decision === 'sell' ? 'Rising wedge breakdown short' : 'No wedge trigger'],
    metrics: { wedgeKind: kind },
  });
};

export const evaluateFlagPatternsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 40));
  const impulseBars = Math.max(8, parseNumber(config.impulseBars, 16));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const impulse = window.slice(0, impulseBars);
  const flag = window.slice(impulseBars);
  const impulseMove = (impulse.at(-1)?.close ?? 0) - (impulse[0]?.close ?? 0);
  const flagSlope = flag.length >= 2 ? flag.at(-1)!.close - flag[0]!.close : 0;
  const flagHigh = Math.max(...flag.map((item) => item.high));
  const flagLow = Math.min(...flag.map((item) => item.low));
  const bullishFlag = impulseMove > 0 && flagSlope <= 0;
  const bearishFlag = impulseMove < 0 && flagSlope >= 0;
  const last = candles[candles.length - 1]!;
  const { bias, decision } = breakoutFromRange(flagHigh, flagLow, last, bufferPct, bullishFlag || bearishFlag);
  const finalDecision: StrategySignalSide = bullishFlag && decision === 'buy' ? 'buy' : bearishFlag && decision === 'sell' ? 'sell' : 'wait';
  return buildEvaluationResult({
    strategyId: 'flag-patterns',
    context,
    config: { ...config, lookback, impulseBars, bufferPct },
    candles,
    decision: finalDecision,
    bias: finalDecision === 'buy' ? 'bullish' : finalDecision === 'sell' ? 'bearish' : bias,
    confidence: 34 + (finalDecision !== 'wait' ? 30 : bullishFlag || bearishFlag ? 10 : 0),
    reasons: ['Flag pattern — impulse + counter-trend consolidation', bullishFlag ? 'Bullish flag forming' : bearishFlag ? 'Bearish flag forming' : 'No flag structure', finalDecision !== 'wait' ? 'Flag breakout confirmed' : 'Awaiting flag breakout'],
    metrics: { impulseMove: Number(impulseMove.toFixed(5)), flagSlope: Number(flagSlope.toFixed(5)) },
  });
};

export const evaluatePennantPatternsEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(20, parseNumber(config.lookback, 36));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const half = Math.max(3, Math.floor(window.length / 2));
  const first = window.slice(0, half);
  const second = window.slice(half);
  const firstRange = Math.max(...first.map((item) => item.high)) - Math.min(...first.map((item) => item.low));
  const secondRange = Math.max(...second.map((item) => item.high)) - Math.min(...second.map((item) => item.low));
  const compressed = firstRange > 0 && secondRange / firstRange <= 0.75;
  const pennantHigh = Math.max(...second.map((item) => item.high));
  const pennantLow = Math.min(...second.map((item) => item.low));
  const last = candles[candles.length - 1]!;
  const { bias, decision } = breakoutFromRange(pennantHigh, pennantLow, last, bufferPct, compressed);
  return buildEvaluationResult({
    strategyId: 'pennant-patterns',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 33 + (compressed ? 14 : 0) + (decision !== 'wait' ? 30 : 0),
    reasons: ['Pennant pattern — symmetric compression after impulse', compressed ? `Compression ratio ${(secondRange / Math.max(firstRange, 0.00001)).toFixed(2)}` : 'No pennant compression', decision !== 'wait' ? 'Pennant breakout' : 'Awaiting pennant break'],
    metrics: { compressionRatio: Number((secondRange / Math.max(firstRange, 0.00001)).toFixed(3)) },
  });
};

export const evaluateCupAndHandleEngine: StrategyEngine = (candles, config, context) => {
  const lookback = Math.max(40, parseNumber(config.lookback, 70));
  const bufferPct = parseNumber(config.bufferPct, 0.04);
  const window = candles.slice(-lookback, -1);
  const quarter = Math.max(5, Math.floor(window.length / 4));
  const leftRim = window.slice(0, quarter);
  const cup = window.slice(quarter, quarter * 3);
  const handle = window.slice(quarter * 3);
  const rimHigh = Math.max(...leftRim.map((item) => item.high), ...handle.map((item) => item.high));
  const cupLow = Math.min(...cup.map((item) => item.low));
  const cupDepth = rimHigh > 0 ? ((rimHigh - cupLow) / rimHigh) * 100 : 0;
  const validCup = cupDepth >= 8 && cupDepth <= 35;
  const handlePullback = handle.length > 0 && handle.at(-1)!.close < rimHigh * 0.995;
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = validCup ? 'bullish' : 'neutral';
  let decision: StrategySignalSide = 'wait';
  const buffer = last.close * (bufferPct / 100);
  if (validCup && handlePullback && last.close > rimHigh + buffer && last.close > last.open) decision = 'buy';
  return buildEvaluationResult({
    strategyId: 'cup-and-handle',
    context,
    config: { ...config, lookback, bufferPct },
    candles,
    decision,
    bias,
    confidence: 32 + (validCup ? 16 : 0) + (decision !== 'wait' ? 32 : 0),
    reasons: ['Cup and handle — rounded base + handle pullback', validCup ? `Cup depth ${cupDepth.toFixed(1)}% · rim ${rimHigh.toFixed(5)}` : 'No qualifying cup structure', decision === 'buy' ? 'Handle breakout long' : 'Awaiting cup handle breakout'],
    metrics: { cupDepthPct: Number(cupDepth.toFixed(2)), rimHigh: Number(rimHigh.toFixed(5)) },
  });
};

function evaluateHarmonicVariant(
  strategyId: string,
  candles: StrategyPriceCandle[],
  config: Record<string, unknown>,
  context: Parameters<StrategyEngine>[2],
  variant: 'generic' | 'butterfly' | 'bat' | 'crab' | 'gartley' | 'cypher',
): ReturnType<typeof buildEvaluationResult> {
  const lookback = Math.max(35, parseNumber(config.lookback, 65));
  const tolerancePct = parseNumber(config.tolerancePct, 0.12);
  const window = candles.slice(-lookback);
  const points = harmonicPoints(window, [0.1, 0.32, 0.55, 0.78]);
  const last = candles[candles.length - 1]!;
  let bias: StrategyBias = 'neutral';
  let decision: StrategySignalSide = 'wait';
  let pattern = 'none';
  if (points.length === 4) {
    const [x, a, b, c] = points;
    const xa = Math.abs(a.close - x.close);
    const ab = Math.abs(b.close - a.close);
    const bc = Math.abs(c.close - b.close);
    const abXa = ratio(ab, xa);
    const bcAb = ratio(bc, ab);
    const bullishBase = x.close > a.close && b.close > a.close && c.close > b.close;
    const bearishBase = x.close < a.close && b.close < a.close && c.close < b.close;
    const ratioOk = (() => {
      switch (variant) {
        case 'butterfly': return abXa >= 0.78 - tolerancePct && bcAb >= 1.27 - tolerancePct;
        case 'bat': return abXa >= 0.38 - tolerancePct && abXa <= 0.5 + tolerancePct;
        case 'crab': return abXa >= 0.38 - tolerancePct && bcAb >= 1.61 - tolerancePct;
        case 'gartley': return abXa >= 0.61 - tolerancePct && abXa <= 0.65 + tolerancePct;
        case 'cypher': return abXa >= 0.38 - tolerancePct && bcAb >= 1.13 - tolerancePct;
        default: return abXa >= 0.38 - tolerancePct && bcAb >= 0.38 - tolerancePct;
      }
    })();
    if (ratioOk && bullishBase && last.close > c.close && last.close > last.open) {
      bias = 'bullish';
      pattern = `bullish ${variant}`;
      decision = 'buy';
    } else if (ratioOk && bearishBase && last.close < c.close && last.close < last.open) {
      bias = 'bearish';
      pattern = `bearish ${variant}`;
      decision = 'sell';
    } else if (ratioOk && bullishBase) {
      bias = 'bullish';
      pattern = `bullish ${variant} forming`;
    } else if (ratioOk && bearishBase) {
      bias = 'bearish';
      pattern = `bearish ${variant} forming`;
    }
  }
  return buildEvaluationResult({
    strategyId,
    context,
    config: { ...config, lookback, tolerancePct },
    candles,
    decision,
    bias,
    confidence: 34 + (decision !== 'wait' ? 32 : pattern !== 'none' ? 10 : 0),
    reasons: [`${variant} harmonic — XABCD ratio scan over ${lookback} bars`, pattern !== 'none' ? pattern : 'No harmonic pattern', decision !== 'wait' ? 'Harmonic completion entry' : 'Awaiting harmonic completion'],
    metrics: { pattern },
  });
}

export const evaluateHarmonicPatternsEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('harmonic-patterns', c, cfg, ctx, 'generic');
export const evaluateButterflyPatternEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('butterfly-pattern', c, cfg, ctx, 'butterfly');
export const evaluateBatPatternEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('bat-pattern', c, cfg, ctx, 'bat');
export const evaluateCrabPatternEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('crab-pattern', c, cfg, ctx, 'crab');
export const evaluateGartleyPatternEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('gartley-pattern', c, cfg, ctx, 'gartley');
export const evaluateCypherPatternEngine: StrategyEngine = (c, cfg, ctx) =>
  evaluateHarmonicVariant('cypher-pattern', c, cfg, ctx, 'cypher');
