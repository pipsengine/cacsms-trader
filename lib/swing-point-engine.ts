import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';
import { normalizeInputCandles } from './candle-detection-engine';

export interface SwingDetection {
  id?: string;
  chartCaptureId?: string;
  candleIndex: number;
  swingKind: 'high' | 'low';
  swingCategory: string;
  priceLevel: number;
  pixelX: number;
  pixelY: number;
  depth: number;
  leftStrength: number;
  rightStrength: number;
  atrValidationScore: number;
  zigzagValidationScore: number;
  rejectionScore: number;
  continuationScore: number;
  liquidityRelevance: number;
  turningPointProbability: number;
  strengthScore: number;
  swept: boolean;
  structuralImportance: string;
  aiExplanation: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface SwingHierarchyState {
  id?: string;
  chartCaptureId?: string;
  timeframe: string;
  hierarchyLevel: string;
  trendState: string;
  lastStructureHigh: number | null;
  lastStructureLow: number | null;
  liquidityBias: string;
  structuralNarrative: string;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface SwingAnalysisResult {
  swings: SwingDetection[];
  hierarchy: SwingHierarchyState[];
  liquidity: SwingDetection[];
  summary: {
    trendState: string;
    dominantSwing: string;
    structuralBias: string;
    confidence: number;
    explanation: string;
  };
}

interface SwingOptions {
  timeframe?: string;
  depths?: number[];
  atrMultiplier?: number;
  zigzagPercent?: number;
}

export function normalizeSwingInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeSwingPoints(candles: ReconstructedCandle[], options: SwingOptions = {}): SwingAnalysisResult {
  if (candles.length < 5) {
    return {
      swings: [],
      hierarchy: [],
      liquidity: [],
      summary: {
        trendState: 'insufficient_data',
        dominantSwing: 'none',
        structuralBias: 'WAIT',
        confidence: 0,
        explanation: 'At least five reconstructed candles are required for swing point analysis.',
      },
    };
  }

  const context = buildContext(candles);
  const depths = options.depths ?? [1, 2, 4, 7];
  const raw = depths.flatMap((depth) => detectFractalSwings(candles, depth, context, options));
  const deduped = dedupeSwings(raw);
  const zigzag = applyZigZagFilter(deduped, context, options);
  const swings = zigzag.map((swing) => enrichLiquidity(swing, candles, context));
  const hierarchy = buildHierarchy(swings, candles, context, options.timeframe ?? 'M5');
  const liquidity = swings.filter((swing) => swing.liquidityRelevance >= 0.68 || swing.swept);
  const latest = swings.at(-1);
  const confidence = clamp(average(swings.slice(-8).map((swing) => swing.turningPointProbability)), 0, 0.98);

  return {
    swings,
    hierarchy,
    liquidity,
    summary: {
      trendState: context.trendState,
      dominantSwing: latest ? `${latest.swingCategory} ${latest.swingKind}` : 'none',
      structuralBias: context.trendState === 'bullish' ? 'BUY_CONTEXT' : context.trendState === 'bearish' ? 'SELL_CONTEXT' : 'WAIT',
      confidence,
      explanation: latest
        ? `Latest ${latest.swingCategory} ${latest.swingKind} at ${latest.priceLevel} has ${percent(latest.turningPointProbability)} turning-point probability and ${percent(latest.liquidityRelevance)} liquidity relevance.`
        : 'No institutional-quality swing point survived volatility and ZigZag filtering.',
    },
  };
}

function detectFractalSwings(
  candles: ReconstructedCandle[],
  depth: number,
  context: ReturnType<typeof buildContext>,
  options: SwingOptions,
): SwingDetection[] {
  const swings: SwingDetection[] = [];
  for (let index = depth; index < candles.length - depth; index += 1) {
    const candle = candles[index];
    const left = candles.slice(index - depth, index);
    const right = candles.slice(index + 1, index + depth + 1);
    const isHigh = left.every((item) => candle.highPrice >= item.highPrice) && right.every((item) => candle.highPrice > item.highPrice);
    const isLow = left.every((item) => candle.lowPrice <= item.lowPrice) && right.every((item) => candle.lowPrice < item.lowPrice);
    if (!isHigh && !isLow) continue;

    const kind = isHigh ? 'high' : 'low';
    const price = kind === 'high' ? candle.highPrice : candle.lowPrice;
    const leftExtreme = kind === 'high' ? Math.max(...left.map((item) => item.highPrice)) : Math.min(...left.map((item) => item.lowPrice));
    const rightExtreme = kind === 'high' ? Math.max(...right.map((item) => item.highPrice)) : Math.min(...right.map((item) => item.lowPrice));
    const leftStrength = Math.abs(price - leftExtreme) / Math.max(0.0001, context.atr);
    const rightStrength = Math.abs(price - rightExtreme) / Math.max(0.0001, context.atr);
    const atrValidationScore = clamp((leftStrength + rightStrength) / (options.atrMultiplier ?? 1.2), 0, 1);
    if (atrValidationScore < 0.22) continue;

    const rejectionScore = wickRejectionScore(candle, kind);
    const continuationScore = continuationScoreFrom(candles, index, kind, context);
    const strengthScore = clamp(atrValidationScore * 0.34 + rejectionScore * 0.22 + continuationScore * 0.24 + depth / 10 * 0.2, 0, 1);
    const category = categorizeSwing(depth, strengthScore, atrValidationScore, rejectionScore);
    const turningPointProbability = clamp(strengthScore * 0.52 + rejectionScore * 0.18 + continuationScore * 0.16 + volatilityScore(context) * 0.14, 0, 1);

    swings.push({
      candleIndex: candle.candleIndex,
      swingKind: kind,
      swingCategory: category,
      priceLevel: round(price),
      pixelX: candle.pixelX,
      pixelY: kind === 'high' ? candle.pixelYHigh : candle.pixelYLow,
      depth,
      leftStrength: clamp(leftStrength, 0, 1),
      rightStrength: clamp(rightStrength, 0, 1),
      atrValidationScore,
      zigzagValidationScore: 0,
      rejectionScore,
      continuationScore,
      liquidityRelevance: 0,
      turningPointProbability,
      strengthScore,
      swept: false,
      structuralImportance: category,
      aiExplanation: '',
      geometry: {
        candleIndex: candle.candleIndex,
        pixel: { x: candle.pixelX, y: kind === 'high' ? candle.pixelYHigh : candle.pixelYLow },
        price,
        fractalDepth: depth,
      },
      metadata: {
        leftComparisonCandles: depth,
        rightComparisonCandles: depth,
        atr: context.atr,
        algorithm: 'fractal_swing_detection',
      },
    });
  }
  return swings;
}

function applyZigZagFilter(swings: SwingDetection[], context: ReturnType<typeof buildContext>, options: SwingOptions): SwingDetection[] {
  const sorted = swings.sort((a, b) => a.candleIndex - b.candleIndex || b.strengthScore - a.strengthScore);
  const filtered: SwingDetection[] = [];
  const minMove = Math.max(context.atr * 0.9, context.lastClose * ((options.zigzagPercent ?? 0.12) / 100));

  for (const swing of sorted) {
    const previous = filtered.at(-1);
    if (!previous) {
      filtered.push({ ...swing, zigzagValidationScore: 0.72 });
      continue;
    }

    const movement = Math.abs(swing.priceLevel - previous.priceLevel);
    if (swing.swingKind === previous.swingKind) {
      const shouldReplace = swing.swingKind === 'high'
        ? swing.priceLevel > previous.priceLevel
        : swing.priceLevel < previous.priceLevel;
      if (shouldReplace && swing.strengthScore >= previous.strengthScore * 0.85) {
        filtered[filtered.length - 1] = { ...swing, zigzagValidationScore: clamp(movement / Math.max(0.0001, minMove), 0, 1) };
      }
      continue;
    }

    if (movement >= minMove || swing.strengthScore >= 0.72) {
      filtered.push({ ...swing, zigzagValidationScore: clamp(movement / Math.max(0.0001, minMove), 0, 1) });
    }
  }

  return filtered.map((swing) => ({
    ...swing,
    strengthScore: clamp(swing.strengthScore * 0.72 + swing.zigzagValidationScore * 0.28, 0, 1),
    turningPointProbability: clamp(swing.turningPointProbability * 0.75 + swing.zigzagValidationScore * 0.25, 0, 1),
  }));
}

function enrichLiquidity(swing: SwingDetection, candles: ReconstructedCandle[], context: ReturnType<typeof buildContext>): SwingDetection {
  const tolerance = context.atr * 0.28;
  const sameSide = candles.filter((candle) => {
    const price = swing.swingKind === 'high' ? candle.highPrice : candle.lowPrice;
    return Math.abs(price - swing.priceLevel) <= tolerance;
  });
  const future = candles.slice(swing.candleIndex + 1);
  const swept = swing.swingKind === 'high'
    ? future.some((candle) => candle.highPrice > swing.priceLevel + tolerance * 0.35 && candle.closePrice < swing.priceLevel)
    : future.some((candle) => candle.lowPrice < swing.priceLevel - tolerance * 0.35 && candle.closePrice > swing.priceLevel);
  const equalHighLowScore = clamp(sameSide.length / 4, 0, 1);
  const stopPoolScore = clamp(equalHighLowScore * 0.55 + (swept ? 0.35 : 0) + swing.strengthScore * 0.25, 0, 1);
  const liquidityRelevance = clamp(stopPoolScore, 0, 1);
  const structuralImportance = structuralImportanceFor(swing.swingCategory, liquidityRelevance, swept, swing.turningPointProbability);
  return {
    ...swing,
    liquidityRelevance,
    swept,
    structuralImportance,
    swingCategory: liquidityRelevance >= 0.76 ? 'liquidity swing' : swing.swingCategory,
    aiExplanation: explainSwing(swing, liquidityRelevance, swept, structuralImportance),
    metadata: {
      ...swing.metadata,
      equalHighLowTouches: sameSide.length,
      likelyStopPool: liquidityRelevance >= 0.68,
      swept,
      liquidityResting: swing.swingKind === 'high' ? 'above_swing_high' : 'below_swing_low',
    },
  };
}

function buildHierarchy(
  swings: SwingDetection[],
  candles: ReconstructedCandle[],
  context: ReturnType<typeof buildContext>,
  timeframe: string,
): SwingHierarchyState[] {
  const major = swings.filter((swing) => ['major swing', 'institutional swing', 'structure-defining swing', 'liquidity swing'].includes(swing.swingCategory));
  const highs = major.filter((swing) => swing.swingKind === 'high');
  const lows = major.filter((swing) => swing.swingKind === 'low');
  const lastHigh = highs.at(-1)?.priceLevel ?? null;
  const lastLow = lows.at(-1)?.priceLevel ?? null;
  const liquidityBias = swings.at(-1)?.swingKind === 'high' ? 'sell_side_reaction_watch' : 'buy_side_reaction_watch';
  const confidence = clamp(average(major.slice(-6).map((swing) => swing.strengthScore)) || average(swings.slice(-6).map((swing) => swing.strengthScore)), 0, 0.98);

  return [
    {
      timeframe,
      hierarchyLevel: 'micro_to_minor',
      trendState: context.trendState,
      lastStructureHigh: highs.at(-1)?.priceLevel ?? null,
      lastStructureLow: lows.at(-1)?.priceLevel ?? null,
      liquidityBias,
      structuralNarrative: `Micro and minor swings show ${context.trendState} structure across ${candles.length} reconstructed candles.`,
      confidence,
      metadata: { swingCount: swings.length, microCount: swings.filter((swing) => swing.swingCategory === 'micro swing').length },
    },
    {
      timeframe,
      hierarchyLevel: 'institutional_structure',
      trendState: context.trendState,
      lastStructureHigh: lastHigh,
      lastStructureLow: lastLow,
      liquidityBias,
      structuralNarrative: lastHigh && lastLow
        ? `Institutional hierarchy is defined between ${round(lastLow)} and ${round(lastHigh)} with ${major.length} validated major swings.`
        : 'Institutional hierarchy is still forming; additional validated major swings are required.',
      confidence,
      metadata: { majorSwingCount: major.length, liquiditySwingCount: swings.filter((swing) => swing.liquidityRelevance >= 0.68).length },
    },
  ];
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    atr,
    lastClose: last.closePrice,
    trendState: last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'range',
    volatility: atr / Math.max(0.0001, average(ranges)),
  };
}

function dedupeSwings(swings: SwingDetection[]): SwingDetection[] {
  const byKey = new Map<string, SwingDetection>();
  for (const swing of swings) {
    const key = `${swing.candleIndex}:${swing.swingKind}`;
    const existing = byKey.get(key);
    if (!existing || swing.strengthScore > existing.strengthScore) byKey.set(key, swing);
  }
  return Array.from(byKey.values());
}

function wickRejectionScore(candle: ReconstructedCandle, kind: 'high' | 'low'): number {
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  const upper = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lower = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  return clamp((kind === 'high' ? upper : lower) / range * 1.35, 0, 1);
}

function continuationScoreFrom(candles: ReconstructedCandle[], index: number, kind: 'high' | 'low', context: ReturnType<typeof buildContext>): number {
  const future = candles.slice(index + 1, Math.min(candles.length, index + 6));
  if (future.length === 0) return 0.3;
  const pivot = candles[index];
  const move = kind === 'high'
    ? pivot.highPrice - Math.min(...future.map((candle) => candle.lowPrice))
    : Math.max(...future.map((candle) => candle.highPrice)) - pivot.lowPrice;
  return clamp(move / Math.max(0.0001, context.atr * 2), 0, 1);
}

function categorizeSwing(depth: number, strength: number, atrScore: number, rejection: number): string {
  if (strength >= 0.82 && atrScore >= 0.72) return 'structure-defining swing';
  if (strength >= 0.72) return 'institutional swing';
  if (depth >= 7 || strength >= 0.62) return 'major swing';
  if (depth >= 2 || rejection >= 0.48) return 'minor swing';
  return 'micro swing';
}

function structuralImportanceFor(category: string, liquidity: number, swept: boolean, turning: number): string {
  if (swept && liquidity >= 0.68) return 'swept liquidity pivot';
  if (liquidity >= 0.78) return 'liquidity pool pivot';
  if (turning >= 0.78 || category === 'structure-defining swing') return 'structure-defining pivot';
  if (category === 'institutional swing') return 'institutional pivot';
  return 'local market turn';
}

function explainSwing(swing: SwingDetection, liquidity: number, swept: boolean, importance: string): string {
  const side = swing.swingKind === 'high' ? 'swing high' : 'swing low';
  const sweepText = swept ? 'It has already been swept, so confirmation must come from reclaim or continuation.' : 'It has not been swept yet and may act as resting liquidity.';
  return `${swing.swingCategory} ${side} detected at ${round(swing.priceLevel)} with ${percent(swing.strengthScore)} strength and ${percent(swing.turningPointProbability)} turning-point probability. Liquidity relevance is ${percent(liquidity)}. ${importance}. ${sweepText}`;
}

function volatilityScore(context: ReturnType<typeof buildContext>): number {
  return clamp(context.volatility, 0, 1);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
