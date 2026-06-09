import { randomUUID } from 'crypto';

import { ensureAutonomyRuntime, getAutonomyStatus, listDecisionLogs } from './autonomy-store';
import { AUTONOMY_TIMEFRAMES, type AutonomyTimeframe } from './autonomy-types';
import { getLatestChartSegmentation } from './chart-segmentation-store';
import { getSymbolMultiTimeframe } from './multi-timeframe-analysis-store';
import { queryPostgres } from './postgres';
import { getLatestVisualAnomaly } from './visual-anomaly-detection-store';
import { publishVisualIntelligenceEvent } from './visual-intelligence-store';
import { analyzeVisualMarketInterpretation, getLatestVisualMarketInterpretation } from './visual-market-interpretation-store';

type Row = Record<string, unknown>;

const visionTimeframes = AUTONOMY_TIMEFRAMES;

const schemaSql = `
CREATE TABLE IF NOT EXISTS cacsms_vision_scans (
  id UUID PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL,
  symbols_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeframes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS cacsms_vision_analysis (
  id UUID PRIMARY KEY,
  scan_id UUID REFERENCES cacsms_vision_scans(id) ON DELETE SET NULL,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  capture_status TEXT NOT NULL,
  analysis_status TEXT NOT NULL,
  confidence_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  market_meaning TEXT NOT NULL,
  institutional_interpretation TEXT NOT NULL,
  retail_trap_warning TEXT NOT NULL,
  liquidity_map_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  order_blocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  fair_value_gaps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_structure_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  anomaly_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  segmentation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  audit_trace_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fair_value_gaps (
  id UUID PRIMARY KEY,
  chart_capture_id UUID REFERENCES chart_captures(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  price_low NUMERIC(18, 6),
  price_high NUMERIC(18, 6),
  start_candle_index INTEGER,
  end_candle_index INTEGER,
  fill_status TEXT NOT NULL DEFAULT 'open',
  confidence_score NUMERIC(8, 4) NOT NULL DEFAULT 0,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS system_health_logs (
  id UUID PRIMARY KEY,
  component TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cacsms_vision_analysis_symbol_tf ON cacsms_vision_analysis(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cacsms_vision_scans_started ON cacsms_vision_scans(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fair_value_gaps_symbol_tf ON fair_value_gaps(symbol, timeframe, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_trace ON audit_logs(trace_id, created_at);
`;

let schemaReady: Promise<void> | null = null;

export async function ensureCacsmsVisionSchema() {
  if (!schemaReady) schemaReady = queryPostgres(schemaSql).then(() => undefined);
  return schemaReady;
}

export async function getCacsmsVisionRoom(symbol = 'XAUUSD') {
  await ensureCacsmsVisionSchema();
  await ensureAutonomyRuntime();
  const normalized = symbol.toUpperCase();
  const [autonomy, captures, analyses, mtf, decisions, auditLogs] = await Promise.all([
    getAutonomyStatus(),
    getLatestScreenshots(normalized),
    getVisionAnalysis(normalized),
    getSymbolMultiTimeframe(normalized).catch(() => null),
    listDecisionLogs(10),
    getVisionAuditLogs(20),
  ]);
  const latestAnalysis = analyses[0] ?? null;
  return {
    systemStatus: {
      autonomy: autonomy.summary,
      health: autonomy.health,
      activeTimeframes: visionTimeframes,
      mode: autonomy.config.mode,
    },
    liveCaptureFeed: captures,
    timeframeMatrix: buildTimeframeMatrix(normalized, analyses, mtf),
    screenshotEvidence: captures,
    annotatedChart: latestAnalysis,
    institutionalLiquidityMap: latestAnalysis?.liquidityMap ?? {},
    orderBlockAndFvgDetector: {
      orderBlocks: latestAnalysis?.orderBlocks ?? [],
      fairValueGaps: latestAnalysis?.fairValueGaps ?? [],
    },
    marketStructureDetector: latestAnalysis?.marketStructure ?? {},
    smartMoneyBehavior: latestAnalysis?.institutionalInterpretation ?? 'Waiting for autonomous Cacsms Vision analysis.',
    retailTrapDetector: latestAnalysis?.retailTrapWarning ?? 'Waiting for liquidity and structure evidence.',
    aiReasoningConsole: latestAnalysis?.decision ?? {},
    tradeOpportunityRadar: decisions,
    executionReadiness: latestAnalysis ? executionReadinessFromAnalysis(latestAnalysis) : null,
    riskIntelligence: await getRiskStatus(normalized),
    visionDecisionHistory: decisions,
    auditLogs,
  };
}

export async function startCacsmsVisionScan(input: { symbols?: string[]; timeframes?: string[]; triggerSource?: string }) {
  await ensureCacsmsVisionSchema();
  await ensureAutonomyRuntime();
  const symbols = sanitizeSymbols(input.symbols);
  const timeframes = sanitizeTimeframes(input.timeframes);
  const scanId = randomUUID();
  await queryPostgres('INSERT INTO cacsms_vision_scans (id, trigger_source, status, symbols_json, timeframes_json) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)', [
    scanId,
    input.triggerSource ?? 'api',
    'running',
    JSON.stringify(symbols),
    JSON.stringify(timeframes),
  ]);
  await publishVisualIntelligenceEvent('cacsms.vision.scan.started', null, null, { scanId, symbols, timeframes });
  const outputs: Array<Record<string, unknown>> = [];
  try {
    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        outputs.push(await runVisionTimeframe(scanId, symbol, timeframe));
      }
    }
    await queryPostgres('UPDATE cacsms_vision_scans SET status = $2, completed_at = now(), summary_json = $3::jsonb WHERE id = $1', [scanId, 'completed', JSON.stringify({ outputs: outputs.length })]);
    await publishVisualIntelligenceEvent('cacsms.vision.scan.completed', null, null, { scanId, outputs: outputs.length });
    return { scanId, status: 'completed', outputs };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cacsms Vision scan failed.';
    await queryPostgres('UPDATE cacsms_vision_scans SET status = $2, completed_at = now(), error_message = $3 WHERE id = $1', [scanId, 'failed', message]);
    await publishVisualIntelligenceEvent('cacsms.vision.scan.failed', null, null, { scanId, error: message });
    throw error;
  }
}

export async function getLatestScreenshots(symbol?: string) {
  await ensureCacsmsVisionSchema();
  const params: string[] = [];
  const where = symbol ? 'WHERE upper(symbol) = $1' : '';
  if (symbol) params.push(symbol.toUpperCase());
  const result = await queryPostgres(`
    SELECT * FROM chart_captures
    ${where}
    ORDER BY captured_at DESC
    LIMIT 50
  `, params);
  return result.rows.map(mapCapture);
}

export async function getVisionAnalysis(symbol?: string) {
  await ensureCacsmsVisionSchema();
  const params: string[] = [];
  const where = symbol ? 'WHERE upper(symbol) = $1' : '';
  if (symbol) params.push(symbol.toUpperCase());
  const result = await queryPostgres(`
    SELECT * FROM cacsms_vision_analysis
    ${where}
    ORDER BY created_at DESC
    LIMIT 50
  `, params);
  return result.rows.map(mapVisionAnalysis);
}

export async function getAssetBias(symbol: string) {
  const analysis = (await getVisionAnalysis(symbol))[0] ?? null;
  const mtf = await getSymbolMultiTimeframe(symbol.toUpperCase()).catch(() => null);
  return {
    symbol: symbol.toUpperCase(),
    bias: analysis?.decision?.finalMarketBias ?? mtf?.decision.finalBias ?? 'neutral',
    confidenceScore: analysis?.confidenceScore ?? mtf?.decision.confidenceScore ?? 0,
    explanation: analysis?.marketMeaning ?? mtf?.decision.marketNarrative ?? 'No autonomous bias is available yet.',
  };
}

export async function getTimeframeMatrix(symbol: string) {
  const analyses = await getVisionAnalysis(symbol);
  const mtf = await getSymbolMultiTimeframe(symbol.toUpperCase()).catch(() => null);
  return buildTimeframeMatrix(symbol.toUpperCase(), analyses, mtf);
}

export async function getDetectedZones(symbol: string) {
  const analysis = (await getVisionAnalysis(symbol))[0] ?? null;
  const fvgRows = await queryPostgres('SELECT * FROM fair_value_gaps WHERE upper(symbol) = $1 ORDER BY created_at DESC LIMIT 50', [symbol.toUpperCase()]);
  return {
    symbol: symbol.toUpperCase(),
    liquidityMap: analysis?.liquidityMap ?? {},
    orderBlocks: analysis?.orderBlocks ?? [],
    fairValueGaps: fvgRows.rows.map((row) => ({
      id: String(row.id),
      timeframe: String(row.timeframe),
      direction: String(row.direction),
      priceLow: nullableNumber(row.price_low),
      priceHigh: nullableNumber(row.price_high),
      fillStatus: String(row.fill_status),
      confidenceScore: Number(row.confidence_score),
    })),
  };
}

export async function getTradeDecision(symbol: string) {
  const latest = await getLatestVisualMarketInterpretation(symbol.toUpperCase());
  return latest ? {
    symbol: latest.symbol,
    timeframe: latest.timeframe,
    decision: latest.recommendedAction,
    confidenceScore: latest.confidenceScore,
    marketMeaning: latest.marketMeaning,
    explanation: latest.explanation,
    riskWarning: latest.riskWarning,
  } : {
    symbol: symbol.toUpperCase(),
    decision: 'MONITOR',
    confidenceScore: 0,
    marketMeaning: 'No autonomous trade decision is available yet.',
    explanation: 'Cacsms Vision is waiting for capture and detector outputs.',
    riskWarning: 'No trade is permitted without current autonomous analysis.',
  };
}

export async function getExecutionReadiness(symbol: string) {
  const decision = await getTradeDecision(symbol);
  const risk = await getRiskStatus(symbol);
  const ready = ['BUY', 'SELL'].includes(decision.decision) && decision.confidenceScore >= 70 && risk.status !== 'blocked';
  return {
    symbol: symbol.toUpperCase(),
    ready,
    mode: 'assisted_trade',
    blockers: ready ? [] : ['Decision, confidence, or risk state is not execution-ready.'],
    decision,
    risk,
  };
}

export async function getRiskStatus(symbol?: string) {
  const normalized = symbol?.toUpperCase();
  const anomaly = normalized ? await getLatestVisualAnomaly(normalized, 'H1').catch(() => null) : null;
  const highImpact = await queryPostgres(`
    SELECT COUNT(*)::int AS count FROM economic_events
    WHERE impact = 'High'
      AND event_time BETWEEN now() - interval '30 minutes' AND now() + interval '30 minutes'
  `).catch(() => ({ rows: [] as Row[] }));
  const highImpactCount = Number(highImpact.rows[0]?.count ?? 0);
  const blocked = highImpactCount > 0 || anomaly?.severity.overallSeverity === 'Critical';
  return {
    symbol: normalized ?? 'ALL',
    status: blocked ? 'blocked' : 'monitoring',
    highImpactCount,
    anomalySeverity: anomaly?.severity.overallSeverity ?? 'None',
    warning: blocked ? 'Autonomous risk blocker is active.' : 'No hard Cacsms Vision risk blocker is active.',
  };
}

export async function getVisionAuditLogs(limit = 100) {
  await ensureCacsmsVisionSchema();
  const result = await queryPostgres(`
    SELECT * FROM audit_logs
    WHERE action LIKE 'cacsms.vision.%'
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map((row) => ({
    id: String(row.id),
    traceId: String(row.trace_id),
    actor: String(row.actor),
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: nullableString(row.entity_id),
    payload: objectValue(row.payload_json),
    createdAt: dateString(row.created_at),
  }));
}

export async function triggerVisionBacktest(symbol: string) {
  await ensureCacsmsVisionSchema();
  const traceId = randomUUID();
  await writeAudit(traceId, 'cacsms.vision.backtest.requested', 'vision_backtest', symbol, { symbol: symbol.toUpperCase(), mode: 'historical_validation' });
  return { traceId, symbol: symbol.toUpperCase(), status: 'queued', message: 'Backtest request logged for autonomous validation worker.' };
}

export async function triggerVisionPaperTrade(symbol: string) {
  await ensureCacsmsVisionSchema();
  const readiness = await getExecutionReadiness(symbol);
  const traceId = randomUUID();
  await writeAudit(traceId, 'cacsms.vision.paper_trade.requested', 'paper_trade', symbol, toPayload(readiness));
  return { traceId, symbol: symbol.toUpperCase(), status: readiness.ready ? 'queued' : 'blocked', readiness };
}

async function runVisionTimeframe(scanId: string, symbol: string, timeframe: AutonomyTimeframe) {
  const traceId = randomUUID();
  const capture = await latestCapture(symbol, timeframe);
  const interpretation = await analyzeVisualMarketInterpretation({ symbol, timeframe });
  const [anomaly, segmentation, mtf] = await Promise.all([
    getLatestVisualAnomaly(symbol, timeframe).catch(() => null),
    getLatestChartSegmentation(symbol, timeframe).catch(() => null),
    getSymbolMultiTimeframe(symbol).catch(() => null),
  ]);
  const liquidityMap = { objective: interpretation.liquidityObjective, anomaly: anomaly?.severity ?? null };
  const orderBlocks: unknown[] = [];
  const fairValueGaps = detectFairValueGapsFromText(symbol, timeframe, capture?.id ?? null, interpretation.fullNarrative);
  const marketStructure = {
    phase: interpretation.marketPhase,
    dominantTimeframe: interpretation.dominantTimeframe,
    mtfDecision: mtf?.decision ?? null,
  };
  for (const gap of fairValueGaps) await persistFairValueGap(gap);
  const analysisId = randomUUID();
  await queryPostgres(`
    INSERT INTO cacsms_vision_analysis (
      id, scan_id, chart_capture_id, symbol, timeframe, source_platform, capture_status,
      analysis_status, confidence_score, market_meaning, institutional_interpretation,
      retail_trap_warning, liquidity_map_json, order_blocks_json, fair_value_gaps_json,
      market_structure_json, anomaly_json, segmentation_json, decision_json, audit_trace_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::jsonb,$20)
  `, [
    analysisId,
    scanId,
    capture?.id ?? null,
    symbol,
    timeframe,
    capture?.sourcePlatform ?? 'autonomous_capture_missing',
    capture ? 'captured' : 'missing_capture',
    capture ? 'completed' : 'completed_with_capture_gap',
    interpretation.confidenceScore,
    interpretation.marketMeaning,
    interpretation.institutionalInterpretation,
    interpretation.retailTrapWarning,
    JSON.stringify(liquidityMap),
    JSON.stringify({ items: orderBlocks }),
    JSON.stringify({ items: fairValueGaps }),
    JSON.stringify(marketStructure),
    JSON.stringify(toPayload(anomaly)),
    JSON.stringify(toPayload(segmentation)),
    JSON.stringify(toPayload(interpretation)),
    traceId,
  ]);
  await writeAudit(traceId, 'cacsms.vision.analysis.completed', 'vision_analysis', analysisId, { symbol, timeframe, captureStatus: capture ? 'captured' : 'missing_capture' });
  await publishVisualIntelligenceEvent('cacsms.vision.analysis.completed', capture?.id ?? null, null, { analysisId, symbol, timeframe, confidenceScore: interpretation.confidenceScore });
  return { analysisId, symbol, timeframe, captureStatus: capture ? 'captured' : 'missing_capture', confidenceScore: interpretation.confidenceScore };
}

async function latestCapture(symbol: string, timeframe: string) {
  const result = await queryPostgres(`
    SELECT * FROM chart_captures
    WHERE upper(symbol) = $1 AND upper(timeframe) = $2
    ORDER BY captured_at DESC
    LIMIT 1
  `, [symbol.toUpperCase(), timeframe.toUpperCase()]);
  return result.rows[0] ? mapCapture(result.rows[0]) : null;
}

function buildTimeframeMatrix(symbol: string, analyses: ReturnType<typeof mapVisionAnalysis>[], mtf: Awaited<ReturnType<typeof getSymbolMultiTimeframe>>) {
  return visionTimeframes.map((timeframe) => {
    const analysis = analyses.find((item) => item.timeframe === timeframe);
    const snapshot = mtf?.snapshots.find((item) => item.timeframe === timeframe);
    return {
      symbol,
      timeframe,
      bias: analysis?.decision?.finalMarketBias ?? snapshot?.bias ?? 'neutral',
      decision: analysis?.decision?.finalDecision ?? snapshot?.decisionState ?? 'MONITOR',
      confidenceScore: analysis?.confidenceScore ?? snapshot?.aiConfidenceScore ?? 0,
      captureStatus: analysis?.captureStatus ?? 'waiting',
      explanation: analysis?.marketMeaning ?? snapshot?.marketStructure ?? `${timeframe} is waiting for autonomous analysis.`,
    };
  });
}

function executionReadinessFromAnalysis(analysis: ReturnType<typeof mapVisionAnalysis>) {
  return {
    ready: ['BUY', 'SELL'].includes(String(analysis.decision.finalDecision)) && analysis.confidenceScore >= 70,
    decision: analysis.decision.finalDecision ?? 'MONITOR',
    confidenceScore: analysis.confidenceScore,
    invalidation: analysis.decision.invalidationCondition ?? 'No invalidation available yet.',
  };
}

function detectFairValueGapsFromText(symbol: string, timeframe: string, captureId: string | null, narrative: string) {
  if (!narrative.toLowerCase().includes('fair value gap') && !narrative.toLowerCase().includes('imbalance')) return [];
  return [{
    id: randomUUID(),
    chartCaptureId: captureId,
    symbol,
    timeframe,
    direction: narrative.toLowerCase().includes('bear') ? 'bearish' : 'bullish',
    priceLow: null,
    priceHigh: null,
    startCandleIndex: null,
    endCandleIndex: null,
    fillStatus: 'open',
    confidenceScore: 0.55,
    metadata: { source: 'narrative_imbalance_detector' },
  }];
}

async function persistFairValueGap(gap: ReturnType<typeof detectFairValueGapsFromText>[number]) {
  await queryPostgres(`
    INSERT INTO fair_value_gaps (
      id, chart_capture_id, symbol, timeframe, direction, price_low, price_high,
      start_candle_index, end_candle_index, fill_status, confidence_score, metadata_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
  `, [gap.id, gap.chartCaptureId, gap.symbol, gap.timeframe, gap.direction, gap.priceLow, gap.priceHigh, gap.startCandleIndex, gap.endCandleIndex, gap.fillStatus, gap.confidenceScore, JSON.stringify(gap.metadata)]);
}

async function writeAudit(traceId: string, action: string, entityType: string, entityId: string, payload: Record<string, unknown>) {
  await queryPostgres('INSERT INTO audit_logs (id, trace_id, actor, action, entity_type, entity_id, payload_json) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)', [
    randomUUID(),
    traceId,
    'cacsms-vision',
    action,
    entityType,
    entityId,
    JSON.stringify(payload),
  ]);
}

function sanitizeSymbols(symbols?: string[]) {
  const cleaned = (symbols?.length ? symbols : ['XAUUSD']).map((item) => item.toUpperCase().trim()).filter(Boolean);
  return [...new Set(cleaned)];
}

function sanitizeTimeframes(timeframes?: string[]): AutonomyTimeframe[] {
  const source = timeframes?.length ? timeframes : [...visionTimeframes];
  return [...new Set(source.map((item) => item.toUpperCase()).filter((item): item is AutonomyTimeframe => visionTimeframes.includes(item as AutonomyTimeframe)))];
}

function mapCapture(row: Row) {
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

function mapVisionAnalysis(row: Row) {
  return {
    id: String(row.id),
    scanId: nullableString(row.scan_id),
    captureId: nullableString(row.chart_capture_id),
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    sourcePlatform: String(row.source_platform),
    captureStatus: String(row.capture_status),
    analysisStatus: String(row.analysis_status),
    confidenceScore: Number(row.confidence_score),
    marketMeaning: String(row.market_meaning),
    institutionalInterpretation: String(row.institutional_interpretation),
    retailTrapWarning: String(row.retail_trap_warning),
    liquidityMap: objectValue(row.liquidity_map_json),
    orderBlocks: arrayFromContainer(row.order_blocks_json),
    fairValueGaps: arrayFromContainer(row.fair_value_gaps_json),
    marketStructure: objectValue(row.market_structure_json),
    anomaly: objectValue(row.anomaly_json),
    segmentation: objectValue(row.segmentation_json),
    decision: objectValue(row.decision_json),
    auditTraceId: String(row.audit_trace_id),
    createdAt: dateString(row.created_at),
  };
}

function arrayFromContainer(value: unknown) {
  if (Array.isArray(value)) return value;
  const object = objectValue(value);
  return Array.isArray(object.items) ? object.items : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function nullableString(value: unknown) {
  return value == null ? null : String(value);
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateString(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}
