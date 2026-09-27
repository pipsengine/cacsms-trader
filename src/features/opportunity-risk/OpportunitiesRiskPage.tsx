import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge, Card, Metric, PageHeader } from '../../components/UI';
import { useTrading } from '../../context/TradingContext';
import { ageText } from '../htf-vision';
import { h1StageStatus, useH1Store } from '../h1-confirmation';
import { AuthorizationTable, HistoryTable, SetupDrawer } from './components/SetupDrawer';
import { RiskControls } from './components/RiskControls';
import { classTone, dirTone, human, lots, money, num, pct, px, until } from './components/format';
import { riskTone } from './services/riskStage';
import { riskRunAgeMs, riskStageStatus, runRiskNow, startRiskStore, useRiskStore } from './services/riskStore';
import type { AccountSummary, Opportunity, RiskState } from './types';
import '../historical-regime/historical-regime.css';
import '../market-data/market-data.css';
import '../market-scanner/market-scanner.css';
import '../structural-direction/structural-direction.css';
import '../h1-confirmation/h1-confirmation.css';
import './opportunity-risk.css';

const STATE_ORDER: RiskState[] = [
  'AUTHORIZED',
  'QUALIFIED',
  'EVALUATING',
  'WAITING',
  'MARGIN_BLOCKED',
  'EXPOSURE_BLOCKED',
  'CORRELATION_BLOCKED',
  'RISK_BLOCKED',
  'PROP_RULE_BLOCKED',
  'ACCOUNT_BLOCKED',
  'STALE',
  'EXPIRED',
];

/* ------------------------------------------------------------------ Stage 7 hand-off */

function Stage7Handoff({ onOpen, opps }: { onOpen: (symbol: string) => void; opps: Opportunity[] }) {
  const h1store = useH1Store();
  const h1Status = h1StageStatus(h1store);
  const usable = h1Status === 'HEALTHY' || h1Status === 'DEGRADED';
  const confirmed = (h1store.state?.instruments ?? []).filter((d) => d.state === 'CONFIRMED' && d.confirmed && d.handoff);
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Stage 7 Hand-off</h3>
          <p>H1-confirmed candidates published by H1 Confirmation — the only input Stage 8 accepts. Scanner scores never create an opportunity.</p>
        </div>
        <Badge tone={!usable ? 'amber' : confirmed.length ? 'green' : 'gray'}>{usable ? `${confirmed.length} confirmed` : `STAGE 7 ${h1Status}`}</Badge>
      </div>
      {!confirmed.length || !usable ? (
        <div className="empty-block">
          <b>{h1store.loading ? 'Loading Stage 7 decisions…' : h1Status === 'STALE' ? 'Stage 7 output is stale' : 'No H1-confirmed candidate'}</b>
          <span>{h1store.error || 'Stage 7 publishes only candidates whose Stage 6 direction passed every mandatory H1 confirmation gate.'}</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Direction</th>
                <th>Entry context</th>
                <th>H1 structure</th>
                <th>Location</th>
                <th>Confidence</th>
                <th>Invalidation</th>
                <th>Confirmed</th>
                <th>Stage 8</th>
              </tr>
            </thead>
            <tbody>
              {confirmed.map((d) => {
                const h = d.handoff!;
                const o = opps.find((x) => x.symbol === d.symbol && x.active);
                return (
                  <tr key={d.symbol} className="hr-click" onClick={() => onOpen(d.symbol)}>
                    <td>
                      <b className={d.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{d.symbol}</b>
                    </td>
                    <td>
                      <Badge tone={dirTone(h.direction)}>{h.direction}</Badge>
                    </td>
                    <td>
                      <small>
                        {h.entryContext.model.replace(/_/g, ' ')} · {h.entryContext.trigger === 'CHOCH' ? 'CHoCH' : 'BOS'} through {h.entryContext.triggerLevel}
                      </small>
                    </td>
                    <td>
                      <small>
                        {h.h1Structure.phase.replace(/_/g, ' ')} · {h.h1Structure.trend} · mom {h.h1Structure.momentum.toFixed(2)} ATR
                      </small>
                    </td>
                    <td>
                      <small>
                        {h.channelLocation.zone?.replace(/_/g, ' ') ?? '—'} · D1 {h.channelLocation.d1 != null ? `${h.channelLocation.d1.toFixed(0)}%` : '—'}
                      </small>
                    </td>
                    <td>{h.confidence.toFixed(0)}</td>
                    <td>
                      {h.invalidationLevel ?? '—'} {h.riskAtr != null ? <small className="muted">· {h.riskAtr.toFixed(1)} ATR</small> : null}
                    </td>
                    <td>{d.confirmedSince ? ageText(d.confirmedSince) : '—'}</td>
                    <td>{o ? <Badge tone={riskTone(o.state)}>{human(o.state)}</Badge> : <small className="muted">awaiting evaluation</small>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ flow */

function Flow({ opps, pending }: { opps: Opportunity[]; pending: number }) {
  const active = opps.filter((o) => o.active);
  const box = (value: number, label: string, owner: string, title: string) => (
    <div title={title}>
      <b>{value}</b>
      <span>{label}</span>
      <small className="ms-owner">{owner}</small>
    </div>
  );
  return (
    <div className="funnel ms-funnel h1-flow">
      {box(active.length, 'Stage 7 CONFIRMED', 'hand-off', 'Confirmed setups received from H1 Confirmation')}
      <i>→</i>
      {box(active.filter((o) => o.setupState === 'QUALIFIED').length, 'Setup qualified', 'quality · geometry · freshness', 'Technically good: price, SL/TP, R:R, spread, drift and score all pass')}
      <i>→</i>
      {box(active.filter((o) => o.eligibleAccounts > 0).length, 'Portfolio / account PASS', 'exposure · correlation · margin · prop', 'At least one account passes every portfolio and account-specific risk gate')}
      <i>→</i>
      {box(active.filter((o) => o.authorizedAccounts > 0).length, 'AUTHORIZED', 'permission · global switch', 'Immutable execution authorization issued for at least one account')}
      <i>→</i>
      {box(pending, 'Stage 9 queue', 'Execution & Positions', 'Pending authorizations awaiting Stage 9 — Stage 8 never submits the order')}
    </div>
  );
}

/* ------------------------------------------------------------------ setup table */

function SetupTable({ rows, now, onOpen }: { rows: Opportunity[]; now: number; onOpen: (key: string) => void }) {
  return (
    <div className="table-wrap">
      <table className="cs-table or-setups">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Direction</th>
            <th>S7 conf.</th>
            <th>Entry</th>
            <th>SL</th>
            <th>TP</th>
            <th>R:R</th>
            <th>Score</th>
            <th>Freshness</th>
            <th>Setup</th>
            <th>Correlation / exposure</th>
            <th>Eligible accounts</th>
            <th>Proposed risk</th>
            <th>Final state</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const g = o.geometry;
            const ref = g.entry ?? g.mid;
            return (
              <tr key={o.setupKey} className={`hr-click${o.active ? '' : ' or-closed'}`} onClick={() => onOpen(o.setupKey)} title={o.reason}>
                <td>
                  <b className={o.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{o.symbol}</b>
                </td>
                <td>
                  <Badge tone={dirTone(o.side)}>{o.side}</Badge>
                </td>
                <td>{num(o.confidence, 0)}</td>
                <td>{px(g.entry, ref)}</td>
                <td>{px(g.stopLoss, ref)}</td>
                <td>{px(g.takeProfit, ref)}</td>
                <td>{g.rewardRisk != null ? num(g.rewardRisk) : '—'}</td>
                <td>{o.components.length ? num(o.score, 1) : '—'}</td>
                <td>
                  <small>{o.active ? until(o.expiresAt, now) : `closed ${ageText(o.changedAt, now)}`}</small>
                </td>
                <td>
                  <Badge tone={riskTone(o.setupState)}>{human(o.setupState)}</Badge>
                </td>
                <td>
                  <Badge tone={o.exposureStatus === 'CLEAR' ? 'green' : o.exposureStatus === 'N/A' ? 'gray' : 'red'}>{human(o.exposureStatus)}</Badge>
                </td>
                <td>
                  {o.eligibleAccounts}/{o.accounts?.length ?? 0}
                  {o.authorizedAccounts ? <small className="muted"> · {o.authorizedAccounts} auth</small> : null}
                </td>
                <td>{pct(o.proposedRiskPct)}</td>
                <td className="hv-wrap">
                  <Badge tone={riskTone(o.state)}>{human(o.state)}</Badge>
                  {o.reasonCode !== o.state ? <small className="muted"> {o.reasonCode}</small> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ accounts */

function Bar({ used, limit, inverse }: { used: number | null; limit: number; inverse?: boolean }) {
  const frac = used == null || !limit ? 0 : inverse ? Math.min(1, limit / Math.max(used, 1e-9)) : Math.min(1, used / limit);
  return (
    <span className="or-util compact">
      <i className={frac >= 1 ? 'red' : frac >= 0.75 ? 'amber' : 'green'} style={{ width: `${Math.max(2, frac * 100)}%` }} />
    </span>
  );
}

function AccountsCard({ accounts, opps, onOpen }: { accounts: AccountSummary[]; opps: Opportunity[]; onOpen: (key: string) => void }) {
  const active = opps.filter((o) => o.active);
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Account Qualification</h3>
          <p>Every Demo / Live / Prop account is evaluated independently — a technically good setup is authorized only for accounts whose own balance, currency, margin, exposure and prop rules allow it</p>
        </div>
        <Badge tone="blue">{accounts.length} accounts</Badge>
      </div>
      {!accounts.length ? (
        <div className="empty-block">
          <b>No account registered</b>
          <span>Connect an MT5 account in Settings → MT5 Connection; Stage 8 fails closed without account information.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Class</th>
                <th>Balance / equity</th>
                <th>Leverage</th>
                <th>Status</th>
                <th>Open + pending</th>
                <th>Available</th>
                <th>Daily loss</th>
                <th>Drawdown</th>
                <th>Positions</th>
                <th>Margin level</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const u = a.utilization;
                return (
                  <tr key={a.accountId}>
                    <td>
                      <b>{a.name}</b>
                      <small className="muted">
                        {' '}
                        {a.login} · {a.server} {a.live ? '· attached' : `· snapshot ${a.snapshotAgeSec != null ? `${Math.round(a.snapshotAgeSec / 60)}m` : '—'} old`}
                      </small>
                    </td>
                    <td>
                      <Badge tone={classTone(a.accountClass)}>{a.accountClass}</Badge>
                    </td>
                    <td>
                      {money(a.balance, a.currency)} <small className="muted">/ {money(a.equity)}</small>
                    </td>
                    <td>1:{a.leverage}</td>
                    <td>
                      <Badge tone={a.status === 'ELIGIBLE' ? 'green' : a.status === 'ACCOUNT_BLOCKED' ? 'red' : 'amber'}>{human(a.status)}</Badge>
                      {a.tradingMode && a.tradingMode !== a.status ? <small className="muted"> {human(a.tradingMode)}</small> : null}
                    </td>
                    <td>
                      {pct(a.openRiskPct + a.pendingRiskPct)} <Bar used={u.portfolio.used} limit={u.portfolio.limit} />
                    </td>
                    <td>{pct(a.availableRiskPct)}</td>
                    <td>
                      {pct(a.dailyLossPct)} <small className="muted">/ {pct(u.dailyLoss.limit, 1)}</small>
                    </td>
                    <td>
                      {pct(a.drawdownPct)} <small className="muted">/ {pct(u.drawdown.limit, 1)}</small>
                    </td>
                    <td>
                      {u.positions.used ?? 0}/{u.positions.limit}
                    </td>
                    <td>{a.marginLevel != null ? `${a.marginLevel.toFixed(0)}%` : '—'}</td>
                    <td className="hv-wrap">
                      <small>{a.issues.length ? a.issues.map((i) => i.reason).join('; ') : a.unknownRisk.length ? a.unknownRisk.join('; ') : '—'}</small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {active.length > 0 && accounts.length > 0 && (
        <>
          <h4 className="hr-sub">Setup × account</h4>
          <div className="table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>Setup</th>
                  <th>Technical</th>
                  {accounts.map((a) => (
                    <th key={a.accountId}>
                      {a.name} <small className="muted">{a.accountClass}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((o) => (
                  <tr key={o.setupKey} className="hr-click" onClick={() => onOpen(o.setupKey)}>
                    <td>
                      <b>{o.symbol}</b> <Badge tone={dirTone(o.side)}>{o.side}</Badge>
                    </td>
                    <td>
                      <Badge tone={riskTone(o.setupState)}>{human(o.setupState)}</Badge>
                    </td>
                    {accounts.map((a) => {
                      const e = o.accounts?.find((x) => x.accountId === a.accountId);
                      return (
                        <td key={a.accountId} className="hv-wrap" title={e?.reason}>
                          {e ? (
                            <>
                              <Badge tone={riskTone(e.state)}>{human(e.state)}</Badge>
                              <small className="muted">
                                {' '}
                                {e.reasonCode}
                                {e.sizing.volume ? ` · ${lots(e.sizing.volume)} · ${money(e.sizing.riskMoney, e.currency)}` : ''}
                              </small>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function ExposureCard({ account }: { account?: AccountSummary }) {
  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Portfolio Exposure</h3>
          <p>Net signed risk by currency and XAU across open positions and pending authorizations — the same USD-short risk counts once, however many pairs carry it</p>
        </div>
        {account && <Badge tone={classTone(account.accountClass)}>{account.name}</Badge>}
      </div>
      {!account ? (
        <div className="empty-block">
          <b>No account state</b>
          <span>Exposure is computed from MT5 positions once an account is attached.</span>
        </div>
      ) : (
        <>
          {account.currencies.length ? (
            account.currencies.map((c) => (
              <div className="progress-row" key={c.currency}>
                <span>{c.currency}</span>
                <div>
                  <i style={{ width: `${Math.min(100, (Math.abs(c.netPct) / Math.max(c.limit, 1e-9)) * 100)}%` }} className={c.netPct < 0 ? 'or-neg' : undefined} />
                </div>
                <b>
                  {c.netPct > 0 ? '+' : ''}
                  {pct(c.netPct)} <small className="muted">/ ±{pct(c.limit, 1)}</small>
                </b>
              </div>
            ))
          ) : (
            <p className="hr-reason">No open exposure — every currency has its full {'±'}limit available.</p>
          )}
          <h4 className="hr-sub">Open positions</h4>
          {account.positions.length ? (
            <div className="table-wrap">
              <table className="cs-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Volume</th>
                    <th>Entry</th>
                    <th>SL</th>
                    <th>Risk</th>
                    <th>P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {account.positions.map((p, i) => (
                    <tr key={`${p.symbol}-${i}`}>
                      <td>
                        <b>{p.symbol}</b>
                      </td>
                      <td>
                        <Badge tone={dirTone(p.side)}>{p.side}</Badge>
                      </td>
                      <td>{lots(p.volume)}</td>
                      <td>{px(p.entry)}</td>
                      <td>{p.sl ? px(p.sl, p.entry) : <Badge tone="red">NO SL</Badge>}</td>
                      <td>{p.known ? pct(p.riskPct) : <small className="negative">{p.reason ?? 'unknown'}</small>}</td>
                      <td className={p.pnl >= 0 ? 'positive' : 'negative'}>{money(p.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hr-reason">No open positions on this account.</p>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export function OpportunitiesRiskPage() {
  const { auto } = useTrading();
  const store = useRiskStore();
  const [now, setNow] = useState(Date.now());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => startRiskStore(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const s = store.state;
  const run = s?.run ?? null;
  const c = run?.counters;
  const cfg = s?.config ?? {};
  const status = riskStageStatus(store, now);
  const age = riskRunAgeMs(store, now);
  const opps = useMemo(() => s?.opportunities ?? [], [s]);
  const accounts = run?.accounts ?? [];
  const primary = accounts.find((a) => a.accountId === run?.terminal?.accountId) ?? accounts.find((a) => a.tradingEnabled) ?? accounts[0];
  const pending = (s?.authorizations ?? []).filter((a) => a.status === 'PENDING' && Date.parse(a.expiresAt) > now);
  const paused = run ? !run.auto : !auto;

  const rows = useMemo(
    () =>
      [...opps]
        .filter((o) => showClosed || o.active)
        .sort((a, b) => Number(b.active) - Number(a.active) || STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.score - a.score),
    [opps, showClosed],
  );
  const closedCount = opps.filter((o) => !o.active).length;
  const drawerOpp = opps.find((o) => o.setupKey === drawer);
  const version = `${drawerOpp?.changedAt ?? ''}|${drawerOpp?.evaluatedAt ?? ''}|${run?.runAt ?? ''}`;
  const openBySymbol = (symbol: string) => {
    const o = opps.find((x) => x.symbol === symbol && x.active);
    if (o) setDrawer(o.setupKey);
  };

  return (
    <div className="or-page">
      <PageHeader title="Opportunities & Risk" subtitle="Final qualification gate: setup quality, correlation, exposure and account risk — Stage 7 CONFIRMED → Stage 8 → Stage 9" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'ERROR' ? 'red' : 'gray'}>STAGE 8 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 8 state…' : 'No Stage 8 evaluation recorded yet')}</span>
        {age != null && (
          <span className="muted">
            Last evaluation {ageText(run?.runAt, now)}
            {run?.triggers?.length ? ` · ${run.triggers.slice(0, 4).join(', ')}` : ''}
            {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          </span>
        )}
        {run?.service && (
          <span className="muted">
            Event-driven loop {run.service.loopSec}s · full re-evaluation {run.service.fullEverySec}s · Stage 7 {run.upstream?.h1Status ?? '—'}
          </span>
        )}
        <button type="button" className="hr-run" disabled={store.running} onClick={() => void runRiskNow()}>
          <RefreshCw size={14} className={store.running ? 'hr-spin' : undefined} />
          {store.running ? 'Evaluating…' : 'Re-evaluate now'}
        </button>
      </div>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — nothing is qualified or authorized while the bridge is unreachable.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 8 output is stale ({ageText(run?.runAt, now)}): authorizations below are not valid for Stage 9 until the engine runs again.</span>
        </div>
      )}
      {paused && run && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Global trading is PAUSED — analysis and hypothetical qualification continue, but no new execution authorization is issued and pending ones are revoked.</span>
        </div>
      )}

      <Stage7Handoff onOpen={openBySymbol} opps={opps} />

      <div className="metrics">
        <Metric
          label="Qualified Setups"
          value={c ? c.qualified : '—'}
          sub={c ? `${c.eligible} account-eligible · ${c.authorized} authorized` : 'Awaiting Stage 8'}
        />
        <Metric
          label="Risk Available"
          value={primary ? pct(primary.availableRiskPct) : '—'}
          sub={primary ? `of ${pct(Number(cfg.maxPortfolioRiskPct), 2)} portfolio limit · ${primary.name}` : 'No account state'}
        />
        <Metric
          label="Open Risk"
          value={primary ? pct(primary.openRiskPct + primary.pendingRiskPct) : '—'}
          sub={primary ? `${primary.positions.length} positions · pending ${pct(primary.pendingRiskPct)}` : 'Active positions'}
        />
        <Metric
          label="Risk / Trade"
          value={cfg.riskPerTradePct != null ? pct(Number(cfg.riskPerTradePct)) : '—'}
          sub={`Configurable · basis ${human(String(cfg.riskBasis ?? '—')).toLowerCase()}`}
        />
      </div>

      <Flow opps={opps} pending={pending.length} />

      <Card>
        <div className="card-head">
          <div>
            <h3>Setup Qualification</h3>
            <p>Live Stage 8 evaluation of every Stage 7 confirmed setup · click a row for every calculation and the exact pass / fail reason</p>
          </div>
          {closedCount > 0 && (
            <button type="button" className="hr-run" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Hide closed' : `Show closed (${closedCount})`}
            </button>
          )}
        </div>
        {!rows.length ? (
          <div className="empty-block">
            <b>{store.loading ? 'Loading…' : 'No qualified setups'}</b>
            <span>
              {store.error ||
                'Stage 8 evaluates only Stage 7 CONFIRMED candidates. None is confirmed right now, so nothing is qualified, sized or authorized — no setup is created from scanner scores.'}
            </span>
          </div>
        ) : (
          <SetupTable rows={rows} now={now} onOpen={setDrawer} />
        )}
      </Card>

      <AccountsCard accounts={accounts} opps={opps} onOpen={setDrawer} />

      <div className="or-layout">
        <RiskControls state={s} account={primary} />
        <ExposureCard account={primary} />
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>Execution Authorizations</h3>
            <p>Immutable, idempotent Stage 8 → Stage 9 hand-off · persisted in dbo.app_risk_authorization (terms protected by trigger)</p>
          </div>
          <Badge tone={pending.length ? 'green' : 'gray'}>{pending.length} pending</Badge>
        </div>
        <AuthorizationTable rows={s?.authorizations ?? []} now={now} />
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Decision History</h3>
            <p>Every setup and account state change with its trigger · persisted in dbo.app_risk_history</p>
          </div>
          <Badge tone="blue">{s?.history.length ?? 0} changes</Badge>
        </div>
        <HistoryTable rows={s?.history ?? []} onOpen={setDrawer} />
      </Card>

      {drawer && <SetupDrawer setupKey={drawer} version={version} now={now} onClose={() => setDrawer(null)} />}
    </div>
  );
}
