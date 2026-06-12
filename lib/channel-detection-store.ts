import { randomUUID } from 'crypto';

import {
  analyzeChannels,
  normalizeChannelInputCandles,
  type ChannelAnalysisResult,
  type ChannelBreakoutPressure,
  type ChannelDetection,
} from './channel-detection-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS channel_detections (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  upper_start_price NUMERIC(18, 6) NOT NULL,
  upper_end_price NUMERIC(18, 6) NOT NULL,
  lower_start_price NUMERIC(18, 6) NOT NULL,
  lower_end_price NUMERIC(18, 6) NOT NULL,
  upper_start_pixel_x NUMERIC(18, 6) NOT NULL,
  upper_start_pixel_y NUMERIC(18, 6) NOT NULL,
  upper_end_pixel_x NUMERIC(18, 6) NOT NULL,
  upper_end_pixel_y NUMERIC(18, 6) NOT NULL,
  lower_start_pixel_x NUMERIC(18, 6) NOT NULL,
  lower_start_pixel_y NUMERIC(18, 6) NOT NULL,
  lower_end_pixel_x NUMERIC(18, 6) NOT NULL,
  lower_end_pixel_y NUMERIC(18, 6) NOT NULL,
  slope NUMERIC(18, 8) NOT NULL,
  channel_width NUMERIC(18, 6) NOT NULL,
  containment_score NUMERIC(8, 4) NOT NULL,
  touch_count INTEGER NOT NULL,
  respect_rate NUMERIC(8, 4) NOT NULL,
  false_break_count INTEGER NOT NULL,
  slope_consistency NUMERIC(8, 4) NOT NULL,
  volatility_state TEXT NOT NULL,
  compression_score NUMERIC(8, 4) NOT NULL,
  breakout_probability NUMERIC(8, 4) NOT NULL,
  liquidity_risk NUMERIC(8, 4) NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  quality_score NUMERIC(8, 4) NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_breakout_pressure (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channel_detections(id) ON DELETE CASCADE,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  boundary TEXT NOT NULL,
  pressure_score NUMERIC(8, 4) NOT NULL,
  repeated_touch_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_build_up_score NUMERIC(8, 4) NOT NULL,
  breakout_direction TEXT NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channel_detection_feedback (
  id UUID PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES channel_detections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channels_capture_quality ON channel_detections(chart_capture_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_channel_pressure_capture ON channel_breakout_pressure(chart_capture_id, pressure_score DESC);
CREATE INDEX IF NOT EXISTS idx_channel_feedback ON channel_detection_feedback(channel_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureChannelDetectionSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeCaptureChannels(input: ChartCaptureRequest & { captureId?: string }): Promise<ChannelAnalysisResult & { captureId: string }> {
  await ensureChannelDetectionSchema();
  await publishVisualIntelligenceEvent('channels.analysis.started', input.captureId ?? null, null, { stage: 'channel_detection_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeChannelInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 10) throw new Error('At least ten candles are required for channel detection.');

  const result = analyzeChannels(candles);
  await replaceChannelAnalysis(captureId, result);
  const persisted = await getChannelAnalysis(captureId);
  await publishVisualIntelligenceEvent('channels.analysis.completed', captureId, null, {
    summary: persisted.summary,
    channelCount: persisted.channels.length,
    pressureCount: persisted.breakoutPressure.length,
  });
  return persisted;
}

export async function getChannelAnalysis(captureId: string): Promise<ChannelAnalysisResult & { captureId: string }> {
  await ensureChannelDetectionSchema();
  const [channels, breakoutPressure] = await Promise.all([
    getChannelDetections(captureId),
    getChannelBreakoutPressure(captureId),
  ]);
  return { captureId, channels, breakoutPressure, summary: summarize(channels) };
}

export async function getChannelCoverageMap(): Promise<Record<string, number>> {
  await ensureChannelDetectionSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS channel_count
    FROM channel_detections
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.channel_count);
  }
  return coverage;
}

export async function getChannelDetections(captureId: string): Promise<ChannelDetection[]> {
  await ensureChannelDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM channel_detections
    WHERE chart_capture_id = $1
    ORDER BY quality_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapChannel);
}

export async function getChannelBreakoutPressure(captureId: string): Promise<ChannelBreakoutPressure[]> {
  await ensureChannelDetectionSchema();
  const result = await queryPostgres(`
    SELECT * FROM channel_breakout_pressure
    WHERE chart_capture_id = $1
    ORDER BY pressure_score DESC, created_at DESC
  `, [captureId]);
  return result.rows.map(mapPressure);
}

export async function createChannelFeedback(input: {
  channelId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureChannelDetectionSchema();
  const result = await queryPostgres(`
    INSERT INTO channel_detection_feedback (id, channel_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.channelId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('channels.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceChannelAnalysis(captureId: string, result: ChannelAnalysisResult) {
  await queryPostgres('DELETE FROM channel_breakout_pressure WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM channel_detections WHERE chart_capture_id = $1', [captureId]);

  const idByFallback = new Map<string, string>();
  for (const [index, channel] of result.channels.entries()) {
    const id = randomUUID();
    idByFallback.set(`channel-${index}`, id);
    await queryPostgres(`
      INSERT INTO channel_detections (
        id, chart_capture_id, channel_type, direction, start_candle_index, end_candle_index,
        upper_start_price, upper_end_price, lower_start_price, lower_end_price,
        upper_start_pixel_x, upper_start_pixel_y, upper_end_pixel_x, upper_end_pixel_y,
        lower_start_pixel_x, lower_start_pixel_y, lower_end_pixel_x, lower_end_pixel_y,
        slope, channel_width, containment_score, touch_count, respect_rate, false_break_count,
        slope_consistency, volatility_state, compression_score, breakout_probability, liquidity_risk,
        institutional_interpretation, recommended_action, quality_score, geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)
    `, [
      id, captureId, channel.channelType, channel.direction, channel.startCandleIndex, channel.endCandleIndex,
      channel.upperStartPrice, channel.upperEndPrice, channel.lowerStartPrice, channel.lowerEndPrice,
      channel.upperStartPixelX, channel.upperStartPixelY, channel.upperEndPixelX, channel.upperEndPixelY,
      channel.lowerStartPixelX, channel.lowerStartPixelY, channel.lowerEndPixelX, channel.lowerEndPixelY,
      channel.slope, channel.channelWidth, channel.containmentScore, channel.touchCount, channel.respectRate,
      channel.falseBreakCount, channel.slopeConsistency, channel.volatilityState, channel.compressionScore,
      channel.breakoutProbability, channel.liquidityRisk, channel.institutionalInterpretation,
      channel.recommendedAction, channel.qualityScore, channel.geometry, channel.metadata,
    ]);
  }

  for (const pressure of result.breakoutPressure) {
    const channelId = idByFallback.get(String(pressure.channelId)) ?? idByFallback.values().next().value;
    if (!channelId) continue;
    await queryPostgres(`
      INSERT INTO channel_breakout_pressure (
        id, channel_id, chart_capture_id, boundary, pressure_score, repeated_touch_score,
        displacement_score, liquidity_build_up_score, breakout_direction, explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      randomUUID(), channelId, captureId, pressure.boundary, pressure.pressureScore, pressure.repeatedTouchScore,
      pressure.displacementScore, pressure.liquidityBuildUpScore, pressure.breakoutDirection,
      pressure.explanationText, pressure.metadata,
    ]);
  }
}

function summarize(channels: ChannelDetection[]) {
  const dominant = channels[0];
  if (!dominant) {
    return {
      dominantChannel: 'none',
      institutionalBias: 'WAIT',
      recommendedAction: 'WAIT',
      confidence: 0,
      explanation: 'No channel analysis is available yet.',
    };
  }
  return {
    dominantChannel: dominant.channelType,
    institutionalBias: dominant.institutionalInterpretation,
    recommendedAction: dominant.recommendedAction,
    confidence: dominant.qualityScore,
    explanation: `${dominant.channelType} contains ${Math.round(dominant.containmentScore * 100)}% of price with ${Math.round(dominant.breakoutProbability * 100)}% breakout probability.`,
  };
}

function mapChannel(row: Row): ChannelDetection {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    channelType: String(row.channel_type),
    direction: String(row.direction) as ChannelDetection['direction'],
    startCandleIndex: Number(row.start_candle_index),
    endCandleIndex: Number(row.end_candle_index),
    upperStartPrice: Number(row.upper_start_price),
    upperEndPrice: Number(row.upper_end_price),
    lowerStartPrice: Number(row.lower_start_price),
    lowerEndPrice: Number(row.lower_end_price),
    upperStartPixelX: Number(row.upper_start_pixel_x),
    upperStartPixelY: Number(row.upper_start_pixel_y),
    upperEndPixelX: Number(row.upper_end_pixel_x),
    upperEndPixelY: Number(row.upper_end_pixel_y),
    lowerStartPixelX: Number(row.lower_start_pixel_x),
    lowerStartPixelY: Number(row.lower_start_pixel_y),
    lowerEndPixelX: Number(row.lower_end_pixel_x),
    lowerEndPixelY: Number(row.lower_end_pixel_y),
    slope: Number(row.slope),
    channelWidth: Number(row.channel_width),
    containmentScore: Number(row.containment_score),
    touchCount: Number(row.touch_count),
    respectRate: Number(row.respect_rate),
    falseBreakCount: Number(row.false_break_count),
    slopeConsistency: Number(row.slope_consistency),
    volatilityState: String(row.volatility_state),
    compressionScore: Number(row.compression_score),
    breakoutProbability: Number(row.breakout_probability),
    liquidityRisk: Number(row.liquidity_risk),
    institutionalInterpretation: String(row.institutional_interpretation),
    recommendedAction: String(row.recommended_action) as ChannelDetection['recommendedAction'],
    qualityScore: Number(row.quality_score),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapPressure(row: Row): ChannelBreakoutPressure {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    chartCaptureId: String(row.chart_capture_id),
    boundary: String(row.boundary) as ChannelBreakoutPressure['boundary'],
    pressureScore: Number(row.pressure_score),
    repeatedTouchScore: Number(row.repeated_touch_score),
    displacementScore: Number(row.displacement_score),
    liquidityBuildUpScore: Number(row.liquidity_build_up_score),
    breakoutDirection: String(row.breakout_direction) as ChannelBreakoutPressure['breakoutDirection'],
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
