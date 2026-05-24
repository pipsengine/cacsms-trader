import { analyzeSwingPoints, normalizeSwingInputCandles, type SwingDetection } from './swing-point-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface TrendlineDetection {
  id?: string;
  chartCaptureId?: string;
  trendlineKind: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  startCandleIndex: number;
  endCandleIndex: number;
  startPrice: number;
  endPrice: number;
  startPixelX: number;
  startPixelY: number;
  endPixelX: number;
  endPixelY: number;
  slope: number;
  normalizedSlope: number;
  slopeState: string;
  touchCount: number;
  validityScore: number;
  respectScore: number;
  spacingScore: number;
  breakProbability: number;
  retestProbability: number;
  trapRisk: number;
  breakStatus: string;
  retestStatus: string;
  aiExplanation: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface TrendlineBreakEvent {
  id?: string;
  trendlineId?: string;
  chartCaptureId?: string;
  candleIndex: number;
  breakDirection: string;
  breakQualityScore: number;
  falseBreakProbability: number;
  liquidityGrabScore: number;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface TrendlineRetestEvent {
  id?: string;
  trendlineId?: string;
  chartCaptureId?: string;
  candleIndex: number;
  retestQualityScore: number;
  continuationProbability: number;
  rejectionScore: number;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface TrendlineAnalysisResult {
  trendlines: TrendlineDetection[];
  breaks: TrendlineBreakEvent[];
  retests: TrendlineRetestEvent[];
  summary: {
    dominantTrendline: string;
    directionalBias: string;
    confidence: number;
    explanation: string;
  };
}

type Context = ReturnType<typeof buildContext>;

interface CandidatePoint {
  candleIndex: number;
  price: number;
  pixelX: number;
  pixelY: number;
  source: string;
  strength: number;
}

export function normalizeTrendlineInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeSwingInputCandles(input);
}

export function analyzeTrendlines(candles: ReconstructedCandle[]): TrendlineAnalysisResult {
  if (candles.length < 8) {
    return {
      trendlines: [],
      breaks: [],
      retests: [],
      summary: {
        dominantTrendline: 'insufficient_data',
        directionalBias: 'WAIT',
        confidence: 0,
        explanation: 'At least eight reconstructed candles are required for trendline detection.',
      },
    };
  }

  const context = buildContext(candles);
  const swingAnalysis = analyzeSwingPoints(candles, { depths: [1, 2, 4, 7], zigzagPercent: 0.08 });
  const swingCandidates = buildSwingCandidates(swingAnalysis.swings);
  const imageCandidates = buildImageProjectionCandidates(candles, context);
  const allTrendlines = [
    ...generateTrendlines('bullish_support', swingCandidates.lows, candles, context, 'swing_ransac'),
    ...generateTrendlines('bearish_resistance', swingCandidates.highs, candles, context, 'swing_ransac'),
    ...generateTrendlines('image_diagonal_structure', imageCandidates, candles, context, 'hough_projection_ready'),
  ];
  const trendlines = dedupeTrendlines(allTrendlines)
    .filter((line) => line.validityScore >= 0.42)
    .sort((a, b) => b.validityScore - a.validityScore)
    .slice(0, 8);

  const breaks = trendlines.flatMap((line, index) => buildBreakEvents(line, candles, context, `line-${index}`));
  const retests = trendlines.flatMap((line, index) => buildRetestEvents(line, candles, context, `line-${index}`));
  const dominant = trendlines[0];

  return {
    trendlines,
    breaks,
    retests,
    summary: {
      dominantTrendline: dominant?.trendlineKind ?? 'none',
      directionalBias: dominant?.direction === 'bullish' ? 'BUY_CONTEXT' : dominant?.direction === 'bearish' ? 'SELL_CONTEXT' : 'WAIT',
      confidence: dominant?.validityScore ?? 0,
      explanation: dominant
        ? dominant.aiExplanation
        : 'No institutional-quality trendline survived swing, spacing, touch-count, and RANSAC validation.',
    },
  };
}

function buildSwingCandidates(swings: SwingDetection[]) {
  const usable = swings.filter((swing) => swing.strengthScore >= 0.38 || swing.liquidityRelevance >= 0.45);
  return {
    highs: usable.filter((swing) => swing.swingKind === 'high').map(pointFromSwing),
    lows: usable.filter((swing) => swing.swingKind === 'low').map(pointFromSwing),
  };
}

function buildImageProjectionCandidates(candles: ReconstructedCandle[], context: Context): CandidatePoint[] {
  const stride = Math.max(2, Math.floor(candles.length / 10));
  return candles
    .filter((_, index) => index % stride === 0 || index === candles.length - 1)
    .map((candle) => ({
      candleIndex: candle.candleIndex,
      price: (candle.highPrice + candle.lowPrice + candle.closePrice) / 3,
      pixelX: candle.pixelX,
      pixelY: (candle.pixelYHigh + candle.pixelYLow + candle.pixelYClose) / 3,
      source: 'image_projection_hough_ready',
      strength: clamp(Math.abs(candle.closePrice - candle.openPrice) / Math.max(0.0001, context.atr), 0.18, 1),
    }));
}

function generateTrendlines(
  kind: string,
  points: CandidatePoint[],
  candles: ReconstructedCandle[],
  context: Context,
  source: string,
): TrendlineDetection[] {
  if (points.length < 2) return [];
  const lines: TrendlineDetection[] = [];
  const sorted = [...points].sort((a, b) => a.candleIndex - b.candleIndex);

  for (let i = 0; i < sorted.length - 1; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const start = sorted[i];
      const end = sorted[j];
      if (end.candleIndex - start.candleIndex < 4) continue;
      const fitted = fitRansacLine(sorted, start, end, context);
      const slope = fitted.slope;
      if (kind === 'bullish_support' && slope <= -context.atr * 0.04) continue;
      if (kind === 'bearish_resistance' && slope >= context.atr * 0.04) continue;
      const line = scoreTrendline(kind, fitted.start, fitted.end, fitted.inliers, candles, context, source);
      if (line.validityScore >= 0.38) lines.push(line);
    }
  }

  return lines;
}

function fitRansacLine(points: CandidatePoint[], seedStart: CandidatePoint, seedEnd: CandidatePoint, context: Context) {
  let best = {
    start: seedStart,
    end: seedEnd,
    slope: slopeBetween(seedStart, seedEnd),
    inliers: pointsNearLine(points, seedStart, seedEnd, context.atr * 0.45),
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const start = points[i];
      const end = points[j];
      if (end.candleIndex - start.candleIndex < 4) continue;
      const inliers = pointsNearLine(points, start, end, context.atr * 0.45);
      const score = inliers.length + average(inliers.map((point) => point.strength));
      const bestScore = best.inliers.length + average(best.inliers.map((point) => point.strength));
      if (score > bestScore) best = { start, end, slope: slopeBetween(start, end), inliers };
    }
  }
  return best;
}

function scoreTrendline(
  kind: string,
  start: CandidatePoint,
  end: CandidatePoint,
  inliers: CandidatePoint[],
  candles: ReconstructedCandle[],
  context: Context,
  source: string,
): TrendlineDetection {
  const slope = slopeBetween(start, end);
  const normalizedSlope = clamp(Math.abs(slope) / Math.max(0.0001, context.atr), 0, 2);
  const touchCount = inliers.length;
  const spacingScore = spacingScoreFor(inliers, candles.length);
  const respectScore = respectScoreFor(kind, start, end, candles, context);
  const slopeState = slopeStateFor(normalizedSlope, slope);
  const slopeQuality = slopeState === 'unsustainable_steep' ? 0.38 : slopeState === 'weakening_flat' ? 0.56 : 0.82;
  const touchScore = clamp(touchCount / 5, 0, 1);
  const validityScore = clamp(touchScore * 0.28 + respectScore * 0.3 + spacingScore * 0.2 + slopeQuality * 0.14 + average(inliers.map((point) => point.strength)) * 0.08, 0, 0.98);
  const breakProbability = breakProbabilityFor(kind, start, end, candles, context, respectScore, normalizedSlope);
  const retestProbability = clamp(breakProbability * 0.42 + respectScore * 0.34 + touchScore * 0.16 + context.volatilityCompressionScore * 0.08, 0, 0.96);
  const trapRisk = trapRiskFor(kind, touchCount, breakProbability, context);
  const breakStatus = breakProbability >= 0.68 ? 'break_pressure_active' : breakProbability >= 0.5 ? 'break_watch' : 'holding';
  const retestStatus = retestProbability >= 0.64 ? 'retest_likely' : retestProbability >= 0.46 ? 'retest_possible' : 'no_retest_signal';
  const direction = kind === 'bullish_support' || (kind === 'image_diagonal_structure' && slope > 0) ? 'bullish' : kind === 'bearish_resistance' || slope < 0 ? 'bearish' : 'neutral';

  return {
    trendlineKind: kind,
    direction,
    startCandleIndex: start.candleIndex,
    endCandleIndex: end.candleIndex,
    startPrice: round(start.price),
    endPrice: round(end.price),
    startPixelX: start.pixelX,
    startPixelY: start.pixelY,
    endPixelX: end.pixelX,
    endPixelY: end.pixelY,
    slope: round(slope, 8),
    normalizedSlope,
    slopeState,
    touchCount,
    validityScore,
    respectScore,
    spacingScore,
    breakProbability,
    retestProbability,
    trapRisk,
    breakStatus,
    retestStatus,
    aiExplanation: explainTrendline(kind, direction, touchCount, validityScore, breakProbability, retestProbability, trapRisk, slopeState),
    geometry: {
      coordinates: {
        start: { x: start.pixelX, y: start.pixelY, price: start.price, candleIndex: start.candleIndex },
        end: { x: end.pixelX, y: end.pixelY, price: end.price, candleIndex: end.candleIndex },
      },
      touches: inliers.map((point) => ({ x: point.pixelX, y: point.pixelY, price: point.price, candleIndex: point.candleIndex })),
    },
    metadata: {
      source,
      ransacFitted: true,
      houghTransformReady: source === 'hough_projection_ready',
      touchToleranceAtr: 0.45,
      institutionalTrapDetection: true,
    },
  };
}

function buildBreakEvents(line: TrendlineDetection, candles: ReconstructedCandle[], context: Context, fallbackId: string): TrendlineBreakEvent[] {
  const start = { candleIndex: line.startCandleIndex, price: line.startPrice };
  const end = { candleIndex: line.endCandleIndex, price: line.endPrice };
  const future = candles.filter((candle) => candle.candleIndex > line.endCandleIndex);
  const events: TrendlineBreakEvent[] = [];
  for (const candle of future) {
    const projected = projectPrice(start, end, candle.candleIndex);
    const distance = line.direction === 'bullish' ? projected - candle.closePrice : candle.closePrice - projected;
    if (distance <= context.atr * 0.18) continue;
    const displacement = Math.abs(candle.closePrice - candle.openPrice) / Math.max(0.0001, context.atr);
    const breakQualityScore = clamp(distance / Math.max(0.0001, context.atr) * 0.38 + displacement * 0.34 + line.validityScore * 0.28, 0, 1);
    const liquidityGrabScore = clamp(line.trapRisk * 0.58 + wickRejection(candle, line.direction) * 0.42, 0, 1);
    events.push({
      trendlineId: fallbackId,
      candleIndex: candle.candleIndex,
      breakDirection: line.direction === 'bullish' ? 'bearish_break' : 'bullish_break',
      breakQualityScore,
      falseBreakProbability: clamp(liquidityGrabScore * 0.55 + (breakQualityScore < 0.58 ? 0.24 : 0.08), 0, 0.95),
      liquidityGrabScore,
      explanationText: `Trendline break at candle ${candle.candleIndex} shows ${percent(breakQualityScore)} break quality with ${percent(liquidityGrabScore)} liquidity-grab risk.`,
      metadata: { projectedPrice: projected, closePrice: candle.closePrice },
    });
    break;
  }
  return events;
}

function buildRetestEvents(line: TrendlineDetection, candles: ReconstructedCandle[], context: Context, fallbackId: string): TrendlineRetestEvent[] {
  const start = { candleIndex: line.startCandleIndex, price: line.startPrice };
  const end = { candleIndex: line.endCandleIndex, price: line.endPrice };
  const future = candles.filter((candle) => candle.candleIndex > line.endCandleIndex + 1);
  const events: TrendlineRetestEvent[] = [];
  for (const candle of future) {
    const projected = projectPrice(start, end, candle.candleIndex);
    const nearLine = Math.min(Math.abs(candle.highPrice - projected), Math.abs(candle.lowPrice - projected), Math.abs(candle.closePrice - projected));
    if (nearLine > context.atr * 0.42) continue;
    const rejectionScore = wickRejection(candle, line.direction);
    const retestQualityScore = clamp((1 - nearLine / Math.max(0.0001, context.atr)) * 0.42 + rejectionScore * 0.34 + line.validityScore * 0.24, 0, 1);
    events.push({
      trendlineId: fallbackId,
      candleIndex: candle.candleIndex,
      retestQualityScore,
      continuationProbability: clamp(retestQualityScore * 0.58 + line.retestProbability * 0.42, 0, 0.96),
      rejectionScore,
      explanationText: `Retest around candle ${candle.candleIndex} has ${percent(retestQualityScore)} quality and ${percent(rejectionScore)} rejection from the line.`,
      metadata: { projectedPrice: projected, distanceToLine: nearLine },
    });
    break;
  }
  return events;
}

function pointFromSwing(swing: SwingDetection): CandidatePoint {
  return {
    candleIndex: swing.candleIndex,
    price: swing.priceLevel,
    pixelX: swing.pixelX,
    pixelY: swing.pixelY,
    source: 'swing_point',
    strength: clamp(swing.strengthScore * 0.72 + swing.liquidityRelevance * 0.28, 0, 1),
  };
}

function pointsNearLine(points: CandidatePoint[], start: CandidatePoint, end: CandidatePoint, tolerance: number) {
  return points.filter((point) => Math.abs(point.price - projectPrice(start, end, point.candleIndex)) <= tolerance);
}

function projectPrice(start: { candleIndex: number; price: number }, end: { candleIndex: number; price: number }, candleIndex: number): number {
  const slope = (end.price - start.price) / Math.max(1, end.candleIndex - start.candleIndex);
  return start.price + slope * (candleIndex - start.candleIndex);
}

function slopeBetween(start: CandidatePoint, end: CandidatePoint): number {
  return (end.price - start.price) / Math.max(1, end.candleIndex - start.candleIndex);
}

function respectScoreFor(kind: string, start: CandidatePoint, end: CandidatePoint, candles: ReconstructedCandle[], context: Context): number {
  const relevant = candles.filter((candle) => candle.candleIndex >= start.candleIndex && candle.candleIndex <= end.candleIndex);
  if (!relevant.length) return 0;
  let respected = 0;
  for (const candle of relevant) {
    const projected = projectPrice(start, end, candle.candleIndex);
    if (kind === 'bullish_support' && candle.lowPrice >= projected - context.atr * 0.36) respected += 1;
    else if (kind === 'bearish_resistance' && candle.highPrice <= projected + context.atr * 0.36) respected += 1;
    else if (kind === 'image_diagonal_structure' && Math.abs(candle.closePrice - projected) <= context.atr * 1.2) respected += 1;
  }
  return clamp(respected / relevant.length, 0, 1);
}

function spacingScoreFor(points: CandidatePoint[], candleCount: number): number {
  if (points.length < 2) return 0;
  const sorted = [...points].sort((a, b) => a.candleIndex - b.candleIndex);
  const span = sorted.at(-1)!.candleIndex - sorted[0].candleIndex;
  const gaps = sorted.slice(1).map((point, index) => point.candleIndex - sorted[index].candleIndex);
  const balance = 1 - coefficientOfVariation(gaps);
  return clamp(span / Math.max(1, candleCount) * 0.62 + balance * 0.38, 0, 1);
}

function slopeStateFor(normalizedSlope: number, slope: number): string {
  if (normalizedSlope >= 0.72) return 'unsustainable_steep';
  if (normalizedSlope <= 0.08) return 'weakening_flat';
  return slope > 0 ? 'healthy_rising_slope' : slope < 0 ? 'healthy_falling_slope' : 'flat_range_line';
}

function breakProbabilityFor(kind: string, start: CandidatePoint, end: CandidatePoint, candles: ReconstructedCandle[], context: Context, respectScore: number, normalizedSlope: number): number {
  const latest = candles.at(-1)!;
  const projected = projectPrice(start, end, latest.candleIndex);
  const pressure = kind === 'bullish_support'
    ? clamp((projected - latest.closePrice) / Math.max(0.0001, context.atr), 0, 1)
    : kind === 'bearish_resistance'
      ? clamp((latest.closePrice - projected) / Math.max(0.0001, context.atr), 0, 1)
      : clamp(Math.abs(latest.closePrice - projected) / Math.max(0.0001, context.atr), 0, 1);
  return clamp(pressure * 0.34 + context.volatilityCompressionScore * 0.2 + context.displacementScore * 0.22 + (1 - respectScore) * 0.14 + normalizedSlope * 0.1, 0, 0.97);
}

function trapRiskFor(kind: string, touchCount: number, breakProbability: number, context: Context): number {
  const obviousLineScore = clamp(touchCount / 5, 0, 1);
  const retailBias = kind === 'image_diagonal_structure' ? 0.1 : 0.18;
  return clamp(retailBias + obviousLineScore * 0.32 + breakProbability * 0.22 + context.liquidityScore * 0.28, 0, 0.96);
}

function wickRejection(candle: ReconstructedCandle, direction: string): number {
  const body = Math.abs(candle.closePrice - candle.openPrice);
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  const upper = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lower = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  const wick = direction === 'bullish' ? lower : upper;
  return clamp((wick / range) * 0.72 + (1 - body / range) * 0.28, 0, 1);
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recentRange = average(ranges.slice(-8));
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const volatilityCompressionScore = clamp(1 - recentRange / Math.max(0.0001, atr * 1.25), 0, 1);
  const displacementScore = clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1);
  const last = candles.at(-1)!;
  const recentHigh = Math.max(...candles.slice(-14).map((candle) => candle.highPrice));
  const recentLow = Math.min(...candles.slice(-14).map((candle) => candle.lowPrice));
  const liquidityScore = clamp((Math.min(Math.abs(last.closePrice - recentHigh), Math.abs(last.closePrice - recentLow)) <= atr * 0.5 ? 0.72 : 0.32) + displacementScore * 0.18, 0, 1);
  return { atr, volatilityCompressionScore, displacementScore, liquidityScore };
}

function dedupeTrendlines(lines: TrendlineDetection[]): TrendlineDetection[] {
  const sorted = [...lines].sort((a, b) => b.validityScore - a.validityScore);
  const accepted: TrendlineDetection[] = [];
  for (const line of sorted) {
    const duplicate = accepted.some((item) => (
      item.trendlineKind === line.trendlineKind
      && Math.abs(item.slope - line.slope) < 0.0001
      && Math.abs(item.startCandleIndex - line.startCandleIndex) <= 2
      && Math.abs(item.endCandleIndex - line.endCandleIndex) <= 2
    ));
    if (!duplicate) accepted.push(line);
  }
  return accepted;
}

function explainTrendline(kind: string, direction: string, touches: number, validity: number, breakProbability: number, retestProbability: number, trapRisk: number, slopeState: string): string {
  const role = kind === 'bullish_support' ? 'support trendline' : kind === 'bearish_resistance' ? 'resistance trendline' : 'image-derived diagonal structure';
  const trap = trapRisk >= 0.66 ? ' Obvious-line trap risk is elevated, so wait for displacement plus retest confirmation.' : '';
  return `Detected ${role} with ${touches} valid touches, ${percent(validity)} validity, ${slopeState}, ${percent(breakProbability)} break probability, and ${percent(retestProbability)} retest probability in a ${direction} context.${trap}`;
}

function coefficientOfVariation(values: number[]): number {
  const avg = average(values);
  if (!avg) return 1;
  const variance = average(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance) / avg;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
