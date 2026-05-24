import { randomUUID } from 'crypto';

import { buildVisualInterpretation, defaultComponents, type AiVisualInterpretationResult, type InterpretationBias, type InterpretationComponentInput } from './ai-visual-interpretation-engine';
import { getCandleAnalysis } from './candle-detection-store';
import { getChannelAnalysis } from './channel-detection-store';
import { getLiquidityAnalysis } from './liquidity-zone-store';
import { getSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { getOrderBlockAnalysis } from './order-block-detection-store';
import { getPatternAnalysis } from './pattern-recognition-store';
import { queryPostgres } from './postgres';
import { getStructureAnalysis } from './structure-analysis-store';
import { getSupportResistanceAnalysis } from './support-resistance-store';
import { getSwingAnalysis } from './swing-point-store';
import { getTrendlineAnalysis } from './trendline-detection-store';
import { getCaptureAnalysis, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRecord, VisionDecision } from './visual-intelligence-types';

type Row = Record<string, unknown>;

const schemaSql = `
CREATE TABLE IF NOT EXISTS ai_visual_interpretations (
  id UUID PRIMARY KEY,
  chart_capture_id UUID NOT NULL REFERENCES chart_captures(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  title TEXT NOT NULL,
  full_explanation TEXT NOT NULL,
  dominant_bias TEXT NOT NULL,
  institutional_behavior TEXT NOT NULL,
  institutional_narrative TEXT NOT NULL,
  retail_trap_warning TEXT NOT NULL,
  liquidity_narrative TEXT NOT NULL,
  market_structure_narrative TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL,
  market_clarity_score NUMERIC(8, 4) NOT NULL,
  setup_quality_score NUMERIC(8, 4) NOT NULL,
  decision TEXT NOT NULL,
  entry_logic TEXT NOT NULL,
  invalidation_logic TEXT NOT NULL,
  risk_warning TEXT NOT NULL,
  dominant_story TEXT NOT NULL,
  higher_timeframe_context TEXT NOT NULL,
  ranked_structures_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning_timeline_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_reasoning_components (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  component_weight NUMERIC(8, 4) NOT NULL,
  bias TEXT NOT NULL,
  score NUMERIC(8, 4) NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  summary_text TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_market_narratives (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  narrative_type TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  confidence NUMERIC(8, 4) NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_decision_breakdowns (
  id UUID PRIMARY KEY,
  interpretation_id UUID NOT NULL REFERENCES ai_visual_interpretations(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_visual_interpretations_capture ON ai_visual_interpretations(chart_capture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_visual_interpretations_symbol_tf ON ai_visual_interpretations(symbol, timeframe, created_at DESC);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureAiVisualInterpretationSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function analyzeAiVisualInterpretation(input: { captureId?: string; symbol?: string; timeframe?: string }): Promise<StoredAiVisualInterpretation> {
  await ensureAiVisualInterpretationSchema();
  const capture = input.captureId ? await loadCapture(input.captureId) : await findLatestCapture(input.symbol, input.timeframe);
  if (!capture) throw new Error('No chart capture found for AI visual interpretation.');

  await publishVisualIntelligenceEvent('interpretation.started', capture.id, null, {
    symbol: capture.symbol,
    timeframe: capture.timeframe,
  });
  await publishVisualIntelligenceEvent('interpretation.collecting.signals', capture.id, null, { captureId: capture.id });

  const signals = await collectSignals(capture);
  await publishVisualIntelligenceEvent('interpretation.reasoning', capture.id, null, {
    components: signals.components.map((component) => ({ name: component.name, score: component.score, bias: component.bias })),
  });

  const result = buildVisualInterpretation({
    captureId: capture.id,
    symbol: capture.symbol,
    timeframe: capture.timeframe,
    imageUrl: capture.imageUrl,
    components: signals.components,
  });
  const stored = await persistInterpretation(capture, result, signals.raw);
  await publishVisualIntelligenceEvent('interpretation.completed', capture.id, null, {
    interpretationId: stored.id,
    decision: stored.decision,
    confidenceScore: stored.confidenceScore,
    dominantBias: stored.dominantBias,
  });
  return stored;
}

export async function regenerateAiVisualInterpretation(input: { captureId?: string; symbol?: string; timeframe?: string }) {
  const result = await analyzeAiVisualInterpretation(input);
  await publishVisualIntelligenceEvent('interpretation.updated', result.captureId, null, {
    interpretationId: result.id,
    decision: result.decision,
  });
  return result;
}

export async function getAiVisualInterpretation(captureId: string): Promise<StoredAiVisualInterpretation | null> {
  await ensureAiVisualInterpretationSchema();
  const result = await queryPostgres(`
    SELECT * FROM ai_visual_interpretations
    WHERE chart_capture_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [captureId]);
  return result.rows[0] ? hydrateInterpretation(result.rows[0]) : null;
}

export async function getLatestAiVisualInterpretation(symbol: string, timeframe: string): Promise<StoredAiVisualInterpretation | null> {
  await ensureAiVisualInterpretationSchema();
  const result = await queryPostgres(`
    SELECT * FROM ai_visual_interpretations
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return result.rows[0] ? hydrateInterpretation(result.rows[0]) : null;
}

export interface StoredAiVisualInterpretation extends AiVisualInterpretationResult {
  id: string;
  captureId: string;
  symbol: string;
  timeframe: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

async function collectSignals(capture: ChartCaptureRecord): Promise<{ components: InterpretationComponentInput[]; raw: Record<string, unknown> }> {
  const [
    candles,
    swings,
    patterns,
    trendlines,
    channels,
    supportResistance,
    orderBlocks,
    liquidity,
    structure,
    multiTimeframe,
  ] = await Promise.all([
    safeSignal(() => getCandleAnalysis(capture.id)),
    safeSignal(() => getSwingAnalysis(capture.id)),
    safeSignal(() => getPatternAnalysis(capture.id)),
    safeSignal(() => getTrendlineAnalysis(capture.id)),
    safeSignal(() => getChannelAnalysis(capture.id)),
    safeSignal(() => getSupportResistanceAnalysis(capture.id)),
    safeSignal(() => getOrderBlockAnalysis(capture.id)),
    safeSignal(() => getLiquidityAnalysis(capture.id)),
    safeSignal(() => getStructureAnalysis(capture.id)),
    safeSignal(() => getSymbolMultiTimeframe(capture.symbol)),
  ]);

  return {
    components: [
      marketStructureComponent(structure),
      liquidityComponent(liquidity),
      orderBlockComponent(orderBlocks),
      supportResistanceComponent(supportResistance),
      candleComponent(candles),
      patternComponent(patterns, swings, trendlines, channels),
      multiTimeframeComponent(multiTimeframe, capture.timeframe),
    ],
    raw: { candles, swings, patterns, trendlines, channels, supportResistance, orderBlocks, liquidity, structure, multiTimeframe },
  };
}

async function safeSignal<T>(loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader();
  } catch {
    return null;
  }
}

async function loadCapture(captureId: string): Promise<ChartCaptureRecord | null> {
  const analysis = await getCaptureAnalysis(captureId);
  return analysis?.capture ?? null;
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

function marketStructureComponent(signal: Awaited<ReturnType<typeof getStructureAnalysis>> | null): InterpretationComponentInput {
  const summary = signal?.summary;
  const output = signal?.output;
  return {
    name: 'Market structure',
    weight: 0.25,
    bias: biasFromDecision(output?.tradeDecision ?? summary?.tradeDecision),
    score: output?.confidenceScore ?? summary?.confidence ?? 0,
    confidence: output?.confidenceScore ?? summary?.confidence ?? 0,
    summary: summary?.explanation ?? output?.reasoningText ?? 'No market structure analysis is available yet.',
    evidence: [
      output?.currentStructure ? `Current structure is ${output.currentStructure}.` : '',
      output?.currentMarketPhase ? `Market phase is ${output.currentMarketPhase}.` : '',
      output?.mssStatus ? `MSS status: ${output.mssStatus}.` : '',
    ].filter(Boolean),
  };
}

function liquidityComponent(signal: Awaited<ReturnType<typeof getLiquidityAnalysis>> | null): InterpretationComponentInput {
  const dominant = signal?.liquidityZones?.[0];
  return {
    name: 'Liquidity context',
    weight: 0.2,
    bias: biasFromDecision(dominant?.recommendedAction),
    score: dominant?.confidenceScore ?? signal?.summary.confidence ?? 0,
    confidence: dominant?.confidenceScore ?? signal?.summary.confidence ?? 0,
    summary: signal?.summary.explanation ?? 'No liquidity context is available yet.',
    evidence: [
      dominant ? `${dominant.liquiditySide} liquidity around ${dominant.priceLevel} with trap probability ${(dominant.trapProbability * 100).toFixed(0)}%.` : '',
      signal?.sweeps?.[0]?.explanationText ?? '',
      signal?.voids?.[0]?.explanationText ?? '',
    ].filter(Boolean),
  };
}

function orderBlockComponent(signal: Awaited<ReturnType<typeof getOrderBlockAnalysis>> | null): InterpretationComponentInput {
  const block = signal?.orderBlocks?.[0];
  return {
    name: 'Order block quality',
    weight: 0.15,
    bias: biasFromDecision(block?.recommendedAction),
    score: block?.qualityScore ?? signal?.summary.confidence ?? 0,
    confidence: block?.qualityScore ?? signal?.summary.confidence ?? 0,
    summary: signal?.summary.explanation ?? 'No order block evidence is available yet.',
    evidence: [
      block ? `${block.blockType} order block ${block.zoneLow}-${block.zoneHigh}; ${block.mitigationStatus}.` : '',
      block?.institutionalRelevance ?? '',
    ].filter(Boolean),
  };
}

function supportResistanceComponent(signal: Awaited<ReturnType<typeof getSupportResistanceAnalysis>> | null): InterpretationComponentInput {
  const zone = signal?.zones?.[0];
  return {
    name: 'Support/resistance reaction',
    weight: 0.1,
    bias: biasFromDecision(zone?.recommendedAction),
    score: zone?.strengthScore ?? signal?.summary.confidence ?? 0,
    confidence: zone?.strengthScore ?? signal?.summary.confidence ?? 0,
    summary: signal?.summary.explanation ?? 'No support/resistance reaction is available yet.',
    evidence: [
      zone ? `${zone.zoneType} zone ${zone.zoneLow}-${zone.zoneHigh}, strength ${(zone.strengthScore * 100).toFixed(0)}%.` : '',
      signal?.liquidity?.[0]?.explanationText ?? '',
    ].filter(Boolean),
  };
}

function candleComponent(signal: Awaited<ReturnType<typeof getCandleAnalysis>> | null): InterpretationComponentInput {
  const summary = signal?.summary;
  return {
    name: 'Candle behaviour',
    weight: 0.1,
    bias: biasFromDecision(summary?.recommendedDecision),
    score: summary?.confidence ?? 0,
    confidence: summary?.confidence ?? 0,
    summary: summary?.explanation ?? 'No candle behaviour analysis is available yet.',
    evidence: [
      summary?.dominantType ? `Dominant candle behaviour: ${summary.dominantType}.` : '',
      summary?.dominantDirection ? `Dominant candle direction: ${summary.dominantDirection}.` : '',
    ].filter(Boolean),
  };
}

function patternComponent(
  patterns: Awaited<ReturnType<typeof getPatternAnalysis>> | null,
  swings: Awaited<ReturnType<typeof getSwingAnalysis>> | null,
  trendlines: Awaited<ReturnType<typeof getTrendlineAnalysis>> | null,
  channels: Awaited<ReturnType<typeof getChannelAnalysis>> | null,
): InterpretationComponentInput {
  const patternSummary = stringValue(patterns, ['summary', 'explanation']) || stringValue(patterns, ['summary', 'dominantPattern']) || 'No dominant pattern context is available yet.';
  const score = numberValue(patterns, ['summary', 'confidence']) || numberValue(swings, ['summary', 'confidence']) || numberValue(trendlines, ['summary', 'confidence']) || numberValue(channels, ['summary', 'confidence']);
  const decision = stringValue(patterns, ['summary', 'recommendedAction']) || stringValue(trendlines, ['summary', 'recommendedAction']) || stringValue(channels, ['summary', 'recommendedAction']);
  return {
    name: 'Pattern context',
    weight: 0.1,
    bias: biasFromDecision(decision),
    score,
    confidence: score,
    summary: patternSummary,
    evidence: [
      stringValue(swings, ['summary', 'explanation']),
      stringValue(trendlines, ['summary', 'explanation']),
      stringValue(channels, ['summary', 'explanation']),
    ].filter(Boolean),
  };
}

function multiTimeframeComponent(signal: Awaited<ReturnType<typeof getSymbolMultiTimeframe>> | null, timeframe: string): InterpretationComponentInput {
  const snapshot = signal?.snapshots.find((item) => item.timeframe === timeframe);
  const decision = snapshot?.decisionState ?? signal?.decision.finalDecision;
  const score = snapshot?.aiConfidenceScore ?? signal?.decision.confidenceScore ?? 0;
  return {
    name: 'Multi-timeframe alignment',
    weight: 0.1,
    bias: biasFromDecision(decision),
    score,
    confidence: score,
    summary: signal?.decision.marketNarrative ?? snapshot?.marketStructure ?? 'No multi-timeframe context is available yet.',
    evidence: [
      signal?.decision.finalBias ? `Final MTF bias: ${signal.decision.finalBias}.` : '',
      signal?.decision.controllingTimeframe ? `Controlling timeframe: ${signal.decision.controllingTimeframe}.` : '',
      signal?.conflicts?.[0]?.description ?? '',
    ].filter(Boolean),
  };
}

async function persistInterpretation(capture: ChartCaptureRecord, result: AiVisualInterpretationResult, raw: Record<string, unknown>): Promise<StoredAiVisualInterpretation> {
  const id = randomUUID();
  await queryPostgres(`
    INSERT INTO ai_visual_interpretations (
      id, chart_capture_id, symbol, timeframe, title, full_explanation, dominant_bias,
      institutional_behavior, institutional_narrative, retail_trap_warning, liquidity_narrative,
      market_structure_narrative, confidence_score, market_clarity_score, setup_quality_score,
      decision, entry_logic, invalidation_logic, risk_warning, dominant_story, higher_timeframe_context,
      ranked_structures_json, reasoning_timeline_json, metadata_json, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now())
  `, [
    id,
    capture.id,
    capture.symbol,
    capture.timeframe,
    result.title,
    result.fullExplanation,
    result.dominantBias,
    result.institutionalBehavior,
    result.institutionalNarrative,
    result.retailTrapWarning,
    result.liquidityNarrative,
    result.marketStructureNarrative,
    result.confidenceScore,
    result.marketClarityScore,
    result.setupQualityScore,
    result.decision,
    result.entryLogic,
    result.invalidationLogic,
    result.riskWarning,
    result.dominantStory,
    result.higherTimeframeContext,
    result.rankedStructures,
    result.reasoningTimeline,
    { raw, imageUrl: capture.imageUrl },
  ]);

  await queryPostgres('DELETE FROM ai_reasoning_components WHERE interpretation_id = $1', [id]);
  for (const component of result.components) {
    await queryPostgres(`
      INSERT INTO ai_reasoning_components (
        id, interpretation_id, component_name, component_weight, bias, score, confidence,
        summary_text, evidence_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [randomUUID(), id, component.name, component.weight, component.bias, component.score, component.confidence, component.summary, component.evidence]);
  }

  const narratives = [
    ['institutional', result.institutionalNarrative],
    ['retail_trap', result.retailTrapWarning],
    ['liquidity', result.liquidityNarrative],
    ['market_structure', result.marketStructureNarrative],
  ];
  for (const [type, text] of narratives) {
    await queryPostgres(`
      INSERT INTO ai_market_narratives (id, interpretation_id, narrative_type, narrative_text, confidence, metadata_json)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [randomUUID(), id, type, text, result.confidenceScore / 100, {}]);
  }

  await queryPostgres(`
    INSERT INTO ai_decision_breakdowns (id, interpretation_id, decision, breakdown_json)
    VALUES ($1,$2,$3,$4)
  `, [randomUUID(), id, result.decision, result.decisionBreakdown]);

  const stored = await getAiVisualInterpretation(capture.id);
  if (!stored) throw new Error('AI visual interpretation was created but could not be loaded.');
  return stored;
}

async function hydrateInterpretation(row: Row): Promise<StoredAiVisualInterpretation> {
  const [components, decisionBreakdown] = await Promise.all([
    queryPostgres('SELECT * FROM ai_reasoning_components WHERE interpretation_id = $1 ORDER BY component_weight DESC', [String(row.id)]),
    queryPostgres('SELECT * FROM ai_decision_breakdowns WHERE interpretation_id = $1 ORDER BY created_at DESC LIMIT 1', [String(row.id)]),
  ]);
  const metadata = objectValue(row.metadata_json);
  return {
    id: String(row.id),
    captureId: String(row.chart_capture_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    imageUrl: typeof metadata.imageUrl === 'string' ? metadata.imageUrl : null,
    title: String(row.title),
    fullExplanation: String(row.full_explanation),
    dominantBias: String(row.dominant_bias) as InterpretationBias,
    institutionalBehavior: String(row.institutional_behavior) as StoredAiVisualInterpretation['institutionalBehavior'],
    institutionalNarrative: String(row.institutional_narrative),
    retailTrapWarning: String(row.retail_trap_warning),
    liquidityNarrative: String(row.liquidity_narrative),
    marketStructureNarrative: String(row.market_structure_narrative),
    confidenceScore: Number(row.confidence_score),
    marketClarityScore: Number(row.market_clarity_score),
    setupQualityScore: Number(row.setup_quality_score),
    decision: String(row.decision) as VisionDecision,
    entryLogic: String(row.entry_logic),
    invalidationLogic: String(row.invalidation_logic),
    riskWarning: String(row.risk_warning),
    dominantStory: String(row.dominant_story),
    higherTimeframeContext: String(row.higher_timeframe_context),
    rankedStructures: readJson(row.ranked_structures_json, []),
    reasoningTimeline: readJson(row.reasoning_timeline_json, []),
    components: components.rows.map((component) => ({
      name: String(component.component_name),
      weight: Number(component.component_weight),
      bias: String(component.bias) as InterpretationBias,
      score: Number(component.score),
      confidence: Number(component.confidence),
      summary: String(component.summary_text),
      evidence: readJson(component.evidence_json, []),
    })),
    decisionBreakdown: readJson(decisionBreakdown.rows[0]?.breakdown_json, {}),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

function biasFromDecision(value?: string | null): InterpretationBias {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('BUY') || normalized.includes('BULL') || normalized.includes('LONG')) return 'bullish';
  if (normalized.includes('SELL') || normalized.includes('BEAR') || normalized.includes('SHORT')) return 'bearish';
  if (normalized.includes('WAIT') || normalized.includes('MIX')) return 'mixed';
  return 'neutral';
}

function stringValue(source: unknown, path: string[]): string {
  const value = path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), source);
  return typeof value === 'string' ? value : '';
}

function numberValue(source: unknown, path: string[]): number {
  const value = path.reduce<unknown>((current, key) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined), source);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
