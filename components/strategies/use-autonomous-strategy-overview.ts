'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AutonomousStrategyOverviewItem {
  id: string;
  label: string;
  group: string;
  tone: string;
  decision: string;
  confidence: number;
  bias: string;
  evaluatedAt: string | null;
  error: string | null;
}

export interface AutonomousStrategyOverviewState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  symbol: string | null;
  pipelineMode: string | null;
  activeSymbols: string[];
  bridgeOnline: boolean;
  lastSyncAt: string | null;
  strategies: AutonomousStrategyOverviewItem[];
}

export function useAutonomousStrategyOverview(refreshMs = 30_000) {
  const [state, setState] = useState<AutonomousStrategyOverviewState>({
    loading: true,
    refreshing: false,
    error: null,
    symbol: null,
    pipelineMode: null,
    activeSymbols: [],
    bridgeOnline: true,
    lastSyncAt: null,
    strategies: [],
  });

  const load = useCallback(async (initial = false) => {
    setState((current) => ({
      ...current,
      loading: initial ? true : current.loading,
      refreshing: initial ? false : true,
    }));
    try {
      const response = await fetch('/api/strategies/autonomous-overview', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: payload.error ?? 'Unable to load autonomous strategy overview.',
          lastSyncAt: new Date().toISOString(),
        }));
        return;
      }
      setState({
        loading: false,
        refreshing: false,
        error: null,
        symbol: payload.symbol ?? null,
        pipelineMode: payload.pipelineMode ?? null,
        activeSymbols: Array.isArray(payload.activeSymbols) ? payload.activeSymbols : [],
        bridgeOnline: payload.bridgeOnline ?? true,
        lastSyncAt: new Date().toISOString(),
        strategies: Array.isArray(payload.strategies) ? payload.strategies : [],
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Unable to load autonomous strategy overview.',
        lastSyncAt: new Date().toISOString(),
      }));
    }
  }, []);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(false), refreshMs);
    return () => window.clearInterval(interval);
  }, [load, refreshMs]);

  return state;
}
