import { randomUUID } from 'node:crypto';

import { analyzeCandles, normalizeInputCandles, type CandleAnalysisResult, type CandleClassification, type CandleSequenceAnalysis } from './candle-detection-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle, VisionCandleInput } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS candle_classifications (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  reconstructed_candle_id UUID REFERENCES reconstructed_candles(id) ON DELETE SET NULL,
  candle_index INTEGER NOT NULL,
  detected_candle_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  trading_meaning TEXT NOT NULL,
  implication TEXT NOT NULL,
  supports_decision TEXT NOT NULL,
  body_strength_score NUMERIC(8, 4) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  momentum_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  institutional_displacement_score NUMERIC(8, 4) NOT NULL,
  candle_reliability_score NUMERIC(8, 4) NOT NULL,
  final_confidence_score NUMERIC(8, 4) NOT NULL,
  risk_warning TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS candle_sequence_analyses (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  sequence_start_index INTEGER NOT NULL,
  sequence_end_index INTEGER NOT NULL,
  detected_sequence_type TEXT NOT NULL,
  phase_state TEXT NOT NULL,
  momentum_state TEXT NOT NULL,
  implication TEXT NOT NULL,
  supports_decision TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  risk_warning TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS candle_classification_feedback (
  id UUID PRIMARY KEY,
  candle_classification_id UUID NOT NULL REFERENCES candle_classifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureCandleDetectionSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export async function analyzeCaptureCandles(input: ChartCaptureRequest & { captureId?: string }): Promise<CandleAnalysisResult & { captureId: string }> {
  await ensureCandleDetectionSchema();
  await publishVisualIntelligenceEvent('candles.analysis.started', input.captureId ?? null, null, { stage: 'candle_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);

  if (candles.length === 0) {
    throw new Error('No candles available. Provide candles or run chart capture analysis first.');
  }

  await publishVisualIntelligenceEvent('candles.body_detection.completed', captureId, null, { candles: candles.length });
  const result = analyzeCandles(candles);
  await replaceCandleAnalysis(captureId, candles, result);
  await publishVisualIntelligenceEvent('candles.analysis.completed', captureId, null, {
    summary: result.summary,
    classifications: result.classifications.length,
    sequences: result.sequences.length,
  });

  return { ...result, captureId };
}

export async function getCandleAnalysis(captureId: string) {
  await ensureCandleDetectionSchema();
  const [classifications, sequences] = await Promise.all([
    getCandleClassifications(captureId),
    getCandleSequences(captureId),
  ]);
  return {
    captureId,
    classifications,
    sequences,
    summary: summarize(classifications, sequences),
  };
}

export async function getCandleClassifications(captureId: string): Promise<CandleClassification[]> {
  await ensureCandleDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM candle_classifications
    WHERE chart_capture_id = $1
    ORDER BY candle_index ASC
  `, [captureId]);
  return result.rows.map(mapClassification);
}

export async function getCandleCoverageMap(): Promise<Record<string, number>> {
  await ensureCandleDetectionSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS classification_count
    FROM candle_classifications
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.classification_count);
  }
  return coverage;
}

export async function getCandleSequences(captureId: string): Promise<CandleSequenceAnalysis[]> {
  await ensureCandleDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM candle_sequence_analyses
    WHERE chart_capture_id = $1
    ORDER BY sequence_start_index ASC
  `, [captureId]);
  return result.rows.map(mapSequence);
}

export async function createCandleFeedback(input: {
  candleClassificationId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureCandleDetectionSchema();
  const result = await queryPostgres(`
    INSERT INTO candle_classification_feedback (id, candle_classification_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.candleClassificationId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('candles.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceCandleAnalysis(captureId: string, candles: ReconstructedCandle[], result: CandleAnalysisResult) {
  await queryPostgres('DELETE FROM candle_classifications WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM candle_sequence_analyses WHERE chart_capture_id = $1', [captureId]);

  const candleIdByIndex = new Map(candles.map((candle) => [candle.candleIndex, candle.id ?? null]));

  for (const item of result.classifications) {
    await queryPostgres(`
      INSERT INTO candle_classifications (
        id, chart_capture_id, reconstructed_candle_id, candle_index, detected_candle_type, direction,
        trading_meaning, implication, supports_decision, body_strength_score, wick_rejection_score,
        momentum_score, manipulation_score, institutional_displacement_score, candle_reliability_score,
        final_confidence_score, risk_warning, explanation_text, geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    `, [
      randomUUID(),
      captureId,
      candleIdByIndex.get(item.candleIndex) ?? null,
      item.candleIndex,
      item.detectedCandleType,
      item.direction,
      item.tradingMeaning,
      item.implication,
      item.supportsDecision,
      item.bodyStrengthScore,
      item.wickRejectionScore,
      item.momentumScore,
      item.manipulationScore,
      item.institutionalDisplacementScore,
      item.candleReliabilityScore,
      item.finalConfidenceScore,
      item.riskWarning,
      item.explanationText,
      item.geometry,
      item.metadata,
    ]);
  }

  for (const item of result.sequences) {
    await queryPostgres(`
      INSERT INTO candle_sequence_analyses (
        id, chart_capture_id, sequence_start_index, sequence_end_index, detected_sequence_type,
        phase_state, momentum_state, implication, supports_decision, confidence, risk_warning,
        explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      randomUUID(),
      captureId,
      item.sequenceStartIndex,
      item.sequenceEndIndex,
      item.detectedSequenceType,
      item.phaseState,
      item.momentumState,
      item.implication,
      item.supportsDecision,
      item.confidence,
      item.riskWarning,
      item.explanationText,
      item.metadata,
    ]);
  }
}

function summarize(classifications: CandleClassification[], sequences: CandleSequenceAnalysis[]) {
  const latestSequence = sequences.at(-1);
  const latest = classifications.at(-1);
  return {
    dominantType: latestSequence?.detectedSequenceType ?? latest?.detectedCandleType ?? 'none',
    dominantDirection: latest?.direction ?? 'neutral',
    recommendedDecision: latestSequence?.supportsDecision ?? latest?.supportsDecision ?? 'WAIT',
    confidence: latestSequence?.confidence ?? latest?.finalConfidenceScore ?? 0,
    explanation: latestSequence?.explanationText ?? latest?.explanationText ?? 'No candle classifications are available yet.',
  };
}

function mapClassification(row: Row): CandleClassification {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    reconstructedCandleId: row.reconstructed_candle_id == null ? null : String(row.reconstructed_candle_id),
    candleIndex: Number(row.candle_index),
    detectedCandleType: String(row.detected_candle_type),
    direction: String(row.direction),
    tradingMeaning: String(row.trading_meaning),
    implication: String(row.implication),
    supportsDecision: String(row.supports_decision) as CandleClassification['supportsDecision'],
    bodyStrengthScore: Number(row.body_strength_score),
    wickRejectionScore: Number(row.wick_rejection_score),
    momentumScore: Number(row.momentum_score),
    manipulationScore: Number(row.manipulation_score),
    institutionalDisplacementScore: Number(row.institutional_displacement_score),
    candleReliabilityScore: Number(row.candle_reliability_score),
    finalConfidenceScore: Number(row.final_confidence_score),
    riskWarning: String(row.risk_warning),
    explanationText: String(row.explanation_text),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapSequence(row: Row): CandleSequenceAnalysis {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    sequenceStartIndex: Number(row.sequence_start_index),
    sequenceEndIndex: Number(row.sequence_end_index),
    detectedSequenceType: String(row.detected_sequence_type),
    phaseState: String(row.phase_state),
    momentumState: String(row.momentum_state),
    implication: String(row.implication),
    supportsDecision: String(row.supports_decision) as CandleSequenceAnalysis['supportsDecision'],
    confidence: Number(row.confidence),
    riskWarning: String(row.risk_warning),
    explanationText: String(row.explanation_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
