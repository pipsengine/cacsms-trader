import { normalizeInputCandles } from './candle-detection-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface OrderBlockDetection {
  id?: string;
  chartCaptureId?: string;
  blockType: 'bullish' | 'bearish';
  originCandleIndex: number;
  displacementCandleIndex: number;
  zoneLow: number;
  zoneHigh: number;
  openPrice: number;
  closePrice: number;
  invalidationLevel: number;
  mitigationStatus: 'fresh' | 'partial_mitigation' | 'full_mitigation' | 'invalidated';
  mitigationPercentage: number;
  displacementStrength: number;
  bodyDominanceScore: number;
  rangeExpansionScore: number;
  bosConfirmed: boolean;
  bosStrength: number;
  fvgConfirmed: boolean;
  fvgScore: number;
  participationProxyScore: number;
  freshnessScore: number;
  liquidityProximityScore: number;
  htfAlignmentScore: number;
  qualityScore: number;
  institutionalRelevance: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  aiExplanation: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface OrderBlockMitigationEvent {
  id?: string;
  orderBlockId?: string;
  chartCaptureId?: string;
  candleIndex: number;
  mitigationType: string;
  penetrationPercentage: number;
  reactionScore: number;
  invalidated: boolean;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface OrderBlockAnalysisResult {
  orderBlocks: OrderBlockDetection[];
  mitigationEvents: OrderBlockMitigationEvent[];
  summary: {
    dominantBlock: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
}

type Context = ReturnType<typeof buildContext>;

export function normalizeOrderBlockInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeOrderBlocks(candles: ReconstructedCandle[]): OrderBlockAnalysisResult {
  if (candles.length < 12) {
    return {
      orderBlocks: [],
      mitigationEvents: [],
      summary: {
        dominantBlock: 'insufficient_data',
        institutionalBias: 'WAIT',
        recommendedAction: 'WAIT',
        confidence: 0,
        explanation: 'At least twelve reconstructed candles are required for institutional order block detection.',
      },
    };
  }

  const context = buildContext(candles);
  const candidates: OrderBlockDetection[] = [];
  for (let index = 4; index < candles.length - 2; index += 1) {
    const displacement = displacementScore(candles[index], context);
    if (displacement.displacementStrength < 0.58) continue;
    const direction = candles[index].closePrice > candles[index].openPrice ? 'bullish' : candles[index].closePrice < candles[index].openPrice ? 'bearish' : null;
    if (!direction) continue;
    const origin = findLastOpposingCandle(candles, index, direction);
    if (!origin) continue;
    const bos = bosConfirmation(candles, index, direction, context);
    if (!bos.confirmed) continue;
    const fvg = fairValueGapConfirmation(candles, index, direction, context);
    const block = buildOrderBlock(origin, candles[index], candles, direction, displacement, bos, fvg, context);
    if (block.qualityScore >= 0.42) candidates.push(block);
  }

  const orderBlocks = dedupeBlocks(candidates)
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 10);
  const mitigationEvents = orderBlocks.flatMap((block, index) => buildMitigationEvents(block, candles, `block-${index}`));
  const dominant = orderBlocks[0];

  return {
    orderBlocks,
    mitigationEvents,
    summary: {
      dominantBlock: dominant ? `${dominant.blockType} order block ${dominant.zoneLow}-${dominant.zoneHigh}` : 'none',
      institutionalBias: dominant?.institutionalRelevance ?? 'WAIT',
      recommendedAction: dominant?.recommendedAction ?? 'WAIT',
      confidence: dominant?.qualityScore ?? 0,
      explanation: dominant
        ? dominant.aiExplanation
        : 'No order block met displacement, BOS, and institutional quality requirements.',
    },
  };
}

function buildOrderBlock(
  origin: ReconstructedCandle,
  displacement: ReconstructedCandle,
  candles: ReconstructedCandle[],
  direction: 'bullish' | 'bearish',
  displacementMetrics: ReturnType<typeof displacementScore>,
  bos: ReturnType<typeof bosConfirmation>,
  fvg: ReturnType<typeof fairValueGapConfirmation>,
  context: Context,
): OrderBlockDetection {
  const zoneLow = Math.min(origin.openPrice, origin.closePrice, origin.lowPrice);
  const zoneHigh = Math.max(origin.openPrice, origin.closePrice, origin.highPrice);
  const invalidationLevel = direction === 'bullish' ? origin.lowPrice : origin.highPrice;
  const mitigation = mitigationStatus(candles, origin.candleIndex, zoneLow, zoneHigh, direction, invalidationLevel);
  const freshnessScore = clamp(1 - (candles.at(-1)!.candleIndex - origin.candleIndex) / Math.max(1, candles.length), 0, 1);
  const liquidityProximityScore = liquidityProximity(origin, candles, context);
  const htfAlignmentScore = higherTimeframeAlignment(direction, candles);
  const participationProxyScore = clamp(displacementMetrics.displacementStrength * 0.35 + displacementMetrics.bodyDominanceScore * 0.25 + displacementMetrics.rangeExpansionScore * 0.2 + wickRejection(origin, direction) * 0.2, 0, 1);
  const mitigationBoost = mitigation.status === 'fresh' ? 0.14 : mitigation.status === 'partial_mitigation' ? 0.08 : mitigation.status === 'full_mitigation' ? -0.08 : -0.24;
  const qualityScore = clamp(
    displacementMetrics.displacementStrength * 0.24
    + bos.strength * 0.22
    + fvg.score * 0.14
    + freshnessScore * 0.1
    + liquidityProximityScore * 0.1
    + htfAlignmentScore * 0.1
    + participationProxyScore * 0.1
    + mitigationBoost,
    0,
    0.98,
  );
  const institutionalRelevance = relevanceFor(direction, qualityScore, mitigation.status, fvg.confirmed, liquidityProximityScore);
  return {
    blockType: direction,
    originCandleIndex: origin.candleIndex,
    displacementCandleIndex: displacement.candleIndex,
    zoneLow: round(zoneLow),
    zoneHigh: round(zoneHigh),
    openPrice: origin.openPrice,
    closePrice: origin.closePrice,
    invalidationLevel: round(invalidationLevel),
    mitigationStatus: mitigation.status,
    mitigationPercentage: mitigation.percentage,
    displacementStrength: displacementMetrics.displacementStrength,
    bodyDominanceScore: displacementMetrics.bodyDominanceScore,
    rangeExpansionScore: displacementMetrics.rangeExpansionScore,
    bosConfirmed: bos.confirmed,
    bosStrength: bos.strength,
    fvgConfirmed: fvg.confirmed,
    fvgScore: fvg.score,
    participationProxyScore,
    freshnessScore,
    liquidityProximityScore,
    htfAlignmentScore,
    qualityScore,
    institutionalRelevance,
    recommendedAction: actionFor(direction, qualityScore, mitigation.status),
    aiExplanation: explainBlock(direction, origin.candleIndex, zoneLow, zoneHigh, qualityScore, bos.strength, fvg.score, mitigation.status, institutionalRelevance),
    geometry: {
      zone: { low: round(zoneLow), high: round(zoneHigh), invalidation: round(invalidationLevel) },
      origin: { candleIndex: origin.candleIndex, x: origin.pixelX, highY: origin.pixelYHigh, lowY: origin.pixelYLow },
      displacement: { candleIndex: displacement.candleIndex, x: displacement.pixelX, highY: displacement.pixelYHigh, lowY: displacement.pixelYLow },
      fvg: fvg.geometry,
    },
    metadata: {
      strictInstitutionalLogic: true,
      lastOpposingCandle: true,
      bosConfirmation: bos,
      fairValueGapConfirmation: fvg,
      mitigation,
    },
  };
}

function displacementScore(candle: ReconstructedCandle, context: Context) {
  const range = candle.highPrice - candle.lowPrice;
  const body = Math.abs(candle.closePrice - candle.openPrice);
  const bodyDominanceScore = clamp(body / Math.max(0.0001, range), 0, 1);
  const rangeExpansionScore = clamp(range / Math.max(0.0001, context.atr * 1.4), 0, 1);
  const closeLocation = candle.closePrice > candle.openPrice
    ? (candle.closePrice - candle.lowPrice) / Math.max(0.0001, range)
    : (candle.highPrice - candle.closePrice) / Math.max(0.0001, range);
  const displacementStrength = clamp(bodyDominanceScore * 0.42 + rangeExpansionScore * 0.38 + closeLocation * 0.2, 0, 1);
  return { displacementStrength, bodyDominanceScore, rangeExpansionScore };
}

function findLastOpposingCandle(candles: ReconstructedCandle[], displacementIndex: number, direction: 'bullish' | 'bearish'): ReconstructedCandle | null {
  for (let index = displacementIndex - 1; index >= Math.max(0, displacementIndex - 6); index -= 1) {
    const candle = candles[index];
    if (direction === 'bullish' && candle.closePrice < candle.openPrice) return candle;
    if (direction === 'bearish' && candle.closePrice > candle.openPrice) return candle;
  }
  return null;
}

function bosConfirmation(candles: ReconstructedCandle[], index: number, direction: 'bullish' | 'bearish', context: Context) {
  const lookback = candles.slice(Math.max(0, index - 8), index);
  const displacement = candles[index];
  const structureLevel = direction === 'bullish'
    ? Math.max(...lookback.map((candle) => candle.highPrice))
    : Math.min(...lookback.map((candle) => candle.lowPrice));
  const distance = direction === 'bullish'
    ? displacement.closePrice - structureLevel
    : structureLevel - displacement.closePrice;
  const strength = clamp(distance / Math.max(0.0001, context.atr * 1.2), 0, 1);
  return { confirmed: strength >= 0.18, strength, structureLevel };
}

function fairValueGapConfirmation(candles: ReconstructedCandle[], index: number, direction: 'bullish' | 'bearish', context: Context) {
  const previous = candles[index - 1];
  const next = candles[index + 1];
  if (!previous || !next) return { confirmed: false, score: 0, geometry: {} };
  const gap = direction === 'bullish' ? next.lowPrice - previous.highPrice : previous.lowPrice - next.highPrice;
  const score = clamp(gap / Math.max(0.0001, context.atr), 0, 1);
  return {
    confirmed: gap > context.atr * 0.08,
    score,
    geometry: direction === 'bullish'
      ? { low: previous.highPrice, high: next.lowPrice }
      : { low: next.highPrice, high: previous.lowPrice },
  };
}

function mitigationStatus(candles: ReconstructedCandle[], originIndex: number, low: number, high: number, direction: 'bullish' | 'bearish', invalidation: number) {
  let percentage = 0;
  let invalidated = false;
  for (const candle of candles.filter((item) => item.candleIndex > originIndex)) {
    const touched = candle.lowPrice <= high && candle.highPrice >= low;
    if (!touched) continue;
    const penetration = direction === 'bullish'
      ? (high - Math.max(candle.lowPrice, low)) / Math.max(0.0001, high - low)
      : (Math.min(candle.highPrice, high) - low) / Math.max(0.0001, high - low);
    percentage = Math.max(percentage, clamp(penetration, 0, 1));
    if (direction === 'bullish' && candle.closePrice < invalidation) invalidated = true;
    if (direction === 'bearish' && candle.closePrice > invalidation) invalidated = true;
  }
  const status = invalidated ? 'invalidated' : percentage >= 0.86 ? 'full_mitigation' : percentage > 0 ? 'partial_mitigation' : 'fresh';
  return { status: status as OrderBlockDetection['mitigationStatus'], percentage };
}

function buildMitigationEvents(block: OrderBlockDetection, candles: ReconstructedCandle[], fallbackId: string): OrderBlockMitigationEvent[] {
  const events: OrderBlockMitigationEvent[] = [];
  for (const candle of candles.filter((item) => item.candleIndex > block.originCandleIndex)) {
    const touched = candle.lowPrice <= block.zoneHigh && candle.highPrice >= block.zoneLow;
    if (!touched) continue;
    const penetration = block.blockType === 'bullish'
      ? (block.zoneHigh - Math.max(candle.lowPrice, block.zoneLow)) / Math.max(0.0001, block.zoneHigh - block.zoneLow)
      : (Math.min(candle.highPrice, block.zoneHigh) - block.zoneLow) / Math.max(0.0001, block.zoneHigh - block.zoneLow);
    const invalidated = block.blockType === 'bullish' ? candle.closePrice < block.invalidationLevel : candle.closePrice > block.invalidationLevel;
    const reactionScore = wickRejection(candle, block.blockType);
    events.push({
      orderBlockId: fallbackId,
      candleIndex: candle.candleIndex,
      mitigationType: invalidated ? 'invalidation' : penetration >= 0.86 ? 'full_mitigation' : 'partial_mitigation',
      penetrationPercentage: clamp(penetration, 0, 1),
      reactionScore,
      invalidated,
      explanationText: `Order block ${invalidated ? 'invalidated' : 'mitigated'} at candle ${candle.candleIndex} with ${percent(clamp(penetration, 0, 1))} penetration and ${percent(reactionScore)} reaction.`,
      metadata: { closePrice: candle.closePrice },
    });
    if (invalidated || penetration >= 0.86) break;
  }
  return events;
}

function liquidityProximity(origin: ReconstructedCandle, candles: ReconstructedCandle[], context: Context): number {
  const nearbyHighs = candles.filter((candle) => Math.abs(candle.highPrice - origin.highPrice) <= context.atr * 0.42).length;
  const nearbyLows = candles.filter((candle) => Math.abs(candle.lowPrice - origin.lowPrice) <= context.atr * 0.42).length;
  return clamp(Math.max(nearbyHighs, nearbyLows) / 5, 0, 1);
}

function higherTimeframeAlignment(direction: 'bullish' | 'bearish', candles: ReconstructedCandle[]): number {
  const first = candles[0];
  const last = candles.at(-1)!;
  const trend = last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'range';
  return trend === direction ? 0.82 : trend === 'range' ? 0.55 : 0.32;
}

function wickRejection(candle: ReconstructedCandle, direction: 'bullish' | 'bearish'): number {
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  const upper = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lower = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  return clamp((direction === 'bullish' ? lower : upper) / range * 1.25, 0, 1);
}

function relevanceFor(direction: string, quality: number, status: string, fvg: boolean, liquidity: number): string {
  if (status === 'invalidated') return 'Invalidated institutional footprint; avoid using this block for entries.';
  if (quality >= 0.76 && fvg && liquidity >= 0.45) return `High-relevance ${direction} order block with displacement, BOS, imbalance, and nearby liquidity.`;
  if (status === 'fresh') return `Fresh ${direction} order block awaiting first mitigation reaction.`;
  if (status === 'partial_mitigation') return `Partially mitigated ${direction} order block; reaction quality decides whether it remains valid.`;
  return `${direction} order block is lower priority after full mitigation.`;
}

function actionFor(direction: 'bullish' | 'bearish', quality: number, status: string): OrderBlockDetection['recommendedAction'] {
  if (status === 'invalidated' || quality < 0.48) return 'AVOID';
  if (status === 'full_mitigation') return 'WAIT';
  if (quality < 0.62) return 'WAIT';
  return direction === 'bullish' ? 'BUY' : 'SELL';
}

function explainBlock(direction: string, origin: number, low: number, high: number, quality: number, bos: number, fvg: number, status: string, relevance: string): string {
  return `${direction} order block from candle ${origin} spans ${round(low)}-${round(high)} with ${percent(quality)} quality, ${percent(bos)} BOS strength, ${percent(fvg)} FVG score, and ${status} status. ${relevance}`;
}

function dedupeBlocks(blocks: OrderBlockDetection[]): OrderBlockDetection[] {
  const accepted: OrderBlockDetection[] = [];
  for (const block of blocks.sort((a, b) => b.qualityScore - a.qualityScore)) {
    const duplicate = accepted.some((item) => item.blockType === block.blockType && Math.abs(item.originCandleIndex - block.originCandleIndex) <= 2);
    if (!duplicate) accepted.push(block);
  }
  return accepted;
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  return { atr };
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
