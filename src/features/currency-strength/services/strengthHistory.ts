import { useEffect, useState } from 'react';
import { fetchRegimeHistory } from '../../historical-regime/services/regimeClient';
import { REGIME_ASSETS, type RegimeSnapshot } from '../../historical-regime/types';

/** Full persisted snapshot history per asset (dbo.app_regime_snapshot), cached per engine run. */
type Cache = { runAt: string; histories: Record<string, RegimeSnapshot[]> };

let cache: Cache | null = null;
let inflight: Promise<Cache> | null = null;
let inflightRunAt: string | null = null;

function load(runAt: string): Promise<Cache> {
  if (cache?.runAt === runAt) return Promise.resolve(cache);
  if (inflight && inflightRunAt === runAt) return inflight;
  inflightRunAt = runAt;
  inflight = Promise.all(REGIME_ASSETS.map((a) => fetchRegimeHistory(a, 2000).then((h) => [a, h] as const)))
    .then((pairs) => {
      cache = { runAt, histories: Object.fromEntries(pairs) };
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useStrengthHistory(runAt: string | null | undefined) {
  const [state, setState] = useState<{ histories: Record<string, RegimeSnapshot[]> | null; loading: boolean; error: string }>(() => ({
    histories: cache && cache.runAt === runAt ? cache.histories : cache?.histories ?? null,
    loading: !!runAt && cache?.runAt !== runAt,
    error: '',
  }));

  useEffect(() => {
    if (!runAt) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: cache?.runAt !== runAt }));
    load(runAt)
      .then((c) => !cancelled && setState({ histories: c.histories, loading: false, error: '' }))
      .catch((e) => !cancelled && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'History unavailable' })));
    return () => {
      cancelled = true;
    };
  }, [runAt]);

  return state;
}
