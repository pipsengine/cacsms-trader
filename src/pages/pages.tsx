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
import { ageText, headline, HtfVisionPage, tfDirection, useVisionStore, visionPosition, visionStageStatus } from '../features/htf-vision';
import { MarketScannerPage, scannerStageStatus, useScannerStore } from '../features/market-scanner';

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
  const stageOk = (idx: number) =>
    idx === 2
      ? regimeStatus === 'HEALTHY' || regimeStatus === 'RUNNING'
      : idx === 3
        ? scannerStatus === 'HEALTHY'
        : !!stage1Pass || idx === 8;
  const stageNote = (idx: number) => {
    if (idx === 2) return `${regimeStatus} · ${regimeClassified}/9 classified`;
    if (idx === 3) return scan ? `${scannerStatus} · ${scan.directional} directional · ${scan.promoted} promoted` : scannerStatus;
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
        <Metric label="Qualified" value={readyCount} sub="H1 confirmed" />
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

function ChannelChart({ empty }: { empty?: boolean }) {
  if (empty) return <EmptyState title="No chart series" detail="Historical bars will appear when market data is written to the database." />;
  return (
    <div className="channel-chart">
      <EmptyState title="Awaiting history" detail="No synthetic series — connect a live history source." />
    </div>
  );
}

export function Vision() {
  return <HtfVisionPage />;
}

/** Stage 6 consumes the Stage 5 contract; a direction is shown only for confirmed channels on READY data. */
export function Direction() {
  const { instruments, setSelected } = useTrading();
  const vstore = useVisionStore();
  const vstatus = visionStageStatus(vstore);
  const rows = [...(vstore.state?.instruments ?? [])].sort((a, b) => {
    const ca = a.status === 'READY' && a.d1?.confirmed ? 1 : 0;
    const cb = b.status === 'READY' && b.d1?.confirmed ? 1 : 0;
    return cb - ca || b.confidence - a.confidence || a.symbol.localeCompare(b.symbol);
  });
  const diff = new Map(instruments.map((i) => [i.symbol, i.strengthDiff]));
  const aligned = rows.filter((v) => v.status === 'READY' && v.agreement === 'AGREE').length;
  const tfCell = (v: (typeof rows)[number], tf: 'd1' | 'h8') => {
    const s = v[tf];
    const d = tfDirection(v, tf);
    return (
      <span title={s?.reason ?? s?.dataReason}>
        <small>
          {tf.toUpperCase()} ·{' '}
          {s?.dataStatus !== 'READY' ? s?.dataStatus?.replace(/_/g, ' ') : !s?.status ? 'NOT ANALYSED' : s.status === 'NONE' ? 'NO CHANNEL' : s.status}
        </small>
        <b className={d === 'BULLISH' ? 'positive' : d === 'BEARISH' ? 'negative' : 'muted'}>{d === 'BULLISH' ? '↑' : d === 'BEARISH' ? '↓' : '→'}</b>
      </span>
    );
  };
  return (
    <>
      <PageHeader title="Structural Direction" subtitle="Combines macro strength, historical regime and D1/H8 market vision (Stage 5 → Stage 6)" />
      {(vstore.error || vstatus === 'STALE') && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>
            {vstore.error
              ? `Stage 5 unavailable — ${vstore.error}. No structural direction is published.`
              : 'Stage 5 output is stale — directions below are not treated as confirmed until the engine runs again.'}
          </span>
        </div>
      )}
      <Card>
        <div className="card-head">
          <div>
            <h3>Multi-Timeframe Direction Board</h3>
            <p>
              Stage 5 {vstatus} · {rows.filter((v) => v.status === 'READY' && v.d1?.confirmed).length} confirmed D1 channels · last run{' '}
              {ageText(vstore.state?.run?.runAt)}
            </p>
          </div>
          <Badge tone={aligned ? 'green' : 'gray'}>{aligned} D1/H8 aligned</Badge>
        </div>
        {!rows.length ? (
          <EmptyState
            title={vstore.loading ? 'Loading Stage 5 output…' : 'No structural direction'}
            detail={vstore.error || 'HTF Market Vision has not published any instrument yet.'}
          />
        ) : (
          <div className="direction-board">
            {rows.map((v) => {
              const h = headline(v);
              const d = diff.get(v.symbol);
              const pos = visionPosition(v, 'd1');
              return (
                <div key={v.symbol} className="hr-click" onClick={() => setSelected(v.symbol)} title={[...v.reasoning, ...v.invalidation].join('\n')}>
                  <div>
                    <b className={v.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{v.symbol}</b>
                    <small>
                      Strength Δ {d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(2)}`} · {v.agreement} · {v.phase?.replace(/_/g, ' ') ?? '—'}
                    </small>
                  </div>
                  {tfCell(v, 'd1')}
                  {tfCell(v, 'h8')}
                  <span>
                    <small>Position</small>
                    <b>{pos == null ? '—' : `${pos.toFixed(0)}%`}</b>
                  </span>
                  <span>
                    <small>Confidence</small>
                    <b>{v.status === 'BLOCKED' ? '—' : `${v.confidence.toFixed(0)}%`}</b>
                  </span>
                  <Badge tone={h.tone}>{h.label}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

export function H1() {
  const { selected, instruments } = useTrading();
  const vstore = useVisionStore();
  const x = instruments.find((i) => i.symbol === selected) || instruments[0];
  const htfPos = x ? visionPosition(vstore.state?.instruments.find((v) => v.symbol === x.symbol), 'd1') : null;
  return (
    <>
      <PageHeader title="H1 Confirmation" subtitle="Final structure confirmation using BOS, CHoCH, momentum and pullback state" />
      {!x ? (
        <Card>
          <EmptyState title="No H1 confirmation target" detail="Load instrument state from the database first." />
        </Card>
      ) : (
        <div className="grid-vision">
          <Card>
            <div className="card-head">
              <div>
                <h3>
                  {x.symbol} · H1 Live Structure
                </h3>
                <p>
                  HTF direction: {x.d1} · H1 phase: {x.h1}
                </p>
              </div>
              <Badge tone={x.state === 'READY' ? 'green' : 'amber'}>{x.state}</Badge>
            </div>
            <ChannelChart empty />
          </Card>
          <Card>
            <h3>Confirmation Checklist</h3>
            {[
              ['HTF Direction', x.d1, x.d1 !== 'NEUTRAL'],
              ['Channel Location', htfPos == null ? 'No Stage 5 channel' : `${htfPos.toFixed(0)}%`, htfPos != null],
              ['Score', String(x.score), x.score > 0],
              ['H1 Phase', x.h1, !!x.h1],
            ].map(([a, b, ok]) => (
              <div className="check-row" key={a as string}>
                <span className={ok ? 'check ok' : 'check'}>{ok ? <CheckCircle2 /> : <PauseCircle />}</span>
                <div>
                  <small>{a as string}</small>
                  <b>{b as string}</b>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </>
  );
}

export function Risk() {
  const { riskLimit, setRiskLimit, instruments, riskUsed } = useTrading();
  const setups = instruments.filter((x) => x.score >= 78);
  return (
    <>
      <PageHeader title="Opportunities & Risk" subtitle="Final qualification gate: setup quality, correlation, exposure and account risk" />
      <div className="metrics">
        <Metric label="Qualified Setups" value={setups.length} sub={`${instruments.filter((i) => i.state === 'READY').length} ready for execution`} />
        <Metric label="Risk Available" value={`${Math.max(0, riskLimit * 3 - riskUsed).toFixed(2)}%`} sub="Portfolio budget remaining" />
        <Metric label="Open Risk" value={`${riskUsed.toFixed(2)}%`} sub="Active positions" />
        <Metric label="Risk / Trade" value={`${riskLimit.toFixed(2)}%`} sub="Configured limit" />
      </div>
      <div className="grid-2">
        <Card>
          <h3>Setup Qualification</h3>
          {!setups.length ? (
            <EmptyState title="No qualified setups" detail="Scored instruments in the database appear here when score ≥ 78." />
          ) : (
            setups.slice(0, 8).map((x) => (
              <div className="setup" key={x.symbol}>
                <div>
                  <b>{x.symbol}</b>
                  <small>
                    {x.d1} · {x.h1}
                  </small>
                </div>
                <div className="score">{x.score}</div>
                <Badge tone={x.state === 'READY' ? 'green' : 'amber'}>{x.state}</Badge>
              </div>
            ))
          )}
        </Card>
        <Card>
          <h3>Risk Controls</h3>
          <label className="range-label">
            <span>Maximum risk per trade</span>
            <b>{riskLimit.toFixed(2)}%</b>
          </label>
          <input className="range" type="range" min=".25" max="2" step=".25" value={riskLimit} onChange={(e) => setRiskLimit(+e.target.value)} />
          <div className="alert">
            <AlertTriangle />
            <span>Risk settings persist to dbo.app_settings in db_Cacsms-Trader.</span>
          </div>
        </Card>
      </div>
    </>
  );
}

export function Execution() {
  const { positions, closePosition, auto, riskUsed } = useTrading();
  const active = positions.filter((x) => x.status === 'ACTIVE');
  const pnl = active.reduce((s, p) => s + p.pnl, 0);
  return (
    <>
      <PageHeader title="Execution & Positions" subtitle="Broker execution, live position management and trade lifecycle control" />
      <div className="metrics">
        <Metric label="Engine" value={auto ? 'AUTO' : 'PAUSED'} sub="New trade execution" />
        <Metric label="Open P&L" value={active.length ? `$${pnl.toFixed(2)}` : '$0.00'} sub="Across active positions" />
        <Metric label="Open Risk" value={`${riskUsed.toFixed(2)}%`} sub={`${active.length} active positions`} />
        <Metric label="Positions" value={positions.length} sub="Stored in SQL Server" />
      </div>
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
