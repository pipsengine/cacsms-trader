import { analyzeCaptureCandles, getCandleAnalysis } from './candle-detection-store';
import { analyzeCaptureChannels, getChannelAnalysis } from './channel-detection-store';
import { analyzeCaptureLiquidity, getLiquidityAnalysis } from './liquidity-zone-store';
import { analyzeCaptureOrderBlocks, getOrderBlockAnalysis } from './order-block-detection-store';
import { analyzeCapturePatterns, getPatternAnalysis } from './pattern-recognition-store';
import { analyzeCaptureStructure, getStructureAnalysis } from './structure-analysis-store';
import { analyzeCaptureSupportResistance, getSupportResistanceAnalysis } from './support-resistance-store';
import { analyzeCaptureSwings, getSwingAnalysis } from './swing-point-store';
import { analyzeCaptureTrendlines, getTrendlineAnalysis } from './trendline-detection-store';
import { createCaptureAndRunAnalysis, getCaptureAnalysis, listCaptures, publishVisualIntelligenceEvent } from './visual-intelligence-store';
import type { ChartCaptureRequest } from './visual-intelligence-types';

type StageName =
  | 'capture'
  | 'candles'
  | 'swings'
  | 'patterns'
  | 'trendlines'
  | 'channels'
  | 'supportResistance'
  | 'orderBlocks'
  | 'liquidity'
  | 'structure';

type StageResult<T> = {
  ok: true;
  data: T;
  processingTimeMs: number;
} | {
  ok: false;
  error: string;
  processingTimeMs: number;
};

export interface FullVisualIntelligenceResult {
  captureId: string;
  stages: Record<StageName, StageResult<unknown>>;
  finalDecision: {
    decision: string;
    bias: string;
    confidence: number;
    reasoning: string;
    source: string;
  };
  completedAt: string;
}

type StageInput = ChartCaptureRequest & { captureId: string };

export async function runFullVisualIntelligence(input: ChartCaptureRequest & { captureId?: string }): Promise<FullVisualIntelligenceResult> {
  const startedAt = Date.now();
  await publishVisualIntelligenceEvent('visual_intelligence.orchestration.started', input.captureId ?? null, null, {
    stage: 'full_visual_intelligence_started',
    symbol: input.symbol,
    timeframe: input.timeframe,
  });

  const captureStage = await runStage('capture', input.captureId ?? null, async () => {
    if (input.captureId) {
      const existing = await getCaptureAnalysis(input.captureId);
      if (!existing) throw new Error(`Capture ${input.captureId} was not found.`);
      return existing;
    }
    return createCaptureAndRunAnalysis(input);
  });

  if (!captureStage.ok) {
    await publishVisualIntelligenceEvent('visual_intelligence.orchestration.failed', input.captureId ?? null, null, {
      stage: 'capture',
      error: captureStage.error,
    });
    throw new Error(captureStage.error);
  }

  const captureId = captureIdFrom(captureStage.data);
  const stageInput: StageInput = { ...input, captureId };
  const stages: Record<StageName, StageResult<unknown>> = {
    capture: captureStage,
    candles: await runStage('candles', captureId, () => analyzeCaptureCandles(stageInput)),
    swings: await runStage('swings', captureId, () => analyzeCaptureSwings(stageInput)),
    patterns: await runStage('patterns', captureId, () => analyzeCapturePatterns(stageInput)),
    trendlines: await runStage('trendlines', captureId, () => analyzeCaptureTrendlines(stageInput)),
    channels: await runStage('channels', captureId, () => analyzeCaptureChannels(stageInput)),
    supportResistance: await runStage('supportResistance', captureId, () => analyzeCaptureSupportResistance(stageInput)),
    orderBlocks: await runStage('orderBlocks', captureId, () => analyzeCaptureOrderBlocks(stageInput)),
    liquidity: await runStage('liquidity', captureId, () => analyzeCaptureLiquidity(stageInput)),
    structure: await runStage('structure', captureId, () => analyzeCaptureStructure(stageInput)),
  };

  const finalDecision = decisionFrom(stages);
  const result = {
    captureId,
    stages,
    finalDecision,
    completedAt: new Date().toISOString(),
  };

  await publishVisualIntelligenceEvent('visual_intelligence.orchestration.completed', captureId, null, {
    processingTimeMs: Date.now() - startedAt,
    finalDecision,
    stageStatus: Object.fromEntries(Object.entries(stages).map(([name, stage]) => [name, stage.ok ? 'completed' : 'failed'])),
  });
  return result;
}

export async function getFullVisualIntelligence(captureId: string) {
  const [
    capture,
    candles,
    swings,
    patterns,
    trendlines,
    channels,
    supportResistance,
    orderBlocks,
    liquidity,
    structure,
  ] = await Promise.all([
    getCaptureAnalysis(captureId),
    getCandleAnalysis(captureId),
    getSwingAnalysis(captureId),
    getPatternAnalysis(captureId),
    getTrendlineAnalysis(captureId),
    getChannelAnalysis(captureId),
    getSupportResistanceAnalysis(captureId),
    getOrderBlockAnalysis(captureId),
    getLiquidityAnalysis(captureId),
    getStructureAnalysis(captureId),
  ]);

  const stages: Record<StageName, StageResult<unknown>> = {
    capture: capture ? completed(capture) : failed('Capture was not found.'),
    candles: completed(candles),
    swings: completed(swings),
    patterns: completed(patterns),
    trendlines: completed(trendlines),
    channels: completed(channels),
    supportResistance: completed(supportResistance),
    orderBlocks: completed(orderBlocks),
    liquidity: completed(liquidity),
    structure: completed(structure),
  };

  return {
    captureId,
    stages,
    finalDecision: decisionFrom(stages),
    completedAt: new Date().toISOString(),
  };
}

export async function getLatestFullVisualIntelligence() {
  const captures = await listCaptures(1);
  const latest = captures[0];
  return latest ? getFullVisualIntelligence(latest.id) : null;
}

async function runStage<T>(name: StageName, captureId: string | null, work: () => Promise<T>): Promise<StageResult<T>> {
  const startedAt = Date.now();
  await publishVisualIntelligenceEvent(`visual_intelligence.${name}.started`, captureId, null, { stage: name });
  try {
    const data = await work();
    const processingTimeMs = Date.now() - startedAt;
    await publishVisualIntelligenceEvent(`visual_intelligence.${name}.completed`, captureId, null, {
      stage: name,
      processingTimeMs,
      summary: summaryFrom(data),
    });
    return { ok: true, data, processingTimeMs };
  } catch (error) {
    const processingTimeMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : `Unable to complete ${name}.`;
    await publishVisualIntelligenceEvent(`visual_intelligence.${name}.failed`, captureId, null, {
      stage: name,
      processingTimeMs,
      error: message,
    });
    return { ok: false, error: message, processingTimeMs };
  }
}

function captureIdFrom(data: unknown): string {
  if (isRecord(data) && isRecord(data.capture) && typeof data.capture.id === 'string') return data.capture.id;
  if (isRecord(data) && typeof data.captureId === 'string') return data.captureId;
  throw new Error('Capture analysis did not return a capture id.');
}

function decisionFrom(stages: Record<StageName, StageResult<unknown>>) {
  const structure = stageData(stages.structure);
  if (isRecord(structure) && isRecord(structure.finalBias)) {
    return {
      decision: String(structure.finalBias.tradeDecision ?? 'WAIT'),
      bias: String(structure.finalBias.institutionalBias ?? 'neutral/ranging bias'),
      confidence: numberValue(structure.finalBias.confidenceScore),
      reasoning: String(structure.finalBias.reasoningText ?? 'Structure final bias completed.'),
      source: 'market_structure_brain',
    };
  }

  const capture = stageData(stages.capture);
  if (isRecord(capture) && isRecord(capture.decision)) {
    return {
      decision: String(capture.decision.decision ?? 'WAIT'),
      bias: String(capture.decision.bias ?? 'vision_baseline'),
      confidence: numberValue(capture.decision.confidence),
      reasoning: String(capture.decision.reasoningText ?? 'Baseline visual intelligence decision completed.'),
      source: 'visual_intelligence_baseline',
    };
  }

  return {
    decision: 'WAIT',
    bias: 'insufficient_completed_stages',
    confidence: 0,
    reasoning: 'Full intelligence orchestration did not produce a final decision.',
    source: 'orchestrator',
  };
}

function summaryFrom(data: unknown): unknown {
  if (isRecord(data) && 'summary' in data) return data.summary;
  if (isRecord(data) && isRecord(data.decision)) return data.decision;
  return null;
}

function completed<T>(data: T): StageResult<T> {
  return { ok: true, data, processingTimeMs: 0 };
}

function failed(error: string): StageResult<never> {
  return { ok: false, error, processingTimeMs: 0 };
}

function stageData(stage: StageResult<unknown>): unknown {
  return stage.ok ? stage.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
