import { randomUUID } from 'crypto';

import { segmentChart, type ChartSegmentResult, type ChartSegmentType } from './chart-segmentation-engine';
import { queryPostgres } from './postgres';
import { getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRecord, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS chart_segments (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_candle_index INTEGER NOT NULL,
  end_candle_index INTEGER NOT NULL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  price_low NUMERIC(18, 6) NOT NULL,
  price_high NUMERIC(18, 6) NOT NULL,
  start_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  end_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  segment_type TEXT NOT NULL,
  volatility_regime TEXT NOT NULL,
  structure_regime TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS segment_classifications (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL,
  market_meaning TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  trading_relevance TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS segment_confidence_scores (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  confidence_score NUMERIC(8, 4) NOT NULL,
  change_point_score NUMERIC(8, 4) NOT NULL,
  regime_score NUMERIC(8, 4) NOT NULL,
  visual_score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS segment_ai_explanations (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  explanation_text TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'chart-segmentation-hybrid-v1',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS segment_feedback (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES chart_segments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chart_segments_capture ON chart_segments(chart_capture_id, start_candle_index);
CREATE INDEX IF NOT EXISTS idx_chart_segments_symbol_tf ON chart_segments(symbol, timeframe, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export interface StoredChartSegment {
  id: string;
  captureId: string;
  symbol: string;
  timeframe: string;
  startCandleIndex: number;
  endCandleIndex: number;
  startTime: string | null;
  endTime: string | null;
  priceLow: number;
  priceHigh: number;
  startCoordinates: Record<string, unknown>;
  endCoordinates: Record<string, unknown>;
  geometry: Record<string, unknown>;
  segmentType: ChartSegmentType;
  confidenceScore: number;
  marketMeaning: string;
  institutionalInterpretation: string;
  tradingRelevance: string;
  volatilityRegime: string;
  structureRegime: string;
  explanation: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoredSegmentationReport {
  capture: ChartCaptureRecord;
  segments: StoredChartSegment[];
  explanation: string;
  modelVersion: string;
  createdAt: string | null;
}

export async function ensureChartSegmentationSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeChartSegmentation(input: { captureId?: string; symbol?: string; timeframe?: string }): Promise<StoredSegmentationReport> {
  await ensureChartSegmentationSchema();
  const capture = input.captureId ? await loadCapture(input.captureId) : await findLatestCapture(input.symbol, input.timeframe);
  if (!capture) throw new Error('No chart capture found for AI chart segmentation.');
  const candles = await loadCandles(capture.id);

  await publishVisualIntelligenceEvent('segmentation.started', capture.id, null, { symbol: capture.symbol, timeframe: capture.timeframe });
  const result = segmentChart({ symbol: capture.symbol, timeframe: capture.timeframe, imageUrl: capture.imageUrl, candles });
  await replaceSegments(capture, result.segments, result.explanation, result.modelVersion);

  for (const segment of result.segments) {
    await publishVisualIntelligenceEvent('segmentation.segment.detected', capture.id, null, {
      segmentType: segment.segmentType,
      startCandleIndex: segment.startCandleIndex,
      endCandleIndex: segment.endCandleIndex,
    });
  }
  await publishVisualIntelligenceEvent('segmentation.classified', capture.id, null, {
    segmentCount: result.segments.length,
    modelVersion: result.modelVersion,
  });
  await publishVisualIntelligenceEvent('segmentation.completed', capture.id, null, {
    segmentCount: result.segments.length,
    explanation: result.explanation,
  });

  const report = await getChartSegmentation(capture.id);
  if (!report) throw new Error('Segmentation was created but could not be loaded.');
  return report;
}

export async function getChartSegmentation(captureId: string): Promise<StoredSegmentationReport | null> {
  await ensureChartSegmentationSchema();
  const capture = await loadCapture(captureId);
  if (!capture) return null;
  const segments = await loadSegments(captureId);
  return {
    capture,
    segments,
    explanation: segments[0]?.metadata.reportExplanation as string || `No chart segments have been generated for ${capture.symbol} ${capture.timeframe}.`,
    modelVersion: segments[0]?.metadata.modelVersion as string || 'chart-segmentation-hybrid-v1',
    createdAt: segments[0]?.createdAt ?? null,
  };
}

export async function getLatestChartSegmentation(symbol: string, timeframe: string): Promise<StoredSegmentationReport | null> {
  await ensureChartSegmentationSchema();
  const capture = await findLatestSegmentCapture(symbol, timeframe);
  return capture ? getChartSegmentation(capture) : null;
}

export async function createSegmentFeedback(input: { segmentId: string; feedbackType: string; correction?: Record<string, unknown>; comment?: string; userId?: string }) {
  await ensureChartSegmentationSchema();
  const result = await queryPostgres(`
    INSERT INTO segment_feedback (id, segment_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.segmentId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  return result.rows[0];
}

async function replaceSegments(capture: ChartCaptureRecord, segments: ChartSegmentResult[], explanation: string, modelVersion: string) {
  await queryPostgres('DELETE FROM chart_segments WHERE chart_capture_id = $1', [capture.id]);
  for (const segment of segments) {
    const id = randomUUID();
    await queryPostgres(`
      INSERT INTO chart_segments (
        id, chart_capture_id, symbol, timeframe, start_candle_index, end_candle_index, start_time, end_time,
        price_low, price_high, start_coordinates_json, end_coordinates_json, geometry_json, segment_type,
        volatility_regime, structure_regime, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `, [
      id, capture.id, capture.symbol, capture.timeframe, segment.startCandleIndex, segment.endCandleIndex,
      segment.startTime, segment.endTime, segment.priceLow, segment.priceHigh, segment.startCoordinates,
      segment.endCoordinates, segment.geometry, segment.segmentType, segment.volatilityRegime,
      segment.structureRegime, { ...segment.metadata, reportExplanation: explanation, modelVersion },
    ]);
    await queryPostgres(`
      INSERT INTO segment_classifications (id, segment_id, segment_type, market_meaning, institutional_interpretation, trading_relevance)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [randomUUID(), id, segment.segmentType, segment.marketMeaning, segment.institutionalInterpretation, segment.tradingRelevance]);
    await queryPostgres(`
      INSERT INTO segment_confidence_scores (id, segment_id, confidence_score, change_point_score, regime_score, visual_score)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [randomUUID(), id, segment.confidenceScore, segment.confidenceScore * 0.94, segment.confidenceScore * 0.9, segment.confidenceScore * 0.86]);
    await queryPostgres(`
      INSERT INTO segment_ai_explanations (id, segment_id, explanation_text, model_version, metadata_json)
      VALUES ($1,$2,$3,$4,$5)
    `, [randomUUID(), id, `${segment.marketMeaning} ${segment.institutionalInterpretation} ${segment.tradingRelevance}`, modelVersion, segment.metadata]);
  }
}

async function loadSegments(captureId: string): Promise<StoredChartSegment[]> {
  const result = await queryPostgres(`
    SELECT
      s.*, c.market_meaning, c.institutional_interpretation, c.trading_relevance,
      cs.confidence_score, e.explanation_text
    FROM chart_segments s
    LEFT JOIN segment_classifications c ON c.segment_id = s.id
    LEFT JOIN segment_confidence_scores cs ON cs.segment_id = s.id
    LEFT JOIN segment_ai_explanations e ON e.segment_id = s.id
    WHERE s.chart_capture_id = $1
    ORDER BY s.start_candle_index ASC
  `, [captureId]);
  return result.rows.map(mapSegment);
}

async function loadCapture(captureId: string): Promise<ChartCaptureRecord | null> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.capture ?? null;
}

async function loadCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function findLatestCapture(symbol?: string, timeframe?: string): Promise<ChartCaptureRecord | null> {
  const normalizedSymbol = (symbol ?? 'XAUUSD').toUpperCase();
  const normalizedTimeframe = (timeframe ?? 'H1').toUpperCase();
  const result = await queryPostgres(`
    SELECT id FROM chart_captures
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [normalizedSymbol, normalizedTimeframe]);
  return result.rows[0]?.id ? loadCapture(String(result.rows[0].id)) : null;
}

async function findLatestSegmentCapture(symbol: string, timeframe: string): Promise<string | null> {
  const result = await queryPostgres(`
    SELECT chart_capture_id FROM chart_segments
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return result.rows[0]?.chart_capture_id ? String(result.rows[0].chart_capture_id) : null;
}

function mapSegment(row: Row): StoredChartSegment {
  return {
    id: String(row.id),
    captureId: String(row.chart_capture_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    startCandleIndex: Number(row.start_candle_index),
    endCandleIndex: Number(row.end_candle_index),
    startTime: row.start_time == null ? null : dateString(row.start_time),
    endTime: row.end_time == null ? null : dateString(row.end_time),
    priceLow: Number(row.price_low),
    priceHigh: Number(row.price_high),
    startCoordinates: objectValue(row.start_coordinates_json),
    endCoordinates: objectValue(row.end_coordinates_json),
    geometry: objectValue(row.geometry_json),
    segmentType: String(row.segment_type) as ChartSegmentType,
    confidenceScore: Number(row.confidence_score ?? 0),
    marketMeaning: String(row.market_meaning ?? ''),
    institutionalInterpretation: String(row.institutional_interpretation ?? ''),
    tradingRelevance: String(row.trading_relevance ?? ''),
    volatilityRegime: String(row.volatility_regime),
    structureRegime: String(row.structure_regime),
    explanation: String(row.explanation_text ?? ''),
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
