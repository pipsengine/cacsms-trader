'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ResearchEvolutionPayload } from '@/lib/strategies/research-evolution-types';
import type { ResearchEvolutionSlug } from '@/lib/strategies/research-evolution-modules';
import { RESEARCH_EVOLUTION_REFRESH_MS } from '@/lib/strategies/research-evolution-types';

export interface ResearchEvolutionState {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  payload: ResearchEvolutionPayload | null;
  lastSyncAt: string | null;
}

export function useResearchEvolution(moduleId: ResearchEvolutionSlug, refreshMs = RESEARCH_EVOLUTION_REFRESH_MS) {
  const [state, setState] = useState<ResearchEvolutionState>({
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
      const response = await fetch(`/api/strategies/research/${moduleId}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setState((current) => ({
          ...current,
          loading: false,
          refreshing: false,
          error: payload.error ?? 'Unable to load research module.',
          lastSyncAt: new Date().toISOString(),
        }));
        return;
      }
      setState({
        loading: false,
        refreshing: false,
        error: null,
        payload: payload as ResearchEvolutionPayload,
        lastSyncAt: new Date().toISOString(),
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Unable to load research module.',
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
