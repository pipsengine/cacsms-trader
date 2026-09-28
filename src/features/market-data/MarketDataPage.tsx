import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Radio, Search, Wifi, X } from 'lucide-react';
import { allPairs } from '../../data/market';
import { useTrading } from '../../context/TradingContext';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import {
  bridgeBars,
  bridgeDbHealth,
  bridgeHealth,
  type BridgeBar,
} from '../mt5-connection/services/mt5BridgeClient';
import { getMT5Snapshot } from '../mt5-connection/services/cacsmsMT5Runtime';
import {
  activeOverlaps,
  getAllSessionStatuses,
  instrumentsForSession,
  isFxMarketOpen,
  nextTransition,
  type NamedSession,
} from './services/sessions';
import { buildQualityIssues, freshnessSec, historyQualityIssues, stage1Summary } from './services/stage1Gate';
import { useHistoryStore } from './services/historyStore';
import { HistoricalDataTab } from './HistoricalDataTab';
import type { Instrument } from '../../types';
import './market-data.css';

const dirTone = (x: string) => (x === 'BULLISH' ? 'green' : x === 'BEARISH' ? 'red' : 'gray');
const TIMEFRAMES = ['MN1', 'W1', 'D1', 'H8', 'H1', 'M15', 'M5'] as const;

type SortKey = 'symbol' | 'spread' | 'change' | 'score' | 'state';

const PAGE_SIZE = 15;

function TablePager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
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

function InstrumentDrawer({
  symbol,
  onClose,
  row,
}: {
  symbol: string;
  onClose: () => void;
  row?: Instrument;
}) {
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>('H1');
  const [bars, setBars] = useState<BridgeBar[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setErr('');
      const r = await bridgeBars(symbol, tf, 80);
      if (cancelled) return;
      setBusy(false);
      if (!r.ok) setErr(r.message || 'Unable to load candles from MT5');
      setBars(r.bars || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf]);

  const fresh = freshnessSec(row?.lastTickAt);

  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>INSTRUMENT DETAIL</small>
            <h2>{symbol}</h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          <div className="md-kpi">
            <div>
              <span>Bid</span>
              <b>{row?.bid || '—'}</b>
            </div>
            <div>
              <span>Ask</span>
              <b>{row?.ask || '—'}</b>
            </div>
            <div>
              <span>Spread</span>
              <b>{row?.spread ?? '—'}</b>
            </div>
            <div>
              <span>Freshness</span>
              <b>{fresh == null ? '—' : `${fresh}s`}</b>
            </div>
          </div>
          <div className="md-tf-tabs">
            {TIMEFRAMES.map((t) => (
              <button type="button" key={t} className={tf === t ? 'active' : ''} onClick={() => setTf(t)}>
                {t}
              </button>
            ))}
          </div>
          {err && <p className="alert">{err}</p>}
          {busy && <p className="muted">Loading candles from MT5…</p>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>O</th>
                  <th>H</th>
                  <th>L</th>
                  <th>C</th>
                  <th>Vol</th>
                </tr>
              </thead>
              <tbody>
                {[...bars].reverse().slice(0, 40).map((b) => (
                  <tr key={b.time}>
                    <td>{new Date(b.time).toLocaleString()}</td>
                    <td>{b.open}</td>
                    <td>{b.high}</td>
                    <td>{b.low}</td>
                    <td>{b.close}</td>
                    <td>{b.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!bars.length && !busy && <Empty title="No candles" detail="MT5 returned no bars for this timeframe." />}
          <div className="kv" style={{ marginTop: 12 }}>
            <span>D1</span>
            <b>{row?.d1 || '—'}</b>
            <span>H8</span>
            <b>{row?.h8 || '—'}</b>
            <span>H1</span>
            <b>{row?.h1 || '—'}</b>
            <span>Score</span>
            <b>{row?.score ?? '—'}</b>
            <span>Last tick</span>
            <b>{row?.lastTickAt ? new Date(row.lastTickAt).toLocaleString() : '—'}</b>
          </div>
        </div>
      </aside>
    </div>
  );
}

function LiveMarketTab() {
  const { instruments, selected, setSelected } = useTrading();
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('symbol');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const marketOpen = isFxMarketOpen();

  const rows = useMemo(() => {
    let list = [...instruments];
    if (!list.length) {
      list = allPairs.map((symbol) => ({
        symbol,
        kind: symbol === 'XAUUSD' ? ('GOLD' as const) : ('FX' as const),
        bid: 0,
        ask: 0,
        spread: 0,
        change: 0,
        d1: 'NEUTRAL' as const,
        h8: 'NEUTRAL' as const,
        h1: 'WAITING_FOR_STAGE6',
        score: 0,
        state: 'WAIT' as const,
        strengthDiff: 0,
        channelPos: 50,
        confidence: 0,
      }));
    }
    if (q.trim()) {
      const s = q.trim().toUpperCase();
      list = list.filter((i) => i.symbol.includes(s));
    }
    if (stateFilter !== 'ALL') list = list.filter((i) => i.state === stateFilter);
    list.sort((a, b) => {
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol);
      if (sort === 'spread') return (b.spread || 0) - (a.spread || 0);
      if (sort === 'change') return (b.change || 0) - (a.change || 0);
      if (sort === 'score') return (b.score || 0) - (a.score || 0);
      return a.state.localeCompare(b.state);
    });
    return list;
  }, [instruments, q, stateFilter, sort]);

  const filterKey = `${q}|${stateFilter}|${sort}|${rows.length}`;
  useEffect(() => setPage(0), [filterKey]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const liveCount = instruments.filter((i) => i.bid > 0).length;

  return (
    <>
      <div className="metrics">
        <Metric label="Market" value={marketOpen ? 'OPEN' : 'CLOSED'} sub={marketOpen ? 'FX week session' : 'Weekend / off hours'} />
        <Metric label="Quoted" value={`${liveCount} / ${allPairs.length}`} sub="Instruments with live bid" />
        <Metric label="Ready" value={instruments.filter((i) => i.state === 'READY').length} sub="H1 confirmed" />
        <Metric label="Filtered" value={rows.length} sub="Visible rows" />
      </div>
      <Card>
        <div className="card-head">
          <div>
            <h3>Live Instruments</h3>
            <p>Real-time MT5 bid/ask with structure enrichment</p>
          </div>
          <Badge tone={liveCount ? 'green' : 'gray'}>
            <Radio size={12} /> {liveCount ? 'streaming' : 'awaiting feed'}
          </Badge>
        </div>
        <div className="md-toolbar">
          <label className="md-search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search instrument…" />
          </label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            {['ALL', 'READY', 'WAIT', 'BLOCKED', 'ACTIVE'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="symbol">Sort: Symbol</option>
            <option value="spread">Sort: Spread</option>
            <option value="change">Sort: 24h</option>
            <option value="score">Sort: Score</option>
            <option value="state">Sort: State</option>
          </select>
        </div>
        {!liveCount ? (
          <Empty title="No live quotes yet" detail="Connect an MT5 account and keep npm run mt5:bridge running." />
        ) : (
          <div className="table-wrap">
            <TablePager page={safePage} pages={pages} total={rows.length} onPage={setPage} />
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Bid</th>
                  <th>Ask</th>
                  <th>Spread</th>
                  <th>24h</th>
                  <th>Session</th>
                  <th>D1</th>
                  <th>H8</th>
                  <th>H1</th>
                  <th>Score</th>
                  <th>Fresh</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((x) => {
                  const fresh = freshnessSec(x.lastTickAt);
                  return (
                    <tr
                      key={x.symbol}
                      className={selected === x.symbol ? 'row-selected' : ''}
                      onClick={() => {
                        setSelected(x.symbol);
                        setDrawer(x.symbol);
                      }}
                    >
                      <td>
                        <b>{x.symbol}</b>
                      </td>
                      <td>{x.bid || '—'}</td>
                      <td>{x.ask || '—'}</td>
                      <td>{x.spread || '—'}</td>
                      <td className={x.change >= 0 ? 'positive' : 'negative'}>
                        {x.change ? `${x.change > 0 ? '+' : ''}${x.change}%` : '—'}
                      </td>
                      <td>
                        <Badge tone={marketOpen ? 'green' : 'amber'}>{marketOpen ? 'Open' : 'Closed'}</Badge>
                      </td>
                      <td>
                        <Badge tone={dirTone(x.d1)}>{x.d1 === 'BULLISH' ? '↑' : x.d1 === 'BEARISH' ? '↓' : '→'}</Badge>
                      </td>
                      <td>
                        <Badge tone={dirTone(x.h8)}>{x.h8 === 'BULLISH' ? '↑' : x.h8 === 'BEARISH' ? '↓' : '→'}</Badge>
                      </td>
                      <td>{x.h1}</td>
                      <td>
                        <b>{x.score > 0 ? x.score : '—'}</b>
                      </td>
                      <td>{fresh == null ? '—' : `${fresh}s`}</td>
                      <td>
                        <Badge tone={x.state === 'READY' ? 'green' : x.state === 'BLOCKED' ? 'red' : 'amber'}>{x.state}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePager page={safePage} pages={pages} total={rows.length} onPage={setPage} />
          </div>
        )}
      </Card>
      {drawer && <InstrumentDrawer symbol={drawer} row={instruments.find((i) => i.symbol === drawer)} onClose={() => setDrawer(null)} />}
    </>
  );
}

function SessionsTab() {
  const { instruments } = useTrading();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const sessions = getAllSessionStatuses(now);
  const overlap = activeOverlaps(now);
  const next = nextTransition(now);
  const symbols = instruments.length ? instruments.map((i) => i.symbol) : [...allPairs];

  return (
    <>
      <div className="metrics">
        <Metric label="Active" value={overlap.label} sub={overlap.overlap ? 'Overlap in progress' : 'Primary session'} />
        <Metric label="FX Week" value={isFxMarketOpen(now) ? 'OPEN' : 'CLOSED'} sub="Sun 22:00–Fri 22:00 UTC" />
        <Metric
          label="Next Transition"
          value={next ? `${next.session} → ${next.becomes}` : '—'}
          sub={next ? `In ~${next.inMinutes} min` : 'No change soon'}
        />
        <Metric label="Open Sessions" value={sessions.filter((s) => s.open).length} sub={`of ${sessions.length}`} />
      </div>
      <div className="md-session-grid">
        {sessions.map((s) => (
          <Card key={s.id}>
            <div className="card-head">
              <div>
                <h3>{s.name}</h3>
                <p>{s.timezone}</p>
              </div>
              <Badge tone={s.open ? 'green' : 'gray'}>{s.status}</Badge>
            </div>
            <div className="kv">
              <span>Local time</span>
              <b>{s.localTime}</b>
              <span>Hours (local)</span>
              <b>
                {String(s.openHourLocal).padStart(2, '0')}:00 – {String(s.closeHourLocal).padStart(2, '0')}:00
              </b>
              <span>Focus</span>
              <b>{s.currencies.join(' · ')}</b>
            </div>
            <div className="chips" style={{ marginTop: 10 }}>
              {instrumentsForSession(s.id as NamedSession['id'], symbols)
                .slice(0, 8)
                .map((sym) => (
                  <span key={sym}>{sym}</span>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function DataQualityTab() {
  const { instruments } = useTrading();
  const history = useHistoryStore();
  const series = history.status?.series;
  const issues = useMemo(
    () => [...buildQualityIssues(instruments), ...historyQualityIssues(series ?? [])],
    [instruments, series, history.lastFetchAt],
  );
  const summary = useMemo(() => stage1Summary(instruments), [instruments, history.lastFetchAt]);
  const score = summary.total ? Math.round((summary.pass / summary.total) * 100) : 0;
  const hs = history.status?.summary;

  return (
    <>
      <div className="metrics">
        <Metric label="Quality Score" value={summary.total ? `${score}%` : '—'} sub="Stage 1 pass rate" />
        <Metric label="Passing" value={summary.pass} sub="Valid + fresh + history READY" />
        <Metric
          label="Historical Quality"
          value={hs?.quality != null ? hs.quality : '—'}
          sub={hs ? `${hs.ready}/${hs.series} series READY · ${hs.completeness ?? '—'}% complete` : history.error || 'Loading…'}
        />
        <Metric label="Issues" value={issues.length} sub={`${summary.blocked} instruments blocked`} />
      </div>
      <Card>
        <div className="card-head">
          <div>
            <h3>Validation Issues</h3>
            <p>Live tick gates and historical candle validation (single bridge validation engine) for Stage 1</p>
          </div>
        </div>
        {!issues.length ? (
          <Empty title="No quality issues" detail="All quoted instruments currently pass freshness/validity checks." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>TF</th>
                  <th>Severity</th>
                  <th>Reason</th>
                  <th>Last Valid</th>
                  <th>Blocks Trade</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.symbol}</b>
                    </td>
                    <td>{i.timeframe}</td>
                    <td>
                      <Badge tone={i.severity === 'ERROR' ? 'red' : i.severity === 'WARNING' ? 'amber' : 'blue'}>{i.severity}</Badge>
                    </td>
                    <td>{i.reason}</td>
                    <td>{i.lastValid ? new Date(i.lastValid).toLocaleString() : '—'}</td>
                    <td>{i.blocksTrading ? 'YES' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h3>Per-instrument Stage 1 gates</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Gate</th>
                <th>Quality</th>
                <th>History</th>
                <th>Freshness</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {summary.gates.map((g) => (
                <tr key={g.symbol}>
                  <td>
                    <b>{g.symbol}</b>
                  </td>
                  <td>
                    <Badge tone={g.pass ? 'green' : 'red'}>{g.pass ? 'PASS' : 'BLOCKED'}</Badge>
                  </td>
                  <td>{g.quality}</td>
                  <td>
                    <Badge tone={g.history === 'READY' ? 'green' : g.history === 'SYNCING' ? 'blue' : 'amber'}>{g.history}</Badge>
                  </td>
                  <td>{g.freshnessSec == null ? '—' : `${g.freshnessSec}s`}</td>
                  <td>{g.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function FeedStatusTab() {
  const { instruments } = useTrading();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof bridgeHealth>> | null>(null);
  const [db, setDb] = useState<Awaited<ReturnType<typeof bridgeDbHealth>> | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [h, d] = await Promise.all([bridgeHealth(), bridgeDbHealth()]);
      if (cancelled) return;
      setHealth(h);
      setDb(d);
      setTick((n) => n + 1);
    };
    void load();
    const t = window.setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const mt5 = getMT5Snapshot();
  const live = instruments.filter((i) => i.bid > 0);
  const stale = instruments.filter((i) => {
    const f = freshnessSec(i.lastTickAt);
    return f != null && f > 120 && isFxMarketOpen();
  });
  const lastTick = instruments
    .map((i) => i.lastTickAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const feedState = !health?.ok
    ? 'DISCONNECTED'
    : !health.terminalConnected
      ? 'TERMINAL OFFLINE'
      : live.length
        ? 'CONNECTED'
        : 'IDLE';
  const storageLabel = db?.ok ? db.database || 'db_Cacsms-Trader' : 'UNAVAILABLE';

  return (
    <>
      <div className="metrics">
        <Metric label="Broker Feed" value={feedState} sub={health?.terminalName || health?.message || 'MT5 bridge'} />
        <Metric label="Receiving Data" value={`${live.length} / ${allPairs.length}`} sub="Instruments with valid bid" />
        <Metric label="Storage" value={db?.ok ? 'ONLINE' : 'OFFLINE'} sub={storageLabel} />
        <Metric
          label="Latency"
          value={health?.pingLastMs == null ? '—' : health.pingLastMs >= 1000 ? `${(health.pingLastMs / 1000).toFixed(1)}s` : `${health.pingLastMs}ms`}
          sub="Terminal ↔ server"
        />
      </div>
      <div className="grid-2">
        <Card>
          <h3>Feed Health</h3>
          <div className="kv">
            <span>Bridge</span>
            <b>{health?.bridge || '—'}</b>
            <span>Heartbeat</span>
            <b>{mt5.health.heartbeat}</b>
            <span>Last tick</span>
            <b>{lastTick ? new Date(lastTick).toLocaleString() : '—'}</b>
            <span>Stale (open market)</span>
            <b>{stale.length}</b>
            <span>MT5 accounts</span>
            <b>{mt5.accounts.length}</b>
            <span>Healthy accounts</span>
            <b>{mt5.accounts.filter((a) => a.state === 'HEALTHY').length}</b>
            <span>Poll #</span>
            <b>{tick}</b>
          </div>
        </Card>
        <Card>
          <h3>Database</h3>
          <div className="kv">
            <span>Status</span>
            <b>{db?.ok ? 'READY' : 'ERROR'}</b>
            <span>Database</span>
            <b>{db?.database || '—'}</b>
            <span>Persisted instruments</span>
            <b>{db?.instruments ?? '—'}</b>
            <span>MT5 accounts (DB)</span>
            <b>{db?.accounts ?? '—'}</b>
            <span>Open positions (DB)</span>
            <b>{db?.openPositions ?? '—'}</b>
            <span>Message</span>
            <b>{db?.message || '—'}</b>
          </div>
          {!db?.ok && (
            <p className="alert" style={{ marginTop: 10 }}>
              <AlertTriangle size={14} /> {db?.message || 'SQLite database unavailable — start the MT5 bridge.'}
            </p>
          )}
        </Card>
      </div>
      <Card>
        <div className="card-head">
          <div>
            <h3>Source / Connection</h3>
            <p>Derived from MT5 bridge runtime — not hard-coded</p>
          </div>
          <Badge tone={feedState === 'CONNECTED' ? 'green' : feedState === 'IDLE' ? 'amber' : 'red'}>
            <Wifi size={12} /> {feedState}
          </Badge>
        </div>
        <div className="health-grid">
          {[
            ['Terminal path', health?.terminalPath || '—'],
            ['Login', health?.login || '—'],
            ['Server', health?.server || '—'],
            ['Configured universe', String(allPairs.length)],
            ['Live quotes', String(live.length)],
            ['Order gateway', mt5.health.orderGateway],
            ['Reconciliation', mt5.health.reconciliation],
            ['Feed adapter', health?.ok ? 'MT5 MetaTrader5 bridge' : 'Offline'],
          ].map(([a, b]) => (
            <div key={a}>
              <Database size={14} />
              <span>{a}</span>
              <Badge tone="blue">{b}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

export function MarketDataPage() {
  const [tab, setTab] = useState('Live Market');
  return (
    <>
      <PageHeader title="Market Data & Feed" subtitle="Validated live and historical data powering all 29 instruments" />
      <Tabs
        items={['Live Market', 'Sessions', 'Data Quality', 'Historical Data', 'Feed Status']}
        active={tab}
        onChange={setTab}
      />
      {tab === 'Live Market' && <LiveMarketTab />}
      {tab === 'Sessions' && <SessionsTab />}
      {tab === 'Data Quality' && <DataQualityTab />}
      {tab === 'Historical Data' && <HistoricalDataTab />}
      {tab === 'Feed Status' && <FeedStatusTab />}
    </>
  );
}
