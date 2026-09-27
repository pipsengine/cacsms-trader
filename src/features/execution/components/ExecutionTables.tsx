import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../../components/UI';
import { fetchTrades } from '../services/executionClient';
import { orderTone, positionTone, severityTone } from '../services/executionStage';
import { requestExitNow, resolveFindingNow } from '../services/executionStore';
import type { BrokerPosition, ExecDeal, ExecOrder, ExecTrade, Execution, ReconFinding, StoredPosition } from '../types';
import { classTone, dirTone, duration, human, lots, money, num, pct, px, signed, since, stamp, until } from './format';

const Empty = ({ title, detail }: { title: string; detail: string }) => (
  <div className="empty-block">
    <b>{title}</b>
    <span>{detail}</span>
  </div>
);

/* ------------------------------------------------------------------ open positions */

function CloseButton({ x }: { x: Execution }) {
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState('');
  if (x.positionState === 'EXIT_PENDING' || x.mgmt?.exitRequest) return <small className="muted">exit queued</small>;
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={`mini${armed ? ' danger' : ''}`}
        title={err || 'The central engine closes the position on MT5 and reconciles it'}
        onClick={async () => {
          if (!armed) return setArmed(true);
          setArmed(false);
          try {
            await requestExitNow(x.executionId, 'Operator close from Execution & Positions');
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Exit request failed');
          }
        }}
        onBlur={() => setArmed(false)}
      >
        {armed ? 'Confirm close' : 'Close'}
      </button>
      {err && <small className="negative"> {err}</small>}
    </span>
  );
}

export function OpenPositionsTable({
  rows,
  external,
  stored,
  stale,
  staleLabel,
  now,
  onOpen,
}: {
  rows: Execution[];
  external: BrokerPosition[];
  stored: StoredPosition[];
  stale: boolean;
  staleLabel: string;
  now: number;
  onOpen: (id: string) => void;
}) {
  if (!rows.length && !external.length && !stored.length)
    return <Empty title="No open positions" detail="Stage 9 opens a position only from an immutable Stage 8 authorization after pre-execution revalidation and broker confirmation." />;
  return (
    <div className="table-wrap">
      <table className="cs-table ex-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Type</th>
            <th>Instrument</th>
            <th>Side</th>
            <th>Volume</th>
            <th>Entry / current</th>
            <th>SL</th>
            <th>TP</th>
            <th>Risk</th>
            <th>Unrealized P&amp;L</th>
            <th>R</th>
            <th>Duration</th>
            <th>Management</th>
            <th>Current action</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const ref = x.fillPrice ?? x.referencePrice;
            const sl = x.brokerSl ?? x.protectiveSl;
            const tp = x.brokerTp ?? x.targetTp;
            const pnl = x.unrealizedPnl;
            return (
              <tr key={x.executionId} className="hr-click" onClick={() => onOpen(x.executionId)} title={x.stateReason ?? undefined}>
                <td>
                  <b>{x.accountName ?? x.accountId}</b> <small className="muted">{x.accountCurrency}</small>
                </td>
                <td>
                  <Badge tone={classTone(x.accountClass)}>{x.accountClass}</Badge>
                </td>
                <td>
                  <b className={x.instrument === 'XAUUSD' ? 'hr-gold' : undefined}>{x.instrument}</b>
                  {x.brokerSymbol !== x.instrument && <small className="muted"> {x.brokerSymbol}</small>}
                </td>
                <td>
                  <Badge tone={dirTone(x.direction)}>{x.direction}</Badge>
                </td>
                <td>{lots(x.openVolume ?? x.filledVolume)}</td>
                <td>
                  {px(x.fillPrice, ref)} <small className="muted">/ {px(x.currentPrice, ref)}</small>
                </td>
                <td>{sl ? px(sl, ref) : <Badge tone="red">NO SL</Badge>}</td>
                <td>{px(tp, ref)}</td>
                <td>
                  {money(x.riskNowMoney, x.accountCurrency ?? undefined)} <small className="muted">({pct(x.riskNowPct)})</small>
                </td>
                <td className={pnl == null ? undefined : pnl >= 0 ? 'positive' : 'negative'}>{pnl == null ? '—' : signed(pnl)}</td>
                <td>{x.currentR != null ? `${signed(x.currentR)}R` : '—'}</td>
                <td>{since(x.filledAt, now)}</td>
                <td>
                  <Badge tone={stale ? 'amber' : positionTone(x.positionState)}>{stale ? staleLabel : human(x.positionState)}</Badge>
                  {stale && <small className="muted"> last {human(x.positionState)}</small>}
                </td>
                <td className="hv-wrap">
                  <small>{stale ? 'Awaiting reconnection + full reconciliation' : x.mgmt?.error ?? x.nextAction ?? '—'}</small>
                </td>
                <td>{!stale && <CloseButton x={x} />}</td>
              </tr>
            );
          })}
          {external.map((p) => (
            <tr key={`ext-${p.ticket}`} title="Position on the MT5 account not opened by Stage 9 — reconciled and counted in exposure, never managed">
              <td>
                <b>{p.accountId ?? '—'}</b> <small className="muted">#{p.ticket}</small>
              </td>
              <td>
                <Badge tone="gray">EXTERNAL</Badge>
              </td>
              <td>
                <b>{p.symbol}</b>
              </td>
              <td>
                <Badge tone={dirTone(p.side)}>{p.side}</Badge>
              </td>
              <td>{lots(p.volume)}</td>
              <td>
                {px(p.priceOpen)} <small className="muted">/ {px(p.priceCurrent, p.priceOpen)}</small>
              </td>
              <td>{p.sl ? px(p.sl, p.priceOpen) : <Badge tone="red">NO SL</Badge>}</td>
              <td>{p.tp ? px(p.tp, p.priceOpen) : '—'}</td>
              <td>
                <small className="muted">{p.sl ? 'in Open Risk' : 'unknown (no SL)'}</small>
              </td>
              <td className={p.profit + p.swap >= 0 ? 'positive' : 'negative'}>{signed(p.profit + p.swap)}</td>
              <td>—</td>
              <td>{p.time ? since(new Date(p.time * 1000).toISOString(), now) : '—'}</td>
              <td>
                <Badge tone={stale ? 'amber' : 'gray'}>{stale ? staleLabel : 'UNMANAGED'}</Badge>
              </td>
              <td className="hv-wrap">
                <small>{p.magic ? `magic ${p.magic}` : 'manual / other EA'} · managed in MT5</small>
              </td>
              <td />
            </tr>
          ))}
          {stored.map((p) => (
            <tr key={`db-${p.id}`} title="Last broker state mirrored to dbo.mt5_positions — the engine is not reporting">
              <td>
                <b>{p.accountId}</b> <small className="muted">#{p.mt5PositionId}</small>
              </td>
              <td>
                <Badge tone="gray">MIRROR</Badge>
              </td>
              <td>
                <b>{p.symbol}</b>
              </td>
              <td>
                <Badge tone={dirTone(p.side)}>{p.side}</Badge>
              </td>
              <td>{lots(p.volume)}</td>
              <td>
                {px(p.entry)} <small className="muted">/ {px(p.current, p.entry)}</small>
              </td>
              <td>{p.sl ? px(p.sl, p.entry) : <Badge tone="red">NO SL</Badge>}</td>
              <td>{p.tp ? px(p.tp, p.entry) : '—'}</td>
              <td>—</td>
              <td className={p.pnl >= 0 ? 'positive' : 'negative'}>{signed(p.pnl)}</td>
              <td>—</td>
              <td>{since(p.openedAt, now)}</td>
              <td>
                <Badge tone="amber">STALE</Badge>
              </td>
              <td className="hv-wrap">
                <small>{p.cacsmsTradeId ?? '—'}</small>
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ execution queue */

export function QueueTable({ rows, node, now, onOpen }: { rows: Execution[]; node: string | null; now: number; onOpen: (id: string) => void }) {
  if (!rows.length)
    return <Empty title="Execution queue empty" detail="No pending Stage 8 authorization and no execution in flight. Stage 9 never creates its own opportunity, direction or risk decision." />;
  return (
    <div className="table-wrap">
      <table className="cs-table ex-table">
        <thead>
          <tr>
            <th>Stage 8 authorization</th>
            <th>Account</th>
            <th>Execution ID</th>
            <th>Instrument</th>
            <th>Direction</th>
            <th>Volume</th>
            <th>Entry policy</th>
            <th>Expiry</th>
            <th>Pre-trade validation</th>
            <th>MT5 node</th>
            <th>Status</th>
            <th>Retry / reconciliation</th>
            <th>Blocker / rejection reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const rv = x.revalidation;
            const passed = rv?.checks.filter((c) => c.status === 'PASS').length ?? 0;
            const auth = x.authorization;
            const ref = x.referencePrice ?? auth?.entryPolicy.referencePrice;
            const retry =
              x.orderState === 'UNKNOWN' || x.orderState === 'RECONCILING'
                ? 'Outcome unknown — reconciling with MT5, never resent'
                : x.requotes
                  ? `${x.requotes} requote/no-fill retr${x.requotes === 1 ? 'y' : 'ies'}`
                  : x.submitAttemptedAt
                    ? 'Submitted once'
                    : '—';
            return (
              <tr key={x.executionId} className="hr-click" onClick={() => onOpen(x.executionId)}>
                <td>
                  <Badge tone={x.virtual ? 'green' : 'blue'}>{x.virtual ? 'PENDING' : auth?.status ?? 'CONSUMED'}</Badge>
                  {auth?.authorizedAt && <small className="muted"> {stamp(auth.authorizedAt)}</small>}
                </td>
                <td>
                  {x.accountName ?? x.accountId} <Badge tone={classTone(x.accountClass)}>{x.accountClass ?? '—'}</Badge>
                </td>
                <td>
                  <code className="or-code">{x.executionId}</code>
                </td>
                <td>
                  <b>{x.instrument}</b>
                </td>
                <td>
                  <Badge tone={dirTone(x.direction)}>{x.direction}</Badge>
                </td>
                <td>{lots(x.authVolume)}</td>
                <td>
                  <small>
                    {human(x.entryType)}
                    {ref != null ? ` @ ${px(ref)}` : ''}
                    {auth ? ` ±${auth.entryPolicy.maxDeviationPoints} pts` : ''}
                  </small>
                </td>
                <td>{x.orderState === 'AUTHORIZED' || x.orderState === 'QUEUED' || x.orderState === 'REVALIDATING' ? until(x.authExpiresAt, now) : stamp(x.authExpiresAt)}</td>
                <td>
                  {rv ? (
                    <>
                      <Badge tone={rv.ok ? 'green' : rv.terminal ? 'red' : 'amber'}>{rv.ok ? 'PASS' : rv.code}</Badge>
                      <small className="muted">
                        {' '}
                        {passed}/{rv.checks.length}
                      </small>
                    </>
                  ) : (
                    <small className="muted">not yet run</small>
                  )}
                </td>
                <td>
                  <small>{x.node ?? node ?? '—'}</small>
                </td>
                <td>
                  <Badge tone={orderTone(x.orderState)}>{human(x.orderState)}</Badge>
                </td>
                <td className="hv-wrap">
                  <small>{retry}</small>
                </td>
                <td className="hv-wrap">
                  <small>
                    {x.blockerCode ? <b>{x.blockerCode} </b> : null}
                    {x.stateReason ?? '—'}
                  </small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ orders & deals */

export function OrdersTable({ rows, onOpen }: { rows: ExecOrder[]; onOpen?: (id: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No broker request recorded. Every order_send is persisted in dbo.app_exec_order with its unique request ID before it is sent.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table ex-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Execution</th>
            <th>Purpose</th>
            <th>Symbol</th>
            <th>Type</th>
            <th>Volume req. / filled</th>
            <th>Price req. / filled</th>
            <th>SL / TP</th>
            <th>Spread</th>
            <th>Slippage</th>
            <th>Latency</th>
            <th>MT5 order / deal</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={onOpen ? 'hr-click' : undefined} onClick={onOpen ? () => onOpen(o.executionId) : undefined}>
              <td>{stamp(o.createdAt)}</td>
              <td>
                <code className="or-code">{o.executionId}</code>
              </td>
              <td>{human(o.purpose)}</td>
              <td>
                <b>{o.symbol}</b>
              </td>
              <td>{human(o.orderType)}</td>
              <td>
                {lots(o.volume)} <small className="muted">/ {lots(o.fillVolume)}</small>
              </td>
              <td>
                {px(o.requestedPrice)} <small className="muted">/ {px(o.fillPrice, o.requestedPrice)}</small>
              </td>
              <td>
                <small>
                  {px(o.sl, o.requestedPrice)} / {px(o.tp, o.requestedPrice)}
                </small>
              </td>
              <td>{px(o.spread, o.requestedPrice)}</td>
              <td>{o.slippagePoints != null ? `${signed(o.slippagePoints, 1)} pts` : '—'}</td>
              <td>{o.latencyMs != null ? `${o.latencyMs} ms` : '—'}</td>
              <td>
                <small>
                  {o.mt5Order ?? '—'} / {o.mt5Deal ?? '—'}
                </small>
              </td>
              <td className="hv-wrap">
                <Badge
                  tone={
                    o.status === 'FILLED' || o.status === 'PLACED' || o.status === 'PARTIAL'
                      ? 'green'
                      : o.status === 'UNKNOWN' || o.status === 'NO_FILL_RETRY'
                        ? 'amber'
                        : o.status === 'REJECTED' || o.status === 'NOT_SENT'
                          ? 'red'
                          : 'blue'
                  }
                >
                  {human(o.status)}
                </Badge>
                {o.retcode != null && (
                  <small className="muted">
                    {' '}
                    {o.retcode} {o.retcodeText ?? ''}
                  </small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DealsTable({ rows, onOpen }: { rows: ExecDeal[]; onOpen?: (id: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No broker deal recorded. Deals are read from MT5 history and linked to executions by comment, magic and position ID.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table ex-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Deal</th>
            <th>Order / position</th>
            <th>Execution</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Entry</th>
            <th>Volume</th>
            <th>Price</th>
            <th>Commission</th>
            <th>Swap</th>
            <th>Profit</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr
              key={`${d.accountId}-${d.ticket}`}
              className={onOpen && d.executionId ? 'hr-click' : undefined}
              onClick={onOpen && d.executionId ? () => onOpen(d.executionId!) : undefined}
            >
              <td>{stamp(d.time)}</td>
              <td>#{d.ticket}</td>
              <td>
                <small>
                  {d.order ?? '—'} / {d.position ?? '—'}
                </small>
              </td>
              <td>{d.executionId ? <code className="or-code">{d.executionId}</code> : <small className="muted">external</small>}</td>
              <td>
                <b>{d.symbol}</b>
              </td>
              <td>
                <Badge tone={dirTone(d.side)}>{d.side}</Badge>
              </td>
              <td>{d.entry}</td>
              <td>{lots(d.volume)}</td>
              <td>{px(d.price)}</td>
              <td>{num(d.commission)}</td>
              <td>{num(d.swap)}</td>
              <td className={d.profit >= 0 ? 'positive' : 'negative'}>{signed(d.profit)}</td>
              <td>
                <small>{d.reason ?? '—'}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ trade history */

export function TradeHistory({ initial, onOpen }: { initial: ExecTrade[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [symbol, setSymbol] = useState('');
  const [accountId, setAccountId] = useState('');
  const [days, setDays] = useState(0);
  const [rows, setRows] = useState<ExecTrade[] | null>(null);
  const [err, setErr] = useState('');
  const filtered = Boolean(q || symbol || accountId || days);

  useEffect(() => {
    if (!filtered) {
      setRows(null);
      setErr('');
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchTrades({ q, symbol, accountId, days: days || undefined, limit: 500 })
        .then((r) => !cancelled && (setRows(r.trades), setErr('')))
        .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : 'Trade history unavailable'));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, symbol, accountId, days, filtered]);

  const list = rows ?? initial;
  const symbols = useMemo(() => [...new Set(initial.map((t) => t.symbol))].sort(), [initial]);
  const accounts = useMemo(() => [...new Set(initial.map((t) => t.accountId))].sort(), [initial]);
  const total = list.reduce((a, t) => a + t.realizedPnl, 0);
  const wins = list.filter((t) => t.realizedPnl > 0).length;
  const rs = list.filter((t) => t.rMultiple != null);

  return (
    <>
      <div className="ex-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search execution ID, setup, exit reason…" aria-label="Search trades" />
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument">
          <option value="">All instruments</option>
          {symbols.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <option value={0}>All time</option>
          <option value={1}>24 h</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <small className="muted">
          {list.length} trades · {wins} wins · net {signed(total)} · avg {rs.length ? `${signed(rs.reduce((a, t) => a + (t.rMultiple ?? 0), 0) / rs.length)}R` : '—'}
        </small>
      </div>
      {err && <p className="hr-reason negative">{err}</p>}
      {!list.length ? (
        <Empty title="No closed trades" detail={filtered ? 'No closed Stage 9 trade matches the filter.' : 'Closed Stage 9 trades are persisted in dbo.app_exec_trade and published to Stage 10.'} />
      ) : (
        <div className="table-wrap">
          <table className="cs-table ex-table">
            <thead>
              <tr>
                <th>Closed</th>
                <th>Account</th>
                <th>Instrument</th>
                <th>Side</th>
                <th>Setup evidence</th>
                <th>Entry exp. / actual</th>
                <th>Exit</th>
                <th>Volume</th>
                <th>P&amp;L</th>
                <th>Risk</th>
                <th>R</th>
                <th>Duration</th>
                <th>Exit reason</th>
                <th>Stage 10</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.executionId} className="hr-click" onClick={() => onOpen(t.executionId)}>
                  <td>{stamp(t.closedAt)}</td>
                  <td>
                    {t.accountId} <Badge tone={classTone(t.accountClass)}>{t.accountClass}</Badge>
                  </td>
                  <td>
                    <b>{t.symbol}</b>
                  </td>
                  <td>
                    <Badge tone={dirTone(t.direction)}>{t.direction}</Badge>
                  </td>
                  <td className="hv-wrap">
                    <small>
                      {[t.setup?.model && human(t.setup.model), t.setup?.trigger, t.setup?.zone && human(t.setup.zone), t.setup?.confidence != null && `conf ${num(t.setup.confidence, 0)}`]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </small>
                  </td>
                  <td>
                    {px(t.entryExpected, t.entryActual)} <small className="muted">/ {px(t.entryActual)}</small>
                    {t.slippagePoints != null && <small className="muted"> ({signed(t.slippagePoints, 1)} pts)</small>}
                  </td>
                  <td>{px(t.exitPrice, t.entryActual)}</td>
                  <td>{lots(t.volume)}</td>
                  <td className={t.realizedPnl >= 0 ? 'positive' : 'negative'}>
                    {signed(t.realizedPnl)} <small className="muted">{t.currency}</small>
                  </td>
                  <td>
                    {money(t.riskAmount)} <small className="muted">({pct(t.riskPct)})</small>
                  </td>
                  <td>{t.rMultiple != null ? `${signed(t.rMultiple)}R` : '—'}</td>
                  <td>{duration(t.durationSec)}</td>
                  <td className="hv-wrap">
                    <small>{human(t.exitReason)}</small>
                  </td>
                  <td>
                    <Badge tone={t.stage10Status === 'PUBLISHED' ? 'green' : 'amber'}>{t.stage10Status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ reconciliation */

const RESOLUTIONS = ['VERIFIED', 'NOT_EXECUTED', 'ACCEPTED', 'CLOSED_MANUALLY'];

function ResolveCell({ f }: { f: ReconFinding }) {
  const [resolution, setResolution] = useState(f.status === 'UNKNOWN_OUTCOME' || f.status === 'UNKNOWN_EXECUTION' ? 'NOT_EXECUTED' : 'ACCEPTED');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  return (
    <span className="ex-resolve">
      <select value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label="Resolution">
        {RESOLUTIONS.map((r) => (
          <option key={r} value={r}>
            {human(r)}
          </option>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you verified in MT5" aria-label="Resolution note" />
      <button
        type="button"
        className="mini"
        disabled={!note.trim()}
        onClick={async () => {
          try {
            await resolveFindingNow(f.id, resolution, note.trim());
          } catch (e) {
            setErr(e instanceof Error ? e.message : 'Resolve failed');
          }
        }}
      >
        Resolve
      </button>
      {err && <small className="negative">{err}</small>}
    </span>
  );
}

export function ReconciliationView({ open, recent, onOpen }: { open: ReconFinding[]; recent: ReconFinding[]; onOpen: (id: string) => void }) {
  const counts = open.reduce<Record<string, number>>((a, f) => ((a[f.status] = (a[f.status] ?? 0) + 1), a), {});
  const resolved = recent.filter((f) => f.resolution);
  return (
    <>
      <div className="ex-recon-sum">
        {Object.keys(counts).length ? (
          Object.entries(counts).map(([k, v]) => (
            <span key={k}>
              <Badge tone={k === 'MATCHED' ? 'green' : 'amber'}>{human(k)}</Badge> {v}
            </span>
          ))
        ) : (
          <span>
            <Badge tone="green">MATCHED</Badge> every Stage 9 order, deal and position agrees with MT5
          </span>
        )}
      </div>
      {!open.length ? (
        <p className="hr-reason">No open discrepancy. The engine compares the ledger with MT5 orders, deals and positions every cycle; deterministic cases are repaired automatically and logged.</p>
      ) : (
        <div className="table-wrap">
          <table className="cs-table ex-table">
            <thead>
              <tr>
                <th>First seen</th>
                <th>Account</th>
                <th>Status</th>
                <th>Severity</th>
                <th>Execution / ticket</th>
                <th>Detail</th>
                <th>Engine action</th>
                <th>Seen</th>
                <th>Intervention</th>
              </tr>
            </thead>
            <tbody>
              {open.map((f) => (
                <tr key={f.id}>
                  <td>{stamp(f.firstSeen)}</td>
                  <td>{f.accountId}</td>
                  <td>
                    <Badge tone={severityTone(f.severity)}>{human(f.status)}</Badge>
                  </td>
                  <td>{f.severity}</td>
                  <td>
                    {f.executionId ? (
                      <button type="button" className="cs-link" onClick={() => onOpen(f.executionId!)}>
                        {f.executionId}
                      </button>
                    ) : f.ticket ? (
                      `#${f.ticket}`
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="hv-wrap">
                    <small>{f.detail}</small>
                  </td>
                  <td className="hv-wrap">
                    <small>{f.action ?? '—'}</small>
                  </td>
                  <td>
                    {f.occurrences}× <small className="muted">{since(f.lastSeen)} ago</small>
                  </td>
                  <td>{f.severity === 'INFO' ? <small className="muted">informational</small> : <ResolveCell f={f} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h4 className="hr-sub">Resolved ({resolved.length})</h4>
      {!resolved.length ? (
        <p className="hr-reason">No resolved discrepancy recorded.</p>
      ) : (
        <div className="table-wrap">
          <table className="cs-table ex-table">
            <thead>
              <tr>
                <th>Resolved</th>
                <th>Account</th>
                <th>Status</th>
                <th>Execution / ticket</th>
                <th>Resolution</th>
                <th>By</th>
                <th>Note / detail</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((f) => (
                <tr key={f.id}>
                  <td>{stamp(f.resolvedAt)}</td>
                  <td>{f.accountId}</td>
                  <td>
                    <Badge tone="gray">{human(f.status)}</Badge>
                  </td>
                  <td>{f.executionId ? <code className="or-code">{f.executionId}</code> : f.ticket ? `#${f.ticket}` : '—'}</td>
                  <td>
                    <Badge tone={f.resolution === 'AUTO_LINKED' || f.resolution === 'CLEARED' || f.resolution === 'VERIFIED' ? 'green' : 'blue'}>{human(f.resolution)}</Badge>
                  </td>
                  <td>{f.resolvedBy ?? '—'}</td>
                  <td className="hv-wrap">
                    <small>{f.note || f.detail}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
