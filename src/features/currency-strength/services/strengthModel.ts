import { REGIME_ASSETS, type RegimeAssetState, type RegimePair, type RegimeSnapshot, type RegimeState } from '../../historical-regime/types';
import { regimeRunAgeMs, regimeStageStatus, type RegimeStoreSnapshot } from '../../historical-regime/services/regimeStore';

/**
 * Stage 2 views over the authoritative strength trajectories computed by the bridge engine
 * (bridge/mt5/regime.py, persisted in dbo.app_regime_snapshot). Nothing here recomputes strength:
 * it only ranks, aligns and compares the persisted Q/M/W/D, macro (Q+M), current (W+D) and composite values.
 */

export const METRICS = ['composite', 'macro', 'current', 'q', 'm', 'w', 'd'] as const;
export type Metric = (typeof METRICS)[number];
export const TF_METRICS: Metric[] = ['q', 'm', 'w', 'd'];
export const METRIC_LABEL: Record<Metric, string> = {
  composite: 'Composite',
  macro: 'Macro (Q+M)',
  current: 'Current (W+D)',
  q: 'Quarterly',
  m: 'Monthly',
  w: 'Weekly',
  d: 'Daily',
};
export const METRIC_SHORT: Record<Metric, string> = {
  composite: 'Comp',
  macro: 'Macro',
  current: 'Current',
  q: 'Q',
  m: 'M',
  w: 'W',
  d: 'D',
};

/** Engine output range: scale · tanh(·) with scale 10. */
export const STRENGTH_RANGE = 10;

export type StrengthEntity = {
  asset: string;
  kind: 'FIAT' | 'METAL';
  status: RegimeAssetState['status'];
  latest: RegimeSnapshot | null;
  /** Closed D1 observations only, oldest → newest. */
  closed: RegimeSnapshot[];
  classification: string;
  trend: string;
  message?: string | null;
};

export function val(s: RegimeSnapshot | null | undefined, m: Metric): number | null {
  if (!s) return null;
  const v = s[m];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function entitiesFrom(state: RegimeState | null, histories?: Record<string, RegimeSnapshot[]>): StrengthEntity[] {
  if (!state) return [];
  const rows = new Map((state.strengths ?? []).map((r) => [r.code, r]));
  return REGIME_ASSETS.map((asset) => {
    const a = state.assets.find((x) => x.asset === asset);
    const hist = histories?.[asset]?.length ? histories[asset] : a?.history ?? [];
    const row = rows.get(asset);
    return {
      asset,
      kind: asset === 'XAU' ? 'METAL' : 'FIAT',
      status: a?.status ?? 'NO_DATA',
      latest: a?.latest ?? null,
      closed: hist.filter((h) => h.closed),
      classification: row?.classification ?? (a?.latest ? 'WARMING UP' : 'NO DATA'),
      trend: row?.trend ?? '—',
      message: a?.message,
    };
  });
}

/** Snapshot `lookback` closed observations before the latest closed one. */
export function closedAt(e: StrengthEntity, lookback: number): RegimeSnapshot | null {
  const i = e.closed.length - 1 - lookback;
  return i >= 0 ? e.closed[i] : null;
}

export function ranked(
  list: StrengthEntity[],
  metric: Metric,
  pick: (e: StrengthEntity) => RegimeSnapshot | null = (e) => e.latest,
): Map<string, { value: number; rank: number }> {
  const vals = list
    .map((e) => ({ asset: e.asset, value: val(pick(e), metric) }))
    .filter((x): x is { asset: string; value: number } => x.value != null)
    .sort((a, b) => b.value - a.value);
  return new Map(vals.map((v, i) => [v.asset, { value: v.value, rank: i + 1 }]));
}

/** Consecutive closed observations (ending at the latest) whose metric keeps its current sign. */
export function signStreak(e: StrengthEntity, metric: Metric): number {
  let n = 0;
  let sign = 0;
  for (let i = e.closed.length - 1; i >= 0; i--) {
    const v = val(e.closed[i], metric);
    if (v == null) break;
    const s = Math.sign(v);
    if (n === 0) sign = s;
    if (s !== sign || s === 0) break;
    n += 1;
  }
  return n;
}

export type RankRow = {
  asset: string;
  value: number | null;
  rank: number | null;
  prevValue: number | null;
  prevRank: number | null;
  prevDate: string | null;
  move: number | null;
  change: number | null;
  streak: number;
  persistence: number | null;
  classification: string;
  trend: string;
  status: StrengthEntity['status'];
};

export function rankRows(list: StrengthEntity[], metric: Metric, lookback: number): RankRow[] {
  const now = ranked(list, metric, (e) => e.closed.at(-1) ?? null);
  const prev = ranked(list, metric, (e) => closedAt(e, lookback));
  return list
    .map((e) => {
      const c = now.get(e.asset);
      const p = prev.get(e.asset);
      return {
        asset: e.asset,
        value: c?.value ?? null,
        rank: c?.rank ?? null,
        prevValue: p?.value ?? null,
        prevRank: p?.rank ?? null,
        prevDate: closedAt(e, lookback)?.date ?? null,
        move: c && p ? p.rank - c.rank : null,
        change: c && p ? c.value - p.value : null,
        streak: signStreak(e, metric),
        persistence: e.latest?.persistence ?? null,
        classification: e.classification,
        trend: e.trend,
        status: e.status,
      };
    })
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

/** Differential between the strongest and weakest entities (and top-3 vs bottom-3 averages). */
export function strongWeakSpread(list: StrengthEntity[], metric: Metric) {
  const vals = list
    .map((e) => ({ asset: e.asset, v: val(e.latest, metric) }))
    .filter((x): x is { asset: string; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v);
  if (vals.length < 2) return null;
  const avg = (xs: typeof vals) => xs.reduce((s, x) => s + x.v, 0) / xs.length;
  const k = Math.min(3, Math.floor(vals.length / 2));
  return {
    strongest: vals[0],
    weakest: vals[vals.length - 1],
    spread: vals[0].v - vals[vals.length - 1].v,
    topBottom: avg(vals.slice(0, k)) - avg(vals.slice(-k)),
  };
}

/** Base − quote separation for any metric; composite matches the engine's published pair differential. */
export function separation(list: StrengthEntity[], base: string, quote: string, metric: Metric): number | null {
  const b = val(list.find((e) => e.asset === base)?.latest, metric);
  const q = val(list.find((e) => e.asset === quote)?.latest, metric);
  return b == null || q == null ? null : b - q;
}

export function pairLookup(pairs: RegimePair[]): Map<string, RegimePair> {
  return new Map(pairs.map((p) => [`${p.base}/${p.quote}`, p]));
}

/** Align closed histories by observation date for multi-asset charts. */
export function alignedSeries(list: StrengthEntity[], metric: Metric, from?: string, to?: string) {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const e of list) {
    for (const s of e.closed) {
      if ((from && s.date < from) || (to && s.date > to)) continue;
      const v = val(s, metric);
      if (v == null) continue;
      const row = byDate.get(s.date) ?? { date: s.date };
      row[e.asset] = v;
      byDate.set(s.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export type TrendRead = {
  asset: string;
  start: RegimeSnapshot | null;
  end: RegimeSnapshot | null;
  change: number | null;
  trajectory: 'RISING' | 'FALLING' | 'FLAT' | '—';
  motion: 'ACCELERATING' | 'DECELERATING' | 'STEADY' | '—';
  phase: 'DETERIORATING' | 'RECOVERING' | 'EXTENDING' | 'CONTRACTING' | '—';
  gapStart: number | null;
  gapEnd: number | null;
  convergence: 'CONVERGING' | 'DIVERGING' | '—';
  persistence: number | null;
  streak: number;
};

/**
 * Descriptive read of a window using only persisted engine fields: change of the metric,
 * the sign of momentum vs acceleration, and the macro-vs-current gap at the window edges.
 */
export function trendRead(e: StrengthEntity, metric: Metric, from?: string, to?: string, flat = 0.5): TrendRead {
  const win = e.closed.filter((s) => (!from || s.date >= from) && (!to || s.date <= to));
  const start = win[0] ?? null;
  const end = win.at(-1) ?? null;
  const a = val(start, metric);
  const b = val(end, metric);
  const change = a != null && b != null ? b - a : null;
  const mom = end?.momentum ?? null;
  const acc = end?.acceleration ?? null;
  const comp = end?.composite ?? null;
  const gap = (s: RegimeSnapshot | null) => (s && s.macro != null && s.current != null ? Math.abs(s.macro - s.current) : null);
  const gapStart = gap(start);
  const gapEnd = gap(end);
  return {
    asset: e.asset,
    start,
    end,
    change,
    trajectory: change == null ? '—' : change > flat ? 'RISING' : change < -flat ? 'FALLING' : 'FLAT',
    motion: mom == null || acc == null ? '—' : acc === 0 ? 'STEADY' : Math.sign(acc) === Math.sign(mom) ? 'ACCELERATING' : 'DECELERATING',
    phase:
      comp == null || mom == null
        ? '—'
        : comp > 0 && mom < 0
          ? 'DETERIORATING'
          : comp < 0 && mom > 0
            ? 'RECOVERING'
            : comp >= 0
              ? 'EXTENDING'
              : 'CONTRACTING',
    gapStart,
    gapEnd,
    convergence: gapStart == null || gapEnd == null ? '—' : gapEnd < gapStart ? 'CONVERGING' : 'DIVERGING',
    persistence: end?.persistence ?? null,
    streak: signStreak(e, metric),
  };
}

export type DataState = 'LOADING' | 'DISCONNECTED' | 'ERROR' | 'EMPTY' | 'WARMING_UP' | 'STALE' | 'CURRENT';

export type StrengthFreshness = {
  state: DataState;
  obsDate: string | null;
  obsAgeDays: number | null;
  closed: boolean;
  runAt: string | null;
  runAgeMs: number | null;
  message: string;
};

/** Last D1 close older than this (calendar days) means the engine has missed trading sessions. */
const STALE_OBS_DAYS = 4;

export function strengthFreshness(store: RegimeStoreSnapshot, now = Date.now()): StrengthFreshness {
  const state = store.state;
  const run = state?.run ?? null;
  const latest = state?.assets.map((a) => a.latest).filter((x): x is RegimeSnapshot => !!x) ?? [];
  const obsDate = latest.length ? latest.map((l) => l.date).sort().at(-1)! : null;
  const obsAgeDays = obsDate ? Math.floor((now - Date.parse(`${obsDate}T00:00:00Z`)) / 86_400_000) : null;
  const runAgeMs = regimeRunAgeMs(store, now);
  const base = { obsDate, obsAgeDays, closed: latest.every((l) => l.closed), runAt: run?.runAt ?? null, runAgeMs };
  const unreachable = /unreachable|fetch|network/i.test(store.error);

  if (!state) {
    if (store.loading) return { ...base, state: 'LOADING', message: 'Loading strength snapshots from db_Cacsms-Trader…' };
    return {
      ...base,
      state: unreachable ? 'DISCONNECTED' : 'ERROR',
      message: store.error || 'Strength engine unavailable',
    };
  }
  if (!latest.length) return { ...base, state: 'EMPTY', message: run?.message || 'No strength snapshots persisted yet' };
  if (store.error && unreachable) {
    return { ...base, state: 'DISCONNECTED', message: `Bridge unreachable — showing last persisted strength (${store.error})` };
  }
  const stage = regimeStageStatus(store, now);
  if (stage === 'STALE' || stage === 'BLOCKED' || (obsAgeDays != null && obsAgeDays > STALE_OBS_DAYS)) {
    return {
      ...base,
      state: 'STALE',
      message:
        stage === 'BLOCKED'
          ? `Engine blocked — ${run?.message}. Showing last persisted strength.`
          : `Strength not refreshed — last D1 close ${obsDate}, last run ${run?.runAt ?? 'never'}`,
    };
  }
  if (run?.status === 'WARMING_UP' || state.assets.some((a) => a.status !== 'CLASSIFIED')) {
    return { ...base, state: 'WARMING_UP', message: run?.message || 'Collecting closed observations' };
  }
  return { ...base, state: 'CURRENT', message: run?.message || 'Strength current' };
}

export function strengthTone(v: number | null | undefined): string {
  if (v == null) return 'gray';
  return v > 2 ? 'green' : v < -2 ? 'red' : 'gray';
}

/** Diverging heat colour for a strength value in ±range. */
export function heatColor(v: number | null | undefined, range = STRENGTH_RANGE): string {
  if (v == null || !Number.isFinite(v)) return '#101b2a';
  const t = Math.max(-1, Math.min(1, v / range));
  const a = 0.12 + 0.78 * Math.abs(t);
  return t >= 0 ? `rgba(47, 191, 131, ${a.toFixed(3)})` : `rgba(224, 96, 108, ${a.toFixed(3)})`;
}
