import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Badge, Tabs } from '../../../components/UI';
import { ageText } from '../../htf-vision';
import { fetchRiskDetail } from '../services/riskClient';
import { approveRiskNow } from '../services/riskStore';
import { riskGateTone, riskTone } from '../services/riskStage';
import type { AccountEval, Authorization, Opportunity, RiskDetail, RiskGate, RiskHistoryRow } from '../types';
import { classTone, dirTone, GATE_LABELS, human, lots, money, num, pct, PERMISSION_GATES, px, until } from './format';

export function GateList({ gates, label }: { gates: Record<string, RiskGate>; label: string }) {
  const entries = Object.entries(gates);
  if (!entries.length) return <p className="hr-reason">No gates evaluated.</p>;
  return (
    <div className="h1-check" role="list" aria-label={label}>
      {entries.map(([k, g]) => (
        <div key={k} role="listitem">
          <b>
            {GATE_LABELS[k] ?? human(k)}
            <small>{PERMISSION_GATES.has(k) ? 'account permission' : 'mandatory'}</small>
          </b>
          <span className="h1-gate">
            <Badge tone={riskGateTone(g.status)}>{g.status}</Badge>
          </span>
          <span>{g.detail}</span>
        </div>
      ))}
    </div>
  );
}

export function AuthorizationTable({ rows, now }: { rows: Authorization[]; now: number }) {
  if (!rows.length) return <p className="hr-reason">No execution authorization issued. One is created only when every setup, portfolio, account and permission gate passes.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Execution ID</th>
            <th>Issued</th>
            <th>Account</th>
            <th>Instrument</th>
            <th>Side</th>
            <th>Volume</th>
            <th>Entry (max dev.)</th>
            <th>SL</th>
            <th>TP</th>
            <th>Risk</th>
            <th>Expires</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.executionId}>
              <td>
                <code className="or-code">{a.executionId}</code>
                <small className="muted"> #{a.attempt}</small>
              </td>
              <td>{ageText(a.authorizedAt, now)}</td>
              <td>
                {a.accountName ?? a.accountId} <Badge tone={classTone(a.accountClass)}>{a.accountClass ?? '—'}</Badge>
              </td>
              <td>
                <b>{a.instrument}</b>
              </td>
              <td>
                <Badge tone={dirTone(a.direction)}>{a.direction}</Badge>
              </td>
              <td>{lots(a.volume)}</td>
              <td>
                {px(a.entryPolicy.referencePrice)} <small className="muted">±{a.entryPolicy.maxDeviationPoints} pts</small>
              </td>
              <td>{px(a.stopLoss, a.entryPolicy.referencePrice)}</td>
              <td>{px(a.takeProfit, a.entryPolicy.referencePrice)}</td>
              <td>
                {money(a.riskAmount, a.riskCurrency)} <small className="muted">({pct(a.riskPct)})</small>
              </td>
              <td>{a.status === 'PENDING' ? until(a.expiresAt, now) : new Date(a.expiresAt).toLocaleTimeString()}</td>
              <td className="hv-wrap">
                <Badge tone={a.status === 'PENDING' ? 'green' : a.status === 'CONSUMED' ? 'blue' : a.status === 'REVOKED' || a.status === 'DECLINED' ? 'red' : 'gray'}>{a.status}</Badge>
                {a.statusReason ? <small className="muted"> {a.statusReason}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryTable({ rows, onOpen }: { rows: RiskHistoryRow[]; onOpen?: (setupKey: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No Stage 8 decision changes recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Instrument</th>
            <th>Scope</th>
            <th>Transition</th>
            <th>Reason</th>
            <th>Score</th>
            <th>Volume</th>
            <th>Risk</th>
            <th>Trigger</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{new Date(h.createdAt).toLocaleString()}</td>
              <td>
                {onOpen ? (
                  <button type="button" className="cs-link" onClick={() => onOpen(h.setupKey)}>
                    {h.symbol}
                  </button>
                ) : (
                  h.symbol
                )}
              </td>
              <td>{h.accountId ?? 'setup'}</td>
              <td>
                <small className="muted">{h.prevState ? human(h.prevState) : 'new'} →</small> <Badge tone={riskTone(h.state)}>{human(h.state)}</Badge>
              </td>
              <td className="hv-wrap">
                <small>
                  <b>{h.reasonCode}</b> {h.reason}
                </small>
              </td>
              <td>{h.score != null ? num(h.score, 1) : '—'}</td>
              <td>{h.volume != null ? lots(h.volume) : '—'}</td>
              <td>{h.riskPct != null ? pct(h.riskPct) : '—'}</td>
              <td className="hv-wrap">
                <small>{h.trigger ?? '—'}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function propHeadroomText(e: AccountEval) {
  if (!e.prop?.applies) return e.accountClass === 'PROP' ? 'profile missing' : 'n/a';
  const h = e.prop.headroom ?? {};
  const parts: string[] = [];
  if (h.dailyLoss) parts.push(`daily ${money(Number(h.dailyLoss.headroom), e.currency)}`);
  if (h.maxLoss) parts.push(`max-loss ${money(Number(h.maxLoss.headroom), e.currency)}`);
  return parts.join(' · ') || 'no headroom data';
}

export function AccountEvalTable({ evals, selected, onSelect }: { evals: AccountEval[]; selected?: string | null; onSelect: (id: string) => void }) {
  if (!evals.length) return <p className="hr-reason">No Demo / Live / Prop account is registered — nothing can be authorized.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Class</th>
            <th>Currency</th>
            <th>Lot size</th>
            <th>Monetary risk</th>
            <th>Risk %</th>
            <th>Margin</th>
            <th>Prop headroom</th>
            <th>State</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {evals.map((e) => (
            <tr key={e.accountId} className={`hr-click${selected === e.accountId ? ' row-selected' : ''}`} onClick={() => onSelect(e.accountId)}>
              <td>
                <b>{e.name}</b>
                <small className="muted">
                  {' '}
                  {e.login ?? ''} {e.live ? '· attached' : ''}
                </small>
              </td>
              <td>
                <Badge tone={classTone(e.accountClass)}>{e.accountClass}</Badge>
              </td>
              <td>{e.currency}</td>
              <td>
                {lots(e.sizing.volume)}
                {e.sizing.hypotheticalAtTarget ? <small className="muted"> (at target)</small> : null}
              </td>
              <td>{money(e.sizing.riskMoney, e.currency)}</td>
              <td>{pct(e.sizing.riskPct)}</td>
              <td>{money(e.sizing.marginRequired, e.currency)}</td>
              <td className="hv-wrap">
                <small>{propHeadroomText(e)}</small>
              </td>
              <td>
                <Badge tone={riskTone(e.state)}>{human(e.state)}</Badge>
                {e.hypothetical && e.state === 'QUALIFIED' ? <small className="muted"> hypothetical</small> : null}
              </td>
              <td className="hv-wrap">
                <small>
                  <b>{e.reasonCode}</b> {e.reason}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountDetail({ o, e }: { o: Opportunity; e: AccountEval }) {
  const s = e.sizing;
  const [msg, setMsg] = useState('');
  const approve = async () => {
    try {
      const r = await approveRiskNow(o.setupKey, e.accountId);
      setMsg(r.message);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Approval failed');
    }
  };
  return (
    <>
      <div className={`sd-explain ${riskTone(e.state)}`}>
        <b>
          {e.name} · {e.reasonCode}
        </b>
        <span>{e.reason}</span>
        {e.reasonCode === 'AWAITING_APPROVAL' && (
          <button type="button" className="hr-run" onClick={() => void approve()}>
            Approve for this account
          </button>
        )}
        {msg && <span className="muted">{msg}</span>}
      </div>
      {e.failures.length > 1 && (
        <>
          <h4 className="hr-sub">All failing rules ({e.failures.length})</h4>
          <ul className="or-fails">
            {e.failures.map((f, i) => (
              <li key={i}>
                <Badge tone={riskTone(f.state)}>{human(f.state)}</Badge> <b>{f.code}</b> {f.reason}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="hr-sub">Account gates</h4>
      <GateList gates={e.gates} label={`${e.name} account gates`} />
      <h4 className="hr-sub">Position sizing</h4>
      <div className="kv ms-rel">
        <span>Risk basis</span>
        <b>
          {money(s.basis, e.currency)} <small className="muted">{human(s.basisType)}</small>
        </b>
        <span>Target → allowed risk</span>
        <b>
          {pct(s.targetRiskPct)} → {pct(s.allowedRiskPct)}{' '}
          {s.hypotheticalAtTarget ? <small className="muted">headroom failed — size shown at the target risk, never authorized</small> : null}
        </b>
        <span>Loss per lot</span>
        <b>
          ({px(s.lossPerUnit, o.geometry.entry)} stop + slippage) × {num(s.contractSize, 0)} contract × {num(s.fxRate, 6)} {s.profitCurrency}→{e.currency} ({s.fxSource ?? '—'}) ={' '}
          {money(s.lossPerLot, e.currency)}
        </b>
        <span>Volume</span>
        <b>
          {money(s.riskMoneyAllowed, e.currency)} ÷ {money(s.lossPerLot)} = {num(s.volumeRaw, 4)} → floored to step {s.volumeStep ?? '—'} (min {s.volumeMin ?? '—'}, max {s.volumeMax ?? '—'}) ={' '}
          <b>{lots(s.volume)}</b>
        </b>
        <span>Monetary risk</span>
        <b>
          {money(s.riskMoney, e.currency)} ({pct(s.riskPct)}) · reward at TP {money(s.rewardMoney ?? null, e.currency)}
        </b>
        <span>Minimum-lot risk</span>
        <b>{pct(s.minVolumeRiskPct)}</b>
        <span>Margin</span>
        <b>
          {money(s.marginRequired, e.currency)} ({s.marginMethod ?? '—'}) · free after {money(s.freeMarginAfter, e.currency)} · level after{' '}
          {s.marginLevelAfter != null ? `${s.marginLevelAfter.toFixed(0)}%` : '—'} · use {pct(s.marginUsePct, 1)}
        </b>
      </div>
      {e.constraints.length > 0 && (
        <>
          <h4 className="hr-sub">Headroom constraints (% of risk basis)</h4>
          <div className="table-wrap">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>Constraint</th>
                  <th>Headroom</th>
                  <th>Result</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {e.constraints.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <b>{c.label}</b>
                    </td>
                    <td className={c.headroomPct <= 0 ? 'negative' : undefined}>{pct(c.headroomPct)}</td>
                    <td>
                      <Badge tone={c.ok ? 'green' : 'red'}>{c.ok ? 'PASS' : c.code}</Badge>
                    </td>
                    <td className="hv-wrap">
                      <small>{c.detail}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {e.prop?.applies && (
        <>
          <h4 className="hr-sub">Prop-firm compliance</h4>
          <div className="kv ms-rel">
            {Object.entries(e.prop.headroom ?? {}).map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}>
                <span>{human(k)}</span>
                <b>
                  {Object.entries(v)
                    .map(([kk, vv]) => `${kk} ${typeof vv === 'number' ? vv.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(vv)}`)
                    .join(' · ')}
                </b>
              </span>
            ))}
            <span>Blocks</span>
            <b>{e.prop.blocks?.length ? e.prop.blocks.map((b) => `${b.code}: ${b.reason}`).join(' | ') : 'None — every stored rule satisfied'}</b>
          </div>
        </>
      )}
    </>
  );
}

function PortfolioView({ e }: { e?: AccountEval }) {
  if (!e) return <p className="hr-reason">Select an account on the Accounts tab.</p>;
  const cur = e.exposure.currencies ?? [];
  const cl = e.exposure.cluster ?? [];
  return (
    <>
      <p className="hr-reason">
        {e.name}: committed risk {pct(e.exposure.committedPct)} (open + pending authorizations). Net exposure is signed: long a currency is positive, short is negative — long EURUSD, GBPUSD,
        AUDUSD and XAUUSD together are one short-USD concentration.
      </p>
      <h4 className="hr-sub">Currency legs of this trade</h4>
      {cur.length ? (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>This trade</th>
                <th>Net exposure now</th>
                <th>Headroom</th>
              </tr>
            </thead>
            <tbody>
              {cur.map((c) => (
                <tr key={c.currency}>
                  <td>
                    <b>{c.currency}</b>
                  </td>
                  <td>{c.sign > 0 ? 'long' : 'short'}</td>
                  <td className={c.net > 0 ? 'positive' : c.net < 0 ? 'negative' : undefined}>
                    {c.net > 0 ? '+' : ''}
                    {pct(c.net)}
                  </td>
                  <td className={c.headroomPct <= 0 ? 'negative' : undefined}>{pct(c.headroomPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hr-reason">Exposure not evaluated for this account.</p>
      )}
      <h4 className="hr-sub">Correlated cluster ({pct(e.exposure.clusterRiskPct)})</h4>
      {cl.length ? (
        <div className="table-wrap">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Exposure</th>
                <th>Kind</th>
                <th>Direction</th>
                <th>Risk</th>
                <th>ρ (signed)</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {cl.map((c, i) => (
                <tr key={`${c.symbol}-${i}`}>
                  <td>
                    <b>{c.symbol}</b>
                  </td>
                  <td>{human(c.kind)}</td>
                  <td>{c.d > 0 ? 'long' : 'short'}</td>
                  <td>{pct(c.riskPct)}</td>
                  <td>
                    {num(c.rho)} ({num(c.signed)})
                  </td>
                  <td className="hv-wrap">
                    <small>{c.basis}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hr-reason">No open or authorized exposure is correlated with this trade.</p>
      )}
    </>
  );
}

type DrawerTab = 'Qualification' | 'Geometry' | 'Scoring' | 'Accounts' | 'Portfolio' | 'Authorization' | 'History';

export function SetupDrawer({ setupKey, version, now, onClose }: { setupKey: string; version: string; now: number; onClose: () => void }) {
  const [detail, setDetail] = useState<RiskDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<DrawerTab>('Qualification');
  const [acct, setAcct] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetchRiskDetail(setupKey)
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setErr(e instanceof Error ? e.message : 'Detail unavailable'));
    return () => {
      cancelled = true;
    };
  }, [setupKey, version]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const o = detail?.opportunity ?? null;
  const g = o?.geometry;
  const evals = o?.accounts ?? [];
  const selAcct = evals.find((e) => e.accountId === acct) ?? evals[0];
  const ref = g?.entry ?? g?.mid;

  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer ms-drawer" role="dialog" aria-modal="true" aria-label={`${o?.symbol ?? setupKey} risk qualification`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 8 · OPPORTUNITIES &amp; RISK</small>
            <h2>
              {o?.symbol ?? setupKey.split('|')[0]} {o && <Badge tone={riskTone(o.state)}>{human(o.state)}</Badge>} {o && <Badge tone={dirTone(o.side)}>{o.side}</Badge>}
              {o?.tradeType && o.tradeType !== 'NONE' ? <Badge tone="gray">{human(o.tradeType)}</Badge> : o?.marketLeg?.tradeType && o.marketLeg.tradeType !== 'NONE' ? <Badge tone="gray">{human(o.marketLeg.tradeType)}</Badge> : null}
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
          {!detail && !err && <p className="hr-reason">Loading persisted qualification…</p>}
          {detail && !o && <p className="hr-reason">This setup has not been evaluated by Stage 8.</p>}
          {detail && o && g && (
            <>
              <div className="md-kpi h1-kpi">
                <div>
                  <span>Setup (technical)</span>
                  <b>
                    <Badge tone={riskTone(o.setupState)}>{human(o.setupState)}</Badge>
                  </b>
                </div>
                <div>
                  <span>Setup score</span>
                  <b>{o.components.length ? num(o.score, 1) : '—'}</b>
                </div>
                <div>
                  <span>Entry / SL / TP</span>
                  <b>
                    {px(g.entry, ref)} / {px(g.stopLoss, ref)} / {px(g.takeProfit, ref)}
                  </b>
                </div>
                <div>
                  <span>Reward : risk</span>
                  <b>{g.rewardRisk != null ? `${num(g.rewardRisk)}R` : '—'}</b>
                </div>
                <div>
                  <span>Accounts eligible / authorized</span>
                  <b>
                    {o.eligibleAccounts} / {o.authorizedAccounts} of {evals.length}
                  </b>
                </div>
                <div>
                  <span>Lifetime</span>
                  <b>{o.active ? until(o.expiresAt, now) : 'closed'}</b>
                </div>
              </div>
              <div className={`sd-explain ${riskTone(o.setupState)}`}>
                <b>Setup · {o.setupReasonCode}</b>
                <span>{o.setupReason}</span>
              </div>
              {o.setupState === 'QUALIFIED' && (
                <div className={`sd-explain ${riskTone(o.state)}`}>
                  <b>Best account · {o.reasonCode}</b>
                  <span>{o.reason}</span>
                </div>
              )}
              <Tabs
                items={['Qualification', 'Geometry', 'Scoring', 'Accounts', 'Portfolio', 'Authorization', 'History']}
                active={tab}
                onChange={(x) => setTab(x as DrawerTab)}
                idPrefix="or-dd"
                label="Qualification section"
              />
              {tab === 'Qualification' && (
                <>
                  <GateList gates={o.gates} label={`${o.symbol} setup gates`} />
                  {o.setupFailures.length > 0 && (
                    <>
                      <h4 className="hr-sub">Failing setup rules ({o.setupFailures.length})</h4>
                      <ul className="or-fails">
                        {o.setupFailures.map((f, i) => (
                          <li key={i}>
                            <Badge tone={riskTone(f.state)}>{human(f.state)}</Badge> <b>{f.code}</b> {f.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="hr-reason">A high score never overrides a failed mandatory gate. The setup result is technical only; each account is then qualified separately.</p>
                </>
              )}
              {tab === 'Geometry' && (
                <div className="kv ms-rel">
                  <span>Stage 7 source</span>
                  <b>
                    CONFIRMED {human(o.direction)} · {human(o.stage7.model)} · {o.stage7.trigger === 'CHOCH' ? 'CHoCH' : 'BOS'} through {px(o.stage7.triggerLevel, ref)} · confidence{' '}
                    {num(o.stage7.confidence, 1)} · confirmed {o.confirmedSince ? new Date(o.confirmedSince).toLocaleString() : '—'}
                  </b>
                  <span>Live quote</span>
                  <b>
                    bid {px(g.bid, ref)} / ask {px(g.ask, ref)} · {g.tickAgeSec != null ? `${g.tickAgeSec}s old` : 'age unknown'}
                  </b>
                  <span>H1 ATR</span>
                  <b>{px(g.atr, ref)}</b>
                  <span>Entry</span>
                  <b>
                    {px(g.entry, ref)} <small className="muted">{o.side === 'BUY' ? 'ask (market buy)' : 'bid (market sell)'}</small>
                  </b>
                  <span>Stop-loss</span>
                  <b>
                    {px(g.stopLoss, ref)} <small className="muted">invalidation {px(g.invalidation, ref)} {o.side === 'BUY' ? '−' : '+'} buffer{o.side === 'SELL' ? ' + spread' : ''}</small>
                  </b>
                  <span>Stop distance</span>
                  <b>
                    {px(g.stopDistance, ref)} = {num(g.stopAtr)} ATR · + slippage {px(g.slippage, ref)} = loss/unit {px(g.lossPerUnit, ref)}
                  </b>
                  <span>Targets</span>
                  <b>
                    {g.targets?.length
                      ? g.targets.map((t, i) => `TP${i + 1} ${px(t.price, ref)} (${t.label} ${px(t.boundary, ref)})`).join(' · ')
                      : 'No D1/H8 opposing boundary beyond the entry'}
                  </b>
                  <span>Reward : risk</span>
                  <b>
                    {g.rewardRisk != null ? `|TP − entry| ÷ loss/unit = ${num(g.rewardRisk)}R` : '—'}
                  </b>
                  <span>Spread</span>
                  <b>
                    {px(g.spread, ref)} = {num(g.spreadAtr, 3)} ATR · {g.spreadStopPct != null ? `${num(g.spreadStopPct, 1)}% of stop` : '—'}
                  </b>
                  <span>Drift since confirmation</span>
                  <b>
                    {g.driftAtr != null ? `${g.driftAtr > 0 ? '+' : ''}${num(g.driftAtr)} ATR` : '—'} from confirmation close {px(g.referenceClose, ref)}
                  </b>
                  <span>Execution</span>
                  <b>Stage 8 never submits an order — it issues an immutable authorization for Stage 9</b>
                </div>
              )}
              {tab === 'Scoring' &&
                (o.components.length ? (
                  <div className="table-wrap">
                    <table className="cs-table ms-components">
                      <thead>
                        <tr>
                          <th>Component</th>
                          <th>Points</th>
                          <th />
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.components.map((c) => (
                          <tr key={c.key}>
                            <td>
                              <b>{c.label}</b>
                            </td>
                            <td>
                              {num(c.points, 1)} / {c.max}
                            </td>
                            <td>
                              <div className="ms-bar">
                                <i style={{ width: `${Math.min(100, (c.points / Math.max(1, c.max)) * 100)}%` }} />
                              </div>
                            </td>
                            <td className="hv-wrap">{c.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="hr-reason">Not scored — geometry unavailable ({o.setupReasonCode}).</p>
                ))}
              {tab === 'Accounts' && (
                <>
                  <p className="hr-reason">
                    Each enabled account is qualified independently: the same technically good setup can be authorized on one account and blocked on another by its own balance, currency,
                    margin, exposure or prop-firm rules.
                  </p>
                  <AccountEvalTable evals={evals} selected={selAcct?.accountId} onSelect={setAcct} />
                  {selAcct && <AccountDetail o={o} e={selAcct} />}
                </>
              )}
              {tab === 'Portfolio' && <PortfolioView e={selAcct} />}
              {tab === 'Authorization' && (
                <>
                  <AuthorizationTable rows={detail.authorizations} now={now} />
                  {detail.authorizationEvents.length > 0 && (
                    <>
                      <h4 className="hr-sub">Authorization lifecycle</h4>
                      <ul className="or-fails">
                        {detail.authorizationEvents.map((ev, i) => (
                          <li key={i}>
                            <small className="muted">{new Date(ev.createdAt).toLocaleString()}</small> <code className="or-code">{ev.executionId}</code> <Badge tone="blue">{ev.status}</Badge>{' '}
                            {ev.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {tab === 'History' && <HistoryTable rows={detail.history} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
