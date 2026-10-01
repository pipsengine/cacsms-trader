import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  BrainCircuit,
  Database,
  Download,
  RefreshCw,
  Settings,
  Sparkles,
  Activity,
} from 'lucide-react';
import { Badge, Card, PageHeader, Tabs, tabIds } from '../../components/UI';
import { ASSETS, HORIZONS, type Asset, type FeedStatus, type IntelligenceSnapshot, type StrengthRow, type TrendCell, type TrendRow, type TrendSnapshot } from './types';
import { fetchStrengthIntelligence, fetchTrendIntelligence } from './services/intelligenceClient';
import './strength-intelligence.css';

const TABS = ['Strength Matrix', 'Trend Analysis', 'Correlation', 'Volatility', 'Sentiment', 'Order Flow', 'Liquidity', 'AI Projection'];
const PERIODS = ['24H', '7D', '30D', '3M', '6M', 'YTD', '1Y', 'Custom'];
const FLAGS: Record<Asset, string> = { AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', GBP: '🇬🇧', EUR: '🇪🇺', JPY: '🇯🇵', NZD: '🇳🇿', USD: '🇺🇸', XAU: '🟨' };

function n(v: number | null | undefined, digits = 1) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function signed(v: number | null | undefined, digits = 1) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
}

function heat(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return 'si-heat empty';
  if (v >= 75) return 'si-heat v5';
  if (v >= 60) return 'si-heat v4';
  if (v >= 45) return 'si-heat v3';
  if (v >= 30) return 'si-heat v2';
  return 'si-heat v1';
}

function trendClass(state: string) {
  const s = state.split(' + ')[0];
  if (s === 'Strong Bullish') return 'ti-cell strong-bull';
  if (s === 'Bullish') return 'ti-cell bull';
  if (s === 'Bullish Weakening') return 'ti-cell bull-weak';
  if (s === 'Neutral / Range') return 'ti-cell neutral';
  if (s === 'Bearish Weakening') return 'ti-cell bear-weak';
  if (s === 'Bearish') return 'ti-cell bear';
  if (s === 'Strong Bearish') return 'ti-cell strong-bear';
  return 'ti-cell insufficient';
}

function trendGlyph(state: string) {
  const s = state.split(' + ')[0];
  if (s === 'Strong Bullish') return '↑↑';
  if (s === 'Bullish') return '↑';
  if (s === 'Bullish Weakening') return '↗';
  if (s === 'Neutral / Range') return '→';
  if (s === 'Bearish Weakening') return '↘';
  if (s === 'Bearish') return '↓';
  if (s === 'Strong Bearish') return '↓↓';
  return '!';
}

function tone(status: FeedStatus) {
  return status === 'LIVE' ? 'green' : status === 'DISCONNECTED' || status === 'STALE' ? 'red' : 'amber';
}

function TrendIcon({ row }: { row: StrengthRow }) {
  const cls = row.trend === 'UP' ? 'up' : row.trend === 'DOWN' ? 'down' : 'flat';
  const Icon = row.trend === 'UP' ? ArrowUp : row.trend === 'DOWN' ? ArrowDown : ArrowRight;
  return (
    <span className={`si-trend ${cls}`} title={`Velocity ${signed(row.velocity, 3)}`}>
      <Icon size={15} />
    </span>
  );
}

function UnavailableTab({ title }: { title: string }) {
  return (
    <Card>
      <div className="empty-block">
        <b>{title} not implemented yet</b>
        <span>This indicator tab is reserved in the Intelligence Indicators structure. It is intentionally not filled with fabricated data.</span>
      </div>
    </Card>
  );
}

function TrendMatrix({ rows, selected, onSelected }: { rows: TrendRow[]; selected: Asset; onSelected: (asset: Asset) => void }) {
  return (
    <Card className="si-card">
      <div className="si-card-head">
        <div>
          <h3><Activity size={18} /> Multi-Timeframe Trend Matrix</h3>
          <p>Closed-bar directional structure, persistence and weighted cross-timeframe alignment.</p>
        </div>
      </div>
      <div className="table-wrap si-table-wrap ti-matrix-wrap">
        <table className="si-table ti-table">
          <thead>
            <tr>
              <th>Asset</th>
              {HORIZONS.map((h) => <th key={h}>{h}</th>)}
              <th>Alignment</th>
              <th>Strength</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.asset} className={row.asset === selected ? 'row-selected' : ''} onClick={() => onSelected(row.asset)}>
                <td className="si-asset"><span>{FLAGS[row.asset]}</span><b>{row.asset}</b></td>
                {HORIZONS.map((h) => {
                  const cell = row.timeframes[h] as TrendCell;
                  return (
                    <td key={h} className={trendClass(cell.direction)} title={`${cell.direction} | score ${n(cell.trendScore)} | confidence ${n(cell.confidence)}%`}>
                      <b>{trendGlyph(cell.direction)}</b>
                      <span>{cell.direction.replace(' + Potential Reversal / Transition', ' + Transition')}</span>
                    </td>
                  );
                })}
                <td><b>{n(row.alignment, 0)}%</b><small>{row.alignmentLabel}</small></td>
                <td className={heat(row.strength)}>{n(row.strength, 0)}</td>
                <td><Badge tone={row.titState === 'Trend Continuation' ? 'green' : row.titState === 'Pullback' ? 'amber' : row.titState === 'Potential Reversal' ? 'red' : 'gray'}>{row.titState}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CurrentTrendIntelligence({ row }: { row: TrendRow | undefined }) {
  if (!row) return <Card className="si-card"><div className="empty-block"><b>Select an asset</b><span>Trend intelligence will appear here.</span></div></Card>;
  const details = [
    ['Overall Direction', row.overallDirection],
    ['Trend Strength', n(row.strength, 0)],
    ['Alignment', `${n(row.alignment, 0)}%`],
    ['Persistence', `${n(row.persistence, 0)}%`],
    ['Momentum', signed(row.momentum, 2)],
    ['Acceleration', signed(row.acceleration, 2)],
    ['Current Structure', row.currentStructure],
    ['Market Regime', row.marketRegime],
    ['HTF Direction', row.htfDirection],
    ['LTF Direction', row.ltfDirection],
    ['TiT State', row.titState],
    ['Last Update', new Date(row.lastUpdate).toLocaleTimeString()],
  ];
  const ev = row.lastStructuralEvent;
  return (
    <Card className="si-card ti-current">
      <div className="si-card-head">
        <div>
          <h3>{FLAGS[row.asset]} {row.asset} Current Trend Intelligence</h3>
          <p>Deterministic explanation from calculated trend, structure and TiT evidence.</p>
        </div>
        <Badge tone={row.dataQuality === 'OK' ? 'green' : row.dataQuality === 'DEGRADED' ? 'amber' : 'red'}>{row.dataQuality}</Badge>
      </div>
      <div className="ti-detail-grid">
        {details.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}
        <div><small>Last Structural Event</small><b>{ev ? `${ev.timeframe} ${ev.kind} ${ev.direction}` : '-'}</b></div>
      </div>
      <p className="ti-explain">{row.explanation}</p>
    </Card>
  );
}

function TrendTransitionMonitor({ rows }: { rows: TrendSnapshot['transitions'] }) {
  return (
    <Card className="si-card">
      <div className="si-card-head">
        <div>
          <h3>Trend Transition Monitor</h3>
          <p>Debounced structural state changes only.</p>
        </div>
      </div>
      <div className="table-wrap ti-transition-wrap">
        <table className="si-table">
          <thead><tr><th>Asset</th><th>TF</th><th>Previous</th><th>Current</th><th>Strength</th><th>Event</th><th>Time</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={`${r.asset}-${r.timeframe}-${r.time}-${i}`}>
                <td className="si-asset"><span>{FLAGS[r.asset]}</span><b>{r.asset}</b></td>
                <td>{r.timeframe}</td>
                <td>{r.previous}</td>
                <td>{r.current}</td>
                <td>{n(r.strength, 0)}</td>
                <td>{r.event}</td>
                <td>{new Date(r.time).toLocaleTimeString()}</td>
              </tr>
            )) : <tr><td colSpan={7} className="si-unavailable">No meaningful trend transitions in the selected window.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HistoricalTrend({ data, period, onPeriod }: { data: TrendSnapshot | null; period: string; onPeriod: (x: string) => void }) {
  return (
    <Card className="si-card">
      <div className="si-card-head">
        <div>
          <h3>Historical Trend Intelligence</h3>
          <p>Stored trend states and transitions for AI-ready feature context.</p>
        </div>
        <Badge tone="gray">{data?.history.total ?? 0} records</Badge>
      </div>
      <div className="si-toolbar">
        <div className="si-periods">
          {PERIODS.map((x) => <button key={x} type="button" className={period === x ? 'primary' : ''} onClick={() => onPeriod(x)}>{x}</button>)}
        </div>
      </div>
      <div className="table-wrap si-history-table-wrap">
        <table className="si-table">
          <thead><tr><th>#</th><th>Timestamp</th><th>Asset</th><th>Direction</th><th>Strength</th><th>Alignment</th><th>Persistence</th><th>Momentum</th><th>Regime</th><th>TiT</th></tr></thead>
          <tbody>
            {(data?.history.rows ?? []).map((r, i) => (
              <tr key={`${r.timestamp}-${r.asset}-${i}`}>
                <td className="rank">{i + 1}</td>
                <td>{new Date(r.timestamp).toLocaleString()}</td>
                <td className="si-asset"><span>{FLAGS[r.asset]}</span><b>{r.asset}</b></td>
                <td>{r.direction}</td>
                <td className={heat(r.strength)}>{n(r.strength, 0)}</td>
                <td>{n(r.alignment, 0)}%</td>
                <td>{n(r.persistence, 0)}%</td>
                <td>{signed(r.momentum, 2)}</td>
                <td>{r.regime}</td>
                <td>{r.titState}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TrendAnalysisTab({ selected, onSelected }: { selected: Asset; onSelected: (asset: Asset) => void }) {
  const [period, setPeriod] = useState('24H');
  const [data, setData] = useState<TrendSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    let timer = 0;
    let failures = 0;
    const load = async () => {
      try {
        const next = await fetchTrendIntelligence({ period, limit: 80, asset: selected });
        if (dead) return;
        setData(next);
        setError(next.ok ? '' : next.feed.message);
        failures = next.ok ? 0 : failures + 1;
      } catch (exc) {
        failures += 1;
        if (!dead) setError(exc instanceof Error ? exc.message : 'Trend intelligence unavailable');
      } finally {
        if (!dead) {
          setLoading(false);
          timer = window.setTimeout(load, failures ? Math.min(15_000, 3_000 * failures) : 5000);
        }
      }
    };
    void load();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [period, selected]);

  const row = data?.matrix.find((x) => x.asset === selected) ?? data?.matrix[0];
  if (loading && !data) {
    return <Card><div className="empty-block"><RefreshCw size={18} className="hr-spin" /><b>Loading trend intelligence</b><span>Reading closed bars from the existing MT5 bridge.</span></div></Card>;
  }
  if (!data?.matrix.length) {
    return <Card><div className="empty-block"><b>Trend intelligence unavailable</b><span>{error || 'Connect MT5 and ensure required symbols are available.'}</span></div></Card>;
  }
  return (
    <>
      {error && <div className="hr-banner err"><AlertTriangle size={14} /><span>{error}</span></div>}
      <TrendMatrix rows={data.matrix} selected={selected} onSelected={onSelected} />
      <div className="ti-mid-grid">
        <CurrentTrendIntelligence row={row} />
        <TrendTransitionMonitor rows={data.transitions ?? []} />
      </div>
      <HistoricalTrend data={data} period={period} onPeriod={setPeriod} />
    </>
  );
}

function FeedStrip({ data, stale }: { data: IntelligenceSnapshot | null; stale: boolean }) {
  const feed = data?.feed;
  return (
    <div className="si-feed-strip">
      <div>
        <small>Server Time</small>
        <b>{feed?.serverTime ? new Date(feed.serverTime).toLocaleTimeString() : '-'}</b>
      </div>
      <div>
        <small>Latency</small>
        <b>{feed?.latencyMs != null ? `${feed.latencyMs} ms` : '-'}</b>
      </div>
      <div>
        <small>Feed Status</small>
        <Badge tone={tone(stale ? 'STALE' : feed?.status ?? 'DISCONNECTED')}>{stale ? 'STALE' : (feed?.status ?? 'DISCONNECTED')}</Badge>
      </div>
      <div>
        <small>Last Tick</small>
        <b>{feed?.lastTick ? new Date(feed.lastTick).toLocaleTimeString() : '-'}</b>
      </div>
      <div>
        <small>Next UI Update</small>
        <b>{feed?.nextUiUpdateMs ? `${(feed.nextUiUpdateMs / 1000).toFixed(1)} s` : '1.0 s'}</b>
      </div>
    </div>
  );
}

function StrengthMatrix({ rows }: { rows: StrengthRow[] }) {
  return (
    <Card className="si-card">
      <div className="si-card-head">
        <div>
          <h3>
            <Sparkles size={18} /> Currency Strength Matrix (0 - 100)
          </h3>
          <p>Real-time currency strength across all configured horizons. YTD is measured from January 1 of the current trading year.</p>
        </div>
        <div className="si-actions">
          <button type="button" className="primary">Show Values</button>
          <button type="button">Show Colors</button>
          <select aria-label="Calculation method">
            <option>Calculation: Close-Close</option>
          </select>
          <button type="button" aria-label="Matrix settings" title="Matrix settings">
            <Settings size={15} />
          </button>
        </div>
      </div>
      <div className="table-wrap si-table-wrap">
        <table className="si-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Currency</th>
              {HORIZONS.map((h) => <th key={h}>{h}</th>)}
              <th>Composite</th>
              <th>Trend</th>
              <th>Accel</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.asset}>
                <td className="rank">{i + 1}</td>
                <td className="si-asset"><span>{FLAGS[row.asset]}</span><b>{row.asset}</b></td>
                {HORIZONS.map((h) => <td key={h} className={heat(row.values[h])}>{n(row.values[h])}</td>)}
                <td className={heat(row.composite)}><b>{n(row.composite)}</b></td>
                <td><TrendIcon row={row} /></td>
                <td className={row.acceleration >= 0 ? 'positive' : 'negative'}>{signed(row.acceleration, 2)}</td>
                <td><span className="si-rank-pill">{row.rank}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PredictionPanel({ data, selected, onSelected }: { data: IntelligenceSnapshot | null; selected: Asset; onSelected: (x: Asset) => void }) {
  const row = data?.matrix.find((x) => x.asset === selected) ?? data?.matrix[0];
  const current = row?.composite ?? null;
  return (
    <Card className="si-card">
      <div className="si-card-head">
        <div>
          <h3><BrainCircuit size={18} /> AI Analysis & Predictions</h3>
          <p>Forecast area is model output only. Observed strength remains separate from unavailable model forecasts.</p>
        </div>
        <div className="si-model-status">
          Model: {data?.predictions.modelVersion ?? 'Awaiting model'}
          <Badge tone={data?.predictions.status === 'ACTIVE' ? 'green' : 'amber'}>{data?.predictions.status?.replaceAll('_', ' ') ?? 'MODEL NOT AVAILABLE'}</Badge>
        </div>
      </div>
      <div className="si-ai-grid">
        <div className="table-wrap">
          <table className="si-table">
            <thead>
              <tr>
                <th>#</th><th>Asset</th><th>Current</th><th>15M</th><th>1H</th><th>4H</th><th>8H</th><th>1D</th><th>Confidence</th><th>Regime</th><th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {(data?.matrix ?? []).map((x, i) => (
                <tr key={x.asset} className={x.asset === selected ? 'row-selected' : ''} onClick={() => onSelected(x.asset)}>
                  <td className="rank">{i + 1}</td>
                  <td className="si-asset"><span>{FLAGS[x.asset]}</span><b>{x.asset}</b></td>
                  <td className={heat(x.composite)}>{n(x.composite)}</td>
                  <td colSpan={5} className="si-unavailable">MODEL NOT AVAILABLE</td>
                  <td>-</td>
                  <td>{x.composite >= 60 ? 'Strong' : x.composite <= 40 ? 'Weak' : 'Neutral'}</td>
                  <td><Badge tone="gray">WATCH</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="si-detail">
          <h3>{row ? `${FLAGS[row.asset]} ${row.asset}` : 'Asset'} - AI Prediction Detail</h3>
          <div className="si-big">
            {n(current)}
            <Badge tone={current == null ? 'gray' : current >= 60 ? 'green' : current <= 40 ? 'red' : 'amber'}>
              Observed
            </Badge>
          </div>
          <div className="si-forecast-cards">
            {['15M', '1H', '4H', '8H', '1D'].map((h) => <div key={h}><small>{h}</small><b>-</b></div>)}
          </div>
          <div className="si-model-empty">
            <Bot size={18} />
            <span>{data?.predictions.message ?? 'MODEL NOT AVAILABLE / AWAITING MODEL'}</span>
          </div>
          <div className="si-detail-grid">
            <div><small>Expected Range</small><b>-</b></div>
            <div><small>Confidence</small><b>-</b></div>
            <div><small>Market Regime</small><b>{current == null ? '-' : current >= 60 ? 'Strong' : current <= 40 ? 'Weak' : 'Neutral'}</b></div>
          </div>
        </aside>
      </div>
    </Card>
  );
}

function HistoricalStrength({ data, period, onPeriod, search, onSearch }: {
  data: IntelligenceSnapshot | null;
  period: string;
  onPeriod: (x: string) => void;
  search: string;
  onSearch: (x: string) => void;
}) {
  return (
    <Card className="si-card si-history-card">
      <div className="si-card-head">
        <div>
          <h3><Database size={18} /> Historical Strength Data</h3>
          <p>Timestamped strength values (0 - 100). Resolution is selected server-side for the chosen lookback.</p>
        </div>
        <Badge tone={data?.feed.status === 'LIVE' ? 'green' : 'amber'}>{data?.history.total ?? 0} records</Badge>
      </div>
      <div className="si-toolbar">
        <div className="si-periods">
          {PERIODS.map((x) => <button key={x} type="button" className={period === x ? 'primary' : ''} onClick={() => onPeriod(x)}>{x}</button>)}
        </div>
        <input type="datetime-local" aria-label="Start date" />
        <input type="datetime-local" aria-label="End date" />
        <select aria-label="Resolution" value={data?.history.resolution ?? 'auto'} onChange={() => undefined}>
          <option value="auto">Auto Resolution</option>
          <option value="1s">1 Second</option>
          <option value="1m">1 Minute</option>
          <option value="5m">5 Minutes</option>
          <option value="1h">1 Hour</option>
        </select>
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search records..." />
        <button type="button" title="CSV export"><Download size={14} /> CSV</button>
      </div>
      <div className="table-wrap si-history-table-wrap">
        <table className="si-table">
          <thead>
            <tr><th>#</th><th>Timestamp</th>{ASSETS.map((a) => <th key={a}>{a}</th>)}</tr>
          </thead>
          <tbody>
            {(data?.history.rows ?? []).map((row, i) => (
              <tr key={row.timestamp}>
                <td className="rank">{i + 1}</td>
                <td>{new Date(row.timestamp).toLocaleString()}</td>
                {ASSETS.map((a) => <td key={a} className={heat(row.values[a])}>{n(row.values[a])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AverageStrength({ rows }: { rows: StrengthRow[] }) {
  return (
    <Card className="si-card si-average-card">
      <div className="si-card-head">
        <div>
          <h3>Average Strength (All Timeframes)</h3>
          <p>One weighted composite per instrument from the canonical matrix snapshot.</p>
        </div>
        <button type="button" title="Export average strength"><Download size={14} /> Export</button>
      </div>
      <table className="si-table">
        <thead><tr><th>Rank</th><th>Currency</th><th>Average</th><th>Strength Bar</th><th>Trend</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.asset}>
              <td><span className="si-rank-pill">{row.rank}</span></td>
              <td className="si-asset"><span>{FLAGS[row.asset]}</span><b>{row.asset}</b></td>
              <td className={heat(row.composite)}>{n(row.composite)}</td>
              <td><div className="si-bar"><i style={{ width: `${Math.max(0, Math.min(100, row.composite))}%` }} /></div></td>
              <td><TrendIcon row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function StrengthIntelligencePage() {
  const [tab, setTab] = useState('Strength Matrix');
  const [period, setPeriod] = useState('24H');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Asset>('USD');
  const [data, setData] = useState<IntelligenceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let dead = false;
    let timer = 0;
    let failures = 0;
    const load = async () => {
      try {
        const next = await fetchStrengthIntelligence({ period, search, limit: 80 });
        if (dead) return;
        setData(next);
        setError(next.ok ? '' : next.feed.message);
        failures = next.ok ? 0 : failures + 1;
      } catch (exc) {
        failures += 1;
        if (!dead) setError(exc instanceof Error ? exc.message : 'Strength intelligence unavailable');
      } finally {
        if (!dead) {
          setLoading(false);
          timer = window.setTimeout(load, failures ? Math.min(10_000, 2_000 * failures) : 1000);
        }
      }
    };
    void load();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [period, search]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((x) => x + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stale = useMemo(() => {
    if (!data?.timestamp) return true;
    return Date.now() - Date.parse(data.timestamp) > 10_000 || data.feed.status === 'STALE' || data.feed.status === 'DISCONNECTED';
  }, [data, tick]);
  const ids = tabIds('intelligence', tab);

  return (
    <>
      <PageHeader title="Strength Matrix" subtitle="Multi-timeframe currency strength intelligence with AI-ready prediction contracts" />
      <FeedStrip data={data} stale={stale} />
      {error && <div className="hr-banner err"><AlertTriangle size={14} /><span>{error}</span></div>}
      {stale && data?.matrix.length ? <div className="hr-banner warn"><AlertTriangle size={14} /><span>Feed is stale. Values below are the last persisted snapshot, not current intelligence.</span></div> : null}
      {data?.dataQuality?.missing?.length ? (
        <div className="hr-banner warn"><AlertTriangle size={14} /><span>Data quality warning: missing or insufficient pair data detected. Matrix quality {n(data.quality, 0)}%.</span></div>
      ) : null}
      <Tabs items={TABS} active={tab} onChange={setTab} idPrefix="intelligence" label="Intelligence Indicators" />
      <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} className="si-page">
        {tab === 'Trend Analysis' ? (
          <TrendAnalysisTab selected={selected} onSelected={setSelected} />
        ) : tab !== 'Strength Matrix' ? (
          <UnavailableTab title={tab} />
        ) : loading && !data ? (
          <Card><div className="empty-block"><RefreshCw size={18} className="hr-spin" /><b>Loading strength intelligence</b><span>Reading MT5 market data from the existing bridge.</span></div></Card>
        ) : !data?.matrix.length ? (
          <Card><div className="empty-block"><b>Strength intelligence unavailable</b><span>Connect MT5 and ensure the required 28 FX crosses plus XAUUSD are available.</span></div></Card>
        ) : (
          <>
            <StrengthMatrix rows={data.matrix} />
            <PredictionPanel data={data} selected={selected} onSelected={setSelected} />
            <div className="si-lower-grid">
              <HistoricalStrength data={data} period={period} onPeriod={setPeriod} search={search} onSearch={setSearch} />
              <AverageStrength rows={data.average ?? data.matrix} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

