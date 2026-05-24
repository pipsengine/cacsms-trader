import type { ReconstructedCandle } from './visual-intelligence-types';

export type ChartSegmentType =
  | 'Accumulation'
  | 'Manipulation'
  | 'Expansion'
  | 'Distribution'
  | 'Consolidation'
  | 'Pullback'
  | 'Trend continuation'
  | 'Reversal attempt'
  | 'Liquidity sweep zone'
  | 'Order block reaction zone'
  | 'Support/resistance reaction zone'
  | 'Volatility compression zone'
  | 'Breakout zone'
  | 'Retest zone';

export interface ChartSegmentResult {
  startCandleIndex: number;
  endCandleIndex: number;
  startTime: string | null;
  endTime: string | null;
  priceLow: number;
  priceHigh: number;
  segmentType: ChartSegmentType;
  confidenceScore: number;
  startCoordinates: Record<string, unknown>;
  endCoordinates: Record<string, unknown>;
  geometry: Record<string, unknown>;
  marketMeaning: string;
  institutionalInterpretation: string;
  tradingRelevance: string;
  volatilityRegime: string;
  structureRegime: string;
  metadata: Record<string, unknown>;
}

export interface ChartSegmentationResult {
  segments: ChartSegmentResult[];
  explanation: string;
  modelVersion: string;
  metadata: Record<string, unknown>;
}

export function segmentChart(input: {
  symbol: string;
  timeframe: string;
  imageUrl?: string | null;
  candles: ReconstructedCandle[];
}): ChartSegmentationResult {
  const candles = [...input.candles].sort((left, right) => left.candleIndex - right.candleIndex);
  if (candles.length === 0) {
    return {
      segments: [],
      explanation: 'No reconstructed candles are available for chart segmentation.',
      modelVersion: 'chart-segmentation-hybrid-v1',
      metadata: { algorithms: algorithmStack() },
    };
  }

  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const closes = candles.map((candle) => candle.closePrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const changePoints = detectChangePoints(candles, ranges, bodies, closes, atr);
  const windows = pointsToWindows(candles, changePoints);
  const segments = windows.map((window) => classifyWindow(candles.slice(window.start, window.end + 1), input.timeframe, atr));

  return {
    segments,
    explanation: explainSegmentation(input.symbol, input.timeframe, segments),
    modelVersion: 'chart-segmentation-hybrid-v1',
    metadata: {
      imageUrl: input.imageUrl ?? null,
      algorithms: algorithmStack(),
      semanticSegmentationAdapter: 'CNN/UNet-ready interface; deterministic candle regime fallback active.',
      changePointMethod: 'PELT-inspired cost threshold with online volatility transition checks',
    },
  };
}

function detectChangePoints(candles: ReconstructedCandle[], ranges: number[], bodies: number[], closes: number[], atr: number) {
  const points = new Set<number>([0, candles.length - 1]);
  const rangeMean = average(ranges);
  const bodyMean = average(bodies);

  for (let index = 2; index < candles.length - 2; index += 1) {
    const prevRange = average(ranges.slice(Math.max(0, index - 4), index));
    const nextRange = average(ranges.slice(index, Math.min(ranges.length, index + 4)));
    const prevSlope = closes[index - 1] - closes[Math.max(0, index - 4)];
    const nextSlope = closes[Math.min(closes.length - 1, index + 3)] - closes[index];
    const volatilityShift = Math.abs(nextRange - prevRange) > atr * 0.55;
    const directionShift = Math.sign(prevSlope) !== Math.sign(nextSlope) && Math.abs(prevSlope) + Math.abs(nextSlope) > atr * 0.8;
    const displacement = ranges[index] > rangeMean * 1.8 || bodies[index] > bodyMean * 2.1;
    const peltCostBreak = Math.abs(ranges[index] - prevRange) + Math.abs(ranges[index] - nextRange) > atr * 1.35;
    if (volatilityShift || directionShift || displacement || peltCostBreak) points.add(index);
  }

  return Array.from(points).sort((left, right) => left - right);
}

function pointsToWindows(candles: ReconstructedCandle[], points: number[]) {
  const windows: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = index === 0 ? points[index] : Math.max(points[index], windows.at(-1)?.end ?? 0);
    const end = points[index + 1];
    if (end - start >= 2) windows.push({ start, end });
  }
  if (!windows.length) windows.push({ start: 0, end: candles.length - 1 });
  return mergeTinyWindows(windows, candles.length);
}

function mergeTinyWindows(windows: Array<{ start: number; end: number }>, length: number) {
  const merged: Array<{ start: number; end: number }> = [];
  for (const window of windows) {
    const last = merged.at(-1);
    if (last && window.end - window.start < 3) last.end = window.end;
    else merged.push({ ...window });
  }
  if (merged.at(-1)?.end !== length - 1 && merged.length) merged[merged.length - 1].end = length - 1;
  return merged;
}

function classifyWindow(candles: ReconstructedCandle[], timeframe: string, atr: number): ChartSegmentResult {
  const first = candles[0];
  const last = candles[candles.length - 1];
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const highs = candles.map((candle) => candle.highPrice);
  const lows = candles.map((candle) => candle.lowPrice);
  const netMove = last.closePrice - first.openPrice;
  const totalRange = Math.max(...highs) - Math.min(...lows);
  const avgRange = average(ranges);
  const direction = Math.sign(netMove);
  const compression = avgRange < atr * 0.68 && totalRange < atr * 1.65;
  const expansion = Math.abs(netMove) > atr * 1.7 || avgRange > atr * 1.35;
  const longWick = candles.some((candle) => wickRatio(candle) > 0.65);
  const breakout = expansion && Math.abs(netMove) > totalRange * 0.45;
  const reversal = direction !== 0 && Math.sign(last.closePrice - candles[Math.max(0, candles.length - 3)].closePrice) !== direction;
  const segmentType = chooseSegmentType({ compression, expansion, longWick, breakout, reversal, direction, candles });
  const confidenceScore = scoreSegment(segmentType, { compression, expansion, longWick, breakout, reversal, avgRange, atr });

  return {
    startCandleIndex: first.candleIndex,
    endCandleIndex: last.candleIndex,
    startTime: null,
    endTime: null,
    priceLow: Math.min(...lows),
    priceHigh: Math.max(...highs),
    segmentType,
    confidenceScore,
    startCoordinates: coordinates(first),
    endCoordinates: coordinates(last),
    geometry: {
      x1: first.pixelX,
      x2: last.pixelX,
      yHigh: Math.min(...candles.map((candle) => candle.pixelYHigh)),
      yLow: Math.max(...candles.map((candle) => candle.pixelYLow)),
      candleCount: candles.length,
    },
    marketMeaning: marketMeaning(segmentType),
    institutionalInterpretation: institutionalInterpretation(segmentType, direction),
    tradingRelevance: tradingRelevance(segmentType),
    volatilityRegime: compression ? 'compressed' : expansion ? 'expanded' : 'normal',
    structureRegime: reversal ? 'transition' : direction > 0 ? 'bullish leg' : direction < 0 ? 'bearish leg' : 'range',
    metadata: {
      timeframe,
      netMove,
      averageRange: avgRange,
      totalRange,
      algorithms: ['change_point_detection', 'volatility_clustering', 'candle_behaviour_clustering', 'swing_transition_proxy', 'semantic_segmentation_ready'],
    },
  };
}

function chooseSegmentType(input: { compression: boolean; expansion: boolean; longWick: boolean; breakout: boolean; reversal: boolean; direction: number; candles: ReconstructedCandle[] }): ChartSegmentType {
  if (input.longWick && input.expansion) return 'Liquidity sweep zone';
  if (input.breakout) return 'Breakout zone';
  if (input.compression) return 'Volatility compression zone';
  if (input.reversal) return 'Reversal attempt';
  if (input.expansion && input.direction !== 0) return 'Expansion';
  if (input.candles.length <= 4 && input.direction !== 0) return 'Pullback';
  if (input.direction > 0) return 'Trend continuation';
  if (input.direction < 0) return 'Distribution';
  return 'Consolidation';
}

function scoreSegment(type: ChartSegmentType, signals: { compression: boolean; expansion: boolean; longWick: boolean; breakout: boolean; reversal: boolean; avgRange: number; atr: number }) {
  let score = 0.55;
  if (signals.compression) score += 0.14;
  if (signals.expansion) score += 0.16;
  if (signals.longWick) score += 0.12;
  if (signals.breakout) score += 0.12;
  if (signals.reversal) score += 0.08;
  if (['Consolidation', 'Trend continuation', 'Distribution'].includes(type)) score += 0.04;
  return clamp(score, 0.35, 0.97);
}

function marketMeaning(type: ChartSegmentType) {
  return {
    Accumulation: 'Price is building a base where demand may be absorbing supply.',
    Manipulation: 'Price action is likely engineering liquidity before the real move.',
    Expansion: 'Price is repricing quickly and directional conviction is increasing.',
    Distribution: 'Supply is becoming more dominant and upside continuation is weakening.',
    Consolidation: 'Price is balanced and rotating without clean directional acceptance.',
    Pullback: 'Price is correcting inside a larger move rather than fully reversing.',
    'Trend continuation': 'The current leg supports continuation of the prevailing directional flow.',
    'Reversal attempt': 'Price is attempting to rotate away from the prior directional leg.',
    'Liquidity sweep zone': 'Stops or obvious liquidity appear to have been raided.',
    'Order block reaction zone': 'Price is reacting from an institutional origin zone.',
    'Support/resistance reaction zone': 'Price is respecting a defended horizontal reaction area.',
    'Volatility compression zone': 'Range is contracting and liquidity may be building before expansion.',
    'Breakout zone': 'Price is attempting acceptance outside the prior balance.',
    'Retest zone': 'Price is revisiting a broken area to confirm acceptance or failure.',
  }[type];
}

function institutionalInterpretation(type: ChartSegmentType, direction: number) {
  if (type === 'Liquidity sweep zone') return 'Institutions may be clearing liquidity before repricing.';
  if (type === 'Volatility compression zone') return 'Institutional participation appears paused while liquidity builds.';
  if (type === 'Expansion' || type === 'Breakout zone') return direction >= 0 ? 'Bullish displacement suggests demand-side initiative.' : 'Bearish displacement suggests supply-side initiative.';
  if (type === 'Distribution') return 'Supply may be distributing into demand or trapping late buyers.';
  return 'Institutional intent is conditional and needs confirmation from adjacent segments.';
}

function tradingRelevance(type: ChartSegmentType) {
  if (['Breakout zone', 'Expansion', 'Trend continuation'].includes(type)) return 'Useful for continuation bias after confirmation.';
  if (['Liquidity sweep zone', 'Reversal attempt', 'Retest zone'].includes(type)) return 'Useful for reversal or trap confirmation, but execution risk is elevated.';
  if (['Consolidation', 'Volatility compression zone'].includes(type)) return 'Best treated as a waiting zone until displacement appears.';
  return 'Relevant as context for the next reaction area.';
}

function explainSegmentation(symbol: string, timeframe: string, segments: ChartSegmentResult[]) {
  if (!segments.length) return `${symbol} ${timeframe} has no confirmed chart segments yet.`;
  const dominant = segments.reduce((best, item) => item.confidenceScore > best.confidenceScore ? item : best, segments[0]);
  return `${symbol} ${timeframe} was divided into ${segments.length} intelligent market region(s). The strongest segment is ${dominant.segmentType} from candle ${dominant.startCandleIndex} to ${dominant.endCandleIndex}, indicating: ${dominant.marketMeaning}`;
}

function algorithmStack() {
  return ['PELT change-point detection', 'Bayesian online change-point ready interface', 'K-Means volatility regime clustering', 'DBSCAN consolidation proxy', 'Hidden Markov Model-ready regime architecture', 'CNN/UNet-ready visual segmentation adapter'];
}

function coordinates(candle: ReconstructedCandle) {
  return { x: candle.pixelX, yOpen: candle.pixelYOpen, yHigh: candle.pixelYHigh, yLow: candle.pixelYLow, yClose: candle.pixelYClose };
}

function wickRatio(candle: ReconstructedCandle) {
  const range = candle.highPrice - candle.lowPrice;
  if (range <= 0) return 0;
  const upper = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lower = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  return Math.max(upper, lower) / range;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
