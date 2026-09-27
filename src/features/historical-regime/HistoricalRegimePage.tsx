import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, RefreshCw, Search, X } from 'lucide-react';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import {
  REGIME_ASSETS,
  REGIME_NAMES,
  type RegimeAssetState,
  type RegimeName,
  type RegimePair,
  type RegimeSnapshot,
  type RegimeTransition,
} from './types';
import { fetchRegimeHistory } from './services/regimeClient';
import {
  REGIME_INTERVAL_MS,
  regimeRunAgeMs,
  regimeStageStatus,
  runRegimeNow,
  startRegimeStore,
  useRegimeStore,
} from './services/regimeStore';
import {
  ASSET_COLORS,
  REGIME_HELP,
  ago,
  num,
  regimeColor,
  regimeGroup,
  regimeTone,
  signed,
  stageTone,
  timelineSegments,
} from './services/regimeFormat';
import '../market-data/market-data.css';
import './historical-regime.css';

const TOOLTIP_STYLE = { background: '#0b1626', border: '1px solid #1d3048', borderRadius: 8, fontSize: 11 };
const DAY_MS = 86_400_000;
const fmtTip = (v: unknown) => (typeof v === 'number' ? signed(v) : String(v ?? '—'));

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-block">
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

function RegimeBadge({ regime, s }: { regime: RegimeName | null | undefined; s?: number | null }) {
  if (!regime) return <Badge tone="blue">WARMING UP</Badge>;
  return (
    <span title={REGIME_HELP[regime]}>
      <Badge tone={regimeTone(regime, s)}>{regime.toUpperCase()}</Badge>
    </span>
  );
}

function ConfBar({ value }: { value: number | null | undefined }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="hr-conf" title={value == null ? 'No confidence yet' : `${v.toFixed(1)}%`}>
      <i style={{ width: `${v}%`, background: v >= 50 ? '#2fbf83' : v >= 25 ? '#e2b04a' : '#e0606c' }} />
      <span>{value == null ? '—' : `${v.toFixed(0)}%`}</span>
    </div>
  );
}

function StrengthCell({ v }: { v: number | null | undefined }) {
  return <td className={v == null ? '' : v >= 0 ? 'positive' : 'negative'}>{signed(v)}</td>;
}

/* ------------------------------------------------------------------ asset drawer */

function AssetDrawer({
  asset,
  transitions,
  onClose,
  onTransition,
}: {
  asset: RegimeAssetState;
  transitions: RegimeTransition[];
  onClose: () => void;
  onTransition: (t: RegimeTransition) => void;
}) {
  const [history, setHistory] = useState<RegimeSnapshot[]>(asset.history);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const l = asset.latest;

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setErr('');
    fetchRegimeHistory(asset.asset, 260)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'History unavailable');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.asset, asset.latest?.updatedAt]);

  const segments = useMemo(() => timelineSegments(history), [history]);
  const closedCount = segments.reduce((a, s) => a + s.count, 0);
  const contributions = l
    ? [
        { tf: 'Quarterly', v: l.q },
        { tf: 'Monthly', v: l.m },
        { tf: 'Weekly', v: l.w },
        { tf: 'Daily', v: l.d },
      ]
    : [];
  const chart = history.map((h) => ({
    date: h.date,
    composite: h.composite,
    macro: h.macro,
    current: h.current,
    provisional: h.closed ? null : h.composite,
  }));
  const accel = l?.acceleration;

  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>{asset.kind === 'METAL' ? 'METAL REGIME · XAU' : 'CURRENCY REGIME'}</small>
            <h2>
              {asset.asset} <RegimeBadge regime={l?.regime} s={l?.composite} />
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          {asset.status !== 'CLASSIFIED' && (
            <div className="hr-banner warn">
              <AlertTriangle size={14} />
              <span>
                Warming up — {asset.observations.collected}/{asset.observations.required} closed observations
                {asset.bars.collected != null && asset.bars.required != null
                  ? ` · ${asset.bars.collected}/${asset.bars.required} D1 bars`
                  : ''}
                . No classification is published until the requirement is met.
              </span>
            </div>
          )}
          <div className="md-kpi">
            <div title="Composite strength (±10) from weighted Q/M/W/D, EMA-smoothed">
              <span>Current strength</span>
              <b className={(l?.composite ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(l?.composite)}</b>
            </div>
            <div title="Composite at the previous observation">
              <span>Previous</span>
              <b>{signed(l?.previous)}</b>
            </div>
            <div title="Change of composite over the momentum lag">
              <span>Momentum</span>
              <b className={(l?.momentum ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(l?.momentum)}</b>
            </div>
            <div title="Regime confidence — recent observations agreeing with the confirmed regime">
              <span>Confidence</span>
              <b>{num(l?.confidence, 1, '%')}</b>
            </div>
          </div>
          <div className="md-kpi">
            <div title="Change of momentum — positive means accelerating, negative decelerating">
              <span>{accel == null ? 'Acceleration' : accel >= 0 ? 'Accelerating' : 'Decelerating'}</span>
              <b className={(accel ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(accel)}</b>
            </div>
            <div title="Closed observations since the regime was first seen">
              <span>Duration</span>
              <b>{l ? `${l.durationObs} obs` : '—'}</b>
            </div>
            <div title="Share of the last 20 observations in the same directional group">
              <span>Persistence</span>
              <b>{num(l?.persistence, 0, '%')}</b>
            </div>
            <div title="Regime start date">
              <span>Since</span>
              <b>{l?.regimeSince ?? '—'}</b>
            </div>
          </div>
          {l?.candidate && (
            <div className="hr-banner">
              <span>
                Challenger <b>{l.candidate}</b> seen {l.candidateCount}× since {l.candidateSince ?? '—'} — pending confirmation
                (raw observation: {l.rawRegime ?? '—'}).
              </span>
            </div>
          )}

          <h4 className="hr-sub">Timeframe contributions (±10)</h4>
          {contributions.length ? (
            <div style={{ height: 150 }}>
              <ResponsiveContainer>
                <BarChart data={contributions} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1d3048" />
                  <XAxis type="number" domain={[-10, 10]} stroke="#6f859b" fontSize={10} />
                  <YAxis type="category" dataKey="tf" stroke="#6f859b" fontSize={10} width={70} />
                  <ReferenceLine x={0} stroke="#45617a" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
                  <Bar dataKey="v" name="Strength">
                    {contributions.map((c) => (
                      <Cell key={c.tf} fill={(c.v ?? 0) >= 0 ? '#2fbf83' : '#e0606c'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty title="No contributions" detail="Awaiting the first persisted snapshot." />
          )}

          <h4 className="hr-sub">Historical strength · {history.filter((h) => h.closed).length} closed observations</h4>
          {err && <p className="alert">{err}</p>}
          {busy && !history.length && <p className="muted">Loading history from db_Cacsms-Trader…</p>}
          {history.length ? (
            <div style={{ height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1d3048" />
                  <XAxis dataKey="date" stroke="#6f859b" fontSize={10} minTickGap={40} />
                  <YAxis domain={[-10, 10]} stroke="#6f859b" fontSize={10} />
                  <ReferenceLine y={0} stroke="#45617a" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
                  <Line dataKey="macro" name="Macro (Q/M)" stroke="#7f8fa3" dot={false} strokeDasharray="4 3" />
                  <Line dataKey="current" name="Current (W/D)" stroke="#35c8e6" dot={false} strokeOpacity={0.5} />
                  <Line dataKey="composite" name="Composite" stroke={ASSET_COLORS[asset.asset]} dot={false} strokeWidth={2} />
                  <Line dataKey="provisional" name="Forming (provisional)" stroke="#ffd36d" dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            !busy && <Empty title="No history" detail="No persisted snapshots for this asset yet." />
          )}

          <h4 className="hr-sub">Regime timeline</h4>
          {segments.length ? (
            <>
              <div className="hr-timeline">
                {segments.map((s) => (
                  <i
                    key={s.from}
                    style={{ flex: s.count, background: regimeColor(s.regime, s.meanS) }}
                    title={`${s.regime ?? 'Warming up'} · ${s.from} → ${s.to} · ${s.count} obs · mean S ${signed(s.meanS)}`}
                  />
                ))}
              </div>
              <div className="hr-timeline-axis">
                <span>{segments[0].from}</span>
                <span>{closedCount} obs</span>
                <span>{segments[segments.length - 1].to}</span>
              </div>
            </>
          ) : (
            <Empty title="No timeline" detail="Timeline appears after closed observations are classified." />
          )}

          <h4 className="hr-sub">Transition evidence · {transitions.length} confirmed</h4>
          {transitions.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Confirmed</th>
                    <th>Change</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {transitions.slice(0, 12).map((t) => (
                    <tr key={t.id} onClick={() => onTransition(t)} className="hr-click">
                      <td>{t.confirmedAt}</td>
                      <td>
                        {t.previous ?? '—'} <ArrowRight size={11} /> <b>{t.next}</b>
                      </td>
                      <td>{num(t.confidence, 1, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No confirmed transitions" detail="The current regime has held across the persisted history." />
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ transition drawer */

function TransitionDrawer({ t, onClose }: { t: RegimeTransition; onClose: () => void }) {
  const ev = t.evidence || {};
  const obs = ev.observations || [];
  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>REGIME TRANSITION · #{t.id}</small>
            <h2>
              {t.asset} · {t.previous ?? '—'} <ArrowRight size={16} /> {t.next}
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          <div className="md-kpi">
            <div title="Mean observation confidence across the confirmation window">
              <span>Confidence</span>
              <b>{num(t.confidence, 1, '%')}</b>
            </div>
            <div title="Closed observation that confirmed the change">
              <span>Confirmed</span>
              <b>{t.confirmedAt}</b>
            </div>
            <div title="First observation that challenged the previous regime">
              <span>First seen</span>
              <b>{t.firstSeen ?? '—'}</b>
            </div>
            <div title="How long the previous regime held">
              <span>Previous held</span>
              <b>{ev.previous ? `${ev.previous.durationObs} obs` : '—'}</b>
            </div>
          </div>
          <h4 className="hr-sub">Reason</h4>
          <p className="hr-reason">{t.reason || '—'}</p>
          {ev.rule && (
            <>
              <h4 className="hr-sub">Classification rule ({ev.ruleObservation})</h4>
              <p className="hr-reason mono">{ev.rule}</p>
            </>
          )}
          {ev.thresholds && (
            <div className="kv" style={{ marginBottom: 12 }}>
              <span title="Composite level beyond which a regime is directional">Level band</span>
              <b>±{ev.thresholds.levelBand}</b>
              <span title="Adaptive momentum band derived from the asset's own trailing momentum">Momentum band</span>
              <b>±{ev.thresholds.momentumBand}</b>
              <span title="Closed observations required to confirm">Confirmation window</span>
              <b>{ev.thresholds.confirmObs} obs</b>
              <span title="Minimum mean confidence to accept a transition">Minimum confidence</span>
              <b>{ev.thresholds.minConfidence}%</b>
              <span>Previous regime since</span>
              <b>{ev.previous?.since ?? '—'}</b>
            </div>
          )}
          <h4 className="hr-sub">Confirmation window · {obs.length} observations</h4>
          {obs.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Raw</th>
                    <th>S</th>
                    <th>Mom</th>
                    <th>Acc</th>
                    <th>Q</th>
                    <th>M</th>
                    <th>W</th>
                    <th>D</th>
                    <th>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {obs.map((o) => (
                    <tr key={o.date} className={o.raw === t.next ? 'hr-agree' : ''}>
                      <td>{o.date}</td>
                      <td>{o.raw ?? '—'}</td>
                      <StrengthCell v={o.composite} />
                      <StrengthCell v={o.momentum} />
                      <StrengthCell v={o.acceleration} />
                      <StrengthCell v={o.q} />
                      <StrengthCell v={o.m} />
                      <StrengthCell v={o.w} />
                      <StrengthCell v={o.d} />
                      <td>{num(o.confidence, 0, '%')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No evidence rows" detail="Evidence was not recorded for this transition." />
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ trajectory chart */

const RANGES = [
  { label: '1M', obs: 21 },
  { label: '3M', obs: 63 },
  { label: '6M', obs: 130 },
] as const;

function TrajectoryChart({ assets, onPick }: { assets: RegimeAssetState[]; onPick: (a: string) => void }) {
  const [range, setRange] = useState<number>(63);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(REGIME_ASSETS));
  const data = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const a of assets) {
      for (const h of a.history.slice(-range)) {
        const row = byDate.get(h.date) ?? { date: h.date };
        row[a.asset] = h.composite;
        byDate.set(h.date, row);
      }
    }
    return [...byDate.values()].sort((x, y) => String(x.date).localeCompare(String(y.date))).slice(-range);
  }, [assets, range]);

  const toggle = (a: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Strength Trajectories</h3>
          <p>Composite strength (±10) per asset from persisted snapshots · click a legend chip to toggle, double-click to open</p>
        </div>
        <div className="md-tf-tabs">
          {RANGES.map((r) => (
            <button type="button" key={r.label} className={range === r.obs ? 'active' : ''} onClick={() => setRange(r.obs)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hr-chips">
        {assets.map((a) => (
          <button
            type="button"
            key={a.asset}
            className={visible.has(a.asset) ? 'on' : ''}
            style={{ borderColor: ASSET_COLORS[a.asset], color: visible.has(a.asset) ? '#e8f0fb' : '#6f859b' }}
            onClick={() => toggle(a.asset)}
            onDoubleClick={() => onPick(a.asset)}
            title={`${a.asset}: ${a.latest?.regime ?? 'warming up'} · S ${signed(a.latest?.composite)}`}
          >
            <i style={{ background: ASSET_COLORS[a.asset] }} />
            {a.asset}
          </button>
        ))}
      </div>
      {data.length ? (
        <div className="chart-lg">
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1d3048" />
              <XAxis dataKey="date" stroke="#6f859b" fontSize={10} minTickGap={36} />
              <YAxis domain={[-10, 10]} stroke="#6f859b" fontSize={10} />
              <ReferenceLine y={0} stroke="#45617a" />
              <ReferenceLine y={2} stroke="#1f4a3a" strokeDasharray="2 4" />
              <ReferenceLine y={-2} stroke="#4a2530" strokeDasharray="2 4" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmtTip} />
              {assets
                .filter((a) => visible.has(a.asset))
                .map((a) => (
                  <Line
                    key={a.asset}
                    dataKey={a.asset}
                    stroke={ASSET_COLORS[a.asset]}
                    dot={false}
                    strokeWidth={a.asset === 'XAU' ? 2.2 : 1.6}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty title="No trajectory data" detail="Snapshots appear after the first Stage 3 run persists to db_Cacsms-Trader." />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ monitor tab */

type SortKey = 'strength' | 'momentum' | 'confidence' | 'duration' | 'asset';
type PairSort = 'conviction' | 'differential' | 'symbol';

function RegimeMonitor({
  assets,
  pairs,
  transitions,
  onAsset,
}: {
  assets: RegimeAssetState[];
  pairs: RegimePair[];
  transitions: RegimeTransition[];
  onAsset: (a: string) => void;
}) {
  const [q, setQ] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('strength');
  const [pq, setPq] = useState('');
  const [pairSort, setPairSort] = useState<PairSort>('conviction');
  const [biasFilter, setBiasFilter] = useState('ALL');

  const classified = assets.filter((a) => a.latest?.regime);
  const inGroup = (g: string) => classified.filter((a) => regimeGroup(a.latest!.regime, a.latest!.composite) === g);
  const strengthening = inGroup('BULLISH');
  const weakening = inGroup('BEARISH');
  const inTransition = inGroup('TRANSITION');
  const stable = inGroup('NEUTRAL');
  const cutoff = Date.now() - 30 * DAY_MS;
  const recent = transitions.filter((t) => Date.parse(t.confirmedAt) >= cutoff);

  const rows = useMemo(() => {
    let list = [...assets];
    if (q.trim()) list = list.filter((a) => a.asset.includes(q.trim().toUpperCase()));
    if (kind !== 'ALL') list = list.filter((a) => a.kind === kind);
    if (regimeFilter === 'WARMING') list = list.filter((a) => !a.latest?.regime);
    else if (regimeFilter !== 'ALL') list = list.filter((a) => a.latest?.regime === regimeFilter);
    const val = (a: RegimeAssetState) =>
      sort === 'strength'
        ? a.latest?.composite ?? -99
        : sort === 'momentum'
          ? a.latest?.momentum ?? -99
          : sort === 'confidence'
            ? a.latest?.confidence ?? -1
            : sort === 'duration'
              ? a.latest?.durationObs ?? -1
              : 0;
    list.sort((a, b) => (sort === 'asset' ? a.asset.localeCompare(b.asset) : val(b) - val(a)));
    return list;
  }, [assets, q, kind, regimeFilter, sort]);

  const pairRows = useMemo(() => {
    let list = [...pairs];
    if (pq.trim()) list = list.filter((p) => p.symbol.includes(pq.trim().toUpperCase()));
    if (biasFilter !== 'ALL') list = list.filter((p) => p.bias === biasFilter);
    list.sort((a, b) =>
      pairSort === 'symbol'
        ? a.symbol.localeCompare(b.symbol)
        : pairSort === 'differential'
          ? Math.abs(b.differential ?? 0) - Math.abs(a.differential ?? 0)
          : (b.conviction ?? -1) - (a.conviction ?? -1),
    );
    return list;
  }, [pairs, pq, pairSort, biasFilter]);

  const list = (xs: RegimeAssetState[]) => xs.map((a) => a.asset).join(' · ') || '—';

  return (
    <>
      <div className="metrics">
        <Metric label="Strengthening" value={strengthening.length} sub={list(strengthening)} />
        <Metric label="Weakening" value={weakening.length} sub={list(weakening)} />
        <Metric
          label="Transitions · 30d"
          value={recent.length}
          sub={inTransition.length ? `In transition: ${list(inTransition)}` : 'No asset currently recovering/reversing'}
        />
        <Metric label="Stable" value={stable.length} sub={list(stable)} />
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>Regime Monitor</h3>
            <p>Macro (Q/M) and current (W/D) strength evolution with hysteresis-confirmed regimes · click a row for detail</p>
          </div>
          <Badge tone={classified.length === assets.length && assets.length ? 'green' : 'amber'}>
            {classified.length}/{assets.length} classified
          </Badge>
        </div>
        <div className="md-toolbar">
          <label className="md-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset…" />
          </label>
          <select value={regimeFilter} onChange={(e) => setRegimeFilter(e.target.value)} title="Filter by confirmed regime">
            <option value="ALL">All regimes</option>
            {REGIME_NAMES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="WARMING">Warming up</option>
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} title="Asset class">
            <option value="ALL">Fiat + XAU</option>
            <option value="FIAT">Fiat only</option>
            <option value="METAL">XAU only</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="strength">Sort: Strength</option>
            <option value="momentum">Sort: Momentum</option>
            <option value="confidence">Sort: Confidence</option>
            <option value="duration">Sort: Duration</option>
            <option value="asset">Sort: Asset</option>
          </select>
        </div>
        {!rows.length ? (
          <Empty title="No matching assets" detail="Adjust search or filters." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Regime</th>
                  <th title="Composite strength now (±10)">Current</th>
                  <th title="Composite at the previous observation">Previous</th>
                  <th title="Composite change over the momentum lag">Momentum</th>
                  <th title="Change of momentum">Accel</th>
                  <th title="Quarterly (63 D1) basket strength">Q</th>
                  <th title="Monthly (21 D1) basket strength">M</th>
                  <th title="Weekly (5 D1) basket strength">W</th>
                  <th title="Daily (1 D1) basket strength">D</th>
                  <th title="Closed observations in the current regime">Duration</th>
                  <th title="Share of last 20 observations in the same directional group">Persist.</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const l = a.latest;
                  return (
                    <tr key={a.asset} className="hr-click" onClick={() => onAsset(a.asset)}>
                      <td>
                        <b style={{ color: ASSET_COLORS[a.asset] }}>{a.asset}</b>
                        {a.kind === 'METAL' && <small className="hr-tag">METAL</small>}
                      </td>
                      <td>
                        {l?.regime ? (
                          <>
                            <RegimeBadge regime={l.regime} s={l.composite} />
                            {l.candidate && (
                              <small className="hr-pending" title={`Challenger seen ${l.candidateCount}× since ${l.candidateSince}`}>
                                → {l.candidate} {l.candidateCount}×
                              </small>
                            )}
                          </>
                        ) : (
                          <span title={a.message ?? 'Collecting observations'}>
                            <Badge tone="blue">
                              WARMING UP {a.observations.collected}/{a.observations.required}
                            </Badge>
                          </span>
                        )}
                      </td>
                      <StrengthCell v={l?.composite} />
                      <td>{signed(l?.previous)}</td>
                      <StrengthCell v={l?.momentum} />
                      <StrengthCell v={l?.acceleration} />
                      <StrengthCell v={l?.q} />
                      <StrengthCell v={l?.m} />
                      <StrengthCell v={l?.w} />
                      <StrengthCell v={l?.d} />
                      <td>{l?.regime ? `${l.durationObs} obs` : '—'}</td>
                      <td>{num(l?.persistence, 0, '%')}</td>
                      <td>
                        <ConfBar value={l?.regime ? l.confidence : null} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <TrajectoryChart assets={assets} onPick={onAsset} />

      <Card>
        <div className="card-head">
          <div>
            <h3>Pair Regime Intelligence</h3>
            <p>Base vs quote differential and regime relationship for 28 FX pairs + XAUUSD · published to Market Scanner</p>
          </div>
          <Badge tone={pairs.some((p) => p.status === 'READY') ? 'green' : 'amber'}>
            {pairs.filter((p) => p.status === 'READY').length}/{pairs.length} published
          </Badge>
        </div>
        <div className="md-toolbar">
          <label className="md-search">
            <Search size={14} />
            <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search pair…" />
          </label>
          <select value={biasFilter} onChange={(e) => setBiasFilter(e.target.value)}>
            <option value="ALL">All biases</option>
            <option value="BULLISH">Bullish</option>
            <option value="BEARISH">Bearish</option>
            <option value="NEUTRAL">Neutral</option>
          </select>
          <select value={pairSort} onChange={(e) => setPairSort(e.target.value as PairSort)}>
            <option value="conviction">Sort: Conviction</option>
            <option value="differential">Sort: |Differential|</option>
            <option value="symbol">Sort: Symbol</option>
          </select>
        </div>
        {!pairRows.length ? (
          <Empty title="No pair intelligence" detail="Pairs are published after both legs are classified." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Bias</th>
                  <th title="Base composite minus quote composite">Differential</th>
                  <th title="Differential score adjusted for regime alignment and momentum, weighted by confidence">Conviction</th>
                  <th>Relationship</th>
                  <th>Base regime</th>
                  <th>Quote regime</th>
                  <th title="Momentum differential">Momentum</th>
                  <th>Persist.</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {pairRows.map((p) => (
                  <tr key={p.symbol} title={p.reason ?? ''}>
                    <td>
                      <b className={p.symbol === 'XAUUSD' ? 'hr-gold' : ''}>{p.symbol}</b>
                    </td>
                    <td>
                      <Badge tone={p.bias === 'BULLISH' ? 'green' : p.bias === 'BEARISH' ? 'red' : 'gray'}>{p.bias}</Badge>
                    </td>
                    <StrengthCell v={p.differential} />
                    <td>
                      <ConfBar value={p.status === 'READY' ? p.conviction : null} />
                    </td>
                    <td>
                      <small className="hr-rel">{p.relationship.replace('_', ' ')}</small>
                    </td>
                    <td>
                      <span className="hr-leg" onClick={() => onAsset(p.base === 'XAU' ? 'XAU' : p.base)}>
                        {p.base} · {p.baseRegime ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="hr-leg" onClick={() => onAsset(p.quote)}>
                        {p.quote} · {p.quoteRegime ?? '—'}
                      </span>
                    </td>
                    <StrengthCell v={p.momentum} />
                    <td>{num(p.persistence, 0, '%')}</td>
                    <td>{num(p.confidence, 0, '%')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ transition history tab */

type TSort = 'newest' | 'oldest' | 'confidence';

function TransitionHistory({ transitions, onPick }: { transitions: RegimeTransition[]; onPick: (t: RegimeTransition) => void }) {
  const [q, setQ] = useState('');
  const [asset, setAsset] = useState('ALL');
  const [target, setTarget] = useState('ALL');
  const [sort, setSort] = useState<TSort>('newest');

  const rows = useMemo(() => {
    let list = [...transitions];
    const s = q.trim().toLowerCase();
    if (s)
      list = list.filter(
        (t) =>
          t.asset.toLowerCase().includes(s) ||
          t.next.toLowerCase().includes(s) ||
          (t.previous ?? '').toLowerCase().includes(s) ||
          (t.reason ?? '').toLowerCase().includes(s),
      );
    if (asset !== 'ALL') list = list.filter((t) => t.asset === asset);
    if (target !== 'ALL') list = list.filter((t) => t.next === target);
    list.sort((a, b) =>
      sort === 'confidence'
        ? (b.confidence ?? 0) - (a.confidence ?? 0)
        : sort === 'oldest'
          ? a.confirmedAt.localeCompare(b.confirmedAt) || a.id - b.id
          : b.confirmedAt.localeCompare(a.confirmedAt) || b.id - a.id,
    );
    return list;
  }, [transitions, q, asset, target, sort]);

  const lag = (t: RegimeTransition) => t.evidence?.observations?.length ?? null;

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Transition History</h3>
          <p>Every confirmed regime change persisted in dbo.app_regime_transition · click a row for full evidence</p>
        </div>
        <Badge tone="blue">{transitions.length} recorded</Badge>
      </div>
      <div className="md-toolbar">
        <label className="md-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset, regime or reason…" />
        </label>
        <select value={asset} onChange={(e) => setAsset(e.target.value)}>
          <option value="ALL">All assets</option>
          {REGIME_ASSETS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="ALL">Any new regime</option>
          {REGIME_NAMES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as TSort)}>
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="confidence">Sort: Confidence</option>
        </select>
      </div>
      {!rows.length ? (
        <Empty
          title={transitions.length ? 'No matching transitions' : 'No transitions recorded'}
          detail={
            transitions.length
              ? 'Adjust search or filters.'
              : 'Transitions are written only when a new regime is confirmed across the confirmation window.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Confirmed</th>
                <th>Asset</th>
                <th>Previous</th>
                <th />
                <th>New regime</th>
                <th>Confidence</th>
                <th title="First observation challenging the previous regime">First seen</th>
                <th title="Observations in the confirmation window">Window</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hr-click" onClick={() => onPick(t)}>
                  <td>{t.confirmedAt}</td>
                  <td>
                    <b style={{ color: ASSET_COLORS[t.asset] }}>{t.asset}</b>
                  </td>
                  <td>
                    {t.previous ? <RegimeBadge regime={t.previous} s={t.evidence?.observations?.[0]?.composite} /> : '—'}
                  </td>
                  <td>
                    <ArrowRight size={12} />
                  </td>
                  <td>
                    <RegimeBadge regime={t.next} s={t.evidence?.observations?.at(-1)?.composite} />
                  </td>
                  <td>
                    <ConfBar value={t.confidence} />
                  </td>
                  <td>{t.firstSeen ?? '—'}</td>
                  <td>{lag(t) == null ? '—' : `${lag(t)} obs`}</td>
                  <td className="hr-reason-cell" title={t.reason ?? ''}>
                    {t.reason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export function HistoricalRegimePage() {
  const store = useRegimeStore();
  const [tab, setTab] = useState('Regime Monitor');
  const [assetOpen, setAssetOpen] = useState<string | null>(null);
  const [transitionOpen, setTransitionOpen] = useState<RegimeTransition | null>(null);
  const [, setNow] = useState(Date.now());

  useEffect(() => startRegimeStore(), []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const state = store.state;
  const status = regimeStageStatus(store);
  const run = state?.run;
  const assets = state?.assets ?? [];
  const transitions = state?.transitions ?? [];
  const warming = assets.filter((a) => a.status !== 'CLASSIFIED');
  const selectedAsset = assets.find((a) => a.asset === assetOpen);
  const age = regimeRunAgeMs(store);

  return (
    <>
      <PageHeader
        title="Historical Regime"
        subtitle="Stage 3 · persistence, acceleration, deterioration and reversal intelligence for 8 currencies + XAU"
      />
      <div className="hr-status">
        <Badge tone={stageTone(status)}>STAGE 3 · {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading regime state…' : 'No regime run recorded yet')}</span>
        <span className="muted">
          Last run {ago(age)}
          {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          {run?.latestObsDate ? ` · latest D1 close ${run.latestObsDate}` : ''}
          {run?.forming ? ' · forming bar provisional' : ''}
        </span>
        <button type="button" className="hr-run" onClick={() => void runRegimeNow()} disabled={store.running}>
          <RefreshCw size={13} className={store.running ? 'hr-spin' : ''} /> {store.running ? 'Running…' : 'Run now'}
        </button>
      </div>

      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error}</span>
        </div>
      )}
      {status === 'STALE' && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>
            Regime data is stale — last successful run {ago(age)} (expected every {REGIME_INTERVAL_MS / 1000}s). Downstream stages
            should treat regime inputs as outdated.
          </span>
        </div>
      )}
      {status === 'BLOCKED' && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>Stage 3 blocked — {run?.message}. Showing the last persisted regime state.</span>
        </div>
      )}
      {warming.length > 0 && state && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>
            Warming up:{' '}
            {warming.map((a) => `${a.asset} ${a.observations.collected}/${a.observations.required} obs`).join(' · ')} — no
            classification is published for these assets until enough closed observations exist.
          </span>
        </div>
      )}

      <Tabs items={['Regime Monitor', 'Transition History']} active={tab} onChange={setTab} />

      {store.loading && !state ? (
        <Card>
          <Empty title="Loading regime intelligence" detail="Reading persisted snapshots from db_Cacsms-Trader…" />
        </Card>
      ) : !assets.length ? (
        <Card>
          <Empty title="No regime data" detail={store.error || 'Start the MT5 bridge (npm run mt5:bridge) to compute Stage 3.'} />
        </Card>
      ) : tab === 'Regime Monitor' ? (
        <RegimeMonitor assets={assets} pairs={state?.pairs ?? []} transitions={transitions} onAsset={setAssetOpen} />
      ) : (
        <TransitionHistory transitions={transitions} onPick={setTransitionOpen} />
      )}

      {selectedAsset && !transitionOpen && (
        <AssetDrawer
          asset={selectedAsset}
          transitions={transitions.filter((t) => t.asset === selectedAsset.asset)}
          onClose={() => setAssetOpen(null)}
          onTransition={setTransitionOpen}
        />
      )}
      {transitionOpen && <TransitionDrawer t={transitionOpen} onClose={() => setTransitionOpen(null)} />}
    </>
  );
}
