import { randomUUID } from 'crypto';

import {
  analyzeTrendlines,
  normalizeTrendlineInputCandles,
  type TrendlineAnalysisResult,
  type TrendlineBreakEvent,
  type TrendlineDetection,
  type TrendlineRetestEvent,
} from './trendline-detection-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS trendline_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  trendline_kind TEXT NOT NULL,
  direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  start_price NUMERIC(18, 6) NOT NULL,
  end_price NUMERIC(18, 6) NOT NULL,
  start_pixel_x NUMERIC(18, 6) NOT NULL,
  start_pixel_y NUMERIC(18, 6) NOT NULL,
  end_pixel_x NUMERIC(18, 6) NOT NULL,
  end_pixel_y NUMERIC(18, 6) NOT NULL,
  slope NUMERIC(18, 8) NOT NULL,
  normalized_slope NUMERIC(8, 4) NOT NULL,
  slope_state TEXT NOT NULL,
  touch_count INTEGER NOT NULL,
  validity_score NUMERIC(8, 4) NOT NULL,
  respect_score NUMERIC(8, 4) NOT NULL,
  spacing_score NUMERIC(8, 4) NOT NULL,
  break_probability NUMERIC(8, 4) NOT NULL,
  retest_probability NUMERIC(8, 4) NOT NULL,
  trap_risk NUMERIC(8, 4) NOT NULL,
  break_status TEXT NOT NULL,
  retest_status TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trendline_break_events (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  break_direction TEXT NOT NULL,
  break_quality_score NUMERIC(8, 4) NOT NULL,
  false_break_probability NUMERIC(8, 4) NOT NULL,
  liquidity_grab_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trendline_retest_events (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  retest_quality_score NUMERIC(8, 4) NOT NULL,
  continuation_probability NUMERIC(8, 4) NOT NULL,
  rejection_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trendline_detection_feedback (
  id UUID PRIMARY KEY,
  trendline_id UUID NOT NULL REFERENCES trendline_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trendlines_capture_validity ON trendline_detections(chart_capture_id, validity_score DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_breaks_capture ON trendline_break_events(chart_capture_id, break_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_retests_capture ON trendline_retest_events(chart_capture_id, continuation_probability DESC);
CREATE INDEX IF NOT EXISTS idx_trendline_feedback ON trendline_detection_feedback(trendline_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureTrendlineDetectionSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureTrendlines(input: ChartCaptureRequest & { captureId?: string }): Promise<TrendlineAnalysisResult & { captureId: string }> {
  await ensureTrendlineDetectionSchema();
  await publishVisualIntelligenceEvent('trendlines.analysis.started', input.captureId ?? null, null, { stage: 'trendline_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeTrendlineInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 8) throw new Error('At least eight candles are required for trendline detection.');

  const result = analyzeTrendlines(candles);
  await replaceTrendlineAnalysis(captureId, result);
  const persisted = await getTrendlineAnalysis(captureId);
  await publishVisualIntelligenceEvent('trendlines.analysis.completed', captureId, null, {
    summary: persisted.summary,
    trendlineCount: persisted.trendlines.length,
    breakCount: persisted.breaks.length,
    retestCount: persisted.retests.length,
  });
  return persisted;
}

export async function getTrendlineAnalysis(captureId: string): Promise<TrendlineAnalysisResult & { captureId: string }> {
  await ensureTrendlineDetectionSchema();
  const [trendlines, breaks, retests] = await Promise.all([
    getTrendlineDetections(captureId),
    getTrendlineBreaks(captureId),
    getTrendlineRetests(captureId),
  ]);
  return { captureId, trendlines, breaks, retests, summary: summarize(trendlines) };
}

export async function getTrendlineCoverageMap(): Promise<Record<string, number>> {
  await ensureTrendlineDetectionSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS trendline_count
    FROM trendline_detections
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.trendline_count);
  }
  return coverage;
}

export async function getTrendlineDetections(captureId: string): Promise<TrendlineDetection[]> {
  await ensureTrendlineDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM trendline_detections
    WHERE chart_capture_id = $1
    ORDER BY validity_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapTrendline);
}

export async function getTrendlineBreaks(captureId: string): Promise<TrendlineBreakEvent[]> {
  await ensureTrendlineDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM trendline_break_events
    WHERE chart_capture_id = $1
    ORDER BY break_quality_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapBreak);
}

export async function getTrendlineRetests(captureId: string): Promise<TrendlineRetestEvent[]> {
  await ensureTrendlineDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM trendline_retest_events
    WHERE chart_capture_id = $1
    ORDER BY continuation_probability DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapRetest);
}

export async function createTrendlineFeedback(input: {
  trendlineId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureTrendlineDetectionSchema();
  const result = await queryPostgres(`
    INSERT INTO trendline_detection_feedback (id, trendline_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.trendlineId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('trendlines.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceTrendlineAnalysis(captureId: string, result: TrendlineAnalysisResult) {
  await queryPostgres('DELETE FROM trendline_retest_events WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM trendline_break_events WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM trendline_detections WHERE chart_capture_id = $1', [captureId]);

  const idByFallback = new Map<string, string>();
  for (const [index, line] of result.trendlines.entries()) {
    const id = randomUUID();
    idByFallback.set(`line-${index}`, id);
    await queryPostgres(`
      INSERT INTO trendline_detections (
        id, chart_capture_id, trendline_kind, direction, start_candle_index, end_candle_index,
        start_price, end_price, start_pixel_x, start_pixel_y, end_pixel_x, end_pixel_y, slope,
        normalized_slope, slope_state, touch_count, validity_score, respect_score, spacing_score,
        break_probability, retest_probability, trap_risk, break_status, retest_status, ai_explanation,
        geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
    `, [
      id, captureId, line.trendlineKind, line.direction, line.startCandleIndex, line.endCandleIndex,
      line.startPrice, line.endPrice, line.startPixelX, line.startPixelY, line.endPixelX, line.endPixelY,
      line.slope, line.normalizedSlope, line.slopeState, line.touchCount, line.validityScore, line.respectScore,
      line.spacingScore, line.breakProbability, line.retestProbability, line.trapRisk, line.breakStatus,
      line.retestStatus, line.aiExplanation, line.geometry, line.metadata,
    ]);
  }

  for (const item of result.breaks) {
    const trendlineId = idByFallback.get(String(item.trendlineId)) ?? idByFallback.values().next().value;
    if (!trendlineId) continue;
    await queryPostgres(`
      INSERT INTO trendline_break_events (
        id, trendline_id, chart_capture_id, candle_index, break_direction, break_quality_score,
        false_break_probability, liquidity_grab_score, explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      randomUUID(), trendlineId, captureId, item.candleIndex, item.breakDirection, item.breakQualityScore,
      item.falseBreakProbability, item.liquidityGrabScore, item.explanationText, item.metadata,
    ]);
  }

  for (const item of result.retests) {
    const trendlineId = idByFallback.get(String(item.trendlineId)) ?? idByFallback.values().next().value;
    if (!trendlineId) continue;
    await queryPostgres(`
      INSERT INTO trendline_retest_events (
        id, trendline_id, chart_capture_id, candle_index, retest_quality_score, continuation_probability,
        rejection_score, explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      randomUUID(), trendlineId, captureId, item.candleIndex, item.retestQualityScore, item.continuationProbability,
      item.rejectionScore, item.explanationText, item.metadata,
    ]);
  }
}

function summarize(trendlines: TrendlineDetection[]) {
  const dominant = trendlines[0];
  if (!dominant) {
    return {
      dominantTrendline: 'none',
      directionalBias: 'WAIT',
      confidence: 0,
      explanation: 'No trendline analysis is available yet.',
    };
  }
  return {
    dominantTrendline: dominant.trendlineKind,
    directionalBias: dominant.direction === 'bullish' ? 'BUY_CONTEXT' : dominant.direction === 'bearish' ? 'SELL_CONTEXT' : 'WAIT',
    confidence: dominant.validityScore,
    explanation: dominant.aiExplanation,
  };
}

function mapTrendline(row: Row): TrendlineDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    trendlineKind: String(row.trendline_kind),
    direction: String(row.direction) as TrendlineDetection['direction'],
    startCandleIndex: Number(row.start_candle_index),
    endCandleIndex: Number(row.end_candle_index),
    startPrice: Number(row.start_price),
    endPrice: Number(row.end_price),
    startPixelX: Number(row.start_pixel_x),
    startPixelY: Number(row.start_pixel_y),
    endPixelX: Number(row.end_pixel_x),
    endPixelY: Number(row.end_pixel_y),
    slope: Number(row.slope),
    normalizedSlope: Number(row.normalized_slope),
    slopeState: String(row.slope_state),
    touchCount: Number(row.touch_count),
    validityScore: Number(row.validity_score),
    respectScore: Number(row.respect_score),
    spacingScore: Number(row.spacing_score),
    breakProbability: Number(row.break_probability),
    retestProbability: Number(row.retest_probability),
    trapRisk: Number(row.trap_risk),
    breakStatus: String(row.break_status),
    retestStatus: String(row.retest_status),
    aiExplanation: String(row.ai_explanation),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapBreak(row: Row): TrendlineBreakEvent {
  return {
    id: String(row.id),
    trendlineId: String(row.trendline_id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    breakDirection: String(row.break_direction),
    breakQualityScore: Number(row.break_quality_score),
    falseBreakProbability: Number(row.false_break_probability),
    liquidityGrabScore: Number(row.liquidity_grab_score),
    explanationText: String(row.explanation_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapRetest(row: Row): TrendlineRetestEvent {
  return {
    id: String(row.id),
    trendlineId: String(row.trendline_id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    retestQualityScore: Number(row.retest_quality_score),
    continuationProbability: Number(row.continuation_probability),
    rejectionScore: Number(row.rejection_score),
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
