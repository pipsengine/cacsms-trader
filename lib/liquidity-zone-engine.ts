import { normalizeInputCandles } from './candle-detection-engine';
import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export interface LiquidityZoneDetection {
  id?: string;
  chartCaptureId?: string;
  liquidityType: string;
  liquiditySide: 'buy_side' | 'sell_side';
  zoneLow: number;
  zoneHigh: number;
  priceLevel: number;
  equalLevelCount: number;
  stopClusterScore: number;
  obviousRetailScore: number;
  sweepStatus: string;
  sweepQualityScore: number;
  inducementScore: number;
  manipulationScore: number;
  trapProbability: number;
  volatilityExpansionScore: number;
  sessionTimingScore: number;
  institutionalNarrative: string;
  recommendedAction: 'BUY' | 'SELL' | 'WAIT' | 'AVOID';
  confidenceScore: number;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface LiquiditySweepEvent {
  id?: string;
  liquidityZoneId?: string;
  chartCaptureId?: string;
  candleIndex: number;
  sweepDirection: 'buy_side_sweep' | 'sell_side_sweep';
  sweptPriceLevel: number;
  wickRejectionScore: number;
  closeFailureScore: number;
  displacementReversalScore: number;
  sweepQualityScore: number;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface LiquidityVoidDetection {
  id?: string;
  chartCaptureId?: string;
  voidDirection: 'bullish_void' | 'bearish_void';
  startCandleIndex: number;
  endCandleIndex: number;
  zoneLow: number;
  zoneHigh: number;
  inefficiencyScore: number;
  rebalanceProbability: number;
  displacementScore: number;
  explanationText: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface LiquidityAnalysisResult {
  liquidityZones: LiquidityZoneDetection[];
  sweeps: LiquiditySweepEvent[];
  voids: LiquidityVoidDetection[];
  summary: {
    dominantLiquidity: string;
    institutionalBias: string;
    recommendedAction: string;
    confidence: number;
    explanation: string;
  };
}

interface LevelPoint {
  candleIndex: number;
  price: number;
  side: 'buy_side' | 'sell_side';
  x: number;
  y: number;
}

type Context = ReturnType<typeof buildContext>;

export function normalizeLiquidityInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  return normalizeInputCandles(input);
}

export function analyzeLiquidityZones(candles: ReconstructedCandle[]): LiquidityAnalysisResult {
  if (candles.length < 8) {
    return {
      liquidityZones: [],
      sweeps: [],
      voids: [],
      summary: {
        dominantLiquidity: 'insufficient_data',
        institutionalBias: 'WAIT',
        recommendedAction: 'WAIT',
        confidence: 0,
        explanation: 'At least eight reconstructed candles are required for liquidity surveillance.',
      },
    };
  }

  const context = buildContext(candles);
  const clusters = clusterEqualLevels(extractLevels(candles), context);
  const zones = clusters
    .map((cluster) => scoreLiquidityCluster(cluster, candles, context))
    .filter((zone) => zone.confidenceScore >= 0.34)
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .slice(0, 10);
  const sweeps = zones.flatMap((zone, index) => detectSweeps(zone, candles, context, `zone-${index}`));
  const voids = detectLiquidityVoids(candles, context);
  const dominant = zones[0];
  return {
    liquidityZones: zones,
    sweeps,
    voids,
    summary: {
      dominantLiquidity: dominant ? `${dominant.liquiditySide} ${dominant.priceLevel}` : 'none',
      institutionalBias: dominant?.institutionalNarrative ?? 'WAIT',
      recommendedAction: dominant?.recommendedAction ?? 'WAIT',
      confidence: dominant?.confidenceScore ?? 0,
      explanation: dominant?.institutionalNarrative ?? 'No high-confidence liquidity zones were detected.',
    },
  };
}

function extractLevels(candles: ReconstructedCandle[]): LevelPoint[] {
  const points: LevelPoint[] = [];
  for (let i = 1; i < candles.length - 1; i += 1) {
    const candle = candles[i];
    if (candle.highPrice >= candles[i - 1].highPrice && candle.highPrice >= candles[i + 1].highPrice) {
      points.push({ candleIndex: candle.candleIndex, price: candle.highPrice, side: 'buy_side', x: candle.pixelX, y: candle.pixelYHigh });
    }
    if (candle.lowPrice <= candles[i - 1].lowPrice && candle.lowPrice <= candles[i + 1].lowPrice) {
      points.push({ candleIndex: candle.candleIndex, price: candle.lowPrice, side: 'sell_side', x: candle.pixelX, y: candle.pixelYLow });
    }
  }
  return points;
}

function clusterEqualLevels(points: LevelPoint[], context: Context): LevelPoint[][] {
  const clusters: LevelPoint[][] = [];
  const tolerance = context.atr * 0.42;
  for (const side of ['buy_side', 'sell_side'] as const) {
    const sorted = points.filter((point) => point.side === side).sort((a, b) => a.price - b.price);
    for (const point of sorted) {
      const last = clusters.at(-1);
      if (!last || last[0].side !== side || Math.abs(average(last.map((item) => item.price)) - point.price) > tolerance) clusters.push([point]);
      else last.push(point);
    }
  }
  return clusters.filter((cluster) => cluster.length >= 2);
}

function scoreLiquidityCluster(cluster: LevelPoint[], candles: ReconstructedCandle[], context: Context): LiquidityZoneDetection {
  const price = average(cluster.map((point) => point.price));
  const width = Math.max(context.atr * 0.28, standardDeviation(cluster.map((point) => point.price)) * 1.4);
  const side = cluster[0].side;
  const zoneLow = price - width / 2;
  const zoneHigh = price + width / 2;
  const equalLevelCount = cluster.length;
  const obviousRetailScore = clamp(equalLevelCount / 4 * 0.42 + psychologicalScore(price, context) * 0.28 + recencyScore(cluster, candles.length) * 0.3, 0, 1);
  const stopClusterScore = clamp(equalLevelCount / 5 * 0.46 + obviousRetailScore * 0.34 + context.compressionScore * 0.2, 0, 1);
  const sweep = bestSweepForLevel(side, price, candles, context);
  const inducementScore = inducementScoreFor(side, price, candles, context);
  const manipulationScore = clamp(
    obviousRetailScore * 0.24
    + sweep.wickRejectionScore * 0.22
    + sweep.closeFailureScore * 0.2
    + sweep.displacementReversalScore * 0.16
    + context.sessionTimingScore * 0.08
    + context.volatilityExpansionScore * 0.1,
    0,
    0.98,
  );
  const trapProbability = clamp(manipulationScore * 0.58 + inducementScore * 0.22 + stopClusterScore * 0.2, 0, 0.97);
  const confidenceScore = clamp(stopClusterScore * 0.24 + obviousRetailScore * 0.18 + sweep.sweepQualityScore * 0.2 + manipulationScore * 0.18 + inducementScore * 0.1 + recencyScore(cluster, candles.length) * 0.1, 0, 0.98);
  const sweepStatus = sweep.sweepQualityScore >= 0.62 ? 'swept_and_rejected' : sweep.sweepQualityScore >= 0.36 ? 'sweep_watch' : 'unswept_resting_liquidity';
  return {
    liquidityType: equalLevelCount >= 3 ? 'equal_high_low_stop_pool' : 'technical_liquidity_cluster',
    liquiditySide: side,
    zoneLow: round(zoneLow),
    zoneHigh: round(zoneHigh),
    priceLevel: round(price),
    equalLevelCount,
    stopClusterScore,
    obviousRetailScore,
    sweepStatus,
    sweepQualityScore: sweep.sweepQualityScore,
    inducementScore,
    manipulationScore,
    trapProbability,
    volatilityExpansionScore: context.volatilityExpansionScore,
    sessionTimingScore: context.sessionTimingScore,
    institutionalNarrative: narrativeFor(side, price, sweepStatus, manipulationScore, trapProbability),
    recommendedAction: actionFor(side, sweepStatus, manipulationScore, trapProbability),
    confidenceScore,
    geometry: {
      zone: { low: round(zoneLow), high: round(zoneHigh), midpoint: round(price) },
      equalLevels: cluster.map((point) => ({ candleIndex: point.candleIndex, price: point.price, x: point.x, y: point.y })),
      sweep: sweep.geometry,
    },
    metadata: {
      tolerance: context.atr * 0.42,
      stopClusterEstimation: true,
      manipulationModel: 'retail_obviousness_sweep_failure_reversal_session_volatility',
    },
  };
}

function detectSweeps(zone: LiquidityZoneDetection, candles: ReconstructedCandle[], context: Context, fallbackId: string): LiquiditySweepEvent[] {
  const sweep = bestSweepForLevel(zone.liquiditySide, zone.priceLevel, candles, context);
  if (sweep.sweepQualityScore < 0.34 || sweep.candleIndex == null) return [];
  return [{
    liquidityZoneId: fallbackId,
    candleIndex: sweep.candleIndex,
    sweepDirection: zone.liquiditySide === 'buy_side' ? 'buy_side_sweep' : 'sell_side_sweep',
    sweptPriceLevel: zone.priceLevel,
    wickRejectionScore: sweep.wickRejectionScore,
    closeFailureScore: sweep.closeFailureScore,
    displacementReversalScore: sweep.displacementReversalScore,
    sweepQualityScore: sweep.sweepQualityScore,
    explanationText: `${zone.liquiditySide} sweep at candle ${sweep.candleIndex} has ${percent(sweep.sweepQualityScore)} quality, ${percent(sweep.wickRejectionScore)} wick rejection, and ${percent(sweep.closeFailureScore)} close-failure validation.`,
    metadata: { zoneLow: zone.zoneLow, zoneHigh: zone.zoneHigh },
  }];
}

function bestSweepForLevel(side: 'buy_side' | 'sell_side', level: number, candles: ReconstructedCandle[], context: Context) {
  let best = { candleIndex: null as number | null, wickRejectionScore: 0, closeFailureScore: 0, displacementReversalScore: 0, sweepQualityScore: 0, geometry: {} as Record<string, unknown> };
  for (let i = 1; i < candles.length - 1; i += 1) {
    const candle = candles[i];
    const swept = side === 'buy_side' ? candle.highPrice > level + context.atr * 0.12 : candle.lowPrice < level - context.atr * 0.12;
    if (!swept) continue;
    const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
    const wick = side === 'buy_side' ? candle.highPrice - Math.max(candle.openPrice, candle.closePrice) : Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
    const wickRejectionScore = clamp(wick / range * 1.35, 0, 1);
    const closeFailureScore = side === 'buy_side' ? clamp((level - candle.closePrice) / Math.max(0.0001, context.atr), 0, 1) : clamp((candle.closePrice - level) / Math.max(0.0001, context.atr), 0, 1);
    const next = candles[i + 1];
    const reversal = side === 'buy_side' ? candle.closePrice - next.closePrice : next.closePrice - candle.closePrice;
    const displacementReversalScore = clamp(reversal / Math.max(0.0001, context.atr), 0, 1);
    const sweepQualityScore = clamp(wickRejectionScore * 0.34 + closeFailureScore * 0.34 + displacementReversalScore * 0.22 + context.volatilityExpansionScore * 0.1, 0, 1);
    if (sweepQualityScore > best.sweepQualityScore) {
      best = {
        candleIndex: candle.candleIndex,
        wickRejectionScore,
        closeFailureScore,
        displacementReversalScore,
        sweepQualityScore,
        geometry: { x: candle.pixelX, highY: candle.pixelYHigh, lowY: candle.pixelYLow, level },
      };
    }
  }
  return best;
}

function inducementScoreFor(side: 'buy_side' | 'sell_side', level: number, candles: ReconstructedCandle[], context: Context): number {
  const before = candles.filter((candle) => side === 'buy_side' ? candle.highPrice < level : candle.lowPrice > level).slice(-10);
  if (before.length < 3) return 0;
  const minor = before.filter((candle) => Math.abs((side === 'buy_side' ? candle.highPrice : candle.lowPrice) - level) <= context.atr * 1.4).length;
  return clamp(minor / 5, 0, 1);
}

function detectLiquidityVoids(candles: ReconstructedCandle[], context: Context): LiquidityVoidDetection[] {
  const voids: LiquidityVoidDetection[] = [];
  for (let i = 1; i < candles.length - 1; i += 1) {
    const candle = candles[i];
    const body = Math.abs(candle.closePrice - candle.openPrice);
    const displacementScore = clamp(body / Math.max(0.0001, context.atr * 1.35), 0, 1);
    if (displacementScore < 0.58) continue;
    const direction = candle.closePrice > candle.openPrice ? 'bullish_void' : 'bearish_void';
    const previous = candles[i - 1];
    const next = candles[i + 1];
    const gap = direction === 'bullish_void' ? next.lowPrice - previous.highPrice : previous.lowPrice - next.highPrice;
    const inefficiencyScore = clamp(Math.max(0, gap) / Math.max(0.0001, context.atr) * 0.55 + displacementScore * 0.45, 0, 1);
    if (inefficiencyScore < 0.46) continue;
    const low = direction === 'bullish_void' ? previous.highPrice : next.highPrice;
    const high = direction === 'bullish_void' ? next.lowPrice : previous.lowPrice;
    voids.push({
      voidDirection: direction,
      startCandleIndex: previous.candleIndex,
      endCandleIndex: next.candleIndex,
      zoneLow: round(Math.min(low, high)),
      zoneHigh: round(Math.max(low, high)),
      inefficiencyScore,
      rebalanceProbability: clamp(inefficiencyScore * 0.52 + context.compressionScore * 0.18 + (1 - context.volatilityExpansionScore) * 0.12, 0, 0.94),
      displacementScore,
      explanationText: `${direction} detected from candle ${previous.candleIndex} to ${next.candleIndex} with ${percent(inefficiencyScore)} inefficiency and likely rebalance interest.`,
      geometry: { startX: previous.pixelX, endX: next.pixelX, low: Math.min(low, high), high: Math.max(low, high) },
      metadata: { gap, atr: context.atr },
    });
  }
  return voids.sort((a, b) => b.inefficiencyScore - a.inefficiencyScore).slice(0, 8);
}

function narrativeFor(side: string, price: number, status: string, manipulation: number, trap: number): string {
  if (status === 'swept_and_rejected') return `Price appears to have collected ${side} liquidity near ${round(price)} and rejected back inside the range; manipulation probability is ${percent(manipulation)} with ${percent(trap)} trap risk.`;
  if (trap >= 0.68) return `Visible ${side} liquidity near ${round(price)} is likely being used as trader bait before displacement.`;
  return `${side} liquidity near ${round(price)} remains a likely draw on price until swept or displaced through cleanly.`;
}

function actionFor(side: 'buy_side' | 'sell_side', status: string, manipulation: number, trap: number): LiquidityZoneDetection['recommendedAction'] {
  if (trap >= 0.78) return 'AVOID';
  if (status !== 'swept_and_rejected') return 'WAIT';
  if (manipulation < 0.52) return 'WAIT';
  return side === 'buy_side' ? 'SELL' : 'BUY';
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recentRange = average(ranges.slice(-8));
  const baselineRange = average(ranges);
  const latestIndex = candles.at(-1)?.candleIndex ?? candles.length - 1;
  return {
    atr,
    compressionScore: clamp(1 - recentRange / Math.max(0.0001, atr * 1.25), 0, 1),
    volatilityExpansionScore: clamp(recentRange / Math.max(0.0001, baselineRange * 1.25), 0, 1),
    sessionTimingScore: [7, 8, 9, 13, 14, 15].includes(latestIndex % 24) ? 0.74 : 0.42,
    priceMagnitude: Math.max(...candles.map((candle) => candle.highPrice)),
    displacementScore: clamp(Math.max(...bodies.slice(-8)) / Math.max(0.0001, atr), 0, 1),
  };
}

function psychologicalScore(price: number, context: Context): number {
  const step = context.priceMagnitude >= 1000 ? 50 : context.priceMagnitude >= 100 ? 5 : context.priceMagnitude >= 1 ? 0.005 : 0.0005;
  const nearest = Math.abs(price / step - Math.round(price / step)) * step;
  return clamp(1 - nearest / Math.max(0.0001, step * 0.12), 0, 1);
}

function recencyScore(cluster: LevelPoint[], length: number): number {
  return clamp(Math.max(...cluster.map((point) => point.candleIndex)) / Math.max(1, length - 1), 0, 1);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
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
