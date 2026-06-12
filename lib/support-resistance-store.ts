import { randomUUID } from 'crypto';

import {
  analyzeSupportResistance,
  normalizeSupportResistanceInputCandles,
  type SupportResistanceAnalysisResult,
  type SupportResistanceLiquidity,
  type SupportResistanceZone,
} from './support-resistance-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS support_resistance_zones (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  zone_type TEXT NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  midpoint_price NUMERIC(18, 6) NOT NULL,
  touch_count INTEGER NOT NULL,
  weighted_touch_score NUMERIC(8, 4) NOT NULL,
  freshness_score NUMERIC(8, 4) NOT NULL,
  wick_rejection_score NUMERIC(8, 4) NOT NULL,
  break_probability NUMERIC(8, 4) NOT NULL,
  retest_probability NUMERIC(8, 4) NOT NULL,
  liquidity_attraction_score NUMERIC(8, 4) NOT NULL,
  psychological_score NUMERIC(8, 4) NOT NULL,
  institutional_defense_score NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  broken_role TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_resistance_liquidity (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES support_resistance_zones(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  liquidity_side TEXT NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  stop_pool_score NUMERIC(8, 4) NOT NULL,
  attraction_score NUMERIC(8, 4) NOT NULL,
  sweep_probability NUMERIC(8, 4) NOT NULL,
  reversal_probability NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_resistance_feedback (
  id UUID PRIMARY KEY,
  zone_id UUID NOT NULL REFERENCES support_resistance_zones(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sr_zones_capture_strength ON support_resistance_zones(chart_capture_id, strength_score DESC);
CREATE INDEX IF NOT EXISTS idx_sr_liquidity_capture ON support_resistance_liquidity(chart_capture_id, attraction_score DESC);
CREATE INDEX IF NOT EXISTS idx_sr_feedback_zone ON support_resistance_feedback(zone_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureSupportResistanceSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureSupportResistance(input: ChartCaptureRequest & { captureId?: string }): Promise<SupportResistanceAnalysisResult & { captureId: string }> {
  await ensureSupportResistanceSchema();
  await publishVisualIntelligenceEvent('support_resistance.analysis.started', input.captureId ?? null, null, { stage: 'support_resistance_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeSupportResistanceInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 8) throw new Error('At least eight candles are required for support/resistance analysis.');

  const result = analyzeSupportResistance(candles);
  await replaceSupportResistanceAnalysis(captureId, result);
  const persisted = await getSupportResistanceAnalysis(captureId);
  await publishVisualIntelligenceEvent('support_resistance.analysis.completed', captureId, null, {
    summary: persisted.summary,
    zoneCount: persisted.zones.length,
    liquidityCount: persisted.liquidity.length,
  });
  return persisted;
}

export async function getSupportResistanceAnalysis(captureId: string): Promise<SupportResistanceAnalysisResult & { captureId: string }> {
  await ensureSupportResistanceSchema();
  const [zones, liquidity] = await Promise.all([
    getSupportResistanceZones(captureId),
    getSupportResistanceLiquidity(captureId),
  ]);
  return { captureId, zones, liquidity, summary: summarize(zones) };
}

export async function getSupportResistanceCoverageMap(): Promise<Record<string, number>> {
  await ensureSupportResistanceSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS zone_count
    FROM support_resistance_zones
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.zone_count);
  }
  return coverage;
}

export async function getSupportResistanceZones(captureId: string): Promise<SupportResistanceZone[]> {
  await ensureSupportResistanceSchema();
  const result = await queryPostgres(`
    SELECT * FROM support_resistance_zones
    WHERE chart_capture_id = $1
    ORDER BY strength_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapZone);
}

export async function getSupportResistanceLiquidity(captureId: string): Promise<SupportResistanceLiquidity[]> {
  await ensureSupportResistanceSchema();
  const result = await queryPostgres(`
    SELECT * FROM support_resistance_liquidity
    WHERE chart_capture_id = $1
    ORDER BY attraction_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapLiquidity);
}

export async function createSupportResistanceFeedback(input: {
  zoneId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureSupportResistanceSchema();
  const result = await queryPostgres(`
    INSERT INTO support_resistance_feedback (id, zone_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.zoneId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('support_resistance.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceSupportResistanceAnalysis(captureId: string, result: SupportResistanceAnalysisResult) {
  await queryPostgres('DELETE FROM support_resistance_liquidity WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM support_resistance_zones WHERE chart_capture_id = $1', [captureId]);

  const idByFallback = new Map<string, string>();
  for (const [index, zone] of result.zones.entries()) {
    const id = randomUUID();
    idByFallback.set(`zone-${index}`, id);
    await queryPostgres(`
      INSERT INTO support_resistance_zones (
        id, chart_capture_id, zone_type, zone_low, zone_high, midpoint_price, touch_count,
        weighted_touch_score, freshness_score, wick_rejection_score, break_probability,
        retest_probability, liquidity_attraction_score, psychological_score, institutional_defense_score,
        strength_score, broken_role, recommended_action, ai_explanation, geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    `, [
      id, captureId, zone.zoneType, zone.zoneLow, zone.zoneHigh, zone.midpointPrice, zone.touchCount,
      zone.weightedTouchScore, zone.freshnessScore, zone.wickRejectionScore, zone.breakProbability,
      zone.retestProbability, zone.liquidityAttractionScore, zone.psychologicalScore,
      zone.institutionalDefenseScore, zone.strengthScore, zone.brokenRole, zone.recommendedAction,
      zone.aiExplanation, zone.geometry, zone.metadata,
    ]);
  }

  for (const item of result.liquidity) {
    const zoneId = idByFallback.get(String(item.zoneId)) ?? idByFallback.values().next().value;
    if (!zoneId) continue;
    await queryPostgres(`
      INSERT INTO support_resistance_liquidity (
        id, zone_id, chart_capture_id, liquidity_side, price_level, stop_pool_score,
        attraction_score, sweep_probability, reversal_probability, explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      randomUUID(), zoneId, captureId, item.liquiditySide, item.priceLevel, item.stopPoolScore,
      item.attractionScore, item.sweepProbability, item.reversalProbability, item.explanationText,
      item.metadata,
    ]);
  }
}

function summarize(zones: SupportResistanceZone[]) {
  const dominant = zones[0];
  if (!dominant) {
    return {
      dominantZone: 'none',
      institutionalBias: 'WAIT',
      recommendedAction: 'WAIT',
      confidence: 0,
      explanation: 'No support/resistance zones are available yet.',
    };
  }
  return {
    dominantZone: `${dominant.zoneType} ${dominant.zoneLow}-${dominant.zoneHigh}`,
    institutionalBias: dominant.aiExplanation,
    recommendedAction: dominant.recommendedAction,
    confidence: dominant.strengthScore,
    explanation: dominant.aiExplanation,
  };
}

function mapZone(row: Row): SupportResistanceZone {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    zoneType: String(row.zone_type) as SupportResistanceZone['zoneType'],
    zoneLow: Number(row.zone_low),
    zoneHigh: Number(row.zone_high),
    midpointPrice: Number(row.midpoint_price),
    touchCount: Number(row.touch_count),
    weightedTouchScore: Number(row.weighted_touch_score),
    freshnessScore: Number(row.freshness_score),
    wickRejectionScore: Number(row.wick_rejection_score),
    breakProbability: Number(row.break_probability),
    retestProbability: Number(row.retest_probability),
    liquidityAttractionScore: Number(row.liquidity_attraction_score),
    psychologicalScore: Number(row.psychological_score),
    institutionalDefenseScore: Number(row.institutional_defense_score),
    strengthScore: Number(row.strength_score),
    brokenRole: String(row.broken_role),
    recommendedAction: String(row.recommended_action) as SupportResistanceZone['recommendedAction'],
    aiExplanation: String(row.ai_explanation),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapLiquidity(row: Row): SupportResistanceLiquidity {
  return {
    id: String(row.id),
    zoneId: String(row.zone_id),
    chartCaptureId: String(row.chart_capture_id),
    liquiditySide: String(row.liquidity_side) as SupportResistanceLiquidity['liquiditySide'],
    priceLevel: Number(row.price_level),
    stopPoolScore: Number(row.stop_pool_score),
    attractionScore: Number(row.attraction_score),
    sweepProbability: Number(row.sweep_probability),
    reversalProbability: Number(row.reversal_probability),
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
