import { normalizeInputCandles } from './candle-detection-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface SupportResistanceZone {
  id?: string;
  chartCaptureId?: string;
  zoneType: 'support' | 'resistance' | 'dynamic' | 'psychological';
  zoneLow: number;
  zoneHigh: number;
  midpointPrice: number;
  touchCount: number;
  weightedTouchScore: number;
  freshnessScore: number;
  wickRejectionScore: number;
  breakProbability: number;
  retestProbability: number;
  liquidityAttractionScore: number;
  psychologicalScore: number;
  institutionalDefenseScore: number;
  strengthScore: number;
  brokenRole: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  aiExplanation: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface SupportResistanceLiquidity {
  id?: string;
  zoneId?: string;
  chartCaptureId?: string;
  liquiditySide: 'buy_side' | 'sell_side';
  priceLevel: number;
  stopPoolScore: number;
  attractionScore: number;
  sweepProbability: number;
  reversalProbability: number;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface SupportResistanceAnalysisResult {
  zones: SupportResistanceZone[];
  liquidity: SupportResistanceLiquidity[];
  summary: {
    dominantZone: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
}

interface ReactionPoint {
  candleIndex: number;
  price: number;
  kind: 'high' | 'low' | 'close';
  pixelX: number;
  pixelY: number;
  weight: number;
}

type Context = ReturnType<typeof buildContext>;

export function normalizeSupportResistanceInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeSupportResistance(candles: ReconstructedCandle[]): SupportResistanceAnalysisResult {
  if (candles.length < 8) {
    return {
      zones: [],
      liquidity: [],
      summary: {
        dominantZone: 'insufficient_data',
        institutionalBias: 'WAIT',
        recommendedAction: 'WAIT',
        confidence: 0,
        explanation: 'At least eight reconstructed candles are required for support and resistance mapping.',
      },
    };
  }

  const context = buildContext(candles);
  const reactionPoints = extractReactionPoints(candles, context);
  const clustered = clusterReactionPoints(reactionPoints, context);
  const psychological = buildPsychologicalZones(candles, context);
  const zones = dedupeZones([...clustered.map((cluster) => scoreCluster(cluster, candles, context)), ...psychological])
    .filter((zone) => zone.strengthScore >= 0.34)
    .sort((a, b) => b.strengthScore - a.strengthScore)
    .slice(0, 10);
  const liquidity = zones.flatMap((zone, index) => buildLiquidity(zone, candles, context, `zone-${index}`));
  const dominant = zones[0];

  return {
    zones,
    liquidity,
    summary: {
      dominantZone: dominant ? `${dominant.zoneType} ${dominant.zoneLow}-${dominant.zoneHigh}` : 'none',
      institutionalBias: dominant?.aiExplanation ?? 'WAIT',
      recommendedAction: dominant?.recommendedAction ?? 'WAIT',
      confidence: dominant?.strengthScore ?? 0,
      explanation: dominant
        ? dominant.aiExplanation
        : 'No institutional-quality support or resistance zones were detected.',
    },
  };
}

function extractReactionPoints(candles: ReconstructedCandle[], context: Context): ReactionPoint[] {
  const points: ReactionPoint[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles.slice(Math.max(0, index - 2), index);
    const next = candles.slice(index + 1, Math.min(candles.length, index + 3));
    const isReactionHigh = previous.every((item) => candle.highPrice >= item.highPrice) && next.every((item) => candle.highPrice >= item.highPrice);
    const isReactionLow = previous.every((item) => candle.lowPrice <= item.lowPrice) && next.every((item) => candle.lowPrice <= item.lowPrice);
    const body = Math.abs(candle.closePrice - candle.openPrice);
    const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
    const rejectionWeight = clamp((1 - body / range) * 0.5 + Math.min(range / Math.max(0.0001, context.atr), 1) * 0.5, 0.1, 1);
    if (isReactionHigh) points.push({ candleIndex: candle.candleIndex, price: candle.highPrice, kind: 'high', pixelX: candle.pixelX, pixelY: candle.pixelYHigh, weight: rejectionWeight });
    if (isReactionLow) points.push({ candleIndex: candle.candleIndex, price: candle.lowPrice, kind: 'low', pixelX: candle.pixelX, pixelY: candle.pixelYLow, weight: rejectionWeight });
    points.push({ candleIndex: candle.candleIndex, price: candle.closePrice, kind: 'close', pixelX: candle.pixelX, pixelY: candle.pixelYClose, weight: 0.28 });
  }
  return points;
}

function clusterReactionPoints(points: ReactionPoint[], context: Context): ReactionPoint[][] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: ReactionPoint[][] = [];
  const eps = context.atr * 0.55;
  for (const point of sorted) {
    const last = clusters.at(-1);
    if (!last || Math.abs(weightedMidpoint(last) - point.price) > eps) {
      clusters.push([point]);
    } else {
      last.push(point);
    }
  }
  return clusters.filter((cluster) => cluster.length >= 3);
}

function scoreCluster(cluster: ReactionPoint[], candles: ReconstructedCandle[], context: Context): SupportResistanceZone {
  const midpoint = weightedMidpoint(cluster);
  const width = Math.max(context.atr * 0.36, standardDeviation(cluster.map((point) => point.price)) * 1.35);
  const zoneLow = midpoint - width / 2;
  const zoneHigh = midpoint + width / 2;
  const latest = candles.at(-1)!;
  const zoneType = midpoint <= latest.closePrice ? 'support' : 'resistance';
  const reactions = candles.filter((candle) => touchesZone(candle, zoneLow, zoneHigh));
  const recentWeighted = reactions.reduce((sum, candle) => sum + recencyWeight(candle.candleIndex, candles.length), 0);
  const freshnessScore = clamp(Math.max(...reactions.map((candle) => recencyWeight(candle.candleIndex, candles.length)), 0), 0, 1);
  const wickRejectionScore = clamp(average(reactions.map((candle) => wickRejectionFromZone(candle, zoneLow, zoneHigh, zoneType))), 0, 1);
  const breakRetest = breakRetestAnalysis(candles, zoneLow, zoneHigh, zoneType, context);
  const psychologicalScore = psychologicalScoreFor(midpoint, context);
  const overusePenalty = reactions.length > 7 ? Math.min(0.2, (reactions.length - 7) * 0.025) : 0;
  const liquidityAttractionScore = liquidityAttraction(zoneType, midpoint, candles, context);
  const institutionalDefenseScore = clamp(wickRejectionScore * 0.36 + context.displacementScore * 0.22 + breakRetest.retestProbability * 0.18 + freshnessScore * 0.14 + psychologicalScore * 0.1, 0, 1);
  const strengthScore = clamp(recentWeighted / 5 * 0.26 + wickRejectionScore * 0.22 + freshnessScore * 0.16 + institutionalDefenseScore * 0.22 + psychologicalScore * 0.08 - overusePenalty, 0, 0.98);

  return {
    zoneType,
    zoneLow: round(zoneLow),
    zoneHigh: round(zoneHigh),
    midpointPrice: round(midpoint),
    touchCount: reactions.length,
    weightedTouchScore: clamp(recentWeighted / 5, 0, 1),
    freshnessScore,
    wickRejectionScore,
    breakProbability: breakRetest.breakProbability,
    retestProbability: breakRetest.retestProbability,
    liquidityAttractionScore,
    psychologicalScore,
    institutionalDefenseScore,
    strengthScore,
    brokenRole: breakRetest.brokenRole,
    recommendedAction: actionFor(zoneType, breakRetest.breakProbability, liquidityAttractionScore, institutionalDefenseScore),
    aiExplanation: explainZone(zoneType, midpoint, strengthScore, reactions.length, wickRejectionScore, liquidityAttractionScore, institutionalDefenseScore, breakRetest.brokenRole),
    geometry: {
      zone: { low: round(zoneLow), high: round(zoneHigh), midpoint: round(midpoint) },
      reactions: reactions.map((candle) => ({ candleIndex: candle.candleIndex, x: candle.pixelX, highY: candle.pixelYHigh, lowY: candle.pixelYLow })),
    },
    metadata: {
      clustering: 'dbscan_price_reaction_cluster',
      clusterSize: cluster.length,
      overusePenalty,
      breakRetest,
    },
  };
}

function buildPsychologicalZones(candles: ReconstructedCandle[], context: Context): SupportResistanceZone[] {
  const latest = candles.at(-1)!;
  const step = psychologicalStep(context);
  const levels = [-2, -1, 0, 1, 2].map((offset) => Math.round(latest.closePrice / step) * step + offset * step * 0.5);
  return levels.map((level) => {
    const width = Math.max(context.atr * 0.28, step * 0.03);
    const zoneLow = level - width / 2;
    const zoneHigh = level + width / 2;
    const zoneType = level <= latest.closePrice ? 'support' : 'resistance';
    const reactions = candles.filter((candle) => touchesZone(candle, zoneLow, zoneHigh));
    const psych = psychologicalScoreFor(level, context);
    const wick = average(reactions.map((candle) => wickRejectionFromZone(candle, zoneLow, zoneHigh, zoneType)));
    const liquidity = liquidityAttraction(zoneType, level, candles, context);
    const strength = clamp(psych * 0.34 + reactions.length / 5 * 0.22 + wick * 0.22 + liquidity * 0.12 + recencyWeight(reactions.at(-1)?.candleIndex ?? 0, candles.length) * 0.1, 0, 0.9);
    return {
      zoneType: 'psychological' as const,
      zoneLow: round(zoneLow),
      zoneHigh: round(zoneHigh),
      midpointPrice: round(level),
      touchCount: reactions.length,
      weightedTouchScore: clamp(reactions.length / 5, 0, 1),
      freshnessScore: recencyWeight(reactions.at(-1)?.candleIndex ?? 0, candles.length),
      wickRejectionScore: clamp(wick, 0, 1),
      breakProbability: clamp(0.34 + liquidity * 0.24 + context.displacementScore * 0.2, 0, 0.9),
      retestProbability: clamp(0.3 + psych * 0.32 + reactions.length / 8 * 0.2, 0, 0.88),
      liquidityAttractionScore: liquidity,
      psychologicalScore: psych,
      institutionalDefenseScore: clamp(wick * 0.36 + psych * 0.32 + reactions.length / 8 * 0.2, 0, 1),
      strengthScore: strength,
      brokenRole: 'psychological_reference',
      recommendedAction: 'WAIT',
      aiExplanation: `Psychological ${zoneType} zone around ${round(level)} with ${reactions.length} reactions and ${percent(liquidity)} liquidity attraction.`,
      geometry: { zone: { low: round(zoneLow), high: round(zoneHigh), midpoint: round(level) } },
      metadata: { detection: 'round_half_quarter_level', step },
    };
  });
}

function buildLiquidity(zone: SupportResistanceZone, candles: ReconstructedCandle[], context: Context, fallbackId: string): SupportResistanceLiquidity[] {
  const side = zone.zoneType === 'support' ? 'sell_side' : 'buy_side';
  const priceLevel = side === 'buy_side' ? zone.zoneHigh + context.atr * 0.35 : zone.zoneLow - context.atr * 0.35;
  const equalLevelScore = equalSideScore(candles.map((candle) => side === 'buy_side' ? candle.highPrice : candle.lowPrice), priceLevel, context.atr);
  const stopPoolScore = clamp(equalLevelScore * 0.44 + zone.touchCount / 8 * 0.26 + zone.psychologicalScore * 0.12 + zone.freshnessScore * 0.18, 0, 1);
  const sweepProbability = clamp(stopPoolScore * 0.48 + zone.liquidityAttractionScore * 0.32 + context.displacementScore * 0.2, 0, 0.96);
  const reversalProbability = clamp(zone.institutionalDefenseScore * 0.45 + zone.wickRejectionScore * 0.28 + sweepProbability * 0.14, 0, 0.94);
  return [{
    zoneId: fallbackId,
    liquiditySide: side,
    priceLevel: round(priceLevel),
    stopPoolScore,
    attractionScore: zone.liquidityAttractionScore,
    sweepProbability,
    reversalProbability,
    explanationText: `${side} liquidity near ${round(priceLevel)} has ${percent(stopPoolScore)} stop-pool score and ${percent(sweepProbability)} sweep probability.`,
    metadata: { zoneType: zone.zoneType, zoneMidpoint: zone.midpointPrice },
  }];
}

function breakRetestAnalysis(candles: ReconstructedCandle[], low: number, high: number, zoneType: string, context: Context) {
  let brokenRole = 'holding';
  let breaks = 0;
  let retests = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1];
    const candle = candles[i];
    if (previous.closePrice >= low && previous.closePrice <= high) continue;
    const brokeDown = previous.closePrice > high && candle.closePrice < low;
    const brokeUp = previous.closePrice < low && candle.closePrice > high;
    if (brokeDown || brokeUp) {
      breaks += 1;
      brokenRole = brokeDown ? 'broken_support_now_resistance' : 'broken_resistance_now_support';
    }
    if (breaks > 0 && touchesZone(candle, low, high)) retests += 1;
  }
  return {
    brokenRole,
    breakProbability: clamp(breaks / 3 * 0.34 + context.displacementScore * 0.28 + (zoneType === 'psychological' ? 0.1 : 0), 0, 0.94),
    retestProbability: clamp(retests / 3 * 0.44 + breaks / 4 * 0.2 + context.compressionScore * 0.18, 0, 0.92),
  };
}

function liquidityAttraction(zoneType: string, midpoint: number, candles: ReconstructedCandle[], context: Context): number {
  const latest = candles.at(-1)!;
  const distance = Math.abs(latest.closePrice - midpoint);
  const proximity = clamp(1 - distance / Math.max(0.0001, context.atr * 5), 0, 1);
  const highsLows = candles.slice(-14).map((candle) => zoneType === 'support' ? candle.lowPrice : candle.highPrice);
  return clamp(proximity * 0.36 + equalSideScore(highsLows, midpoint, context.atr) * 0.36 + context.compressionScore * 0.16 + psychologicalScoreFor(midpoint, context) * 0.12, 0, 1);
}

function wickRejectionFromZone(candle: ReconstructedCandle, low: number, high: number, zoneType: string): number {
  if (!touchesZone(candle, low, high)) return 0;
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  const upper = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lower = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  const wick = zoneType === 'support' ? lower : upper;
  const closeAway = zoneType === 'support' ? candle.closePrice > high : candle.closePrice < low;
  return clamp(wick / range * 0.72 + (closeAway ? 0.28 : 0), 0, 1);
}

function touchesZone(candle: ReconstructedCandle, low: number, high: number): boolean {
  return candle.lowPrice <= high && candle.highPrice >= low;
}

function actionFor(zoneType: string, breakProbability: number, liquidity: number, defense: number): SupportResistanceZone['recommendedAction'] {
  if (liquidity > 0.78 && breakProbability > 0.62) return 'AVOID';
  if (defense < 0.48) return 'WAIT';
  if (zoneType === 'support' && breakProbability < 0.58) return 'BUY';
  if (zoneType === 'resistance' && breakProbability < 0.58) return 'SELL';
  return 'WAIT';
}

function explainZone(type: string, price: number, strength: number, touches: number, rejection: number, liquidity: number, defense: number, role: string): string {
  return `${type} zone around ${round(price)} has ${touches} reactions, ${percent(strength)} strength, ${percent(rejection)} wick rejection, ${percent(liquidity)} liquidity attraction, and ${percent(defense)} institutional defense. Role: ${role}.`;
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
    priceMagnitude: Math.max(...candles.map((candle) => candle.highPrice)),
  };
}

function psychologicalStep(context: Context): number {
  if (context.priceMagnitude >= 1000) return 50;
  if (context.priceMagnitude >= 100) return 5;
  if (context.priceMagnitude >= 10) return 0.5;
  if (context.priceMagnitude >= 1) return 0.005;
  return 0.0005;
}

function psychologicalScoreFor(price: number, context: Context): number {
  const step = psychologicalStep(context);
  const distanceToRound = Math.abs(price / step - Math.round(price / step)) * step;
  const distanceToHalf = Math.abs(price / (step * 0.5) - Math.round(price / (step * 0.5))) * step * 0.5;
  const distanceToQuarter = Math.abs(price / (step * 0.25) - Math.round(price / (step * 0.25))) * step * 0.25;
  const nearest = Math.min(distanceToRound, distanceToHalf, distanceToQuarter);
  return clamp(1 - nearest / Math.max(0.0001, step * 0.12), 0, 1);
}

function weightedMidpoint(points: ReactionPoint[]): number {
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0) || 1;
  return points.reduce((sum, point) => sum + point.price * point.weight, 0) / totalWeight;
}

function equalSideScore(values: number[], level: number, atr: number): number {
  const near = values.filter((value) => Math.abs(value - level) <= atr * 0.4).length;
  return clamp(near / 5, 0, 1);
}

function dedupeZones(zones: SupportResistanceZone[]): SupportResistanceZone[] {
  const sorted = [...zones].sort((a, b) => b.strengthScore - a.strengthScore);
  const accepted: SupportResistanceZone[] = [];
  for (const zone of sorted) {
    const duplicate = accepted.some((item) => Math.abs(item.midpointPrice - zone.midpointPrice) <= Math.max(item.zoneHigh - item.zoneLow, zone.zoneHigh - zone.zoneLow));
    if (!duplicate) accepted.push(zone);
  }
  return accepted;
}

function recencyWeight(candleIndex: number, length: number): number {
  return clamp(0.25 + candleIndex / Math.max(1, length - 1) * 0.75, 0, 1);
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
