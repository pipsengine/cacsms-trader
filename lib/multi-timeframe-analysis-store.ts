import { randomUUID } from 'node:crypto';

import {
  MTF_TIMEFRAMES,
  analyzeMultiTimeframe,
  normalizeMtfCandles,
  type MtfCandleInput,
  type MtfTimeframe,
  type MultiTimeframeAnalysisResult,
  type MultiTimeframeDecision,
  type TimeframeAlignmentScore,
  type TimeframeAnalysisSnapshot,
  type TimeframeConflictLog,
} from './multi-timeframe-analysis-engine';
import { queryPostgres } from './postgres';
import { publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ReconstructedCandle } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS timeframe_analysis_snapshots (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  trend_direction TEXT NOT NULL,
  market_structure TEXT NOT NULL,
  last_bos_direction TEXT,
  last_choch_direction TEXT,
  liquidity_status TEXT NOT NULL,
  order_block_status TEXT NOT NULL,
  support_resistance_reaction TEXT NOT NULL,
  candle_momentum TEXT NOT NULL,
  volatility_condition TEXT NOT NULL,
  ai_confidence_score NUMERIC(8, 4) NOT NULL,
  bias TEXT NOT NULL,
  decision_state TEXT NOT NULL,
  structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS timeframe_alignment_scores (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  left_timeframe TEXT NOT NULL,
  right_timeframe TEXT NOT NULL,
  alignment_state TEXT NOT NULL,
  alignment_score NUMERIC(8, 4) NOT NULL,
  trend_match BOOLEAN NOT NULL,
  structure_match BOOLEAN NOT NULL,
  liquidity_match BOOLEAN NOT NULL,
  order_block_match BOOLEAN NOT NULL,
  support_resistance_match BOOLEAN NOT NULL,
  explanation_text TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS timeframe_conflict_logs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  higher_timeframe TEXT NOT NULL,
  lower_timeframe TEXT NOT NULL,
  severity_score NUMERIC(8, 4) NOT NULL,
  description TEXT NOT NULL,
  recommended_resolution TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS multi_timeframe_decisions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  final_decision TEXT NOT NULL,
  final_bias TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  controlling_timeframe TEXT NOT NULL,
  lower_timeframe_confirmation TEXT NOT NULL,
  scalp_only BOOLEAN NOT NULL DEFAULT false,
  market_narrative TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mtf_snapshots_symbol_tf ON timeframe_analysis_snapshots(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_alignment_symbol ON timeframe_alignment_scores(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_conflicts_symbol ON timeframe_conflict_logs(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mtf_decisions_symbol ON multi_timeframe_decisions(symbol, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureMultiTimeframeSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeSymbolMultiTimeframe(input: {
  symbol: string;
  candles?: MtfCandleInput;
  captureIds?: Partial<Record<MtfTimeframe, string>>;
}): Promise<MultiTimeframeAnalysisResult> {
  await ensureMultiTimeframeSchema();
  const symbol = input.symbol.toUpperCase();
  await publishVisualIntelligenceEvent('mtf.analysis.started', null, null, { symbol, timeframes: MTF_TIMEFRAMES });

  const { candleMap, captureMap } = await loadMtfCandles(symbol, input);
  const result = analyzeMultiTimeframe(symbol, candleMap, captureMap);
  await replaceMtfAnalysis(result);

  for (const snapshot of result.snapshots) {
    await publishVisualIntelligenceEvent('mtf.timeframe.completed', snapshot.chartCaptureId ?? null, null, {
      symbol,
      timeframe: snapshot.timeframe,
      bias: snapshot.bias,
      decisionState: snapshot.decisionState,
      confidence: snapshot.aiConfidenceScore,
    });
  }
  await publishVisualIntelligenceEvent('mtf.alignment.updated', null, null, {
    symbol,
    alignments: result.alignments,
  });
  for (const conflict of result.conflicts) {
    await publishVisualIntelligenceEvent('mtf.conflict.detected', null, null, { ...conflict });
  }
  await publishVisualIntelligenceEvent('mtf.final.decision', null, null, { ...result.decision });
  return result;
}

export async function getSymbolMultiTimeframe(symbol: string): Promise<MultiTimeframeAnalysisResult | null> {
  await ensureMultiTimeframeSchema();
  const normalized = symbol.toUpperCase();
  const [snapshots, alignments, conflicts, decision] = await Promise.all([
    getTimeframeSnapshots(normalized),
    getTimeframeAlignments(normalized),
    getTimeframeConflicts(normalized),
    getMultiTimeframeDecision(normalized),
  ]);
  if (!snapshots.length && !decision) return null;
  return {
    symbol: normalized,
    snapshots,
    alignments,
    conflicts,
    decision: decision ?? emptyDecision(normalized),
  };
}

export async function getSymbolAlignment(symbol: string): Promise<TimeframeAlignmentScore[]> {
  await ensureMultiTimeframeSchema();
  return getTimeframeAlignments(symbol.toUpperCase());
}

export async function getSymbolDecision(symbol: string): Promise<MultiTimeframeDecision | null> {
  await ensureMultiTimeframeSchema();
  return getMultiTimeframeDecision(symbol.toUpperCase());
}

export interface MtfTimeframeReadiness {
  timeframe: MtfTimeframe;
  captureId: string | null;
  capturedAt: string | null;
  candleCount: number;
  analyzed: boolean;
  analyzedAt: string | null;
  readyForAnalysis: boolean;
}

export async function getMtfReadiness(symbol: string): Promise<MtfTimeframeReadiness[]> {
  await ensureMultiTimeframeSchema();
  const normalized = symbol.toUpperCase();
  const snapshots = await getTimeframeSnapshots(normalized);
  const snapshotByTf = new Map(snapshots.map((item) => [item.timeframe, item]));

  const readiness: MtfTimeframeReadiness[] = [];
  for (const timeframe of MTF_TIMEFRAMES) {
    const captureId = await findLatestCaptureId(normalized, timeframe);
    let candleCount = 0;
    let capturedAt: string | null = null;
    if (captureId) {
      const capture = await queryPostgres(
        'SELECT captured_at FROM chart_captures WHERE id = $1 LIMIT 1',
        [captureId],
      );
      capturedAt = capture.rows[0]?.captured_at ? dateString(capture.rows[0].captured_at) : null;
      const candles = await queryPostgres(
        'SELECT COUNT(*)::int AS count FROM reconstructed_candles WHERE chart_capture_id = $1',
        [captureId],
      );
      candleCount = Number(candles.rows[0]?.count ?? 0);
    }
    const snapshot = snapshotByTf.get(timeframe);
    const analyzed = Boolean(
      snapshot
      && snapshot.aiConfidenceScore > 0
      && snapshot.marketStructure !== 'no_backend_chart_data',
    );
    readiness.push({
      timeframe,
      captureId,
      capturedAt,
      candleCount,
      analyzed,
      analyzedAt: snapshot?.createdAt ?? null,
      readyForAnalysis: candleCount >= 12,
    });
  }
  return readiness;
}

export async function getMtfCoverageMap(): Promise<Record<string, number>> {
  await ensureMultiTimeframeSchema();
  const result = await queryPostgres(`
    SELECT symbol, COUNT(DISTINCT timeframe)::int AS timeframe_count
    FROM timeframe_analysis_snapshots
    WHERE market_structure <> 'no_backend_chart_data'
      AND ai_confidence_score > 0
    GROUP BY symbol
  `);
  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[String(row.symbol).toUpperCase()] = Number(row.timeframe_count);
  }
  return coverage;
}

async function loadMtfCandles(symbol: string, input: { candles?: MtfCandleInput; captureIds?: Partial<Record<MtfTimeframe, string>> }) {
  const candleMap: Partial<Record<MtfTimeframe, ReconstructedCandle[]>> = {};
  const captureMap: Partial<Record<MtfTimeframe, string | null>> = {};
  for (const timeframe of MTF_TIMEFRAMES) {
    if (input.candles?.[timeframe]?.length) {
      candleMap[timeframe] = normalizeMtfCandles(input.candles[timeframe]);
      captureMap[timeframe] = input.captureIds?.[timeframe] ?? null;
      continue;
    }
    const captureId = input.captureIds?.[timeframe] ?? await findLatestCaptureId(symbol, timeframe);
    captureMap[timeframe] = captureId ?? null;
    candleMap[timeframe] = captureId ? await loadCaptureCandles(captureId) : [];
  }
  return { candleMap, captureMap };
}

async function findLatestCaptureId(symbol: string, timeframe: MtfTimeframe): Promise<string | null> {
  const result = await queryPostgres(`
    SELECT id FROM chart_captures
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

async function loadCaptureCandles(captureId: string): Promise<ReconstructedCandle[]> {
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

async function replaceMtfAnalysis(result: MultiTimeframeAnalysisResult) {
  await queryPostgres('DELETE FROM timeframe_analysis_snapshots WHERE symbol = $1', [result.symbol]);
  await queryPostgres('DELETE FROM timeframe_alignment_scores WHERE symbol = $1', [result.symbol]);
  await queryPostgres('DELETE FROM timeframe_conflict_logs WHERE symbol = $1', [result.symbol]);
  await queryPostgres('DELETE FROM multi_timeframe_decisions WHERE symbol = $1', [result.symbol]);

  for (const snapshot of result.snapshots) {
    await queryPostgres(`
      INSERT INTO timeframe_analysis_snapshots (
        id, symbol, timeframe, chart_capture_id, trend_direction, market_structure, last_bos_direction,
        last_choch_direction, liquidity_status, order_block_status, support_resistance_reaction,
        candle_momentum, volatility_condition, ai_confidence_score, bias, decision_state,
        structure_json, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `, [
      randomUUID(), snapshot.symbol, snapshot.timeframe, snapshot.chartCaptureId ?? null,
      snapshot.trendDirection, snapshot.marketStructure, snapshot.lastBosDirection, snapshot.lastChochDirection,
      snapshot.liquidityStatus, snapshot.orderBlockStatus, snapshot.supportResistanceReaction,
      snapshot.candleMomentum, snapshot.volatilityCondition, snapshot.aiConfidenceScore,
      snapshot.bias, snapshot.decisionState, snapshot.structure, snapshot.metadata,
    ]);
  }

  for (const alignment of result.alignments) {
    await queryPostgres(`
      INSERT INTO timeframe_alignment_scores (
        id, symbol, left_timeframe, right_timeframe, alignment_state, alignment_score,
        trend_match, structure_match, liquidity_match, order_block_match, support_resistance_match,
        explanation_text, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      randomUUID(), alignment.symbol, alignment.leftTimeframe, alignment.rightTimeframe,
      alignment.alignmentState, alignment.alignmentScore, alignment.trendMatch, alignment.structureMatch,
      alignment.liquidityMatch, alignment.orderBlockMatch, alignment.supportResistanceMatch,
      alignment.explanationText, alignment.metadata,
    ]);
  }

  for (const conflict of result.conflicts) {
    await queryPostgres(`
      INSERT INTO timeframe_conflict_logs (
        id, symbol, conflict_type, higher_timeframe, lower_timeframe, severity_score,
        description, recommended_resolution, metadata_json
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      randomUUID(), conflict.symbol, conflict.conflictType, conflict.higherTimeframe,
      conflict.lowerTimeframe, conflict.severityScore, conflict.description,
      conflict.recommendedResolution, conflict.metadata,
    ]);
  }

  const decision = result.decision;
  await queryPostgres(`
    INSERT INTO multi_timeframe_decisions (
      id, symbol, final_decision, final_bias, confidence_score, controlling_timeframe,
      lower_timeframe_confirmation, scalp_only, market_narrative, metadata_json
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `, [
    randomUUID(), decision.symbol, decision.finalDecision, decision.finalBias, decision.confidenceScore,
    decision.controllingTimeframe, decision.lowerTimeframeConfirmation, decision.scalpOnly,
    decision.marketNarrative, decision.metadata,
  ]);
}

async function getTimeframeSnapshots(symbol: string): Promise<TimeframeAnalysisSnapshot[]> {
  const result = await queryPostgres(`
    SELECT DISTINCT ON (timeframe) * FROM timeframe_analysis_snapshots
    WHERE symbol = $1
    ORDER BY timeframe, created_at DESC
  `, [symbol]);
  const rows = result.rows.map(mapSnapshot);
  return [...rows].sort((a, b) => MTF_TIMEFRAMES.indexOf(a.timeframe) - MTF_TIMEFRAMES.indexOf(b.timeframe));
}

async function getTimeframeAlignments(symbol: string): Promise<TimeframeAlignmentScore[]> {
  const result = await queryPostgres(`
    SELECT * FROM timeframe_alignment_scores
    WHERE symbol = $1
    ORDER BY created_at DESC
    LIMIT 4
  `, [symbol]);
  return result.rows.map(mapAlignment).sort((a, b) => MTF_TIMEFRAMES.indexOf(a.leftTimeframe) - MTF_TIMEFRAMES.indexOf(b.leftTimeframe));
}

async function getTimeframeConflicts(symbol: string): Promise<TimeframeConflictLog[]> {
  const result = await queryPostgres(`
    SELECT * FROM timeframe_conflict_logs
    WHERE symbol = $1
    ORDER BY severity_score DESC, created_at DESC
    LIMIT 12
  `, [symbol]);
  return result.rows.map(mapConflict);
}

async function getMultiTimeframeDecision(symbol: string): Promise<MultiTimeframeDecision | null> {
  const result = await queryPostgres(`
    SELECT * FROM multi_timeframe_decisions
    WHERE symbol = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [symbol]);
  return result.rows[0] ? mapDecision(result.rows[0]) : null;
}

function mapSnapshot(row: Row): TimeframeAnalysisSnapshot {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe) as MtfTimeframe,
    chartCaptureId: row.chart_capture_id == null ? null : String(row.chart_capture_id),
    trendDirection: String(row.trend_direction),
    marketStructure: String(row.market_structure),
    lastBosDirection: row.last_bos_direction == null ? null : String(row.last_bos_direction),
    lastChochDirection: row.last_choch_direction == null ? null : String(row.last_choch_direction),
    liquidityStatus: String(row.liquidity_status),
    orderBlockStatus: String(row.order_block_status),
    supportResistanceReaction: String(row.support_resistance_reaction),
    candleMomentum: String(row.candle_momentum),
    volatilityCondition: String(row.volatility_condition),
    aiConfidenceScore: Number(row.ai_confidence_score),
    bias: String(row.bias) as TimeframeAnalysisSnapshot['bias'],
    decisionState: String(row.decision_state) as TimeframeAnalysisSnapshot['decisionState'],
    structure: objectValue(row.structure_json),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapAlignment(row: Row): TimeframeAlignmentScore {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    leftTimeframe: String(row.left_timeframe) as MtfTimeframe,
    rightTimeframe: String(row.right_timeframe) as MtfTimeframe,
    alignmentState: String(row.alignment_state) as TimeframeAlignmentScore['alignmentState'],
    alignmentScore: Number(row.alignment_score),
    trendMatch: Boolean(row.trend_match),
    structureMatch: Boolean(row.structure_match),
    liquidityMatch: Boolean(row.liquidity_match),
    orderBlockMatch: Boolean(row.order_block_match),
    supportResistanceMatch: Boolean(row.support_resistance_match),
    explanationText: String(row.explanation_text),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapConflict(row: Row): TimeframeConflictLog {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    conflictType: String(row.conflict_type),
    higherTimeframe: String(row.higher_timeframe) as MtfTimeframe,
    lowerTimeframe: String(row.lower_timeframe) as MtfTimeframe,
    severityScore: Number(row.severity_score),
    description: String(row.description),
    recommendedResolution: String(row.recommended_resolution),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function mapDecision(row: Row): MultiTimeframeDecision {
  return {
    id: String(row.id),
    symbol: String(row.symbol),
    finalDecision: String(row.final_decision) as MultiTimeframeDecision['finalDecision'],
    finalBias: String(row.final_bias),
    confidenceScore: Number(row.confidence_score),
    controllingTimeframe: String(row.controlling_timeframe) as MultiTimeframeDecision['controllingTimeframe'],
    lowerTimeframeConfirmation: String(row.lower_timeframe_confirmation),
    scalpOnly: Boolean(row.scalp_only),
    marketNarrative: String(row.market_narrative),
    metadata: objectValue(row.metadata_json),
    createdAt: dateString(row.created_at),
  };
}

function emptyDecision(symbol: string): MultiTimeframeDecision {
  return {
    symbol,
    finalDecision: 'WAIT',
    finalBias: 'No multi-timeframe backend analysis available.',
    confidenceScore: 0,
    controllingTimeframe: 'none',
    lowerTimeframeConfirmation: 'No lower timeframe confirmation.',
    scalpOnly: false,
    marketNarrative: 'Run analysis with candles or capture data for W, D, H4, H1 and M15.',
    metadata: {},
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
