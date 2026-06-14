'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ModuleSummariesPayload } from '@/lib/strategies/run-module-summaries';

const MODULE_SUMMARIES_REFRESH_MS = 30_000;

export function useModuleSummaries(refreshMs = MODULE_SUMMARIES_REFRESH_MS) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ModuleSummariesPayload | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSummaries = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);

    try {
      const response = await fetch('/api/strategies/modules-summary', { cache: 'no-store' });
      const data = await response.json();
      if (!mountedRef.current) return;
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'Unable to load module summaries.');
      }
      setPayload(data);
      setLastSyncAt(new Date().toISOString());
      setError(null);
    } catch (fetchError) {
      if (!mountedRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load module summaries.');
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchSummaries(true);
    const timer = window.setInterval(() => {
      void fetchSummaries(false);
    }, refreshMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [fetchSummaries, refreshMs]);

  return { loading, refreshing, error, payload, lastSyncAt };
}
