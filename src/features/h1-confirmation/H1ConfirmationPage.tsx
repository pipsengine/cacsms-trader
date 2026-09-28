import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import { useTrading } from '../../context/TradingContext';
import { ageText } from '../htf-vision';
import { priceDigits } from '../htf-vision/components/VisionChart';
import { pipelineFocusSymbol } from '../market-scanner/services/scannerStage';
import { useScannerStore } from '../market-scanner/services/scannerStore';
import { H1Chart, h1Label } from './components/H1Chart';
import { fetchH1Chart, fetchH1Detail } from './services/confirmClient';
import { gateTone, h1Tone, stateLabel } from './services/confirmStage';
import { h1RunAgeMs, h1StageStatus, runH1Now, startH1Store, useH1Store } from './services/confirmStore';
import type { Gate, H1Chart as H1ChartData, H1Decision, H1Detail, H1EventRow, H1HistoryRow, H1State } from './types';
import '../htf-vision/htf-vision.css';
import '../market-scanner/market-scanner.css';
import '../structural-direction/structural-direction.css';
import './h1-confirmation.css';

const human = stateLabel;
const biasTone = (d?: string | null) => (d?.includes('BULL') ? 'green' : d?.includes('BEAR') ? 'red' : 'gray');
const signed = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(0)}%`);
const px = (v: number | null | undefined, ref?: number | null) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(priceDigits(ref ?? v)));
const ACTIVE: H1State[] = ['MONITORING', 'PULLBACK', 'SETUP_FORMING', 'CONFIRMING', 'CONFIRMED'];
const STATE_ORDER: H1State[] = ['CONFIRMED', 'CONFIRMING', 'SETUP_FORMING', 'PULLBACK', 'MONITORING', 'REJECTED', 'INVALIDATED', 'WARMING_UP', 'STALE', 'BLOCKED', 'WAITING_FOR_STAGE6'];

const isCandidate = (d: H1Decision) => d.state !== 'WAITING_FOR_STAGE6' && d.stage6?.state === 'READY_FOR_H1';

/* ------------------------------------------------------------------ flow */

function Flow({ list, ready }: { list: H1Decision[]; ready: number }) {
  const monitoring = list.filter((d) => ACTIVE.includes(d.state) || d.state === 'REJECTED' || d.state === 'INVALIDATED').length;
  const evidence = list.filter((d) => d.state === 'SETUP_FORMING' || d.state === 'CONFIRMING' || d.state === 'CONFIRMED').length;
  const gates = list.filter((d) => d.state === 'CONFIRMING' || d.state === 'CONFIRMED').length;
  const confirmed = list.filter((d) => d.state === 'CONFIRMED' && d.confirmed).length;
  const box = (value: number, label: string, owner: string, title: string) => (
    <div title={title}>
      <b>{value}</b>
      <span>{label}</span>
      <small className="ms-owner">{owner}</small>
    </div>
  );
  return (
    <div className="funnel ms-funnel h1-flow">
      {box(ready, 'READY_FOR_H1', 'Stage 6 hand-off', 'Candidates published by Structural Direction with direction, phase, position and invalidation')}
      <i>→</i>
      {box(monitoring, 'H1 monitoring', 'Stage 7', 'Candidates whose validated closed H1 structure is being analysed')}
      <i>→</i>
      {box(evidence, 'Structural evidence', 'pullback held / BOS · CHoCH', 'Completed pullback, or an H1 structure break in the HTF direction')}
      <i>→</i>
      {box(gates, 'Confirmation gates', 'Stage 7', 'A fresh BOS/CHoCH trigger exists; remaining mandatory gates are being checked')}
      <i>→</i>
      {box(confirmed, 'CONFIRMED', 'Stage 7 → Stage 8', 'Every mandatory gate passed; published to Opportunities & Risk')}
    </div>
  );
}

/* ------------------------------------------------------------------ checklist */

function Checklist({ d }: { d: H1Decision }) {
  return (
    <div className="h1-check" role="list" aria-label={`${d.symbol} H1 confirmation checklist`}>
      {Object.values(d.gates).map((g: Gate) => (
        <div key={g.key} role="listitem">
          <b>
            {g.label}
            <small>{g.mandatory ? 'mandatory' : g.key === 'bos' || g.key === 'choch' ? 'one of BOS / CHoCH' : 'supporting'}</small>
          </b>
          <span className="h1-gate">
            <Badge tone={gateTone(g.status)}>{g.status}</Badge>
          </span>
          <span>
            {g.detail}
            {g.ts ? <small className="muted"> · {h1Label(g.ts)}</small> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function Summary({ d }: { d: H1Decision }) {
  const su = d.setup;
  const ref = d.h1?.lastClose;
  return (
    <div className="md-kpi h1-kpi">
      <div>
        <span>Confirmation score</span>
        <b>{d.components.length ? d.score.toFixed(1) : '—'}</b>
      </div>
      <div>
        <span>Setup type</span>
        <b>{d.tradeType && d.tradeType !== 'NONE' ? human(d.tradeType) : d.marketLeg?.tradeType && d.marketLeg.tradeType !== 'NONE' ? human(d.marketLeg.tradeType) : human(d.setup?.model ?? 'WAIT')}</b>
      </div>
      <div>
        <span>H1 phase</span>
        <b>{human(d.phase)}</b>
      </div>
      <div>
        <span>Pullback</span>
        <b>
          {su ? human(su.pullback) : '—'}
          {su?.depth != null ? ` · ${(su.depth * 100).toFixed(0)}%` : ''}
        </b>
      </div>
      <div>
        <span>Trigger</span>
        <b>{su?.trigger ? `${su.trigger.type === 'CHOCH' ? 'CHoCH' : 'BOS'} ${su.trigger.side.toLowerCase()} · ${su.triggerAgeBars} bars ago` : '—'}</b>
      </div>
      <div>
        <span>Invalidation</span>
        <b>
          {px(d.invalidationLevel, ref)}
          {su?.riskAtr != null ? ` · ${su.riskAtr.toFixed(1)} ATR` : ''}
        </b>
      </div>
      <div>
        <span>Last closed H1</span>
        <b>{d.h1 ? h1Label(d.h1.lastTs) : '—'}</b>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tables */

function HistoryTable({ rows, onSymbol }: { rows: H1HistoryRow[]; onSymbol?: (s: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No H1 decision changes recorded yet.</p>;
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
            <th>Score</th>
            <th>Invalidation</th>
            <th>Stage 6</th>
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
                <small className="muted">{h.prevState ? human(h.prevState) : 'new'} →</small> <Badge tone={h1Tone(h.state)}>{human(h.state)}</Badge>
              </td>
              <td>
                <Badge tone={biasTone(h.direction)}>{human(h.direction)}</Badge>
              </td>
              <td>{human(h.phase)}</td>
              <td>{h.score ? h.score.toFixed(0) : '—'}</td>
              <td>{px(h.invalidationLevel)}</td>
              <td>{human(h.stage6State)}</td>
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

function EventsTable({ rows, onSymbol }: { rows: H1EventRow[]; onSymbol?: (s: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No H1 structural events recorded — events are stored only for Stage 6 candidates under H1 monitoring.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>H1 bar</th>
            {onSymbol && <th>Instrument</th>}
            <th>Event</th>
            <th>Side</th>
            <th>Level</th>
            <th>Price</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>{h1Label(e.ts)}</td>
              {onSymbol && (
                <td>
                  <button type="button" className="cs-link" onClick={() => onSymbol(e.symbol)}>
                    {e.symbol}
                  </button>
                </td>
              )}
              <td>
                <Badge tone={e.type === 'FALSE_BREAKOUT' || e.type === 'INVALIDATION' ? 'red' : e.type === 'CONFIRMED' ? 'green' : 'blue'}>
                  {e.type === 'CHOCH' ? 'CHoCH' : human(e.type)}
                </Badge>
              </td>
              <td className={e.side === 'UP' ? 'positive' : 'negative'}>{e.side}</td>
              <td>{px(e.level)}</td>
              <td>{px(e.price)}</td>
              <td className="hv-wrap">
                <small>{e.detail}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

type DrawerTab = 'Decision' | 'Checklist' | 'Scoring' | 'Structure' | 'Events' | 'History';

function H1Drawer({ symbol, version, onClose }: { symbol: string; version: string; onClose: () => void }) {
  const [detail, setDetail] = useState<H1Detail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<DrawerTab>('Decision');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetchH1Detail(symbol)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setErr(e instanceof Error ? e.message : 'Detail unavailable'));
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
  const s6 = d?.stage6;
  const su = d?.setup;
  const h = d?.h1;
  const ref = h?.lastClose;
  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer ms-drawer" role="dialog" aria-modal="true" aria-label={`${symbol} H1 confirmation decision`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 7 · H1 CONFIRMATION</small>
            <h2>
              {symbol} {d && <Badge tone={h1Tone(d.state)}>{human(d.state)}</Badge>} {d && <Badge tone={biasTone(d.expectedDirection)}>{human(d.expectedDirection)}</Badge>}
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
          {detail && !d && <p className="hr-reason">{symbol} has not been evaluated by Stage 7 yet.</p>}
          {d && (
            <>
              <Summary d={d} />
              <div className={`sd-explain ${h1Tone(d.state)}`}>
                <b>{d.reasonCode}</b>
                <span>{d.explanation}</span>
              </div>
              <Tabs items={['Decision', 'Checklist', 'Scoring', 'Structure', 'Events', 'History']} active={tab} onChange={(x) => setTab(x as DrawerTab)} idPrefix="h1-dd" label="Decision section" />
              {tab === 'Decision' && (
                <div className="kv ms-rel">
                  <span>Stage 7 state</span>
                  <b>
                    <Badge tone={h1Tone(d.state)}>{human(d.state)}</Badge> <small className="muted">{d.reason}</small>
                  </b>
                  <span>Direction authority</span>
                  <b>
                    Stage 6 {human(s6?.state)} · {human(s6?.direction)} <small className="muted">{s6?.reasonCode}: {s6?.reason}</small>
                  </b>
                  <span>Stage 6 structure</span>
                  <b>
                    {human(s6?.phase)} · {human(s6?.alignment)} · confidence {s6?.confidence != null ? s6.confidence.toFixed(0) : '—'}
                    {s6?.readySince ? <small className="muted"> · ready since {new Date(s6.readySince).toLocaleString()}</small> : null}
                  </b>
                  <span>Channel location</span>
                  <b>
                    D1 {pct(s6?.positionD1)} · H8 {pct(s6?.positionH8)} · {human(s6?.zone)}
                  </b>
                  <span>H1 data</span>
                  <b>
                    <Badge tone={d.data?.status === 'READY' ? 'green' : d.data?.status === 'STALE' ? 'amber' : 'gray'}>{human(d.data?.status)}</Badge>{' '}
                    <small className="muted">{d.data?.reason}</small>
                  </b>
                  <span>Live intrabar</span>
                  <b>{d.live ? `${px(d.live.price, ref)}${d.live.note ? ` · ${d.live.note}` : ' · no structural event'}` : 'Not monitored (not an active Stage 6 candidate)'}</b>
                  <span>Stage 8 publication</span>
                  <b>
                    {d.confirmed && d.handoff ? (
                      <>
                        <Badge tone="green">PUBLISHED TO OPPORTUNITIES &amp; RISK</Badge>
                        {d.confirmedSince ? <small className="muted"> since {new Date(d.confirmedSince).toLocaleString()}</small> : null}
                      </>
                    ) : (
                      <Badge tone="gray">NOT PUBLISHED</Badge>
                    )}
                  </b>
                  <span>Evaluated</span>
                  <b>
                    {ageText(d.evaluatedAt)} <small className="muted">changed {ageText(d.changedAt)} · {d.trigger}</small>
                  </b>
                  <span>Execution</span>
                  <b>Stage 7 never executes — confirmation only</b>
                </div>
              )}
              {tab === 'Checklist' && <Checklist d={d} />}
              {tab === 'Scoring' &&
                (d.components.length ? (
                  <>
                    <div className="table-wrap">
                      <table className="cs-table ms-components">
                        <thead>
                          <tr>
                            <th>Evidence</th>
                            <th>Points</th>
                            <th />
                            <th>Detail</th>
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
                      Sum clamped to 0–100 = confirmation score <b>{d.score.toFixed(1)}</b>. CONFIRMED additionally requires every mandatory gate to pass and a fresh BOS or CHoCH in the HTF
                      direction.
                    </p>
                  </>
                ) : (
                  <p className="hr-reason">No scoring — the decision stopped at a gate before H1 analysis ({d.reasonCode}).</p>
                ))}
              {tab === 'Structure' &&
                (h ? (
                  <>
                    <div className="kv ms-rel">
                      <span>H1 bias / swings</span>
                      <b>
                        {h.bias > 0 ? 'Bullish' : h.bias < 0 ? 'Bearish' : 'Undefined'} · {human(h.trend)} · {h.bars} closed bars · ATR {px(h.atr, ref)}
                      </b>
                      <span>Momentum</span>
                      <b>
                        5-bar {signed(h.mom5)} ATR · previous {signed(h.momPrev)} ATR · volatility {human(h.volState)} ({h.volRatio.toFixed(2)})
                      </b>
                      <span>Range (12 bars)</span>
                      <b>{h.range12Atr.toFixed(1)} ATR</b>
                      <span>Unbroken swing high / low</span>
                      <b>
                        {px(h.activeHigh, ref)} / {px(h.activeLow, ref)}
                      </b>
                      <span>Setup model</span>
                      <b>{human(su?.model)}</b>
                      <span>Pullback</span>
                      <b>
                        {human(su?.pullback)}
                        {su?.depth != null ? ` · ${(su.depth * 100).toFixed(0)}% of the prior leg` : ''}
                        {su?.extreme ? ` · extreme ${px(su.extreme.price, ref)} (${h1Label(su.extreme.ts)})` : ''}
                      </b>
                      <span>Trigger</span>
                      <b>
                        {su?.trigger
                          ? `${su.trigger.type === 'CHOCH' ? 'CHoCH' : 'BOS'} ${su.trigger.side.toLowerCase()} through ${px(su.trigger.level, ref)} · ${h1Label(su.trigger.ts)}`
                          : 'None'}
                      </b>
                      <span>Retest / false breakout</span>
                      <b>
                        {su?.falseBreakout ? `False breakout ${h1Label(su.falseBreakout.ts)}` : su?.retest ? `Retest held ${h1Label(su.retest.ts)}` : '—'}
                      </b>
                    </div>
                    <h4 className="hr-sub">Recent swings</h4>
                    <p className="hr-reason">
                      {h.swings
                        .slice(-8)
                        .map((s) => `${s.label} ${px(s.price, ref)}`)
                        .join(' → ') || 'None'}
                    </p>
                  </>
                ) : (
                  <p className="hr-reason">H1 structure is analysed only for Stage 6 READY_FOR_H1 candidates with sufficient validated H1 history.</p>
                ))}
              {tab === 'Events' && <EventsTable rows={detail.events} />}
              {tab === 'History' && <HistoryTable rows={detail.history} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function H1ConfirmationPage() {
  const { selected } = useTrading();
  const store = useH1Store();
  const scan = useScannerStore();
  const [now, setNow] = useState(Date.now());
  const [scope, setScope] = useState<'candidates' | 'all'>('candidates');
  const [query, setQuery] = useState('');
  const [chart, setChart] = useState<H1ChartData | null>(null);
  const [chartErr, setChartErr] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => startH1Store(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const run = store.state?.run ?? null;
  const list = useMemo(() => store.state?.instruments ?? [], [store.state]);
  const status = h1StageStatus(store, now);
  const age = h1RunAgeMs(store, now);
  const c = run?.counters;
  const candidates = useMemo(() => list.filter(isCandidate), [list]);

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    const base = scope === 'candidates' ? candidates : list;
    return [...base]
      .filter((d) => !q || d.symbol.includes(q))
      .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.score - a.score || a.symbol.localeCompare(b.symbol));
  }, [list, candidates, scope, query]);

  const leader = useMemo(() => pipelineFocusSymbol(), [scan.state]);
  const symbol =
    (pinned && list.some((d) => d.symbol === pinned) ? pinned : null) ??
    (leader && list.some((d) => d.symbol === leader) ? leader : null) ??
    (shown[0] ?? list.find((d) => d.symbol === selected) ?? list[0])?.symbol;
  const followingLeader = !pinned && symbol === leader;
  const d = list.find((x) => x.symbol === symbol);
  const version = `${d?.changedAt ?? ''}|${d?.evaluatedAt ?? ''}`;

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setChartErr('');
    fetchH1Chart(symbol)
      .then((x) => !cancelled && setChart(x))
      .catch((e: unknown) => !cancelled && setChartErr(e instanceof Error ? e.message : 'H1 chart unavailable'));
    return () => {
      cancelled = true;
    };
  }, [symbol, version]);

  const chartFor = chart?.symbol === symbol ? chart : null;
  const liveDecision = chartFor?.decision ?? d;

  return (
    <div className="h1-page">
      <PageHeader title="H1 Confirmation" subtitle="Confirms the Stage 6 direction on closed H1 structure — it never creates a direction (Stage 6 → Stage 7 → Stage 8)" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'ERROR' ? 'red' : 'gray'}>STAGE 7 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 7 decisions…' : 'No Stage 7 decision recorded yet')}</span>
        {age != null && (
          <span className="muted">
            Last evaluation {ageText(run?.runAt, now)}
            {run?.triggers?.length ? ` · ${run.triggers.slice(0, 4).join(', ')}` : ''}
            {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          </span>
        )}
        {run?.config && (
          <span className="muted">
            Autonomous bridge loop {run.config.service.loopSec}s · sweep {Math.round(run.config.service.fullEverySec / 60)}m · confirm ≥ {run.config.engine.confirmScore} · min{' '}
            {run.config.engine.minBars} H1 bars · Stage 6 {run.upstream?.directionStatus ?? '—'}
          </span>
        )}
        <button type="button" className="hr-run" title="Diagnostic reprocess. H1 confirmation already runs on H1 closes and Stage 6 hand-offs." disabled={store.running} onClick={() => void runH1Now()}>
          <RefreshCw size={14} className={store.running ? 'hr-spin' : undefined} />
          {store.running ? 'Evaluating…' : 'Re-evaluate now'}
        </button>
      </div>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — nothing is confirmed or published to Stage 8 while the bridge is unreachable.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 7 output is stale ({ageText(run?.runAt, now)}): confirmations below are not handed to Opportunities &amp; Risk until the engine runs again.</span>
        </div>
      )}
      {run && !candidates.length && (
        <div className="hr-banner">
          <span>
            Stage 6 has published no READY_FOR_H1 candidate, so every instrument is WAITING_FOR_STAGE6 (or blocked) with the exact Stage 6 reason. H1 does not decide direction — it only
            confirms a direction handed over by Structural Direction.
          </span>
        </div>
      )}

      <div className="metrics h1-metrics">
        <Metric label="Stage 6 candidates" value={c ? c.candidates : '—'} sub={c ? `${c.universe} instruments evaluated` : 'Awaiting Stage 7'} />
        <Metric label="H1 monitoring" value={c ? c.monitoring : '—'} sub="Monitoring · pullback · forming · confirming" />
        <Metric label="Confirmed" value={c ? c.confirmed : '—'} sub="Published to Stage 8" />
        <Metric label="Rejected" value={c ? c.rejected : '—'} sub="Failed a mandatory gate" />
        <Metric label="Invalidated" value={c ? c.invalidated : '—'} sub="H1 or upstream structure broken" />
        <Metric label="Blocked / stale" value={c ? c.blocked : '—'} sub="Data, warm-up or upstream gates" />
      </div>

      <Flow list={list} ready={candidates.length} />

      <div className="h1-layout">
        <Card>
          <div className="card-head">
            <div>
              <h3>Instruments</h3>
              <p>{scope === 'candidates' ? 'Stage 6 READY_FOR_H1 candidates' : 'All instruments with their Stage 7 state'}</p>
            </div>
          </div>
          <div className="hr-chips" role="group" aria-label="Instrument scope">
            {(['candidates', 'all'] as const).map((s) => (
              <button key={s} type="button" className={scope === s ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setScope(s)}>
                {s === 'candidates' ? 'Stage 6 candidates' : 'All'} <small>{s === 'candidates' ? candidates.length : list.length}</small>
              </button>
            ))}
          </div>
          <label className="hv-search" style={{ margin: '8px 0' }}>
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instrument" aria-label="Search instrument" />
          </label>
          <div className="h1-list" role="listbox" aria-label="H1 instruments">
            {!shown.length && (
              <p className="hr-reason">
                {scope === 'candidates'
                  ? `No Stage 6 candidate is ready for H1 confirmation.${leader ? ` Stage 4 leader ${leader} is shown until a row is pinned.` : ''}`
                  : store.loading
                    ? 'Loading…'
                    : 'No Stage 7 decisions published.'}
              </p>
            )}
            {shown.map((x) => (
              <button
                key={x.symbol}
                type="button"
                role="option"
                aria-selected={x.symbol === symbol}
                className={x.symbol === symbol ? 'on' : ''}
                onClick={() => setPinned(x.symbol)}
                title={x.explanation}
              >
                <b className={x.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{x.symbol}</b>
                <Badge tone={h1Tone(x.state)}>{human(x.state)}</Badge>
                <small>
                  {x.expectedDirection !== 'NEUTRAL' ? `${human(x.expectedDirection)} · ` : ''}
                  {x.reasonCode}
                </small>
              </button>
            ))}
          </div>
        </Card>

        <div className="h1-main">
          {!d ? (
            <Card>
              <div className="empty-block">
                <b>{store.loading ? 'Loading…' : 'No Stage 7 decision'}</b>
                <span>{store.error || 'The bridge evaluates every instrument on startup from the Stage 6 publication and Stage 1 H1 history.'}</span>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <div className="card-head">
                  <div>
                    <h3>
                      {d.symbol} <Badge tone={h1Tone(d.state)}>{human(d.state)}</Badge>{' '}
                      {d.expectedDirection !== 'NEUTRAL' && <Badge tone={biasTone(d.expectedDirection)}>{human(d.expectedDirection)}</Badge>}
                    </h3>
                    <p>
                      {followingLeader ? `Stage 4 leader · ` : pinned ? `Pinned · ` : ''}
                      HTF direction (Stage 6): {human(d.stage6?.direction ?? 'NEUTRAL')} · {human(d.stage6?.state ?? 'not evaluated')} · H1 phase: {human(d.phase ?? d.state)}
                    </p>
                  </div>
                  <button type="button" className="hr-run" onClick={() => setDrawer(d.symbol)}>
                    Drill-down
                  </button>
                </div>
                <div className={`sd-explain ${h1Tone(d.state)}`}>
                  <b>{d.reasonCode}</b>
                  <span>{d.reason}</span>
                  {d.live?.note && <span className="muted">{d.live.note}</span>}
                </div>
                <Summary d={d} />
              </Card>

              <Card>
                <div className="card-head">
                  <div>
                    <h3>H1 Structure</h3>
                    <p>
                      Closed H1 candles from the Stage 1 store · swings HH/HL/LH/LL · BOS/CHoCH · pullback zone · D1/H8 boundaries from Stage 5 · invalidation
                      {chartFor?.live ? ` · live ${px(chartFor.live.price, chartFor.live.price)}` : ''}
                    </p>
                  </div>
                  <Badge tone={d.data?.status === 'READY' ? 'green' : d.data?.status === 'STALE' ? 'amber' : 'gray'}>H1 {human(d.data?.status ?? 'UNKNOWN')}</Badge>
                </div>
                {chartErr && (
                  <div className="hr-banner err">
                    <AlertTriangle size={14} />
                    <span>{chartErr}</span>
                  </div>
                )}
                {chartFor && chartFor.candles.length ? (
                  <>
                    <H1Chart
                      candles={chartFor.candles}
                      swings={chartFor.swings}
                      events={chartFor.events}
                      channels={chartFor.channels}
                      setup={liveDecision?.setup ?? null}
                      invalidation={liveDecision?.invalidationLevel ?? null}
                      direction={liveDecision?.expectedDirection ?? 'NEUTRAL'}
                      livePrice={chartFor.live?.price ?? null}
                    />
                    {!isCandidate(d) && (
                      <p className="hr-reason">
                        H1 context only — {d.symbol} is not a Stage 6 READY_FOR_H1 candidate, so no pullback zone, trigger or invalidation is evaluated.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="empty-block">
                    <b>{chartFor ? 'No stored H1 candles' : chartErr ? 'H1 chart unavailable' : 'Loading H1 chart…'}</b>
                    <span>{d.data?.reason ?? 'Stage 1 has not stored validated H1 history for this instrument.'}</span>
                  </div>
                )}
              </Card>

              <Card>
                <div className="card-head">
                  <div>
                    <h3>Confirmation Checklist</h3>
                    <p>Every gate from actual evidence · PASS / WAIT / FAIL / STALE / N/A · CONFIRMED only when every mandatory gate passes</p>
                  </div>
                  <Badge tone={h1Tone(d.state)}>{d.components.length ? `score ${d.score.toFixed(0)}` : 'not scored'}</Badge>
                </div>
                <Checklist d={d} />
              </Card>
            </>
          )}
        </div>
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>H1 Structural Events</h3>
            <p>BOS · CHoCH · pullback completion · retest · false breakout · invalidation · confirmation — persisted in dbo.app_h1_event</p>
          </div>
        </div>
        <EventsTable rows={store.state?.events ?? []} onSymbol={setPinned} />
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Decision History</h3>
            <p>Every Stage 7 state change with its trigger · persisted in dbo.app_h1_history</p>
          </div>
          <Badge tone="blue">{store.state?.runs.length ?? 0} recent runs</Badge>
        </div>
        <HistoryTable rows={store.state?.history ?? []} onSymbol={(s) => { setPinned(s); setDrawer(s); }} />
      </Card>

      {drawer && <H1Drawer symbol={drawer} version={version} onClose={() => setDrawer(null)} />}
    </div>
  );
}
