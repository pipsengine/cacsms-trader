import { randomUUID } from 'node:crypto';

import {
  analyzeOrderBlocks,
  normalizeOrderBlockInputCandles,
  type OrderBlockAnalysisResult,
  type OrderBlockDetection,
  type OrderBlockMitigationEvent,
} from './order-block-detection-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS order_block_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL,
  origin_candle_index INTEGER NOT NULL,
  displacement_candle_index INTEGER NOT NULL,
  zone_low NUMERIC(18, 6) NOT NULL,
  zone_high NUMERIC(18, 6) NOT NULL,
  open_price NUMERIC(18, 6) NOT NULL,
  close_price NUMERIC(18, 6) NOT NULL,
  invalidation_level NUMERIC(18, 6) NOT NULL,
  mitigation_status TEXT NOT NULL,
  mitigation_percentage NUMERIC(8, 4) NOT NULL,
  displacement_strength NUMERIC(8, 4) NOT NULL,
  body_dominance_score NUMERIC(8, 4) NOT NULL,
  range_expansion_score NUMERIC(8, 4) NOT NULL,
  bos_confirmed BOOLEAN NOT NULL DEFAULT false,
  bos_strength NUMERIC(8, 4) NOT NULL,
  fvg_confirmed BOOLEAN NOT NULL DEFAULT false,
  fvg_score NUMERIC(8, 4) NOT NULL,
  participation_proxy_score NUMERIC(8, 4) NOT NULL,
  freshness_score NUMERIC(8, 4) NOT NULL,
  liquidity_proximity_score NUMERIC(8, 4) NOT NULL,
  htf_alignment_score NUMERIC(8, 4) NOT NULL,
  quality_score NUMERIC(8, 4) NOT NULL,
  institutional_relevance TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_block_mitigation_events (
  id UUID PRIMARY KEY,
  order_block_id UUID NOT NULL REFERENCES order_block_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  mitigation_type TEXT NOT NULL,
  penetration_percentage NUMERIC(8, 4) NOT NULL,
  reaction_score NUMERIC(8, 4) NOT NULL,
  invalidated BOOLEAN NOT NULL DEFAULT false,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_block_feedback (
  id UUID PRIMARY KEY,
  order_block_id UUID NOT NULL REFERENCES order_block_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_blocks_capture_quality ON order_block_detections(chart_capture_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_order_blocks_capture_status ON order_block_detections(chart_capture_id, mitigation_status);
CREATE INDEX IF NOT EXISTS idx_order_block_mitigations_capture ON order_block_mitigation_events(chart_capture_id, candle_index DESC);
CREATE INDEX IF NOT EXISTS idx_order_block_feedback ON order_block_feedback(order_block_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureOrderBlockSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureOrderBlocks(input: ChartCaptureRequest & { captureId?: string }): Promise<OrderBlockAnalysisResult & { captureId: string }> {
  await ensureOrderBlockSchema();
  await publishVisualIntelligenceEvent('order_blocks.analysis.started', input.captureId ?? null, null, { stage: 'order_block_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeOrderBlockInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 12) throw new Error('At least twelve candles are required for order block detection.');

  const result = analyzeOrderBlocks(candles);
  await replaceOrderBlockAnalysis(captureId, result);
  const persisted = await getOrderBlockAnalysis(captureId);
  await publishVisualIntelligenceEvent('order_blocks.analysis.completed', captureId, null, {
    summary: persisted.summary,
    orderBlockCount: persisted.orderBlocks.length,
    mitigationCount: persisted.mitigationEvents.length,
  });
  return persisted;
}

export async function getOrderBlockAnalysis(captureId: string): Promise<OrderBlockAnalysisResult & { captureId: string }> {
  await ensureOrderBlockSchema();
  const [orderBlocks, mitigationEvents] = await Promise.all([
    getOrderBlocks(captureId),
    getMitigationEvents(captureId),
  ]);
  return { captureId, orderBlocks, mitigationEvents, summary: summarize(orderBlocks) };
}

export async function getOrderBlockCoverageMap(): Promise<Record<string, number>> {
  await ensureOrderBlockSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS block_count
    FROM order_block_detections
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.block_count);
  }
  return coverage;
}

export async function getOrderBlocks(captureId: string): Promise<OrderBlockDetection[]> {
  await ensureOrderBlockSchema();
  const result = await queryPostgres(`
    SELECT * FROM order_block_detections
    WHERE chart_capture_id = $1
    ORDER BY quality_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapOrderBlock);
}

export async function getActiveOrderBlocks(captureId: string): Promise<OrderBlockDetection[]> {
  const blocks = await getOrderBlocks(captureId);
  return blocks.filter((block) => ['fresh', 'partial_mitigation'].includes(block.mitigationStatus));
}

export async function getMitigatedOrderBlocks(captureId: string): Promise<OrderBlockDetection[]> {
  const blocks = await getOrderBlocks(captureId);
  return blocks.filter((block) => ['full_mitigation', 'invalidated'].includes(block.mitigationStatus));
}

export async function createOrderBlockFeedback(input: {
  orderBlockId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureOrderBlockSchema();
  const result = await queryPostgres(`
    INSERT INTO order_block_feedback (id, order_block_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.orderBlockId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('order_blocks.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function getMitigationEvents(captureId: string): Promise<OrderBlockMitigationEvent[]> {
  await ensureOrderBlockSchema();
  const result = await queryPostgres(`
    SELECT * FROM order_block_mitigation_events
    WHERE chart_capture_id = $1
    ORDER BY candle_index DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapMitigation);
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceOrderBlockAnalysis(captureId: string, result: OrderBlockAnalysisResult) {
  await queryPostgres('DELETE FROM order_block_mitigation_events WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM order_block_detections WHERE chart_capture_id = $1', [captureId]);

  const idByFallback = new Map<string, string>();
  for (const [index, block] of result.orderBlocks.entries()) {
    const id = randomUUID();
    idByFallback.set(`block-${index}`, id);
    await queryPostgres(`
      INSERT INTO order_block_detections (
        id, chart_capture_id, block_type, origin_candle_index, displacement_candle_index,
        zone_low, zone_high, open_price, close_price, invalidation_level, mitigation_status,
        mitigation_percentage, displacement_strength, body_dominance_score, range_expansion_score,
        bos_confirmed, bos_strength, fvg_confirmed, fvg_score, participation_proxy_score,
        freshness_score, liquidity_proximity_score, htf_alignment_score, quality_score,
        institutional_relevance, recommended_action, ai_explanation, geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
    `, [
      id, captureId, block.blockType, block.originCandleIndex, block.displacementCandleIndex,
      block.zoneLow, block.zoneHigh, block.openPrice, block.closePrice, block.invalidationLevel,
      block.mitigationStatus, block.mitigationPercentage, block.displacementStrength,
      block.bodyDominanceScore, block.rangeExpansionScore, block.bosConfirmed, block.bosStrength,
      block.fvgConfirmed, block.fvgScore, block.participationProxyScore, block.freshnessScore,
      block.liquidityProximityScore, block.htfAlignmentScore, block.qualityScore,
      block.institutionalRelevance, block.recommendedAction, block.aiExplanation,
      block.geometry, block.metadata,
    ]);
  }

  for (const event of result.mitigationEvents) {
    const blockId = idByFallback.get(String(event.orderBlockId)) ?? idByFallback.values().next().value;
    if (!blockId) continue;
    await queryPostgres(`
      INSERT INTO order_block_mitigation_events (
        id, order_block_id, chart_capture_id, candle_index, mitigation_type, penetration_percentage,
        reaction_score, invalidated, explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      randomUUID(), blockId, captureId, event.candleIndex, event.mitigationType,
      event.penetrationPercentage, event.reactionScore, event.invalidated,
      event.explanationText, event.metadata,
    ]);
  }
}

function summarize(blocks: OrderBlockDetection[]) {
  const dominant = blocks[0];
  if (!dominant) {
    return {
      dominantBlock: 'none',
      institutionalBias: 'WAIT',
      recommendedAction: 'WAIT',
      confidence: 0,
      explanation: 'No order blocks are available yet.',
    };
  }
  return {
    dominantBlock: `${dominant.blockType} order block ${dominant.zoneLow}-${dominant.zoneHigh}`,
    institutionalBias: dominant.institutionalRelevance,
    recommendedAction: dominant.recommendedAction,
    confidence: dominant.qualityScore,
    explanation: dominant.aiExplanation,
  };
}

function mapOrderBlock(row: Row): OrderBlockDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    blockType: String(row.block_type) as OrderBlockDetection['blockType'],
    originCandleIndex: Number(row.origin_candle_index),
    displacementCandleIndex: Number(row.displacement_candle_index),
    zoneLow: Number(row.zone_low),
    zoneHigh: Number(row.zone_high),
    openPrice: Number(row.open_price),
    closePrice: Number(row.close_price),
    invalidationLevel: Number(row.invalidation_level),
    mitigationStatus: String(row.mitigation_status) as OrderBlockDetection['mitigationStatus'],
    mitigationPercentage: Number(row.mitigation_percentage),
    displacementStrength: Number(row.displacement_strength),
    bodyDominanceScore: Number(row.body_dominance_score),
    rangeExpansionScore: Number(row.range_expansion_score),
    bosConfirmed: Boolean(row.bos_confirmed),
    bosStrength: Number(row.bos_strength),
    fvgConfirmed: Boolean(row.fvg_confirmed),
    fvgScore: Number(row.fvg_score),
    participationProxyScore: Number(row.participation_proxy_score),
    freshnessScore: Number(row.freshness_score),
    liquidityProximityScore: Number(row.liquidity_proximity_score),
    htfAlignmentScore: Number(row.htf_alignment_score),
    qualityScore: Number(row.quality_score),
    institutionalRelevance: String(row.institutional_relevance),
    recommendedAction: String(row.recommended_action) as OrderBlockDetection['recommendedAction'],
    aiExplanation: String(row.ai_explanation),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapMitigation(row: Row): OrderBlockMitigationEvent {
  return {
    id: String(row.id),
    orderBlockId: String(row.order_block_id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    mitigationType: String(row.mitigation_type),
    penetrationPercentage: Number(row.penetration_percentage),
    reactionScore: Number(row.reaction_score),
    invalidated: Boolean(row.invalidated),
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
