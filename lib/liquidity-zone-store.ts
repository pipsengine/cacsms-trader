import { randomUUID } from 'crypto';

import {
  analyzeLiquidityZones,
  normalizeLiquidityInputCandles,
  type LiquidityAnalysisResult,
  type LiquiditySweepEvent,
  type LiquidityVoidDetection,
  type LiquidityZoneDetection,
} from './liquidity-zone-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS liquidity_zone_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  liquidity_type TEXT NOT NULL,
  liquidity_side TEXT NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  equal_level_count INTEGER NOT NULL,
  stop_cluster_score NUMERIC(8, 4) NOT NULL,
  obvious_retail_score NUMERIC(8, 4) NOT NULL,
  sweep_status TEXT NOT NULL,
  sweep_quality_score NUMERIC(8, 4) NOT NULL,
  inducement_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  trap_probability NUMERIC(8, 4) NOT NULL,
  volatility_expansion_score NUMERIC(8, 4) NOT NULL,
  session_timing_score NUMERIC(8, 4) NOT NULL,
  institutional_narrative TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS liquidity_sweep_events (
  id UUID PRIMARY KEY,
  liquidity_zone_id UUID NOT NULL REFERENCES liquidity_zone_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  sweep_direction TEXT NOT NULL,
  swept_price_level NUMERIC(18, 6) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  close_failure_score NUMERIC(8, 4) NOT NULL,
  displacement_reversal_score NUMERIC(8, 4) NOT NULL,
  sweep_quality_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS liquidity_void_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  void_direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  inefficiency_score NUMERIC(8, 4) NOT NULL,
  rebalance_probability NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS liquidity_detection_feedback (
  id UUID PRIMARY KEY,
  liquidity_zone_id UUID NOT NULL REFERENCES liquidity_zone_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_liquidity_zones_capture_confidence ON liquidity_zone_detections(chart_capture_id, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_sweeps_capture ON liquidity_sweep_events(chart_capture_id, sweep_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_voids_capture ON liquidity_void_detections(chart_capture_id, inefficiency_score DESC);
CREATE INDEX IF NOT EXISTS idx_liquidity_feedback_zone ON liquidity_detection_feedback(liquidity_zone_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureLiquiditySchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureLiquidity(input: ChartCaptureRequest & { captureId?: string }): Promise<LiquidityAnalysisResult & { captureId: string }> {
  await ensureLiquiditySchema();
  await publishVisualIntelligenceEvent('liquidity.analysis.started', input.captureId ?? null, null, { stage: 'liquidity_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeLiquidityInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 8) throw new Error('At least eight candles are required for liquidity detection.');

  const result = analyzeLiquidityZones(candles);
  await replaceLiquidityAnalysis(captureId, result);
  const persisted = await getLiquidityAnalysis(captureId);
  await publishVisualIntelligenceEvent('liquidity.analysis.completed', captureId, null, {
    summary: persisted.summary,
    zoneCount: persisted.liquidityZones.length,
    sweepCount: persisted.sweeps.length,
    voidCount: persisted.voids.length,
  });
  return persisted;
}

export async function getLiquidityAnalysis(captureId: string): Promise<LiquidityAnalysisResult & { captureId: string }> {
  await ensureLiquiditySchema();
  const [liquidityZones, sweeps, voids] = await Promise.all([
    getLiquidityZones(captureId),
    getLiquiditySweeps(captureId),
    getLiquidityVoids(captureId),
  ]);
  return { captureId, liquidityZones, sweeps, voids, summary: summarize(liquidityZones) };
}

export async function getLiquidityZones(captureId: string): Promise<LiquidityZoneDetection[]> {
  await ensureLiquiditySchema();
  const result = await queryPostgres(`
    SELECT * FROM liquidity_zone_detections
    WHERE chart_capture_id = $1
    ORDER BY confidence_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapZone);
}

export async function getLiquiditySweeps(captureId: string): Promise<LiquiditySweepEvent[]> {
  await ensureLiquiditySchema();
  const result = await queryPostgres(`
    SELECT * FROM liquidity_sweep_events
    WHERE chart_capture_id = $1
    ORDER BY sweep_quality_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapSweep);
}

export async function getLiquidityVoids(captureId: string): Promise<LiquidityVoidDetection[]> {
  await ensureLiquiditySchema();
  const result = await queryPostgres(`
    SELECT * FROM liquidity_void_detections
    WHERE chart_capture_id = $1
    ORDER BY inefficiency_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapVoid);
}

export async function createLiquidityFeedback(input: {
  liquidityZoneId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureLiquiditySchema();
  const result = await queryPostgres(`
    INSERT INTO liquidity_detection_feedback (id, liquidity_zone_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.liquidityZoneId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('liquidity.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceLiquidityAnalysis(captureId: string, result: LiquidityAnalysisResult) {
  await queryPostgres('DELETE FROM liquidity_sweep_events WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM liquidity_void_detections WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM liquidity_zone_detections WHERE chart_capture_id = $1', [captureId]);

  const idByFallback = new Map<string, string>();
  for (const [index, zone] of result.liquidityZones.entries()) {
    const id = randomUUID();
    idByFallback.set(`zone-${index}`, id);
    await queryPostgres(`
      INSERT INTO liquidity_zone_detections (
        id, chart_capture_id, liquidity_type, liquidity_side, zone_low, zone_high, price_level,
        equal_level_count, stop_cluster_score, obvious_retail_score, sweep_status, sweep_quality_score,
        inducement_score, manipulation_score, trap_probability, volatility_expansion_score,
        session_timing_score, institutional_narrative, recommended_action, confidence_score,
        geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    `, [
      id, captureId, zone.liquidityType, zone.liquiditySide, zone.zoneLow, zone.zoneHigh, zone.priceLevel,
      zone.equalLevelCount, zone.stopClusterScore, zone.obviousRetailScore, zone.sweepStatus,
      zone.sweepQualityScore, zone.inducementScore, zone.manipulationScore, zone.trapProbability,
      zone.volatilityExpansionScore, zone.sessionTimingScore, zone.institutionalNarrative,
      zone.recommendedAction, zone.confidenceScore, zone.geometry, zone.metadata,
    ]);
  }

  for (const sweep of result.sweeps) {
    const zoneId = idByFallback.get(String(sweep.liquidityZoneId)) ?? idByFallback.values().next().value;
    if (!zoneId) continue;
    await queryPostgres(`
      INSERT INTO liquidity_sweep_events (
        id, liquidity_zone_id, chart_capture_id, candle_index, sweep_direction, swept_price_level,
        wick_rejection_score, close_failure_score, displacement_reversal_score, sweep_quality_score,
        explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [
      randomUUID(), zoneId, captureId, sweep.candleIndex, sweep.sweepDirection, sweep.sweptPriceLevel,
      sweep.wickRejectionScore, sweep.closeFailureScore, sweep.displacementReversalScore,
      sweep.sweepQualityScore, sweep.explanationText, sweep.metadata,
    ]);
  }

  for (const item of result.voids) {
    await queryPostgres(`
      INSERT INTO liquidity_void_detections (
        id, chart_capture_id, void_direction, start_candle_index, end_candle_index, zone_low,
        zone_high, inefficiency_score, rebalance_probability, displacement_score, explanation_text,
        geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      randomUUID(), captureId, item.voidDirection, item.startCandleIndex, item.endCandleIndex,
      item.zoneLow, item.zoneHigh, item.inefficiencyScore, item.rebalanceProbability,
      item.displacementScore, item.explanationText, item.geometry, item.metadata,
    ]);
  }
}

function summarize(zones: LiquidityZoneDetection[]) {
  const dominant = zones[0];
  if (!dominant) {
    return {
      dominantLiquidity: 'none',
      institutionalBias: 'WAIT',
      recommendedAction: 'WAIT',
      confidence: 0,
      explanation: 'No liquidity zones are available yet.',
    };
  }
  return {
    dominantLiquidity: `${dominant.liquiditySide} ${dominant.priceLevel}`,
    institutionalBias: dominant.institutionalNarrative,
    recommendedAction: dominant.recommendedAction,
    confidence: dominant.confidenceScore,
    explanation: dominant.institutionalNarrative,
  };
}

function mapZone(row: Row): LiquidityZoneDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    liquidityType: String(row.liquidity_type),
    liquiditySide: String(row.liquidity_side) as LiquidityZoneDetection['liquiditySide'],
    zoneLow: Number(row.zone_low),
    zoneHigh: Number(row.zone_high),
    priceLevel: Number(row.price_level),
    equalLevelCount: Number(row.equal_level_count),
    stopClusterScore: Number(row.stop_cluster_score),
    obviousRetailScore: Number(row.obvious_retail_score),
    sweepStatus: String(row.sweep_status),
    sweepQualityScore: Number(row.sweep_quality_score),
    inducementScore: Number(row.inducement_score),
    manipulationScore: Number(row.manipulation_score),
    trapProbability: Number(row.trap_probability),
    volatilityExpansionScore: Number(row.volatility_expansion_score),
    sessionTimingScore: Number(row.session_timing_score),
    institutionalNarrative: String(row.institutional_narrative),
    recommendedAction: String(row.recommended_action) as LiquidityZoneDetection['recommendedAction'],
    confidenceScore: Number(row.confidence_score),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapSweep(row: Row): LiquiditySweepEvent {
  return {
    id: String(row.id),
    liquidityZoneId: String(row.liquidity_zone_id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    sweepDirection: String(row.sweep_direction) as LiquiditySweepEvent['sweepDirection'],
    sweptPriceLevel: Number(row.swept_price_level),
    wickRejectionScore: Number(row.wick_rejection_score),
    closeFailureScore: Number(row.close_failure_score),
    displacementReversalScore: Number(row.displacement_reversal_score),
    sweepQualityScore: Number(row.sweep_quality_score),
    explanationText: String(row.explanation_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapVoid(row: Row): LiquidityVoidDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    voidDirection: String(row.void_direction) as LiquidityVoidDetection['voidDirection'],
    startCandleIndex: Number(row.start_candle_index),
    endCandleIndex: Number(row.end_candle_index),
    zoneLow: Number(row.zone_low),
    zoneHigh: Number(row.zone_high),
    inefficiencyScore: Number(row.inefficiency_score),
    rebalanceProbability: Number(row.rebalance_probability),
    displacementScore: Number(row.displacement_score),
    explanationText: String(row.explanation_text),
    geometry: objectValue(row.geometry_json),
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
