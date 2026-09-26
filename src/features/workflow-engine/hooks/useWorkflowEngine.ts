import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowSnapshot } from '../types/workflow';
import { demoWorkflowAdapter, type WorkflowEngineAdapter } from '../services/workflowEngineAdapter';

export function useWorkflowEngine(adapter: WorkflowEngineAdapter = demoWorkflowAdapter, intervalMs = 1500) {
  const [data, setData] = useState<WorkflowSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setData(await adapter.snapshot());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workflow refresh failed');
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    refresh();
    timer.current = window.setInterval(refresh, intervalMs);
    return () => clearInterval(timer.current);
  }, [refresh, intervalMs]);

  return {
    data,
    loading,
    error,
    refresh,
    pause: async () => {
      await adapter.pause();
      await refresh();
    },
    resume: async () => {
      await adapter.resume();
      await refresh();
    },
    reevaluate: async (s?: string) => {
      await adapter.reevaluate(s);
      await refresh();
    },
    retry: async (s: number) => {
      await adapter.retry(s);
      await refresh();
    },
    setExecution: async (v: boolean) => {
      await adapter.setExecution(v);
      await refresh();
    },
  };
}
