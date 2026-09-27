import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult, ControlCommand, WorkflowSnapshot } from '../types/workflow';
import { cacsmsWorkflowAdapter, type WorkflowEngineAdapter } from '../services/workflowEngineAdapter';

const MIN_REBUILD_MS = 400;
/** Ages and freshness advance even when nothing publishes. */
const CLOCK_MS = 2000;

export function useWorkflowEngine(adapter: WorkflowEngineAdapter = cacsmsWorkflowAdapter) {
  const [data, setData] = useState<WorkflowSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<(ActionResult & { at: number }) | null>(null);
  const last = useRef(0);
  const pending = useRef<number | undefined>(undefined);

  const rebuild = useCallback(() => {
    try {
      setData(adapter.snapshot());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Workflow snapshot failed');
    }
    last.current = Date.now();
  }, [adapter]);

  const schedule = useCallback(() => {
    if (pending.current !== undefined) return;
    const wait = Math.max(0, MIN_REBUILD_MS - (Date.now() - last.current));
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      rebuild();
    }, wait);
  }, [rebuild]);

  useEffect(() => {
    rebuild();
    const off = adapter.subscribe(schedule);
    const clock = window.setInterval(schedule, CLOCK_MS);
    return () => {
      off();
      clearInterval(clock);
      if (pending.current !== undefined) clearTimeout(pending.current);
      pending.current = undefined;
    };
  }, [adapter, rebuild, schedule]);

  const act = useCallback(
    async (label: string, fn: () => Promise<ActionResult>) => {
      setBusy(label);
      try {
        const r = await fn();
        setNotice({ ...r, at: Date.now() });
        return r;
      } catch (e) {
        const r = { ok: false, message: e instanceof Error ? e.message : `${label} failed` };
        setNotice({ ...r, at: Date.now() });
        return r;
      } finally {
        setBusy(null);
        rebuild();
      }
    },
    [rebuild],
  );

  return {
    data,
    error,
    busy,
    notice,
    clearNotice: () => setNotice(null),
    reconcile: () => act('Reconcile', () => adapter.reconcile()),
    rerunStage: (stage: number) => act(`Re-run Stage ${stage}`, () => adapter.rerunStage(stage)),
    reevaluate: (symbol?: string) => act(symbol ? `Re-evaluate ${symbol}` : 'Re-evaluate all', () => adapter.reevaluate(symbol)),
    control: (cmd: ControlCommand, reason: string) => act(cmd, () => adapter.control(cmd, reason)),
  };
}
