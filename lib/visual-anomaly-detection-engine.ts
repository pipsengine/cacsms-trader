import type { ReconstructedCandle } from './visual-intelligence-types';

export type AnomalySeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type AnomalyAction = 'Ignore' | 'Monitor' | 'Wait' | 'Avoid' | 'Escalate';

export interface VisualAnomaly {
  anomalyType: string;
  severity: AnomalySeverity;
  affectedTimeframe: string;
  affectedPriceZone: { low: number | null; high: number | null; midpoint: number | null };
  visualCoordinates: Record<string, unknown>;
  probabilityScore: number;
  tradingRiskMeaning: string;
  possibleCause: string;
  recommendedAction: AnomalyAction;
  metadata: Record<string, unknown>;
}

export interface VisualAnomalyAnalysisResult {
  anomalies: VisualAnomaly[];
  severityScores: Record<AnomalySeverity, number>;
  overallSeverity: AnomalySeverity;
  manipulationProbability: number;
  feedQualityScore: number;
  imageIntegrityScore: number;
  volatilitySpikeScore: number;
  explanation: string;
  modelVersion: string;
}

export function analyzeVisualAnomalies(input: {
  symbol: string;
  timeframe: string;
  imageUrl?: string | null;
  imageHash?: string | null;
  metadata?: Record<string, unknown>;
  candles: ReconstructedCandle[];
}): VisualAnomalyAnalysisResult {
  const candles = [...input.candles].sort((left, right) => left.candleIndex - right.candleIndex);
  const ranges = candles.map((candle) => candle.highPrice - candle.lowPrice);
  const bodies = candles.map((candle) => Math.abs(candle.closePrice - candle.openPrice));
  const atr = average(ranges.slice(-14)) || average(ranges) || 0;
  const rangeMean = average(ranges);
  const rangeStd = stddev(ranges);
  const bodyMean = average(bodies);
  const anomalies: VisualAnomaly[] = [];

  for (const candle of candles) {
    const range = candle.highPrice - candle.lowPrice;
    const body = Math.abs(candle.closePrice - candle.openPrice);
    const upperWick = candle.highPrice - Math.max(candle.openPrice, candle.closePrice);
    const lowerWick = Math.min(candle.openPrice, candle.closePrice) - candle.lowPrice;
    const largestWick = Math.max(upperWick, lowerWick);
    const rangeZ = zScore(range, rangeMean, rangeStd);
    const atrDeviation = atr > 0 ? range / atr : 0;
    const wickRatio = range > 0 ? largestWick / range : 0;

    if (rangeZ >= 2.4 || atrDeviation >= 2.2) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Abnormally large candle',
        candle,
        timeframe: input.timeframe,
        probabilityScore: clamp(Math.max(rangeZ / 4, atrDeviation / 4), 0.45, 0.98),
        tradingRiskMeaning: 'The candle range is materially larger than recent behaviour, which can indicate news volatility, forced liquidation, or institutional displacement.',
        possibleCause: 'ATR deviation, volatility spike, news impulse, or abnormal broker feed expansion.',
        recommendedAction: atrDeviation > 3.5 ? 'Avoid' : 'Wait',
      }));
    }

    if (wickRatio >= 0.68 && range > rangeMean * 1.2) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Abnormally long wick',
        candle,
        timeframe: input.timeframe,
        probabilityScore: clamp(wickRatio, 0.5, 0.97),
        tradingRiskMeaning: 'Long wick rejection can represent a stop hunt, liquidity grab, fake breakout, or failed auction.',
        possibleCause: upperWick > lowerWick ? 'Buy-side liquidity sweep or rejected breakout.' : 'Sell-side liquidity sweep or rejected breakdown.',
        recommendedAction: wickRatio > 0.82 ? 'Wait' : 'Monitor',
      }));
    }

    if (bodyMean > 0 && body > bodyMean * 2.6 && wickRatio < 0.24) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Price displacement without normal structure',
        candle,
        timeframe: input.timeframe,
        probabilityScore: clamp(body / Math.max(bodyMean * 4, 1), 0.42, 0.94),
        tradingRiskMeaning: 'Large body displacement without a balanced wick profile can indicate institutional repricing or feed discontinuity.',
        possibleCause: 'Aggressive expansion candle, thin liquidity, or candle rendering inconsistency.',
        recommendedAction: 'Wait',
      }));
    }
  }

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const gap = Math.min(Math.abs(current.openPrice - previous.closePrice), Math.abs(current.lowPrice - previous.highPrice), Math.abs(current.highPrice - previous.lowPrice));
    const directionGap = Math.abs(current.openPrice - previous.closePrice);
    if (atr > 0 && directionGap / atr >= 0.72) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Sudden gap',
        candle: current,
        timeframe: input.timeframe,
        probabilityScore: clamp(directionGap / Math.max(atr * 2, 1), 0.45, 0.96),
        tradingRiskMeaning: 'A sudden gap can signal broker feed discontinuity, session reopen repricing, or abnormal liquidity vacuum.',
        possibleCause: gap > atr ? 'True chart gap or missing tick segment.' : 'Open/close discontinuity between candles.',
        recommendedAction: directionGap / atr > 1.5 ? 'Escalate' : 'Wait',
      }));
    }

    if (sameCandle(previous, current)) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Duplicate candle anomaly',
        candle: current,
        timeframe: input.timeframe,
        probabilityScore: 0.88,
        tradingRiskMeaning: 'Duplicate OHLC values can indicate a stalled feed or candle reconstruction issue.',
        possibleCause: 'Broker feed freeze, missing ticks, or repeated reconstructed candle payload.',
        recommendedAction: 'Escalate',
      }));
    }

    if (current.candleIndex - previous.candleIndex > 1) {
      anomalies.push(candleAnomaly({
        anomalyType: 'Missing candle anomaly',
        candle: current,
        timeframe: input.timeframe,
        probabilityScore: 0.82,
        tradingRiskMeaning: 'Missing candle indexes reduce confidence in all downstream visual analysis.',
        possibleCause: 'Capture gap, dropped feed segment, or reconstruction pipeline loss.',
        recommendedAction: 'Escalate',
      }));
    }
  }

  const compression = detectCompressionExpansion(candles, ranges, atr, input.timeframe);
  if (compression) anomalies.push(compression);

  const imageIntegrityScore = scoreImageIntegrity(input.imageUrl, input.imageHash, input.metadata);
  if (imageIntegrityScore < 0.55) {
    anomalies.push({
      anomalyType: 'Chart feed distortion',
      severity: imageIntegrityScore < 0.25 ? 'Critical' : 'High',
      affectedTimeframe: input.timeframe,
      affectedPriceZone: { low: null, high: null, midpoint: null },
      visualCoordinates: { x: 0, y: 0, width: 1, height: 1, source: 'image_integrity' },
      probabilityScore: 1 - imageIntegrityScore,
      tradingRiskMeaning: 'The chart image or capture metadata is not reliable enough for confident visual analysis.',
      possibleCause: 'Image corruption, missing capture file, invalid chart crop, or broker/chart rendering error.',
      recommendedAction: imageIntegrityScore < 0.25 ? 'Escalate' : 'Avoid',
      metadata: { imageUrl: input.imageUrl ?? null, imageHash: input.imageHash ?? null },
    });
  }

  const manipulationProbability = clamp(
    maxProbability(anomalies, ['Abnormally long wick', 'Fake breakout', 'Stop hunt spike', 'Liquidity sweep anomaly']) * 0.72
    + maxProbability(anomalies, ['Sudden gap', 'Abnormally large candle']) * 0.28,
    0,
    1,
  );

  if (manipulationProbability > 0.58) {
    anomalies.push({
      anomalyType: 'Manipulation probability elevated',
      severity: manipulationProbability > 0.82 ? 'Critical' : 'High',
      affectedTimeframe: input.timeframe,
      affectedPriceZone: deriveZone(candles.at(-1) ?? null),
      visualCoordinates: candleGeometry(candles.at(-1) ?? null),
      probabilityScore: manipulationProbability,
      tradingRiskMeaning: 'The chart has a cluster of displacement, wick, or liquidity-sweep symptoms consistent with manipulation risk.',
      possibleCause: 'Stop hunt spike, fake breakout, liquidity sweep, or engineered volatility expansion.',
      recommendedAction: manipulationProbability > 0.82 ? 'Avoid' : 'Wait',
      metadata: { manipulationProbability },
    });
  }

  const severityScores = severityScore(anomalies);
  const overallSeverity = dominantSeverity(severityScores);
  const feedQualityScore = clamp(1 - (severityScores.Critical * 0.3 + severityScores.High * 0.16 + severityScores.Medium * 0.08), 0, 1);
  const volatilitySpikeScore = maxProbability(anomalies, ['Abnormally large candle', 'Sudden gap', 'Price displacement without normal structure']);

  return {
    anomalies: anomalies.sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || right.probabilityScore - left.probabilityScore),
    severityScores,
    overallSeverity,
    manipulationProbability,
    feedQualityScore,
    imageIntegrityScore,
    volatilitySpikeScore,
    explanation: explanationFor(input.symbol, input.timeframe, anomalies, overallSeverity, manipulationProbability, feedQualityScore),
    modelVersion: 'visual-anomaly-hybrid-v1',
  };
}

function candleAnomaly(input: {
  anomalyType: string;
  candle: ReconstructedCandle;
  timeframe: string;
  probabilityScore: number;
  tradingRiskMeaning: string;
  possibleCause: string;
  recommendedAction: AnomalyAction;
}): VisualAnomaly {
  const severity = probabilityToSeverity(input.probabilityScore, input.recommendedAction);
  return {
    anomalyType: input.anomalyType,
    severity,
    affectedTimeframe: input.timeframe,
    affectedPriceZone: deriveZone(input.candle),
    visualCoordinates: candleGeometry(input.candle),
    probabilityScore: input.probabilityScore,
    tradingRiskMeaning: input.tradingRiskMeaning,
    possibleCause: input.possibleCause,
    recommendedAction: input.recommendedAction,
    metadata: { candleIndex: input.candle.candleIndex, direction: input.candle.direction },
  };
}

function detectCompressionExpansion(candles: ReconstructedCandle[], ranges: number[], atr: number, timeframe: string): VisualAnomaly | null {
  if (candles.length < 8 || atr <= 0) return null;
  const prior = ranges.slice(-7, -1);
  const current = ranges.at(-1) ?? 0;
  const compressed = prior.every((range) => range < atr * 0.72);
  if (!compressed || current < atr * 1.75) return null;
  const candle = candles.at(-1);
  if (!candle) return null;
  return candleAnomaly({
    anomalyType: 'Unusual compression before expansion',
    candle,
    timeframe,
    probabilityScore: clamp(current / Math.max(atr * 2.6, 1), 0.55, 0.95),
    tradingRiskMeaning: 'Compression followed by expansion can mark engineered liquidity release or post-accumulation/distribution movement.',
    possibleCause: 'Volatility contraction, liquidity build-up, then expansion displacement.',
    recommendedAction: 'Wait',
  });
}

function scoreImageIntegrity(imageUrl?: string | null, imageHash?: string | null, metadata?: Record<string, unknown>) {
  let score = 1;
  if (!imageUrl) score -= 0.35;
  if (!imageHash || imageHash.length < 16) score -= 0.25;
  const quality = Number(metadata?.chartQualityScore ?? metadata?.captureQualityScore ?? NaN);
  if (Number.isFinite(quality)) score = Math.min(score, quality > 1 ? quality / 100 : quality);
  return clamp(score, 0, 1);
}

function severityScore(anomalies: VisualAnomaly[]): Record<AnomalySeverity, number> {
  return {
    Low: anomalies.filter((item) => item.severity === 'Low').length,
    Medium: anomalies.filter((item) => item.severity === 'Medium').length,
    High: anomalies.filter((item) => item.severity === 'High').length,
    Critical: anomalies.filter((item) => item.severity === 'Critical').length,
  };
}

function dominantSeverity(scores: Record<AnomalySeverity, number>): AnomalySeverity {
  if (scores.Critical > 0) return 'Critical';
  if (scores.High > 0) return 'High';
  if (scores.Medium > 0) return 'Medium';
  return scores.Low > 0 ? 'Low' : 'Low';
}

function probabilityToSeverity(probability: number, action: AnomalyAction): AnomalySeverity {
  if (action === 'Escalate' || probability >= 0.88) return 'Critical';
  if (action === 'Avoid' || probability >= 0.72) return 'High';
  if (probability >= 0.5) return 'Medium';
  return 'Low';
}

function explanationFor(symbol: string, timeframe: string, anomalies: VisualAnomaly[], severity: AnomalySeverity, manipulation: number, feedQuality: number) {
  if (!anomalies.length) {
    return `${symbol} ${timeframe} is visually normal. No material candle, wick, gap, feed, or manipulation anomalies were detected.`;
  }
  return `${symbol} ${timeframe} has ${anomalies.length} visual anomaly signal(s), with overall severity ${severity}. Manipulation probability is ${(manipulation * 100).toFixed(0)}% and feed quality is ${(feedQuality * 100).toFixed(0)}%. The highest priority alert is ${anomalies[0].anomalyType}: ${anomalies[0].tradingRiskMeaning}`;
}

function maxProbability(anomalies: VisualAnomaly[], types: string[]) {
  return anomalies.filter((item) => types.includes(item.anomalyType)).reduce((max, item) => Math.max(max, item.probabilityScore), 0);
}

function deriveZone(candle: ReconstructedCandle | null): VisualAnomaly['affectedPriceZone'] {
  if (!candle) return { low: null, high: null, midpoint: null };
  return {
    low: candle.lowPrice,
    high: candle.highPrice,
    midpoint: (candle.lowPrice + candle.highPrice) / 2,
  };
}

function candleGeometry(candle: ReconstructedCandle | null): Record<string, unknown> {
  if (!candle) return {};
  return {
    candleIndex: candle.candleIndex,
    x: candle.pixelX,
    yHigh: candle.pixelYHigh,
    yLow: candle.pixelYLow,
    yOpen: candle.pixelYOpen,
    yClose: candle.pixelYClose,
  };
}

function sameCandle(left: ReconstructedCandle, right: ReconstructedCandle) {
  return left.openPrice === right.openPrice && left.highPrice === right.highPrice && left.lowPrice === right.lowPrice && left.closePrice === right.closePrice;
}

function zScore(value: number, mean: number, deviation: number) {
  return deviation > 0 ? (value - mean) / deviation : 0;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stddev(values: number[]) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function severityRank(severity: AnomalySeverity) {
  return { Low: 1, Medium: 2, High: 3, Critical: 4 }[severity];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
