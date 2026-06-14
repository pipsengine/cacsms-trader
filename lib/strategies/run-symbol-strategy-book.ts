import { ACTIVE_STRATEGIES } from '@/lib/strategies/registry';
import { getStrategyPerformance } from '@/lib/strategy-governance';
import type { Timeframe } from '@/packages/shared-types';

import { resolveAutonomousTimeframeForGroup } from './autonomous-strategy-context';
import { runStrategyEvaluation } from './run-strategy-evaluation';
import {
  bookDecisionFromEntries,
  compositeScore,
  compositeScoreWithPerformance,
  healthyStrategyEntries,
  rankStrategyEntries,
} from './strategy-book-scoring';
import type { StrategyControlOverviewEntry, StrategyControlSignalSide } from './strategy-control-types';

export interface SymbolStrategyBookRanking {
  id: string;
  label: string;
  group: string;
  decision: StrategyControlSignalSide;
  confidence: number;
  bias: string;
  score: number;
  winRate: number | null;
  sampleSize: number;
  expectancyR: number | null;
}

export interface SymbolStrategyBookResult {
  symbol: string;
  signalTimeframe: string;
  evaluatedAt: string;
  healthyCount: number;
  totalCount: number;
  bookDecision: StrategyControlSignalSide | 'neutral';
  bestStrategy: SymbolStrategyBookRanking | null;
  topRankings: SymbolStrategyBookRanking[];
  reasons: string[];
}

const symbolBookCache = new Map<string, { at: number; data: SymbolStrategyBookResult }>();
let symbolBookInflight = new Map<string, Promise<SymbolStrategyBookResult>>();

function cacheTtlMs(): number {
  const raw = Number(process.env.CACSMS_STRATEGY_BOOK_CACHE_TTL_MS ?? 30_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

function concurrencyLimit(): number {
  const raw = Number(process.env.CACSMS_STRATEGY_BOOK_CONCURRENCY ?? 8);
  return Number.isFinite(raw) && raw > 0 ? Math.min(16, Math.round(raw)) : 8;
}

function bookEnabled(): boolean {
  const raw = String(process.env.CACSMS_STRATEGY_BOOK_ENABLED ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function parseTimeframe(value: string): Timeframe {
  const text = String(value ?? 'H1').toUpperCase();
  const allowed: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  return allowed.includes(text as Timeframe) ? text as Timeframe : 'H1';
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index]!);
    await runNext();
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(runners);
  return results;
}

async function evaluateStrategyForSymbol(
  definition: (typeof ACTIVE_STRATEGIES)[number],
  symbol: string,
  signalTimeframe: Timeframe,
): Promise<StrategyControlOverviewEntry> {
  const timeframe = definition.id === 'multi-timeframe-trend-confirmation'
    ? 'H4'
    : resolveAutonomousTimeframeForGroup(definition.group);

  try {
    const payload = await runStrategyEvaluation({
      strategyId: definition.id,
      autonomous: true,
      symbol,
      timeframe: timeframe === signalTimeframe ? timeframe : timeframe,
    });
    return {
      id: definition.id,
      label: definition.label,
      group: definition.group,
      tone: definition.tone,
      decision: payload.result.decision,
      confidence: payload.result.confidence,
      bias: payload.result.bias,
      evaluatedAt: payload.result.evaluatedAt,
      error: null,
    };
  } catch (error) {
    return {
      id: definition.id,
      label: definition.label,
      group: definition.group,
      tone: definition.tone,
      decision: 'wait',
      confidence: 0,
      bias: 'neutral',
      evaluatedAt: null,
      error: error instanceof Error ? error.message : 'evaluation_failed',
    };
  }
}

async function enrichRankingsWithPerformance(
  entries: StrategyControlOverviewEntry[],
  limit: number,
): Promise<SymbolStrategyBookRanking[]> {
  const preliminary = rankStrategyEntries(entries, limit, compositeScore);
  const entryById = new Map(entries.map((item) => [item.id, item]));

  const enriched = await Promise.all(
    preliminary.map(async (row) => {
      const entry = entryById.get(row.id);
      if (!entry) return null;
      const metrics = await getStrategyPerformance(row.id).catch(() => null);
      const score = compositeScoreWithPerformance(entry, metrics);
      return {
        id: row.id,
        label: row.label,
        group: row.group,
        decision: row.decision,
        confidence: row.confidence,
        bias: row.bias,
        score,
        winRate: metrics && metrics.sampleSize > 0 ? metrics.winRate : null,
        sampleSize: metrics?.sampleSize ?? 0,
        expectancyR: metrics?.sampleSize ? metrics.expectancyR : null,
      } satisfies SymbolStrategyBookRanking;
    }),
  );

  return enriched
    .filter((item): item is SymbolStrategyBookRanking => item != null)
    .sort((left, right) => right.score - left.score);
}

async function computeSymbolStrategyBook(input: {
  symbol: string;
  signalTimeframe: string;
}): Promise<SymbolStrategyBookResult> {
  const symbol = input.symbol.toUpperCase();
  const signalTimeframe = parseTimeframe(input.signalTimeframe);
  const evaluatedAt = new Date().toISOString();

  if (!bookEnabled()) {
    return {
      symbol,
      signalTimeframe,
      evaluatedAt,
      healthyCount: 0,
      totalCount: ACTIVE_STRATEGIES.length,
      bookDecision: 'neutral',
      bestStrategy: null,
      topRankings: [],
      reasons: ['Strategy book scan disabled via CACSMS_STRATEGY_BOOK_ENABLED=false.'],
    };
  }

  const entries = await mapWithConcurrency(
    ACTIVE_STRATEGIES,
    concurrencyLimit(),
    (definition) => evaluateStrategyForSymbol(definition, symbol, signalTimeframe),
  );

  const healthy = healthyStrategyEntries(entries);
  const bookDecision = bookDecisionFromEntries(entries);
  const topRankings = await enrichRankingsWithPerformance(entries, 20);
  const bestStrategy = topRankings[0] ?? null;
  const actionable = topRankings.filter((item) => item.decision !== 'wait').length;

  const reasons = [
    `Scanned ${healthy.length}/${ACTIVE_STRATEGIES.length} active strategy engines for ${symbol}.`,
    bestStrategy
      ? `Best fit: ${bestStrategy.label} (${bestStrategy.score}/100, ${bestStrategy.decision}, engine confidence ${bestStrategy.confidence}%).`
      : 'No healthy strategy engine produced a ranking.',
    `Book consensus: ${bookDecision}. ${actionable} actionable candidate(s) in top 20.`,
  ];
  if (bestStrategy?.winRate != null && bestStrategy.sampleSize >= 3) {
    reasons.push(
      `Historical win rate for ${bestStrategy.label}: ${(bestStrategy.winRate * 100).toFixed(1)}% over ${bestStrategy.sampleSize} tracked outcomes.`,
    );
  }

  return {
    symbol,
    signalTimeframe,
    evaluatedAt,
    healthyCount: healthy.length,
    totalCount: ACTIVE_STRATEGIES.length,
    bookDecision,
    bestStrategy,
    topRankings,
    reasons,
  };
}

export async function runSymbolStrategyBookScan(input: {
  symbol: string;
  signalTimeframe: string;
  force?: boolean;
}): Promise<SymbolStrategyBookResult> {
  const symbol = input.symbol.toUpperCase();
  const signalTimeframe = parseTimeframe(input.signalTimeframe);
  const cacheKey = `${symbol}:${signalTimeframe}`;
  const now = Date.now();

  if (!input.force) {
    const cached = symbolBookCache.get(cacheKey);
    if (cached && now - cached.at < cacheTtlMs()) {
      return cached.data;
    }
    const inflight = symbolBookInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const task = computeSymbolStrategyBook({ symbol, signalTimeframe })
    .then((data) => {
      symbolBookCache.set(cacheKey, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      symbolBookInflight.delete(cacheKey);
    });

  symbolBookInflight.set(cacheKey, task);
  return task;
}
