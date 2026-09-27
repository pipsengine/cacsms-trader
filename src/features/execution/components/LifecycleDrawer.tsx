import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Badge, Tabs } from '../../../components/UI';
import { riskGateTone } from '../../opportunity-risk/services/riskStage';
import { fetchExecutionDetail } from '../services/executionClient';
import { orderTone, positionTone, severityTone } from '../services/executionStage';
import type { ExecEvent, ExecutionDetail } from '../types';
import { classTone, dirTone, human, lots, money, num, pct, px, signed, stamp, until } from './format';
import { DealsTable, OrdersTable } from './ExecutionTables';

type PhaseStatus = 'DONE' | 'ACTIVE' | 'FAILED' | 'PENDING' | 'SKIPPED';
type Phase = { key: string; label: string; status: PhaseStatus; at: string | null; summary: string; events: ExecEvent[] };

const SLTP_CODES = new Set(['INITIAL_PROTECTION', 'RESTORE_PROTECTION', 'EXTERNAL_TIGHTEN']);
const FILL_STATES = new Set(['FILLED', 'PARTIALLY_FILLED']);
const phaseTone = (s: PhaseStatus) => (s === 'DONE' ? 'green' : s === 'ACTIVE' ? 'blue' : s === 'FAILED' ? 'red' : 'gray');

function buildPhases(d: ExecutionDetail): Phase[] {
  const x = d.execution;
  const a = d.authorization;
  const ev = [...d.events].sort((p, q) => p.id - q.id);
  const pick = (f: (e: ExecEvent) => boolean) => ev.filter(f);
  const first = (list: ExecEvent[]) => list[0]?.createdAt ?? null;
  const src = (a?.source ?? {}) as Record<string, unknown>;
  const isFill = (e: ExecEvent) => e.kind === 'RECONCILIATION' && FILL_STATES.has(e.state ?? '');

  const pre = pick((e) => e.kind === 'REVALIDATION' || e.kind === 'QUEUE' || (e.kind === 'AUTHORIZATION' && e.state !== 'AUTHORIZED'));
  const sub = pick((e) => e.kind === 'SUBMISSION');
  const broker = pick((e) => e.kind === 'BROKER');
  const fill = pick(isFill);
  const sltp = pick((e) => e.kind === 'MANAGEMENT' && SLTP_CODES.has(e.state ?? ''));
  const mgmt = pick((e) => (e.kind === 'MANAGEMENT' && !SLTP_CODES.has(e.state ?? '')) || (e.kind === 'OPERATOR' && e.state === 'EXIT_REQUESTED'));
  const exit = pick((e) => e.kind === 'EXIT');
  const recon = pick((e) => (e.kind === 'RECONCILIATION' && !isFill(e)) || e.kind === 'STAGE10' || (e.kind === 'OPERATOR' && e.state !== 'EXIT_REQUESTED'));

  const os = x?.orderState;
  const rejected = os === 'REJECTED' || os === 'CANCELLED' || os === 'EXPIRED';
  const submitted = Boolean(x?.submitAttemptedAt);
  const filled = Boolean(x?.filledAt);
  const closed = x?.positionState === 'CLOSED';

  return [
    {
      key: 's7',
      label: 'Stage 7 Confirmation',
      status: src.confirmedSince ? 'DONE' : 'PENDING',
      at: (src.confirmedSince as string) ?? null,
      summary: src.confirmedSince
        ? `CONFIRMED ${human(String(src.direction ?? ''))} · ${human(String(src.model ?? ''))} · ${src.trigger === 'CHOCH' ? 'CHoCH' : 'BOS'} through ${src.triggerLevel ?? '—'} · confidence ${num(Number(src.confidence), 1)}`
        : 'No Stage 7 evidence on the authorization',
      events: [],
    },
    {
      key: 's8',
      label: 'Stage 8 Authorization',
      status: a ? 'DONE' : 'PENDING',
      at: a?.authorizedAt ?? null,
      summary: a
        ? `${a.direction} ${lots(a.volume)} ${a.instrument} · SL ${px(a.stopLoss, a.entryPolicy.referencePrice)} · TP ${px(a.takeProfit, a.entryPolicy.referencePrice)} · risk ${money(a.riskAmount, a.riskCurrency)} (${pct(a.riskPct)}) · ${a.status}${a.statusReason ? ` — ${a.statusReason}` : ''}`
        : 'Authorization not found',
      events: pick((e) => e.kind === 'AUTHORIZATION' && e.state === 'AUTHORIZED'),
    },
    {
      key: 'pre',
      label: 'Preflight',
      status: x?.revalidation?.ok || submitted ? 'DONE' : x?.revalidation?.terminal ? 'FAILED' : pre.length || x?.revalidation ? 'ACTIVE' : 'PENDING',
      at: first(pre) ?? x?.revalidation?.at ?? null,
      summary: x?.revalidation ? `${x.revalidation.ok ? 'PASS' : x.revalidation.code} · ${x.revalidation.reason}` : 'Pre-execution revalidation not yet run',
      events: pre,
    },
    {
      key: 'sub',
      label: 'Submission',
      status: submitted ? 'DONE' : rejected && !submitted ? 'SKIPPED' : 'PENDING',
      at: x?.submitAttemptedAt ?? first(sub),
      summary: submitted ? `Sent ${x?.submittedAt ? stamp(x.submittedAt) : ''} · requested ${px(x?.requestedPrice)} · spread ${px(x?.spreadAtSubmit, x?.requestedPrice)}` : 'Not submitted',
      events: sub,
    },
    {
      key: 'broker',
      label: 'Broker Response',
      status: x?.acknowledgedAt ? 'DONE' : os === 'UNKNOWN' || os === 'RECONCILING' ? 'ACTIVE' : os === 'REJECTED' && submitted ? 'FAILED' : 'PENDING',
      at: x?.acknowledgedAt ?? first(broker),
      summary: x?.acknowledgedAt ? `order #${x.mt5Order ?? '—'} · deal #${x.mt5Deal ?? '—'} · latency ${x.latencyMs ?? '—'} ms` : os === 'UNKNOWN' ? 'Outcome unknown — reconciling, never resent' : '—',
      events: broker,
    },
    {
      key: 'fill',
      label: 'Fill',
      status: filled ? 'DONE' : os === 'ACKNOWLEDGED' ? 'ACTIVE' : 'PENDING',
      at: x?.filledAt ?? first(fill),
      summary: filled ? `${lots(x?.filledVolume)} @ ${px(x?.fillPrice)} · slippage ${x?.slippagePoints != null ? `${signed(x.slippagePoints, 1)} pts` : '—'} · position #${x?.mt5Position ?? '—'}` : '—',
      events: fill,
    },
    {
      key: 'sltp',
      label: 'SL/TP',
      status: x?.mgmt?.protected ? 'DONE' : filled && !closed ? 'ACTIVE' : 'PENDING',
      at: first(sltp),
      summary: filled ? `Broker SL ${px(x?.brokerSl, x?.fillPrice)} / TP ${px(x?.brokerTp, x?.fillPrice)} · protective ${px(x?.protectiveSl, x?.fillPrice)}` : '—',
      events: sltp,
    },
    {
      key: 'mgmt',
      label: 'Management Events',
      status: mgmt.length ? (closed ? 'DONE' : 'ACTIVE') : filled && !closed ? 'ACTIVE' : 'PENDING',
      at: first(mgmt),
      summary: mgmt.length ? `${mgmt.length} action(s) · last: ${mgmt[mgmt.length - 1].detail}` : filled && !closed ? x?.nextAction ?? 'Monitoring' : '—',
      events: mgmt,
    },
    {
      key: 'exit',
      label: 'Exit',
      status: closed ? 'DONE' : x?.positionState === 'EXIT_PENDING' ? 'ACTIVE' : 'PENDING',
      at: x?.closedAt ?? first(exit),
      summary: closed ? `${human(x?.exitReason)} @ ${px(x?.exitPrice, x?.fillPrice)} · ${signed(x?.realizedPnl)} ${x?.accountCurrency ?? ''} · ${x?.rMultiple != null ? `${signed(x.rMultiple)}R` : '—'}` : '—',
      events: exit,
    },
    {
      key: 'recon',
      label: 'Reconciliation',
      status: d.reconciliation.some((f) => !f.resolvedAt && f.severity !== 'INFO') ? 'FAILED' : x?.publishedAt ? 'DONE' : recon.length ? 'ACTIVE' : 'PENDING',
      at: x?.publishedAt ?? first(recon),
      summary: x?.publishedAt
        ? `Reconciled with MT5 deals · published to Stage 10 ${stamp(x.publishedAt)}`
        : d.reconciliation.length
          ? `${d.reconciliation.filter((f) => !f.resolvedAt).length} open finding(s)`
          : 'Continuously compared with MT5 orders, deals and positions',
      events: recon,
    },
  ];
}

type Tab = 'Timeline' | 'Preflight' | 'Orders & Deals' | 'Stage 10';

export function LifecycleDrawer({ executionId, version, now, onClose }: { executionId: string; version: string; now: number; onClose: () => void }) {
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('Timeline');

  useEffect(() => {
    let cancelled = false;
    fetchExecutionDetail(executionId)
      .then((d) => !cancelled && (setDetail(d), setErr('')))
      .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Lifecycle unavailable'));
    return () => {
      cancelled = true;
    };
  }, [executionId, version]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const phases = useMemo(() => (detail ? buildPhases(detail) : []), [detail]);
  const x = detail?.execution ?? null;
  const a = detail?.authorization ?? null;
  const instrument = x?.instrument ?? a?.instrument ?? executionId;
  const ref = x?.fillPrice ?? x?.referencePrice ?? a?.entryPolicy.referencePrice;
  const trade = detail?.trade ?? null;

  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer ms-drawer" role="dialog" aria-modal="true" aria-label={`${instrument} execution lifecycle`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 9 · EXECUTION &amp; POSITIONS · {executionId}</small>
            <h2>
              {instrument} {(x?.direction ?? a?.direction) && <Badge tone={dirTone(x?.direction ?? a?.direction)}>{x?.direction ?? a?.direction}</Badge>}{' '}
              {x ? <Badge tone={x.positionState ? positionTone(x.positionState) : orderTone(x.orderState)}>{human(x.positionState ?? x.orderState)}</Badge> : a && <Badge tone="green">AUTHORIZED</Badge>}
            </h2>
          </div>
          <button type="button" className="md-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="md-drawer-body">
          {err && (
            <div className="hr-banner err">
              <AlertTriangle size={14} />
              <span>{err}</span>
            </div>
          )}
          {!detail && !err && <p className="hr-reason">Loading persisted lifecycle…</p>}
          {detail && !x && !a && <p className="hr-reason">No Stage 9 execution or Stage 8 authorization with this ID.</p>}
          {detail && (x || a) && (
            <>
              <div className="md-kpi h1-kpi">
                <div>
                  <span>Account</span>
                  <b>
                    {x?.accountName ?? a?.accountName ?? x?.accountId ?? a?.accountId} <Badge tone={classTone(x?.accountClass ?? a?.accountClass)}>{x?.accountClass ?? a?.accountClass ?? '—'}</Badge>
                  </b>
                </div>
                <div>
                  <span>Order / position</span>
                  <b>
                    {x ? human(x.orderState) : 'AUTHORIZED'} / {x?.positionState ? human(x.positionState) : '—'}
                  </b>
                </div>
                <div>
                  <span>Volume</span>
                  <b>
                    {lots(x?.openVolume ?? x?.filledVolume ?? x?.authVolume ?? a?.volume)}
                    {x?.filledVolume != null && x.filledVolume !== x.authVolume ? <small className="muted"> of {lots(x.authVolume)}</small> : null}
                  </b>
                </div>
                <div>
                  <span>Entry / SL / TP</span>
                  <b>
                    {px(x?.fillPrice ?? ref, ref)} / {px(x?.brokerSl ?? x?.protectiveSl ?? a?.stopLoss, ref)} / {px(x?.brokerTp ?? x?.targetTp ?? a?.takeProfit, ref)}
                  </b>
                </div>
                <div>
                  <span>Risk now / P&amp;L</span>
                  <b>
                    {money(x?.riskNowMoney ?? a?.riskAmount, x?.accountCurrency ?? a?.riskCurrency)} ·{' '}
                    {x?.positionState === 'CLOSED' ? signed(x.realizedPnl) : signed(x?.unrealizedPnl)}
                    {x?.currentR != null || x?.rMultiple != null ? ` · ${signed(x?.rMultiple ?? x?.currentR)}R` : ''}
                  </b>
                </div>
                <div>
                  <span>Authorization</span>
                  <b>{a ? `${a.status} · ${a.status === 'PENDING' ? until(a.expiresAt, now) : stamp(a.expiresAt)}` : '—'}</b>
                </div>
              </div>
              {x?.stateReason && (
                <div className={`sd-explain ${x.positionState ? positionTone(x.positionState) : orderTone(x.orderState)}`}>
                  <b>{x.blockerCode ?? human(x.positionState ?? x.orderState)}</b>
                  <span>{x.stateReason}</span>
                </div>
              )}
              <Tabs items={['Timeline', 'Preflight', 'Orders & Deals', 'Stage 10']} active={tab} onChange={(t) => setTab(t as Tab)} idPrefix="ex-dd" label="Lifecycle section" />
              {tab === 'Timeline' && (
                <ol className="ex-timeline">
                  {phases.map((p) => (
                    <li key={p.key} className={`ex-phase ${phaseTone(p.status)}`}>
                      <div className="ex-phase-head">
                        <b>{p.label}</b>
                        <Badge tone={phaseTone(p.status)}>{p.status}</Badge>
                        <small className="muted">{stamp(p.at)}</small>
                      </div>
                      <span>{p.summary}</span>
                      {p.events.length > 0 && (
                        <ul>
                          {p.events.map((e) => (
                            <li key={e.id}>
                              <small className="muted">{stamp(e.createdAt)}</small> {e.state && <Badge tone="blue">{human(e.state)}</Badge>} {e.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {tab === 'Preflight' &&
                (x?.revalidation ? (
                  <>
                    <div className="h1-check" role="list" aria-label="Pre-execution checks">
                      {x.revalidation.checks.map((c) => (
                        <div key={c.key} role="listitem">
                          <b>{c.label}</b>
                          <span className="h1-gate">
                            <Badge tone={riskGateTone(c.status)}>{c.status}</Badge>
                          </span>
                          <span>{c.detail}</span>
                        </div>
                      ))}
                    </div>
                    <div className="kv ms-rel">
                      <span>Result</span>
                      <b>
                        {x.revalidation.ok ? 'PASS' : x.revalidation.code} · {x.revalidation.reason} · {stamp(x.revalidation.at)}
                      </b>
                      <span>Prepared order</span>
                      <b>
                        entry {px(x.revalidation.order.entry, ref)} · bid {px(x.revalidation.order.bid, ref)} / ask {px(x.revalidation.order.ask, ref)} · spread{' '}
                        {x.revalidation.order.spreadPoints != null ? `${num(x.revalidation.order.spreadPoints, 1)} pts` : '—'} · deviation{' '}
                        {x.revalidation.order.deviationPoints != null ? `${num(x.revalidation.order.deviationPoints, 1)} pts` : '—'}
                      </b>
                      <span>Risk at submit</span>
                      <b>
                        {money(x.revalidation.order.riskNow, x.accountCurrency ?? undefined)} of limit {money(x.revalidation.order.riskLimit)} · FX {num(x.revalidation.order.fxRate, 5)} · margin{' '}
                        {money(x.revalidation.order.marginRequired)}
                      </b>
                    </div>
                  </>
                ) : (
                  <p className="hr-reason">
                    {x?.stateReason ?? 'Stage 9 has not revalidated this authorization yet.'} Every mandatory condition is re-checked immediately before submission; any material change fails closed.
                  </p>
                ))}
              {tab === 'Orders & Deals' && (
                <>
                  <h4 className="hr-sub">Broker requests</h4>
                  <OrdersTable rows={detail.orders} />
                  <h4 className="hr-sub">Deals</h4>
                  <DealsTable rows={detail.deals} />
                  {detail.reconciliation.length > 0 && (
                    <>
                      <h4 className="hr-sub">Reconciliation findings</h4>
                      <ul className="or-fails">
                        {detail.reconciliation.map((f) => (
                          <li key={f.id}>
                            <Badge tone={f.resolvedAt ? 'gray' : severityTone(f.severity)}>{human(f.status)}</Badge> {f.detail}
                            {f.resolution ? <small className="muted"> — {human(f.resolution)} by {f.resolvedBy}</small> : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {tab === 'Stage 10' &&
                (trade ? (
                  <div className="kv ms-rel">
                    <span>Published</span>
                    <b>
                      {trade.stage10Status} · {stamp(trade.publishedAt)}
                    </b>
                    <span>Entry expected / actual</span>
                    <b>
                      {px(trade.entryExpected, trade.entryActual)} / {px(trade.entryActual)} · slippage {trade.slippagePoints != null ? `${signed(trade.slippagePoints, 1)} pts` : '—'}
                    </b>
                    <span>Exit</span>
                    <b>
                      {px(trade.exitPrice, trade.entryActual)} · {human(trade.exitReason)}
                    </b>
                    <span>Result</span>
                    <b>
                      {signed(trade.realizedPnl)} {trade.currency} · commission {num(trade.commission)} · swap {num(trade.swap)} · {trade.rMultiple != null ? `${signed(trade.rMultiple)}R` : '—'}
                    </b>
                    <span>Evidence</span>
                    <b>
                      <pre className="ex-json">{JSON.stringify(trade.evidence ?? {}, null, 2)}</pre>
                    </b>
                  </div>
                ) : (
                  <p className="hr-reason">Published to Stage 10 Performance &amp; Learning once the position is closed and reconciled with the broker deals.</p>
                ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
