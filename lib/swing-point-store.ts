import { randomUUID } from 'node:crypto';

import {
  analyzeSwingPoints,
  normalizeSwingInputCandles,
  type SwingAnalysisResult,
  type SwingDetection,
  type SwingHierarchyState,
} from './swing-point-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS swing_point_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  swing_kind TEXT NOT NULL,
  swing_category TEXT NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  pixel_x NUMERIC(18, 6) NOT NULL,
  pixel_y NUMERIC(18, 6) NOT NULL,
  depth INTEGER NOT NULL,
  left_strength NUMERIC(8, 4) NOT NULL,
  right_strength NUMERIC(8, 4) NOT NULL,
  atr_validation_score NUMERIC(8, 4) NOT NULL,
  zigzag_validation_score NUMERIC(8, 4) NOT NULL,
  rejection_score NUMERIC(8, 4) NOT NULL,
  continuation_score NUMERIC(8, 4) NOT NULL,
  liquidity_relevance NUMERIC(8, 4) NOT NULL,
  turning_point_probability NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  swept BOOLEAN NOT NULL DEFAULT false,
  structural_importance TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS swing_hierarchy_states (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  hierarchy_level TEXT NOT NULL,
  trend_state TEXT NOT NULL,
  last_structure_high NUMERIC(18, 6),
  last_structure_low NUMERIC(18, 6),
  liquidity_bias TEXT NOT NULL,
  structural_narrative TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS swing_detection_feedback (
  id UUID PRIMARY KEY,
  swing_detection_id UUID NOT NULL REFERENCES swing_point_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureSwingPointSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureSwings(input: ChartCaptureRequest & {
  captureId?: string;
  depths?: number[];
  atrMultiplier?: number;
  zigzagPercent?: number;
}): Promise<SwingAnalysisResult & { captureId: string }> {
  await ensureSwingPointSchema();
  await publishVisualIntelligenceEvent('swings.analysis.started', input.captureId ?? null, null, { stage: 'swing_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeSwingInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 5) throw new Error('At least five candles are required for swing point detection.');

  const result = analyzeSwingPoints(candles, {
    timeframe: input.timeframe,
    depths: input.depths,
    atrMultiplier: input.atrMultiplier,
    zigzagPercent: input.zigzagPercent,
  });

  await replaceSwingAnalysis(captureId, result);
  await publishVisualIntelligenceEvent('swings.analysis.completed', captureId, null, {
    summary: result.summary,
    swingCount: result.swings.length,
    liquidityPivotCount: result.liquidity.length,
  });
  return { ...result, captureId };
}

export async function getSwingAnalysis(captureId: string) {
  await ensureSwingPointSchema();
  const [swings, hierarchy] = await Promise.all([
    getSwingDetections(captureId),
    getSwingHierarchy(captureId),
  ]);
  const liquidity = swings.filter((swing) => swing.liquidityRelevance >= 0.68 || swing.swept);
  return { captureId, swings, hierarchy, liquidity, summary: summarize(swings, hierarchy) };
}

export async function getSwingDetections(captureId: string): Promise<SwingDetection[]> {
  await ensureSwingPointSchema();
  const result = await queryPostgres(`
    SELECT * FROM swing_point_detections
    WHERE chart_capture_id = $1
    ORDER BY candle_index ASC
  `, [captureId]);
  return result.rows.map(mapSwing);
}

export async function getSwingHierarchy(captureId: string): Promise<SwingHierarchyState[]> {
  await ensureSwingPointSchema();
  const result = await queryPostgres(`
    SELECT * FROM swing_hierarchy_states
    WHERE chart_capture_id = $1
    ORDER BY created_at ASC
  `, [captureId]);
  return result.rows.map(mapHierarchy);
}

export async function getSwingLiquidity(captureId: string): Promise<SwingDetection[]> {
  const swings = await getSwingDetections(captureId);
  return swings.filter((swing) => swing.liquidityRelevance >= 0.68 || swing.swept);
}

export async function getSwingCoverageMap(): Promise<Record<string, number>> {
  await ensureSwingPointSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS swing_count
    FROM swing_point_detections
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.swing_count);
  }
  return coverage;
}

export async function createSwingFeedback(input: {
  swingDetectionId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureSwingPointSchema();
  const result = await queryPostgres(`
    INSERT INTO swing_detection_feedback (id, swing_detection_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.swingDetectionId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('swings.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceSwingAnalysis(captureId: string, result: SwingAnalysisResult) {
  await queryPostgres('DELETE FROM swing_point_detections WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM swing_hierarchy_states WHERE chart_capture_id = $1', [captureId]);

  for (const swing of result.swings) {
    await queryPostgres(`
      INSERT INTO swing_point_detections (
        id, chart_capture_id, candle_index, swing_kind, swing_category, price_level, pixel_x, pixel_y, depth,
        left_strength, right_strength, atr_validation_score, zigzag_validation_score, rejection_score,
        continuation_score, liquidity_relevance, turning_point_probability, strength_score, swept,
        structural_importance, ai_explanation, geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    `, [
      randomUUID(), captureId, swing.candleIndex, swing.swingKind, swing.swingCategory, swing.priceLevel,
      swing.pixelX, swing.pixelY, swing.depth, swing.leftStrength, swing.rightStrength, swing.atrValidationScore,
      swing.zigzagValidationScore, swing.rejectionScore, swing.continuationScore, swing.liquidityRelevance,
      swing.turningPointProbability, swing.strengthScore, swing.swept, swing.structuralImportance,
      swing.aiExplanation, swing.geometry, swing.metadata,
    ]);
  }

  for (const hierarchy of result.hierarchy) {
    await queryPostgres(`
      INSERT INTO swing_hierarchy_states (
        id, chart_capture_id, timeframe, hierarchy_level, trend_state, last_structure_high, last_structure_low,
        liquidity_bias, structural_narrative, confidence, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      randomUUID(), captureId, hierarchy.timeframe, hierarchy.hierarchyLevel, hierarchy.trendState,
      hierarchy.lastStructureHigh, hierarchy.lastStructureLow, hierarchy.liquidityBias,
      hierarchy.structuralNarrative, hierarchy.confidence, hierarchy.metadata,
    ]);
  }
}

function summarize(swings: SwingDetection[], hierarchy: SwingHierarchyState[]) {
  const latest = swings.at(-1);
  const institutional = hierarchy.find((item) => item.hierarchyLevel === 'institutional_structure');
  return {
    trendState: institutional?.trendState ?? 'unknown',
    dominantSwing: latest ? `${latest.swingCategory} ${latest.swingKind}` : 'none',
    structuralBias: institutional?.liquidityBias ?? 'unknown',
    confidence: institutional?.confidence ?? latest?.turningPointProbability ?? 0,
    explanation: latest?.aiExplanation ?? institutional?.structuralNarrative ?? 'No swing analysis is available yet.',
  };
}

function mapSwing(row: Row): SwingDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    swingKind: String(row.swing_kind) as SwingDetection['swingKind'],
    swingCategory: String(row.swing_category),
    priceLevel: Number(row.price_level),
    pixelX: Number(row.pixel_x),
    pixelY: Number(row.pixel_y),
    depth: Number(row.depth),
    leftStrength: Number(row.left_strength),
    rightStrength: Number(row.right_strength),
    atrValidationScore: Number(row.atr_validation_score),
    zigzagValidationScore: Number(row.zigzag_validation_score),
    rejectionScore: Number(row.rejection_score),
    continuationScore: Number(row.continuation_score),
    liquidityRelevance: Number(row.liquidity_relevance),
    turningPointProbability: Number(row.turning_point_probability),
    strengthScore: Number(row.strength_score),
    swept: Boolean(row.swept),
    structuralImportance: String(row.structural_importance),
    aiExplanation: String(row.ai_explanation),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapHierarchy(row: Row): SwingHierarchyState {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    timeframe: String(row.timeframe),
    hierarchyLevel: String(row.hierarchy_level),
    trendState: String(row.trend_state),
    lastStructureHigh: nullableNumber(row.last_structure_high),
    lastStructureLow: nullableNumber(row.last_structure_low),
    liquidityBias: String(row.liquidity_bias),
    structuralNarrative: String(row.structural_narrative),
    confidence: Number(row.confidence),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
