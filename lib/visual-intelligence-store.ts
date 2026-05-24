import { randomUUID } from 'crypto';

import { queryPostgres } from './postgres';
import {
  analyzeCapture,
  buildInitialCapture,
  buildInitialJob,
  normalizeCaptureRequest,
} from './visual-intelligence-engine';
import type {
  AiDecisionOutput,
  ChartCaptureRecord,
  ChartCaptureRequest,
  MarketStructureState,
  ModelConfidenceScore,
  ReconstructedCandle,
  VisionAnalysisResult,
  VisionDetection,
  VisionJobRecord,
} from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS chart_captures (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  image_url TEXT NOT NULL,
  image_hash TEXT NOT NULL,
  capture_type TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status TEXT NOT NULL DEFAULT 'queued',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS vision_analysis_jobs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  model_version TEXT NOT NULL DEFAULT 'vision-institutional-v1',
  processing_time_ms INTEGER
);
CREATE TABLE IF NOT EXISTS reconstructed_candles (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  candle_index INTEGER NOT NULL,
  open_price NUMERIC(18, 6) NOT NULL,
  high_price NUMERIC(18, 6) NOT NULL,
  low_price NUMERIC(18, 6) NOT NULL,
  close_price NUMERIC(18, 6) NOT NULL,
  pixel_x NUMERIC(18, 6) NOT NULL,
  pixel_y_open NUMERIC(18, 6) NOT NULL,
  pixel_y_high NUMERIC(18, 6) NOT NULL,
  pixel_y_low NUMERIC(18, 6) NOT NULL,
  pixel_y_close NUMERIC(18, 6) NOT NULL,
  direction TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL
);
CREATE TABLE IF NOT EXISTS vision_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  detection_type TEXT NOT NULL,
  detection_name TEXT NOT NULL,
  direction TEXT,
  price_level NUMERIC(18, 6),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  bounding_box_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(8, 4) NOT NULL,
  strength_score NUMERIC(8, 4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS market_structure_states (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  trend_state TEXT NOT NULL,
  phase_state TEXT NOT NULL,
  last_bos_direction TEXT,
  last_choch_direction TEXT,
  liquidity_bias TEXT NOT NULL,
  institutional_bias TEXT NOT NULL,
  retail_bias TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_decision_outputs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  decision TEXT NOT NULL,
  bias TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  entry_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_loss NUMERIC(18, 6),
  take_profit_1 NUMERIC(18, 6),
  take_profit_2 NUMERIC(18, 6),
  risk_reward_ratio NUMERIC(10, 4),
  invalidation_level NUMERIC(18, 6),
  reasoning_text TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_confidence_scores (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES vision_analysis_jobs(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  raw_score NUMERIC(8, 4) NOT NULL,
  calibrated_score NUMERIC(8, 4) NOT NULL,
  uncertainty_score NUMERIC(8, 4) NOT NULL,
  final_confidence NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY,
  detection_id UUID NOT NULL REFERENCES vision_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_performance_history (
  id UUID PRIMARY KEY,
  model_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  detection_type TEXT NOT NULL,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  successful_predictions INTEGER NOT NULL DEFAULT 0,
  false_positives INTEGER NOT NULL DEFAULT 0,
  false_negatives INTEGER NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  precision_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  recall_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visual_intelligence_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  chart_capture_id UUID,
  job_id UUID,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureVisualIntelligenceSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql).then(() => undefined);
  }
  return schemaReady;
}

export async function createCaptureAndRunAnalysis(input: ChartCaptureRequest): Promise<VisionAnalysisResult> {
  await ensureVisualIntelligenceSchema();
  const normalized = normalizeCaptureRequest(input);
  const capture = buildInitialCapture(input);
  const job = buildInitialJob(capture.id, normalized.jobType);

  await insertCapture(capture);
  await insertJob(job);
  await publishEvent('capture_created', capture.id, job.id, { capture, job });

  const startedAt = Date.now();
  const startedAtIso = new Date().toISOString();
  await updateJob(job.id, { status: 'running', progress: 15, startedAt: startedAtIso });
  await updateCaptureStatus(capture.id, 'processing');
  await publishEvent('job_progress', capture.id, job.id, { progress: 15, stage: 'image_preprocessing' });

  const result = analyzeCapture(capture, { ...job, status: 'running', progress: 15, startedAt: startedAtIso }, normalized.candles);

  await publishEvent('job_progress', capture.id, job.id, { progress: 45, stage: 'candle_reconstruction', candles: result.candles.length });
  await replaceCandles(capture.id, result.candles);
  await publishEvent('job_progress', capture.id, job.id, { progress: 70, stage: 'institutional_detection', detections: result.detections.length });
  await replaceDetections(capture.id, result.detections);
  await insertMarketStructure(result.structureState);
  await insertDecision(capture.id, result.decision);
  await replaceConfidenceScores(job.id, result.confidenceScores);

  const completedAt = new Date().toISOString();
  const processingTimeMs = Date.now() - startedAt;
  await updateJob(job.id, { status: 'completed', progress: 100, completedAt, processingTimeMs });
  await updateCaptureStatus(capture.id, 'completed');
  await publishEvent('analysis_completed', capture.id, job.id, {
    detections: result.detections,
    structureState: result.structureState,
    decision: result.decision,
    processingTimeMs,
  });

  return {
    ...result,
    job: { ...job, status: 'completed', progress: 100, completedAt, startedAt: startedAtIso, processingTimeMs },
  };
}

export async function listCaptures(limit = 50) {
  await ensureVisualIntelligenceSchema();
  const result = await queryPostgres(`
    SELECT * FROM chart_captures
    ORDER BY captured_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map(mapCapture);
}

export async function getCaptureAnalysis(captureId: string) {
  await ensureVisualIntelligenceSchema();
  const capture = await queryPostgres('SELECT * FROM chart_captures WHERE id = $1', [captureId]);
  if (!capture.rows[0]) return null;

  const [jobs, candles, detections, decisions, states, scores] = await Promise.all([
    queryPostgres('SELECT * FROM vision_analysis_jobs WHERE chart_capture_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 5', [captureId]),
    queryPostgres('SELECT * FROM reconstructed_candles WHERE chart_capture_id = $1 ORDER BY candle_index ASC', [captureId]),
    queryPostgres('SELECT * FROM vision_detections WHERE chart_capture_id = $1 ORDER BY strength_score DESC', [captureId]),
    queryPostgres('SELECT * FROM ai_decision_outputs WHERE chart_capture_id = $1 ORDER BY created_at DESC LIMIT 1', [captureId]),
    queryPostgres(`
      SELECT * FROM market_structure_states
      WHERE symbol = $1 AND timeframe = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `, [String(capture.rows[0].symbol), String(capture.rows[0].timeframe)]),
    queryPostgres(`
      SELECT m.* FROM model_confidence_scores m
      JOIN vision_analysis_jobs j ON j.id = m.job_id
      WHERE j.chart_capture_id = $1
      ORDER BY m.created_at DESC
    `, [captureId]),
  ]);

  return {
    capture: mapCapture(capture.rows[0]),
    jobs: jobs.rows.map(mapJob),
    candles: candles.rows.map(mapCandle),
    detections: detections.rows.map(mapDetection),
    decision: decisions.rows[0] ? mapDecision(decisions.rows[0]) : null,
    structureState: states.rows[0] ? mapStructure(states.rows[0]) : null,
    confidenceScores: scores.rows.map(mapConfidence),
  };
}

export async function getJob(jobId: string) {
  await ensureVisualIntelligenceSchema();
  const result = await queryPostgres('SELECT * FROM vision_analysis_jobs WHERE id = $1', [jobId]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function listEvents(sinceId = '0', limit = 200) {
  await ensureVisualIntelligenceSchema();
  const result = await queryPostgres(`
    SELECT * FROM visual_intelligence_events
    WHERE id > $1
    ORDER BY id ASC
    LIMIT $2
  `, [Number(sinceId) || 0, limit]);
  return result.rows.map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    chartCaptureId: nullableString(row.chart_capture_id),
    jobId: nullableString(row.job_id),
    payload: objectValue(row.payload_json),
    createdAt: dateString(row.created_at),
  }));
}

export async function createFeedback(input: {
  detectionId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureVisualIntelligenceSchema();
  const id = randomUUID();
  const result = await queryPostgres(`
    INSERT INTO user_feedback (id, detection_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [id, input.detectionId, input.userId ?? 'local-user', input.feedbackType, input.correction ?? {}, input.comment ?? null]);

  await publishEvent('feedback_recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

export async function publishVisualIntelligenceEvent(eventType: string, chartCaptureId: string | null, jobId: string | null, payload: Record<string, unknown>) {
  await ensureVisualIntelligenceSchema();
  await publishEvent(eventType, chartCaptureId, jobId, payload);
}

async function insertCapture(capture: ChartCaptureRecord) {
  await queryPostgres(`
    INSERT INTO chart_captures (id, symbol, timeframe, source_platform, image_url, image_hash, capture_type, captured_at, processing_status, metadata_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [capture.id, capture.symbol, capture.timeframe, capture.sourcePlatform, capture.imageUrl, capture.imageHash, capture.captureType, capture.capturedAt, capture.processingStatus, capture.metadata]);
}

async function insertJob(job: VisionJobRecord) {
  await queryPostgres(`
    INSERT INTO vision_analysis_jobs (id, chart_capture_id, job_type, status, progress, model_version)
    VALUES ($1,$2,$3,$4,$5,$6)
  `, [job.id, job.chartCaptureId, job.jobType, job.status, job.progress, job.modelVersion]);
}

async function updateJob(jobId: string, patch: Partial<VisionJobRecord>) {
  await queryPostgres(`
    UPDATE vision_analysis_jobs
    SET status = COALESCE($2, status),
        progress = COALESCE($3, progress),
        started_at = COALESCE($4, started_at),
        completed_at = COALESCE($5, completed_at),
        error_message = COALESCE($6, error_message),
        processing_time_ms = COALESCE($7, processing_time_ms)
    WHERE id = $1
  `, [jobId, patch.status ?? null, patch.progress ?? null, patch.startedAt ?? null, patch.completedAt ?? null, patch.errorMessage ?? null, patch.processingTimeMs ?? null]);
}

async function updateCaptureStatus(captureId: string, status: string) {
  await queryPostgres('UPDATE chart_captures SET processing_status = $2 WHERE id = $1', [captureId, status]);
}

async function replaceCandles(captureId: string, candles: ReconstructedCandle[]) {
  await queryPostgres('DELETE FROM reconstructed_candles WHERE chart_capture_id = $1', [captureId]);
  for (const candle of candles) {
    await queryPostgres(`
      INSERT INTO reconstructed_candles (
        id, chart_capture_id, candle_index, open_price, high_price, low_price, close_price,
        pixel_x, pixel_y_open, pixel_y_high, pixel_y_low, pixel_y_close, direction, confidence
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      randomUUID(), captureId, candle.candleIndex, candle.openPrice, candle.highPrice, candle.lowPrice, candle.closePrice,
      candle.pixelX, candle.pixelYOpen, candle.pixelYHigh, candle.pixelYLow, candle.pixelYClose, candle.direction, candle.confidence,
    ]);
  }
}

async function replaceDetections(captureId: string, detections: VisionDetection[]) {
  await queryPostgres('DELETE FROM vision_detections WHERE chart_capture_id = $1', [captureId]);
  for (const detection of detections) {
    await queryPostgres(`
      INSERT INTO vision_detections (
        id, chart_capture_id, detection_type, detection_name, direction, price_level, start_time, end_time,
        bounding_box_json, geometry_json, confidence, strength_score, status, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      randomUUID(), captureId, detection.detectionType, detection.detectionName, detection.direction, detection.priceLevel,
      detection.startTime, detection.endTime, detection.boundingBox, detection.geometry, detection.confidence,
      detection.strengthScore, detection.status, detection.metadata,
    ]);
  }
}

async function insertMarketStructure(state: MarketStructureState) {
  await queryPostgres(`
    INSERT INTO market_structure_states (
      id, symbol, timeframe, trend_state, phase_state, last_bos_direction, last_choch_direction,
      liquidity_bias, institutional_bias, retail_bias, confidence
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `, [
    randomUUID(), state.symbol, state.timeframe, state.trendState, state.phaseState, state.lastBosDirection,
    state.lastChochDirection, state.liquidityBias, state.institutionalBias, state.retailBias, state.confidence,
  ]);
}

async function insertDecision(captureId: string, decision: AiDecisionOutput) {
  await queryPostgres(`
    INSERT INTO ai_decision_outputs (
      id, chart_capture_id, symbol, timeframe, decision, bias, confidence, entry_zone_json, stop_loss,
      take_profit_1, take_profit_2, risk_reward_ratio, invalidation_level, reasoning_text, risk_warning
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    randomUUID(), captureId, decision.symbol, decision.timeframe, decision.decision, decision.bias, decision.confidence,
    decision.entryZone, decision.stopLoss, decision.takeProfit1, decision.takeProfit2, decision.riskRewardRatio,
    decision.invalidationLevel, decision.reasoningText, decision.riskWarning,
  ]);
}

async function replaceConfidenceScores(jobId: string, scores: ModelConfidenceScore[]) {
  await queryPostgres('DELETE FROM model_confidence_scores WHERE job_id = $1', [jobId]);
  for (const score of scores) {
    await queryPostgres(`
      INSERT INTO model_confidence_scores (
        id, job_id, model_name, model_version, raw_score, calibrated_score, uncertainty_score, final_confidence
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [randomUUID(), jobId, score.modelName, score.modelVersion, score.rawScore, score.calibratedScore, score.uncertaintyScore, score.finalConfidence]);
  }
}

async function publishEvent(eventType: string, chartCaptureId: string | null, jobId: string | null, payload: Record<string, unknown>) {
  await queryPostgres(`
    INSERT INTO visual_intelligence_events (event_type, chart_capture_id, job_id, payload_json)
    VALUES ($1,$2,$3,$4)
  `, [eventType, chartCaptureId, jobId, payload]);
}

function mapCapture(row: Row): ChartCaptureRecord {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    sourcePlatform: String(row.source_platform),
    imageUrl: String(row.image_url),
    imageHash: String(row.image_hash),
    captureType: String(row.capture_type),
    capturedAt: dateString(row.captured_at),
    processingStatus: String(row.processing_status),
    metadata: objectValue(row.metadata_json),
  };
}

function mapJob(row: Row): VisionJobRecord {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    jobType: String(row.job_type),
    status: String(row.status),
    progress: numberValue(row.progress),
    startedAt: nullableDateString(row.started_at),
    completedAt: nullableDateString(row.completed_at),
    errorMessage: nullableString(row.error_message),
    modelVersion: String(row.model_version),
    processingTimeMs: nullableNumber(row.processing_time_ms),
  };
}

function mapCandle(row: Row): ReconstructedCandle {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: numberValue(row.candle_index),
    openPrice: numberValue(row.open_price),
    highPrice: numberValue(row.high_price),
    lowPrice: numberValue(row.low_price),
    closePrice: numberValue(row.close_price),
    pixelX: numberValue(row.pixel_x),
    pixelYOpen: numberValue(row.pixel_y_open),
    pixelYHigh: numberValue(row.pixel_y_high),
    pixelYLow: numberValue(row.pixel_y_low),
    pixelYClose: numberValue(row.pixel_y_close),
    direction: String(row.direction) as ReconstructedCandle['direction'],
    confidence: numberValue(row.confidence),
  };
}

function mapDetection(row: Row): VisionDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    detectionType: String(row.detection_type),
    detectionName: String(row.detection_name),
    direction: nullableString(row.direction),
    priceLevel: nullableNumber(row.price_level),
    startTime: nullableDateString(row.start_time),
    endTime: nullableDateString(row.end_time),
    boundingBox: objectValue(row.bounding_box_json),
    geometry: objectValue(row.geometry_json),
    confidence: numberValue(row.confidence),
    strengthScore: numberValue(row.strength_score),
    status: String(row.status),
    metadata: objectValue(row.metadata_json),
  };
}

function mapStructure(row: Row): MarketStructureState {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    trendState: String(row.trend_state),
    phaseState: String(row.phase_state),
    lastBosDirection: nullableString(row.last_bos_direction),
    lastChochDirection: nullableString(row.last_choch_direction),
    liquidityBias: String(row.liquidity_bias),
    institutionalBias: String(row.institutional_bias),
    retailBias: String(row.retail_bias),
    confidence: numberValue(row.confidence),
    updatedAt: dateString(row.updated_at),
  };
}

function mapDecision(row: Row): AiDecisionOutput {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    decision: String(row.decision) as AiDecisionOutput['decision'],
    bias: String(row.bias),
    confidence: numberValue(row.confidence),
    entryZone: objectValue(row.entry_zone_json),
    stopLoss: nullableNumber(row.stop_loss),
    takeProfit1: nullableNumber(row.take_profit_1),
    takeProfit2: nullableNumber(row.take_profit_2),
    riskRewardRatio: nullableNumber(row.risk_reward_ratio),
    invalidationLevel: nullableNumber(row.invalidation_level),
    reasoningText: String(row.reasoning_text),
    riskWarning: String(row.risk_warning),
    createdAt: dateString(row.created_at),
  };
}

function mapConfidence(row: Row): ModelConfidenceScore {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    modelName: String(row.model_name),
    modelVersion: String(row.model_version),
    rawScore: numberValue(row.raw_score),
    calibratedScore: numberValue(row.calibrated_score),
    uncertaintyScore: numberValue(row.uncertainty_score),
    finalConfidence: numberValue(row.final_confidence),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableDateString(value: unknown): string | null {
  return value == null ? null : dateString(value);
}
