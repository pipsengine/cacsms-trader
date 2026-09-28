import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from 'lucide-react';
import { allPairs } from '../../data/market';
import { Badge, Card, PageHeader, Tabs, tabIds } from '../../components/UI';
import { runRegimeNow, startRegimeStore, useRegimeStore } from '../historical-regime/services/regimeStore';
import { ASSET_COLORS, ago, num, regimeTone, signed } from '../historical-regime/services/regimeFormat';
import { REGIME_ASSETS, type RegimePair } from '../historical-regime/types';
import {
  METRICS,
  METRIC_LABEL,
  METRIC_SHORT,
  STRENGTH_RANGE,
  TF_METRICS,
  alignedSeries,
  entitiesFrom,
  heatColor,
  pairLookup,
  rankRows,
  ranked,
  separation,
  strengthFreshness,
  strongWeakSpread,
  trendRead,
  val,
  type DataState,
  type Metric,
  type StrengthEntity,
  type StrengthFreshness,
} from './services/strengthModel';
import { useStrengthHistory } from './services/strengthHistory';
import '../market-data/market-data.css';
import '../historical-regime/historical-regime.css';
import './currency-strength.css';

const TABS = ['Strength Matrix', 'Rankings', 'Heatmap', 'Trends', 'XAU'] as const;
type TabName = (typeof TABS)[number];
const TAB_KEY = 'cacsms.strength.tab';
const TAB_PREFIX = 'strength';
const ASSETS: readonly string[] = REGIME_ASSETS;

const STATE_TONE: Record<DataState, string> = {
  LOADING: 'blue',
  DISCONNECTED: 'red',
  ERROR: 'red',
  EMPTY: 'gray',
  WARMING_UP: 'amber',
  STALE: 'amber',
  CURRENT: 'green',
};

const chartTooltip = { contentStyle: { background: '#0c1826', border: '1px solid #1d3048', fontSize: 11 } };

function readTab(): TabName {
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    return (TABS as readonly string[]).includes(v ?? '') ? (v as TabName) : 'Strength Matrix';
  } catch {
    return 'Strength Matrix';
  }
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-block">
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

function Score({ v, digits = 2 }: { v: number | null | undefined; digits?: number }) {
  if (v == null) return <span className="muted">—</span>;
  return <span className={v > 0 ? 'positive' : v < 0 ? 'negative' : ''}>{signed(v, digits)}</span>;
}

function ConfBar({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="muted">—</span>;
  const c = v >= 70 ? '#2fbf83' : v >= 45 ? '#e2b04a' : '#e0606c';
  return (
    <div className="hr-conf" title={`Confidence ${v.toFixed(1)}%`}>
      <i style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: c }} />
      <span>{v.toFixed(0)}%</span>
    </div>
  );
}

function Direction({ trend, momentum }: { trend: string; momentum: number | null | undefined }) {
  const Icon = momentum == null || momentum === 0 ? Minus : momentum > 0 ? ArrowUpRight : ArrowDownRight;
  const cls = momentum == null || momentum === 0 ? 'muted' : momentum > 0 ? 'positive' : 'negative';
  return (
    <span className="cs-dir" title={momentum != null ? `Momentum ${signed(momentum)}` : 'Momentum unavailable'}>
      <Icon size={13} className={cls} /> {trend}
    </span>
  );
}

function Fresh({ e }: { e: StrengthEntity }) {
  if (!e.latest) return <span className="muted">no data</span>;
  return (
    <span className="cs-fresh" title={e.latest.updatedAt ? `Persisted ${e.latest.updatedAt}` : undefined}>
      D1 {e.latest.date}
      {e.latest.closed ? '' : <b className="hr-pending"> provisional</b>}
    </span>
  );
}

function classTone(c: string) {
  return c === 'STRONG' ? 'green' : c === 'WEAK' ? 'red' : c === 'NEUTRAL' ? 'gray' : 'amber';
}

function Chips<T extends string>({
  items,
  active,
  onChange,
  label,
  color,
  labelOf,
}: {
  items: readonly T[];
  active: T | T[];
  onChange: (x: T) => void;
  label: string;
  color?: (x: T) => string;
  labelOf?: (x: T) => string;
}) {
  const on = (x: T) => (Array.isArray(active) ? active.includes(x) : active === x);
  return (
    <div className="hr-chips" role="group" aria-label={label}>
      {items.map((x) => (
        <button
          key={x}
          type="button"
          aria-pressed={on(x)}
          className={on(x) ? 'on' : ''}
          style={{ borderColor: color?.(x) ?? '#2c4a68', color: color?.(x) ?? '#b8cce2' }}
          onClick={() => onChange(x)}
        >
          {color && <i style={{ background: color(x) }} />}
          {labelOf ? labelOf(x) : x}
        </button>
      ))}
    </div>
  );
}

function AsOf({ fresh }: { fresh: StrengthFreshness }) {
  return (
    <span className="cs-asof">
      {fresh.obsDate ? `as of D1 ${fresh.obsDate}${fresh.closed ? ' · closed' : ' · provisional'}` : 'no observation'}
      {fresh.state !== 'CURRENT' && <Badge tone={STATE_TONE[fresh.state]}>{fresh.state.replace('_', ' ')}</Badge>}
    </span>
  );
}

/* ───────────────────────── Strength Matrix ───────────────────────── */

function StrengthMatrixTab({ list, fresh }: { list: StrengthEntity[]; fresh: StrengthFreshness }) {
  const byMacro = [...list].filter((e) => e.latest).sort((a, b) => (b.latest?.macro ?? -99) - (a.latest?.macro ?? -99));
  const qm = byMacro.map((e) => ({ code: e.asset, q: e.latest?.q ?? null, m: e.latest?.m ?? null }));
  return (
    <>
      <div className="grid-2">
        <Card>
          <div className="cs-head">
            <h3>Macro Strength Ranking</h3>
            <AsOf fresh={fresh} />
          </div>
          <div className="strength-list">
            {byMacro.map((e, i) => {
              const s = e.latest?.macro ?? 0;
              return (
                <div key={e.asset}>
                  <span className="rank">{i + 1}</span>
                  <b className={e.asset === 'XAU' ? 'hr-gold' : undefined}>{e.asset}</b>
                  <div className="strength-bar">
                    <i className={s >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.min(100, (Math.abs(s) / STRENGTH_RANGE) * 100)}%` }} />
                  </div>
                  <strong className={s >= 0 ? 'positive' : 'negative'}>{signed(s)}</strong>
                  <Badge tone={classTone(e.classification)}>{e.classification}</Badge>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <div className="cs-head">
            <h3>Quarterly vs Monthly</h3>
            <AsOf fresh={fresh} />
          </div>
          <div className="chart-lg">
            <ResponsiveContainer>
              <BarChart data={qm}>
                <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                <XAxis dataKey="code" stroke="#6f859d" fontSize={11} />
                <YAxis stroke="#6f859d" fontSize={11} domain={[-STRENGTH_RANGE, STRENGTH_RANGE]} />
                <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#3a5673" />
                <Bar dataKey="q" name="Quarterly" fill="#5aa9ff" radius={[3, 3, 0, 0]} />
                <Bar dataKey="m" name="Monthly" fill="#61e6aa" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card>
        <div className="cs-head">
          <h3>Strength Matrix · 8 currencies + XAU</h3>
          <span className="muted cs-note">Q+M = macro / strategic bias · W+D = current evolution / change detection</span>
        </div>
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Q</th>
                <th>M</th>
                <th>W</th>
                <th>D</th>
                <th>Macro (Q+M)</th>
                <th>Current (W+D)</th>
                <th>Composite</th>
                <th>Direction</th>
                <th>Confidence</th>
                <th>Classification</th>
                <th>Regime</th>
                <th>Freshness</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.asset} className={e.status !== 'CLASSIFIED' ? 'cs-dim' : undefined}>
                  <td>
                    <b className={e.asset === 'XAU' ? 'hr-gold' : undefined}>{e.asset}</b>
                    {e.kind === 'METAL' && <span className="hr-tag">METAL</span>}
                  </td>
                  {TF_METRICS.map((m) => (
                    <td key={m}>
                      <Score v={val(e.latest, m)} />
                    </td>
                  ))}
                  <td>
                    <Score v={e.latest?.macro} />
                  </td>
                  <td>
                    <Score v={e.latest?.current} />
                  </td>
                  <td>
                    <strong>
                      <Score v={e.latest?.composite} />
                    </strong>
                  </td>
                  <td>
                    <Direction trend={e.trend} momentum={e.latest?.momentum} />
                  </td>
                  <td>
                    <ConfBar v={e.latest?.confidence} />
                  </td>
                  <td>
                    <Badge tone={classTone(e.classification)}>{e.classification}</Badge>
                  </td>
                  <td>
                    {e.latest?.regime ? (
                      <Badge tone={regimeTone(e.latest.regime, e.latest.composite)}>{e.latest.regime}</Badge>
                    ) : (
                      <Badge tone="amber">WARMING UP</Badge>
                    )}
                  </td>
                  <td>
                    <Fresh e={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ───────────────────────── Rankings ───────────────────────── */

const LOOKBACKS = [
  { key: '1', label: '1 day', obs: 1 },
  { key: '5', label: '1 week', obs: 5 },
  { key: '21', label: '1 month', obs: 21 },
] as const;
type LookbackKey = (typeof LOOKBACKS)[number]['key'];

function RankingsTab({ list, fresh }: { list: StrengthEntity[]; fresh: StrengthFreshness }) {
  const [metric, setMetric] = useState<Metric>('composite');
  const [lb, setLb] = useState<LookbackKey>('5');
  const obs = LOOKBACKS.find((l) => l.key === lb)!.obs;
  const rows = useMemo(() => rankRows(list, metric, obs), [list, metric, obs]);
  const sw = strongWeakSpread(list, metric);
  const prevDate = rows.find((r) => r.prevDate)?.prevDate ?? null;
  const rankTable = useMemo(() => METRICS.map((m) => [m, ranked(list, m, (e) => e.closed.at(-1) ?? null)] as const), [list]);
  const lastClosed = rows.length ? list.map((e) => e.closed.at(-1)?.date).filter(Boolean).sort().at(-1) : null;

  return (
    <>
      <div className="cs-controls">
        <Chips items={METRICS} active={metric} onChange={setMetric} label="Ranking metric" labelOf={(m) => METRIC_LABEL[m]} />
        <Chips
          items={LOOKBACKS.map((l) => l.key)}
          active={lb}
          onChange={setLb}
          label="Rank movement lookback"
          labelOf={(k) => `vs ${LOOKBACKS.find((l) => l.key === k)!.label}`}
        />
      </div>
      <div className="metrics">
        <Card className="metric">
          <div className="muted">Strongest · {METRIC_SHORT[metric]}</div>
          <div className="metric-row">
            <strong>{sw?.strongest.asset ?? '—'}</strong>
          </div>
          <small>{sw ? signed(sw.strongest.v) : 'no data'}</small>
        </Card>
        <Card className="metric">
          <div className="muted">Weakest · {METRIC_SHORT[metric]}</div>
          <div className="metric-row">
            <strong>{sw?.weakest.asset ?? '—'}</strong>
          </div>
          <small>{sw ? signed(sw.weakest.v) : 'no data'}</small>
        </Card>
        <Card className="metric">
          <div className="muted">Strong − weak differential</div>
          <div className="metric-row">
            <strong>{sw ? num(sw.spread, 2) : '—'}</strong>
          </div>
          <small>{sw ? `${sw.strongest.asset} vs ${sw.weakest.asset}` : 'no data'}</small>
        </Card>
        <Card className="metric">
          <div className="muted">Top 3 − bottom 3 average</div>
          <div className="metric-row">
            <strong>{sw ? num(sw.topBottom, 2) : '—'}</strong>
          </div>
          <small>basket dispersion</small>
        </Card>
      </div>
      <Card>
        <div className="cs-head">
          <h3>{METRIC_LABEL[metric]} ranking · strongest → weakest</h3>
          <span className="cs-asof">
            closed D1 {lastClosed ?? '—'} vs {prevDate ?? 'insufficient history'}
            {fresh.state !== 'CURRENT' && <Badge tone={STATE_TONE[fresh.state]}>{fresh.state.replace('_', ' ')}</Badge>}
          </span>
        </div>
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Asset</th>
                <th>Strength</th>
                <th>Previous</th>
                <th>Movement</th>
                <th>Change</th>
                <th title="Consecutive closed observations with the same sign">Sign persistence</th>
                <th title="Engine persistence of the current regime">Regime persistence</th>
                <th>Classification</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset} className={r.status !== 'CLASSIFIED' ? 'cs-dim' : undefined}>
                  <td className="rank">{r.rank ?? '—'}</td>
                  <td>
                    <b className={r.asset === 'XAU' ? 'hr-gold' : undefined}>{r.asset}</b>
                  </td>
                  <td>
                    <div className="cs-barcell">
                      <div className="strength-bar">
                        <i
                          className={(r.value ?? 0) >= 0 ? 'pos' : 'neg'}
                          style={{ width: `${Math.min(100, (Math.abs(r.value ?? 0) / STRENGTH_RANGE) * 100)}%` }}
                        />
                      </div>
                      <Score v={r.value} />
                    </div>
                  </td>
                  <td>
                    {r.prevRank != null ? (
                      <span>
                        #{r.prevRank} <span className="muted">({signed(r.prevValue)})</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.move == null ? (
                      <span className="muted">—</span>
                    ) : r.move > 0 ? (
                      <span className="positive cs-dir">
                        <ArrowUpRight size={13} /> {r.move}
                      </span>
                    ) : r.move < 0 ? (
                      <span className="negative cs-dir">
                        <ArrowDownRight size={13} /> {Math.abs(r.move)}
                      </span>
                    ) : (
                      <span className="muted cs-dir">
                        <Minus size={13} /> 0
                      </span>
                    )}
                  </td>
                  <td>
                    <Score v={r.change} />
                  </td>
                  <td>{r.streak ? `${r.streak} obs` : '—'}</td>
                  <td>{r.persistence != null ? `${r.persistence.toFixed(0)}%` : '—'}</td>
                  <td>
                    <Badge tone={classTone(r.classification)}>{r.classification}</Badge>
                  </td>
                  <td>{r.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <div className="cs-head">
          <h3>Rank by timeframe</h3>
          <span className="muted cs-note">Position 1 = strongest for that horizon (closed D1)</span>
        </div>
        <div className="table-wrap">
          <table className="cs-table cs-center">
            <thead>
              <tr>
                <th>Asset</th>
                {METRICS.map((m) => (
                  <th key={m}>{METRIC_SHORT[m]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.asset}>
                  <td>
                    <b className={e.asset === 'XAU' ? 'hr-gold' : undefined}>{e.asset}</b>
                  </td>
                  {rankTable.map(([m, map]) => {
                    const r = map.get(e.asset);
                    return (
                      <td key={m} style={{ background: r ? heatColor(((map.size + 1) / 2 - r.rank) * (STRENGTH_RANGE / 4)) : undefined }}>
                        {r?.rank ?? '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ───────────────────────── Heatmap ───────────────────────── */

const HEAT_METRICS: Metric[] = ['q', 'm', 'w', 'd', 'macro', 'current', 'composite'];
const TRADABLE = new Set<string>(allPairs);

function HeatmapTab({ list, pairs, fresh }: { list: StrengthEntity[]; pairs: RegimePair[]; fresh: StrengthFreshness }) {
  const [metric, setMetric] = useState<Metric>('composite');
  const [focus, setFocus] = useState<{ base: string; quote: string } | null>(null);
  const [entityFocus, setEntityFocus] = useState<string | null>(null);
  const pairMap = useMemo(() => pairLookup(pairs), [pairs]);
  const assets = ASSETS;

  const opportunities = useMemo(
    () =>
      allPairs
        .map((symbol) => {
          const base = symbol.slice(0, 3);
          const quote = symbol.slice(3, 6);
          return { symbol, base, quote, sep: separation(list, base, quote, metric), pair: pairMap.get(`${base}/${quote}`) };
        })
        .sort((a, b) => Math.abs(b.sep ?? 0) - Math.abs(a.sep ?? 0)),
    [list, metric, pairMap],
  );
  const focused = focus ? pairMap.get(`${focus.base}/${focus.quote}`) : undefined;
  const focusSep = focus ? separation(list, focus.base, focus.quote, metric) : null;
  const ent = entityFocus ? list.find((e) => e.asset === entityFocus) : undefined;

  return (
    <>
      <Card>
        <div className="cs-head">
          <h3>Strength heatmap · Q / M / W / D</h3>
          <AsOf fresh={fresh} />
        </div>
        <div className="table-wrap">
          <table className="cs-heat">
            <thead>
              <tr>
                <th>Asset</th>
                {HEAT_METRICS.map((m) => (
                  <th key={m}>{METRIC_SHORT[m]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.asset}>
                  <th>
                    <button type="button" className="cs-link" onClick={() => setEntityFocus(entityFocus === e.asset ? null : e.asset)}>
                      <span className={e.asset === 'XAU' ? 'hr-gold' : undefined}>{e.asset}</span>
                    </button>
                  </th>
                  {HEAT_METRICS.map((m) => {
                    const v = val(e.latest, m);
                    return (
                      <td
                        key={m}
                        style={{ background: heatColor(v) }}
                        title={`${e.asset} ${METRIC_LABEL[m]} ${signed(v)} · D1 ${e.latest?.date ?? '—'}${e.latest?.closed ? '' : ' (provisional)'}`}
                        className={entityFocus === e.asset ? 'cs-sel' : undefined}
                      >
                        {signed(v, 1)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ent && (
          <div className="cs-detail">
            <b className={ent.asset === 'XAU' ? 'hr-gold' : undefined}>{ent.asset}</b>
            <span>
              Macro <Score v={ent.latest?.macro} /> · Current <Score v={ent.latest?.current} /> · Composite <Score v={ent.latest?.composite} />
            </span>
            <span>
              {ent.classification} · {ent.trend} · regime {ent.latest?.regime ?? 'warming up'}
            </span>
            <Fresh e={ent} />
          </div>
        )}
      </Card>

      <Card>
        <div className="cs-head">
          <h3>Pair opportunity heatmap · base − quote separation</h3>
          <Chips items={HEAT_METRICS} active={metric} onChange={setMetric} label="Separation metric" labelOf={(m) => METRIC_SHORT[m]} />
        </div>
        <p className="muted cs-note">
          Row = base, column = quote. Green = strong base over weak quote (greater separation). Bold cells are the 28 FX pairs + XAUUSD;
          dimmed cells are the inverse orientation. Descriptive only — no trades are generated here.
        </p>
        <div className="table-wrap">
          <table className="cs-heat cs-pairs">
            <thead>
              <tr>
                <th>Base \ Quote</th>
                {assets.map((q) => (
                  <th key={q} className={q === 'XAU' ? 'hr-gold' : undefined}>
                    {q}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((b) => (
                <tr key={b}>
                  <th className={b === 'XAU' ? 'hr-gold' : undefined}>{b}</th>
                  {assets.map((q) => {
                    if (b === q) return <td key={q} className="cs-diag" />;
                    const sep = separation(list, b, q, metric);
                    const tradable = TRADABLE.has(`${b}${q}`);
                    const sel = focus?.base === b && focus?.quote === q;
                    return (
                      <td
                        key={q}
                        style={{ background: heatColor(sep, STRENGTH_RANGE * 1.5) }}
                        className={`${tradable ? 'cs-trad' : 'cs-inv'}${sel ? ' cs-sel' : ''}`}
                        title={`${b}${q} ${METRIC_LABEL[metric]} separation ${signed(sep)}`}
                      >
                        <button type="button" className="cs-cellbtn" onClick={() => setFocus(sel ? null : { base: b, quote: q })}>
                          {signed(sep, 1)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {focus && (
          <div className="cs-detail">
            <b>
              {focus.base}
              {focus.quote}
            </b>
            <span>
              {METRIC_LABEL[metric]} separation <Score v={focusSep} />
            </span>
            {focused ? (
              <span>
                Engine: <Badge tone={focused.bias === 'BULLISH' ? 'green' : focused.bias === 'BEARISH' ? 'red' : 'gray'}>{focused.bias}</Badge>{' '}
                differential {signed(focused.differential)} · conviction {num(focused.conviction, 0)} · confidence {num(focused.confidence, 0, '%')} ·{' '}
                {focused.relationship.replace('_', ' ')}
              </span>
            ) : (
              <span className="muted">
                Not a monitored orientation — engine pair intelligence exists for {focus.quote}
                {focus.base}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="cs-head">
          <h3>Instrument separation · 28 FX + XAUUSD</h3>
          <span className="muted cs-note">Sorted by absolute {METRIC_LABEL[metric].toLowerCase()} separation</span>
        </div>
        <div className="cs-opps">
          {opportunities.map((o) => (
            <button
              type="button"
              key={o.symbol}
              className={`cs-opp${focus?.base === o.base && focus?.quote === o.quote ? ' on' : ''}`}
              style={{ background: heatColor(o.sep, STRENGTH_RANGE * 1.5) }}
              onClick={() => setFocus({ base: o.base, quote: o.quote })}
              title={o.pair?.reason ?? undefined}
            >
              <b className={o.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{o.symbol}</b>
              <span>{signed(o.sep, 2)}</span>
              <small>{o.pair ? (o.pair.status === 'READY' ? o.pair.bias : 'WARMING UP') : 'NO DATA'}</small>
            </button>
          ))}
        </div>
      </Card>
    </>
  );
}

/* ───────────────────────── Trends ───────────────────────── */

const RANGES = [
  { key: '1M', obs: 21 },
  { key: '3M', obs: 63 },
  { key: '6M', obs: 126 },
  { key: '1Y', obs: 252 },
  { key: 'ALL', obs: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'] | 'CUSTOM';

function useDateBounds(list: StrengthEntity[]) {
  return useMemo(() => {
    const dates = [...new Set(list.flatMap((e) => e.closed.map((s) => s.date)))].sort();
    return { dates, first: dates[0] ?? '', last: dates.at(-1) ?? '' };
  }, [list]);
}

function HistoryNote({ loading, error, depth }: { loading: boolean; error: string; depth: number }) {
  if (error) return <span className="negative cs-note">Full history unavailable ({error}) — showing {depth} store observations</span>;
  if (loading) return <span className="muted cs-note">Loading persisted history…</span>;
  return <span className="muted cs-note">{depth} closed D1 snapshots · dbo.app_regime_snapshot</span>;
}

function TrendsTab({ list, fresh, hist }: { list: StrengthEntity[]; fresh: StrengthFreshness; hist: ReturnType<typeof useStrengthHistory> }) {
  const [selected, setSelected] = useState<string[]>(['USD', 'EUR', 'JPY', 'XAU']);
  const [metric, setMetric] = useState<Metric>('composite');
  const [range, setRange] = useState<RangeKey>('6M');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const bounds = useDateBounds(list);
  const [focus, setFocus] = useState('USD');

  const from =
    range === 'CUSTOM'
      ? custom.from || bounds.first
      : range === 'ALL'
        ? bounds.first
        : bounds.dates[Math.max(0, bounds.dates.length - RANGES.find((r) => r.key === range)!.obs)] ?? bounds.first;
  const to = range === 'CUSTOM' ? custom.to || bounds.last : bounds.last;

  const shown = list.filter((e) => selected.includes(e.asset));
  const data = useMemo(() => alignedSeries(shown, metric, from, to), [shown, metric, from, to]);
  const reads = useMemo(() => shown.map((e) => trendRead(e, metric, from, to)), [shown, metric, from, to]);
  const focusEntity = list.find((e) => e.asset === focus);
  const focusData = useMemo(
    () =>
      (focusEntity?.closed ?? [])
        .filter((s) => s.date >= from && s.date <= to)
        .map((s) => ({ date: s.date, macro: s.macro, current: s.current, momentum: s.momentum, acceleration: s.acceleration })),
    [focusEntity, from, to],
  );
  const toggle = (a: string) => setSelected((s) => (s.includes(a) ? (s.length > 1 ? s.filter((x) => x !== a) : s) : [...s, a]));

  return (
    <>
      <Card>
        <div className="cs-controls">
          <Chips items={ASSETS} active={selected} onChange={toggle} label="Assets" color={(a) => ASSET_COLORS[a]} />
          <Chips items={METRICS} active={metric} onChange={setMetric} label="Timeframe" labelOf={(m) => METRIC_LABEL[m]} />
        </div>
        <div className="cs-controls">
          <Chips
            items={[...RANGES.map((r) => r.key), 'CUSTOM'] as RangeKey[]}
            active={range}
            onChange={setRange}
            label="Date range"
            labelOf={(k) => (k === 'CUSTOM' ? 'Custom' : k === 'ALL' ? 'All' : k)}
          />
          {range === 'CUSTOM' && (
            <div className="cs-dates">
              <label>
                From
                <input
                  type="date"
                  min={bounds.first}
                  max={custom.to || bounds.last}
                  value={custom.from || bounds.first}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  min={custom.from || bounds.first}
                  max={bounds.last}
                  value={custom.to || bounds.last}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                />
              </label>
            </div>
          )}
          <HistoryNote loading={hist.loading} error={hist.error} depth={bounds.dates.length} />
        </div>
      </Card>

      <Card>
        <div className="cs-head">
          <h3>
            {METRIC_LABEL[metric]} trajectory · {from || '—'} → {to || '—'}
          </h3>
          <AsOf fresh={fresh} />
        </div>
        {data.length < 2 ? (
          <Empty title="Not enough persisted history" detail="Widen the date range — no snapshot is interpolated or fabricated." />
        ) : (
          <div className="chart-lg">
            <ResponsiveContainer>
              <LineChart data={data}>
                <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#6f859d" fontSize={10} minTickGap={28} />
                <YAxis stroke="#6f859d" fontSize={11} domain={[-STRENGTH_RANGE, STRENGTH_RANGE]} />
                <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#3a5673" />
                {shown.map((e) => (
                  <Line key={e.asset} type="monotone" dataKey={e.asset} stroke={ASSET_COLORS[e.asset]} dot={false} strokeWidth={e.asset === 'XAU' ? 2.4 : 1.6} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <div className="cs-head">
          <h3>Trend analytics · previous vs current</h3>
          <span className="muted cs-note">Window start vs end on persisted closed snapshots</span>
        </div>
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Previous</th>
                <th>Current</th>
                <th>Change</th>
                <th>Trajectory</th>
                <th>Acceleration</th>
                <th>Phase</th>
                <th title="|Macro − Current| at window start → end">Macro/current gap</th>
                <th>Convergence</th>
                <th>Persistence</th>
              </tr>
            </thead>
            <tbody>
              {reads.map((r) => (
                <tr key={r.asset} className={focus === r.asset ? 'cs-focus' : undefined}>
                  <td>
                    <button type="button" className="cs-link" onClick={() => setFocus(r.asset)} style={{ color: ASSET_COLORS[r.asset] }}>
                      {r.asset}
                    </button>
                  </td>
                  <td>
                    <Score v={val(r.start, metric)} /> <span className="muted">{r.start?.date ?? ''}</span>
                  </td>
                  <td>
                    <Score v={val(r.end, metric)} /> <span className="muted">{r.end?.date ?? ''}</span>
                  </td>
                  <td>
                    <Score v={r.change} />
                  </td>
                  <td>
                    <Badge tone={r.trajectory === 'RISING' ? 'green' : r.trajectory === 'FALLING' ? 'red' : 'gray'}>{r.trajectory}</Badge>
                  </td>
                  <td>
                    <Badge tone={r.motion === 'ACCELERATING' ? 'blue' : r.motion === 'DECELERATING' ? 'amber' : 'gray'}>{r.motion}</Badge>
                  </td>
                  <td>
                    <Badge
                      tone={r.phase === 'RECOVERING' || r.phase === 'EXTENDING' ? 'green' : r.phase === 'DETERIORATING' || r.phase === 'CONTRACTING' ? 'red' : 'gray'}
                    >
                      {r.phase}
                    </Badge>
                  </td>
                  <td>
                    {num(r.gapStart, 2)} → {num(r.gapEnd, 2)}
                  </td>
                  <td>
                    <Badge tone={r.convergence === 'CONVERGING' ? 'green' : r.convergence === 'DIVERGING' ? 'amber' : 'gray'}>{r.convergence}</Badge>
                  </td>
                  <td>
                    {r.persistence != null ? `${r.persistence.toFixed(0)}%` : '—'} <span className="muted">· {r.streak} obs same sign</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="cs-head">
          <h3>
            <span style={{ color: ASSET_COLORS[focus] }}>{focus}</span> · macro vs current convergence / divergence
          </h3>
          <Chips items={ASSETS} active={focus} onChange={setFocus} label="Focus asset" color={(a) => ASSET_COLORS[a]} />
        </div>
        {focusData.length < 2 ? (
          <Empty title="Not enough persisted history" detail="No observations in the selected window." />
        ) : (
          <div className="grid-2 cs-even">
            <div className="chart-md">
              <ResponsiveContainer>
                <LineChart data={focusData}>
                  <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6f859d" fontSize={10} minTickGap={28} />
                  <YAxis stroke="#6f859d" fontSize={11} domain={[-STRENGTH_RANGE, STRENGTH_RANGE]} />
                  <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#3a5673" />
                  <Line type="monotone" dataKey="macro" name="Macro (Q+M)" stroke="#5aa9ff" dot={false} strokeWidth={1.8} />
                  <Line type="monotone" dataKey="current" name="Current (W+D)" stroke="#ff9f5a" dot={false} strokeWidth={1.8} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-md">
              <ResponsiveContainer>
                <LineChart data={focusData}>
                  <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#6f859d" fontSize={10} minTickGap={28} />
                  <YAxis stroke="#6f859d" fontSize={11} />
                  <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#3a5673" />
                  <Line type="monotone" dataKey="momentum" name="Momentum" stroke="#61e6aa" dot={false} strokeWidth={1.6} />
                  <Line type="monotone" dataKey="acceleration" name="Acceleration" stroke="#c38bff" dot={false} strokeWidth={1.4} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

/* ───────────────────────── XAU ───────────────────────── */

function XauTab({ list, pairs, fresh, hist }: { list: StrengthEntity[]; pairs: RegimePair[]; fresh: StrengthFreshness; hist: ReturnType<typeof useStrengthHistory> }) {
  const [range, setRange] = useState<RangeKey>('6M');
  const xau = list.find((e) => e.asset === 'XAU');
  const usd = list.find((e) => e.asset === 'USD');
  const pair = pairs.find((p) => p.symbol === 'XAUUSD');
  const bounds = useDateBounds(list.filter((e) => e.asset === 'XAU' || e.asset === 'USD'));
  const obs = RANGES.find((r) => r.key === range)?.obs ?? 0;
  const from = obs ? bounds.dates[Math.max(0, bounds.dates.length - obs)] ?? bounds.first : bounds.first;
  const read = xau ? trendRead(xau, 'composite', from, bounds.last) : null;

  const series = useMemo(() => {
    const u = new Map((usd?.closed ?? []).map((s) => [s.date, s]));
    return (xau?.closed ?? [])
      .filter((s) => s.date >= from)
      .map((s) => {
        const us = u.get(s.date);
        return {
          date: s.date,
          XAU: s.composite,
          USD: us?.composite ?? null,
          differential: s.composite != null && us?.composite != null ? s.composite - us.composite : null,
          momentum: s.momentum,
        };
      });
  }, [xau, usd, from]);

  if (!xau?.latest) return <Card><Empty title="No XAU strength" detail="XAU has no persisted snapshot yet." /></Card>;
  const l = xau.latest;
  const diffNow = l.composite != null && usd?.latest?.composite != null ? l.composite - usd.latest.composite : null;
  const tf = TF_METRICS.map((m) => ({ tf: METRIC_SHORT[m], v: val(l, m) }));

  return (
    <>
      <div className="hr-banner">
        <span>
          <b className="hr-gold">XAU</b> is treated as a monetary metal, not a fiat currency: its strength is measured against the equal-weight
          8-currency basket and normalised with its own volatility rather than the pooled fiat volatility.
        </span>
      </div>
      <div className="metrics">
        <Card className="metric">
          <div className="muted">Composite strength</div>
          <div className="metric-row">
            <strong className={(l.composite ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(l.composite)}</strong>
          </div>
          <small>
            D1 {l.date}
            {l.closed ? ' · closed' : ' · provisional'}
          </small>
        </Card>
        <Card className="metric">
          <div className="muted">Macro regime (Q+M)</div>
          <div className="metric-row">
            <strong className={(l.macro ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(l.macro)}</strong>
          </div>
          <small>
            <Badge tone={classTone(xau.classification)}>{xau.classification}</Badge>
          </small>
        </Card>
        <Card className="metric">
          <div className="muted">Current regime (W+D)</div>
          <div className="metric-row">
            <strong className={(l.current ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(l.current)}</strong>
          </div>
          <small>
            {l.regime ? <Badge tone={regimeTone(l.regime, l.composite)}>{l.regime}</Badge> : <Badge tone="amber">WARMING UP</Badge>}{' '}
            {xau.trend}
          </small>
        </Card>
        <Card className="metric">
          <div className="muted">XAU − USD differential</div>
          <div className="metric-row">
            <strong className={(diffNow ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(diffNow)}</strong>
          </div>
          <small>USD composite {signed(usd?.latest?.composite)}</small>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <div className="cs-head">
            <h3>XAUUSD directional intelligence</h3>
            <AsOf fresh={fresh} />
          </div>
          {!pair ? (
            <Empty title="No XAUUSD pair output" detail="The engine has not published XAUUSD intelligence yet." />
          ) : (
            <div className="kv cs-kv">
              <span>Directional bias</span>
              <b>
                {pair.status === 'READY' ? (
                  <Badge tone={pair.bias === 'BULLISH' ? 'green' : pair.bias === 'BEARISH' ? 'red' : 'gray'}>{pair.bias}</Badge>
                ) : (
                  <Badge tone="amber">WARMING UP</Badge>
                )}
              </b>
              <span>Differential (XAU − USD composite)</span>
              <b>
                <Score v={pair.differential} />
              </b>
              <span>Conviction</span>
              <b>{num(pair.conviction, 1)}</b>
              <span>Confidence</span>
              <b>
                <ConfBar v={pair.confidence} />
              </b>
              <span>Persistence</span>
              <b>{num(pair.persistence, 0, '%')}</b>
              <span>Relationship</span>
              <b className="hr-rel">{pair.relationship.replace('_', ' ')}</b>
              <span>Regimes (XAU · USD)</span>
              <b>
                {pair.baseRegime ?? '—'} · {pair.quoteRegime ?? '—'}
              </b>
              <span>Freshness</span>
              <b>
                D1 {pair.date ?? '—'} · updated {pair.updatedAt ? ago(Date.now() - Date.parse(pair.updatedAt)) : '—'}
              </b>
              {pair.reason && (
                <>
                  <span>Reason</span>
                  <b className="cs-reason">{pair.reason}</b>
                </>
              )}
            </div>
          )}
        </Card>
        <Card>
          <div className="cs-head">
            <h3>XAU strength by timeframe</h3>
            <span className="muted cs-note">confidence {num(l.confidence, 0, '%')}</span>
          </div>
          <div className="chart-md">
            <ResponsiveContainer>
              <BarChart data={tf}>
                <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                <XAxis dataKey="tf" stroke="#6f859d" fontSize={11} />
                <YAxis stroke="#6f859d" fontSize={11} domain={[-STRENGTH_RANGE, STRENGTH_RANGE]} />
                <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                <ReferenceLine y={0} stroke="#3a5673" />
                <Bar dataKey="v" name="Strength" radius={[3, 3, 0, 0]}>
                  {tf.map((x) => (
                    <Cell key={x.tf} fill={(x.v ?? 0) >= 0 ? '#2fbf83' : '#e0606c'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <div className="cs-head">
          <h3>XAU vs USD trajectory</h3>
          <Chips items={RANGES.map((r) => r.key)} active={range as (typeof RANGES)[number]['key']} onChange={setRange} label="XAU range" labelOf={(k) => (k === 'ALL' ? 'All' : k)} />
        </div>
        <HistoryNote loading={hist.loading} error={hist.error} depth={xau.closed.length} />
        {series.length < 2 ? (
          <Empty title="Not enough persisted history" detail="No XAU observations in the selected window." />
        ) : (
          <div className="chart-lg">
            <ResponsiveContainer>
              <LineChart data={series}>
                <CartesianGrid stroke="#17304a" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#6f859d" fontSize={10} minTickGap={28} />
                <YAxis stroke="#6f859d" fontSize={11} />
                <Tooltip {...chartTooltip} formatter={(v) => (typeof v === 'number' ? signed(v) : String(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#3a5673" />
                <Line type="monotone" dataKey="XAU" name="XAU composite" stroke={ASSET_COLORS.XAU} dot={false} strokeWidth={2.2} />
                <Line type="monotone" dataKey="USD" name="USD composite" stroke={ASSET_COLORS.USD} dot={false} strokeWidth={1.6} />
                <Line type="monotone" dataKey="differential" name="XAU − USD" stroke="#c38bff" dot={false} strokeDasharray="4 3" strokeWidth={1.6} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {read && (
          <div className="cs-detail">
            <span>
              Trajectory <Badge tone={read.trajectory === 'RISING' ? 'green' : read.trajectory === 'FALLING' ? 'red' : 'gray'}>{read.trajectory}</Badge>
            </span>
            <span>
              Acceleration <Badge tone={read.motion === 'ACCELERATING' ? 'blue' : read.motion === 'DECELERATING' ? 'amber' : 'gray'}>{read.motion}</Badge>{' '}
              <span className="muted">
                momentum {signed(l.momentum)} · accel {signed(l.acceleration)}
              </span>
            </span>
            <span>
              Phase <Badge tone={read.phase === 'RECOVERING' || read.phase === 'EXTENDING' ? 'green' : 'red'}>{read.phase}</Badge>
            </span>
            <span>
              Persistence {num(l.persistence, 0, '%')} · {read.streak} obs same sign · regime {l.durationObs} obs
            </span>
            <span>
              Window change <Score v={read.change} /> ({read.start?.date} → {read.end?.date})
            </span>
          </div>
        )}
      </Card>
    </>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export function CurrencyStrengthPage() {
  const store = useRegimeStore();
  const [tab, setTabState] = useState<TabName>(readTab);
  const [now, setNow] = useState(Date.now());

  useEffect(() => startRegimeStore(), []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const setTab = (x: string) => {
    if (!(TABS as readonly string[]).includes(x)) return;
    setTabState(x as TabName);
    try {
      window.localStorage.setItem(TAB_KEY, x);
    } catch {
      /* storage unavailable — selection still held in state */
    }
  };

  const needsHistory = tab === 'Trends' || tab === 'XAU';
  const hist = useStrengthHistory(needsHistory ? store.state?.run?.runAt : null);
  const fresh = strengthFreshness(store, now);
  const list = useMemo(() => entitiesFrom(store.state), [store.state]);
  const deepList = useMemo(() => entitiesFrom(store.state, hist.histories ?? undefined), [store.state, hist.histories]);
  const pairs = store.state?.pairs ?? [];
  const warming = list.filter((e) => e.status !== 'CLASSIFIED');
  const ids = tabIds(TAB_PREFIX, tab);
  const hasData = list.some((e) => e.latest);

  return (
    <>
      <PageHeader title="Currency & XAU Strength" subtitle="Stage 2 · Q/M/W/D strength, macro vs current evolution and normalized XAU intelligence" />
      <div className="hr-status">
        <Badge tone={STATE_TONE[fresh.state]}>STAGE 2 · {fresh.state.replace('_', ' ')}</Badge>
        <span>{fresh.message}</span>
        <span className="muted">
          Last engine run {ago(fresh.runAgeMs)}
          {fresh.obsDate ? ` · latest D1 ${fresh.obsDate}${fresh.closed ? ' (closed)' : ' (provisional)'}` : ''} · published to Historical Regime & Market
          Scanner
        </span>
        <button type="button" className="hr-run" title="Diagnostic reprocess. The bridge already runs this from candle events and will not bypass freshness or downstream gates." onClick={() => void runRegimeNow()} disabled={store.running}>
          <RefreshCw size={13} className={store.running ? 'hr-spin' : ''} /> {store.running ? 'Running…' : 'Run now'}
        </button>
      </div>

      {(fresh.state === 'DISCONNECTED' || fresh.state === 'ERROR') && hasData && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{fresh.message}. Values below are the last persisted snapshot, not live.</span>
        </div>
      )}
      {fresh.state === 'STALE' && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>{fresh.message}. Treat every score, ranking and heatmap as outdated.</span>
        </div>
      )}
      {warming.length > 0 && hasData && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>
            Warming up: {warming.map((e) => e.asset).join(', ')} — values are shown dimmed and no classification is published until enough closed
            observations exist.
          </span>
        </div>
      )}

      <Tabs items={[...TABS]} active={tab} onChange={setTab} idPrefix={TAB_PREFIX} label="Currency strength views" />

      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="cs-panel" data-tab={tab}>
        {!hasData ? (
          <Card>
            {fresh.state === 'LOADING' ? (
              <Empty title="Loading strength engine" detail="Reading persisted Stage 2 snapshots from db_Cacsms-Trader…" />
            ) : fresh.state === 'DISCONNECTED' || fresh.state === 'ERROR' ? (
              <Empty title="Strength engine unavailable" detail={`${fresh.message} — start the MT5 bridge (npm run mt5:bridge).`} />
            ) : (
              <Empty title="No strength snapshots" detail={fresh.message || 'Awaiting the first closed D1 observations from MT5.'} />
            )}
          </Card>
        ) : tab === 'Strength Matrix' ? (
          <StrengthMatrixTab list={list} fresh={fresh} />
        ) : tab === 'Rankings' ? (
          <RankingsTab list={list} fresh={fresh} />
        ) : tab === 'Heatmap' ? (
          <HeatmapTab list={list} pairs={pairs} fresh={fresh} />
        ) : tab === 'Trends' ? (
          <TrendsTab list={deepList} fresh={fresh} hist={hist} />
        ) : (
          <XauTab list={deepList} pairs={pairs} fresh={fresh} hist={hist} />
        )}
      </div>
    </>
  );
}
