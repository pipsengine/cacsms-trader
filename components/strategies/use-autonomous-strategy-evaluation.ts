'use client';

import { useCallback, useEffect, useState } from 'react';

import type { StrategyEvaluationResult } from '@/lib/strategies/evaluation';

export interface AutonomousStrategyEvaluationState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  result: StrategyEvaluationResult | null;
  captureId: string | null;
  capturedAt: string | null;
  lastSyncAt: string | null;
  context: {
    symbol: string;
    timeframe: string;
    pipelineMode?: string;
    activeSymbols?: string[];
    bridgeOnline?: boolean;
    refreshIntervalMs?: number;
  } | null;
}

export function useAutonomousStrategyEvaluation(strategyId: string, refreshMs = 15_000) {
  const [state, setState] = useState<AutonomousStrategyEvaluationState>({
    loading: true,
    refreshing: false,
    error: null,
    result: null,
    captureId: null,
    capturedAt: null,
    lastSyncAt: null,
    context: null,
  });

  const evaluate = useCallback(async (initial = false) => {
    setState((current) => ({
      ...current,
      loading: initial ? true : current.loading,
      refreshing: initial ? false : true,
    }));
    try {
      const response = await fetch('/api/strategies/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId, autonomous: true }),
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!payload.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: payload.error ?? 'Autonomous evaluation failed.',
          result: null,
          captureId: payload.captureId ?? null,
          capturedAt: payload.capturedAt ?? null,
          lastSyncAt: new Date().toISOString(),
          context: payload.context ?? current.context,
        }));
        return;
      }
      setState({
        loading: false,
        refreshing: false,
        error: null,
        result: payload.result as StrategyEvaluationResult,
        captureId: payload.captureId ?? null,
        capturedAt: payload.capturedAt ?? null,
        lastSyncAt: new Date().toISOString(),
        context: payload.context ?? null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Autonomous evaluation failed.',
        lastSyncAt: new Date().toISOString(),
      }));
    }
  }, [strategyId]);

  useEffect(() => {
    void evaluate(true);
    const interval = window.setInterval(() => void evaluate(false), refreshMs);
    return () => window.clearInterval(interval);
  }, [evaluate, refreshMs]);

  return state;
}
