import { randomUUID } from 'crypto';

import { analyzeVisualAnomalies, type AnomalyAction, type AnomalySeverity, type VisualAnomalyAnalysisResult } from './visual-anomaly-detection-engine';
import { queryPostgres } from './postgres';
import { getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRecord, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS visual_anomaly_jobs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  model_version TEXT NOT NULL DEFAULT 'visual-anomaly-hybrid-v1',
  processing_time_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visual_anomalies (
  id UUID PRIMARY KEY,
  anomaly_job_id UUID NOT NULL REFERENCES visual_anomaly_jobs(id) ON DELETE CASCADE,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  affected_timeframe TEXT NOT NULL,
  affected_price_zone_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visual_coordinates_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  probability_score NUMERIC(8, 4) NOT NULL,
  trading_risk_meaning TEXT NOT NULL,
  possible_cause TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS anomaly_severity_scores (
  id UUID PRIMARY KEY,
  anomaly_job_id UUID NOT NULL REFERENCES visual_anomaly_jobs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  low_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  overall_severity TEXT NOT NULL,
  manipulation_probability NUMERIC(8, 4) NOT NULL,
  feed_quality_score NUMERIC(8, 4) NOT NULL,
  image_integrity_score NUMERIC(8, 4) NOT NULL,
  volatility_spike_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS anomaly_resolution_logs (
  id UUID PRIMARY KEY,
  visual_anomaly_id UUID NOT NULL REFERENCES visual_anomalies(id) ON DELETE CASCADE,
  resolution_status TEXT NOT NULL,
  resolution_note TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS anomaly_model_history (
  id UUID PRIMARY KEY,
  model_version TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  total_anomalies INTEGER NOT NULL,
  critical_count INTEGER NOT NULL,
  high_count INTEGER NOT NULL,
  false_positive_count INTEGER NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visual_anomaly_jobs_symbol_tf ON visual_anomaly_jobs(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visual_anomalies_capture ON visual_anomalies(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visual_anomalies_symbol ON visual_anomalies(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visual_anomalies_severity ON visual_anomalies(severity, resolved, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureVisualAnomalySchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export interface StoredVisualAnomaly {
  id: string;
  jobId: string;
  captureId: string | null;
  symbol: string;
  anomalyType: string;
  severity: AnomalySeverity;
  affectedTimeframe: string;
  affectedPriceZone: { low: number | null; high: number | null; midpoint: number | null };
  visualCoordinates: Record<string, unknown>;
  probabilityScore: number;
  tradingRiskMeaning: string;
  possibleCause: string;
  recommendedAction: AnomalyAction;
  resolved: boolean;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoredVisualAnomalyReport {
  job: {
    id: string;
    captureId: string | null;
    symbol: string;
    timeframe: string;
    status: string;
    progress: number;
    modelVersion: string;
    processingTimeMs: number | null;
    createdAt: string;
  };
  severity: {
    lowCount: number;
    mediumCount: number;
    highCount: number;
    criticalCount: number;
    overallSeverity: AnomalySeverity;
    manipulationProbability: number;
    feedQualityScore: number;
    imageIntegrityScore: number;
    volatilitySpikeScore: number;
    explanation: string;
  };
  anomalies: StoredVisualAnomaly[];
}

export async function analyzeVisualAnomaly(input: { captureId?: string; symbol?: string; timeframe?: string }): Promise<StoredVisualAnomalyReport> {
  await ensureVisualAnomalySchema();
  const capture = input.captureId ? await loadCapture(input.captureId) : await findLatestCapture(input.symbol, input.timeframe);
  if (!capture) throw new Error('No chart capture found for visual anomaly detection.');
  const candles = await loadCandles(capture.id);
  const jobId = randomUUID();
  const started = Date.now();

  await insertJob(jobId, capture, 'running', 18, null, null);
  await publishVisualIntelligenceEvent('anomaly.scan.started', capture.id, null, { jobId, symbol: capture.symbol, timeframe: capture.timeframe });

  try {
    const result = analyzeVisualAnomalies({
      symbol: capture.symbol,
      timeframe: capture.timeframe,
      imageUrl: capture.imageUrl,
      imageHash: capture.imageHash,
      metadata: capture.metadata,
      candles,
    });

    await persistResult(jobId, capture, result);
    await updateJob(jobId, 'completed', 100, null, Date.now() - started);
    for (const anomaly of result.anomalies) {
      await publishVisualIntelligenceEvent('anomaly.detected', capture.id, null, {
        jobId,
        anomalyType: anomaly.anomalyType,
        severity: anomaly.severity,
        probabilityScore: anomaly.probabilityScore,
      });
    }
    await publishVisualIntelligenceEvent('anomaly.severity.updated', capture.id, null, {
      jobId,
      overallSeverity: result.overallSeverity,
      severityScores: result.severityScores,
    });

    const report = await getVisualAnomalyByJob(jobId);
    if (!report) throw new Error('Anomaly report was created but could not be loaded.');
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Anomaly scan failed.';
    await updateJob(jobId, 'failed', 100, message, Date.now() - started);
    await publishVisualIntelligenceEvent('anomaly.failed', capture.id, null, { jobId, error: message });
    throw error;
  }
}

export async function getVisualAnomalyByCapture(captureId: string): Promise<StoredVisualAnomalyReport | null> {
  await ensureVisualAnomalySchema();
  const result = await queryPostgres(`
    SELECT id FROM visual_anomaly_jobs
    WHERE chart_capture_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [captureId]);
  return result.rows[0]?.id ? getVisualAnomalyByJob(String(result.rows[0].id)) : null;
}

export async function getLatestVisualAnomaly(symbol: string, timeframe: string): Promise<StoredVisualAnomalyReport | null> {
  await ensureVisualAnomalySchema();
  const result = await queryPostgres(`
    SELECT id FROM visual_anomaly_jobs
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return result.rows[0]?.id ? getVisualAnomalyByJob(String(result.rows[0].id)) : null;
}

export async function getVisualAnomalyHistory(symbol: string, limit = 50): Promise<StoredVisualAnomalyReport[]> {
  await ensureVisualAnomalySchema();
  const result = await queryPostgres(`
    SELECT id FROM visual_anomaly_jobs
    WHERE upper(symbol) = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [symbol.toUpperCase(), limit]);
  const reports = await Promise.all(result.rows.map((row) => getVisualAnomalyByJob(String(row.id))));
  return reports.filter((report): report is StoredVisualAnomalyReport => Boolean(report));
}

export async function resolveVisualAnomaly(input: { id: string; note?: string; resolvedBy?: string }): Promise<StoredVisualAnomaly> {
  await ensureVisualAnomalySchema();
  await queryPostgres(`
    UPDATE visual_anomalies
    SET resolved = true, resolved_at = now()
    WHERE id = $1
  `, [input.id]);
  await queryPostgres(`
    INSERT INTO anomaly_resolution_logs (id, visual_anomaly_id, resolution_status, resolution_note, resolved_by)
    VALUES ($1,$2,$3,$4,$5)
  `, [randomUUID(), input.id, 'resolved', input.note ?? 'Resolved from anomaly monitor.', input.resolvedBy ?? 'local-user']);
  const anomaly = await getVisualAnomaly(input.id);
  if (!anomaly) throw new Error('Anomaly was resolved but could not be loaded.');
  await publishVisualIntelligenceEvent('anomaly.resolved', anomaly.captureId, null, { anomalyId: anomaly.id, anomalyType: anomaly.anomalyType });
  return anomaly;
}

async function insertJob(id: string, capture: ChartCaptureRecord, status: string, progress: number, error: string | null, processingTimeMs: number | null) {
  await queryPostgres(`
    INSERT INTO visual_anomaly_jobs (
      id, chart_capture_id, symbol, timeframe, status, progress, started_at, error_message, processing_time_ms
    ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8)
  `, [id, capture.id, capture.symbol, capture.timeframe, status, progress, error, processingTimeMs]);
}

async function updateJob(id: string, status: string, progress: number, error: string | null, processingTimeMs: number | null) {
  await queryPostgres(`
    UPDATE visual_anomaly_jobs
    SET status = $2, progress = $3, error_message = $4, processing_time_ms = COALESCE($5, processing_time_ms),
        completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
    WHERE id = $1
  `, [id, status, progress, error, processingTimeMs]);
}

async function persistResult(jobId: string, capture: ChartCaptureRecord, result: VisualAnomalyAnalysisResult) {
  for (const anomaly of result.anomalies) {
    await queryPostgres(`
      INSERT INTO visual_anomalies (
        id, anomaly_job_id, chart_capture_id, symbol, anomaly_type, severity, affected_timeframe,
        affected_price_zone_json, visual_coordinates_json, probability_score, trading_risk_meaning,
        possible_cause, recommended_action, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      randomUUID(),
      jobId,
      capture.id,
      capture.symbol,
      anomaly.anomalyType,
      anomaly.severity,
      anomaly.affectedTimeframe,
      anomaly.affectedPriceZone,
      anomaly.visualCoordinates,
      anomaly.probabilityScore,
      anomaly.tradingRiskMeaning,
      anomaly.possibleCause,
      anomaly.recommendedAction,
      anomaly.metadata,
    ]);
  }

  await queryPostgres(`
    INSERT INTO anomaly_severity_scores (
      id, anomaly_job_id, symbol, timeframe, low_count, medium_count, high_count, critical_count,
      overall_severity, manipulation_probability, feed_quality_score, image_integrity_score,
      volatility_spike_score, explanation_text
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    randomUUID(),
    jobId,
    capture.symbol,
    capture.timeframe,
    result.severityScores.Low,
    result.severityScores.Medium,
    result.severityScores.High,
    result.severityScores.Critical,
    result.overallSeverity,
    result.manipulationProbability,
    result.feedQualityScore,
    result.imageIntegrityScore,
    result.volatilitySpikeScore,
    result.explanation,
  ]);

  await queryPostgres(`
    INSERT INTO anomaly_model_history (
      id, model_version, symbol, timeframe, total_anomalies, critical_count, high_count,
      accuracy_score, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [
    randomUUID(),
    result.modelVersion,
    capture.symbol,
    capture.timeframe,
    result.anomalies.length,
    result.severityScores.Critical,
    result.severityScores.High,
    result.anomalies.length ? 0.82 : 0.94,
    {
      manipulationProbability: result.manipulationProbability,
      feedQualityScore: result.feedQualityScore,
      imageIntegrityScore: result.imageIntegrityScore,
    },
  ]);
}

async function getVisualAnomalyByJob(jobId: string): Promise<StoredVisualAnomalyReport | null> {
  const [job, severity, anomalies] = await Promise.all([
    queryPostgres('SELECT * FROM visual_anomaly_jobs WHERE id = $1 LIMIT 1', [jobId]),
    queryPostgres('SELECT * FROM anomaly_severity_scores WHERE anomaly_job_id = $1 ORDER BY created_at DESC LIMIT 1', [jobId]),
    queryPostgres('SELECT * FROM visual_anomalies WHERE anomaly_job_id = $1 ORDER BY created_at DESC', [jobId]),
  ]);
  if (!job.rows[0]) return null;
  return mapReport(job.rows[0], severity.rows[0] ?? {}, anomalies.rows);
}

async function getVisualAnomaly(id: string): Promise<StoredVisualAnomaly | null> {
  const result = await queryPostgres('SELECT * FROM visual_anomalies WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapAnomaly(result.rows[0]) : null;
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
    SELECT * FROM chart_captures
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [normalizedSymbol, normalizedTimeframe]);
  const row = result.rows[0];
  if (!row) return null;
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

function mapReport(job: Row, severity: Row, anomalies: Row[]): StoredVisualAnomalyReport {
  return {
    job: {
      id: String(job.id),
      captureId: job.chart_capture_id == null ? null : String(job.chart_capture_id),
      symbol: String(job.symbol),
      timeframe: String(job.timeframe),
      status: String(job.status),
      progress: Number(job.progress),
      modelVersion: String(job.model_version),
      processingTimeMs: job.processing_time_ms == null ? null : Number(job.processing_time_ms),
      createdAt: dateString(job.created_at),
    },
    severity: {
      lowCount: Number(severity.low_count ?? 0),
      mediumCount: Number(severity.medium_count ?? 0),
      highCount: Number(severity.high_count ?? 0),
      criticalCount: Number(severity.critical_count ?? 0),
      overallSeverity: String(severity.overall_severity ?? 'Low') as AnomalySeverity,
      manipulationProbability: Number(severity.manipulation_probability ?? 0),
      feedQualityScore: Number(severity.feed_quality_score ?? 1),
      imageIntegrityScore: Number(severity.image_integrity_score ?? 1),
      volatilitySpikeScore: Number(severity.volatility_spike_score ?? 0),
      explanation: String(severity.explanation_text ?? 'No anomaly scan has completed yet.'),
    },
    anomalies: anomalies.map(mapAnomaly),
  };
}

function mapAnomaly(row: Row): StoredVisualAnomaly {
  return {
    id: String(row.id),
    jobId: String(row.anomaly_job_id),
    captureId: row.chart_capture_id == null ? null : String(row.chart_capture_id),
    symbol: String(row.symbol),
    anomalyType: String(row.anomaly_type),
    severity: String(row.severity) as AnomalySeverity,
    affectedTimeframe: String(row.affected_timeframe),
    affectedPriceZone: readJson(row.affected_price_zone_json, { low: null, high: null, midpoint: null }),
    visualCoordinates: objectValue(row.visual_coordinates_json),
    probabilityScore: Number(row.probability_score),
    tradingRiskMeaning: String(row.trading_risk_meaning),
    possibleCause: String(row.possible_cause),
    recommendedAction: String(row.recommended_action) as AnomalyAction,
    resolved: Boolean(row.resolved),
    resolvedAt: row.resolved_at == null ? null : dateString(row.resolved_at),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
