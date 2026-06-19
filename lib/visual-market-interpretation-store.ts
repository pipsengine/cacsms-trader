import { randomUUID } from 'node:crypto';

import { getLatestAiVisualInterpretation } from './ai-visual-interpretation-store';
import { getLatestChartSegmentation } from './chart-segmentation-store';
import { getImageComparisonHistory } from './image-comparison-store';
import { getLatestVisualAnomaly } from './visual-anomaly-detection-store';
import { normalizeInstitutionalTimeframe } from './institutional-timeframe-normalize';
import { fuseVisualMarketInterpretation, marketInterpretationWeights, type FinalMarketDecision, type FusionSignal, type MarketBias, type VisualMarketInterpretationResult } from './visual-market-interpretation-engine';
import type { TimeframeAnalysisSnapshot } from './multi-timeframe-analysis-engine';
import { getSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { getCandleAnalysis } from './candle-detection-store';
import { getLiquidityAnalysis } from './liquidity-zone-store';
import { getOrderBlockAnalysis } from './order-block-detection-store';
import { getPatternAnalysis } from './pattern-recognition-store';
import { queryPostgres } from './postgres';
import { getStructureAnalysis } from './structure-analysis-store';
import { getSupportResistanceAnalysis } from './support-resistance-store';
import { resolveLatestCaptureId } from './capture-analysis-bootstrap';
import { resolveExecutionAccountContext } from './execution-account-context';
import { listCaptures, publishVisualIntelligenceEvent } from './visual-intelligence-store';

type Row = Record<string, unknown>;

const fixedTimeframes = ['MN', 'W', 'D', 'H4', 'H1', 'M15', 'M30', 'M5', 'M1'] as const;

export const MARKET_INTERPRETATION_TIMEFRAMES = fixedTimeframes;
export type MarketInterpretationTimeframe = (typeof fixedTimeframes)[number];
export const MARKET_INTERPRETATION_SIGNAL_TIMEFRAME: MarketInterpretationTimeframe = 'M15';

export interface MarketInterpretationTimeframeReadiness {
  timeframe: MarketInterpretationTimeframe;
  captureId: string | null;
  capturedAt: string | null;
  candleCount: number;
  hasCapture: boolean;
  hasMtfSnapshot: boolean;
  hasAiInterpretation: boolean;
  hasAnomalyScan: boolean;
  hasSegmentation: boolean;
  readyForFusion: boolean;
}

export interface MarketInterpretationReadiness {
  symbol: string;
  signalTimeframe: MarketInterpretationTimeframe;
  interpretationCount: number;
  latestInterpretationAt: string | null;
  finalDecision: string | null;
  setupReadinessScore: number;
  confidenceScore: number;
  dominantTimeframe: string | null;
  timeframes: MarketInterpretationTimeframeReadiness[];
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS visual_market_interpretation_jobs (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  error_text TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS visual_market_interpretations (
  id UUID PRIMARY KEY,
  job_id UUID,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  dominant_timeframe TEXT NOT NULL,
  final_market_bias TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  liquidity_objective TEXT NOT NULL,
  market_phase TEXT NOT NULL,
  setup_readiness_score NUMERIC(8, 4) NOT NULL,
  final_decision TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  entry_readiness TEXT NOT NULL,
  invalidation_condition TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  full_ai_market_narrative TEXT NOT NULL,
  previous_interpretation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE visual_market_interpretations ADD COLUMN IF NOT EXISTS job_id UUID;
CREATE TABLE IF NOT EXISTS final_decision_scores (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  scores_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  weights_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS timeframe_control_states (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  bias TEXT NOT NULL,
  control_score NUMERIC(8, 4) NOT NULL,
  confirms_entry BOOLEAN NOT NULL DEFAULT false,
  narrative_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS institutional_bias_logs (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  bias TEXT NOT NULL,
  interpretation_text TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS setup_readiness_scores (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  readiness_score NUMERIC(8, 4) NOT NULL,
  entry_readiness TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS visual_decision_audit_trails (
  id UUID PRIMARY KEY,
  market_interpretation_id UUID NOT NULL REFERENCES visual_market_interpretations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  finding TEXT NOT NULL,
  score NUMERIC(8, 4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_visual_market_interpretations_symbol ON visual_market_interpretations(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visual_market_interpretations_symbol_tf ON visual_market_interpretations(symbol, timeframe, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export interface StoredVisualMarketInterpretation extends VisualMarketInterpretationResult {
  id: string;
  jobId: string | null;
  symbol: string;
  timeframe: string;
  marketMeaning: string;
  retailTrapWarning: string;
  recommendedAction: FinalMarketDecision;
  explanation: string;
  previousInterpretation: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function ensureVisualMarketInterpretationSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeVisualMarketInterpretation(input: { symbol: string; timeframe?: string }): Promise<StoredVisualMarketInterpretation> {
  await ensureVisualMarketInterpretationSchema();
  const symbol = input.symbol.toUpperCase();
  const timeframe = normalizeTimeframe(input.timeframe);
  const jobId = randomUUID();
  await createJob(jobId, symbol, timeframe);
  try {
    const previous = await getLatestVisualMarketInterpretation(symbol, timeframe);
    await publishVisualIntelligenceEvent('market.interpretation.started', null, null, { jobId, symbol, timeframe });
    await updateJob(jobId, 'running', 'collecting.outputs');
    await publishVisualIntelligenceEvent('market.interpretation.collecting.outputs', null, null, { jobId, symbol, timeframe });
    const collected = await collectOutputs(symbol, timeframe);
    await updateJob(jobId, 'running', 'scoring');
    await publishVisualIntelligenceEvent('market.interpretation.scoring', null, null, { jobId, signalCount: collected.signals.length });
    const account = await resolveExecutionAccountContext();
    const fused = fuseVisualMarketInterpretation({
      symbol,
      timeframe,
      signals: collected.signals,
      timeframeStates: collected.timeframeStates,
      previousDecision: previous?.finalDecision ?? null,
      accountClass: account?.accountClass ?? 'demo',
      ltfScalpMode: collected.ltfScalpMode,
      mtfScalpOnly: collected.mtfScalpOnly,
    });
    const stored = await persistInterpretation(jobId, symbol, timeframe, fused, previous, collected.raw);
    await updateJob(jobId, 'completed', 'decision.ready', { interpretationId: stored.id, finalDecision: stored.finalDecision });
    await publishVisualIntelligenceEvent('market.interpretation.decision.ready', null, null, {
      jobId,
      symbol,
      timeframe,
      finalDecision: stored.finalDecision,
      setupReadinessScore: stored.setupReadinessScore,
    });
    return stored;
  } catch (error) {
    await updateJob(jobId, 'failed', 'failed', { error: error instanceof Error ? error.message : 'Unknown visual market interpretation error.' });
    throw error;
  }
}

export async function regenerateVisualMarketInterpretation(input: { symbol: string; timeframe?: string }) {
  const result = await analyzeVisualMarketInterpretation(input);
  await publishVisualIntelligenceEvent('market.interpretation.updated', null, null, {
    symbol: result.symbol,
    timeframe: result.timeframe,
    finalDecision: result.finalDecision,
  });
  return result;
}

export async function getLatestVisualMarketInterpretation(symbol: string, timeframe?: string): Promise<StoredVisualMarketInterpretation | null> {
  await ensureVisualMarketInterpretationSchema();
  const params: Array<string> = [symbol.toUpperCase()];
  const tfClause = timeframe ? 'AND upper(timeframe) = $2' : '';
  if (timeframe) params.push(normalizeTimeframe(timeframe));
  const result = await queryPostgres(`
    SELECT * FROM visual_market_interpretations
    WHERE upper(symbol) = $1 ${tfClause}
    ORDER BY created_at DESC
    LIMIT 1
  `, params);
  return result.rows[0] ? hydrate(result.rows[0]) : null;
}

export async function getFinalDecision(symbol: string): Promise<StoredVisualMarketInterpretation | null> {
  return getLatestVisualMarketInterpretation(symbol);
}

export async function getMarketInterpretationReadiness(symbol: string): Promise<MarketInterpretationReadiness> {
  await ensureVisualMarketInterpretationSchema();
  const normalized = symbol.trim().toUpperCase();
  const captures = (await listCaptures(400)).filter((item) => item.symbol.toUpperCase() === normalized);
  const latestInterpretation = await getLatestVisualMarketInterpretation(normalized, MARKET_INTERPRETATION_SIGNAL_TIMEFRAME)
    ?? await getLatestVisualMarketInterpretation(normalized);

  const mtf = await safe(() => getSymbolMultiTimeframe(normalized));
  const mtfSnapshots = new Map((mtf?.snapshots ?? []).map((item) => [item.timeframe.toUpperCase(), item]));

  const timeframes: MarketInterpretationTimeframeReadiness[] = [];
  for (const timeframe of fixedTimeframes) {
    const scoped = captures.filter((item) => item.timeframe.toUpperCase() === timeframe);
    const latestCapture = scoped[0] ?? null;
    let candleCount = 0;
    if (latestCapture) {
      const candleResult = await queryPostgres(
        'SELECT COUNT(*)::int AS count FROM reconstructed_candles WHERE chart_capture_id = $1',
        [latestCapture.id],
      );
      candleCount = Number(candleResult.rows[0]?.count ?? 0);
    }

    const [ai, anomaly, segmentation] = await Promise.all([
      safe(() => getLatestAiVisualInterpretation(normalized, timeframe)),
      safe(() => getLatestVisualAnomaly(normalized, timeframe)),
      safe(() => getLatestChartSegmentation(normalized, timeframe)),
    ]);
    const snapshot = mtfSnapshots.get(timeframe);
    const hasMtfSnapshot = Boolean(snapshot && snapshot.aiConfidenceScore > 0 && snapshot.marketStructure !== 'no_backend_chart_data');
    const hasAiInterpretation = Boolean(ai);
    const hasAnomalyScan = Boolean(anomaly);
    const hasSegmentation = Boolean(segmentation?.segments.length);
    const readyForFusion = candleCount >= 5 && (hasMtfSnapshot || hasAiInterpretation || hasSegmentation);

    timeframes.push({
      timeframe,
      captureId: latestCapture?.id ?? null,
      capturedAt: latestCapture?.capturedAt ?? null,
      candleCount,
      hasCapture: Boolean(latestCapture),
      hasMtfSnapshot,
      hasAiInterpretation,
      hasAnomalyScan,
      hasSegmentation,
      readyForFusion,
    });
  }

  return {
    symbol: normalized,
    signalTimeframe: MARKET_INTERPRETATION_SIGNAL_TIMEFRAME,
    interpretationCount: latestInterpretation ? 1 : 0,
    latestInterpretationAt: latestInterpretation?.createdAt ?? null,
    finalDecision: latestInterpretation?.finalDecision ?? null,
    setupReadinessScore: latestInterpretation?.setupReadinessScore ?? 0,
    confidenceScore: latestInterpretation?.confidenceScore ?? 0,
    dominantTimeframe: latestInterpretation?.dominantTimeframe ?? null,
    timeframes,
  };
}

async function collectOutputs(symbol: string, timeframe: string): Promise<{
  signals: FusionSignal[];
  timeframeStates: VisualMarketInterpretationResult['timeframeStates'];
  raw: Record<string, unknown>;
  ltfScalpMode: boolean;
  mtfScalpOnly: boolean;
}> {
  const [mtf, ai, anomaly, segmentation, comparison] = await Promise.all([
    safe(() => getSymbolMultiTimeframe(symbol)),
    safe(() => getLatestAiVisualInterpretation(symbol, timeframe)),
    safe(() => getLatestVisualAnomaly(symbol, timeframe)),
    safe(() => getLatestChartSegmentation(symbol, timeframe)),
    safe(() => getImageComparisonHistory(symbol, timeframe, 2)),
  ]);
  const captureId = ai?.captureId
    ?? segmentation?.capture.id
    ?? anomaly?.job.captureId
    ?? await resolveLatestCaptureId(symbol, timeframe);
  const [structure, liquidity, orderBlocks, supportResistance, candles, patterns] = captureId ? await Promise.all([
    safe(() => getStructureAnalysis(captureId)),
    safe(() => getLiquidityAnalysis(captureId)),
    safe(() => getOrderBlockAnalysis(captureId)),
    safe(() => getSupportResistanceAnalysis(captureId)),
    safe(() => getCandleAnalysis(captureId)),
    safe(() => getPatternAnalysis(captureId)),
  ]) : [null, null, null, null, null, null];
  const patternAction = textValue(read(patterns, ['summary', 'recommendedAction']) ?? read(patterns, ['summary', 'dominantPattern']));
  const patternNarrative = textValue(read(patterns, ['summary', 'explanation']) ?? read(patterns, ['summary', 'dominantPattern']));
  const mtfScalpOnly = Boolean(mtf?.decision.scalpOnly);
  const timeframeStates = await buildTimeframeStates(symbol, mtf);

  return {
    signals: [
      signal('Higher timeframe bias', marketInterpretationWeights.higherTimeframeBias, mtfDecisionBias(mtf?.decision.finalDecision, mtf?.decision.finalBias), score01(mtf?.decision.confidenceScore), mtfLowerConfirms(mtf?.decision.lowerTimeframeConfirmation), mtf?.decision.marketNarrative),
      signal('Market structure', marketInterpretationWeights.marketStructure, biasFromText(structure?.output.tradeDecision ?? structure?.output.institutionalBias), score01(structure?.output.confidenceScore), ['BUY', 'SELL'].includes(String(structure?.output.tradeDecision ?? '')), structure?.output.reasoningText),
      signal('Liquidity condition', marketInterpretationWeights.liquidityCondition, biasFromText(liquidity?.summary.recommendedAction ?? liquidity?.summary.institutionalBias), score01(liquidity?.summary.confidence), Boolean(liquidity?.liquidityZones?.length), liquidity?.summary.explanation),
      signal('Order block quality', marketInterpretationWeights.orderBlockQuality, biasFromText(orderBlocks?.summary.recommendedAction ?? orderBlocks?.summary.institutionalBias), score01(orderBlocks?.summary.confidence), Boolean(orderBlocks?.orderBlocks?.length), orderBlocks?.summary.explanation),
      signal('Support/resistance reaction', marketInterpretationWeights.supportResistanceReaction, biasFromText(supportResistance?.summary.recommendedAction), score01(supportResistance?.summary.confidence), Boolean(supportResistance?.zones?.length), supportResistance?.summary.explanation),
      signal('Candle behaviour', marketInterpretationWeights.candleBehaviour, biasFromText(candles?.summary.recommendedDecision ?? candles?.summary.dominantDirection), score01(candles?.summary.confidence), ['BUY', 'SELL'].includes(String(candles?.summary.recommendedDecision ?? '')), candles?.summary.explanation),
      signal('Visual anomalies', marketInterpretationWeights.visualAnomalies, anomaly?.severity.overallSeverity === 'Critical' || anomaly?.severity.overallSeverity === 'High' ? 'mixed' : 'neutral', anomaly ? Math.max(0, 1 - anomaly.severity.manipulationProbability) : 1, !(anomaly?.severity.overallSeverity === 'Critical' || anomaly?.severity.overallSeverity === 'High'), anomaly?.severity.explanation ?? 'No visual anomaly report is available; treating anomaly risk as clear.'),
      signal('Pattern context', marketInterpretationWeights.patternContext, biasFromText(patternAction), score01(read(patterns, ['summary', 'confidence'])), Boolean(read(patterns, ['summary', 'dominantPattern'])), patternNarrative),
      signal('Segmentation/market phase', marketInterpretationWeights.segmentationMarketPhase, biasFromText(segmentation?.segments[0]?.segmentType), score01(segmentation?.segments[0]?.confidenceScore), Boolean(segmentation?.segments.length), segmentation?.explanation),
    ],
    timeframeStates,
    ltfScalpMode: mtfScalpOnly || timeframeStates.some((state) => ['H4', 'H1'].includes(state.timeframe) && (state.bias === 'neutral' || state.bias === 'mixed' || /range|ranging|consolidat|compress|sideways/i.test(state.narrative))),
    mtfScalpOnly,
    raw: { mtf, ai, anomaly, segmentation, comparison, structure, liquidity, orderBlocks, supportResistance, candles, patterns },
  };
}

async function buildTimeframeStates(
  symbol: string,
  mtf: Awaited<ReturnType<typeof getSymbolMultiTimeframe>> | null,
): Promise<VisualMarketInterpretationResult['timeframeStates']> {
  const states: VisualMarketInterpretationResult['timeframeStates'] = [];
  for (const item of fixedTimeframes) {
    const snapshot = (mtf?.snapshots ?? []).find((candidate) => candidate.timeframe === item);
    if (snapshot) {
      states.push({
        timeframe: item,
        bias: resolveSnapshotTimeframeBias(snapshot),
        controlScore: score01(snapshot.aiConfidenceScore) * 100,
        confirmsEntry: ['BUY', 'SELL'].includes(snapshot.decisionState ?? ''),
        narrative: `${snapshot.marketStructure}; ${snapshot.liquidityStatus}; ${snapshot.orderBlockStatus}`,
      });
      continue;
    }

    if (item === 'M5' || item === 'M1') {
      const captureId = await resolveLatestCaptureId(symbol, item).catch(() => null);
      if (captureId) {
        const [structure, candles] = await Promise.all([
          safe(() => getStructureAnalysis(captureId)),
          safe(() => getCandleAnalysis(captureId)),
        ]);
        const action = String(structure?.output.tradeDecision ?? candles?.summary.recommendedDecision ?? '');
        const bias = biasFromText(action || structure?.output.institutionalBias || candles?.summary.dominantDirection);
        states.push({
          timeframe: item,
          bias,
          controlScore: score01(structure?.output.confidenceScore ?? candles?.summary.confidence) * 100,
          confirmsEntry: ['BUY', 'SELL'].includes(action.toUpperCase()),
          narrative: String(structure?.output.reasoningText ?? candles?.summary.explanation ?? `${item} micro-structure from latest capture.`),
        });
        continue;
      }
    }

    states.push({
      timeframe: item,
      bias: 'neutral',
      controlScore: 0,
      confirmsEntry: false,
      narrative: `${item} control state is waiting for visual-analysis output.`,
    });
  }
  return states;
}

async function persistInterpretation(jobId: string, symbol: string, timeframe: string, fused: VisualMarketInterpretationResult, previous: StoredVisualMarketInterpretation | null, raw: Record<string, unknown>): Promise<StoredVisualMarketInterpretation> {
  const id = randomUUID();
  await queryPostgres(`
    INSERT INTO visual_market_interpretations (
      id, job_id, symbol, timeframe, dominant_timeframe, final_market_bias, institutional_interpretation,
      liquidity_objective, market_phase, setup_readiness_score, final_decision, confidence_score,
      entry_readiness, invalidation_condition, risk_warning, full_ai_market_narrative,
      previous_interpretation_json, metadata_json, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,now())
  `, [
    id, jobId, symbol, timeframe, fused.dominantTimeframe, fused.finalMarketBias, fused.institutionalInterpretation,
    fused.liquidityObjective, fused.marketPhase, fused.setupReadinessScore, fused.finalDecision,
    fused.confidenceScore, fused.entryReadiness, fused.invalidationCondition, fused.riskWarning,
    fused.fullNarrative, JSON.stringify(previous ? { id: previous.id, decision: previous.finalDecision, confidence: previous.confidenceScore, createdAt: previous.createdAt } : {}),
    JSON.stringify({ rawSignals: raw, signals: fused.signals }),
  ]);
  await queryPostgres('INSERT INTO final_decision_scores (id, market_interpretation_id, scores_json, weights_json) VALUES ($1,$2,$3::jsonb,$4::jsonb)', [randomUUID(), id, JSON.stringify(fused.decisionScores), JSON.stringify(marketInterpretationWeights)]);
  for (const state of fused.timeframeStates) {
    await queryPostgres('INSERT INTO timeframe_control_states (id, market_interpretation_id, timeframe, bias, control_score, confirms_entry, narrative_text) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), id, state.timeframe, state.bias, state.controlScore, state.confirmsEntry, state.narrative]);
  }
  await queryPostgres('INSERT INTO institutional_bias_logs (id, market_interpretation_id, bias, interpretation_text, confidence_score) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, fused.finalMarketBias, fused.institutionalInterpretation, fused.confidenceScore]);
  await queryPostgres('INSERT INTO setup_readiness_scores (id, market_interpretation_id, readiness_score, entry_readiness, risk_warning) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, fused.setupReadinessScore, fused.entryReadiness, fused.riskWarning]);
  for (const item of fused.auditTrail) {
    await queryPostgres('INSERT INTO visual_decision_audit_trails (id, market_interpretation_id, stage, finding, score) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, item.stage, item.finding, item.score]);
  }
  const stored = await getLatestVisualMarketInterpretation(symbol, timeframe);
  if (!stored) throw new Error('Market interpretation was created but could not be loaded.');
  return stored;
}

async function hydrate(row: Row): Promise<StoredVisualMarketInterpretation> {
  const [states, scores, audit] = await Promise.all([
    queryPostgres('SELECT * FROM timeframe_control_states WHERE market_interpretation_id = $1 ORDER BY control_score DESC', [String(row.id)]),
    queryPostgres('SELECT * FROM final_decision_scores WHERE market_interpretation_id = $1 ORDER BY created_at DESC LIMIT 1', [String(row.id)]),
    queryPostgres('SELECT * FROM visual_decision_audit_trails WHERE market_interpretation_id = $1 ORDER BY created_at ASC', [String(row.id)]),
  ]);
  const metadata = objectValue(row.metadata_json);
  return {
    id: String(row.id),
    jobId: typeof row.job_id === 'string' ? row.job_id : null,
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    dominantTimeframe: String(row.dominant_timeframe),
    finalMarketBias: String(row.final_market_bias) as MarketBias,
    institutionalInterpretation: String(row.institutional_interpretation),
    liquidityObjective: String(row.liquidity_objective),
    marketPhase: String(row.market_phase),
    setupReadinessScore: Number(row.setup_readiness_score),
    finalDecision: String(row.final_decision) as FinalMarketDecision,
    confidenceScore: Number(row.confidence_score),
    entryReadiness: String(row.entry_readiness),
    invalidationCondition: String(row.invalidation_condition),
    riskWarning: String(row.risk_warning),
    fullNarrative: String(row.full_ai_market_narrative),
    marketMeaning: `The market is in ${String(row.market_phase)} with ${String(row.final_market_bias)} visual bias. ${String(row.liquidity_objective)}`,
    retailTrapWarning: inferRetailTrapWarning(metadata.signals),
    recommendedAction: String(row.final_decision) as FinalMarketDecision,
    explanation: String(row.full_ai_market_narrative),
    previousInterpretation: objectValue(row.previous_interpretation_json),
    timeframeStates: states.rows.map((state) => ({
      timeframe: String(state.timeframe),
      bias: String(state.bias) as MarketBias,
      controlScore: Number(state.control_score),
      confirmsEntry: Boolean(state.confirms_entry),
      narrative: String(state.narrative_text),
    })),
    decisionScores: numberRecord(scores.rows[0]?.scores_json),
    auditTrail: audit.rows.map((item) => ({ stage: String(item.stage), finding: String(item.finding), score: Number(item.score) })),
    signals: Array.isArray(metadata.signals) ? metadata.signals as FusionSignal[] : [],
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

async function createJob(jobId: string, symbol: string, timeframe: string) {
  await queryPostgres(`
    INSERT INTO visual_market_interpretation_jobs (id, symbol, timeframe, status, stage, metadata_json)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
  `, [jobId, symbol, timeframe, 'queued', 'created', JSON.stringify({})]);
}

async function updateJob(jobId: string, status: string, stage: string, metadata: Record<string, unknown> = {}) {
  await queryPostgres(`
    UPDATE visual_market_interpretation_jobs
    SET status = $2,
        stage = $3,
        error_text = COALESCE($4, error_text),
        metadata_json = metadata_json || $5::jsonb,
        completed_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE completed_at END
    WHERE id = $1
  `, [jobId, status, stage, typeof metadata.error === 'string' ? metadata.error : null, JSON.stringify(metadata)]);
}

function signal(name: string, weight: number, bias: MarketBias, confidence: number, confirmsEntry: boolean, narrative?: string | null): FusionSignal {
  return { name, weight, bias, confidence, confirmsEntry, narrative: narrative || `${name} is unavailable.` };
}

function mtfDecisionBias(finalDecision?: string | null, finalBias?: string | null): MarketBias {
  const decision = String(finalDecision ?? '').toUpperCase();
  if (decision.includes('BUY')) return 'bullish';
  if (decision.includes('SELL')) return 'bearish';
  return biasFromText(finalBias ?? finalDecision);
}

function mtfLowerConfirms(lowerTimeframeConfirmation?: string | null): boolean {
  const text = String(lowerTimeframeConfirmation ?? '').toLowerCase();
  return text.includes('confirm')
    || text.includes('reclaim')
    || text.includes('reject')
    || text.includes('rejection')
    || text.includes('breakdown')
    || text.includes('breakout')
    || text.includes('displacement')
    || text.includes('completion')
    || text.includes('aligns')
    || text.includes('bearish')
    || text.includes('bullish');
}

function resolveSnapshotTimeframeBias(snapshot: TimeframeAnalysisSnapshot): MarketBias {
  const structureBias = biasFromText(
    [
      snapshot.bias,
      snapshot.trendDirection,
      snapshot.marketStructure,
      snapshot.lastBosDirection,
      snapshot.lastChochDirection,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const momentumBias = biasFromText(snapshot.candleMomentum);
  const isMacro = snapshot.timeframe === 'MN' || snapshot.timeframe === 'W';
  if (isMacro && momentumBias !== 'neutral' && momentumBias !== 'mixed') {
    if (
      structureBias === 'neutral'
      || structureBias === 'mixed'
      || /range|developing|compress|balance/i.test(snapshot.marketStructure)
      || structureBias !== momentumBias
    ) {
      return momentumBias;
    }
  }
  if (structureBias !== 'neutral' && structureBias !== 'mixed') return structureBias;
  return biasFromText(snapshot.bias);
}

function biasFromText(value?: string | null): MarketBias {
  const text = String(value ?? '').toLowerCase();
  if (/\bbuy[_\s-]?side[_\s-]?(sweep|liquidity|stop|pool)/.test(text)) return 'bearish';
  if (/\bsell[_\s-]?side[_\s-]?(sweep|liquidity|stop|pool)/.test(text)) return 'bullish';
  if (text.includes('broken_support_now_resistance') || text.includes('support break') || text.includes('broken support') || text.includes('resistance rejection')) return 'bearish';
  if (text.includes('broken_resistance_now_support') || text.includes('resistance break') || text.includes('broken resistance') || text.includes('support rejection')) return 'bullish';
  if (text.includes('bullish') || /\b(buy|bull|long|demand|accumulation)\b/.test(text)) return 'bullish';
  if (text.includes('bearish') || /\b(sell|bear|short|supply|distribution)\b/.test(text)) return 'bearish';
  if (text.includes('mixed') || text.includes('wait') || text.includes('conflict')) return 'mixed';
  return 'neutral';
}

function score01(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return number > 1 ? Math.max(0, Math.min(1, number / 100)) : Math.max(0, Math.min(1, number));
}

async function safe<T>(loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader();
  } catch {
    return null;
  }
}

function read(source: unknown, path: string[]): string | number | undefined {
  return path.reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, source) as string | number | undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(objectValue(value)).map(([key, item]) => [key, Number(item ?? 0)]));
}

function textValue(value: unknown): string | undefined {
  return value == null ? undefined : String(value);
}

function inferRetailTrapWarning(signals: unknown): string {
  const text = Array.isArray(signals)
    ? signals.map((signalItem) => typeof signalItem === 'object' && signalItem ? String((signalItem as Record<string, unknown>).narrative ?? '') : '').join(' ').toLowerCase()
    : '';
  if (text.includes('trap') || text.includes('sweep') || text.includes('manipulation')) {
    return 'Retail trap warning: elevated. The visual evidence suggests liquidity engineering or false-break risk around obvious levels.';
  }
  if (text.includes('not available') || !text) {
    return 'Retail trap warning: unknown until liquidity, structure, and anomaly outputs are available.';
  }
  return 'Retail trap warning: contained, but entries still require confirmation against liquidity and structure.';
}

function normalizeTimeframe(value?: string): string {
  const timeframe = normalizeInstitutionalTimeframe(value ?? 'H1');
  if (!fixedTimeframes.includes(timeframe as typeof fixedTimeframes[number])) {
    throw new Error(`Unsupported timeframe "${timeframe}". Supported timeframes are MN, W, D, H4, H1, M30, M15, M5, M1.`);
  }
  return timeframe;
}

function dateString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
