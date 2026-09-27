import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge, Card, Metric, PageHeader, Tabs, tabIds } from '../../components/UI';
import { ageText } from '../htf-vision';
import { ExecutionControls } from './components/ExecutionControls';
import { DealsTable, OpenPositionsTable, OrdersTable, QueueTable, ReconciliationView, TradeHistory } from './components/ExecutionTables';
import { LifecycleDrawer } from './components/LifecycleDrawer';
import { human, money, pct, signed } from './components/format';
import { controlTone, IN_FLIGHT_STATES, OPEN_POSITION_STATES, PRE_SUBMIT_STATES } from './services/executionStage';
import { executionRunAgeMs, executionStageStatus, loadExecution, startExecutionStore, useExecutionStore } from './services/executionStore';
import type { Execution } from './types';
import '../historical-regime/historical-regime.css';
import '../market-data/market-data.css';
import '../market-scanner/market-scanner.css';
import '../h1-confirmation/h1-confirmation.css';
import '../opportunity-risk/opportunity-risk.css';
import './execution.css';

const TABS = ['Open Positions', 'Execution Queue', 'Orders & Deals', 'Trade History', 'Reconciliation'] as const;
type Tab = (typeof TABS)[number];

const ORDER_RANK = [...IN_FLIGHT_STATES, ...PRE_SUBMIT_STATES];

export function ExecutionPositionsPage() {
  const store = useExecutionStore();
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>('Open Positions');
  const [drawer, setDrawer] = useState<string | null>(null);

  useEffect(() => startExecutionStore(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const s = store.state;
  const run = s?.run ?? null;
  const control = run?.control;
  const summary = run?.summary;
  const status = executionStageStatus(store, now);
  const age = executionRunAgeMs(store, now);
  const disconnected = status === 'DISCONNECTED' || run?.connected === false;
  const stale = status === 'STALE' || disconnected;
  const staleLabel = disconnected ? 'CONNECTION_LOST' : 'STALE';

  const ledger = useMemo(() => s?.ledger ?? [], [s]);
  const open = useMemo(() => ledger.filter((x) => x.positionState && OPEN_POSITION_STATES.includes(x.positionState)), [ledger]);
  const queue = useMemo(() => {
    const active = ledger.filter((x) => !x.positionState);
    const rank = (x: Execution) => {
      const i = ORDER_RANK.indexOf(x.orderState);
      return i < 0 ? ORDER_RANK.length + 1 : i;
    };
    return [...active, ...(s?.pendingAuthorizations ?? [])].sort((a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt ?? b.authExpiresAt ?? '') - Date.parse(a.updatedAt ?? a.authExpiresAt ?? ''));
  }, [ledger, s]);
  const liveQueue = queue.filter((x) => x.virtual || ORDER_RANK.includes(x.orderState)).length;
  const external = run?.external ?? [];
  const stored = status === 'STALE' && !external.length && !open.length ? (s?.storedPositions ?? []) : [];
  const findings = s?.reconciliation.open ?? [];
  const blocking = findings.filter((f) => f.severity === 'BLOCKING').length;

  const drawerX = ledger.find((x) => x.executionId === drawer);
  const version = `${drawerX?.updatedAt ?? ''}|${run?.runAt ?? ''}`;
  const ccy = summary?.currency ?? run?.terminal?.currency ?? undefined;
  const counts: Record<Tab, number> = {
    'Open Positions': open.length + external.length + stored.length,
    'Execution Queue': liveQueue,
    'Orders & Deals': s?.orders.length ?? 0,
    'Trade History': s?.trades.length ?? 0,
    Reconciliation: findings.length,
  };

  return (
    <div className="or-page ex-page">
      <PageHeader title="Execution & Positions" subtitle="Broker execution, live position management and trade lifecycle control — Stage 8 AUTHORIZED → Stage 9 → Stage 10" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'WAITING' ? 'gray' : 'red'}>STAGE 9 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 9 state…' : 'The Stage 9 engine has not published its state yet')}</span>
        {age != null && (
          <span className="muted">
            Engine cycle {ageText(run?.runAt, now)} · node {run?.node ?? '—'} · {run?.runs ?? 0} cycles
            {run?.terminal ? ` · MT5 ${run.terminal.login}@${run.terminal.server} ${run.terminal.pingMs} ms` : ''}
          </span>
        )}
        <button type="button" className="hr-run" disabled={store.busy} onClick={() => void loadExecution()}>
          <RefreshCw size={14} className={store.busy ? 'hr-spin' : undefined} />
          Refresh
        </button>
      </div>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — this page cannot reach the bridge. The central engine keeps executing and managing positions independently of this page.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 9 engine output is stale ({ageText(run?.runAt, now)}): positions below are the last confirmed state and no new execution is started until it runs and reconciles.</span>
        </div>
      )}
      {disconnected && !store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>MT5 disconnected — positions are shown from the last confirmed broker state (CONNECTION_LOST). On reconnection the engine reconciles the whole account before any new execution.</span>
        </div>
      )}
      {blocking > 0 && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>
            {blocking} blocking reconciliation finding{blocking === 1 ? '' : 's'} — new executions on the affected account wait for resolution.{' '}
            <button type="button" className="cs-link" onClick={() => setTab('Reconciliation')}>
              Review
            </button>
          </span>
        </div>
      )}

      <div className="metrics">
        <Metric
          label="Engine State"
          value={control ? human(control.state) : '—'}
          sub={control ? (control.newEntries ? 'New entries allowed · management active' : `New entries blocked · management ${control.management ? 'active' : 'waiting for MT5'}`) : 'Awaiting Stage 9 engine'}
        />
        <Metric
          label="Open P&L"
          value={summary ? `${signed(summary.openPnl)}${ccy ? ` ${ccy}` : ''}` : '—'}
          sub={summary ? `${summary.positions} position${summary.positions === 1 ? '' : 's'}${stale ? ` · ${staleLabel}` : ' · live from MT5'}` : 'No engine state'}
        />
        <Metric
          label="Open Risk"
          value={summary ? (summary.openRiskPct != null ? pct(summary.openRiskPct) : money(summary.openRiskMoney, ccy)) : '—'}
          sub={summary ? `${money(summary.openRiskMoney, ccy)} at stop${summary.unknownRisk ? ` · ${summary.unknownRisk} unknown (no SL)` : ''}` : 'No engine state'}
        />
        <Metric
          label="Positions"
          value={summary ? summary.positions : '—'}
          sub={summary ? `${summary.stage9Positions} Stage 9 · ${summary.externalPositions} external · ${summary.queue} in queue` : 'No engine state'}
        />
      </div>

      <div className="funnel ms-funnel h1-flow ex-flow">
        {[
          [s?.pendingAuthorizations.length ?? 0, 'Stage 8 AUTHORIZED', 'immutable hand-off'],
          [ledger.filter((x) => PRE_SUBMIT_STATES.includes(x.orderState) && !x.positionState).length, 'Revalidate', 'preflight · routing'],
          [ledger.filter((x) => IN_FLIGHT_STATES.includes(x.orderState) && !x.positionState).length, 'MT5 submit / confirm', 'ledger · broker ack'],
          [open.length, 'Manage', 'SL/TP · BE · trail · partial'],
          [(s?.trades ?? []).filter((t) => Date.now() - Date.parse(t.closedAt ?? '') < 86_400_000).length, 'Exit · reconcile (24h)', 'broker deals'],
          [(s?.trades ?? []).filter((t) => t.stage10Status === 'PUBLISHED').length, 'Stage 10', 'performance & learning'],
        ].map(([v, label, owner], i) => (
          <Fragment key={label as string}>
            {i > 0 && <i>→</i>}
            <div>
              <b>{v}</b>
              <span>{label}</span>
              <small className="ms-owner">{owner}</small>
            </div>
          </Fragment>
        ))}
      </div>

      <ExecutionControls />

      <Card>
        <div className="card-head">
          <div>
            <h3>Execution &amp; Positions</h3>
            <p>Persisted Stage 9 ledger, broker orders/deals and reconciliation · click any order or position for its full lifecycle</p>
          </div>
          <Badge tone={controlTone(control?.state)}>{control ? human(control.state) : 'NO STATE'}</Badge>
        </div>
        <Tabs items={TABS.map((t) => t)} active={tab} onChange={(t) => setTab(t as Tab)} idPrefix="ex" label="Execution sections" />
        <div className="ex-tab-counts">
          {TABS.map((t) => (
            <small key={t} className={t === tab ? 'on' : undefined}>
              {t}: {counts[t]}
            </small>
          ))}
        </div>
        <div role="tabpanel" id={tabIds('ex', tab).panel} aria-labelledby={tabIds('ex', tab).tab}>
          {tab === 'Open Positions' && (
            <OpenPositionsTable rows={open} external={external} stored={stored} stale={stale} staleLabel={staleLabel} now={now} onOpen={setDrawer} />
          )}
          {tab === 'Execution Queue' && <QueueTable rows={queue} node={run?.node ?? null} now={now} onOpen={setDrawer} />}
          {tab === 'Orders & Deals' && (
            <>
              <h4 className="hr-sub">Broker requests (order_send)</h4>
              <OrdersTable rows={s?.orders ?? []} onOpen={setDrawer} />
              <h4 className="hr-sub">Deals</h4>
              <DealsTable rows={s?.deals ?? []} onOpen={setDrawer} />
            </>
          )}
          {tab === 'Trade History' && <TradeHistory initial={s?.trades ?? []} onOpen={setDrawer} />}
          {tab === 'Reconciliation' && <ReconciliationView open={findings} recent={s?.reconciliation.recent ?? []} onOpen={setDrawer} />}
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Engine Audit Trail</h3>
            <p>Latest Stage 9 events · persisted in dbo.app_exec_event</p>
          </div>
          <Badge tone="blue">{s?.events.length ?? 0} events</Badge>
        </div>
        {!s?.events.length ? (
          <p className="hr-reason">No Stage 9 event recorded yet.</p>
        ) : (
          <ul className="or-fails ex-events">
            {s.events.slice(0, 25).map((e) => (
              <li key={e.id}>
                <small className="muted">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</small> <Badge tone="blue">{e.kind}</Badge>{' '}
                {e.state && <b>{human(e.state)} </b>}
                {e.executionId ? (
                  <button type="button" className="cs-link" onClick={() => setDrawer(e.executionId)}>
                    {e.executionId}
                  </button>
                ) : null}{' '}
                {e.detail}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {drawer && <LifecycleDrawer executionId={drawer} version={version} now={now} onClose={() => setDrawer(null)} />}
    </div>
  );
}
