import { evaluateStrategyEngine, buildMultiTimeframeTrendEvaluation } from '@/lib/strategies/engines';
import type { StrategyEvaluationResult } from '@/lib/strategies/evaluation';
import { getStrategyDefinition } from '@/lib/strategies/registry';
import { loadStrategyCandles } from '@/lib/strategies/strategy-candle-loader';
import {
  countLoadedMtfTimeframes,
  loadMultiTimeframeStrategyCandles,
} from '@/lib/strategies/strategy-mtf-loader';
import type { Timeframe } from '@/packages/shared-types';

import {
  buildAutonomousConfig,
  resolveAutonomousPipelineSymbol,
  resolveAutonomousStrategyContext,
  resolveAutonomousTimeframeForGroup,
  STRATEGY_AUTONOMOUS_REFRESH_MS,
} from './autonomous-strategy-context';

function parseTimeframe(value: unknown): Timeframe {
  const text = String(value ?? 'H1').toUpperCase();
  const allowed: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  return allowed.includes(text as Timeframe) ? text as Timeframe : 'H1';
}

export interface StrategyEvaluationPayload {
  ok: true;
  result: StrategyEvaluationResult;
  captureId: string | null;
  capturedAt: string | null;
  autonomous: boolean;
  context: {
    symbol: string;
    timeframe: Timeframe;
    pipelineMode?: string;
    activeSymbols?: string[];
    bridgeOnline?: boolean;
    refreshIntervalMs?: number;
  };
  definition: { id: string; label: string; group: string };
}

export async function runStrategyEvaluation(input: {
  strategyId: string;
  autonomous?: boolean;
  /** When autonomous, evaluate this symbol instead of the pipeline default. */
  symbol?: string;
  /** When autonomous with symbol, optional timeframe override (else group preference). */
  timeframe?: string;
  body?: Record<string, unknown>;
}): Promise<StrategyEvaluationPayload> {
  const definition = getStrategyDefinition(input.strategyId);
  if (!definition || definition.status !== 'active') {
    throw new Error(`Unknown or inactive strategy: ${input.strategyId}`);
  }

  let symbol: string;
  let timeframe: Timeframe;
  let config: Record<string, unknown>;
  let meta: StrategyEvaluationPayload['context'] = { symbol: 'EURUSD', timeframe: 'H1' };

  if (input.autonomous) {
    if (input.symbol) {
      symbol = input.symbol.toUpperCase();
      timeframe = input.timeframe
        ? parseTimeframe(input.timeframe)
        : resolveAutonomousTimeframeForGroup(definition.group);
      config = buildAutonomousConfig(definition, symbol, timeframe);
      meta = {
        symbol,
        timeframe,
        refreshIntervalMs: STRATEGY_AUTONOMOUS_REFRESH_MS,
      };
    } else {
      const autonomous = await resolveAutonomousStrategyContext(definition);
      symbol = autonomous.symbol;
      timeframe = autonomous.timeframe;
      config = autonomous.config;
      meta = {
        symbol,
        timeframe,
        pipelineMode: autonomous.pipelineMode,
        activeSymbols: autonomous.activeSymbols,
        bridgeOnline: autonomous.bridgeOnline,
        refreshIntervalMs: autonomous.refreshIntervalMs,
      };
    }
  } else {
    const body = input.body ?? {};
    symbol = String(body.symbol ?? 'EURUSD').toUpperCase();
    timeframe = parseTimeframe(body.timeframe);
    config = { symbol, timeframe };
    for (const parameter of definition.parameters) {
      if (parameter.key === 'symbol' || parameter.key === 'timeframe') continue;
      const raw = body[parameter.key];
      config[parameter.key] = parameter.type === 'number'
        ? Number(raw ?? parameter.defaultValue)
        : String(raw ?? parameter.defaultValue);
    }
    meta = { symbol, timeframe };
  }

  if (input.strategyId === 'multi-timeframe-trend-confirmation') {
    const minAligned = Math.max(2, Number(config.minAlignedTimeframes ?? 3));
    const { candleMap, captureIds, capturedAt, primaryCaptureId } = await loadMultiTimeframeStrategyCandles(
      symbol,
      Math.max(definition.minCandles + 20, 120),
    );
    const loadedCount = countLoadedMtfTimeframes(candleMap, definition.minCandles);
    if (loadedCount < minAligned) {
      const error = new Error(
        `Not enough multi-timeframe data for ${symbol}. Run chart capture for W/D/H4/H1/M15 (${loadedCount} timeframes ready, ${minAligned} required).`,
      ) as Error & { captureId?: string | null; capturedAt?: string | null; status?: number };
      error.captureId = primaryCaptureId;
      error.capturedAt = capturedAt;
      error.status = 422;
      throw error;
    }

    const result = buildMultiTimeframeTrendEvaluation({
      symbol,
      candleMap,
      captureMap: captureIds,
      config,
      context: { symbol, timeframe: 'H4' },
    });

    return {
      ok: true,
      result,
      captureId: primaryCaptureId,
      capturedAt,
      autonomous: Boolean(input.autonomous),
      context: { ...meta, timeframe: 'H4' },
      definition: { id: definition.id, label: definition.label, group: definition.group },
    };
  }

  const { candles, captureId, capturedAt } = await loadStrategyCandles({
    symbol,
    timeframe,
    limit: Math.max(definition.minCandles + 20, 120),
  });

  if (candles.length < definition.minCandles) {
    const error = new Error(
      `Not enough candle data for ${symbol} ${timeframe}. Run chart capture first (${candles.length} candles available, ${definition.minCandles} required).`,
    ) as Error & { captureId?: string | null; capturedAt?: string | null; status?: number };
    error.captureId = captureId;
    error.capturedAt = capturedAt;
    error.status = 422;
    throw error;
  }

  const result = evaluateStrategyEngine(input.strategyId, candles, config);
  return {
    ok: true,
    result,
    captureId,
    capturedAt,
    autonomous: Boolean(input.autonomous),
    context: meta,
    definition: { id: definition.id, label: definition.label, group: definition.group },
  };
}

export interface AutonomousOverviewStrategyEntry {
  id: string;
  label: string;
  group: string;
  tone: string;
  decision: 'buy' | 'sell' | 'wait';
  confidence: number;
  bias: string;
  evaluatedAt: string | null;
  error: string | null;
}

export interface AutonomousOverviewResult {
  symbol: string;
  pipelineMode: string;
  activeSymbols: string[];
  bridgeOnline: boolean;
  refreshIntervalMs: number;
  evaluatedAt: string;
  strategies: AutonomousOverviewStrategyEntry[];
}

const OVERVIEW_CACHE_TTL_MS = 15_000;
let overviewCache: { at: number; data: AutonomousOverviewResult } | null = null;
let overviewInflight: Promise<AutonomousOverviewResult> | null = null;

async function computeAutonomousOverviewEvaluations(): Promise<AutonomousOverviewResult> {
  const { ACTIVE_STRATEGIES } = await import('@/lib/strategies/registry');
  const pipeline = await resolveAutonomousPipelineSymbol();

  const strategies = await Promise.all(
    ACTIVE_STRATEGIES.map(async (definition) => {
      try {
        const payload = await runStrategyEvaluation({ strategyId: definition.id, autonomous: true });
        return {
          id: definition.id,
          label: definition.label,
          group: definition.group,
          tone: definition.tone,
          decision: payload.result.decision,
          confidence: payload.result.confidence,
          bias: payload.result.bias,
          evaluatedAt: payload.result.evaluatedAt,
          error: null as string | null,
        };
      } catch (error) {
        return {
          id: definition.id,
          label: definition.label,
          group: definition.group,
          tone: definition.tone,
          decision: 'wait' as const,
          confidence: 0,
          bias: 'neutral' as const,
          evaluatedAt: null,
          error: error instanceof Error ? error.message : 'Evaluation failed.',
        };
      }
    }),
  );

  return {
    symbol: pipeline.symbol,
    pipelineMode: pipeline.pipelineMode,
    activeSymbols: pipeline.activeSymbols,
    bridgeOnline: pipeline.bridgeOnline,
    refreshIntervalMs: 30_000,
    evaluatedAt: new Date().toISOString(),
    strategies,
  };
}

export async function runAutonomousOverviewEvaluations(options?: { force?: boolean }): Promise<AutonomousOverviewResult> {
  const now = Date.now();
  if (!options?.force && overviewCache && now - overviewCache.at < OVERVIEW_CACHE_TTL_MS) {
    return overviewCache.data;
  }

  if (!options?.force && overviewInflight) {
    return overviewInflight;
  }

  overviewInflight = computeAutonomousOverviewEvaluations()
    .then((data) => {
      overviewCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      overviewInflight = null;
    });

  return overviewInflight;
}
