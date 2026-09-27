import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  Eye,
  PauseCircle,
  PlayCircle,
  Radio,
  Shield,
  Target,
  Zap,
} from 'lucide-react';
import { allPairs } from '../data/market';
import { useTrading } from '../context/TradingContext';
import { Badge, Card, Metric, PageHeader, Tabs } from '../components/UI';
import { getDatabaseStatus } from '../db';
import { bridgeDbHealth } from '../features/mt5-connection/services/mt5BridgeClient';
import { MarketDataPage } from '../features/market-data';
import { assessInstrument, gatedState } from '../features/market-data/services/stage1Gate';
import { HistoricalRegimePage, regimeStageStatus, useRegimeStore } from '../features/historical-regime';
import { CurrencyStrengthPage } from '../features/currency-strength';
import { ageText, HtfVisionPage, useVisionStore, visionStageStatus } from '../features/htf-vision';
import { MarketScannerPage, scannerStageStatus, useScannerStore } from '../features/market-scanner';
import { directionStageStatus, StructuralDirectionPage, useDirectionStore } from '../features/structural-direction';
import { H1ConfirmationPage, h1StageStatus, useH1Store } from '../features/h1-confirmation';
import { OpportunitiesRiskPage, riskStageStatus, useRiskStore } from '../features/opportunity-risk';
import { ExecutionPositionsPage, executionStageStatus, fetchTrades, useExecutionStore, type ExecTrade } from '../features/execution';

const dir = (x: string) => (x === 'BULLISH' ? 'green' : x === 'BEARISH' ? 'red' : 'gray');

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-block">
      <b>{title}</b>
      <span>{detail}</span>
    </div>
  );
}

function InstrumentTable({ limit }: { limit?: number }) {
  const { selected, setSelected, instruments } = useTrading();
  const gated = instruments.map((i) => ({ ...i, state: gatedState(i) }));
  const rank = (s: string) => (s === 'READY' ? 0 : s === 'WAIT' ? 1 : 2);
  const rows = limit
    ? [...gated].sort((a, b) => rank(a.state) - rank(b.state) || b.score - a.score).slice(0, limit)
    : gated;
  if (!rows.length) {
    return <EmptyState title="No instrument data" detail="Connect MT5 and sync market state into db_Cacsms-Trader." />;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Bid</th>
            <th>Spread</th>
            <th>24h</th>
            <th>D1</th>
            <th>H8</th>
            <th>H1</th>
            <th>Score</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.symbol} className={selected === x.symbol ? 'row-selected' : ''} onClick={() => setSelected(x.symbol)}>
              <td>
                <b>{x.symbol}</b>
              </td>
              <td>{x.bid || '—'}</td>
              <td>{x.spread || '—'}</td>
              <td className={x.change >= 0 ? 'positive' : 'negative'}>
                {x.change ? `${x.change > 0 ? '+' : ''}${x.change}%` : '—'}
              </td>
              <td>
                <Badge tone={dir(x.d1)}>{x.d1 === 'BULLISH' ? '↑' : x.d1 === 'BEARISH' ? '↓' : '→'}</Badge>
              </td>
              <td>
                <Badge tone={dir(x.h8)}>{x.h8 === 'BULLISH' ? '↑' : x.h8 === 'BEARISH' ? '↓' : '→'}</Badge>
              </td>
              <td>{x.h1}</td>
              <td>
                <b>{x.score > 0 ? x.score : '—'}</b>
              </td>
              <td>
                <Badge tone={x.state === 'READY' ? 'green' : x.state === 'BLOCKED' ? 'red' : 'amber'}>{x.state}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview() {
  const { instruments, positions, riskUsed, events, ready, dbError } = useTrading();
  const gates = instruments.map((i) => assessInstrument(i));
  const passing = instruments.filter((_, idx) => gates[idx].pass);
  const stage1Pass = passing.length;
  const blockReason = gates.find((g) => !g.pass)?.reason;
  const readyCount = passing.filter((x) => x.state === 'READY').length;
  const open = positions.filter((p) => p.status === 'ACTIVE').length;
  const avgConf = passing.length
    ? (passing.reduce((s, i) => s + i.confidence, 0) / passing.length).toFixed(1)
    : '—';
  const regimeStore = useRegimeStore();
  const regimeStatus = regimeStageStatus(regimeStore);
  const regimeClassified = (regimeStore.state?.assets ?? []).filter((a) => a.latest?.regime).length;
  const scannerStore = useScannerStore();
  const scannerStatus = scannerStageStatus(scannerStore);
  const scan = scannerStore.state?.run?.counters;
  const visionStore = useVisionStore();
  const visionStatus = visionStageStatus(visionStore);
  const vsum = visionStore.state?.run?.summary;
  const directionStore = useDirectionStore();
  const directionStatus = directionStageStatus(directionStore);
  const dc = directionStore.state?.run?.counters;
  const h1Store = useH1Store();
  const h1Status = h1StageStatus(h1Store);
  const hc = h1Store.state?.run?.counters;
  const riskStore = useRiskStore();
  const riskStatus = riskStageStatus(riskStore);
  const rc = riskStore.state?.run?.counters;
  const execStore = useExecutionStore();
  const execStatus = executionStageStatus(execStore);
  const execRun = execStore.state?.run;
  const stageOk = (idx: number) =>
    idx === 2
      ? regimeStatus === 'HEALTHY' || regimeStatus === 'RUNNING'
      : idx === 3
        ? scannerStatus === 'HEALTHY'
        : idx === 4
          ? visionStatus === 'HEALTHY'
          : idx === 5
            ? directionStatus === 'HEALTHY'
            : idx === 6
              ? h1Status === 'HEALTHY'
              : idx === 7
                ? riskStatus === 'HEALTHY'
                : idx === 8
                  ? execStatus === 'HEALTHY'
                  : !!stage1Pass;
  const stageNote = (idx: number) => {
    if (idx === 2) return `${regimeStatus} · ${regimeClassified}/9 classified`;
    if (idx === 3) return scan ? `${scannerStatus} · ${scan.directional} directional · ${scan.promoted} promoted` : scannerStatus;
    if (idx === 4) return vsum ? `${visionStatus} · ${vsum.qualified} qualified · ${vsum.confirmedD1} confirmed D1` : visionStatus;
    if (idx === 5) return dc ? `${directionStatus} · ${dc.candidates} candidates · ${dc.ready} ready for H1` : directionStatus;
    if (idx === 6) return hc ? `${h1Status} · ${hc.candidates} candidates · ${hc.confirmed} confirmed` : h1Status;
    if (idx === 7) return rc ? `${riskStatus} · ${rc.qualified} qualified · ${rc.authorized} authorized` : riskStatus;
    if (idx === 8)
      return execRun?.summary
        ? `${execStatus} · ${execRun.control?.state ?? '—'} · ${execRun.summary.stage9Positions} managed · ${execRun.summary.queue} queued`
        : execStatus;
    if (!instruments.length) return 'Idle · No data';
    if (idx === 0) return `${stage1Pass}/${instruments.length} pass Stage 1`;
    return stage1Pass ? `${stage1Pass} instruments in flow` : 'Blocked upstream (Stage 1)';
  };

  return (
    <>
      <PageHeader title="System Overview" subtitle="Real-time command centre for the autonomous trading engine" />
      {!ready && <p className="muted">Loading from db_Cacsms-Trader…</p>}
      {dbError && <p className="alert">{dbError}</p>}
      <div className="metrics">
        <Metric label="Instruments" value={String(instruments.length || allPairs.length)} sub={`${instruments.length} live · ${allPairs.length} universe`} />
        <Metric label="H1 Confirmed" value={hc ? hc.confirmed : '—'} sub={hc ? `${hc.candidates} Stage 6 candidates · Stage 7 ${h1Status}` : `Stage 7 ${h1Status}`} />
        <Metric label="Open Positions" value={String(open)} sub={`${riskUsed.toFixed(2)}% risk used`} />
        <Metric label="System Confidence" value={avgConf === '—' ? '—' : `${avgConf}%`} sub="Across active candidates" />
      </div>
      <div className="grid-2">
        <Card>
          <div className="card-head">
            <div>
              <h3>Active Market Watch</h3>
              <p>Highest-priority instruments from the current pipeline</p>
            </div>
            <Badge tone={instruments.length ? 'green' : 'gray'}>{instruments.length ? 'LIVE' : 'EMPTY'}</Badge>
          </div>
          <InstrumentTable limit={8} />
        </Card>
        <Card>
          <div className="card-head">
            <div>
              <h3>10-Stage Pipeline</h3>
              <p>Current health and processing status</p>
            </div>
          </div>
          <div className="pipeline">
            {['Market Data', 'Strength', 'Regime', 'Discovery', 'HTF Vision', 'Direction', 'H1 Confirm', 'Risk', 'Execution', 'Learning'].map(
              (x, i) => (
                <div className="stage" key={x}>
                  <span>{i + 1}</span>
                  <div>
                    <b>{x}</b>
                    <small>{stageNote(i)}</small>
                  </div>
                  {stageOk(i) ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                </div>
              ),
            )}
          </div>
        </Card>
      </div>
      <div className="grid-3">
        <Card>
          <h3>Autonomous Orchestrator</h3>
          <div className="status-big">
            <Zap />
            <div>
              <b>{!instruments.length ? 'IDLE' : stage1Pass ? 'READY' : 'BLOCKED'}</b>
              <span>
                {!instruments.length
                  ? 'No market state in database yet'
                  : stage1Pass
                    ? `Event-driven · ${readyCount} qualified of ${stage1Pass} valid`
                    : `Stage 1 fail-closed · ${blockReason ?? 'no valid data'}`}
              </span>
            </div>
          </div>
        </Card>
        <Card>
          <h3>Portfolio Exposure</h3>
          {open === 0 ? (
            <EmptyState title="No open exposure" detail="Positions appear here after MT5 sync." />
          ) : (
            positions
              .filter((p) => p.status === 'ACTIVE')
              .map((p) => (
                <div className="progress-row" key={p.id}>
                  <span>{p.symbol}</span>
                  <div>
                    <i style={{ width: `${Math.min(100, Math.abs(p.risk) * 40)}%` }} />
                  </div>
                  <b>{p.risk.toFixed(2)}%</b>
                </div>
              ))
          )}
        </Card>
        <Card>
          <h3>Recent Decisions</h3>
          <div className="feed">
            {events.length === 0 ? (
              <EmptyState title="No events yet" detail="Decisions and system events are stored in SQL Server." />
            ) : (
              events.slice(0, 8).map((e, i) => (
                <div key={e.id ?? i}>
                  <span>{e.ts ? new Date(e.ts).toLocaleTimeString() : '—'}</span>
                  <p>{e.message}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

export function MarketData() {
  return <MarketDataPage />;
}

export function Strength() {
  return <CurrencyStrengthPage />;
}

export function Regime() {
  return <HistoricalRegimePage />;
}

export function Scanner() {
  const { instruments } = useTrading();
  return (
    <MarketScannerPage>
      <Card>
        <div className="card-head">
          <div>
            <h3>Ranked Candidates</h3>
            <p>Strength differential, regime, channel and confidence composite</p>
          </div>
          <Badge tone="blue">{instruments.length} scanned</Badge>
        </div>
        <InstrumentTable />
      </Card>
      <Card>
        <h3>Full Instrument Universe</h3>
        <div className="chips">
          {allPairs.map((x) => (
            <span key={x} className={x === 'XAUUSD' ? 'gold' : ''}>
              {x}
            </span>
          ))}
        </div>
      </Card>
    </MarketScannerPage>
  );
}

export function Vision() {
  return <HtfVisionPage />;
}

/** Stage 6 decides from the published Stage 4 and Stage 5 outputs on the bridge; the page reads persisted decisions. */
export function Direction() {
  return <StructuralDirectionPage />;
}

/** Stage 7 confirms the Stage 6 direction on closed H1 structure on the bridge; the page reads persisted decisions. */
export function H1() {
  return <H1ConfirmationPage />;
}

/** Stage 8 qualifies Stage 7 confirmations against portfolio and per-account risk on the bridge; the page reads persisted state. */
export function Risk() {
  return <OpportunitiesRiskPage />;
}

/** Stage 9 executes and manages positions on the central engine on the bridge; the page only monitors and sends audited commands. */
export function Execution() {
  return <ExecutionPositionsPage />;
}

/** Closed Stage 9 trades published to Stage 10, read from dbo.app_exec_trade. */
export function Performance() {
  const { events } = useTrading();
  const execStore = useExecutionStore();
  const [trades, setTrades] = useState<ExecTrade[] | null>(null);
  const [err, setErr] = useState('');
  const published = execStore.state?.trades.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    fetchTrades({ limit: 500 })
      .then((r) => !cancelled && (setTrades(r.trades), setErr('')))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Trade history unavailable'));
    return () => {
      cancelled = true;
    };
  }, [published]);

  const closed = trades ?? [];
  const wins = closed.filter((t) => t.realizedPnl > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const net = closed.reduce((s, t) => s + t.realizedPnl, 0);
  const rs = closed.filter((t) => t.rMultiple != null);
  const avgR = rs.length ? rs.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / rs.length : null;
  const currencies = [...new Set(closed.map((t) => t.currency))];
  const curve = useMemo(() => {
    let eq = 0;
    return closed
      .slice()
      .reverse()
      .map((t, i) => {
        eq += t.realizedPnl;
        return { n: i + 1, equity: Number(eq.toFixed(2)) };
      });
  }, [closed]);
  const slip = closed.filter((t) => t.slippagePoints != null);

  return (
    <>
      <PageHeader title="Performance & Learning" subtitle="Decision audit, strategy diagnostics and controlled model calibration" />
      {err && <p className="alert">{err}</p>}
      <div className="metrics">
        <Metric
          label="Net P&L"
          value={trades ? `${net >= 0 ? '+' : ''}${net.toFixed(2)}${currencies.length === 1 ? ` ${currencies[0]}` : ''}` : '—'}
          sub={currencies.length > 1 ? `Mixed currencies: ${currencies.join(', ')}` : 'Realized · closed Stage 9 trades'}
        />
        <Metric label="Win Rate" value={closed.length ? `${winRate}%` : '—'} sub={`${closed.length} closed trades`} />
        <Metric label="Average R" value={avgR != null ? `${avgR >= 0 ? '+' : ''}${avgR.toFixed(2)}R` : '—'} sub={`${rs.length} trades with initial risk`} />
        <Metric
          label="Avg Slippage"
          value={slip.length ? `${(slip.reduce((s, t) => s + (t.slippagePoints ?? 0), 0) / slip.length).toFixed(1)} pts` : '—'}
          sub="Expected vs actual entry"
        />
      </div>
      <div className="grid-2">
        <Card>
          <h3>Equity Curve</h3>
          <div className="chart-lg">
            {!curve.length ? (
              <EmptyState title="No closed trades yet" detail="The curve builds from closed Stage 9 trades published to Stage 10 (dbo.app_exec_trade)." />
            ) : (
              <ResponsiveContainer>
                <AreaChart data={curve}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="n" />
                  <YAxis />
                  <Tooltip />
                  <Area dataKey="equity" fillOpacity={0.18} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <h3>Learning Insights</h3>
          <div className="insights">
            <div>
              <Brain />
              <span>Insights appear after real closed trades and decision events are stored — no synthetic recommendations.</span>
            </div>
            <div>
              <Shield />
              <span>
                <b>{events.length}</b> system events loaded from dbo.app_events.
              </span>
            </div>
            <div>
              <Activity />
              <span>
                <b>{closed.length}</b> closed Stage 9 trades with full lifecycle evidence available for diagnostics.
              </span>
            </div>
            <div>
              <Target />
              <span>Live parameters are not silently rewritten.</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

export function SystemControl() {
  const { auto, setAuto, riskLimit, dbError, refreshFromDb } = useTrading();
  const [toggles, setToggles] = useState({ vision: true, learning: true, alerts: true, news: true });
  const db = getDatabaseStatus();
  const [sql, setSql] = useState<{ ok?: boolean; database?: string; accounts?: number; message?: string }>({});

  useEffect(() => {
    void bridgeDbHealth().then(setSql);
  }, []);

  return (
    <>
      <PageHeader title="System Control" subtitle="Autonomous engine, broker, safety and configuration centre" />
      <div className="grid-2">
        <Card>
          <h3>Autonomous Engine</h3>
          <div className={'control-hero ' + (auto ? 'running' : 'paused')}>
            {auto ? <PlayCircle /> : <PauseCircle />}
            <div>
              <b>{auto ? 'RUNNING' : 'PAUSED'}</b>
              <span>{auto ? 'Scanning and permitted to execute qualified setups' : 'Scanning continues; new executions disabled'}</span>
            </div>
            <button className={auto ? 'danger' : 'primary'} onClick={() => setAuto(!auto)}>
              {auto ? 'Pause New Trades' : 'Resume Trading'}
            </button>
          </div>
          <div className="kv">
            <span>Risk per trade</span>
            <b>{riskLimit}%</b>
            <span>Persistence</span>
            <b>dbo.app_settings</b>
          </div>
        </Card>
        <Card>
          <h3>Subsystems</h3>
          {Object.entries(toggles).map(([k, v]) => (
            <label className="toggle-row" key={k}>
              <div>
                <b>{k[0].toUpperCase() + k.slice(1)}</b>
                <small>
                  {k === 'vision'
                    ? 'Continuous HTF/H1 perception'
                    : k === 'learning'
                      ? 'Post-trade analysis and calibration'
                      : k === 'alerts'
                        ? 'System and trade notifications'
                        : 'Economic-event awareness'}
                </small>
              </div>
              <input type="checkbox" checked={v} onChange={() => setToggles((s) => ({ ...s, [k]: !v }))} />
            </label>
          ))}
        </Card>
      </div>
      <Card>
        <h3>Infrastructure Health</h3>
        <div className="health-grid">
          {[
            ['SQL Server', sql.ok ? `ONLINE · ${sql.database}` : 'OFFLINE'],
            ['MT5 Accounts', String(sql.accounts ?? '—')],
            ['SQLite Foundation', db.writable ? 'LOCAL R/W' : db.mode],
            ['App State', dbError ? 'ERROR' : 'READY'],
          ].map(([a, b]) => (
            <div key={a}>
              <Database />
              <span>{a}</span>
              <Badge tone={String(b).includes('OFFLINE') || String(b).includes('ERROR') ? 'red' : 'green'}>{b}</Badge>
            </div>
          ))}
        </div>
        {dbError && <p className="alert">{dbError}</p>}
        <button className="primary" style={{ marginTop: 12 }} onClick={() => void refreshFromDb()}>
          Reload from db_Cacsms-Trader
        </button>
        <small className="muted">{sql.message || db.guidance}</small>
      </Card>
    </>
  );
}
