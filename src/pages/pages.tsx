import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, PauseCircle, PlayCircle, Zap } from 'lucide-react';
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
import { ExecutionPositionsPage, executionStageStatus, useExecutionStore } from '../features/execution';
import { PerformancePage } from '../features/performance';
import { useAutonomyState } from '../features/workflow-engine/services/autonomyStore';
import { EmailNotificationsPanel } from '../features/notifications/EmailNotificationsPanel';

const dir = (x: string) => (x === 'BULLISH' ? 'green' : x === 'BEARISH' ? 'red' : 'gray');
const PAGE_SIZE = 15;

function CandidatePager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div className="ms-pager">
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
  const [page, setPage] = useState(0);
  const scanner = useScannerStore();
  const bySymbol = useMemo(() => {
    const m = new Map<string, { rank: number; state: string; conviction: number | null; threshold: number | null; reason: string }>();
    for (const row of scanner.state?.instruments ?? []) {
      m.set(row.symbol, {
        rank: row.rank,
        state: row.state,
        conviction: row.conviction,
        threshold: row.promotion.threshold ?? null,
        reason: row.reason,
      });
    }
    return m;
  }, [scanner.state]);
  const gated = instruments.map((i) => ({ ...i, state: gatedState(i) }));
  const rank = (s: string) => (s === 'READY' ? 0 : s === 'WAIT' ? 1 : 2);
  const ordered = [...gated].sort((a, b) => {
    if (bySymbol.size) return (bySymbol.get(a.symbol)?.rank ?? 999) - (bySymbol.get(b.symbol)?.rank ?? 999);
    return rank(a.state) - rank(b.state) || b.score - a.score;
  });
  const rows = limit ? ordered.slice(0, limit) : ordered;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = limit ? rows : rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => setPage(0), [rows.length, limit]);
  if (!rows.length) {
    return <EmptyState title="No instrument data" detail="Connect MT5 and sync market state into db_Cacsms-Trader." />;
  }
  return (
    <div className="table-wrap">
      {!limit && <CandidatePager page={safePage} pages={pages} total={rows.length} onPage={setPage} />}
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
            <th title="Quote snapshot: daily and 8-hour candle agreement plus today's move. This is not the promotion score.">Score</th>
            <th title="Stage 4 promotion conviction. A pair is promoted at 55.">Conviction</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((x) => (
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
                {(() => {
                  const scan = bySymbol.get(x.symbol);
                  const bar = scan?.threshold ?? 55;
                  const title = scan ? `${scan.state}: ${scan.reason}` : 'Stage 4 has not ranked this pair';
                  return (
                    <b title={title} className={scan?.conviction != null && scan.conviction >= bar ? 'positive' : undefined}>
                      {scan?.conviction != null ? scan.conviction.toFixed(1) : '—'}
                      {scan ? <small className="muted"> {scan.state}</small> : null}
                    </b>
                  );
                })()}
              </td>
              <td>
                <Badge tone={x.state === 'READY' ? 'green' : x.state === 'BLOCKED' ? 'red' : 'amber'}>{x.state}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!limit && <CandidatePager page={safePage} pages={pages} total={rows.length} onPage={setPage} />}
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
  const autonomy = useAutonomyState();
  const learningStatus = autonomy?.learning?.status ?? 'WAITING';
  const stageOk = (idx: number) =>
    idx === 0
      ? !!stage1Pass
      : idx === 1
        ? regimeStatus === 'HEALTHY' && regimeClassified > 0
        : idx === 2
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
                      : learningStatus === 'HEALTHY';
  const stageNote = (idx: number) => {
    if (idx === 1) return regimeClassified ? `${regimeStatus} · ${regimeClassified}/9 assets with strength` : `${regimeStatus} · waiting for Stage 2`;
    if (idx === 2) return `${regimeStatus} · ${regimeClassified}/9 classified`;
    if (idx === 9) return autonomy?.learning?.summary?.message ?? `${learningStatus} · engine health is separate from a learned trade`;
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
              <b>{autonomy?.orchestrator?.status ?? (autonomy && !autonomy.ok ? 'OFFLINE' : 'STARTING')}</b>
              <span>
                {autonomy?.orchestrator?.message
                  ?? (autonomy?.message || 'Waiting for the bridge orchestrator. Opening this page does not start the pipeline.')}
                {autonomy?.orchestrator ? ` · cycle ${autonomy.orchestrator.cycles ?? '—'}` : ''}
                {stage1Pass ? ` · ${readyCount} of ${stage1Pass} instruments currently valid` : blockReason ? ` · ${blockReason}` : ''}
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
              <EmptyState title="No events yet" detail="Decisions and system events are stored in SQLite." />
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

/** Stage 10 reads persisted Stage 1–9 evidence. The bridge loop runs whether or not this page is open. */
export function Performance() {
  return <PerformancePage />;
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
            ['SQLite', sql.ok ? `ONLINE · ${sql.database}` : 'OFFLINE'],
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
      <EmailNotificationsPanel />
    </>
  );
}
