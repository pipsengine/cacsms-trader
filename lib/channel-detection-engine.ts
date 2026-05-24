import { analyzeSwingPoints, normalizeSwingInputCandles, type SwingDetection } from './swing-point-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface ChannelDetection {
  id?: string;
  chartCaptureId?: string;
  channelType: string;
  direction: 'ascending' | 'descending' | 'horizontal';
  startCandleIndex: number;
  endCandleIndex: number;
  upperStartPrice: number;
  upperEndPrice: number;
  lowerStartPrice: number;
  lowerEndPrice: number;
  upperStartPixelX: number;
  upperStartPixelY: number;
  upperEndPixelX: number;
  upperEndPixelY: number;
  lowerStartPixelX: number;
  lowerStartPixelY: number;
  lowerEndPixelX: number;
  lowerEndPixelY: number;
  slope: number;
  channelWidth: number;
  containmentScore: number;
  touchCount: number;
  respectRate: number;
  falseBreakCount: number;
  slopeConsistency: number;
  volatilityState: string;
  compressionScore: number;
  breakoutProbability: number;
  liquidityRisk: number;
  institutionalInterpretation: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  qualityScore: number;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface ChannelBreakoutPressure {
  id?: string;
  channelId?: string;
  chartCaptureId?: string;
  boundary: 'upper' | 'lower';
  pressureScore: number;
  repeatedTouchScore: number;
  displacementScore: number;
  liquidityBuildUpScore: number;
  breakoutDirection: 'bullish' | 'bearish';
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface ChannelAnalysisResult {
  channels: ChannelDetection[];
  breakoutPressure: ChannelBreakoutPressure[];
  summary: {
    dominantChannel: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
}

interface Point {
  candleIndex: number;
  price: number;
  pixelX: number;
  pixelY: number;
  strength: number;
}

type Context = ReturnType<typeof buildContext>;

export function normalizeChannelInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeSwingInputCandles(input);
}

export function analyzeChannels(candles: ReconstructedCandle[]): ChannelAnalysisResult {
  if (candles.length < 10) {
    return {
      channels: [],
      breakoutPressure: [],
      summary: {
        dominantChannel: 'insufficient_data',
        institutionalBias: 'WAIT',
        recommendedAction: 'WAIT',
        confidence: 0,
        explanation: 'At least ten reconstructed candles are required for channel detection.',
      },
    };
  }

  const context = buildContext(candles);
  const swings = analyzeSwingPoints(candles, { depths: [1, 2, 4, 7], zigzagPercent: 0.08 }).swings;
  const swingChannels = buildSwingChannels(candles, swings, context);
  const regressionChannel = buildRegressionChannel(candles, context);
  const channels = dedupeChannels([...swingChannels, regressionChannel])
    .filter((channel) => channel.qualityScore >= 0.36)
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 6);
  const breakoutPressure = channels.flatMap((channel, index) => buildBreakoutPressure(channel, candles, context, `channel-${index}`));
  const dominant = channels[0];

  return {
    channels,
    breakoutPressure,
    summary: {
      dominantChannel: dominant?.channelType ?? 'none',
      institutionalBias: dominant?.institutionalInterpretation ?? 'WAIT',
      recommendedAction: dominant?.recommendedAction ?? 'WAIT',
      confidence: dominant?.qualityScore ?? 0,
      explanation: dominant
        ? `${dominant.channelType} contains ${percent(dominant.containmentScore)} of price with ${percent(dominant.breakoutProbability)} breakout probability and ${percent(dominant.liquidityRisk)} liquidity risk.`
        : 'No institutional-quality channel survived containment, parallelism, and breakout-pressure validation.',
    },
  };
}

function buildSwingChannels(candles: ReconstructedCandle[], swings: SwingDetection[], context: Context): ChannelDetection[] {
  const highs = swings.filter((swing) => swing.swingKind === 'high').map(pointFromSwing);
  const lows = swings.filter((swing) => swing.swingKind === 'low').map(pointFromSwing);
  if (highs.length < 2 || lows.length < 2) return [];

  const upper = fitBoundary(highs);
  const lower = fitBoundary(lows);
  const parallelism = 1 - Math.abs(upper.slope - lower.slope) / Math.max(0.0001, context.atr);
  if (parallelism < 0.35) return [];

  return [scoreChannel('swing_parallel_channel', upper.start, upper.end, lower.start, lower.end, candles, context, clamp(parallelism, 0, 1), 'swing_high_low_parallelism')];
}

function buildRegressionChannel(candles: ReconstructedCandle[], context: Context): ChannelDetection {
  const closes = candles.map((candle) => ({ x: candle.candleIndex, y: candle.closePrice }));
  const regression = linearRegression(closes);
  const residuals = candles.map((candle) => candle.closePrice - project(regression, candle.candleIndex));
  const deviation = standardDeviation(residuals) || context.atr;
  const first = candles[0];
  const last = candles.at(-1)!;
  const upperStart = project(regression, first.candleIndex) + deviation * 1.65;
  const upperEnd = project(regression, last.candleIndex) + deviation * 1.65;
  const lowerStart = project(regression, first.candleIndex) - deviation * 1.65;
  const lowerEnd = project(regression, last.candleIndex) - deviation * 1.65;
  return scoreChannel(
    'regression_volatility_corridor',
    pointFromPrice(first, upperStart, 'upper'),
    pointFromPrice(last, upperEnd, 'upper'),
    pointFromPrice(first, lowerStart, 'lower'),
    pointFromPrice(last, lowerEnd, 'lower'),
    candles,
    context,
    0.92,
    'linear_regression_standard_deviation_bands',
  );
}

function scoreChannel(
  channelType: string,
  upperStart: Point,
  upperEnd: Point,
  lowerStart: Point,
  lowerEnd: Point,
  candles: ReconstructedCandle[],
  context: Context,
  slopeConsistency: number,
  source: string,
): ChannelDetection {
  const slope = ((upperEnd.price - upperStart.price) + (lowerEnd.price - lowerStart.price)) / Math.max(2, (upperEnd.candleIndex - upperStart.candleIndex) + (lowerEnd.candleIndex - lowerStart.candleIndex));
  const channelWidth = average(candles.map((candle) => upperAt(upperStart, upperEnd, candle.candleIndex) - lowerAt(lowerStart, lowerEnd, candle.candleIndex)));
  const containment = candles.filter((candle) => {
    const upper = upperAt(upperStart, upperEnd, candle.candleIndex);
    const lower = lowerAt(lowerStart, lowerEnd, candle.candleIndex);
    return candle.highPrice <= upper + context.atr * 0.18 && candle.lowPrice >= lower - context.atr * 0.18;
  }).length / candles.length;
  const touches = boundaryTouches(candles, upperStart, upperEnd, lowerStart, lowerEnd, context);
  const falseBreakCount = falseBreaks(candles, upperStart, upperEnd, lowerStart, lowerEnd, context);
  const respectRate = clamp((touches.upper + touches.lower) / Math.max(1, touches.upper + touches.lower + falseBreakCount), 0, 1);
  const touchCount = touches.upper + touches.lower;
  const compressionScore = context.compressionScore;
  const volatilityState = volatilityStateFor(candles, channelWidth, context);
  const pressure = pressureModel(candles, upperStart, upperEnd, lowerStart, lowerEnd, context);
  const breakoutProbability = clamp(pressure.maxPressure * 0.38 + compressionScore * 0.2 + context.displacementScore * 0.2 + (1 - containment) * 0.1 + touchCount / 12 * 0.12, 0, 0.98);
  const liquidityRisk = clamp(pressure.liquidityBuildUp * 0.46 + touchCount / 10 * 0.24 + falseBreakCount / 4 * 0.18 + compressionScore * 0.12, 0, 0.96);
  const qualityScore = clamp(containment * 0.28 + respectRate * 0.22 + slopeConsistency * 0.18 + touchCount / 8 * 0.16 + (1 - falseBreakCount / 6) * 0.08 + compressionScore * 0.08, 0, 0.98);
  const direction = slope > context.atr * 0.025 ? 'ascending' : slope < -context.atr * 0.025 ? 'descending' : 'horizontal';
  const interpretation = institutionalInterpretation(direction, volatilityState, breakoutProbability, liquidityRisk, containment, channelType);
  const recommendedAction = actionFor(direction, breakoutProbability, liquidityRisk, pressure.boundary);

  return {
    channelType,
    direction,
    startCandleIndex: Math.min(upperStart.candleIndex, lowerStart.candleIndex),
    endCandleIndex: Math.max(upperEnd.candleIndex, lowerEnd.candleIndex),
    upperStartPrice: round(upperStart.price),
    upperEndPrice: round(upperEnd.price),
    lowerStartPrice: round(lowerStart.price),
    lowerEndPrice: round(lowerEnd.price),
    upperStartPixelX: upperStart.pixelX,
    upperStartPixelY: upperStart.pixelY,
    upperEndPixelX: upperEnd.pixelX,
    upperEndPixelY: upperEnd.pixelY,
    lowerStartPixelX: lowerStart.pixelX,
    lowerStartPixelY: lowerStart.pixelY,
    lowerEndPixelX: lowerEnd.pixelX,
    lowerEndPixelY: lowerEnd.pixelY,
    slope: round(slope, 8),
    channelWidth: round(channelWidth),
    containmentScore: clamp(containment, 0, 1),
    touchCount,
    respectRate,
    falseBreakCount,
    slopeConsistency,
    volatilityState,
    compressionScore,
    breakoutProbability,
    liquidityRisk,
    institutionalInterpretation: interpretation,
    recommendedAction,
    qualityScore,
    geometry: {
      upperBoundary: { start: upperStart, end: upperEnd },
      lowerBoundary: { start: lowerStart, end: lowerEnd },
      touches,
    },
    metadata: {
      source,
      parallelLineDetection: channelType === 'swing_parallel_channel',
      regressionChannelModeling: channelType === 'regression_volatility_corridor',
      breakoutBoundary: pressure.boundary,
      priceContainmentPercentage: containment,
    },
  };
}

function buildBreakoutPressure(channel: ChannelDetection, candles: ReconstructedCandle[], context: Context, fallbackId: string): ChannelBreakoutPressure[] {
  const upperStart = pointFromStored(channel.upperStartPrice, channel.startCandleIndex, channel.upperStartPixelX, channel.upperStartPixelY);
  const upperEnd = pointFromStored(channel.upperEndPrice, channel.endCandleIndex, channel.upperEndPixelX, channel.upperEndPixelY);
  const lowerStart = pointFromStored(channel.lowerStartPrice, channel.startCandleIndex, channel.lowerStartPixelX, channel.lowerStartPixelY);
  const lowerEnd = pointFromStored(channel.lowerEndPrice, channel.endCandleIndex, channel.lowerEndPixelX, channel.lowerEndPixelY);
  const model = pressureModel(candles, upperStart, upperEnd, lowerStart, lowerEnd, context);
  const sides: Array<'upper' | 'lower'> = ['upper', 'lower'];
  return sides.map((boundary) => {
    const repeatedTouchScore = boundary === 'upper' ? model.upperTouchPressure : model.lowerTouchPressure;
    const liquidityBuildUpScore = boundary === 'upper' ? model.upperLiquidity : model.lowerLiquidity;
    const pressureScore = clamp(repeatedTouchScore * 0.34 + context.displacementScore * 0.26 + liquidityBuildUpScore * 0.28 + channel.compressionScore * 0.12, 0, 1);
    return {
      channelId: fallbackId,
      boundary,
      pressureScore,
      repeatedTouchScore,
      displacementScore: context.displacementScore,
      liquidityBuildUpScore,
      breakoutDirection: boundary === 'upper' ? 'bullish' : 'bearish',
      explanationText: `${boundary} channel boundary has ${percent(pressureScore)} breakout pressure with ${percent(liquidityBuildUpScore)} liquidity build-up.`,
      metadata: { channelType: channel.channelType, volatilityState: channel.volatilityState },
    };
  }).sort((a, b) => b.pressureScore - a.pressureScore);
}

function pressureModel(candles: ReconstructedCandle[], upperStart: Point, upperEnd: Point, lowerStart: Point, lowerEnd: Point, context: Context) {
  const recent = candles.slice(-12);
  const upperTouches = recent.filter((candle) => Math.abs(candle.highPrice - upperAt(upperStart, upperEnd, candle.candleIndex)) <= context.atr * 0.38).length;
  const lowerTouches = recent.filter((candle) => Math.abs(candle.lowPrice - lowerAt(lowerStart, lowerEnd, candle.candleIndex)) <= context.atr * 0.38).length;
  const upperLiquidity = clamp(upperTouches / 5 + equalSideScore(recent.map((candle) => candle.highPrice), context.atr) * 0.32, 0, 1);
  const lowerLiquidity = clamp(lowerTouches / 5 + equalSideScore(recent.map((candle) => candle.lowPrice), context.atr) * 0.32, 0, 1);
  const upperTouchPressure = clamp(upperTouches / 5, 0, 1);
  const lowerTouchPressure = clamp(lowerTouches / 5, 0, 1);
  const boundary = upperTouchPressure >= lowerTouchPressure ? 'upper' : 'lower';
  return {
    boundary,
    upperTouchPressure,
    lowerTouchPressure,
    upperLiquidity,
    lowerLiquidity,
    liquidityBuildUp: Math.max(upperLiquidity, lowerLiquidity),
    maxPressure: Math.max(upperTouchPressure, lowerTouchPressure),
  };
}

function fitBoundary(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.candleIndex - b.candleIndex);
  const model = linearRegression(sorted.map((point) => ({ x: point.candleIndex, y: point.price })));
  const first = sorted[0];
  const last = sorted.at(-1)!;
  return {
    start: { ...first, price: project(model, first.candleIndex) },
    end: { ...last, price: project(model, last.candleIndex) },
    slope: model.slope,
  };
}

function boundaryTouches(candles: ReconstructedCandle[], upperStart: Point, upperEnd: Point, lowerStart: Point, lowerEnd: Point, context: Context) {
  const upper = candles.filter((candle) => Math.abs(candle.highPrice - upperAt(upperStart, upperEnd, candle.candleIndex)) <= context.atr * 0.42).length;
  const lower = candles.filter((candle) => Math.abs(candle.lowPrice - lowerAt(lowerStart, lowerEnd, candle.candleIndex)) <= context.atr * 0.42).length;
  return { upper, lower };
}

function falseBreaks(candles: ReconstructedCandle[], upperStart: Point, upperEnd: Point, lowerStart: Point, lowerEnd: Point, context: Context): number {
  return candles.filter((candle) => {
    const upper = upperAt(upperStart, upperEnd, candle.candleIndex);
    const lower = lowerAt(lowerStart, lowerEnd, candle.candleIndex);
    const upperSweep = candle.highPrice > upper + context.atr * 0.22 && candle.closePrice < upper;
    const lowerSweep = candle.lowPrice < lower - context.atr * 0.22 && candle.closePrice > lower;
    return upperSweep || lowerSweep;
  }).length;
}

function volatilityStateFor(candles: ReconstructedCandle[], width: number, context: Context): string {
  const early = average(candles.slice(0, Math.max(4, Math.floor(candles.length / 3))).map((candle) => candle.highPrice - candle.lowPrice));
  const late = average(candles.slice(-Math.max(4, Math.floor(candles.length / 3))).map((candle) => candle.highPrice - candle.lowPrice));
  if (late < early * 0.78 || context.compressionScore >= 0.58) return 'contracting_volatility_corridor';
  if (late > early * 1.24 || width > context.atr * 4.5) return 'expanding_volatility_corridor';
  return 'stable_volatility_corridor';
}

function institutionalInterpretation(direction: string, volatility: string, breakout: number, liquidityRisk: number, containment: number, channelType: string): string {
  if (liquidityRisk >= 0.68) return 'Likely liquidity trap around a visible channel; wait for sweep, reclaim, and displacement confirmation.';
  if (volatility.includes('contracting') && breakout >= 0.62) return 'Volatility compression suggests institutional breakout preparation after controlled channel containment.';
  if (direction === 'horizontal' && containment >= 0.74) return 'Range channel resembles accumulation or distribution; bias depends on which boundary fails first.';
  if (direction === 'ascending') return 'Ascending channel supports continuation while lower boundary remains defended by institutional demand.';
  if (direction === 'descending') return 'Descending channel supports continuation while upper boundary remains defended by institutional supply.';
  return `${channelType} is valid but needs boundary pressure confirmation.`;
}

function actionFor(direction: string, breakout: number, liquidityRisk: number, boundary: string): ChannelDetection['recommendedAction'] {
  if (liquidityRisk >= 0.74) return 'AVOID';
  if (breakout < 0.56) return 'WAIT';
  if (boundary === 'upper' || direction === 'ascending') return 'BUY';
  if (boundary === 'lower' || direction === 'descending') return 'SELL';
  return 'WAIT';
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recentRange = average(ranges.slice(-8));
  return {
    atr,
    compressionScore: clamp(1 - recentRange / Math.max(0.0001, atr * 1.25), 0, 1),
    displacementScore: clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1),
  };
}

function pointFromSwing(swing: SwingDetection): Point {
  return {
    candleIndex: swing.candleIndex,
    price: swing.priceLevel,
    pixelX: swing.pixelX,
    pixelY: swing.pixelY,
    strength: clamp(swing.strengthScore * 0.72 + swing.liquidityRelevance * 0.28, 0, 1),
  };
}

function pointFromPrice(candle: ReconstructedCandle, price: number, side: 'upper' | 'lower'): Point {
  return {
    candleIndex: candle.candleIndex,
    price,
    pixelX: candle.pixelX,
    pixelY: side === 'upper' ? candle.pixelYHigh : candle.pixelYLow,
    strength: candle.confidence,
  };
}

function pointFromStored(price: number, candleIndex: number, pixelX: number, pixelY: number): Point {
  return { price, candleIndex, pixelX, pixelY, strength: 0.7 };
}

function upperAt(start: Point, end: Point, candleIndex: number): number {
  return interpolate(start, end, candleIndex);
}

function lowerAt(start: Point, end: Point, candleIndex: number): number {
  return interpolate(start, end, candleIndex);
}

function interpolate(start: Point, end: Point, candleIndex: number): number {
  const slope = (end.price - start.price) / Math.max(1, end.candleIndex - start.candleIndex);
  return start.price + slope * (candleIndex - start.candleIndex);
}

function linearRegression(points: Array<{ x: number; y: number }>) {
  const xMean = average(points.map((point) => point.x));
  const yMean = average(points.map((point) => point.y));
  const numerator = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0) || 1;
  const slope = numerator / denominator;
  return { slope, intercept: yMean - slope * xMean };
}

function project(model: { slope: number; intercept: number }, x: number): number {
  return model.intercept + model.slope * x;
}

function equalSideScore(values: number[], atr: number): number {
  if (values.length < 3) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let clusters = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (Math.abs(sorted[i] - sorted[i - 1]) <= atr * 0.22) clusters += 1;
  }
  return clamp(clusters / Math.max(1, values.length - 1), 0, 1);
}

function dedupeChannels(channels: ChannelDetection[]): ChannelDetection[] {
  const accepted: ChannelDetection[] = [];
  for (const channel of channels.sort((a, b) => b.qualityScore - a.qualityScore)) {
    const duplicate = accepted.some((item) => Math.abs(item.slope - channel.slope) < 0.0001 && item.channelType === channel.channelType);
    if (!duplicate) accepted.push(channel);
  }
  return accepted;
}

function standardDeviation(values: number[]): number {
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
