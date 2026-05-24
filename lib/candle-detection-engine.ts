import type { ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

export type CandleDecision = 'BUY' | 'SELL' | 'WAIT' | 'AVOID';

export interface CandleClassification {
  id?: string;
  chartCaptureId?: string;
  reconstructedCandleId?: string | null;
  candleIndex: number;
  detectedCandleType: string;
  direction: string;
  tradingMeaning: string;
  implication: string;
  supportsDecision: CandleDecision;
  bodyStrengthScore: number;
  wickRejectionScore: number;
  momentumScore: number;
  manipulationScore: number;
  institutionalDisplacementScore: number;
  candleReliabilityScore: number;
  finalConfidenceScore: number;
  riskWarning: string;
  explanationText: string;
  geometry: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface CandleSequenceAnalysis {
  id?: string;
  chartCaptureId?: string;
  sequenceStartIndex: number;
  sequenceEndIndex: number;
  detectedSequenceType: string;
  phaseState: string;
  momentumState: string;
  implication: string;
  supportsDecision: CandleDecision;
  confidence: number;
  riskWarning: string;
  explanationText: string;
  metadata: Record<string, unknown>;
  createdAt?: string;
}

export interface CandleAnalysisResult {
  classifications: CandleClassification[];
  sequences: CandleSequenceAnalysis[];
  summary: {
    dominantType: string;
    dominantDirection: string;
    recommendedDecision: CandleDecision;
    confidence: number;
    explanation: string;
  };
}

export function normalizeInputCandles(input: VisionCandleInput[]): ReconstructedCandle[] {
  const minLow = Math.min(...input.map((candle) => candle.low));
  const maxHigh = Math.max(...input.map((candle) => candle.high));
  const range = Math.max(0.0001, maxHigh - minLow);
  return input.map((candle, index) => {
    const pixelX = candle.pixelX ?? 40 + index * 12;
    const y = (price: number) => 340 - ((price - minLow) / range) * 280;
    return {
      candleIndex: index,
      openPrice: round(candle.open),
      highPrice: round(candle.high),
      lowPrice: round(candle.low),
      closePrice: round(candle.close),
      pixelX,
      pixelYOpen: round(candle.pixelYOpen ?? y(candle.open)),
      pixelYHigh: round(candle.pixelYHigh ?? y(candle.high)),
      pixelYLow: round(candle.pixelYLow ?? y(candle.low)),
      pixelYClose: round(candle.pixelYClose ?? y(candle.close)),
      direction: candle.close > candle.open ? 'bullish' : candle.close < candle.open ? 'bearish' : 'neutral',
      confidence: clamp(candle.confidence ?? 0.88, 0.1, 0.99),
    };
  });
}

export function analyzeCandles(candles: ReconstructedCandle[]): CandleAnalysisResult {
  if (candles.length === 0) {
    return {
      classifications: [],
      sequences: [],
      summary: {
        dominantType: 'none',
        dominantDirection: 'neutral',
        recommendedDecision: 'WAIT',
        confidence: 0,
        explanation: 'No reconstructed candles were available for candle detection.',
      },
    };
  }

  const context = buildContext(candles);
  const classifications = candles.map((candle, index) => classifyCandle(candle, index, candles, context));
  const sequences = analyzeSequences(candles, classifications, context);
  const latestSequence = sequences.at(-1);
  const latest = classifications.at(-1);
  const confidence = average([
    latest?.finalConfidenceScore ?? 0,
    latestSequence?.confidence ?? 0,
    average(classifications.slice(-8).map((item) => item.finalConfidenceScore)),
  ]);

  return {
    classifications,
    sequences,
    summary: {
      dominantType: latestSequence?.detectedSequenceType ?? latest?.detectedCandleType ?? 'unclassified',
      dominantDirection: latest?.direction ?? 'neutral',
      recommendedDecision: latestSequence?.supportsDecision ?? latest?.supportsDecision ?? 'WAIT',
      confidence,
      explanation: latestSequence?.explanationText ?? latest?.explanationText ?? 'Candle analysis completed.',
    },
  };
}

function classifyCandle(
  candle: ReconstructedCandle,
  index: number,
  candles: ReconstructedCandle[],
  context: ReturnType<typeof buildContext>,
): CandleClassification {
  const body = Math.abs(candle.closePrice - candle.openPrice);
  const range = Math.max(0.0001, candle.highPrice - candle.lowPrice);
  const upperWick = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
  const lowerWick = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
  const bodyRatio = body / range;
  const upperRatio = upperWick / range;
  const lowerRatio = lowerWick / range;
  const direction = candle.closePrice > candle.openPrice ? 'bullish' : candle.closePrice < candle.openPrice ? 'bearish' : 'neutral';
  const previous = candles[index - 1];
  const previousRange = previous ? previous.highPrice - previous.lowPrice : range;

  const bodyStrengthScore = clamp(bodyRatio * 1.25, 0, 1);
  const wickRejectionScore = clamp(Math.max(upperRatio, lowerRatio) * 1.35, 0, 1);
  const momentumScore = clamp(range / Math.max(0.0001, context.atr) * 0.45 + bodyRatio * 0.45, 0, 1);
  const manipulationScore = clamp((upperRatio > 0.45 || lowerRatio > 0.45 ? 0.42 : 0.12) + (range > context.atr * 1.4 ? 0.22 : 0), 0, 1);
  const institutionalDisplacementScore = clamp((range / Math.max(0.0001, context.atr)) * bodyRatio * 0.72, 0, 1);
  const candleReliabilityScore = clamp((candle.confidence + bodyStrengthScore + (1 - manipulationScore * 0.35)) / 3, 0, 1);

  const flags = {
    doji: bodyRatio <= 0.12,
    hammer: lowerRatio >= 0.48 && upperRatio <= 0.2 && bodyRatio <= 0.38,
    invertedHammer: upperRatio >= 0.48 && lowerRatio <= 0.2 && bodyRatio <= 0.38 && direction === 'bullish',
    shootingStar: upperRatio >= 0.48 && lowerRatio <= 0.2 && bodyRatio <= 0.38 && direction === 'bearish',
    pinBar: Math.max(upperRatio, lowerRatio) >= 0.55 && bodyRatio <= 0.32,
    marubozu: bodyRatio >= 0.82 && upperRatio <= 0.09 && lowerRatio <= 0.09,
    momentum: bodyRatio >= 0.62 && range >= context.atr * 1.15,
    rejection: wickRejectionScore >= 0.62,
    liquidity: (candle.highPrice >= context.recentHigh || candle.lowPrice <= context.recentLow) && wickRejectionScore >= 0.45,
    manipulation: manipulationScore >= 0.62,
    engulfing: previous ? candle.highPrice > previous.highPrice && candle.lowPrice < previous.lowPrice && body > Math.abs(previous.closePrice - previous.openPrice) * 1.1 : false,
    insideBar: previous ? candle.highPrice < previous.highPrice && candle.lowPrice > previous.lowPrice : false,
    outsideBar: previous ? candle.highPrice > previous.highPrice && candle.lowPrice < previous.lowPrice : false,
    displacement: institutionalDisplacementScore >= 0.68,
    imbalance: previous ? Math.abs(candle.closePrice - previous.closePrice) > previousRange * 0.8 && bodyRatio > 0.55 : false,
  };

  const detectedCandleType = pickCandleType(flags, direction);
  const implication = implicationFor(detectedCandleType, direction, lowerRatio, upperRatio);
  const supportsDecision = decisionFor(detectedCandleType, implication, institutionalDisplacementScore, manipulationScore);
  const finalConfidenceScore = clamp(
    bodyStrengthScore * 0.18 +
    wickRejectionScore * 0.16 +
    momentumScore * 0.18 +
    (1 - manipulationScore * 0.28) * 0.12 +
    institutionalDisplacementScore * 0.2 +
    candleReliabilityScore * 0.16,
    0,
    1,
  );

  return {
    candleIndex: candle.candleIndex,
    detectedCandleType,
    direction,
    tradingMeaning: tradingMeaningFor(detectedCandleType, implication),
    implication,
    supportsDecision,
    bodyStrengthScore,
    wickRejectionScore,
    momentumScore,
    manipulationScore,
    institutionalDisplacementScore,
    candleReliabilityScore,
    finalConfidenceScore,
    riskWarning: riskWarningFor(detectedCandleType, manipulationScore, finalConfidenceScore),
    explanationText: explainCandle(detectedCandleType, direction, implication, bodyRatio, upperRatio, lowerRatio, institutionalDisplacementScore),
    geometry: {
      pixelX: candle.pixelX,
      body: { openY: candle.pixelYOpen, closeY: candle.pixelYClose },
      wick: { highY: candle.pixelYHigh, lowY: candle.pixelYLow },
      price: { open: candle.openPrice, high: candle.highPrice, low: candle.lowPrice, close: candle.closePrice },
    },
    metadata: {
      bodyRatio,
      upperWickRatio: upperRatio,
      lowerWickRatio: lowerRatio,
      createsImbalance: flags.imbalance,
      causesBos: flags.displacement && direction === context.trendDirection,
      liquiditySweepCandle: flags.liquidity,
      stopHuntCandle: flags.manipulation && flags.liquidity,
      openCvPipeline: ['color_segmentation', 'contour_filtering', 'vertical_wick_detection', 'pixel_price_interpolation'],
    },
  };
}

function analyzeSequences(
  candles: ReconstructedCandle[],
  classifications: CandleClassification[],
  context: ReturnType<typeof buildContext>,
): CandleSequenceAnalysis[] {
  const windows: CandleSequenceAnalysis[] = [];
  const windowSize = Math.min(8, candles.length);
  for (let end = windowSize - 1; end < candles.length; end += windowSize) {
    const start = Math.max(0, end - windowSize + 1);
    windows.push(classifySequence(candles.slice(start, end + 1), classifications.slice(start, end + 1), start, end, context));
  }
  const tailStart = Math.max(0, candles.length - windowSize);
  if (windows.at(-1)?.sequenceEndIndex !== candles.length - 1) {
    windows.push(classifySequence(candles.slice(tailStart), classifications.slice(tailStart), tailStart, candles.length - 1, context));
  }
  return windows;
}

function classifySequence(
  candles: ReconstructedCandle[],
  classifications: CandleClassification[],
  start: number,
  end: number,
  context: ReturnType<typeof buildContext>,
): CandleSequenceAnalysis {
  const bullishCount = candles.filter((candle) => candle.direction === 'bullish').length;
  const bearishCount = candles.filter((candle) => candle.direction === 'bearish').length;
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const avgRange = average(ranges);
  const displacementCount = classifications.filter((item) => item.institutionalDisplacementScore >= 0.68).length;
  const manipulationCount = classifications.filter((item) => item.manipulationScore >= 0.62).length;
  const momentumAverage = average(classifications.map((item) => item.momentumScore));
  const compression = avgRange < context.atr * 0.82;
  const expansion = avgRange > context.atr * 1.15;

  const detectedSequenceType = displacementCount >= 2
    ? 'displacement sequence'
    : manipulationCount >= 2
      ? 'stop-hunt candle sequence'
      : compression
        ? 'compression sequence'
        : expansion
          ? 'expansion sequence'
          : momentumAverage > 0.68
            ? 'momentum burst'
            : 'balanced candle sequence';

  const implication = bullishCount > bearishCount ? 'bullish' : bearishCount > bullishCount ? 'bearish' : 'neutral';
  const supportsDecision: CandleDecision = manipulationCount >= 2
    ? 'AVOID'
    : implication === 'bullish' && momentumAverage > 0.55
      ? 'BUY'
      : implication === 'bearish' && momentumAverage > 0.55
        ? 'SELL'
        : 'WAIT';
  const confidence = clamp(average(classifications.map((item) => item.finalConfidenceScore)) + (displacementCount > 0 ? 0.06 : 0), 0, 0.98);

  return {
    sequenceStartIndex: start,
    sequenceEndIndex: end,
    detectedSequenceType,
    phaseState: compression ? 'compression' : expansion ? 'expansion' : 'balanced',
    momentumState: momentumAverage > 0.68 ? 'impulsive' : momentumAverage < 0.38 ? 'exhausted' : 'controlled',
    implication,
    supportsDecision,
    confidence,
    riskWarning: manipulationCount >= 2 ? 'Sequence contains multiple manipulation or stop-hunt candles. Avoid chasing the first breakout.' : 'Validate sequence against nearby liquidity, order blocks, and session volatility.',
    explanationText: `Sequence ${start}-${end} shows ${detectedSequenceType} with ${implication} implication. Momentum is ${momentumAverage > 0.68 ? 'strong' : 'controlled'}, phase is ${compression ? 'compression' : expansion ? 'expansion' : 'balanced'}, and ${displacementCount} displacement candles were detected.`,
    metadata: {
      bullishCount,
      bearishCount,
      displacementCount,
      manipulationCount,
      averageRange: avgRange,
      atr: context.atr,
      imbalanceCandles: classifications.filter((item) => Boolean(item.metadata.createsImbalance)).length,
    },
  };
}

function buildContext(candles: ReconstructedCandle[]) {
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const atr = average(ranges.slice(-14)) || average(ranges) || 1;
  const recent = candles.slice(-20);
  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    atr,
    recentHigh: Math.max(...recent.map((candle) => candle.highPrice)),
    recentLow: Math.min(...recent.map((candle) => candle.lowPrice)),
    trendDirection: last.closePrice > first.openPrice ? 'bullish' : last.closePrice < first.openPrice ? 'bearish' : 'neutral',
  };
}

function pickCandleType(flags: Record<string, boolean>, direction: string): string {
  if (flags.manipulation && flags.liquidity) return 'manipulation candle';
  if (flags.liquidity) return 'liquidity candle';
  if (flags.engulfing) return 'engulfing candle';
  if (flags.outsideBar) return 'outside bar';
  if (flags.insideBar) return 'inside bar';
  if (flags.marubozu) return 'marubozu';
  if (flags.displacement) return 'momentum candle';
  if (flags.shootingStar) return 'shooting star';
  if (flags.invertedHammer) return 'inverted hammer';
  if (flags.hammer) return 'hammer';
  if (flags.pinBar) return 'pin bar';
  if (flags.doji) return 'doji';
  if (flags.rejection) return 'rejection candle';
  return direction === 'bullish' ? 'bullish candle' : direction === 'bearish' ? 'bearish candle' : 'doji';
}

function implicationFor(type: string, direction: string, lowerRatio: number, upperRatio: number): string {
  if (['hammer', 'inverted hammer'].includes(type)) return 'bullish';
  if (['shooting star'].includes(type)) return 'bearish';
  if (type === 'pin bar' || type === 'rejection candle') return lowerRatio > upperRatio ? 'bullish rejection' : 'bearish rejection';
  if (type === 'manipulation candle') return 'two-sided risk';
  if (type === 'doji' || type === 'inside bar') return 'indecision';
  return direction;
}

function decisionFor(type: string, implication: string, displacement: number, manipulation: number): CandleDecision {
  if (manipulation >= 0.72 || implication === 'two-sided risk') return 'AVOID';
  if (implication.includes('bullish') || (implication === 'bullish' && displacement > 0.55)) return 'BUY';
  if (implication.includes('bearish') || (implication === 'bearish' && displacement > 0.55)) return 'SELL';
  if (['doji', 'inside bar'].includes(type)) return 'WAIT';
  return 'WAIT';
}

function tradingMeaningFor(type: string, implication: string): string {
  if (type.includes('manipulation')) return 'Possible stop-hunt or engineered liquidity event. Wait for confirmation after the sweep.';
  if (type.includes('liquidity')) return 'Liquidity interaction candle near a recent extreme. Watch for sweep and reclaim logic.';
  if (type.includes('momentum') || type === 'marubozu') return 'Strong directional participation and possible institutional displacement.';
  if (type.includes('rejection') || type === 'pin bar') return `Rejection candle with ${implication} pressure. Validate against order blocks or support/resistance.`;
  if (type === 'engulfing candle') return 'Engulfing pressure suggests control shifted during this candle.';
  if (type === 'doji') return 'Indecision candle. Avoid forcing directional bias until follow-through appears.';
  return `Standard ${type} with ${implication} implication.`;
}

function riskWarningFor(type: string, manipulation: number, confidence: number): string {
  if (manipulation >= 0.62) return 'High manipulation signature. Avoid chasing the candle without reclaim or continuation confirmation.';
  if (confidence < 0.55) return 'Candle reliability is modest. Confirm with surrounding sequence and market structure.';
  if (type === 'doji' || type === 'inside bar') return 'Indecision or compression may precede expansion. Wait for a clean break.';
  return 'Use invalidation beyond the wick extreme and confirm with liquidity/structure context.';
}

function explainCandle(type: string, direction: string, implication: string, bodyRatio: number, upperRatio: number, lowerRatio: number, displacement: number): string {
  return `${type} detected with ${direction} body direction and ${implication} implication. Body dominance is ${percent(bodyRatio)}, upper wick is ${percent(upperRatio)}, lower wick is ${percent(lowerRatio)}, and institutional displacement score is ${percent(displacement)}.`;
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
