import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, SlidersHorizontal, X, XCircle } from 'lucide-react';
import { Badge, Card, PageHeader, Tabs } from '../../components/UI';
import { allPairs } from '../../data/market';
import { useTrading } from '../../context/TradingContext';
import { gatedState } from '../market-data/services/stage1Gate';
import { ageText, startVisionStore, useVisionStore } from '../htf-vision';
import { startAutonomyStore, useAutonomyState } from '../workflow-engine/services/autonomyStore';
import { fetchScannerDetail } from './services/scannerClient';
import { applyScannerConfig, runScannerNow, scannerRunAgeMs, scannerStageStatus, startScannerStore, useScannerStore } from './services/scannerStore';
import { directionTone } from './services/scannerStage';
import type { OpportunityHypothesis } from '../mt5-connection/services/mt5BridgeClient';
import type { AssetLeg, ScannerDetail, ScannerInstrument, ScannerRun, ScannerState, Stage1Readiness } from './types';
import './market-scanner.css';

const PAGE_SIZE = 15;

function RankPager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (n: number) => void }) {
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

const human = (s?: string | null) => (s ? s.replace(/_/g, ' ') : '—');
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

function locatedPrice(symbol: string, value?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = symbol === 'XAUUSD' || value >= 50 ? 2 : value >= 10 ? 3 : 5;
  return value.toFixed(digits);
}

function XauWatch({ autonomy }: { autonomy?: { opportunity?: { summary?: { production?: { operatorPositionLimit?: number; xauReservePct?: number }; xau?: string }; instruments?: { symbol: string; hypotheses?: OpportunityHypothesis[]; execution?: Record<string, { direction?: string; status?: string; position?: number | null }> }[] } } }) {
  const book = autonomy?.opportunity?.instruments?.find((row) => row.symbol === 'XAUUSD');
  const live = (book?.hypotheses ?? []).filter((item) => item.status && item.status !== 'NOT_DETECTED' && item.opportunityFamily);
  const production = autonomy?.opportunity?.summary?.production;
  return (
    <div className="table-wrap">
      <p className="hr-reason">
        XAUUSD {autonomy?.opportunity?.summary?.xau ?? 'WATCHING'} · reserve {production?.xauReservePct ?? 0}% · operator limit {production?.operatorPositionLimit ?? 3}
        {' · '}M15 {book?.execution?.M15 ? `${book.execution.M15.direction ?? '—'} ${book.execution.M15.status ?? ''}` : 'no M15 channel yet'}
        {' · '}M5 {book?.execution?.M5 ? `${book.execution.M5.direction ?? '—'} ${book.execution.M5.status ?? ''}` : 'no M5 channel yet'}
      </p>
      {!live.length ? <p className="hr-reason">No detected XAUUSD hypothesis. Proximity to a zone is not a trade.</p> : null}
      {live.map((item) => {
        const zone = item.location;
        return (
          <p key={`${item.TiTLevel}-${item.direction}`} className="hr-reason">
            {item.TiTLevel} {human(item.direction)} · current {locatedPrice('XAUUSD', zone?.price)} · ERZ {zone?.zoneLow == null ? '—' : `${locatedPrice('XAUUSD', zone.zoneLow)}–${locatedPrice('XAUUSD', zone.zoneHigh)}`} · distance {zone?.distanceAtr == null ? '—' : `${zone.distanceAtr.toFixed(2)} ATR`} · P1 {human(item.p1?.reason ?? item.p1?.state)} · P2 {human(item.p2?.reason ?? item.p2?.state)} · campaign {human(item.status)}
          </p>
        );
      })}
    </div>
  );
}

function HypothesisLocations({ rows }: { rows?: { symbol: string; hypotheses?: OpportunityHypothesis[] }[] }) {
  const detected = (rows ?? []).flatMap((row) =>
    (row.hypotheses ?? []).filter((item) => item.status && item.status !== 'NOT_DETECTED' && item.opportunityFamily),
  );
  if (!detected.length) return <p className="hr-reason">No detected hypothesis has a location yet.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table ms-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Level</th>
            <th>Direction</th>
            <th>Current</th>
            <th>ERZ</th>
            <th>Distance</th>
            <th>Parent</th>
            <th>ERZ basis</th>
            <th>P1</th>
            <th>P2</th>
          </tr>
        </thead>
        <tbody>
          {detected.map((item) => {
            const symbol = item.instrument ?? '—';
            const zone = item.location;
            return (
              <tr key={`${symbol}-${item.TiTLevel ?? 'NORMAL'}-${item.opportunityFamily}-${item.direction}`}>
                <td>{symbol}</td>
                <td>{item.TiTLevel ?? 'NORMAL'}</td>
                <td>{human(item.direction)}</td>
                <td>{locatedPrice(symbol, zone?.price)}</td>
                <td>{zone?.zoneLow == null ? '—' : `${locatedPrice(symbol, zone.zoneLow)}–${locatedPrice(symbol, zone.zoneHigh)}`}</td>
                <td>{zone?.distanceAtr == null ? '—' : `${zone.distanceAtr.toFixed(2)} ATR`}</td>
                <td>{item.parentChannelPosition == null ? '—' : `${item.parentChannelPosition.toFixed(0)}%`}</td>
                <td title={(item.expectedRetracementZone?.reasons ?? []).join('; ')}>{(item.expectedRetracementZone?.reasons ?? []).slice(0, 2).join('; ') || '—'}</td>
                <td>{human(item.p1?.reason ?? item.p1?.state)}</td>
                <td>{human(item.p2?.reason ?? item.p2?.state)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const signed = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

export const stateTone = (s?: ScannerState | string | null) =>
  s === 'PROMOTED' ? 'green' : s === 'QUALIFIED' ? 'blue' : s === 'WATCH' || s === 'STALE' ? 'amber' : s === 'BLOCKED' ? 'red' : 'gray';
export const stage1Tone = (s?: Stage1Readiness | string | null) =>
  s === 'READY' ? 'green' : s === 'CLOSED' ? 'blue' : s === 'STALE' ? 'amber' : s === 'BLOCKED' ? 'red' : 'gray';
const CONV_COLOR: Record<string, string> = { green: '#22c55e', blue: '#3f8fd1', amber: '#e2b04a', red: '#ef4444', gray: '#64748b' };

function Conviction({ i }: { i: ScannerInstrument }) {
  if (i.conviction == null) return <span className="muted">—</span>;
  return (
    <div className="hr-conf ms-conv" title={`raw ${num(i.rawScore, 1)} × confidence weighting`}>
      <i style={{ width: `${Math.min(100, i.conviction)}%`, background: CONV_COLOR[stateTone(i.state)] }} />
      <span>{i.conviction.toFixed(0)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ funnel */

function Funnel({ run, channelQualified, h1Ready }: { run: ScannerRun | null; channelQualified: number | null; h1Ready: number | null }) {
  const c = run?.counters;
  const box = (value: number | null | undefined, label: string, owner: string, title: string, sub?: string) => (
    <div title={title}>
      <b>{value ?? '—'}</b>
      <span>{label}</span>
      <small className="ms-owner">{sub ?? owner}</small>
    </div>
  );
  return (
    <div className="funnel ms-funnel">
      {box(c?.universe ?? allPairs.length, 'Universe', 'Stage 4', '28 FX combinations plus XAUUSD')}
      <i>→</i>
      {box(c?.available, 'Available / valid', 'Stage 4 · Stage 1 data', 'Stage 1 D1/H8/H1 history complete and valid (READY, or market closed with valid closed candles)')}
      <i>→</i>
      {box(c?.directional, 'Regime directional', 'Stage 4', 'Non-neutral base/quote differential with classified regimes', c ? `Stage 4 · ${c.promoted} promoted` : undefined)}
      <i>→</i>
      {box(channelQualified, 'Channel qualified', 'Stage 5/6 (read only)', 'Promoted instruments with a confirmed D1 channel on READY data in HTF Market Vision')}
      <i>→</i>
      {box(h1Ready, 'H1 ready', 'Stage 7 (read only)', 'Channel-qualified instruments whose H1 confirmation state is READY after the Stage 1 gate')}
    </div>
  );
}

/* ------------------------------------------------------------------ thresholds */

const FIELDS: { key: string; label: string; step: number }[] = [
  { key: 'promotion.minConviction', label: 'Promote at conviction ≥', step: 1 },
  { key: 'promotion.minConfidence', label: 'Min regime confidence', step: 1 },
  { key: 'promotion.minPersistence', label: 'Min persistence %', step: 1 },
  { key: 'promotion.hysteresis', label: 'Demotion hysteresis', step: 0.5 },
  { key: 'qualifyConviction', label: 'Qualified at ≥', step: 1 },
  { key: 'watchConviction', label: 'Watch at ≥', step: 1 },
  { key: 'neutralBand', label: 'Neutral band ±', step: 0.1 },
  { key: 'strongDiff', label: 'Strong differential', step: 0.5 },
];

function engineValue(run: ScannerRun, key: string): number | boolean {
  const e = run.config.engine as unknown as Record<string, unknown>;
  const [a, b] = key.split('.');
  const v = b ? (e[a] as Record<string, unknown>)[b] : e[a];
  return v as number | boolean;
}

function Thresholds({ run, busy }: { run: ScannerRun; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [closed, setClosed] = useState<boolean>(run.config.engine.promotion.promoteWhenMarketClosed);
  const [msg, setMsg] = useState('');
  const overrides = run.config.overrides ?? {};

  useEffect(() => {
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(engineValue(run, f.key))])));
    setClosed(run.config.engine.promotion.promoteWhenMarketClosed);
  }, [run.config]);

  const save = async (reset: boolean) => {
    setMsg('');
    const next: Record<string, number | boolean> = {};
    if (!reset) {
      for (const f of FIELDS) {
        const v = Number(draft[f.key]);
        if (!Number.isFinite(v)) {
          setMsg(`${f.label}: not a number`);
          return;
        }
        next[f.key] = v;
      }
      next['promotion.promoteWhenMarketClosed'] = closed;
    }
    const err = await applyScannerConfig(next);
    setMsg(err ? `Rejected by the bridge: ${err}` : reset ? 'Defaults restored · re-ranked' : 'Saved to db_Cacsms-Trader · re-ranked');
  };

  const p = run.config.engine.promotion;
  return (
    <Card className="ms-thresholds">
      <button type="button" className="ms-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={14} />
        <b>Promotion thresholds</b>
        <span className="muted">
          conviction ≥ {p.minConviction} · confidence ≥ {p.minConfidence} · persistence ≥ {p.minPersistence}% · reject {p.rejectAlignments.map(human).join(' / ')}
          {p.promoteWhenMarketClosed ? ' · closed-market promotion structural only' : ' · no promotion while market closed'}
          {Object.keys(overrides).length ? ' · operator overrides active' : ' · defaults'}
        </span>
      </button>
      {open && (
        <div className="ms-form">
          {FIELDS.map((f) => {
            const [lo, hi] = run.config.tunable?.[f.key] ?? [0, 100];
            return (
              <label key={f.key}>
                <span>{f.label}</span>
                <input
                  type="number"
                  min={lo}
                  max={hi}
                  step={f.step}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  aria-label={f.label}
                />
                <small className="muted">
                  {lo}–{hi}
                </small>
              </label>
            );
          })}
          <label className="ms-check">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            <span>Promote on valid closed candles while the FX market is closed (structural analysis only; live execution stays gated)</span>
          </label>
          <div className="ms-form-actions">
            <button type="button" className="hr-run" disabled={busy} onClick={() => void save(false)}>
              Save &amp; re-rank
            </button>
            <button type="button" className="hr-run" disabled={busy || !Object.keys(overrides).length} onClick={() => void save(true)}>
              Reset to defaults
            </button>
            {msg && <span className={msg.startsWith('Rejected') ? 'negative' : 'muted'}>{msg}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ drawer */

function LegColumn({ leg, role }: { leg: AssetLeg | null; role: string }) {
  if (!leg) return <p className="hr-reason">{role}: no Stage 2/3 strength observation.</p>;
  const rows: [string, ReactNode][] = [
    ['Composite (Stage 2)', signed(leg.composite)],
    ['Macro (Q+M)', signed(leg.macro)],
    ['Current (W+D)', signed(leg.current)],
    ['Momentum', signed(leg.momentum)],
    ['Acceleration', signed(leg.acceleration)],
    ['Trajectory', human(leg.trajectory)],
    ['Regime (Stage 3)', `${leg.regime ?? 'warming up'} · ${human(leg.group)}`],
    ['Regime confidence', num(leg.confidence, 0)],
    ['Persistence', `${num(leg.persistence, 0)}%`],
    ['Regime duration', `${leg.durationObs} obs`],
    ['Closed D1', leg.date ?? '—'],
  ];
  return (
    <div>
      <h4 className="hr-sub">
        {role} · <b className={leg.asset === 'XAU' ? 'hr-gold' : undefined}>{leg.asset}</b>
      </h4>
      <div className="kv ms-kv">
        {rows.map(([k, v]) => (
          <div key={k} className="ms-kv-row">
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentBars({ i }: { i: ScannerInstrument }) {
  const conf = i.confidence ?? 0;
  return (
    <>
      <div className="table-wrap">
        <table className="cs-table ms-components">
          <thead>
            <tr>
              <th>Component</th>
              <th>Points</th>
              <th>Contribution</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {i.components.map((c) => {
              const w = Math.min(100, (Math.abs(c.points) / Math.max(1, c.max)) * 100);
              return (
                <tr key={c.key}>
                  <td>
                    <b>{c.label}</b>
                  </td>
                  <td className={c.points > 0 ? 'positive' : c.points < 0 ? 'negative' : undefined}>
                    {signed(c.points, 1)} / {c.max}
                  </td>
                  <td>
                    <div className="ms-bar">
                      <i className={c.points < 0 ? 'neg' : ''} style={{ width: `${w}%` }} />
                    </div>
                  </td>
                  <td className="hv-wrap">{c.detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hr-reason">
        Raw score {num(i.rawScore, 1)} (clamped 0–100) × (0.5 + 0.5 × regime confidence {num(conf, 1)} / 100) = conviction <b>{num(i.conviction, 1)}</b>
        {i.direction === 'NEUTRAL' ? ' · capped for a NEUTRAL bias' : ''}. Bias{' '}
        <b>{human(i.direction)}</b>: |differential| {num(Math.abs(i.differential ?? 0))} vs neutral band ±{i.params?.neutralBand ?? '—'}; STRONG needs ≥{' '}
        {i.params?.strongDiff ?? '—'} with aligned regimes.
      </p>
    </>
  );
}

function ScannerDrawer({ symbol, version, onClose }: { symbol: string; version: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ScannerDetail | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'Ranking' | 'Base vs quote' | 'Promotion' | 'History'>('Ranking');

  useEffect(() => {
    let cancelled = false;
    setErr('');
    fetchScannerDetail(symbol)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Detail unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, version]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const i = detail?.instrument;
  return (
    <div className="md-overlay" onClick={onClose}>
      <aside className="md-drawer hr-drawer ms-drawer" role="dialog" aria-modal="true" aria-label={`${symbol} ranking explanation`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <small>STAGE 4 · RANKING EXPLANATION</small>
            <h2>
              {symbol} {i && <Badge tone={stateTone(i.state)}>{human(i.state)}</Badge>} {i && <Badge tone={directionTone(i.direction)}>{human(i.direction)}</Badge>}
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
          {!detail && !err && <p className="hr-reason">Loading persisted ranking…</p>}
          {detail && !i && <p className="hr-reason">{symbol} has not been ranked yet.</p>}
          {i && (
            <>
              <div className="md-kpi">
                <div>
                  <span>Rank</span>
                  <b>
                    #{i.rank} / {allPairs.length}
                  </b>
                </div>
                <div>
                  <span>Conviction</span>
                  <b>{num(i.conviction, 1)}</b>
                </div>
                <div>
                  <span>Differential</span>
                  <b>{signed(i.differential)}</b>
                </div>
                <div>
                  <span>Confidence</span>
                  <b>{num(i.confidence, 0)}</b>
                </div>
              </div>
              <p className="hr-reason">{i.reason}</p>
              {i.model === 'XAU_DEDICATED' && (
                <div className="hr-banner">
                  <span>
                    XAUUSD uses the dedicated XAU model: gold strength against the 8-currency basket, scaled on its own volatility (not pooled with fiat), with a wider neutral band (±
                    {i.params?.neutralBand}) and strong threshold ({i.params?.strongDiff}).
                  </span>
                </div>
              )}
              <Tabs items={['Ranking', 'Base vs quote', 'Promotion', 'History']} active={tab} onChange={(x) => setTab(x as typeof tab)} idPrefix="ms-dd" label="Explanation section" />
              {tab === 'Ranking' && (i.components.length ? <ComponentBars i={i} /> : <p className="hr-reason">No component scores — {i.reason}</p>)}
              {tab === 'Base vs quote' && (
                <>
                  <div className="kv ms-rel">
                    <span>Relationship</span>
                    <b>
                      {human(i.relationship)} · {human(i.alignment)}
                    </b>
                    <span>Differential (base − quote)</span>
                    <b>
                      {signed(i.differential)} · macro {signed(i.macroDifferential)} · current {signed(i.currentDifferential)}
                    </b>
                    <span>Macro bias</span>
                    <b>{human(i.macroBias)}</b>
                    <span>Trajectory / acceleration</span>
                    <b>
                      {human(i.trajectory)} (momentum Δ {signed(i.momentumDifferential)}) · {human(i.acceleration)} (Δ {signed(i.accelerationDifferential)})
                    </b>
                    <span>Persistence</span>
                    <b>{num(i.persistence, 1)}%</b>
                  </div>
                  <div className="ms-legs">
                    <LegColumn leg={i.base} role="Base" />
                    <LegColumn leg={i.quote} role="Quote" />
                  </div>
                </>
              )}
              {tab === 'Promotion' && (
                <>
                  <div className="kv ms-rel">
                    <span>Decision</span>
                    <b>
                      <Badge tone={i.state === 'PROMOTED' ? 'green' : 'gray'}>{i.state === 'PROMOTED' ? 'PROMOTED TO HTF MARKET VISION' : 'NOT PROMOTED'}</Badge>
                      {i.promotedAt ? <small className="muted"> since {new Date(i.promotedAt).toLocaleString()}</small> : null}
                    </b>
                    <span>Conviction threshold</span>
                    <b>{i.promotion.threshold != null ? `≥ ${i.promotion.threshold}` : '—'}</b>
                    <span>{i.state === 'PROMOTED' ? 'Why promoted' : 'Rejection / block reason'}</span>
                    <b className="hv-wrap">{i.state === 'PROMOTED' ? i.promotion.reason : i.reason}</b>
                    <span>Live execution eligible</span>
                    <b>{i.promotion.liveEligible ? 'Yes — Stage 1 READY with a fresh live quote' : `No — Stage 1 ${human(i.stage1.status)}`}</b>
                  </div>
                  <h4 className="hr-sub">Promotion rules</h4>
                  <ul className="ms-rules">
                    {i.promotion.rules.map((r) => (
                      <li key={r.key} className={r.pass ? 'pass' : 'fail'}>
                        {r.pass ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                        <b>{r.label}</b>
                        <span>{r.detail}</span>
                      </li>
                    ))}
                    {!i.promotion.rules.length && <li className="fail">{i.promotion.reason}</li>}
                  </ul>
                  <h4 className="hr-sub">Data readiness &amp; freshness</h4>
                  <div className="kv ms-rel">
                    <span>Stage 1</span>
                    <b>
                      <Badge tone={stage1Tone(i.stage1.status)}>{human(i.stage1.status)}</Badge> <small className="muted">{i.stage1.reason}</small>
                    </b>
                    {Object.entries(i.stage1.timeframes ?? {}).map(([tf, t]) => (
                      <FragmentRow key={tf} k={`${tf} history`} v={`${human(t.status)} · ${t.reason}`} />
                    ))}
                    <span>Live quote</span>
                    <b>
                      {i.stage1.marketOpen ? 'Market open' : 'Market closed'} · {i.stage1.quoteValid ? 'valid bid/ask' : 'no valid bid/ask'}
                      {i.stage1.tickAgeSec != null ? ` · last tick ${i.stage1.tickAgeSec}s ago` : ''}
                    </b>
                    <span>Strength freshness</span>
                    <b>
                      <Badge tone={i.freshness.status === 'CURRENT' ? 'green' : 'amber'}>{i.freshness.status}</Badge> <small className="muted">{i.freshness.reason}</small>
                    </b>
                  </div>
                  {!!i.evidence?.length && (
                    <>
                      <h4 className="hr-sub">Evidence published to HTF Market Vision</h4>
                      <ul className="hv-list">
                        {i.evidence.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {tab === 'History' && (
                <>
                  <h4 className="hr-sub">Promotion history</h4>
                  <PromotionTable rows={detail.promotions} />
                  <h4 className="hr-sub">Ranking snapshots</h4>
                  <div className="table-wrap">
                    <table className="cs-table">
                      <thead>
                        <tr>
                          <th>Snapshot</th>
                          <th>Rank</th>
                          <th>State</th>
                          <th>Bias</th>
                          <th>Conviction</th>
                          <th>Differential</th>
                          <th>Stage 1</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...detail.history].reverse().map((h) => (
                          <tr key={h.runAt}>
                            <td>{new Date(h.runAt).toLocaleString()}</td>
                            <td>#{h.rank}</td>
                            <td>
                              <Badge tone={stateTone(h.state)}>{human(h.state)}</Badge>
                            </td>
                            <td>
                              <Badge tone={directionTone(h.direction)}>{human(h.direction)}</Badge>
                            </td>
                            <td>{num(h.conviction, 1)}</td>
                            <td>{signed(h.differential)}</td>
                            <td>{human(h.stage1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!detail.history.length && <p className="hr-reason">No ranking snapshots yet.</p>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <b className="hv-wrap">{v}</b>
    </>
  );
}

function PromotionTable({ rows, onSymbol }: { rows: ScannerDetail['promotions']; onSymbol?: (s: string) => void }) {
  if (!rows.length) return <p className="hr-reason">No promotions or demotions recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="cs-table">
        <thead>
          <tr>
            <th>Time</th>
            {onSymbol && <th>Instrument</th>}
            <th>Action</th>
            <th>Bias</th>
            <th>Conviction</th>
            <th>Differential</th>
            <th>Relationship</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{new Date(p.createdAt).toLocaleString()}</td>
              {onSymbol && (
                <td>
                  <button type="button" className="cs-link" onClick={() => onSymbol(p.symbol)}>
                    {p.symbol}
                  </button>
                </td>
              )}
              <td>
                <Badge tone={p.action === 'PROMOTED' ? 'green' : 'amber'}>{p.action}</Badge>
              </td>
              <td>
                <Badge tone={directionTone(p.direction)}>{human(p.direction)}</Badge>
              </td>
              <td>{num(p.conviction, 1)}</td>
              <td>{signed(p.differential)}</td>
              <td>{human(p.relationship)}</td>
              <td className="hv-wrap">{p.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

type SortKey = 'rank' | 'symbol' | 'conviction' | 'differential' | 'confidence';
const STATE_FILTERS: ('All' | ScannerState)[] = ['All', 'PROMOTED', 'QUALIFIED', 'WATCH', 'NEUTRAL', 'BLOCKED', 'STALE', 'INSUFFICIENT_DATA'];
const DIR_FILTERS = ['All', 'Bullish', 'Bearish', 'Neutral'] as const;
const CONV_FILTERS = [0, 25, 45, 55, 70];
const REL_FILTERS = ['All', 'STRONG_VS_WEAK', 'WEAK_VS_STRONG', 'BASE_LED', 'QUOTE_LED', 'SIMILAR', 'MIXED', 'WARMING_UP'];
const S1_FILTERS: ('All' | Stage1Readiness)[] = ['All', 'READY', 'CLOSED', 'STALE', 'BLOCKED', 'INSUFFICIENT_DATA'];

const dirMatch = (d: string, f: (typeof DIR_FILTERS)[number]) =>
  f === 'All' || (f === 'Bullish' ? d.endsWith('BULLISH') : f === 'Bearish' ? d.endsWith('BEARISH') : d === 'NEUTRAL');

export function MarketScannerPage({ children }: { children?: ReactNode }) {
  const { instruments, selected, setSelected } = useTrading();
  const store = useScannerStore();
  const vision = useVisionStore();
  const autonomy = useAutonomyState();
  const [now, setNow] = useState(Date.now());
  const [query, setQuery] = useState('');
  const [stateF, setStateF] = useState<(typeof STATE_FILTERS)[number]>('All');
  const [dirF, setDirF] = useState<(typeof DIR_FILTERS)[number]>('All');
  const [convF, setConvF] = useState(0);
  const [relF, setRelF] = useState('All');
  const [s1F, setS1F] = useState<(typeof S1_FILTERS)[number]>('All');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rank', desc: false });
  const [drawer, setDrawer] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => startScannerStore(), []);
  useEffect(() => startVisionStore(), []);
  useEffect(() => startAutonomyStore(), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const run = store.state?.run ?? null;
  const list = store.state?.instruments ?? [];
  const status = scannerStageStatus(store, now);
  const age = scannerRunAgeMs(store, now);

  const channelSet = useMemo(
    () => new Set((vision.state?.instruments ?? []).filter((v) => v.scanner?.qualified && v.status === 'READY' && v.d1?.confirmed).map((v) => v.symbol)),
    [vision.state],
  );
  const h1Ready = instruments.filter((i) => channelSet.has(i.symbol) && gatedState(i) === 'READY').length;

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    const rows = list.filter(
      (i) =>
        (!q || i.symbol.includes(q)) &&
        (stateF === 'All' || i.state === stateF) &&
        dirMatch(i.direction, dirF) &&
        (convF === 0 || (i.conviction ?? 0) >= convF) &&
        (relF === 'All' || i.relationship === relF) &&
        (s1F === 'All' || i.stage1?.status === s1F),
    );
    const val = (i: ScannerInstrument): number | string =>
      sort.key === 'symbol' ? i.symbol : sort.key === 'rank' ? i.rank : sort.key === 'differential' ? Math.abs(i.differential ?? 0) : (i[sort.key] ?? -1);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [list, query, stateF, dirF, convF, relF, s1F, sort]);

  const filterKey = `${query}|${stateF}|${dirF}|${convF}|${relF}|${s1F}|${sort.key}|${sort.desc}|${shown.length}`;
  useEffect(() => setPage(0), [filterKey]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = shown.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const th = (key: SortKey, label: string, title?: string) => (
    <th title={title} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className="ms-sort"
        onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'rank' && key !== 'symbol' })}
      >
        {label}
        {sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  const open = (s: string) => {
    setSelected(s);
    setDrawer(s);
  };
  const drawerRow = list.find((i) => i.symbol === drawer);

  return (
    <div className="ms-page">
      <PageHeader title="Market Scanner" subtitle="Ranks all 28 FX combinations plus XAUUSD and promotes the best candidates" />
      <div className="hr-status">
        <Badge tone={status === 'HEALTHY' ? 'green' : status === 'DEGRADED' || status === 'STALE' ? 'amber' : status === 'ERROR' ? 'red' : 'gray'}>STAGE 4 {status}</Badge>
        <span>{run?.message ?? (store.loading ? 'Loading persisted Stage 4 state…' : 'No Stage 4 run recorded yet')}</span>
        {age != null && (
          <span className="muted">
            Last re-rank {ageText(run?.runAt, now)}
            {run?.triggers?.length ? ` · ${run.triggers.slice(0, 4).join(', ')}` : ''}
            {run?.durationMs != null ? ` · ${run.durationMs} ms` : ''}
          </span>
        )}
        {run && (
          <span className="muted">
            Autonomous bridge loop {run.config.service.loopSec}s · sweep {Math.round(run.config.service.fullEverySec / 60)}m · Stage 3 {run.regimeStatus ?? '—'} · latest closed D1 {run.expectedD1 ?? '—'}
          </span>
        )}
        <button type="button" className="hr-run" title="Diagnostic reprocess. Ranking already runs from strength, regime and candle events." disabled={store.running} onClick={() => void runScannerNow()}>
          <RefreshCw size={14} className={store.running ? 'hr-spin' : undefined} />
          {store.running ? 'Ranking…' : 'Re-rank now'}
        </button>
      </div>
      <Card>
        <div className="card-head">
          <div>
            <h3>Multi-resolution scan</h3>
            <p>Every instrument is assessed for normal continuation and Trend-in-Trend. Rank still prioritises attention. It does not hide a nested structure.</p>
          </div>
          <Badge tone={autonomy?.opportunity?.summary ? 'green' : 'gray'}>{autonomy?.opportunity?.run?.status ?? 'WAITING'}</Badge>
        </div>
        <p className="hr-reason">
          {autonomy?.opportunity?.summary
            ? `${autonomy.opportunity.summary.scanned}/${autonomy.opportunity.summary.universe} scanned · normal ${autonomy.opportunity.summary.normal} · TiT ${autonomy.opportunity.summary.tit} · L1 ${autonomy.opportunity.summary.L1} · L2 ${autonomy.opportunity.summary.L2} · L3 ${autonomy.opportunity.summary.L3} · L4 ${autonomy.opportunity.summary.L4} · XAU ${autonomy.opportunity.summary.xau}`
            : 'The opportunity engine has not published a scan yet. It runs on the bridge, not in this page.'}
        </p>
        <p className="hr-reason">
          {autonomy?.opportunity?.summary?.funnel
            ? `Scanned ${autonomy.opportunity.summary.funnel.scanned} · hypotheses ${autonomy.opportunity.summary.funnel.hypotheses} · watching ${autonomy.opportunity.summary.funnel.watching} · ERZ ${autonomy.opportunity.summary.funnel.erzActive} · P1 ready ${autonomy.opportunity.summary.funnel.p1Ready} · P2 ready ${autonomy.opportunity.summary.funnel.p2Ready} · wait retest ${autonomy.opportunity.summary.funnel.waitRetest} · actionable ${autonomy.opportunity.summary.funnel.actionable}`
            : 'Funnel counts appear after the first bridge scan.'}
        </p>
        <p className="hr-reason">
          {autonomy?.opportunity?.summary?.blockers && Object.keys(autonomy.opportunity.summary.blockers).length
            ? `Campaign reason ${Object.entries(autonomy.opportunity.summary.blockers).map(([k, n]) => `${k} ${n}`).join(' · ')}`
            : 'No blocker counts yet. A hypothesis that is not an entry keeps its campaign reason. P1 and P2 are listed separately below.'}
        </p>
        <p className="hr-reason">
          {autonomy?.opportunity?.summary?.legs
            ? `P1 ${Object.entries(autonomy.opportunity.summary.legs.p1 ?? {}).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'} · P2 ${Object.entries(autonomy.opportunity.summary.legs.p2 ?? {}).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`
            : 'P1 and P2 reasons appear after the next bridge scan.'}
        </p>
        <XauWatch autonomy={autonomy} />
        <HypothesisLocations rows={autonomy?.opportunity?.instruments} />
      </Card>
      {store.error && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>{store.error} — Stage 4 promotions are not published while the bridge is unreachable.</span>
        </div>
      )}
      {status === 'STALE' && !store.error && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stage 4 output is stale ({ageText(run?.runAt, now)}): the bridge scanner has not re-ranked within 15 minutes.</span>
        </div>
      )}
      {run && !run.providerOk && (
        <div className="hr-banner err">
          <AlertTriangle size={14} />
          <span>MT5 provider offline — every instrument is Stage 1 BLOCKED; the last intelligence stays visible but nothing is promoted.</span>
        </div>
      )}
      {run && run.providerOk && !run.marketOpen && (
        <div className="hr-banner">
          <span>
            FX market closed — rankings use the latest closed D1 ({run.expectedD1 ?? '—'}).{' '}
            {run.config.engine.promotion.promoteWhenMarketClosed
              ? 'Promotions feed structural HTF analysis only and are not live-execution eligible until Stage 1 sees fresh quotes.'
              : 'Promotion is suspended until the market reopens.'}
          </span>
        </div>
      )}
      {run?.configError && (
        <div className="hr-banner warn">
          <AlertTriangle size={14} />
          <span>Stored thresholds rejected ({run.configError}); defaults in use.</span>
        </div>
      )}

      <Funnel run={run} channelQualified={vision.state ? channelSet.size : null} h1Ready={vision.state ? h1Ready : null} />

      {run && <Thresholds run={run} busy={store.running} />}

      <Card>
        <div className="card-head">
          <div>
            <h3>Regime Conviction Ranking</h3>
            <p>
              Stage 4 ranking from Stage 1 readiness, Stage 2 strength and Stage 3 regimes · differential, regime alignment, trajectory, persistence and confidence · click a row
              for the full explanation
            </p>
          </div>
          <Badge tone={list.length ? 'green' : 'gray'}>
            {shown.length}/{list.length || allPairs.length} shown
          </Badge>
        </div>
        <div className="ms-toolbar">
          <label className="hv-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instrument" aria-label="Search instrument" />
          </label>
          <label className="ms-select">
            <span>Direction</span>
            <select value={dirF} onChange={(e) => setDirF(e.target.value as typeof dirF)}>
              {DIR_FILTERS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="ms-select">
            <span>Conviction</span>
            <select value={convF} onChange={(e) => setConvF(Number(e.target.value))}>
              {CONV_FILTERS.map((c) => (
                <option key={c} value={c}>
                  {c === 0 ? 'Any' : `≥ ${c}`}
                </option>
              ))}
            </select>
          </label>
          <label className="ms-select">
            <span>Relationship</span>
            <select value={relF} onChange={(e) => setRelF(e.target.value)}>
              {REL_FILTERS.map((r) => (
                <option key={r} value={r}>
                  {r === 'All' ? 'All' : human(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="ms-select">
            <span>Stage 1</span>
            <select value={s1F} onChange={(e) => setS1F(e.target.value as typeof s1F)}>
              {S1_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === 'All' ? 'All' : human(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hr-chips" role="group" aria-label="Promotion status">
          {STATE_FILTERS.map((s) => (
            <button key={s} type="button" className={stateF === s ? 'on' : ''} style={{ borderColor: '#2b4d6e', color: '#cfe3f7' }} onClick={() => setStateF(s)}>
              {human(s)} <small>{s === 'All' ? list.length : list.filter((i) => i.state === s).length}</small>
            </button>
          ))}
        </div>
        {!list.length ? (
          <div className="empty-block">
            <b>{store.loading ? 'Loading…' : 'No Stage 4 ranking published'}</b>
            <span>{store.error || 'The bridge ranks the universe on startup once Stage 3 has classified the regimes.'}</span>
          </div>
        ) : (
          <div className="table-wrap">
            <RankPager page={safePage} pages={pages} total={shown.length} onPage={setPage} />
            <table className="cs-table ms-table">
              <thead>
                <tr>
                  {th('rank', '#')}
                  {th('symbol', 'Instrument')}
                  <th>State</th>
                  <th title="Five-level bias from the base − quote differential">Bias</th>
                  {th('differential', 'Differential', 'Base composite minus quote composite (sorted by magnitude)')}
                  {th('conviction', 'Conviction', 'Component score weighted by regime confidence (0–100)')}
                  {th('confidence', 'Conf.', 'Mean Stage 3 regime confidence of both legs')}
                  <th>Relationship</th>
                  <th>Base · Quote regime</th>
                  <th title="Stage 2 composite strength (base · quote)">Stage 2 strength</th>
                  <th>Fresh</th>
                  <th title="Stage 1 data readiness evaluated by the bridge">Stage 1</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((i) => (
                  <tr key={i.symbol} className={`hr-click ${selected === i.symbol ? 'cs-focus' : ''}`} onClick={() => open(i.symbol)} title={i.reason}>
                    <td>{i.rank}</td>
                    <td>
                      <b className={i.symbol === 'XAUUSD' ? 'hr-gold' : undefined}>{i.symbol}</b>
                    </td>
                    <td>
                      <Badge tone={stateTone(i.state)}>{human(i.state)}</Badge>
                    </td>
                    <td>
                      <Badge tone={directionTone(i.direction)}>{human(i.direction)}</Badge>
                    </td>
                    <td className={(i.differential ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(i.differential)}</td>
                    <td>
                      <Conviction i={i} />
                    </td>
                    <td>{num(i.confidence, 0)}</td>
                    <td>
                      <small>{human(i.relationship)}</small>
                      <small className="hr-rel ms-block">{human(i.alignment)}</small>
                    </td>
                    <td>
                      <small>
                        {i.base?.regime ?? '—'} · {i.quote?.regime ?? '—'}
                      </small>
                    </td>
                    <td>
                      <small>
                        {i.baseAsset} {signed(i.base?.composite, 1)} · {i.quoteAsset} {signed(i.quote?.composite, 1)}
                      </small>
                    </td>
                    <td>
                      <Badge tone={i.freshness?.status === 'CURRENT' ? 'green' : 'amber'}>{i.freshness?.status ?? '—'}</Badge>
                    </td>
                    <td title={i.stage1?.reason}>
                      <Badge tone={stage1Tone(i.stage1?.status)}>{human(i.stage1?.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <RankPager page={safePage} pages={pages} total={shown.length} onPage={setPage} />
            {!shown.length && <p className="hr-reason">No instrument matches these filters.</p>}
          </div>
        )}
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Promotion History</h3>
            <p>Every promotion to and demotion from HTF Market Vision, with the evidence at that moment · persisted in dbo.app_scanner_promotion</p>
          </div>
          <Badge tone="blue">{store.state?.snapshots.length ?? 0} recent snapshots</Badge>
        </div>
        <PromotionTable rows={store.state?.promotions ?? []} onSymbol={open} />
      </Card>

      {children}

      {drawer && <ScannerDrawer symbol={drawer} version={`${drawerRow?.updatedAt ?? ''}|${drawerRow?.runId ?? ''}`} onClose={() => setDrawer(null)} />}
    </div>
  );
}
