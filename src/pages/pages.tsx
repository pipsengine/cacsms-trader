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
import { OpportunitiesRiskPage, riskStageStatus, startRiskStore, useRiskStore } from '../features/opportunity-risk';

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
                : !!stage1Pass || idx === 8;
  const stageNote = (idx: number) => {
    if (idx === 2) return `${regimeStatus} · ${regimeClassified}/9 classified`;
    if (idx === 3) return scan ? `${scannerStatus} · ${scan.directional} directional · ${scan.promoted} promoted` : scannerStatus;
    if (idx === 4) return vsum ? `${visionStatus} · ${vsum.qualified} qualified · ${vsum.confirmedD1} confirmed D1` : visionStatus;
    if (idx === 5) return dc ? `${directionStatus} · ${dc.candidates} candidates · ${dc.ready} ready for H1` : directionStatus;
    if (idx === 6) return hc ? `${h1Status} · ${hc.candidates} candidates · ${hc.confirmed} confirmed` : h1Status;
    if (idx === 7) return rc ? `${riskStatus} · ${rc.qualified} qualified · ${rc.authorized} authorized` : riskStatus;
    if (!instruments.length) return 'Idle · No data';
    if (idx === 0) return `${stage1Pass}/${instruments.length} pass Stage 1`;
    if (idx === 8) return `Managing ${open} positions`;
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

export function Execution() {
  const { positions, closePosition, auto, riskUsed } = useTrading();
  const riskStore = useRiskStore();
  const active = positions.filter((x) => x.status === 'ACTIVE');
  const pnl = active.reduce((s, p) => s + p.pnl, 0);
  const now = Date.now();
  const riskStatus = riskStageStatus(riskStore);
  const auths = riskStore.state?.authorizations ?? [];
  const pending = riskStatus === 'HEALTHY' || riskStatus === 'DEGRADED' ? auths.filter((a) => a.status === 'PENDING' && Date.parse(a.expiresAt) > now) : [];
  useEffect(() => startRiskStore(), []);
  return (
    <>
      <PageHeader title="Execution & Positions" subtitle="Broker execution, live position management and trade lifecycle control" />
      <div className="metrics">
        <Metric label="Engine" value={auto ? 'AUTO' : 'PAUSED'} sub="New trade execution" />
        <Metric label="Open P&L" value={active.length ? `$${pnl.toFixed(2)}` : '$0.00'} sub="Across active positions" />
        <Metric label="Open Risk" value={`${riskUsed.toFixed(2)}%`} sub={`${active.length} active positions`} />
        <Metric label="Authorized" value={pending.length} sub={`Stage 8 → Stage 9 queue · Stage 8 ${riskStatus}`} />
      </div>
      <Card>
        <div className="card-head">
          <div>
            <h3>Stage 8 Authorization Queue</h3>
            <p>Immutable execution authorizations from Opportunities &amp; Risk — Stage 9 may act only on a PENDING, unexpired authorization and its exact terms</p>
          </div>
          <Badge tone={pending.length ? 'green' : 'gray'}>{pending.length} pending</Badge>
        </div>
        {!auths.length ? (
          <EmptyState
            title={riskStore.loading ? 'Loading Stage 8 authorizations…' : 'No execution authorization'}
            detail={riskStore.error || 'An authorization is issued only when a Stage 7 confirmed setup passes every setup, portfolio, account and permission gate while trading is RUNNING.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>Execution ID</th>
                  <th>Account</th>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th>Volume</th>
                  <th>Entry ref.</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Risk</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {auths.slice(0, 12).map((a) => (
                  <tr key={a.executionId}>
                    <td>
                      <code>{a.executionId}</code>
                    </td>
                    <td>
                      {a.accountName ?? a.accountId} <small className="muted">{a.accountClass}</small>
                    </td>
                    <td>
                      <b>{a.instrument}</b>
                    </td>
                    <td>
                      <Badge tone={a.direction === 'BUY' ? 'green' : 'red'}>{a.direction}</Badge>
                    </td>
                    <td>{a.volume}</td>
                    <td>{a.entryPolicy.referencePrice}</td>
                    <td>{a.stopLoss}</td>
                    <td>{a.takeProfit ?? '—'}</td>
                    <td>
                      {a.riskAmount.toFixed(2)} {a.riskCurrency} <small className="muted">({a.riskPct.toFixed(2)}%)</small>
                    </td>
                    <td>{new Date(a.expiresAt).toLocaleTimeString()}</td>
                    <td>
                      <Badge tone={a.status === 'PENDING' && Date.parse(a.expiresAt) > now ? 'green' : a.status === 'REVOKED' ? 'red' : 'gray'}>{a.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h3>Open Positions</h3>
        {!active.length ? (
          <EmptyState title="No open positions" detail="MT5-synced positions are stored in dbo.app_positions / dbo.mt5_positions." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th>Entry</th>
                  <th>Current</th>
                  <th>SL</th>
                  <th>TP</th>
                  <th>Size</th>
                  <th>Risk</th>
                  <th>P&L</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((x) => (
                  <tr key={x.id}>
                    <td>{x.id}</td>
                    <td>
                      <b>{x.symbol}</b>
                    </td>
                    <td>
                      <Badge tone="green">{x.side}</Badge>
                    </td>
                    <td>{x.entry}</td>
                    <td>{x.current}</td>
                    <td>{x.sl}</td>
                    <td>{x.tp}</td>
                    <td>{x.size}</td>
                    <td>{x.risk}%</td>
                    <td className={x.pnl >= 0 ? 'positive' : 'negative'}>
                      {x.pnl >= 0 ? '+' : ''}
                      ${x.pnl}
                    </td>
                    <td>
                      <button className="mini danger" onClick={() => closePosition(x.id)}>
                        Close
                      </button>
                    </td>
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

export function Performance() {
  const { positions, events } = useTrading();
  const closed = positions.filter((p) => p.status === 'CLOSED');
  const wins = closed.filter((p) => p.pnl > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const net = positions.reduce((s, p) => s + p.pnl, 0);
  const curve = useMemo(() => {
    let eq = 0;
    return closed
      .slice()
      .reverse()
      .map((p, i) => {
        eq += p.pnl;
        return { n: i + 1, equity: eq };
      });
  }, [closed]);

  return (
    <>
      <PageHeader title="Performance & Learning" subtitle="Decision audit, strategy diagnostics and controlled model calibration" />
      <div className="metrics">
        <Metric label="Net P&L" value={`${net >= 0 ? '+' : ''}${net.toFixed(2)}`} sub="From stored positions" />
        <Metric label="Win Rate" value={closed.length ? `${winRate}%` : '—'} sub={`${closed.length} closed trades`} />
        <Metric label="Open" value={positions.filter((p) => p.status === 'ACTIVE').length} sub="Active" />
        <Metric label="Events" value={events.length} sub="Audit trail" />
      </div>
      <div className="grid-2">
        <Card>
          <h3>Equity Curve</h3>
          <div className="chart-lg">
            {!curve.length ? (
              <EmptyState title="No closed trades yet" detail="Equity curve builds from dbo.app_positions history." />
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
              <span>
                Insights appear after real closed trades and decision events are stored — no synthetic recommendations.
              </span>
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
                <b>{closed.length}</b> closed positions available for diagnostics.
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
