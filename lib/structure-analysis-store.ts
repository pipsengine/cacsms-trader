import { randomUUID } from 'crypto';

import {
  analyzeMarketStructure,
  normalizeStructureInputCandles,
  type StructureAnalysisOutput,
  type StructureAnalysisResult,
  type StructureEvent,
  type StructurePhaseSnapshot,
} from './structure-analysis-engine';
import { queryPostgres } from './postgres';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest, ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS structure_analysis_outputs (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  current_structure TEXT NOT NULL,
  current_market_phase TEXT NOT NULL,
  institutional_bias TEXT NOT NULL,
  retail_trap_risk NUMERIC(8, 4) NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  trade_decision TEXT NOT NULL,
  mss_status TEXT NOT NULL,
  last_bos_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_choch_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  multi_timeframe_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS structure_events (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  candle_index INTEGER NOT NULL,
  price_level NUMERIC(18, 6) NOT NULL,
  validation_score NUMERIC(8, 4) NOT NULL,
  displacement_score NUMERIC(8, 4) NOT NULL,
  liquidity_context_score NUMERIC(8, 4) NOT NULL,
  false_break_risk NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  geometry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS structure_phase_snapshots (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  phase_state TEXT NOT NULL,
  accumulation_score NUMERIC(8, 4) NOT NULL,
  manipulation_score NUMERIC(8, 4) NOT NULL,
  expansion_score NUMERIC(8, 4) NOT NULL,
  distribution_score NUMERIC(8, 4) NOT NULL,
  consolidation_score NUMERIC(8, 4) NOT NULL,
  continuation_score NUMERIC(8, 4) NOT NULL,
  reversal_score NUMERIC(8, 4) NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS structure_feedback (
  id UUID PRIMARY KEY,
  structure_output_id UUID NOT NULL REFERENCES structure_analysis_outputs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  correction_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_structure_outputs_capture ON structure_analysis_outputs(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_structure_events_capture_type ON structure_events(chart_capture_id, event_type, candle_index DESC);
CREATE INDEX IF NOT EXISTS idx_structure_phase_capture ON structure_phase_snapshots(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_structure_feedback_output ON structure_feedback(structure_output_id, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureStructureSchema() {
  if (!schemaReady) {
    schemaReady = queryPostgres(schemaSql)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

export async function analyzeCaptureStructure(input: ChartCaptureRequest & { captureId?: string }): Promise<StructureAnalysisResult & { captureId: string }> {
  await ensureStructureSchema();
  await publishVisualIntelligenceEvent('structure.analysis.started', input.captureId ?? null, null, { stage: 'market_structure_started' });

  const captureId = input.captureId ?? (await createCaptureAndRunAnalysis(input)).capture.id;
  const candles = input.candles?.length
    ? normalizeStructureInputCandles(input.candles)
    : await loadReconstructedCandles(captureId);
  if (candles.length < 12) throw new Error('At least twelve candles are required for market structure analysis.');

  const result = analyzeMarketStructure(candles, input.timeframe);
  await replaceStructureAnalysis(captureId, result);
  const persisted = await getStructureAnalysis(captureId);
  await publishVisualIntelligenceEvent('structure.analysis.completed', captureId, null, {
    summary: persisted.summary,
    eventCount: persisted.events.length,
    decision: persisted.output.tradeDecision,
  });
  return persisted;
}

export async function getStructureAnalysis(captureId: string): Promise<StructureAnalysisResult & { captureId: string }> {
  await ensureStructureSchema();
  const [output, events, phase] = await Promise.all([
    getStructureOutput(captureId),
    getStructureEvents(captureId),
    getStructurePhase(captureId),
  ]);
  const safeOutput = output ?? emptyOutput();
  const safePhase = phase ?? emptyPhase();
  const bos = events.filter((event) => event.eventType === 'BOS');
  const choch = events.filter((event) => event.eventType === 'CHOCH');
  const mss = events.filter((event) => event.eventType === 'MSS');
  return {
    captureId,
    output: safeOutput,
    events,
    bos,
    choch,
    mss,
    phase: safePhase,
    finalBias: {
      institutionalBias: safeOutput.institutionalBias,
      retailTrapRisk: safeOutput.retailTrapRisk,
      confidenceScore: safeOutput.confidenceScore,
      tradeDecision: safeOutput.tradeDecision,
      reasoningText: safeOutput.reasoningText,
      multiTimeframe: safeOutput.multiTimeframe,
    },
    summary: {
      currentStructure: safeOutput.currentStructure,
      currentMarketPhase: safeOutput.currentMarketPhase,
      institutionalBias: safeOutput.institutionalBias,
      tradeDecision: safeOutput.tradeDecision,
      confidence: safeOutput.confidenceScore,
      explanation: safeOutput.reasoningText,
    },
  };
}

export async function getStructureBos(captureId: string): Promise<StructureEvent[]> {
  return (await getStructureEvents(captureId)).filter((event) => event.eventType === 'BOS');
}

export async function getStructureChoch(captureId: string): Promise<StructureEvent[]> {
  return (await getStructureEvents(captureId)).filter((event) => event.eventType === 'CHOCH');
}

export async function getStructureFinalBias(captureId: string) {
  const analysis = await getStructureAnalysis(captureId);
  return analysis.finalBias;
}

export async function getStructureCoverageMap(): Promise<Record<string, number>> {
  await ensureStructureSchema();
  const result = await queryPostgres(`
    SELECT chart_capture_id, COUNT(*)::int AS event_count
    FROM structure_events
    GROUP BY chart_capture_id
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.chart_capture_id)] = Number(row.event_count);
  }
  return coverage;
}

export async function createStructureFeedback(input: {
  structureOutputId: string;
  userId?: string;
  feedbackType: string;
  correction?: Record<string, unknown>;
  comment?: string;
}) {
  await ensureStructureSchema();
  const result = await queryPostgres(`
    INSERT INTO structure_feedback (id, structure_output_id, user_id, feedback_type, correction_json, comment)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *
  `, [
    randomUUID(),
    input.structureOutputId,
    input.userId ?? 'local-user',
    input.feedbackType,
    input.correction ?? {},
    input.comment ?? null,
  ]);
  await publishVisualIntelligenceEvent('structure.feedback.recorded', null, null, { feedback: result.rows[0] });
  return result.rows[0];
}

async function getStructureOutput(captureId: string): Promise<StructureAnalysisOutput | null> {
  await ensureStructureSchema();
  const result = await queryPostgres(`
    SELECT * FROM structure_analysis_outputs
    WHERE chart_capture_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [captureId]);
  return result.rows[0] ? mapOutput(result.rows[0]) : null;
}

async function getStructureEvents(captureId: string): Promise<StructureEvent[]> {
  await ensureStructureSchema();
  const result = await queryPostgres(`
    SELECT * FROM structure_events
    WHERE chart_capture_id = $1
    ORDER BY candle_index ASC, created_at ASC
  `, [captureId]);
  return result.rows.map(mapEvent);
}

export async function getStructurePhase(captureId: string): Promise<StructurePhaseSnapshot | null> {
  await ensureStructureSchema();
  const result = await queryPostgres(`
    SELECT * FROM structure_phase_snapshots
    WHERE chart_capture_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [captureId]);
  return result.rows[0] ? mapPhase(result.rows[0]) : null;
}

async function loadReconstructedCandles(captureId: string): Promise<ReconstructedCandle[]> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.candles ?? [];
}

async function replaceStructureAnalysis(captureId: string, result: StructureAnalysisResult) {
  await queryPostgres('DELETE FROM structure_events WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM structure_phase_snapshots WHERE chart_capture_id = $1', [captureId]);
  await queryPostgres('DELETE FROM structure_analysis_outputs WHERE chart_capture_id = $1', [captureId]);

  const outputId = randomUUID();
  const output = result.output;
  await queryPostgres(`
    INSERT INTO structure_analysis_outputs (
      id, chart_capture_id, current_structure, current_market_phase, institutional_bias,
      retail_trap_risk, confidence_score, trade_decision, mss_status, last_bos_json,
      last_choch_json, multi_timeframe_json, reasoning_text, metadata_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    outputId, captureId, output.currentStructure, output.currentMarketPhase, output.institutionalBias,
    output.retailTrapRisk, output.confidenceScore, output.tradeDecision, output.mssStatus,
    output.lastBos, output.lastChoch, output.multiTimeframe, output.reasoningText, output.metadata,
  ]);

  for (const event of result.events) {
    await queryPostgres(`
      INSERT INTO structure_events (
        id, chart_capture_id, event_type, direction, candle_index, price_level, validation_score,
        displacement_score, liquidity_context_score, false_break_risk, explanation_text,
        geometry_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      randomUUID(), captureId, event.eventType, event.direction, event.candleIndex, event.priceLevel,
      event.validationScore, event.displacementScore, event.liquidityContextScore, event.falseBreakRisk,
      event.explanationText, event.geometry, event.metadata,
    ]);
  }

  const phase = result.phase;
  await queryPostgres(`
    INSERT INTO structure_phase_snapshots (
      id, chart_capture_id, phase_state, accumulation_score, manipulation_score, expansion_score,
      distribution_score, consolidation_score, continuation_score, reversal_score, explanation_text,
      metadata_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    randomUUID(), captureId, phase.phaseState, phase.accumulationScore, phase.manipulationScore,
    phase.expansionScore, phase.distributionScore, phase.consolidationScore, phase.continuationScore,
    phase.reversalScore, phase.explanationText, phase.metadata,
  ]);
}

function mapOutput(row: Row): StructureAnalysisOutput {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    currentStructure: String(row.current_structure),
    currentMarketPhase: String(row.current_market_phase),
    institutionalBias: String(row.institutional_bias),
    retailTrapRisk: Number(row.retail_trap_risk),
    confidenceScore: Number(row.confidence_score),
    tradeDecision: String(row.trade_decision) as StructureAnalysisOutput['tradeDecision'],
    mssStatus: String(row.mss_status),
    lastBos: objectValue(row.last_bos_json),
    lastChoch: objectValue(row.last_choch_json),
    multiTimeframe: objectValue(row.multi_timeframe_json),
    reasoningText: String(row.reasoning_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapEvent(row: Row): StructureEvent {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    eventType: String(row.event_type) as StructureEvent['eventType'],
    direction: String(row.direction) as StructureEvent['direction'],
    candleIndex: Number(row.candle_index),
    priceLevel: Number(row.price_level),
    validationScore: Number(row.validation_score),
    displacementScore: Number(row.displacement_score),
    liquidityContextScore: Number(row.liquidity_context_score),
    falseBreakRisk: Number(row.false_break_risk),
    explanationText: String(row.explanation_text),
    geometry: objectValue(row.geometry_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapPhase(row: Row): StructurePhaseSnapshot {
  return {
    id: String(row.id),
    chartCaptureId: String(row.chart_capture_id),
    phaseState: String(row.phase_state),
    accumulationScore: Number(row.accumulation_score),
    manipulationScore: Number(row.manipulation_score),
    expansionScore: Number(row.expansion_score),
    distributionScore: Number(row.distribution_score),
    consolidationScore: Number(row.consolidation_score),
    continuationScore: Number(row.continuation_score),
    reversalScore: Number(row.reversal_score),
    explanationText: String(row.explanation_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function emptyOutput(): StructureAnalysisOutput {
  return {
    currentStructure: 'none',
    currentMarketPhase: 'unknown',
    institutionalBias: 'neutral/ranging bias',
    retailTrapRisk: 0,
    confidenceScore: 0,
    tradeDecision: 'WAIT',
    mssStatus: 'no_confirmed_mss',
    lastBos: {},
    lastChoch: {},
    multiTimeframe: {},
    reasoningText: 'No market structure analysis is available yet.',
    metadata: {},
  };
}

function emptyPhase(): StructurePhaseSnapshot {
  return {
    phaseState: 'unknown',
    accumulationScore: 0,
    manipulationScore: 0,
    expansionScore: 0,
    distributionScore: 0,
    consolidationScore: 0,
    continuationScore: 0,
    reversalScore: 0,
    explanationText: 'No market phase snapshot is available yet.',
    metadata: {},
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
