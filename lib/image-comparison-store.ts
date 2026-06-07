import { randomUUID } from 'crypto';

import {
  analyzeImageComparison,
  normalizeImageComparisonTimeframe,
  type ComparisonAnalysisPayload,
  type ImageComparisonResult,
  type ImageComparisonTimeframe,
} from './image-comparison-engine';
import { queryPostgres } from './postgres';
import { publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS image_comparison_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  previous_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  current_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  processing_time_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS image_comparison_results (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  previous_image_url TEXT,
  current_image_url TEXT,
  comparison_score NUMERIC(8, 4) NOT NULL,
  similarity_percentage NUMERIC(8, 4) NOT NULL,
  visual_change_confidence NUMERIC(8, 4) NOT NULL,
  changed_bias TEXT NOT NULL,
  final_interpretation TEXT NOT NULL,
  changed_structures_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  new_zones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  invalidated_zones_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visual_difference_maps (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  heatmap_url TEXT NOT NULL,
  difference_blocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  keypoint_matches_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  registration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chart_change_events (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity_score NUMERIC(8, 4) NOT NULL,
  timeframe TEXT NOT NULL,
  description TEXT NOT NULL,
  zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comparison_ai_interpretations (
  id UUID PRIMARY KEY,
  comparison_job_id UUID NOT NULL REFERENCES image_comparison_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  ai_summary TEXT NOT NULL,
  market_change_timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  institutional_interpretation TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_image_comparison_jobs_symbol_tf ON image_comparison_jobs(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_comparison_results_job ON image_comparison_results(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_visual_difference_maps_job ON visual_difference_maps(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_chart_change_events_job ON chart_change_events(comparison_job_id);
CREATE INDEX IF NOT EXISTS idx_comparison_ai_interpretations_job ON comparison_ai_interpretations(comparison_job_id);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureImageComparisonSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function compareChartImages(input: {
  symbol: string;
  timeframe: string;
  previousImage?: string;
  currentImage?: string;
  previousImageUrl?: string | null;
  currentImageUrl?: string | null;
  previousCaptureId?: string | null;
  currentCaptureId?: string | null;
  previousCandles?: ReconstructedCandle[];
  currentCandles?: ReconstructedCandle[];
  previousAnalysis?: ComparisonAnalysisPayload;
  currentAnalysis?: ComparisonAnalysisPayload;
}) {
  await ensureImageComparisonSchema();
  const symbol = input.symbol.trim().toUpperCase();
  const timeframe = normalizeImageComparisonTimeframe(input.timeframe);
  const jobId = randomUUID();
  const startedAt = new Date();
  await insertJob(jobId, symbol, timeframe, input.previousCaptureId ?? null, input.currentCaptureId ?? null, {
    previousImageUrl: input.previousImageUrl ?? null,
    currentImageUrl: input.currentImageUrl ?? null,
  });
  await publishVisualIntelligenceEvent('comparison.started', null, null, { comparisonId: jobId, symbol, timeframe });

  try {
    await updateJob(jobId, 'running', 18, null, null);
    await publishVisualIntelligenceEvent('comparison.aligning', null, null, { comparisonId: jobId, symbol, timeframe });
    const previous = await hydrateImage(input.previousImage, input.previousImageUrl, input.previousCaptureId);
    const current = await hydrateImage(input.currentImage, input.currentImageUrl, input.currentCaptureId);
    await updateJob(jobId, 'running', 46, null, null);
    await publishVisualIntelligenceEvent('comparison.detecting.differences', null, null, { comparisonId: jobId, symbol, timeframe });
    const result = analyzeImageComparison({
      symbol,
      timeframe,
      previousImage: previous.image,
      currentImage: current.image,
      previousImageUrl: previous.url,
      currentImageUrl: current.url,
      previousCandles: input.previousCandles ?? await loadCaptureCandles(input.previousCaptureId),
      currentCandles: input.currentCandles ?? await loadCaptureCandles(input.currentCaptureId),
      previousAnalysis: input.previousAnalysis,
      currentAnalysis: input.currentAnalysis,
    });
    await updateJob(jobId, 'running', 78, null, null);
    await persistResult(jobId, result);
    await publishVisualIntelligenceEvent('comparison.heatmap.generated', null, null, {
      comparisonId: jobId,
      heatmapUrl: result.heatmapUrl,
      differenceBlocks: result.differenceBlocks.length,
    });
    const processingTimeMs = Date.now() - startedAt.getTime();
    await updateJob(jobId, 'completed', 100, null, processingTimeMs);
    await publishVisualIntelligenceEvent('comparison.completed', null, null, {
      comparisonId: jobId,
      finalInterpretation: result.finalInterpretation,
      similarityPercentage: result.similarityPercentage,
      confidence: result.confidence,
    });
    return { comparisonId: jobId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image comparison failed.';
    await updateJob(jobId, 'failed', 100, message, Date.now() - startedAt.getTime());
    await publishVisualIntelligenceEvent('comparison.failed', null, null, { comparisonId: jobId, symbol, timeframe, error: message });
    throw error;
  }
}

export async function reprocessImageComparison(input: { comparisonId: string }) {
  await ensureImageComparisonSchema();
  const job = await getJob(input.comparisonId);
  if (!job) throw new Error('Comparison job not found.');
  return compareChartImages({
    symbol: String(job.symbol),
    timeframe: String(job.timeframe),
    previousCaptureId: job.previous_capture_id ? String(job.previous_capture_id) : null,
    currentCaptureId: job.current_capture_id ? String(job.current_capture_id) : null,
    previousImageUrl: readMetadata(job).previousImageUrl as string | null,
    currentImageUrl: readMetadata(job).currentImageUrl as string | null,
  });
}

export async function getImageComparison(comparisonId: string) {
  await ensureImageComparisonSchema();
  const result = await queryPostgres(`
    SELECT
      j.id AS comparison_id, j.symbol, j.timeframe, j.status, j.progress, j.started_at, j.completed_at,
      j.error_message, j.processing_time_ms, j.created_at AS job_created_at,
      r.id AS result_id, r.previous_image_url, r.current_image_url, r.comparison_score,
      r.similarity_percentage, r.visual_change_confidence, r.changed_bias, r.final_interpretation,
      r.changed_structures_json, r.new_zones_json, r.invalidated_zones_json, r.metadata_json,
      d.heatmap_url, d.difference_blocks_json, d.keypoint_matches_json, d.registration_json,
      i.ai_summary, i.market_change_timeline_json, i.institutional_interpretation, i.recommendation, i.confidence
    FROM image_comparison_jobs j
    LEFT JOIN image_comparison_results r ON r.comparison_job_id = j.id
    LEFT JOIN visual_difference_maps d ON d.comparison_job_id = j.id
    LEFT JOIN comparison_ai_interpretations i ON i.comparison_job_id = j.id
    WHERE j.id = $1
    ORDER BY r.created_at DESC
    LIMIT 1
  `, [comparisonId]);
  const row = result.rows[0];
  if (!row) return null;
  const events = await queryPostgres(`
    SELECT * FROM chart_change_events
    WHERE comparison_job_id = $1
    ORDER BY created_at ASC
  `, [comparisonId]);
  return mapComparison(row, events.rows);
}

export async function getImageComparisonHistory(symbol: string, timeframe: string, limit = 20) {
  await ensureImageComparisonSchema();
  const normalizedTimeframe = normalizeImageComparisonTimeframe(timeframe);
  const result = await queryPostgres(`
    SELECT j.id
    FROM image_comparison_jobs j
    WHERE upper(j.symbol) = $1 AND upper(j.timeframe) = $2
    ORDER BY j.created_at DESC
    LIMIT $3
  `, [symbol.toUpperCase(), normalizedTimeframe, limit]);
  const comparisons = await Promise.all(result.rows.map((row) => getImageComparison(String(row.id))));
  return comparisons.filter(Boolean);
}

async function insertJob(id: string, symbol: string, timeframe: ImageComparisonTimeframe, previousCaptureId: string | null, currentCaptureId: string | null, metadata: Record<string, unknown>) {
  await queryPostgres(`
    INSERT INTO image_comparison_jobs (
      id, symbol, timeframe, previous_capture_id, current_capture_id, status, progress, started_at, metadata_json
    ) VALUES ($1, $2, $3, $4, $5, 'queued', 0, now(), $6)
  `, [id, symbol, timeframe, previousCaptureId, currentCaptureId, metadata]);
}

async function updateJob(id: string, status: string, progress: number, errorMessage: string | null, processingTimeMs: number | null) {
  await queryPostgres(`
    UPDATE image_comparison_jobs
    SET status = $2, progress = $3, error_message = $4, processing_time_ms = COALESCE($5, processing_time_ms),
        completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
    WHERE id = $1
  `, [id, status, progress, errorMessage, processingTimeMs]);
}

async function persistResult(jobId: string, result: ImageComparisonResult) {
  await queryPostgres(`
    INSERT INTO image_comparison_results (
      id, comparison_job_id, symbol, timeframe, previous_image_url, current_image_url,
      comparison_score, similarity_percentage, visual_change_confidence, changed_bias, final_interpretation,
      changed_structures_json, new_zones_json, invalidated_zones_json, metadata_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    result.id,
    jobId,
    result.symbol,
    result.timeframe,
    result.previousImageUrl,
    result.currentImageUrl,
    result.comparisonScore,
    result.similarityPercentage,
    result.visualChangeConfidence,
    result.changedBias,
    result.finalInterpretation,
    result.changedStructures,
    result.newZones,
    result.invalidatedZones,
    result.metadata,
  ]);
  await queryPostgres(`
    INSERT INTO visual_difference_maps (
      id, comparison_job_id, heatmap_url, difference_blocks_json, keypoint_matches_json, registration_json
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `, [randomUUID(), jobId, result.heatmapUrl, JSON.stringify(result.differenceBlocks), JSON.stringify(result.keypointMatches), JSON.stringify(result.registration)]);
  for (const event of result.changeEvents) {
    await queryPostgres(`
      INSERT INTO chart_change_events (
        id, comparison_job_id, event_type, severity_score, timeframe, description, zone_json, metadata_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [event.id, jobId, event.eventType, event.severityScore, event.timeframe, event.description, event.zone, event.metadata]);
  }
  await queryPostgres(`
    INSERT INTO comparison_ai_interpretations (
      id, comparison_job_id, symbol, timeframe, ai_summary, market_change_timeline_json,
      institutional_interpretation, recommendation, confidence
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    randomUUID(),
    jobId,
    result.symbol,
    result.timeframe,
    result.aiExplanation,
    result.marketChangeTimeline,
    result.institutionalInterpretation,
    result.recommendation,
    result.confidence,
  ]);
}

async function hydrateImage(image?: string, imageUrl?: string | null, captureId?: string | null) {
  if (image?.trim()) return { image, url: imageUrl ?? null };
  if (imageUrl?.trim()) return { image: imageUrl, url: imageUrl };
  if (captureId) {
    const capture = await queryPostgres('SELECT image_url FROM chart_captures WHERE id = $1 LIMIT 1', [captureId]);
    const url = capture.rows[0]?.image_url ? String(capture.rows[0].image_url) : null;
    if (url) return { image: url, url };
  }
  throw new Error('Both previous and current images, image URLs, or capture ids are required.');
}

async function loadCaptureCandles(captureId?: string | null): Promise<ReconstructedCandle[]> {
  if (!captureId) return [];
  const result = await queryPostgres(`
    SELECT * FROM reconstructed_candles
    WHERE chart_capture_id = $1
    ORDER BY candle_index ASC
  `, [captureId]);
  return result.rows.map((row) => ({
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    candleIndex: Number(row.candle_index),
    openPrice: Number(row.open_price),
    highPrice: Number(row.high_price),
    lowPrice: Number(row.low_price),
    closePrice: Number(row.close_price),
    pixelX: Number(row.pixel_x),
    pixelYOpen: Number(row.pixel_y_open),
    pixelYHigh: Number(row.pixel_y_high),
    pixelYLow: Number(row.pixel_y_low),
    pixelYClose: Number(row.pixel_y_close),
    direction: String(row.direction) as ReconstructedCandle['direction'],
    confidence: Number(row.confidence),
  }));
}

async function getJob(comparisonId: string) {
  const result = await queryPostgres('SELECT * FROM image_comparison_jobs WHERE id = $1 LIMIT 1', [comparisonId]);
  return result.rows[0] ?? null;
}

function mapComparison(row: Row, eventRows: Row[]) {
  return {
    comparisonId: String(row.comparison_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    status: String(row.status),
    progress: Number(row.progress),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    processingTimeMs: row.processing_time_ms == null ? null : Number(row.processing_time_ms),
    result: row.result_id ? {
      id: String(row.result_id),
      previousImageUrl: row.previous_image_url ? String(row.previous_image_url) : null,
      currentImageUrl: row.current_image_url ? String(row.current_image_url) : null,
      comparisonScore: Number(row.comparison_score),
      similarityPercentage: Number(row.similarity_percentage),
      visualChangeConfidence: Number(row.visual_change_confidence),
      changedBias: String(row.changed_bias),
      finalInterpretation: String(row.final_interpretation),
      changedStructures: readJson(row.changed_structures_json, []),
      newZones: readJson(row.new_zones_json, []),
      invalidatedZones: readJson(row.invalidated_zones_json, []),
      heatmapUrl: String(row.heatmap_url ?? ''),
      differenceBlocks: readJson(row.difference_blocks_json, []),
      keypointMatches: readJson(row.keypoint_matches_json, []),
      registration: readJson(row.registration_json, {}),
      aiExplanation: String(row.ai_summary ?? ''),
      marketChangeTimeline: readJson(row.market_change_timeline_json, []),
      institutionalInterpretation: String(row.institutional_interpretation ?? ''),
      recommendation: String(row.recommendation ?? ''),
      confidence: Number(row.confidence ?? 0),
      metadata: readJson(row.metadata_json, {}),
    } : null,
    events: eventRows.map((event) => ({
      id: String(event.id),
      eventType: String(event.event_type),
      severityScore: Number(event.severity_score),
      timeframe: String(event.timeframe),
      description: String(event.description),
      zone: readJson(event.zone_json, {}),
      metadata: readJson(event.metadata_json, {}),
      createdAt: String(event.created_at),
    })),
  };
}

function readMetadata(row: Row) {
  return readJson(row.metadata_json, {}) as Record<string, unknown>;
}

function readJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
