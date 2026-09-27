import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Search, X, XCircle } from 'lucide-react';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import { useTrading } from '../../context/TradingContext';
import { ageText, dataTone, dirArrow, dirTone, statusTone } from '../htf-vision';
import { fetchDirectionDetail } from './services/directionClient';
import { directionRunAgeMs, directionStageStatus, runDirectionNow, startDirectionStore, useDirectionStore } from './services/directionStore';
import { stateTone } from './services/directionStage';
import type { DirectionDecision, DirectionDetail, DirectionHistoryRow, ProcessingState, TfAlignment, TfEvidence, UpstreamLeg } from './types';
import '../market-scanner/market-scanner.css';
import './structural-direction.css';

const human = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const signed = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(0)}%`);
const barTime = (ts?: number | null) => (ts ? new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—');

const biasTone = (d?: string | null) => (d?.includes('BULL') ? 'green' : d?.includes('BEAR') ? 'red' : 'gray');
const biasClass = (d?: string | null) => (d?.includes('BULL') ? 'positive' : d?.includes('BEAR') ? 'negative' : 'muted');
const alignTone = (a?: TfAlignment | null) => (a === 'ALIGNED' ? 'green' : a === 'PULLBACK' ? 'blue' : a === 'D1_ONLY' ? 'amber' : a === 'CONFLICT' ? 'red' : 'gray');
const CONF_COLOR: Record<string, string> = { green: '#22c55e', blue: '#3f8fd1', amber: '#e2b04a', red: '#ef4444', gray: '#64748b' };
const STATE_ORDER: ProcessingState[] = ['READY_FOR_H1', 'ALIGNED', 'WAITING', 'CONFLICT', 'ANALYSING', 'STALE', 'INVALIDATED', 'BLOCKED'];
const ALIGN_LABEL: Record<TfAlignment, string> = {
  ALIGNED: 'D1/H8 aligned',
  PULLBACK: 'H8 pullback',
  D1_ONLY: 'D1 only',
  CONFLICT: 'Conflict',
  UNCONFIRMED: 'Unconfirmed',
};

function ConfBar({ d }: { d: DirectionDecision }) {
  const scored = d.components.length > 0;
  if (!scored) return <span className="muted">—</span>;
  return (
    <div className="hr-conf sd-conf" title="Structural confidence (0–100) from the scoring contributions">
      <i style={{ width: `${Math.min(100, d.confidence)}%`, background: CONF_COLOR[stateTone(d.state)] }} />
      <span>{d.confidence.toFixed(0)}</span>
    </div>
  );
}

function tfLabel(t: TfEvidence) {
  if (t.dataStatus && t.dataStatus !== 'READY' && t.dataStatus !== 'STALE') return human(t.dataStatus);
  if (!t.status) return 'NOT ANALYSED';
  if (t.status === 'NONE') return 'NO CHANNEL';
  return t.status;
}

/* ------------------------------------------------------------------ flow */

function Flow({ list, promoted }: { list: DirectionDecision[]; promoted: number | null }) {
  const analysed = list.filter((d) => d.upstream.vision?.qualified && d.upstream.vision.status === 'READY').length;
  const structural = list.filter((d) => ['READY_FOR_H1', 'ALIGNED', 'WAITING'].includes(d.state) && d.alignment !== 'UNCONFIRMED').length;
  const ready = list.filter((d) => d.readyForH1).length;
  const box = (value: number | null, label: string, owner: string, title: string) => (
    <div title={title}>
      <b>{value ?? '—'}</b>
      <span>{label}</span>
      <small className="ms-owner">{owner}</small>
    </div>
  );
  return (
    <div className="funnel ms-funnel">
      {box(promoted, 'Candidates', 'Stage 4 promoted', 'Instruments promoted by the Market Scanner')}
      <i>→</i>
      {box(analysed, 'D1/H8 vision', 'Stage 5 READY', 'Promoted instruments analysed by HTF Market Vision on READY D1/H8 history')}
      <i>→</i>
      {box(structural, 'Structurally valid', 'Stage 6', 'Directional D1 authority with H8 aligned, pulling back or unconfirmed (no conflict)')}
      <i>→</i>
      {box(ready, 'READY_FOR_H1', 'Stage 6 → Stage 7', 'Published to Stage 7 H1 Confirmation with direction, phase, position, evidence and invalidation')}
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

function Leg({ leg, role }: { leg: UpstreamLeg | null; role: string }) {
  if (!leg) return <p className="hr-reason">{role}: no Stage 2/3 observation.</p>;
  const rows: [string, ReactNode][] = [
    ['Composite (Stage 2)', signed(leg.composite)],
    ['Macro (Q+M)', signed(leg.macro)],
    ['Current (W+D)', signed(leg.current)],
    ['Momentum', signed(leg.momentum)],
    ['Regime (Stage 3)', `${leg.regime ?? 'warming up'} · ${human(leg.group)}`],
    ['Regime confidence', num(leg.confidence, 0)],
    ['Persistence', `${num(leg.persistence, 0)}%`],
    ['Closed D1', leg.date ?? '—'],
  ];
  return (
    <div>
      <h4 className="hr-sub">
        {role} · <b className={leg.asset === 'XAU' ? 'hr-gold' : undefined}>{leg.asset}</b>
      </h4>
      <div className="kv ms-kv">
        {rows.map(([k, v]) => (
          <div key={k} className="ms-kv-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function TfBlock({ tf, t, livePos, source }: { tf: 'D1' | 'H8'; t: TfEvidence; livePos: number | null; source: string }) {
  const b = t.breakout;
  return (
    <div>
      <h4 className="hr-sub">
        {tf} {tf === 'D1' ? 'primary structure (authority)' : 'intermediate structure (phase refinement)'}
      </h4>
      <div className="kv ms-rel">
        <span>Data</span>
        <b>
          <Badge tone={dataTone(t.dataStatus)}>{human(t.dataStatus)}</Badge> <small className="muted">{t.dataReason}</small>
        </b>
        <span>Channel</span>
        <b>
          <Badge tone={statusTone(t.status)}>{tfLabel(t)}</Badge> <Badge tone={dirTone(t.direction)}>{human(t.direction)}</Badge>
          {t.lean && t.lean !== t.direction ? <small className="muted"> lean {human(t.lean)}</small> : null}
        </b>
        <span>Phase</span>
        <b>{human(t.phase)}</b>
        <span>Position</span>
        <b>
          {pct(livePos)} <small className="muted">({source === 'LIVE' ? 'live price' : 'last closed bar'}; closed bar {pct(t.position)})</small>
        </b>
        <span>Stage 5 confidence</span>
        <b>{num(t.confidence, 0)}</b>
        <span>Touches</span>
        <b>{t.touches ? `${t.touches.anchor} anchor · ${t.touches.opposite} opposite` : '—'}</b>
        <span>Breakout</span>
        <b>
          {b
            ? `${b.side === 'UP' ? 'Upside' : 'Downside'} ${barTime(b.ts)} · ${signed(b.distanceAtr)} ATR${b.retesting ? ' · retesting' : ''}`
            : 'None'}
        </b>
        <span>Last closed bar</span>
        <b>
          {barTime(t.lastTs)} {t.available != null ? <small className="muted">· {t.available}/{t.required} bars</small> : null}
        </b>
      </div>
      {t.reason && <p className="hr-reason">{t.reason}</p>}
    </div>
  );
}

function HistoryTable({ rows, onSymbol }: { rows: DirectionHistoryRow[]; onSymbol?: (s: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No decision changes recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Time</th>
            {onSymbol && <th>Instrument</th>}
            <th>Transition</th>
            <th>Direction</th>
            <th>Phase</th>
            <th>Alignment</th>
            <th>Conf.</th>
            <th>Trigger</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{new Date(h.createdAt).toLocaleString()}</td>
              {onSymbol && (
                <td>
                  <button type="button" className="cs-link" onClick={() => onSymbol(h.symbol)}>
                    {h.symbol}
                  </button>
                </td>
              )}
              <td>
                <small className="muted">{h.prevState ? human(h.prevState) : 'new'} →</small> <Badge tone={stateTone(h.state)}>{human(h.state)}</Badge>
              </td>
              <td>
                <Badge tone={dirTone(h.direction)}>{human(h.direction)}</Badge>
              </td>
              <td>{human(h.phase)}</td>
              <td>{ALIGN_LABEL[h.alignment] ?? human(h.alignment)}</td>
              <td>{num(h.confidence, 0)}</td>
              <td className="hv-wrap">
                <small>{h.trigger || '—'}</small>
              </td>
              <td className="hv-wrap">
                <small>{h.reasonCode}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DrawerTab = 'Decision' | 'Evidence' | 'Scoring' | 'History';

function DirectionDrawer({ symbol, version, onClose }: { symbol: string; version: string; onClose: () => void }) {
  const [detail, setDetail] = useState<DirectionDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<DrawerTab>('Decision');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetchDirectionDetail(symbol)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Detail unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, version]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const d = detail?.instrument;
  const sc = d?.upstream.scanner;
  const vi = d?.upstream.vision;
  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer ms-drawer" role="dialog" aria-modal="true" aria-label={`${symbol} structural decision`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 6 · STRUCTURAL DECISION</small>
            <h2>
              {symbol} {d && <Badge tone={stateTone(d.state)}>{human(d.state)}</Badge>} {d && <Badge tone={dirTone(d.direction)}>{human(d.direction)}</Badge>}
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          {err && (
            <div className="hr-banner err">
              <AlertTriangle size={14} />
              <span>{err}</span>
            </div>
          )}
          {!detail && !err && <p className="hr-reason">Loading persisted decision…</p>}
          {detail && !d && <p className="hr-reason">{symbol} has not been evaluated by Stage 6 yet.</p>}
          {d && (
            <>
              <div className="md-kpi">
                <div>
                  <span>Confidence</span>
                  <b>{d.components.length ? d.confidence.toFixed(0) : '—'}</b>
                </div>
                <div>
                  <span>Phase</span>
                  <b>{human(d.structuralPhase)}</b>
                </div>
                <div>
                  <span>D1/H8</span>
                  <b>{ALIGN_LABEL[d.alignment]}</b>
                </div>
                <div>
                  <span>D1 position</span>
                  <b>{pct(d.position.d1)}</b>
                </div>
              </div>
              <div className={`sd-explain ${stateTone(d.state)}`}>
                <b>{d.reasonCode}</b>
                <span>{d.explanation}</span>
              </div>
              <Tabs items={['Decision', 'Evidence', 'Scoring', 'History']} active={tab} onChange={(x) => setTab(x as DrawerTab)} idPrefix="sd-dd" label="Decision section" />
              {tab === 'Decision' && (
                <>
                  <div className="kv ms-rel">
                    <span>Processing state</span>
                    <b>
                      <Badge tone={stateTone(d.state)}>{human(d.state)}</Badge> <small className="muted">{d.reason}</small>
                    </b>
                    <span>Final structural direction</span>
                    <b>
                      <Badge tone={dirTone(d.direction)}>{human(d.direction)}</Badge> <small className="muted">expected {human(d.expectedDirection)}</small>
                    </b>
                    <span>Channel zone</span>
                    <b>
                      {human(d.zone.name)}
                      {d.zone.relative != null ? <small className="muted"> · {d.zone.relative.toFixed(0)}% from the trend-support side</small> : null}
                    </b>
                    <span>Freshness</span>
                    <b>
                      <Badge tone={d.freshness.status === 'CURRENT' ? 'green' : d.freshness.status === 'STALE' ? 'amber' : 'gray'}>{d.freshness.status}</Badge>{' '}
                      <small className="muted">{d.freshness.reason}</small>
                    </b>
                    <span>Stage 7 hand-off</span>
                    <b>
                      {d.readyForH1 ? (
                        <>
                          <Badge tone="green">PUBLISHED TO H1 CONFIRMATION</Badge>
                          {d.readySince ? <small className="muted"> since {new Date(d.readySince).toLocaleString()}</small> : null}
                        </>
                      ) : (
                        <Badge tone="gray">NOT PUBLISHED</Badge>
                      )}
                    </b>
                    <span>Execution</span>
                    <b>Stage 6 never executes — structural decision only</b>
                  </div>
                  <h4 className="hr-sub">Conflicts</h4>
                  {d.conflicts.length ? (
                    <ul className="ms-rules">
                      {d.conflicts.map((c) => (
                        <li key={c} className="fail">
                          <XCircle size={14} />
                          <b>Conflict</b>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hr-reason">No structural conflicts between Stage 4 bias, D1 and H8.</p>
                  )}
                  <h4 className="hr-sub">Invalidation conditions</h4>
                  {d.invalidation.length ? (
                    <ul className="hv-list">
                      {d.invalidation.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hr-reason">No invalidation levels — no confirmed structure to invalidate.</p>
                  )}
                </>
              )}
              {tab === 'Evidence' && (
                <>
                  <h4 className="hr-sub">Upstream strength &amp; regime (Stage 2/3 via Stage 4)</h4>
                  {sc ? (
                    <>
                      <div className="kv ms-rel">
                        <span>Stage 4 decision</span>
                        <b>
                          <Badge tone={sc.promoted ? 'green' : 'gray'}>{human(sc.state)}</Badge> <Badge tone={biasTone(sc.direction)}>{human(sc.direction)}</Badge>{' '}
                          <small className="muted">
                            rank #{sc.rank ?? '—'} · conviction {num(sc.conviction, 1)}
                          </small>
                        </b>
                        <span>Strength differential</span>
                        <b>{signed(sc.differential)}</b>
                        <span>Regime relationship</span>
                        <b>
                          {human(sc.relationship)} · {human(sc.alignment)}
                        </b>
                        <span>Momentum / persistence</span>
                        <b>
                          gap {human(sc.trajectory)} · acceleration {human(sc.acceleration)} · persistence {num(sc.persistence, 0)}%
                        </b>
                        <span>Strength freshness</span>
                        <b>
                          {human(sc.freshness)} <small className="muted">{sc.freshnessReason}</small>
                        </b>
                      </div>
                      <div className="ms-legs">
                        <Leg leg={sc.base} role="Base" />
                        <Leg leg={sc.quote} role="Quote" />
                      </div>
                    </>
                  ) : (
                    <p className="hr-reason">Not ranked by Stage 4 yet.</p>
                  )}
                  <h4 className="hr-sub">Stage 5 HTF Market Vision</h4>
                  {vi ? (
                    <div className="kv ms-rel">
                      <span>Status</span>
                      <b>
                        <Badge tone={dataTone(vi.status)}>{human(vi.status)}</Badge> <small className="muted">{vi.reason}</small>
                      </b>
                      <span>Primary direction · agreement</span>
                      <b>
                        {human(vi.primaryDirection)} · {human(vi.agreement)} · phase {human(vi.phase)}
                      </b>
                      <span>Analysed</span>
                      <b>
                        {ageText(vi.analysedAt)} <small className="muted">{vi.trigger}</small>
                      </b>
                    </div>
                  ) : (
                    <p className="hr-reason">No Stage 5 output for {symbol}.</p>
                  )}
                  <div className="ms-legs">
                    <TfBlock tf="D1" t={d.d1} livePos={d.position.d1} source={d.position.source} />
                    <TfBlock tf="H8" t={d.h8} livePos={d.position.h8} source={d.position.source} />
                  </div>
                  <p className="hr-reason">
                    Current price {d.position.price != null ? d.position.price : '—'} · {d.position.marketOpen ? 'market open' : 'market closed'}
                    {d.position.at ? ` · position updated ${ageText(d.position.at)}` : ''}
                  </p>
                </>
              )}
              {tab === 'Scoring' &&
                (d.components.length ? (
                  <>
                    <div className="table-wrap">
                      <table className="cs-table ms-components">
                        <thead>
                          <tr>
                            <th>Contribution</th>
                            <th>Points</th>
                            <th />
                            <th>Evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.components.map((c) => (
                            <tr key={c.key}>
                              <td>
                                <b>{c.label}</b>
                              </td>
                              <td className={c.points > 0 ? 'positive' : c.points < 0 ? 'negative' : undefined}>
                                {signed(c.points, 1)} / {c.max}
                              </td>
                              <td>
                                <div className="ms-bar">
                                  <i className={c.points < 0 ? 'neg' : ''} style={{ width: `${Math.min(100, (Math.abs(c.points) / Math.max(1, c.max)) * 100)}%` }} />
                                </div>
                              </td>
                              <td className="hv-wrap">{c.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="hr-reason">
                      Sum clamped to 0–100{d.freshness.status === 'STALE' ? ' × 0.6 for stale inputs' : ''} = structural confidence <b>{d.confidence.toFixed(1)}</b>. READY_FOR_H1 requires a
                      directional D1 channel, no conflict, price not extended and confidence at or above the READY threshold.
                    </p>
                  </>
                ) : (
                  <p className="hr-reason">No scoring — the decision stopped at an upstream gate ({d.reasonCode}).</p>
                ))}
              {tab === 'History' && <HistoryTable rows={detail.history} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

type SortKey = 'status' | 'symbol' | 'confidence' | 'differential' | 'direction' | 'alignment';
const STATE_FILTERS: ('All' | ProcessingState)[] = ['All', ...STATE_ORDER];
const DIR_FILTERS = ['All', 'Bullish', 'Bearish', 'Neutral'] as const;
const ALIGN_FILTERS: ('All' | TfAlignment)[] = ['All', 'ALIGNED', 'PULLBACK', 'D1_ONLY', 'CONFLICT', 'UNCONFIRMED'];
const CONF_FILTERS = [0, 40, 55, 70];
const DIR_RANK: Record<string, number> = { STRONG_BULLISH: 0, BULLISH: 1, NEUTRAL: 2, BEARISH: 3, STRONG_BEARISH: 4 };
const ALIGN_RANK: Record<string, number> = { ALIGNED: 0, PULLBACK: 1, D1_ONLY: 2, CONFLICT: 3, UNCONFIRMED: 4 };

const dirMatch = (d: string, f: (typeof DIR_FILTERS)[number]) =>
  f === 'All' || (f === 'Bullish' ? d.endsWith('BULLISH') : f === 'Bearish' ? d.endsWith('BEARISH') : d === 'NEUTRAL');

export function StructuralDirectionPage() {
  const { selected, setSelected } = useTrading();
  const store = useDirectionStore();
  const [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState('');
  const [stateF, setStateF] = useState<(typeof STATE_FILTERS)[number]>('All');
  const [dirF, setDirF] = useState<(typeof DIR_FILTERS)[number]>('All');
  const [alignF, setAlignF] = useState<(typeof ALIGN_FILTERS)[number]>('All');
  const [confF, setConfF] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'status', desc: false });
  const [drawer, setDrawer] = useState<string | null>(null);

  useEffect(() => startDirectionStore(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const run = store.state?.run ?? null;
  const list = useMemo(() => store.state?.instruments ?? [], [store.state]);
  const status = directionStageStatus(store, now);
  const age = directionRunAgeMs(store, now);
  const c = run?.counters;

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    const rows = list.filter(
      (d) =>
        (!q || d.symbol.includes(q)) &&
        (stateF === 'All' || d.state === stateF) &&
        dirMatch(d.direction, dirF) &&
        (alignF === 'All' || d.alignment === alignF) &&
        (confF === 0 || d.confidence >= confF),
    );
    const val = (d: DirectionDecision): number | string =>
      sort.key === 'symbol'
        ? d.symbol
        : sort.key === 'status'
          ? STATE_ORDER.indexOf(d.state) * 1000 - d.confidence
          : sort.key === 'confidence'
            ? d.confidence
            : sort.key === 'differential'
              ? Math.abs(d.upstream.scanner?.differential ?? 0)
              : sort.key === 'direction'
                ? DIR_RANK[d.direction] ?? 9
                : ALIGN_RANK[d.alignment] ?? 9;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const r = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -r : r;
    });
  }, [list, query, stateF, dirF, alignF, confF, sort]);

  const th = (key: SortKey, label: string, title?: string) => (
    <span role="columnheader" title={title} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className="ms-sort"
        onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key === 'confidence' || key === 'differential' })}
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </span>
  );

  const open = (s: string) => {
    setSelected(s);
    setDrawer(s);
  };
  const drawerRow = list.find((d) => d.symbol === drawer);
  const up = run?.upstream;

  return (
    <div className="sd-page">
      <PageHeader title="Structural Direction" subtitle="Combines macro strength, historical regime and D1/H8 market vision (Stage 5 → Stage 6)" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'ERROR' ? 'red' : 'gray'}>STAGE 6 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 6 decisions…' : 'No Stage 6 decision recorded yet')}</span>
        {age != null && (
          <span className="muted">
            Last decision {ageText(run?.runAt, now)}
            {run?.triggers?.length ? ` · ${run.triggers.slice(0, 4).join(', ')}` : ''}
            {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          </span>
        )}
        {run?.config && (
          <span className="muted">
            Autonomous bridge loop {run.config.service.loopSec}s · sweep {Math.round(run.config.service.fullEverySec / 60)}m · READY ≥ {run.config.engine.readyScore} · Stage 4{' '}
            {up?.scannerStatus ?? '—'} · Stage 5 {up?.visionStatus ?? '—'}
          </span>
        )}
        <button type="button" className="hr-run" disabled={store.running} onClick={() => void runDirectionNow()}>
          <RefreshCw size={14} className={store.running ? 'hr-spin' : undefined} />
          {store.running ? 'Evaluating…' : 'Re-evaluate now'}
        </button>
      </div>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — no structural direction is published while the bridge is unreachable.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 6 output is stale ({ageText(run?.runAt, now)}): decisions below are not handed to H1 Confirmation until the engine runs again.</span>
        </div>
      )}
      {run && up && up.promoted === 0 && (
        <div className="hr-banner">
          <span>
            Stage 4 has promoted no instrument, so every instrument is BLOCKED with NOT_PROMOTED_BY_SCANNER and its exact Stage 4 reason. Stage 6 does not manufacture a direction
            without a Market Scanner candidate.
          </span>
        </div>
      )}

      <div className="metrics sd-metrics">
        <Metric label="Analysed candidates" value={c ? c.analysed : '—'} sub={c ? `${c.candidates} Stage 4 candidates · ${c.universe} universe` : 'Awaiting Stage 6'} />
        <Metric label="D1/H8 aligned" value={c ? c.aligned : '—'} sub="Confirmed H8 agrees with D1" />
        <Metric label="Pullback / waiting" value={c ? c.pullbackWaiting : '—'} sub="H8 correction or awaiting structure" />
        <Metric label="Conflicts" value={c ? c.conflicts : '—'} sub="Stage 4 or H8 against D1" />
        <Metric label="Blocked" value={c ? c.blocked : '—'} sub={c ? `${c.stale} stale · ${c.invalidated} invalidated` : 'Upstream gates'} />
        <Metric label="Ready for H1" value={c ? c.ready : '—'} sub="Published to Stage 7" />
      </div>

      <Flow list={list} promoted={up ? up.promoted : null} />

      <Card>
        <div className="card-head">
          <div>
            <h3>Multi-Timeframe Direction Board</h3>
            <p>
              D1 is the primary authority, H8 refines the phase · Stage 6 {status} · {c?.candidates ?? 0} candidates · {c?.ready ?? 0} ready for H1 · click an instrument for the full
              evidence
            </p>
          </div>
          <Badge tone={c?.aligned ? 'green' : 'gray'}>{c?.aligned ?? 0} D1/H8 aligned</Badge>
        </div>
        <div className="ms-toolbar">
          <label className="hv-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instrument" aria-label="Search instrument" />
          </label>
          <label className="ms-select">
            <span>Direction</span>
            <select value={dirF} onChange={(e) => setDirF(e.target.value as typeof dirF)}>
              {DIR_FILTERS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="ms-select">
            <span>Alignment</span>
            <select value={alignF} onChange={(e) => setAlignF(e.target.value as typeof alignF)}>
              {ALIGN_FILTERS.map((a) => (
                <option key={a} value={a}>
                  {a === 'All' ? 'All' : ALIGN_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="ms-select">
            <span>Confidence</span>
            <select value={confF} onChange={(e) => setConfF(Number(e.target.value))}>
              {CONF_FILTERS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? 'Any' : `≥ ${v}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hr-chips" role="group" aria-label="Processing status">
          {STATE_FILTERS.map((s) => (
            <button key={s} type="button" className={stateF === s ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setStateF(s)}>
              {human(s)} <small>{s === 'All' ? list.length : list.filter((d) => d.state === s).length}</small>
            </button>
          ))}
        </div>
        {!list.length ? (
          <div className="empty-block">
            <b>{store.loading ? 'Loading…' : 'No structural decisions published'}</b>
            <span>{store.error || 'The bridge evaluates every instrument on startup from the Stage 4 and Stage 5 publications.'}</span>
          </div>
        ) : (
          <div className="table-wrap">
            <div className="direction-board sd-board" role="table" aria-label="Multi-timeframe direction board">
              <div className="sd-head" role="row">
                {th('symbol', 'Instrument')}
                <span role="columnheader">Scanner / regime</span>
                {th('differential', 'Strength Δ', 'Stage 2 base − quote differential (sorted by magnitude)')}
                <span role="columnheader">D1 direction · channel</span>
                <span role="columnheader">H8 direction · phase</span>
                <span role="columnheader">Position</span>
                {th('alignment', 'D1/H8')}
                {th('direction', 'Structural direction')}
                {th('confidence', 'Confidence')}
                <span role="columnheader">Freshness</span>
                {th('status', 'Status')}
              </div>
              {shown.map((d) => {
                const sc = d.upstream.scanner;
                return (
                  <div
                    key={d.symbol}
                    role="row"
                    className={`hr-click ${selected === d.symbol ? 'cs-focus' : ''}`}
                    onClick={() => open(d.symbol)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(d.symbol)}
                    tabIndex={0}
                    title={d.explanation}
                  >
                    <div>
                      <b className={d.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{d.symbol}</b>
                      <small className="sd-code">{d.reasonCode}</small>
                    </div>
                    <span>
                      <small>
                        {human(sc?.state)} · {sc?.conviction != null ? sc.conviction.toFixed(0) : '—'}
                      </small>
                      <b className={biasClass(sc?.direction)}>{human(sc?.direction)}</b>
                      <small className="sd-sub">{human(sc?.relationship)}</small>
                    </span>
                    <span className={(sc?.differential ?? 0) >= 0 ? 'positive' : 'negative'}>
                      <b>{signed(sc?.differential)}</b>
                    </span>
                    <span title={d.d1.reason ?? d.d1.dataReason ?? ''}>
                      <small>D1 · {tfLabel(d.d1)}</small>
                      <b className={d.d1.confirmed ? biasClass(d.d1.direction) : 'muted'}>
                        {dirArrow(d.d1.confirmed ? d.d1.direction : 'NEUTRAL')} {d.d1.confirmed ? human(d.d1.direction) : '—'}
                      </b>
                    </span>
                    <span title={d.h8.reason ?? d.h8.dataReason ?? ''}>
                      <small>H8 · {tfLabel(d.h8)}</small>
                      <b className={d.h8.confirmed ? biasClass(d.h8.direction) : 'muted'}>
                        {dirArrow(d.h8.confirmed ? d.h8.direction : 'NEUTRAL')} {human(d.h8.phase)}
                      </b>
                    </span>
                    <span>
                      <small>{d.position.source === 'LIVE' ? 'Live' : 'Close'}</small>
                      <b>{pct(d.position.d1)}</b>
                      {d.zone.name !== 'UNKNOWN' && <small className="sd-sub">{human(d.zone.name)}</small>}
                    </span>
                    <span>
                      <Badge tone={alignTone(d.alignment)}>{ALIGN_LABEL[d.alignment]}</Badge>
                      {d.structuralPhase && d.alignment !== 'UNCONFIRMED' && <small className="sd-sub">{human(d.structuralPhase)}</small>}
                    </span>
                    <span>
                      <Badge tone={dirTone(d.direction)}>{human(d.direction)}</Badge>
                    </span>
                    <span>
                      <ConfBar d={d} />
                    </span>
                    <span title={d.freshness.reason}>
                      <Badge tone={d.freshness.status === 'CURRENT' ? 'green' : d.freshness.status === 'STALE' ? 'amber' : 'gray'}>{d.freshness.status}</Badge>
                      <small className="sd-sub">{ageText(d.upstream.vision?.analysedAt, now)}</small>
                    </span>
                    <span>
                      <Badge tone={stateTone(d.state)}>{human(d.state)}</Badge>
                    </span>
                  </div>
                );
              })}
            </div>
            {!shown.length && <p className="hr-reason">No instrument matches these filters.</p>}
          </div>
        )}
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Decision History</h3>
            <p>Every Stage 6 decision change with its trigger · persisted in dbo.app_direction_history</p>
          </div>
          <Badge tone="blue">{store.state?.runs.length ?? 0} recent runs</Badge>
        </div>
        <HistoryTable rows={store.state?.history ?? []} onSymbol={open} />
      </Card>

      {drawer && <DirectionDrawer symbol={drawer} version={`${drawerRow?.changedAt ?? ''}|${drawerRow?.evaluatedAt ?? ''}`} onClose={() => setDrawer(null)} />}
    </div>
  );
}