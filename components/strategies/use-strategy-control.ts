'use client';

import { useCallback, useEffect, useState } from 'react';

import type { StrategyControlPayload } from '@/lib/strategies/strategy-control-types';
import type { StrategyControlSlug } from '@/lib/strategies/strategy-control-modules';
import { STRATEGY_CONTROL_REFRESH_MS } from '@/lib/strategies/strategy-control-types';

export interface StrategyControlState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  payload: StrategyControlPayload | null;
  lastSyncAt: string | null;
}

export function useStrategyControl(moduleId: StrategyControlSlug, refreshMs = STRATEGY_CONTROL_REFRESH_MS) {
  const [state, setState] = useState<StrategyControlState>({
    loading: true,
    refreshing: false,
    error: null,
    payload: null,
    lastSyncAt: null,
  });

  const load = useCallback(async (initial = false) => {
    setState((current) => ({
      ...current,
      loading: initial ? true : current.loading,
      refreshing: initial ? false : true,
    }));
    try {
      const response = await fetch(`/api/strategies/control/${moduleId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: payload.error ?? 'Unable to load strategy control module.',
          lastSyncAt: new Date().toISOString(),
        }));
        return;
      }
      setState({
        loading: false,
        refreshing: false,
        error: null,
        payload: payload as StrategyControlPayload,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Unable to load strategy control module.',
        lastSyncAt: new Date().toISOString(),
      }));
    }
  }, [moduleId]);

  useEffect(() => {
    void load(true);
    const interval = window.setInterval(() => void load(false), refreshMs);
    return () => window.clearInterval(interval);
  }, [load, refreshMs]);

  return state;
}
