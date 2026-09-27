import { routeEvent } from '../../../engine/orchestrator';
import { eventBus } from '../../../services/eventBus';
import { getRegimeSnapshot, type RegimeStoreSnapshot } from '../../historical-regime/services/regimeStore';
import type { RegimeState } from '../../historical-regime/types';
import { entitiesFrom, strengthFreshness, strongWeakSpread, type DataState } from './strengthModel';

/** Stage 2 output consumed by Historical Regime (Stage 3) and Market Scanner (Stage 4). */
export type Stage2AssetOutput = {
  asset: string;
  composite: number | null;
  macro: number | null;
  current: number | null;
  macroBias: string;
  trajectory: string;
  momentum: number | null;
  confidence: number | null;
  obsDate: string | null;
  closed: boolean;
};

export type Stage2PairOutput = { symbol: string; base: string; quote: string; differential: number | null };

export type Stage2Output = {
  state: DataState;
  obsDate: string | null;
  runAt: string | null;
  assets: Stage2AssetOutput[];
  pairs: Stage2PairOutput[];
  strongest: string | null;
  weakest: string | null;
  spread: number | null;
};

export function stage2Output(store: RegimeStoreSnapshot = getRegimeSnapshot(), now = Date.now()): Stage2Output {
  const fresh = strengthFreshness(store, now);
  const list = entitiesFrom(store.state);
  const sw = strongWeakSpread(list, 'composite');
  return {
    state: fresh.state,
    obsDate: fresh.obsDate,
    runAt: fresh.runAt,
    assets: list.map((e) => ({
      asset: e.asset,
      composite: e.latest?.composite ?? null,
      macro: e.latest?.macro ?? null,
      current: e.latest?.current ?? null,
      macroBias: e.classification,
      trajectory: e.trend,
      momentum: e.latest?.momentum ?? null,
      confidence: e.latest?.confidence ?? null,
      obsDate: e.latest?.date ?? null,
      closed: !!e.latest?.closed,
    })),
    pairs: (store.state?.pairs ?? []).map((p) => ({ symbol: p.symbol, base: p.base, quote: p.quote, differential: p.differential })),
    strongest: sw?.strongest.asset ?? null,
    weakest: sw?.weakest.asset ?? null,
    spread: sw?.spread ?? null,
  };
}

export function stage2Asset(asset: string, out: Stage2Output = stage2Output()): Stage2AssetOutput | undefined {
  return out.assets.find((a) => a.asset === asset);
}

const published = new Map<string, string>();
let publishedObs: string | null = null;

/**
 * Publish Stage 2 changes to the Workflow Engine bus; the orchestrator routes STRENGTH_CHANGE to
 * Stage 2 (strength), Stage 3 (Historical Regime) and Stage 4 (Market Scanner).
 */
export function publishStage2(state: RegimeState | null) {
  if (!state) return;
  const out = stage2Output({ ...getRegimeSnapshot(), state });
  if (out.state !== 'CURRENT' && out.state !== 'WARMING_UP' && out.state !== 'STALE') return;
  const routed = routeEvent('STRENGTH_CHANGE');
  const emit = (symbol: string | undefined, detail: string, extra: Record<string, unknown>) =>
    eventBus.emit({
      id: `s2-${symbol ?? 'all'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'STRENGTH_CHANGE',
      symbol,
      at: new Date().toISOString(),
      payload: { source: 'strength', detail, stage: 2, stages: routed.stages, ...extra },
    });

  if (out.obsDate && out.obsDate !== publishedObs) {
    publishedObs = out.obsDate;
    emit(
      undefined,
      `Stage 2 published D1 ${out.obsDate}: strongest ${out.strongest ?? '—'}, weakest ${out.weakest ?? '—'}, spread ${
        out.spread != null ? out.spread.toFixed(2) : '—'
      } → Historical Regime, Market Scanner`,
      { obsDate: out.obsDate, state: out.state },
    );
  }
  for (const a of out.assets) {
    const sig = `${a.macroBias}|${a.trajectory}`;
    const prev = published.get(a.asset);
    published.set(a.asset, sig);
    if (prev && prev !== sig) {
      const [pb, pt] = prev.split('|');
      emit(a.asset, `${a.asset} strength ${pb}/${pt} → ${a.macroBias}/${a.trajectory} (composite ${a.composite?.toFixed(2) ?? '—'})`, {
        asset: a.asset,
        macroBias: a.macroBias,
        trajectory: a.trajectory,
      });
    }
  }
}
