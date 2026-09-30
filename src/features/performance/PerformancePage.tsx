import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, Metric, PageHeader, Tabs } from '../../components/UI';
import { postLearning, type LearningTrade, type SliceRow } from './services/learningClient';
import { reloadLearning, setLearningFilters, startLearningStore, useLearningStore } from './services/learningStore';
import '../market-data/market-data.css';
import '../market-scanner/market-scanner.css';

const TABS = ['Performance', 'Strategy Analytics', 'Decision Audit', 'Learning & Calibration', 'Historical Validation'] as const;
const PAGE_SIZE = 15;
const SLICES: { key: string; title: string }[] = [
  { key: 'bySetup', title: 'Setup type' },
  { key: 'byRelationship', title: 'Primary vs counter-trend' },
  { key: 'bySymbol', title: 'Instrument' },
  { key: 'bySide', title: 'Long / short' },
  { key: 'byRegime', title: 'Regime' },
  { key: 'bySession', title: 'Session' },
  { key: 'byAlignment', title: 'D1 / H8 / H1 alignment' },
  { key: 'byLocation', title: 'Parent-channel location' },
  { key: 'byNested', title: 'Nested-channel state' },
  { key: 'byConfidence', title: 'Confidence band' },
  { key: 'byRewardRisk', title: 'R:R band' },
];

const money = (value: number | null | undefined, currency: string | null) =>
  value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}${currency ? ` ${currency}` : ''}`;
const num = (value: number | null | undefined, suffix = '') => (value == null ? '—' : `${value}${suffix}`);

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
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

function SliceTable({ title, rows }: { title: string; rows: SliceRow[] }) {
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          <p>A group under 8 records stays INSUFFICIENT SAMPLE. Primary and counter-trend stay in separate rows.</p>
        </div>
      </div>
      {!rows.length ? (
        <p className="hr-reason">No stored trades in this filter.</p>
      ) : (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Sample</th>
                <th>Win rate</th>
                <th>Average R</th>
                <th>Reading</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>
                    <b>{r.label}</b>
                  </td>
                  <td>{r.sample}</td>
                  <td>{r.reliable ? num(r.winRate, '%') : '—'}</td>
                  <td>{r.averageR == null ? '—' : `${r.averageR}R`}</td>
                  <td>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Audit({ row }: { row: LearningTrade }) {
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>
            {row.symbol} · {row.decision || row.outcome} <Badge tone={row.outcome === 'WIN' ? 'green' : row.outcome === 'LOSS' ? 'red' : 'gray'}>{row.outcome}</Badge>
          </h3>
          <p>
            {row.setup} · {row.relationship} · process {row.process}. {row.kind === 'TRADE' ? 'P&L is the result, not the grade of the decision.' : row.reason || 'Non-trade decision.'}
          </p>
        </div>
      </div>
      <div className="kv">
        <span>Account</span>
        <b>
          {row.accountId || '—'} · {row.accountClass || '—'} {row.currency || ''}
        </b>
        <span>Setup</span>
        <b>{row.setupKey || row.setup || '—'}</b>
        <span>Primary / tradable</span>
        <b>
          {row.primaryTrend || '—'} / {row.tradable || '—'}
        </b>
        <span>Exit / reason</span>
        <b>{row.exitReason || row.reason || '—'}</b>
        <span>Realized</span>
        <b>
          {money(row.realizedPnl, row.currency || null)} · {row.rMultiple == null ? 'R —' : `${row.rMultiple}R`}
        </b>
        <span>Later path</span>
        <b>
          {row.path?.label || 'NO_PATH'} — {row.path?.detail || 'Later price path is not in the stored candles.'}
        </b>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="cs-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Stored at the time</th>
            </tr>
          </thead>
          <tbody>
            {(row.stages ?? []).map((s) => (
              <tr key={s.stage}>
                <td>{s.stage}</td>
                <td>{s.stored ? (typeof s.summary === 'string' ? s.summary : JSON.stringify(s.summary)) : 'Not present in the stored record.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HistoricalValidation() {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    fetch('/mt5-bridge/validation/report')
      .then((res) => res.json())
      .then((body) => { if (!stop) setReport(body); })
      .catch((err) => { if (!stop) setError(err instanceof Error ? err.message : 'Validation report unavailable'); });
    return () => { stop = true; };
  }, []);
  const coverage = (report?.coverage ?? {}) as { m15Symbols?: number; m5Symbols?: number; symbols?: number; note?: string; rows?: { symbol: string; measurable?: boolean; M15?: { count?: number }; M5?: { count?: number } }[] };
  const production = (report?.production ?? {}) as { operatorPositionLimit?: number; xauReservePct?: number; changed?: boolean };
  const stage6 = (report?.stage6 ?? {}) as { measured?: boolean; reason?: string };
  const rows = (coverage.rows ?? []).filter((row) => (row.M15?.count ?? 0) > 0 || (row.M5?.count ?? 0) > 0);
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Historical validation</h3>
          <p>LIVE configuration is unchanged. This surface is the historical-replay and coverage record, not a capacity or reserve change.</p>
        </div>
        <Badge tone="blue">HISTORICAL REPLAY</Badge>
      </div>
      {error && <p className="hr-reason">{error}</p>}
      <p className="hr-reason">
        Production operator limit {production.operatorPositionLimit ?? '—'} · XAU reserve {production.xauReservePct ?? 0}% · changed {production.changed ? 'yes' : 'no'}
        {' · '}M15 symbols {coverage.m15Symbols ?? 0}/{coverage.symbols ?? 29} · M5 symbols {coverage.m5Symbols ?? 0}/{coverage.symbols ?? 29}
        {' · '}replay {String(report?.replay ?? '—')}
      </p>
      <p className="hr-reason">{coverage.note}</p>
      <p className="hr-reason">{String(report?.executionModel ?? '')}</p>
      <p className="hr-reason">Normal continuation: {stage6.measured ? 'reconstructed' : 'not measured'}. {stage6.reason}</p>
      <p className="hr-reason">{String(report?.counterfactual ?? '')}</p>
      <div className="table-wrap">
        <table className="cs-table">
          <thead><tr><th>Symbol</th><th>M15</th><th>M5</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.symbol}><td>{row.symbol}</td><td>{row.M15?.count ?? 0}</td><td>{row.M5?.count ?? 0}</td></tr>
            )) : <tr><td colSpan={3}>No M15 or M5 candles stored yet. Backfill stays on the history queue and does not invent bars.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function PerformancePage() {
  const store = useLearningStore();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Performance');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const filters = store.filters;
  const state = store.state;

  useEffect(() => startLearningStore(), []);
  useEffect(() => setPage(0), [tab, state?.health.filteredTrades, state?.decisions.length, filters.accountId, filters.symbol, filters.setup, filters.relationship]);

  const auditRows = tab === 'Decision Audit' ? state?.decisions ?? [] : state?.trades ?? [];
  const pages = Math.max(1, Math.ceil(auditRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = auditRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const open = useMemo(() => auditRows.find((r) => r.key === selected) ?? null, [auditRows, selected]);
  const perf = state?.performance;
  const health = state?.health;

  const setFilter = (key: keyof typeof filters, value: string) => setLearningFilters({ ...filters, [key]: value || undefined });
  const act = async (path: string, body: Record<string, unknown>) => {
    try {
      setActionError('');
      await postLearning(path, body);
      reloadLearning();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Stage 10 action failed');
    }
  };

  return (
    <div className="ms-page">
      <PageHeader title="Performance & Learning" subtitle="Stage 10 · audit, measurement and controlled calibration from persisted Stage 1–9 evidence" />
      {actionError && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{actionError}</span>
        </div>
      )}
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error}</span>
        </div>
      )}
      {health && (
        <div className="hr-status">
          <Badge tone={health.status === 'HEALTHY' ? 'green' : health.status === 'DEGRADED' || health.status === 'BLOCKED' ? 'red' : 'amber'}>STAGE 10 {health.status}</Badge>
          <span>{health.message}</span>
          <span className="muted">
            {health.closedTrades} closed trades · {health.decisions} decision records · model {health.modelVersion}
            {health.candidateVersion ? ` · candidate ${health.candidateVersion}` : ''} · validation {health.validation}
          </span>
          <span className="muted">
            Next cycle: {health.nextCycle}. {health.productionUnchanged ? 'Production parameters stay unchanged.' : 'A promoted version is live. Rollback restores its predecessor.'} Governance {health.governance}.
          </span>
        </div>
      )}
      <div className="md-toolbar">
        <select value={filters.accountId || ''} onChange={(e) => setFilter('accountId', e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {(state?.filters.accounts ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.accountClass || ''} onChange={(e) => setFilter('accountClass', e.target.value)} aria-label="Account class">
          <option value="">Demo / live / prop</option>
          {(state?.filters.classes ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.symbol || ''} onChange={(e) => setFilter('symbol', e.target.value)} aria-label="Instrument">
          <option value="">All instruments</option>
          {(state?.filters.symbols ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.setup || ''} onChange={(e) => setFilter('setup', e.target.value)} aria-label="Setup type">
          <option value="">All setups</option>
          {(state?.filters.setups ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.relationship || ''} onChange={(e) => setFilter('relationship', e.target.value)} aria-label="Primary or counter-trend">
          <option value="">Primary and counter-trend</option>
          {(state?.filters.relationships ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.regime || ''} onChange={(e) => setFilter('regime', e.target.value)} aria-label="Regime">
          <option value="">All regimes</option>
          {(state?.filters.regimes ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.session || ''} onChange={(e) => setFilter('session', e.target.value)} aria-label="Session">
          <option value="">All sessions</option>
          {(state?.filters.sessions ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.timeframe || ''} onChange={(e) => setFilter('timeframe', e.target.value)} aria-label="Timeframe">
          <option value="">All timeframes</option>
          {(state?.filters.timeframes ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={filters.modelVersion || ''} onChange={(e) => setFilter('modelVersion', e.target.value)} aria-label="Model version">
          <option value="">All model versions</option>
          {(state?.filters.modelVersions ?? []).map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <input type="date" value={filters.from || ''} onChange={(e) => setFilter('from', e.target.value)} aria-label="From date" />
        <input type="date" value={filters.to || ''} onChange={(e) => setFilter('to', e.target.value)} aria-label="To date" />
      </div>
      <Tabs items={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} idPrefix="s10" label="Stage 10 sections" />

      {tab === 'Performance' && perf && (
        <>
          <div className="metrics">
            <Metric label="Net P&L" value={money(perf.netPnl, perf.currency)} sub={perf.netNote} />
            <Metric label="Win Rate" value={perf.winRate == null ? '—' : `${perf.winRate}%`} sub={`${perf.wins} wins · ${perf.losses} losses · ${perf.trades} trades`} />
            <Metric label="Profit Factor" value={perf.profitFactor == null ? '—' : perf.profitFactor} sub={perf.profitFactorNote} />
            <Metric label="Average R" value={perf.averageR == null ? '—' : `${perf.averageR}R`} sub={`${perf.trades} closed trades`} />
            <Metric label="Expectancy" value={perf.expectancy == null ? '—' : `${perf.expectancy}R`} sub={perf.expectancyNote} />
            <Metric label="Max Drawdown" value={money(perf.maxDrawdown == null ? null : -perf.maxDrawdown, perf.currency)} sub={perf.peakEquity == null ? perf.netNote : `Peak ${money(perf.peakEquity, perf.currency)} · now ${money(perf.currentEquity, perf.currency)}`} />
            <Metric label="Return / risk" value={perf.sharpe == null ? '—' : perf.sharpe} sub={perf.sharpeNote} />
            <Metric label="Avg Slippage" value={perf.avgSlippage == null ? '—' : `${perf.avgSlippage} pts`} sub={perf.slippageSample ? `${perf.slippageSample} fills` : 'No fill slippage stored'} />
          </div>
          <p className="hr-reason">{perf.processNote}</p>
          <div className="grid-2">
            <Card>
              <h3>Equity</h3>
              <div className="chart-lg">
                {!perf.curve.length ? (
                  <div className="empty-block">
                    <b>INSUFFICIENT SAMPLE</b>
                    <span>The curve is built only from closed Stage 9 trades in one account currency.</span>
                  </div>
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={perf.curve}>
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
              <h3>Drawdown</h3>
              <div className="chart-lg">
                {!perf.drawdown.length ? (
                  <div className="empty-block">
                    <b>INSUFFICIENT SAMPLE</b>
                    <span>Drawdown appears after closed trades in a single currency. Mixed USD and NGN results are not added together.</span>
                  </div>
                ) : (
                  <ResponsiveContainer>
                    <AreaChart data={perf.drawdown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="n" />
                      <YAxis />
                      <Tooltip />
                      <Area dataKey="drawdown" fillOpacity={0.18} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>
        </>
      )}

      {tab === 'Strategy Analytics' && (
        <div className="grid-2">
          {SLICES.map((s) => (
            <SliceTable key={s.key} title={s.title} rows={state?.analytics[s.key] ?? []} />
          ))}
        </div>
      )}

      {tab === 'Decision Audit' && (
        <>
          <Card>
            <div className="card-head">
              <div>
                <h3>Decision record</h3>
                <p>Executed trades and non-trade decisions (blocked, rejected, invalidated). Select a row to see the stages stored at that moment.</p>
              </div>
              <Badge tone="blue">{auditRows.length} in this filter</Badge>
            </div>
            {!auditRows.length ? (
              <div className="empty-block">
                <b>INSUFFICIENT SAMPLE</b>
                <span>No decision records match this filter yet. Stage 10 keeps collecting them while this page is closed.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <Pager page={safePage} pages={pages} total={auditRows.length} onPage={setPage} />
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Instrument</th>
                      <th>Decision</th>
                      <th>Setup</th>
                      <th>Relationship</th>
                      <th>Outcome</th>
                      <th>Process</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.key} className="hr-click" onClick={() => setSelected(r.key)}>
                        <td>{r.closedAt || '—'}</td>
                        <td>
                          <b>{r.symbol}</b>
                        </td>
                        <td>{r.decision}</td>
                        <td>{r.setup}</td>
                        <td>{r.relationship}</td>
                        <td>{r.outcome}</td>
                        <td>{r.process}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager page={safePage} pages={pages} total={auditRows.length} onPage={setPage} />
              </div>
            )}
          </Card>
          {open && <Audit row={open} />}
        </>
      )}

      {tab === 'Historical Validation' && <HistoricalValidation />}
      {tab === 'Learning & Calibration' && (
        <>
          <div className="metrics">
            <Metric label="Evidence" value={health ? health.closedTrades + health.decisions : '—'} sub={`${health?.closedTrades ?? 0} trades · ${health?.decisions ?? 0} decisions`} />
            <Metric label="Lifecycle" value={health?.lifecycle ?? 'OBSERVE'} sub={health?.sampleSufficient ? 'Sample can support a candidate' : `Needs ${health?.requiredTrades ?? 20} closed trades`} />
            <Metric label="Production" value={health?.productionUnchanged === false ? 'PROMOTED' : 'UNCHANGED'} sub={health?.modelVersion || 'No version rewrite'} />
            <Metric label="Candidate" value={health?.candidateVersion || 'NONE'} sub={health?.validation || 'NOT_RUN'} />
          </div>
          <Card>
            <h3>Insights</h3>
            <div className="insights">
              {(state?.insights ?? []).map((item) => (
                <div key={item.code}>
                  <b>{item.title}</b>
                  <span>
                    {item.detail} Evidence: {item.evidenceKeys.length ? item.evidenceKeys.join(', ') : 'none stored'}.
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="card-head">
              <div>
                <h3>Calibration candidates</h3>
                <p>OBSERVE → MEASURE → IDENTIFY → PROPOSE → BACKTEST → VALIDATE → SHADOW → APPROVE → MONITOR → ROLLBACK. A candidate is not copied onto production parameters.</p>
              </div>
              <select value={health?.governance || 'MANUAL'} aria-label="Promotion governance" onChange={(e) => act('/learning/governance', { mode: e.target.value })}>
                <option value="MANUAL">MANUAL — approve required</option>
                <option value="AUTO">AUTO — later shadow sample required</option>
              </select>
            </div>
            {!state?.proposals.length ? (
              <div className="empty-block">
                <b>INSUFFICIENT SAMPLE</b>
                <span>No candidate exists. Stage 10 needs {health?.requiredTrades ?? 20} closed trades before it can propose a parameter, and it still will not apply that proposal by itself.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Lifecycle</th>
                      <th>Production</th>
                      <th>Candidate</th>
                      <th>Sample</th>
                      <th>Validation</th>
                      <th>Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.proposals.map((p) => {
                      const ready = p.lifecycle === 'SHADOW' && p.evidence?.validation?.status === 'PASSED' && !p.applied;
                      return (
                      <tr key={p.key}>
                        <td>
                          <b>{p.parameter}</b>
                          <small className="hr-reason"> {p.evidence?.validation?.detail || p.reason}</small>
                        </td>
                        <td>{p.lifecycle}</td>
                        <td>{p.productionValue ?? '—'}</td>
                        <td>{p.candidateValue ?? '—'}</td>
                        <td>
                          {p.sample} / {p.required}
                        </td>
                        <td>{p.evidence?.validation?.status || 'NOT_RUN'}</td>
                        <td>
                          {p.applied ? 'YES' : 'NO'}
                          <button type="button" disabled={!ready} onClick={() => act('/learning/approve', { parameter: p.parameter, actor: 'operator' })}>
                            Approve
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card>
            <div className="card-head">
              <div>
                <h3>Version history</h3>
              </div>
              <button
                type="button"
                disabled={!state?.versions.some((v) => v.kind === 'PROMOTED')}
                onClick={() => act('/learning/rollback', { actor: 'operator' })}
              >
                Rollback
              </button>
            </div>
            {!state?.versions.length ? (
              <p className="hr-reason">No parameter version has been promoted. The live risk configuration remains the production version.</p>
            ) : (
              <div className="table-wrap">
                <table className="cs-table">
                  <thead>
                    <tr>
                      <th>Version</th>
                      <th>Kind</th>
                      <th>Vs predecessor</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.versions.map((v) => (
                      <tr key={v.id}>
                        <td>{v.label}</td>
                        <td>{v.kind}</td>
                        <td>{v.comparison || '—'}</td>
                        <td>{v.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
