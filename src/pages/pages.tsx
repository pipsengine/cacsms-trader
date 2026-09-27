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
  const rows = limit ? instruments.slice(0, limit) : instruments;
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
  const readyCount = instruments.filter((x) => x.state === 'READY').length;
  const open = positions.filter((p) => p.status === 'ACTIVE').length;
  const avgConf = instruments.length
    ? (instruments.reduce((s, i) => s + i.confidence, 0) / instruments.length).toFixed(1)
    : '—';

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
                    <small>{i === 8 ? `Managing ${open} positions` : instruments.length ? 'Awaiting live feed' : 'Idle · No data'}</small>
                  </div>
                  <CheckCircle2 size={17} />
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
              <b>{instruments.length ? 'READY' : 'IDLE'}</b>
              <span>{instruments.length ? 'Event-driven · Waiting for signals' : 'No market state in database yet'}</span>
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
  const [tab, setTab] = useState('Strength Matrix');
  const { strengths } = useTrading();
  return (
    <>
      <PageHeader title="Currency & XAU Strength" subtitle="Quarterly + Monthly macro strength intelligence and normalized XAU regime" />
      <Tabs items={['Strength Matrix', 'Rankings', 'Heatmap', 'Trends', 'XAU']} active={tab} onChange={setTab} />
      {!strengths.length ? (
        <Card>
          <EmptyState title="No strength data" detail="Currency strength rows are loaded from dbo.app_currency_strength." />
        </Card>
      ) : (
        <div className="grid-2">
          <Card>
            <h3>Macro Strength Ranking</h3>
            <div className="strength-list">
              {strengths.map((x, i) => (
                <div key={x.code}>
                  <span className="rank">{i + 1}</span>
                  <b>{x.code}</b>
                  <div className="strength-bar">
                    <i className={x.score >= 0 ? 'pos' : 'neg'} style={{ width: Math.min(100, Math.abs(x.score) * 9) + '%' }} />
                  </div>
                  <strong className={x.score >= 0 ? 'positive' : 'negative'}>
                    {x.score > 0 ? '+' : ''}
                    {x.score}
                  </strong>
                  <Badge tone={x.score > 2 ? 'green' : x.score < -2 ? 'red' : 'gray'}>{x.classification}</Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h3>Quarterly vs Monthly</h3>
            <div className="chart-lg">
              <ResponsiveContainer>
                <BarChart data={strengths}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="q" name="Quarterly" />
                  <Bar dataKey="m" name="Monthly" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export function Regime() {
  const { strengths } = useTrading();
  const strengthening = strengths.filter((s) => s.trend === 'Strengthening').length;
  const weakening = strengths.filter((s) => s.trend === 'Weakening').length;
  return (
    <>
      <PageHeader title="Historical Regime" subtitle="Persistence, acceleration, deterioration and reversal intelligence" />
      <div className="metrics">
        <Metric label="Strengthening" value={strengthening} sub={strengths.filter((s) => s.trend === 'Strengthening').map((s) => s.code).join(' · ') || '—'} />
        <Metric label="Weakening" value={weakening} sub={strengths.filter((s) => s.trend === 'Weakening').map((s) => s.code).join(' · ') || '—'} />
        <Metric label="Transitions" value={strengths.filter((s) => s.trend === 'Recovering').length} sub="Recovering" />
        <Metric label="Stable" value={strengths.filter((s) => s.trend === 'Stable').length} sub="Neutral regimes" />
      </div>
      <Card>
        {!strengths.length ? (
          <EmptyState title="No regime data" detail="Persist strength/regime rows to SQL Server to populate this view." />
        ) : (
          <div className="regime-list">
            {strengths.map((x) => (
              <div key={x.code}>
                <b>{x.code}</b>
                <Badge tone={x.trend === 'Strengthening' ? 'green' : x.trend === 'Weakening' ? 'red' : 'blue'}>{x.trend}</Badge>
                <span>
                  Q {x.q > 0 ? '+' : ''}
                  {x.q}
                </span>
                <span>
                  M {x.m > 0 ? '+' : ''}
                  {x.m}
                </span>
                <strong>{x.classification}</strong>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function Scanner() {
  const { instruments } = useTrading();
  const qualified = instruments.filter((x) => x.score >= 75);
  return (
    <>
      <PageHeader title="Market Scanner" subtitle="Ranks all 28 FX combinations plus XAUUSD and promotes the best candidates" />
      <div className="funnel">
        <div>
          <b>{allPairs.length}</b>
          <span>Universe</span>
        </div>
        <i>→</i>
        <div>
          <b>{instruments.length}</b>
          <span>In database</span>
        </div>
        <i>→</i>
        <div>
          <b>{qualified.length}</b>
          <span>Channel qualified</span>
        </div>
        <i>→</i>
        <div>
          <b>{instruments.filter((x) => x.state === 'READY').length}</b>
          <span>H1 ready</span>
        </div>
      </div>
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
    </>
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
  const { selected, instruments } = useTrading();
  const x = instruments.find((i) => i.symbol === selected);
  return (
    <>
      <PageHeader title="HTF Market Vision" subtitle="AI-assisted D1/H8 channel detection, touch validation and visual structure" />
      {!x ? (
        <Card>
          <EmptyState title="No vision target" detail="Select an instrument after market state is stored in the database." />
        </Card>
      ) : (
        <div className="grid-vision">
          <Card>
            <div className="card-head">
              <div>
                <h3>
                  {x.symbol} · D1 Channel
                </h3>
                <p>Automatic structural vision</p>
              </div>
              <Badge tone={dir(x.d1)}>{x.d1}</Badge>
            </div>
            <ChannelChart empty />
            <div className="vision-stats">
              <span>
                Position <b>{x.channelPos}%</b>
              </span>
              <span>
                Confidence <b>{x.confidence}%</b>
              </span>
              <span>
                Status <b>{x.state}</b>
              </span>
            </div>
          </Card>
          <Card>
            <h3>Vision Interpretation</h3>
            <div className="decision">
              <Eye />
              <b>{x.score >= 75 ? 'STRUCTURE PRESENT' : 'INSUFFICIENT DATA'}</b>
              <p>
                {x.score >= 75
                  ? 'Stored HTF fields indicate an active structure for this symbol.'
                  : 'Persist scored instrument rows from the analysis pipeline to enable vision.'}
              </p>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export function Direction() {
  const { instruments } = useTrading();
  return (
    <>
      <PageHeader title="Structural Direction" subtitle="Combines macro strength, historical regime and D1/H8 market vision" />
      <Card>
        <div className="card-head">
          <h3>Multi-Timeframe Direction Board</h3>
          <Badge tone="green">{instruments.filter((i) => i.d1 === i.h8 && i.d1 !== 'NEUTRAL').length} aligned</Badge>
        </div>
        {!instruments.length ? (
          <EmptyState title="No direction board data" detail="Instrument rows from dbo.app_instruments populate this board." />
        ) : (
          <div className="direction-board">
            {instruments.slice(0, 12).map((x) => (
              <div key={x.symbol}>
                <div>
                  <b>{x.symbol}</b>
                  <small>
                    Strength Δ {x.strengthDiff > 0 ? '+' : ''}
                    {x.strengthDiff}
                  </small>
                </div>
                <span>
                  <small>D1</small>
                  <b>{x.d1 === 'BULLISH' ? '↑' : x.d1 === 'BEARISH' ? '↓' : '→'}</b>
                </span>
                <span>
                  <small>H8</small>
                  <b>{x.h8 === 'BULLISH' ? '↑' : x.h8 === 'BEARISH' ? '↓' : '→'}</b>
                </span>
                <span>
                  <small>Position</small>
                  <b>{x.channelPos}%</b>
                </span>
                <Badge tone={dir(x.d1)}>{x.d1}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export function H1() {
  const { selected, instruments } = useTrading();
  const x = instruments.find((i) => i.symbol === selected) || instruments[0];
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
              ['Channel Location', `${x.channelPos}%`, x.channelPos > 0],
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
