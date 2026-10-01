import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Card, PageHeader, Tabs } from '../../components/UI';
import { useAutonomyState } from '../workflow-engine/services/autonomyStore';
import {
  fetchFrameworkOpportunityHistory,
  fetchFrameworkHistory,
  lifecycleTone,
  type FrameworkHypothesis,
  type FrameworkTransition,
} from '../workflow-engine/services/frameworkClient';
import { getFrameworkSnapshot, startFrameworkStore, subscribeFramework } from '../workflow-engine/services/frameworkStore';
import { ALL_OP_TYPES, OP_FAMILY, STALE_MS } from './constants';
import { OpportunityDrawer } from './components/OpportunityDrawer';
import { KpiCards } from './components/KpiCards';
import {
  KPI_DETAIL,
  filterHypotheses,
  kpiFromSummary,
  lifecycleDisplay,
  pickXauPriority,
  sortHypotheses,
  structureLabel,
  triggerLabel,
  type KpiKey,
  type SortKey,
  type TabKey,
} from './utils';
import './trading-opportunities.css';

const TABS: TabKey[] = ['ALL ACTIVE', 'APPROACHING', 'CONFIRMING', 'READY', 'AUTHORIZED', 'SHADOW', 'HISTORY'];

function ageSec(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
}

function fmtAge(sec: number | null) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function TradingOpportunitiesPage() {
  const autonomy = useAutonomyState();
  const [, tick] = useState(0);
  const snap = getFrameworkSnapshot();
  const fw = snap.data?.framework;
  const loading = snap.loading && !fw;
  const error = snap.error;

  const [tab, setTab] = useState<TabKey>('ALL ACTIVE');
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('ALL');
  const [opType, setOpType] = useState('ALL');
  const [direction, setDirection] = useState('ALL');
  const [lifecycle, setLifecycle] = useState('ALL');
  const [mode, setMode] = useState('ALL');
  const [stage, setStage] = useState('ALL');
  const [tf, setTf] = useState('ALL');
  const [sort, setSort] = useState<SortKey>('updated');
  const [sortDesc] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kpiFocus, setKpiFocus] = useState<KpiKey | null>(null);
  const [timeline, setTimeline] = useState<FrameworkTransition[]>([]);
  const [historyRows, setHistoryRows] = useState<FrameworkTransition[]>([]);

  useEffect(() => startFrameworkStore(), []);
  useEffect(() => {
    const off = subscribeFramework(() => {
      tick((n) => n + 1);
    });
    return () => {
      off();
    };
  }, []);

  const hypotheses = fw?.hypotheses ?? [];
  const generatedAt = fw?.generatedAt;
  const age = ageSec(generatedAt);
  const stale = age != null && age * 1000 > STALE_MS;
  const scanned = fw?.summary.scanned ?? 0;
  const universe = fw?.summary.universe ?? 29;

  const kpi = useMemo(() => kpiFromSummary(fw?.summary, hypotheses), [fw?.summary, hypotheses]);
  const xau = useMemo(() => pickXauPriority(hypotheses), [hypotheses]);

  const filtered = useMemo(
    () =>
      sortHypotheses(
        filterHypotheses(hypotheses, { tab, q, family, opType, direction, lifecycle, mode, stage, tf }),
        sort,
        sortDesc,
      ),
    [hypotheses, tab, q, family, opType, direction, lifecycle, mode, stage, tf, sort, sortDesc],
  );

  const selected = useMemo(
    () => (selectedId ? hypotheses.find((h) => h.opportunityId === selectedId) ?? null : null),
    [hypotheses, selectedId],
  );

  useEffect(() => {
    if (!selectedId) {
      setTimeline([]);
      return;
    }
    let alive = true;
    void fetchFrameworkOpportunityHistory(selectedId)
      .then((r) => alive && setTimeline(r.transitions ?? []))
      .catch(() => alive && setTimeline([]));
    return () => {
      alive = false;
    };
  }, [selectedId, selected?.revision, selected?.lifecycle]);

  useEffect(() => {
    if (tab !== 'HISTORY') return;
    let alive = true;
    void fetchFrameworkHistory(120)
      .then((r) => alive && setHistoryRows(r.transitions ?? []))
      .catch(() => alive && setHistoryRows([]));
    return () => {
      alive = false;
    };
  }, [tab, fw?.generatedAt]);

  const resetFilters = () => {
    setQ('');
    setFamily('ALL');
    setOpType('ALL');
    setDirection('ALL');
    setLifecycle('ALL');
    setMode('ALL');
    setStage('ALL');
    setTf('ALL');
  };

  const openRisk = useCallback(() => {
    window.location.hash = '#/opportunities-and-risk';
  }, []);

  const focusKpi = useCallback((key: KpiKey | null) => {
    setKpiFocus(key);
    if (!key) return;
    const meta = KPI_DETAIL[key];
    setTab(meta.tab);
    if (meta.mode) setMode(meta.mode);
    else if (key !== 'total') setMode('ALL');
  }, []);

  const openOpportunity = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const kpiCards = useMemo(
    () => [
      { key: 'total' as const, label: 'Total active', value: kpi.totalActive, sub: 'Click for list' },
      { key: 'approaching' as const, label: 'Approaching', value: kpi.approaching },
      { key: 'confirming' as const, label: 'Confirming', value: kpi.confirming },
      { key: 'ready' as const, label: 'Ready for risk', value: kpi.ready },
      { key: 'authorized' as const, label: 'Authorized', value: kpi.authorized },
      {
        key: 'production' as const,
        label: 'Production',
        value: kpi.production,
        sub: `Shadow ${kpi.shadow} · Observe ${kpi.observe} — expand Production card; use filters for Shadow/Observe`,
      },
    ],
    [kpi],
  );

  const connectionLive = Boolean(autonomy?.ok && autonomy.orchestrator?.connected !== false);

  return (
    <div className="to-page">
      <PageHeader
        title="Trading Opportunities"
        subtitle="Live autonomous opportunity discovery, confirmation and trade-readiness across the Cacsms Trader market universe."
      />

      <div className="to-meta">
        <Badge tone={stale ? 'amber' : connectionLive ? 'green' : 'gray'}>{stale ? 'STALE' : connectionLive ? 'LIVE' : 'OFFLINE'}</Badge>
        <span>
          {scanned}/{universe} scanned
        </span>
        <span>Framework {generatedAt ? fmtAge(age) : '—'}</span>
        {fw?.frameworkVersion && <span className="muted">{fw.frameworkVersion}</span>}
      </div>

      {error && !fw && (
        <Card className="to-alert">
          <strong>Opportunity Framework unavailable</strong>
          <p>{error}</p>
          <p className="muted">Last successful update: {snap.lastFetchAt ? new Date(snap.lastFetchAt).toLocaleString() : 'never'}</p>
        </Card>
      )}

      {loading && <div className="to-skeleton" aria-busy="true" />}

      {!loading && fw && (
        <>
          <KpiCards
            hypotheses={hypotheses}
            cards={kpiCards}
            focus={kpiFocus}
            onFocus={focusKpi}
            onOpen={openOpportunity}
          />
          {kpiFocus === 'production' && (
            <div className="to-mode-chips">
              <button type="button" className={mode === 'SHADOW' ? 'on' : ''} onClick={() => focusKpi('shadow')}>
                Shadow ({kpi.shadow})
              </button>
              <button type="button" className={mode === 'OBSERVE' ? 'on' : ''} onClick={() => focusKpi('observe')}>
                Observe ({kpi.observe})
              </button>
              <button type="button" className={mode === 'PRODUCTION' ? 'on' : ''} onClick={() => focusKpi('production')}>
                Production ({kpi.production})
              </button>
            </div>
          )}

          <Card className="to-xau">
            <div className="to-xau-head">
              <span className="eyebrow">XAUUSD PRIORITY</span>
              {!xau && <span className="muted">Scanning — no active opportunity.</span>}
            </div>
            {xau && (
              <button type="button" className="to-xau-body" onClick={() => setSelectedId(xau.opportunityId)}>
                <div>
                  <b>{xau.opportunityType}</b> {xau.opportunityName}
                </div>
                <div className={`to-side ${xau.side === 'BUY' ? 'buy' : 'sell'}`}>{xau.side}</div>
                <div>{structureLabel(xau)}</div>
                <div className={`to-life t-${lifecycleTone(xau.lifecycle)}`}>{lifecycleDisplay(xau.lifecycle)}</div>
                <p className="muted">{xau.whyNotReady[0] ?? xau.nextStep}</p>
              </button>
            )}
          </Card>

          <Tabs items={TABS} active={tab} onChange={(x) => setTab(x as TabKey)} idPrefix="to-tabs" label="Opportunity lifecycle" />

          <div className="to-filters">
            <input type="search" placeholder="Search symbol, OP code, name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Family">
              <option value="ALL">All families</option>
              {Object.keys(OP_FAMILY).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select value={opType} onChange={(e) => setOpType(e.target.value)} aria-label="Opportunity type">
              <option value="ALL">All types</option>
              {ALL_OP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
              <option value="ALL">All directions</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode">
              <option value="ALL">All modes</option>
              <option value="PRODUCTION">PRODUCTION</option>
              <option value="SHADOW">SHADOW</option>
              <option value="OBSERVE">OBSERVE</option>
            </select>
            <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} aria-label="Lifecycle">
              <option value="ALL">All lifecycles</option>
              {[...new Set(hypotheses.map((h) => h.lifecycle))].sort().map((lc) => (
                <option key={lc} value={lc}>
                  {lc}
                </option>
              ))}
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
              <option value="ALL">All stages</option>
              {[4, 5, 6, 7, 8, 9].map((s) => (
                <option key={s} value={String(s)}>
                  S{s}
                </option>
              ))}
            </select>
            <select value={tf} onChange={(e) => setTf(e.target.value)} aria-label="Timeframe">
              <option value="ALL">All TFs</option>
              {['MN', 'W', 'D1', 'H8', 'H1', 'M15', 'M5'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" onClick={resetFilters}>
              Reset filters
            </button>
          </div>

          {tab === 'HISTORY' ? (
            <div className="to-table-wrap">
              <table className="to-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Opportunity</th>
                    <th>Transition</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        No persisted transitions in this window.
                      </td>
                    </tr>
                  ) : (
                    historyRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.symbol ?? '—'}</td>
                        <td className="mono">{r.opportunityId ?? '—'}</td>
                        <td>
                          {r.fromLifecycle} → {r.toLifecycle}
                        </td>
                        <td>{r.at ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : filtered.length === 0 ? (
            <Card className="to-empty">
              <h3>No active trading opportunities</h3>
              <p>
                {scanned}/{universe} instruments scanned — no current setup matches these filters.
              </p>
              <p className="muted">Cacsms Trader continues scanning automatically.</p>
            </Card>
          ) : (
            <div className="to-table-wrap">
              <table className="to-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sort" onClick={() => setSort('symbol')}>
                        Symbol
                      </button>
                    </th>
                    <th>Opportunity</th>
                    <th>Direction</th>
                    <th>Structure</th>
                    <th>Trigger</th>
                    <th>State</th>
                    <th>Confidence</th>
                    <th>R:R</th>
                    <th>Mode</th>
                    <th>Stage</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((h) => (
                    <tr
                      key={h.opportunityId}
                      className={selectedId === h.opportunityId ? 'selected' : ''}
                      tabIndex={0}
                      onClick={() => setSelectedId(h.opportunityId)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedId(h.opportunityId)}
                    >
                      <td>
                        <b>{h.symbol}</b>
                        {h.TiTLevel && <small> {h.TiTLevel}</small>}
                      </td>
                      <td>
                        <div className="to-op-col">
                          <span className="mono">{h.opportunityType}</span>
                          <span>{h.opportunityName}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`to-side ${h.side === 'BUY' ? 'buy' : 'sell'}`}>{h.side}</span>
                      </td>
                      <td>{structureLabel(h)}</td>
                      <td>{triggerLabel(h.triggerType)}</td>
                      <td>
                        <span className={`to-life t-${lifecycleTone(h.lifecycle)}`}>{lifecycleDisplay(h.lifecycle)}</span>
                      </td>
                      <td>{Number.isFinite(h.confidence) ? `${Math.round(h.confidence)}%` : '—'}</td>
                      <td>{h.room?.rewardRisk != null ? h.room.rewardRisk.toFixed(2) : '—'}</td>
                      <td>
                        <span className={`to-mode m-${h.mode.toLowerCase()}`}>{h.mode}</span>
                      </td>
                      <td>S{h.stage}</td>
                      <td className="muted mono">{h.revision?.slice(0, 8) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selected && (
        <OpportunityDrawer
          h={selected}
          shadow8={snap.data?.shadowStage8[selected.opportunityId]}
          timeline={timeline}
          onClose={() => setSelectedId(null)}
          onOpenRisk={openRisk}
        />
      )}

      <footer className="to-foot muted">
        <RefreshCw size={14} /> Observability only — no execution controls. Shadow and Observe routes never authorize capital.
      </footer>
    </div>
  );
}
