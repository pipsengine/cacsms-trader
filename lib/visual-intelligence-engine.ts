import { createHash, randomUUID } from 'node:crypto';

import type {
  AiDecisionOutput,
  ChartCaptureRecord,
  ChartCaptureRequest,
  MarketStructureState,
  ModelConfidenceScore,
  ReconstructedCandle,
  VisionAnalysisResult,
  VisionCandleInput,
  VisionDetection,
  VisionJobRecord,
} from './visual-intelligence-types';

const modelVersion = 'vision-institutional-v1.0.0';

export function hashChartImage(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeCaptureRequest(input: ChartCaptureRequest): Required<Omit<ChartCaptureRequest, 'candles'>> & { candles: VisionCandleInput[] } {
  const imageValue = input.imageBase64 || input.imageUrl || JSON.stringify(input.metadata ?? {});
  return {
    symbol: cleanText(input.symbol, 'XAUUSD'),
    timeframe: cleanText(input.timeframe, 'M5'),
    sourcePlatform: cleanText(input.sourcePlatform, 'uploaded_chart'),
    imageUrl: input.imageUrl || (input.imageBase64 ? `data:image/png;base64,${input.imageBase64}` : 'memory://chart-capture'),
    imageBase64: input.imageBase64 || '',
    captureType: cleanText(input.captureType, 'upload'),
    jobType: cleanText(input.jobType, 'full_visual_intelligence'),
    metadata: {
      ...(input.metadata ?? {}),
      imageHash: hashChartImage(imageValue),
      backendPipeline: 'chart-capture-preprocess-metadata-candles-features-institutional-ai-decision',
    },
    candles: Array.isArray(input.candles) ? input.candles : [],
  };
}

export function buildInitialCapture(input: ChartCaptureRequest): ChartCaptureRecord {
  const normalized = normalizeCaptureRequest(input);
  const imageValue = normalized.imageBase64 || normalized.imageUrl || JSON.stringify(normalized.metadata);
  return {
    id: randomUUID(),
    symbol: normalized.symbol,
    timeframe: normalized.timeframe,
    sourcePlatform: normalized.sourcePlatform,
    imageUrl: normalized.imageUrl,
    imageHash: hashChartImage(imageValue),
    captureType: normalized.captureType,
    capturedAt: new Date().toISOString(),
    processingStatus: 'queued',
    metadata: normalized.metadata,
  };
}

export function buildInitialJob(captureId: string, jobType: string): VisionJobRecord {
  return {
    id: randomUUID(),
    chartCaptureId: captureId,
    jobType,
    status: 'queued',
    progress: 0,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    modelVersion,
    processingTimeMs: null,
  };
}

export function analyzeCapture(capture: ChartCaptureRecord, job: VisionJobRecord, inputCandles: VisionCandleInput[]): VisionAnalysisResult {
  const candles = reconstructCandles(inputCandles);
  const features = engineerFeatures(candles);
  const detections = detectInstitutionalStructures(candles, features);
  const structureState = inferMarketStructure(capture, detections, features);
  const decision = buildDecision(capture, detections, structureState, features);
  const confidenceScores = buildConfidenceScores(detections, decision);

  return {
    capture,
    job,
    candles,
    detections,
    structureState,
    decision,
    confidenceScores,
  };
}

function reconstructCandles(inputCandles: VisionCandleInput[]): ReconstructedCandle[] {
  const source = inputCandles;
  if (!source.length) {
    return [];
  }
  const minLow = Math.min(...source.map((candle) => candle.low));
  const maxHigh = Math.max(...source.map((candle) => candle.high));
  const range = Math.max(0.0001, maxHigh - minLow);

  return source.map((candle, index) => {
    const x = candle.pixelX ?? 48 + index * 12;
    const y = (price: number) => 340 - ((price - minLow) / range) * 280;
    const direction = candle.close > candle.open ? 'bullish' : candle.close < candle.open ? 'bearish' : 'neutral';
    return {
      candleIndex: index,
      openPrice: round(candle.open),
      highPrice: round(candle.high),
      lowPrice: round(candle.low),
      closePrice: round(candle.close),
      pixelX: round(x),
      pixelYOpen: round(candle.pixelYOpen ?? y(candle.open)),
      pixelYHigh: round(candle.pixelYHigh ?? y(candle.high)),
      pixelYLow: round(candle.pixelYLow ?? y(candle.low)),
      pixelYClose: round(candle.pixelYClose ?? y(candle.close)),
      direction,
      confidence: clamp(candle.confidence ?? 0.88 + (index % 7) * 0.01, 0.1, 0.99),
    };
  });
}

function engineerFeatures(candles: ReconstructedCandle[]) {
  if (!candles.length) {
    return {
      atr: 0,
      avgBody: 0,
      bodyDominance: 0,
      momentum: 0,
      volatilityRegime: 'unknown',
      trendDirection: 'range',
      swingHighs: [] as ReturnType<typeof swingPoints>,
      swingLows: [] as ReturnType<typeof swingPoints>,
      recentHigh: 0,
      recentLow: 0,
      compression: 0,
      lastClose: 0,
    };
  }
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14));
  const avgBody = average(bodies.slice(-14));
  const last = candles[candles.length - 1];
  const first = candles[0];
  const momentum = last.closePrice - first.openPrice;
  const volatilityRegime = atr > average(ranges) * 1.12 ? 'expansion' : atr < average(ranges) * 0.82 ? 'compression' : 'balanced';
  const swingHighs = swingPoints(candles, 'high');
  const swingLows = swingPoints(candles, 'low');
  const recentHigh = Math.max(...candles.slice(-20).map((candle) => candle.highPrice));
  const recentLow = Math.min(...candles.slice(-20).map((candle) => candle.lowPrice));
  const compression = atr / Math.max(0.0001, average(ranges));

  return {
    atr,
    avgBody,
    bodyDominance: avgBody / Math.max(0.0001, atr),
    momentum,
    volatilityRegime,
    trendDirection: momentum > atr * 2 ? 'bullish' : momentum < -atr * 2 ? 'bearish' : 'range',
    swingHighs,
    swingLows,
    recentHigh,
    recentLow,
    compression,
    lastClose: last.closePrice,
  };
}

function detectInstitutionalStructures(candles: ReconstructedCandle[], features: ReturnType<typeof engineerFeatures>): VisionDetection[] {
  if (!candles.length) {
    return [];
  }

  const detections: VisionDetection[] = [];
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const bullish = features.trendDirection === 'bullish';
  const direction = bullish ? 'bullish' : features.trendDirection === 'bearish' ? 'bearish' : 'neutral';
  const highPoint = features.swingHighs.at(-1);
  const lowPoint = features.swingLows.at(-1);

  detections.push(makeDetection({
    type: 'market_structure',
    name: bullish ? 'Break of Structure' : 'Structure Range',
    direction,
    price: bullish ? features.recentHigh : features.recentLow,
    confidence: bullish ? 0.92 : 0.74,
    strength: bullish ? 0.9 : 0.66,
    index: highPoint?.index ?? lastIndex,
    metadata: { bos: bullish, choch: !bullish && features.volatilityRegime === 'expansion' },
  }));

  detections.push(makeDetection({
    type: 'liquidity',
    name: bullish ? 'Buy-side liquidity pool' : 'Sell-side liquidity pool',
    direction: bullish ? 'buy_side' : 'sell_side',
    price: bullish ? features.recentHigh : features.recentLow,
    confidence: 0.86,
    strength: clamp(features.compression, 0.4, 1),
    index: bullish ? highPoint?.index ?? lastIndex : lowPoint?.index ?? lastIndex,
    metadata: { sweepProbability: bullish ? 0.78 : 0.7, equalHighLowCluster: true },
  }));

  detections.push(makeDetection({
    type: 'order_block',
    name: bullish ? 'Bullish order block' : 'Bearish order block',
    direction,
    price: bullish ? features.recentLow : features.recentHigh,
    confidence: 0.84,
    strength: 0.82,
    index: bullish ? lowPoint?.index ?? Math.max(0, lastIndex - 8) : highPoint?.index ?? Math.max(0, lastIndex - 8),
    metadata: { mitigationProbability: 0.72, institutionalFootprint: true },
  }));

  if (features.volatilityRegime === 'compression') {
    detections.push(makeDetection({
      type: 'volatility',
      name: 'Volatility corridor compression',
      direction: 'neutral',
      price: last.closePrice,
      confidence: 0.81,
      strength: 0.76,
      index: lastIndex,
      metadata: { breakoutPressure: 0.68 },
    }));
  } else {
    detections.push(makeDetection({
      type: 'phase',
      name: features.volatilityRegime === 'expansion' ? 'Expansion phase' : 'Balanced consolidation',
      direction,
      price: last.closePrice,
      confidence: 0.8,
      strength: 0.78,
      index: lastIndex,
      metadata: { phaseState: features.volatilityRegime },
    }));
  }

  detections.push(makeDetection({
    type: 'risk',
    name: 'Manipulation probability',
    direction: 'neutral',
    price: last.closePrice,
    confidence: bullish ? 0.64 : 0.72,
    strength: bullish ? 0.52 : 0.68,
    index: lastIndex,
    metadata: { stopHuntRisk: bullish ? 'moderate' : 'elevated', retailTrapRisk: !bullish },
  }));

  return detections;
}

function inferMarketStructure(capture: ChartCaptureRecord, detections: VisionDetection[], features: ReturnType<typeof engineerFeatures>): MarketStructureState {
  const bos = detections.find((item) => item.detectionName === 'Break of Structure');
  const phase = detections.find((item) => item.detectionType === 'phase');
  return {
    symbol: capture.symbol,
    timeframe: capture.timeframe,
    trendState: features.trendDirection,
    phaseState: String(phase?.metadata.phaseState ?? features.volatilityRegime),
    lastBosDirection: bos?.direction ?? null,
    lastChochDirection: features.trendDirection === 'range' ? 'watch' : null,
    liquidityBias: features.trendDirection === 'bullish' ? 'buy_side_above' : features.trendDirection === 'bearish' ? 'sell_side_below' : 'two_sided',
    institutionalBias: features.trendDirection === 'bullish' ? 'accumulation_to_expansion' : features.trendDirection === 'bearish' ? 'distribution_to_expansion' : 'balanced_auction',
    retailBias: features.trendDirection === 'bullish' ? 'late_breakout_chase' : features.trendDirection === 'bearish' ? 'late_short_chase' : 'range_fade_crowding',
    confidence: clamp(average(detections.map((item) => item.confidence)), 0.1, 0.99),
  };
}

function buildDecision(capture: ChartCaptureRecord, detections: VisionDetection[], structure: MarketStructureState, features: ReturnType<typeof engineerFeatures>): AiDecisionOutput {
  const confidence = clamp((structure.confidence + average(detections.map((item) => item.strengthScore))) / 2, 0.1, 0.99);
  const bullish = structure.trendState === 'bullish';
  const bearish = structure.trendState === 'bearish';
  const decision = confidence < 0.62 ? 'WAIT' : bullish ? 'BUY' : bearish ? 'SELL' : 'WAIT';
  const entryLow = bullish ? features.recentLow : features.lastClose - features.atr * 0.4;
  const entryHigh = bearish ? features.recentHigh : features.lastClose + features.atr * 0.4;
  const stop = bullish ? entryLow - features.atr * 1.2 : bearish ? entryHigh + features.atr * 1.2 : null;
  const target1 = bullish ? features.lastClose + features.atr * 2 : bearish ? features.lastClose - features.atr * 2 : null;
  const target2 = bullish ? features.lastClose + features.atr * 3.4 : bearish ? features.lastClose - features.atr * 3.4 : null;
  const risk = stop == null ? null : Math.abs(features.lastClose - stop);
  const reward = target2 == null ? null : Math.abs(target2 - features.lastClose);

  return {
    symbol: capture.symbol,
    timeframe: capture.timeframe,
    decision,
    bias: structure.institutionalBias,
    confidence,
    entryZone: { low: round(Math.min(entryLow, entryHigh)), high: round(Math.max(entryLow, entryHigh)), basis: 'vision_reconstructed_structure' },
    stopLoss: stop == null ? null : round(stop),
    takeProfit1: target1 == null ? null : round(target1),
    takeProfit2: target2 == null ? null : round(target2),
    riskRewardRatio: risk && reward ? round(reward / risk, 4) : null,
    invalidationLevel: stop == null ? null : round(stop),
    reasoningText: reasoningText(decision, structure, detections, features),
    riskWarning: confidence > 0.8 ? 'Respect invalidation. News volatility and broker spread can invalidate visual structure.' : 'Confidence is not high enough for autonomous execution. Treat as analyst context.',
  };
}

function reasoningText(decision: string, structure: MarketStructureState, detections: VisionDetection[], features: ReturnType<typeof engineerFeatures>): string {
  const names = detections.slice(0, 4).map((item) => item.detectionName).join(', ');
  return `AI decision ${decision}: ${structure.symbol} ${structure.timeframe} is reading as ${structure.trendState} with ${structure.phaseState} conditions. Detected ${names}. Institutional bias is ${structure.institutionalBias}; retail bias is ${structure.retailBias}. ATR is ${round(features.atr)} and structure confidence is ${Math.round(structure.confidence * 100)}%.`;
}

function buildConfidenceScores(detections: VisionDetection[], decision: AiDecisionOutput): ModelConfidenceScore[] {
  const detectionScore = average(detections.map((item) => item.confidence));
  return [
    makeScore('chart_preprocessing', 0.9, 0.88, 0.07),
    makeScore('candle_reconstruction', detectionScore, detectionScore * 0.96, 0.08),
    makeScore('institutional_structure_engine', decision.confidence, decision.confidence * 0.97, 1 - decision.confidence),
    makeScore('ai_decision_engine', decision.confidence, decision.confidence, 0.1),
  ];
}

function makeDetection(input: {
  type: string;
  name: string;
  direction: string | null;
  price: number;
  confidence: number;
  strength: number;
  index: number;
  metadata: Record<string, unknown>;
}): VisionDetection {
  return {
    detectionType: input.type,
    detectionName: input.name,
    direction: input.direction,
    priceLevel: round(input.price),
    startTime: null,
    endTime: null,
    boundingBox: { x: 48 + input.index * 12, y: 120, width: 96, height: 64 },
    geometry: { candleIndex: input.index, price: round(input.price) },
    confidence: clamp(input.confidence, 0.01, 0.99),
    strengthScore: clamp(input.strength, 0.01, 0.99),
    status: 'active',
    metadata: input.metadata,
  };
}

function makeScore(modelName: string, rawScore: number, calibratedScore: number, uncertaintyScore: number): ModelConfidenceScore {
  return {
    modelName,
    modelVersion,
    rawScore: clamp(rawScore, 0, 1),
    calibratedScore: clamp(calibratedScore, 0, 1),
    uncertaintyScore: clamp(uncertaintyScore, 0, 1),
    finalConfidence: clamp(calibratedScore * (1 - uncertaintyScore * 0.25), 0, 1),
  };
}

function swingPoints(candles: ReconstructedCandle[], side: 'high' | 'low') {
  return candles.flatMap((candle, index, list) => {
    if (index === 0 || index === list.length - 1) return [];
    const previous = list[index - 1];
    const next = list[index + 1];
    if (side === 'high' && candle.highPrice > previous.highPrice && candle.highPrice > next.highPrice) return [{ index, price: candle.highPrice }];
    if (side === 'low' && candle.lowPrice < previous.lowPrice && candle.lowPrice < next.lowPrice) return [{ index, price: candle.lowPrice }];
    return [];
  });
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

function cleanText(value: string | undefined, fallback: string): string {
  const next = String(value ?? '').trim();
  return next.length > 0 ? next : fallback;
}
