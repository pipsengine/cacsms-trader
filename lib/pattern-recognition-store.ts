import { randomUUID } from 'node:crypto';

import {
  analyzePatterns,
  normalizePatternInputCandles,
  type PatternAnalysisResult,
  type PatternProbabilitySnapshot,
  type PatternRecognitionResult,
  type PatternSimilarityHistory,
} from './pattern-recognition-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS pattern_recognition_results (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  pattern_name TEXT NOT NULL,
  pattern_family TEXT NOT NULL,
  pattern_status TEXT NOT NULL,
  completion_percentage NUMERIC(8, 4) NOT NULL,
  breakout_direction TEXT NOT NULL,
  breakout_probability NUMERIC(8, 4) NOT NULL,
  failure_probability NUMERIC(8, 4) NOT NULL,
  trap_probability NUMERIC(8, 4) NOT NULL,
  retail_trap_score NUMERIC(8, 4) NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  similarity_score NUMERIC(8, 4) NOT NULL,
  dtw_distance NUMERIC(18, 6) NOT NULL,
  overlay_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_shape_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pattern_similarity_history (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  pattern_result_id UUID REFERENCES pattern_recognition_results(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  template_family TEXT NOT NULL,
  similarity_score NUMERIC(8, 4) NOT NULL,
  dtw_distance NUMERIC(18, 6) NOT NULL,
  historical_success_rate NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pattern_probability_snapshots (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  bullish_breakout_probability NUMERIC(8, 4) NOT NULL,
  bearish_breakout_probability NUMERIC(8, 4) NOT NULL,
  continuation_probability NUMERIC(8, 4) NOT NULL,
  reversal_probability NUMERIC(8, 4) NOT NULL,
  accumulation_probability NUMERIC(8, 4) NOT NULL,
  distribution_probability NUMERIC(8, 4) NOT NULL,
  manipulation_probability NUMERIC(8, 4) NOT NULL,
  volatility_compression_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_location_score NUMERIC(8, 4) NOT NULL,
  trend_context_score NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pattern_recognition_feedback (
  id UUID PRIMARY KEY,
  pattern_result_id UUID NOT NULL REFERENCES pattern_recognition_results(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patterns_capture_confidence ON pattern_recognition_results(chart_capture_id, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_capture_name ON pattern_recognition_results(chart_capture_id, pattern_name);
CREATE INDEX IF NOT EXISTS idx_pattern_similarity_capture ON pattern_similarity_history(chart_capture_id, similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_probability_capture ON pattern_probability_snapshots(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_feedback_result ON pattern_recognition_feedback(pattern_result_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensurePatternRecognitionSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCapturePatterns(input: ChartCaptureRequest & { captureId?: string }): Promise<PatternAnalysisResult & { captureId: string }> {
  await ensurePatternRecognitionSchema();
  await publishVisualIntelligenceEvent('patterns.analysis.started', input.captureId ?? null, null, { stage: 'pattern_recognition_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizePatternInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 8) throw new Error('At least eight candles are required for pattern recognition.');

  const result = analyzePatterns(candles);
  await replacePatternAnalysis(captureId, result);
  const persisted = await getPatternAnalysis(captureId);
  await publishVisualIntelligenceEvent('patterns.analysis.completed', captureId, null, {
    summary: persisted.summary,
    patternCount: persisted.patterns.length,
    topPattern: persisted.patterns[0]?.patternName ?? 'none',
  });
  return persisted;
}

export async function getPatternAnalysis(captureId: string): Promise<PatternAnalysisResult & { captureId: string }> {
  await ensurePatternRecognitionSchema();
  const [patterns, similarHistory, probability] = await Promise.all([
    getPatternResults(captureId),
    getPatternSimilarHistory(captureId),
    getPatternProbability(captureId),
  ]);
  return {
    captureId,
    patterns,
    similarHistory,
    probability,
    summary: summarize(patterns),
  };
}

export async function getPatternCoverageMap(): Promise<Record<string, number>> {
  await ensurePatternRecognitionSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS pattern_count
    FROM pattern_recognition_results
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.pattern_count);
  }
  return coverage;
}

export async function getPatternResults(captureId: string): Promise<PatternRecognitionResult[]> {
  await ensurePatternRecognitionSchema();
  const result = await queryPostgres(`
    SELECT * FROM pattern_recognition_results
    WHERE chart_capture_id = $1
    ORDER BY confidence_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapPattern);
}

export async function getPatternSimilarHistory(captureId: string): Promise<PatternSimilarityHistory[]> {
  await ensurePatternRecognitionSchema();
  const result = await queryPostgres(`
    SELECT * FROM pattern_similarity_history
    WHERE chart_capture_id = $1
    ORDER BY similarity_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapSimilarity);
}

export async function getPatternProbability(captureId: string): Promise<PatternProbabilitySnapshot> {
  await ensurePatternRecognitionSchema();
  const result = await queryPostgres(`
    SELECT * FROM pattern_probability_snapshots
    WHERE chart_capture_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [captureId]);
  return result.rows[0] ? mapProbability(result.rows[0]) : emptyProbability(captureId);
}

export async function createPatternFeedback(input: {
  patternResultId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensurePatternRecognitionSchema();
  const result = await queryPostgres(`
    INSERT INTO pattern_recognition_feedback (id, pattern_result_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.patternResultId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('patterns.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replacePatternAnalysis(captureId: string, result: PatternAnalysisResult) {
  await queryPostgres('DELETE FROM pattern_similarity_history WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM pattern_probability_snapshots WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM pattern_recognition_results WHERE chart_capture_id = $1', [captureId]);

  const insertedPatternIds: string[] = [];
  for (const pattern of result.patterns) {
    const id = randomUUID();
    insertedPatternIds.push(id);
    await queryPostgres(`
      INSERT INTO pattern_recognition_results (
        id, chart_capture_id, pattern_name, pattern_family, pattern_status, completion_percentage,
        breakout_direction, breakout_probability, failure_probability, trap_probability, retail_trap_score,
        institutional_interpretation, recommended_action, confidence_score, similarity_score, dtw_distance,
        overlay_coordinates_json, normalized_shape_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [
      id,
      captureId,
      pattern.patternName,
      pattern.patternFamily,
      pattern.patternStatus,
      pattern.completionPercentage,
      pattern.breakoutDirection,
      pattern.breakoutProbability,
      pattern.failureProbability,
      pattern.trapProbability,
      pattern.retailTrapScore,
      pattern.institutionalInterpretation,
      pattern.recommendedAction,
      pattern.confidenceScore,
      pattern.similarityScore,
      pattern.dtwDistance,
      pattern.overlayCoordinates,
      pattern.normalizedShape,
      pattern.metadata,
    ]);
  }

  const primaryPatternId = insertedPatternIds[0] ?? null;
  for (const item of result.similarHistory) {
    await queryPostgres(`
      INSERT INTO pattern_similarity_history (
        id, chart_capture_id, pattern_result_id, template_name, template_family, similarity_score,
        dtw_distance, historical_success_rate, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      randomUUID(),
      captureId,
      primaryPatternId,
      item.templateName,
      item.templateFamily,
      item.similarityScore,
      item.dtwDistance,
      item.historicalSuccessRate,
      item.metadata,
    ]);
  }

  const probability = result.probability;
  await queryPostgres(`
    INSERT INTO pattern_probability_snapshots (
      id, chart_capture_id, bullish_breakout_probability, bearish_breakout_probability,
      continuation_probability, reversal_probability, accumulation_probability, distribution_probability,
      manipulation_probability, volatility_compression_score, displacement_score, liquidity_location_score,
      trend_context_score, metadata_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    randomUUID(),
    captureId,
    probability.bullishBreakoutProbability,
    probability.bearishBreakoutProbability,
    probability.continuationProbability,
    probability.reversalProbability,
    probability.accumulationProbability,
    probability.distributionProbability,
    probability.manipulationProbability,
    probability.volatilityCompressionScore,
    probability.displacementScore,
    probability.liquidityLocationScore,
    probability.trendContextScore,
    probability.metadata,
  ]);
}

function summarize(patterns: PatternRecognitionResult[]) {
  const dominant = patterns[0];
  if (!dominant) {
    return {
      dominantPattern: 'none',
      institutionalBias: 'WAIT',
      recommendedAction: 'WAIT',
      confidence: 0,
      explanation: 'No pattern recognition results are available yet.',
    };
  }
  return {
    dominantPattern: dominant.patternName,
    institutionalBias: dominant.institutionalInterpretation,
    recommendedAction: dominant.recommendedAction,
    confidence: dominant.confidenceScore,
    explanation: `${dominant.patternName} is ${Math.round(dominant.completionPercentage * 100)}% complete with ${Math.round(dominant.breakoutProbability * 100)}% ${dominant.breakoutDirection} breakout probability.`,
  };
}

function mapPattern(row: Row): PatternRecognitionResult {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    patternName: String(row.pattern_name),
    patternFamily: String(row.pattern_family),
    patternStatus: String(row.pattern_status),
    completionPercentage: Number(row.completion_percentage),
    breakoutDirection: String(row.breakout_direction),
    breakoutProbability: Number(row.breakout_probability),
    failureProbability: Number(row.failure_probability),
    trapProbability: Number(row.trap_probability),
    retailTrapScore: Number(row.retail_trap_score),
    institutionalInterpretation: String(row.institutional_interpretation),
    recommendedAction: String(row.recommended_action) as PatternRecognitionResult['recommendedAction'],
    confidenceScore: Number(row.confidence_score),
    similarityScore: Number(row.similarity_score),
    dtwDistance: Number(row.dtw_distance),
    overlayCoordinates: objectValue(row.overlay_coordinates_json),
    normalizedShape: objectValue(row.normalized_shape_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapSimilarity(row: Row): PatternSimilarityHistory {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    patternResultId: row.pattern_result_id == null ? null : String(row.pattern_result_id),
    templateName: String(row.template_name),
    templateFamily: String(row.template_family),
    similarityScore: Number(row.similarity_score),
    dtwDistance: Number(row.dtw_distance),
    historicalSuccessRate: Number(row.historical_success_rate),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapProbability(row: Row): PatternProbabilitySnapshot {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    bullishBreakoutProbability: Number(row.bullish_breakout_probability),
    bearishBreakoutProbability: Number(row.bearish_breakout_probability),
    continuationProbability: Number(row.continuation_probability),
    reversalProbability: Number(row.reversal_probability),
    accumulationProbability: Number(row.accumulation_probability),
    distributionProbability: Number(row.distribution_probability),
    manipulationProbability: Number(row.manipulation_probability),
    volatilityCompressionScore: Number(row.volatility_compression_score),
    displacementScore: Number(row.displacement_score),
    liquidityLocationScore: Number(row.liquidity_location_score),
    trendContextScore: Number(row.trend_context_score),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function emptyProbability(captureId: string): PatternProbabilitySnapshot {
  return {
    chartCaptureId: captureId,
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
