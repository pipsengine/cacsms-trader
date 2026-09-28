import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Database, RefreshCw, Search, ShieldCheck, Wrench, X } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTrading } from '../../context/TradingContext';
import { Badge, Card, Metric } from '../../components/UI';
import {
  fetchHistorySeries,
  requestHistoryRepair,
  requestHistorySync,
  requestHistoryValidate,
  serverTime,
  setHistoryExecutionTimeframes,
  type HistoryCandle,
  type HistoryJob,
  type HistoryJobState,
  type HistorySeries,
  type HistoryStatusCode,
} from './services/historyClient';
import { refreshHistory, useHistoryStore } from './services/historyStore';

const STATUS_TONE: Record<HistoryStatusCode, string> = {
  READY: 'green',
  SYNCING: 'blue',
  STALE: 'amber',
  WARMING_UP: 'amber',
  MISSING_HISTORY: 'red',
  VALIDATION_FAILED: 'red',
  PROVIDER_OFFLINE: 'red',
};

const JOB_TONE: Record<HistoryJobState, string> = {
  QUEUED: 'gray',
  RUNNING: 'blue',
  VALIDATING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  RETRYING: 'amber',
  STALE: 'gray',
  BLOCKED: 'red',
};

const STATUS_FILTERS: Array<HistoryStatusCode | 'ALL'> = [
  'ALL',
  'READY',
  'SYNCING',
  'STALE',
  'WARMING_UP',
  'MISSING_HISTORY',
  'VALIDATION_FAILED',
  'PROVIDER_OFFLINE',
];

type SortKey = 'symbol' | 'status' | 'count' | 'completeness' | 'quality' | 'latest';

const PAGE_SIZE = 15;

const pct = (v?: number | null, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}%`);
const localTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function ago(iso?: string | null): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function duration(sec?: number | null): string {
  if (sec == null) return '—';
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function SeriesPager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="md-pager">
      <span>
        {from}–{to} of {total}
      </span>
      <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page + 1} / {pages}
      </span>
      <button type="button" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-block">
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryStatusCode }) {
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{status.replace('_', ' ')}</Badge>;
}

function SeriesDrawer({ symbol, timeframe, onClose }: { symbol: string; timeframe: string; onClose: () => void }) {
  const [series, setSeries] = useState<HistorySeries | null>(null);
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [candles, setCandles] = useState<HistoryCandle[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetchHistorySeries(symbol, timeframe);
        if (cancelled) return;
        setSeries(r.series);
        setJobs(r.jobs || []);
        setCandles(r.candles || []);
        setErr('');
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Unable to load series');
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [symbol, timeframe]);

  const chart = useMemo(() => candles.map((c) => ({ t: serverTime(c.ts), close: c.close })), [candles]);

  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer md-drawer-wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>HISTORICAL SERIES</small>
            <h2>
              {symbol} · {timeframe}
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          {err && <p className="alert">{err}</p>}
          {busy && !series && <p className="muted">Loading series from db_Cacsms-Trader…</p>}
          {!busy && !series && !err && <Empty title="Series not planned yet" detail="The synchronizer creates it on its next planning cycle." />}
          {series && (
            <>
              <div className="md-kpi">
                <div>
                  <span>Status</span>
                  <b>
                    <StatusBadge status={series.status} />
                  </b>
                </div>
                <div>
                  <span>Candles</span>
                  <b>
                    {series.count.toLocaleString()}
                    {series.count < series.requiredDepth && <small className="muted"> / {series.requiredDepth.toLocaleString()}</small>}
                  </b>
                </div>
                <div>
                  <span>Completeness</span>
                  <b>{pct(series.completeness, 2)}</b>
                </div>
                <div>
                  <span>Quality</span>
                  <b>{series.quality == null ? '—' : series.quality}</b>
                </div>
              </div>
              <p className="muted md-reason">{series.reason}</p>
              <div className="kv">
                <span>Earliest (server)</span>
                <b>{serverTime(series.earliestTs)}</b>
                <span>Latest closed (server)</span>
                <b>{serverTime(series.latestTs)}</b>
                <span>Provider latest closed</span>
                <b>{serverTime(series.providerLatestTs)}</b>
                <span>Readiness floor</span>
                <b>{series.minRequired.toLocaleString()} candles</b>
                <span>Source</span>
                <b>{series.source || '—'}</b>
                <span>Source note</span>
                <b>{series.sourceNote || '—'}</b>
                <span>Provider depth</span>
                <b>{series.providerExhausted ? `Exhausted at ${series.providerDepth ?? series.count}` : 'Not exhausted'}</b>
                <span>Missing / integrity</span>
                <b>
                  {series.missingBars ?? 0} missing · {series.integrityErrors ?? 0} integrity errors
                </b>
                <span>Last sync</span>
                <b>{localTime(series.lastSyncAt)}</b>
                <span>Last success</span>
                <b>{localTime(series.lastSuccessAt)}</b>
                <span>Last validated</span>
                <b>{localTime(series.lastValidatedAt)}</b>
                <span>Last repair</span>
                <b>{localTime(series.lastRepairAt)}</b>
                {series.lastError && (
                  <>
                    <span>Last error</span>
                    <b className="negative">{series.lastError}</b>
                  </>
                )}
              </div>

              <h4 className="md-section">Validation</h4>
              {!series.issues.length ? (
                <p className="muted">No validation issues.</p>
              ) : (
                <ul className="md-issues">
                  {series.issues.map((i, n) => (
                    <li key={`${i.code}-${n}`}>
                      <Badge tone={i.severity === 'ERROR' ? 'red' : i.severity === 'WARNING' ? 'amber' : 'blue'}>{i.code}</Badge>
                      <span>{i.message}</span>
                      {i.sample?.length ? <small className="muted">{i.sample.join(' · ')}</small> : null}
                    </li>
                  ))}
                </ul>
              )}
              {series.gaps.length > 0 && (
                <>
                  <h4 className="md-section">Abnormal gaps ({series.gaps.length})</h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>From (server)</th>
                          <th>To (server)</th>
                          <th>Missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.gaps.slice(0, 30).map((g) => (
                          <tr key={`${g[0]}-${g[1]}`}>
                            <td>{serverTime(g[0])}</td>
                            <td>{serverTime(g[1])}</td>
                            <td>{g[2]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {chart.length > 1 && (
            <>
              <h4 className="md-section">Last {chart.length} stored closes</h4>
              <div className="md-chart">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={chart}>
                    <XAxis dataKey="t" hide />
                    <YAxis domain={['auto', 'auto']} width={64} tick={{ fill: '#8395ad', fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: '#0b1626', border: '1px solid #1d3048' }} />
                    <Line type="monotone" dataKey="close" stroke="#35c8e6" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <h4 className="md-section">Sync history</h4>
          {!jobs.length ? (
            <p className="muted">No jobs recorded for this series.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Job</th>
                    <th>Trigger</th>
                    <th>State</th>
                    <th>Fetched / New</th>
                    <th>Finished</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td>{j.id}</td>
                      <td>{j.type}</td>
                      <td>{j.trigger}</td>
                      <td>
                        <Badge tone={JOB_TONE[j.state]}>{j.state}</Badge>
                      </td>
                      <td>
                        {j.fetched} / {j.inserted}
                        {j.revised ? ` (${j.revised} rev)` : ''}
                      </td>
                      <td>{ago(j.finishedAt || j.startedAt || j.createdAt)}</td>
                      <td className="md-msg">{j.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4 className="md-section">Stored candles (latest 40)</h4>
          {!candles.length ? (
            <p className="muted">No candles persisted yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Open (server)</th>
                    <th>O</th>
                    <th>H</th>
                    <th>L</th>
                    <th>C</th>
                    <th>Vol</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {[...candles]
                    .reverse()
                    .slice(0, 40)
                    .map((c) => (
                      <tr key={c.ts}>
                        <td>{serverTime(c.ts)}</td>
                        <td>{c.open}</td>
                        <td>{c.high}</td>
                        <td>{c.low}</td>
                        <td>{c.close}</td>
                        <td>{c.volume}</td>
                        <td>
                          {c.source}
                          {c.revisedAt ? ' · revised' : ''}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function HistoricalDataTab() {
  const { selected, setSelected } = useTrading();
  const { status, events, error, loading } = useHistoryStore();
  const [symbol, setSymbol] = useState(selected || 'EURUSD');
  const [tf, setTf] = useState('H1');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusCode | 'ALL'>('ALL');
  const [tfFilter, setTfFilter] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('symbol');
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState<{ symbol: string; timeframe: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const universe = useMemo(() => status?.instruments.map((i) => i.symbol) ?? [], [status]);
  const timeframes = status?.config.timeframes ?? ['MN1', 'W1', 'D1', 'H8', 'H1'];
  const current = status?.series.find((s) => s.symbol === symbol && s.timeframe === tf);

  useEffect(() => {
    if (!timeframes.includes(tf)) setTf('H1');
  }, [timeframes, tf]);

  const rows = useMemo(() => {
    let list = [...(status?.series ?? [])];
    if (q.trim()) {
      const s = q.trim().toUpperCase();
      list = list.filter((r) => r.symbol.includes(s));
    }
    if (statusFilter !== 'ALL') list = list.filter((r) => r.status === statusFilter);
    if (tfFilter !== 'ALL') list = list.filter((r) => r.timeframe === tfFilter);
    const order = timeframes;
    list.sort((a, b) => {
      if (sort === 'status') return a.status.localeCompare(b.status) || a.symbol.localeCompare(b.symbol);
      if (sort === 'count') return b.count - a.count;
      if (sort === 'completeness') return (a.completeness ?? -1) - (b.completeness ?? -1);
      if (sort === 'quality') return (a.quality ?? -1) - (b.quality ?? -1);
      if (sort === 'latest') return (a.latestTs ?? 0) - (b.latestTs ?? 0);
      return a.symbol.localeCompare(b.symbol) || order.indexOf(a.timeframe) - order.indexOf(b.timeframe);
    });
    return list;
  }, [status, q, statusFilter, tfFilter, sort, timeframes]);

  const filterKey = `${q}|${statusFilter}|${tfFilter}|${sort}|${rows.length}`;
  useEffect(() => setPage(0), [filterKey]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const act = async (label: string, fn: () => Promise<{ message?: string } & Record<string, unknown>>) => {
    setBusy(label);
    setNotice('');
    try {
      const r = await fn();
      setNotice(`${label}: ${typeof r.message === 'string' ? r.message : 'done'}`);
      void refreshHistory();
    } catch (e) {
      setNotice(`${label} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy('');
    }
  };

  const validate = (target: { symbol?: string; timeframe?: string }) =>
    act('Validate', async () => {
      const r = await requestHistoryValidate(target);
      const ready = r.results.filter((x) => x.status === 'READY').length;
      return { message: `${r.validated} series validated · ${ready} READY` };
    });

  const queue = status?.queue;
  const counts = queue?.counts ?? {};
  const provider = status?.provider;
  const scheduler = status?.scheduler;
  const summary = status?.summary;

  if (!status) {
    return (
      <Card>
        {loading ? (
          <p className="muted">Connecting to the autonomous historical synchronizer…</p>
        ) : (
          <Empty title="Historical synchronizer unreachable" detail={error || 'Start the MT5 bridge with npm run mt5:bridge.'} />
        )}
      </Card>
    );
  }

  return (
    <>
      <div className="metrics">
        <Metric
          label={`${symbol} · ${tf}`}
          value={current ? current.status.replace('_', ' ') : '—'}
          sub={current?.reason || 'Not planned yet'}
        />
        <Metric
          label="Stored Candles"
          value={current ? current.count.toLocaleString() : '—'}
          sub={current?.earliestTs ? `${serverTime(current.earliestTs, false)} → ${serverTime(current.latestTs)}` : 'No candles persisted'}
        />
        <Metric
          label="Completeness · Quality"
          value={current ? `${pct(current.completeness, 2)} · ${current.quality ?? '—'}` : '—'}
          sub={current ? `Last success ${ago(current.lastSuccessAt)} · fresh ${duration(current.freshnessSec)}` : '—'}
        />
        <Metric
          label="Instruments READY"
          value={`${summary?.instrumentsReady ?? 0} / ${universe.length}`}
          sub={`${summary?.ready ?? 0}/${summary?.series ?? 0} series · ${(summary?.candles ?? 0).toLocaleString()} candles`}
        />
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>Historical Synchronization</h3>
            <p>Autonomous MT5 → validation → db_Cacsms-Trader — {timeframes.join(' → ')}</p>
          </div>
          <div className="md-badges">
            <Badge tone={provider?.connected ? (provider.feedStale ? 'amber' : 'green') : 'red'}>
              <Activity size={12} /> {provider?.connected ? (provider.feedStale ? 'Feed stale' : 'Provider online') : 'Provider offline'}
            </Badge>
            <Badge tone={scheduler?.running && scheduler.workerAlive ? 'green' : 'red'}>
              <RefreshCw size={12} /> {scheduler?.running && scheduler.workerAlive ? 'Autonomous' : 'Scheduler stopped'}
            </Badge>
            {scheduler?.recovering && <Badge tone="amber">Recovering</Badge>}
          </div>
        </div>
        <div className="md-toolbar">
          <select
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setSelected(e.target.value);
            }}
          >
            {universe.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={tf} onChange={(e) => setTf(e.target.value)}>
            {timeframes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            disabled={!!busy}
            onClick={() => void act('Sync Selected', () => requestHistorySync({ symbol, timeframe: tf }))}
          >
            <RefreshCw size={14} /> Sync Selected
          </button>
          <button type="button" disabled={!!busy} onClick={() => void act('Sync All 29', () => requestHistorySync({}))}>
            <Database size={14} /> Sync All {universe.length}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void act('Repair Missing Data', () => requestHistoryRepair({}))}>
            <Wrench size={14} /> Repair Missing Data
          </button>
          <button type="button" disabled={!!busy} onClick={() => void validate({})}>
            <ShieldCheck size={14} /> Validate
          </button>
          <label className="md-toggle" title="Execution-refinement timeframes (Stage 9)">
            <input
              type="checkbox"
              checked={status.config.executionEnabled}
              disabled={!!busy}
              onChange={(e) =>
                void act('Execution timeframes', async () => {
                  const r = await setHistoryExecutionTimeframes(e.target.checked);
                  return { message: `M15/M5 ${r.executionEnabled ? 'enabled' : 'disabled'}` };
                })
              }
            />
            M15 / M5
          </label>
        </div>
        <p className="muted md-note">
          Synchronization runs continuously in the MT5 bridge — on startup, reconnect and every candle close — whether or not this
          page is open. These controls are administrative overrides for initialization, recovery and audit.
        </p>
        {busy && <p className="muted">{busy}…</p>}
        {notice && <p className={notice.includes('failed') ? 'alert' : 'muted'}>{notice}</p>}
      </Card>

      <div className="grid-2">
        <Card>
          <div className="card-head">
            <div>
              <h3>Provider & Scheduler</h3>
              <p>Live runtime of the background synchronizer</p>
            </div>
          </div>
          <div className="kv">
            <span>Provider</span>
            <b>
              {provider?.connected ? `${provider.server ?? 'MT5'} · login ${provider.login ?? '—'}` : provider?.message || 'Offline'}
            </b>
            <span>Server clock</span>
            <b>
              {provider?.serverNow ? provider.serverNow.replace('T', ' ') : '—'}
              {provider?.serverOffsetSec != null ? ` (UTC${provider.serverOffsetSec >= 0 ? '+' : ''}${provider.serverOffsetSec / 3600})` : ''}
            </b>
            <span>Offset source</span>
            <b>{provider?.offsetSource || '—'}</b>
            <span>Last tick (server)</span>
            <b>{provider?.lastTickServer ? provider.lastTickServer.replace('T', ' ') : '—'}</b>
            <span>FX market</span>
            <b>{provider?.marketOpen ? 'Open' : 'Closed (weekend)'}</b>
            <span>Planner cycle</span>
            <b>
              {ago(scheduler?.lastCycleAt)} · {scheduler?.cycleMs ?? '—'} ms · every {scheduler?.intervalSec}s
            </b>
            <span>Worker</span>
            <b>{scheduler?.workerAlive ? 'Alive' : 'Not responding'}</b>
            <span>Closure calendar</span>
            <b>{scheduler?.closures ?? 0} market-wide weekday closures</b>
            <span>Errors</span>
            <b className={scheduler?.errors ? 'negative' : ''}>
              {scheduler?.errors ?? 0}
              {scheduler?.lastError ? ` · ${scheduler.lastError}` : ''}
            </b>
          </div>
        </Card>
        <Card>
          <div className="card-head">
            <div>
              <h3>Job Queue</h3>
              <p>Persistent, restart-safe (dbo.app_hist_job) — last 24h</p>
            </div>
            <Badge tone={queue?.open ? 'blue' : 'green'}>{queue?.open ? `${queue.open} open` : 'Idle'}</Badge>
          </div>
          <div className="chips md-states">
            {(['QUEUED', 'RUNNING', 'VALIDATING', 'COMPLETED', 'RETRYING', 'FAILED', 'STALE', 'BLOCKED'] as HistoryJobState[]).map((s) => (
              <span key={s}>
                <Badge tone={JOB_TONE[s]}>{s}</Badge> {counts[s] ?? 0}
              </span>
            ))}
          </div>
          <div className="kv" style={{ marginTop: 12 }}>
            <span>Current job</span>
            <b>
              {queue?.current
                ? `#${queue.current.id} ${queue.current.type} ${queue.current.symbol} ${queue.current.timeframe} · ${queue.current.state} · ${queue.current.runningSec}s`
                : 'None'}
            </b>
            <span>Next up</span>
            <b>
              {queue?.next.length
                ? queue.next
                    .filter((j) => j.state === 'QUEUED' || j.state === 'RETRYING')
                    .slice(0, 4)
                    .map((j) => `${j.type} ${j.symbol} ${j.timeframe}`)
                    .join(' · ') || '—'
                : '—'}
            </b>
            <span>Avg completeness</span>
            <b>{pct(summary?.completeness, 2)}</b>
            <span>Avg quality</span>
            <b>{summary?.quality ?? '—'}</b>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>Stage 1 History Readiness</h3>
            <p>Per instrument: AVAILABLE + COMPLETE + VALID + FRESH across {timeframes.join('/')} — blocking is per instrument</p>
          </div>
          <Badge tone={summary?.instrumentsReady ? 'green' : 'amber'}>
            <CheckCircle2 size={12} /> {summary?.instrumentsReady ?? 0} / {universe.length} READY
          </Badge>
        </div>
        <div className="md-ready-grid">
          {status.instruments.map((i) => (
            <button
              type="button"
              key={i.symbol}
              className={`md-ready ${i.ready ? 'ok' : ''} ${symbol === i.symbol ? 'active' : ''}`}
              title={i.reason}
              onClick={() => {
                setSymbol(i.symbol);
                setSelected(i.symbol);
              }}
            >
              <b>{i.symbol}</b>
              <span className="md-ready-tfs">
                {timeframes.map((t) => (
                  <i key={t} className={`tf ${(i.series[t] ?? 'MISSING_HISTORY').toLowerCase()}`} title={`${t}: ${i.series[t] ?? '—'}`} />
                ))}
              </span>
              <small>{i.ready ? 'READY' : i.status.replace('_', ' ')}</small>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Series Status</h3>
            <p>
              {rows.length} of {status.series.length} instrument/timeframe series — click a row for drill-down
            </p>
          </div>
        </div>
        <div className="md-toolbar">
          <label className="md-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search instrument…" />
          </label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as HistoryStatusCode | 'ALL')}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : s}
              </option>
            ))}
          </select>
          <select value={tfFilter} onChange={(e) => setTfFilter(e.target.value)}>
            <option value="ALL">All timeframes</option>
            {timeframes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="symbol">Sort: Instrument</option>
            <option value="status">Sort: Status</option>
            <option value="count">Sort: Candles</option>
            <option value="completeness">Sort: Completeness ↑</option>
            <option value="quality">Sort: Quality ↑</option>
            <option value="latest">Sort: Oldest latest candle</option>
          </select>
        </div>
        {!rows.length ? (
          <Empty title="No series match" detail="Adjust the search or filters." />
        ) : (
          <div className="table-wrap">
            <SeriesPager page={safePage} pages={pages} total={rows.length} onPage={setPage} />
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>TF</th>
                  <th>Status</th>
                  <th>Candles</th>
                  <th>Earliest (server)</th>
                  <th>Latest (server)</th>
                  <th>Completeness</th>
                  <th>Quality</th>
                  <th>Last Success</th>
                  <th>Freshness</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={`${r.symbol}-${r.timeframe}`}
                    className={r.symbol === symbol && r.timeframe === tf ? 'row-selected' : ''}
                    onClick={() => {
                      setSymbol(r.symbol);
                      setTf(r.timeframe);
                      setDrawer({ symbol: r.symbol, timeframe: r.timeframe });
                    }}
                    title={r.reason || ''}
                  >
                    <td>
                      <b>{r.symbol}</b>
                    </td>
                    <td>{r.timeframe}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      {r.count.toLocaleString()}
                      {r.count < r.requiredDepth && (
                        <small className="muted" title={r.providerExhausted ? 'Provider holds no older candles' : 'Backfill target'}>
                          {' '}
                          / {r.requiredDepth.toLocaleString()}
                          {r.providerExhausted ? ' (provider max)' : ''}
                        </small>
                      )}
                    </td>
                    <td>{serverTime(r.earliestTs, false)}</td>
                    <td>{serverTime(r.latestTs)}</td>
                    <td>{pct(r.completeness, 2)}</td>
                    <td>{r.quality ?? '—'}</td>
                    <td>{ago(r.lastSuccessAt)}</td>
                    <td>{duration(r.freshnessSec)}</td>
                    <td>{r.source === 'DERIVED_H1' ? 'H1→H8' : r.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <SeriesPager page={safePage} pages={pages} total={rows.length} onPage={setPage} />
          </div>
        )}
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Synchronizer Audit Log</h3>
            <p>Persisted events (dbo.app_hist_event) — published to the Workflow Engine</p>
          </div>
        </div>
        {!events.length ? (
          <Empty title="No events yet" detail="Events appear as the synchronizer plans, fetches, validates and repairs." />
        ) : (
          <div className="table-wrap md-log">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Series</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 60).map((e) => (
                  <tr key={e.id}>
                    <td>{localTime(e.at)}</td>
                    <td>
                      <Badge tone={e.severity === 'ERROR' ? 'red' : e.severity === 'WARNING' ? 'amber' : 'blue'}>{e.kind}</Badge>
                    </td>
                    <td>{e.symbol ? `${e.symbol} ${e.timeframe ?? ''}` : '—'}</td>
                    <td className="md-msg">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {drawer && <SeriesDrawer symbol={drawer.symbol} timeframe={drawer.timeframe} onClose={() => setDrawer(null)} />}
    </>
  );
}
