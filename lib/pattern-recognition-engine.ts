import { analyzeSwingPoints, normalizeSwingInputCandles, type SwingDetection } from './swing-point-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface PatternRecognitionResult {
  id?: string;
  chartCaptureId?: string;
  patternName: string;
  patternFamily: string;
  patternStatus: string;
  completionPercentage: number;
  breakoutDirection: string;
  breakoutProbability: number;
  failureProbability: number;
  trapProbability: number;
  retailTrapScore: number;
  institutionalInterpretation: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  confidenceScore: number;
  similarityScore: number;
  dtwDistance: number;
  overlayCoordinates: Record<string, unknown>;
  normalizedShape: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface PatternSimilarityHistory {
  id?: string;
  chartCaptureId?: string;
  patternResultId?: string | null;
  templateName: string;
  templateFamily: string;
  similarityScore: number;
  dtwDistance: number;
  historicalSuccessRate: number;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface PatternProbabilitySnapshot {
  id?: string;
  chartCaptureId?: string;
  bullishBreakoutProbability: number;
  bearishBreakoutProbability: number;
  continuationProbability: number;
  reversalProbability: number;
  accumulationProbability: number;
  distributionProbability: number;
  manipulationProbability: number;
  volatilityCompressionScore: number;
  displacementScore: number;
  liquidityLocationScore: number;
  trendContextScore: number;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface PatternAnalysisResult {
  patterns: PatternRecognitionResult[];
  similarHistory: PatternSimilarityHistory[];
  probability: PatternProbabilitySnapshot;
  summary: {
    dominantPattern: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
}

type Template = {
  name: string;
  family: string;
  shape: number[];
  successRate: number;
  defaultDirection: 'bullish' | 'bearish' | 'neutral';
};

const templates: Template[] = [
  { name: 'double top', family: 'reversal', shape: [0.2, 0.9, 0.35, 0.88, 0.25], successRate: 0.58, defaultDirection: 'bearish' },
  { name: 'double bottom', family: 'reversal', shape: [0.8, 0.15, 0.62, 0.18, 0.75], successRate: 0.6, defaultDirection: 'bullish' },
  { name: 'head and shoulders', family: 'reversal', shape: [0.35, 0.75, 0.45, 1, 0.42, 0.72, 0.28], successRate: 0.57, defaultDirection: 'bearish' },
  { name: 'inverse head and shoulders', family: 'reversal', shape: [0.65, 0.25, 0.55, 0, 0.58, 0.28, 0.72], successRate: 0.59, defaultDirection: 'bullish' },
  { name: 'ascending triangle', family: 'continuation', shape: [0.2, 0.85, 0.38, 0.86, 0.54, 0.88, 0.7], successRate: 0.62, defaultDirection: 'bullish' },
  { name: 'descending triangle', family: 'continuation', shape: [0.8, 0.15, 0.62, 0.14, 0.46, 0.12, 0.3], successRate: 0.61, defaultDirection: 'bearish' },
  { name: 'symmetrical triangle', family: 'compression', shape: [0.15, 0.9, 0.28, 0.76, 0.42, 0.62, 0.52], successRate: 0.54, defaultDirection: 'neutral' },
  { name: 'bull flag', family: 'continuation', shape: [0.1, 0.85, 0.72, 0.78, 0.68, 0.74, 0.7], successRate: 0.64, defaultDirection: 'bullish' },
  { name: 'bear flag', family: 'continuation', shape: [0.9, 0.15, 0.28, 0.22, 0.32, 0.26, 0.3], successRate: 0.63, defaultDirection: 'bearish' },
  { name: 'range accumulation', family: 'accumulation', shape: [0.35, 0.62, 0.38, 0.6, 0.36, 0.63, 0.42], successRate: 0.56, defaultDirection: 'bullish' },
  { name: 'distribution range', family: 'distribution', shape: [0.65, 0.38, 0.62, 0.4, 0.64, 0.37, 0.58], successRate: 0.55, defaultDirection: 'bearish' },
  { name: 'rising wedge', family: 'reversal', shape: [0.2, 0.55, 0.42, 0.68, 0.56, 0.74, 0.64], successRate: 0.57, defaultDirection: 'bearish' },
  { name: 'falling wedge', family: 'reversal', shape: [0.8, 0.45, 0.58, 0.32, 0.44, 0.26, 0.36], successRate: 0.58, defaultDirection: 'bullish' },
];

export function normalizePatternInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeSwingInputCandles(input);
}

export function analyzePatterns(candles: ReconstructedCandle[]): PatternAnalysisResult {
  if (candles.length < 8) {
    const probability = emptyProbability();
    return {
      patterns: [],
      similarHistory: [],
      probability,
      summary: {
        dominantPattern: 'insufficient_data',
        institutionalBias: 'WAIT',
        recommendedAction: 'WAIT',
        confidence: 0,
        explanation: 'At least eight reconstructed candles are required for pattern recognition.',
      },
    };
  }

  const swingAnalysis = analyzeSwingPoints(candles, { depths: [1, 2, 4, 7], zigzagPercent: 0.08 });
  const pivots = swingAnalysis.swings.length >= 4 ? swingAnalysis.swings : fallbackPivots(candles);
  const shape = normalizeShape(pivots);
  const ranked = templates
    .map((template) => {
      const distance = dtwDistance(shape, template.shape);
      const similarity = clamp(1 - distance / Math.max(shape.length, template.shape.length), 0, 1);
      return { template, distance, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const context = buildContext(candles, pivots, swingAnalysis.swings);
  const patterns = ranked.slice(0, 5).map((match, index) => buildPattern(match, shape, pivots, candles, context, index));
  const similarHistory = ranked.slice(0, 8).map((match) => ({
    templateName: match.template.name,
    templateFamily: match.template.family,
    similarityScore: match.similarity,
    dtwDistance: match.distance,
    historicalSuccessRate: match.template.successRate,
    metadata: {
      model: 'dtw_template_similarity',
      shapeLength: shape.length,
      cnnVisionTransformerReady: true,
    },
  }));
  const probability = buildProbability(patterns, context);
  const dominant = patterns[0];

  return {
    patterns,
    similarHistory,
    probability,
    summary: {
      dominantPattern: dominant.patternName,
      institutionalBias: dominant.institutionalInterpretation,
      recommendedAction: dominant.recommendedAction,
      confidence: dominant.confidenceScore,
      explanation: `${dominant.patternName} is ${Math.round(dominant.completionPercentage * 100)}% complete with ${Math.round(dominant.breakoutProbability * 100)}% ${dominant.breakoutDirection} breakout probability and ${Math.round(dominant.trapProbability * 100)}% trap probability.`,
    },
  };
}

function buildPattern(
  match: { template: Template; distance: number; similarity: number },
  shape: number[],
  pivots: SwingDetection[],
  candles: ReconstructedCandle[],
  context: ReturnType<typeof buildContext>,
  rank: number,
): PatternRecognitionResult {
  const completion = completionFrom(shape, match.template.shape, match.similarity);
  const compressionBoost = context.volatilityCompressionScore * 0.18;
  const direction = breakoutDirection(match.template, context);
  const trapProbability = trapProbabilityFor(match.template, context, completion);
  const failureProbability = clamp((1 - match.similarity) * 0.42 + trapProbability * 0.35 + (completion < 0.78 ? 0.12 : 0), 0, 0.96);
  const breakoutProbability = clamp(match.similarity * 0.38 + completion * 0.24 + context.displacementScore * 0.2 + compressionBoost + context.trendContextScore * 0.12 - trapProbability * 0.16, 0, 0.98);
  const retailTrapScore = clamp(trapProbability * 0.75 + context.liquidityLocationScore * 0.25, 0, 1);
  const patternStatus = completion < 0.72 ? 'evolving_partial' : failureProbability > 0.58 ? 'failed_or_trap_risk' : 'active_validating';
  const recommendedAction = actionFor(direction, breakoutProbability, failureProbability, trapProbability);
  const confidence = clamp(match.similarity * 0.44 + completion * 0.24 + breakoutProbability * 0.22 + (1 - failureProbability) * 0.1 - rank * 0.03, 0, 0.98);

  return {
    patternName: match.template.name,
    patternFamily: match.template.family,
    patternStatus,
    completionPercentage: completion,
    breakoutDirection: direction,
    breakoutProbability,
    failureProbability,
    trapProbability,
    retailTrapScore,
    institutionalInterpretation: institutionalInterpretation(match.template, trapProbability, context),
    recommendedAction,
    confidenceScore: confidence,
    similarityScore: match.similarity,
    dtwDistance: match.distance,
    overlayCoordinates: {
      pivots: pivots.map((pivot) => ({
        x: pivot.pixelX,
        y: pivot.pixelY,
        price: pivot.priceLevel,
        kind: pivot.swingKind,
        category: pivot.swingCategory,
      })),
      breakoutZone: breakoutZone(candles, direction),
    },
    normalizedShape: { values: shape, method: 'min_max_price_scale_normalization' },
    metadata: {
      dynamicTimeWarping: true,
      shapeNormalization: true,
      failedPatternDetection: true,
      cnnVisionTransformerReady: true,
      futureModelInterface: {
        endpoint: '/ai/inference/visual_intelligence_service.py',
        input: 'processed_chart_image_or_overlay_tensor',
        output: 'visual_pattern_classification',
      },
    },
  };
}

function buildProbability(patterns: PatternRecognitionResult[], context: ReturnType<typeof buildContext>): PatternProbabilitySnapshot {
  const bullish = patterns.filter((pattern) => pattern.breakoutDirection === 'bullish');
  const bearish = patterns.filter((pattern) => pattern.breakoutDirection === 'bearish');
  const continuation = patterns.filter((pattern) => pattern.patternFamily === 'continuation');
  const reversal = patterns.filter((pattern) => pattern.patternFamily === 'reversal');
  return {
    bullishBreakoutProbability: averageOr(bullish.map((pattern) => pattern.breakoutProbability), context.trendDirection === 'bullish' ? 0.58 : 0.42),
    bearishBreakoutProbability: averageOr(bearish.map((pattern) => pattern.breakoutProbability), context.trendDirection === 'bearish' ? 0.58 : 0.42),
    continuationProbability: averageOr(continuation.map((pattern) => pattern.breakoutProbability), context.trendContextScore),
    reversalProbability: averageOr(reversal.map((pattern) => pattern.breakoutProbability), 1 - context.trendContextScore),
    accumulationProbability: clamp(context.liquidityLocationScore * 0.35 + context.volatilityCompressionScore * 0.35 + (context.trendDirection === 'bullish' ? 0.18 : 0.08), 0, 1),
    distributionProbability: clamp(context.liquidityLocationScore * 0.35 + context.volatilityCompressionScore * 0.32 + (context.trendDirection === 'bearish' ? 0.18 : 0.1), 0, 1),
    manipulationProbability: averageOr(patterns.map((pattern) => pattern.trapProbability), 0.35),
    volatilityCompressionScore: context.volatilityCompressionScore,
    displacementScore: context.displacementScore,
    liquidityLocationScore: context.liquidityLocationScore,
    trendContextScore: context.trendContextScore,
    metadata: {
      probabilityModel: 'compression_displacement_liquidity_trend_context',
      volumeProxy: context.volumeProxy,
      currentTrend: context.trendDirection,
    },
  };
}

function buildContext(candles: ReconstructedCandle[], pivots: SwingDetection[], swings: SwingDetection[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recentRange = average(ranges.slice(-8));
  const volatilityCompressionScore = clamp(1 - recentRange / Math.max(0.0001, atr * 1.25), 0, 1);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const displacementScore = clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1);
  const first = candles[0];
  const last = candles[candles.length - 1];
  const trendDirection = last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'neutral';
  const trendContextScore = trendDirection === 'neutral' ? 0.48 : 0.68;
  const liquidityLocationScore = clamp(average(swings.slice(-6).map((swing) => swing.liquidityRelevance)) || pivots.length / 10, 0, 1);
  const volumeProxy = clamp(displacementScore * 0.58 + volatilityCompressionScore * 0.2 + liquidityLocationScore * 0.22, 0, 1);
  return {
    atr,
    volatilityCompressionScore,
    displacementScore,
    liquidityLocationScore,
    trendContextScore,
    trendDirection,
    volumeProxy,
  };
}

function fallbackPivots(candles: ReconstructedCandle[]): SwingDetection[] {
  const step = Math.max(1, Math.floor(candles.length / 7));
  return candles.filter((_, index) => index % step === 0).slice(0, 8).map((candle, index) => ({
    candleIndex: candle.candleIndex,
    swingKind: index % 2 === 0 ? 'low' : 'high',
    swingCategory: 'micro swing',
    priceLevel: index % 2 === 0 ? candle.lowPrice : candle.highPrice,
    pixelX: candle.pixelX,
    pixelY: index % 2 === 0 ? candle.pixelYLow : candle.pixelYHigh,
    depth: 1,
    leftStrength: 0.4,
    rightStrength: 0.4,
    atrValidationScore: 0.4,
    zigzagValidationScore: 0.4,
    rejectionScore: 0.4,
    continuationScore: 0.4,
    liquidityRelevance: 0.3,
    turningPointProbability: 0.4,
    strengthScore: 0.4,
    swept: false,
    structuralImportance: 'fallback pivot',
    aiExplanation: 'Fallback pivot used because limited fractal swings were available.',
    geometry: {},
    metadata: {},
  }));
}

function normalizeShape(pivots: SwingDetection[]): number[] {
  const selected = pivots.slice(-9);
  const prices = selected.map((pivot) => pivot.priceLevel);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(0.0001, max - min);
  return prices.map((price) => (price - min) / range);
}

function dtwDistance(left: number[], right: number[]): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(Infinity));
  matrix[0][0] = 0;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = Math.abs(left[i - 1] - right[j - 1]);
      matrix[i][j] = cost + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[left.length][right.length] / Math.max(left.length, right.length);
}

function completionFrom(shape: number[], template: number[], similarity: number): number {
  return clamp(Math.min(1, shape.length / template.length) * 0.55 + similarity * 0.45, 0, 1);
}

function breakoutDirection(template: Template, context: ReturnType<typeof buildContext>): string {
  if (template.defaultDirection !== 'neutral') return template.defaultDirection;
  return context.trendDirection === 'bearish' ? 'bearish' : context.trendDirection === 'bullish' ? 'bullish' : 'two_sided';
}

function trapProbabilityFor(template: Template, context: ReturnType<typeof buildContext>, completion: number): number {
  const retailPattern = ['double top', 'double bottom', 'head and shoulders', 'inverse head and shoulders', 'ascending triangle', 'descending triangle'].includes(template.name);
  return clamp((retailPattern ? 0.22 : 0.1) + context.liquidityLocationScore * 0.35 + (completion > 0.82 ? 0.1 : 0) + context.displacementScore * 0.16, 0, 0.95);
}

function actionFor(direction: string, breakout: number, failure: number, trap: number): PatternRecognitionResult['recommendedAction'] {
  if (trap > 0.7 || failure > 0.68) return 'AVOID';
  if (breakout < 0.56) return 'WAIT';
  if (direction === 'bullish') return 'BUY';
  if (direction === 'bearish') return 'SELL';
  return 'WAIT';
}

function institutionalInterpretation(template: Template, trap: number, context: ReturnType<typeof buildContext>): string {
  if (trap > 0.68) return `Likely manipulation around an obvious retail ${template.name}; wait for sweep and reclaim confirmation.`;
  if (template.family === 'accumulation') return 'Potential institutional accumulation, especially if displacement follows compression.';
  if (template.family === 'distribution') return 'Potential institutional distribution; watch for failed upside continuation and supply defense.';
  if (template.family === 'continuation') return `Continuation structure aligned with ${context.trendDirection} trend context.`;
  if (template.family === 'reversal') return 'Reversal pattern is forming, but institutional confirmation requires structure break and liquidity validation.';
  return 'Pattern remains neutral until breakout and retest quality improves.';
}

function breakoutZone(candles: ReconstructedCandle[], direction: string) {
  const recent = candles.slice(-20);
  if (direction === 'bearish') {
    return { low: Math.min(...recent.map((candle) => candle.lowPrice)), high: Math.min(...recent.map((candle) => candle.closePrice)) };
  }
  return { low: Math.max(...recent.map((candle) => candle.closePrice)), high: Math.max(...recent.map((candle) => candle.highPrice)) };
}

function emptyProbability(): PatternProbabilitySnapshot {
  return {
    bullishBreakoutProbability: 0,
    bearishBreakoutProbability: 0,
    continuationProbability: 0,
    reversalProbability: 0,
    accumulationProbability: 0,
    distributionProbability: 0,
    manipulationProbability: 0,
    volatilityCompressionScore: 0,
    displacementScore: 0,
    liquidityLocationScore: 0,
    trendContextScore: 0,
    metadata: {},
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageOr(values: number[], fallback: number): number {
  return values.length ? average(values) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
