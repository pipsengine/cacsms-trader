import { useEffect, useRef, useState } from 'react';
import type { ChannelAnalysisEvent, ChannelSnapshot, InstrumentChannelState } from '../types';
import {
  atr,
  barTime,
  currentView,
  dirClass,
  geometryWord,
  human,
  isContext,
  isoAge,
  isValid,
  num,
  pct,
  REL_LABEL,
  relTone,
  statusLabel,
  statusTone,
  TF_LABEL,
} from '../format';
import { ChannelChart } from './ChannelChart';

const TABS = ['CHART', 'TOUCHES', 'EVENTS', 'EVIDENCE'] as const;
type Tab = (typeof TABS)[number];

type Props = {
  channel: ChannelSnapshot;
  state: InstrumentChannelState;
  events: ChannelAnalysisEvent[];
  onClose: () => void;
  onReanalyse: () => void;
  reanalysing: boolean;
  canReanalyse: boolean;
};

export function ChannelDetailModal({ channel, state, events, onClose, onReanalyse, reanalysing, canReanalyse }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('CHART');
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  const c = channel;
  const valid = isValid(c);
  const d = c.digits;
  const g = c.evidence.geometry;
  const view = currentView(c);
  const parent = c.relationshipVia ? state.channels[c.relationshipVia] : null;
  const tfEvents = events.filter((e) => e.timeframe === c.timeframe);
  const life = state.lifecycle[c.timeframe] ?? [];

  const stats: [string, string][] = [
    ['Status', statusLabel(c)],
    ['Direction', valid ? c.direction : c.status === 'FORMING' ? `${c.direction} (lean)` : '—'],
    ['Geometry', g && c.trend ? `${geometryWord(c.trend)} channel` : '—'],
    ['Relationship', REL_LABEL[c.relationship]],
    ['Confidence', valid || c.status === 'FORMING' ? pct(c.confidence) : '—'],
    [`Position${view.isLive ? ' (live)' : ''}`, valid ? pct(view.position) : '—'],
    ['Phase', human(c.phase)],
    ['Upper', valid ? num(c.upperBoundary, d) : '—'],
    ['Midline', valid ? num(c.midline, d) : '—'],
    ['Lower', valid ? num(c.lowerBoundary, d) : '—'],
    ['To upper', valid ? atr(view.distanceUpperAtr) : '—'],
    ['To lower', valid ? atr(view.distanceLowerAtr) : '—'],
    ['Width', g ? `${g.widthAtr.toFixed(2)} ATR` : '—'],
    ['Slope / bar', g ? g.slopePerBar.toExponential(2) : '—'],
    ['Slope (ATR/20)', g ? g.slopeAtr20.toFixed(2) : '—'],
    ['Parallel error', g?.parallelismError != null ? g.parallelismError.toFixed(3) : 'unverified'],
    ['Touch quality', g ? pct(g.touchQuality) : '—'],
    ['Last closed candle', barTime(c.lastCandleTime, c.timeframe)],
    ['Data', `${human(c.dataStatus)} · ${c.bars}/${c.requiredBars} bars`],
  ];
  if (c.window) stats.push(['Window', `${c.window.label} · ${c.window.bars} ${c.window.sourceTimeframe} bars`]);

  return (
    <div
      className="ca-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-modal-title" tabIndex={-1} ref={ref}>
        <header>
          <div>
            <small>
              {c.instrument} · {TF_LABEL[c.timeframe]} ({c.timeframe}) · source {c.sourceTimeframe} · ← → switch timeframe
            </small>
            <h2 id="ca-modal-title">
              <span className={`ca-pill ${dirClass(valid ? c.direction : 'UNKNOWN')}`}>{valid ? c.direction : 'NONE'}</span>{' '}
              {valid ? `${TF_LABEL[c.timeframe]} channel evidence` : `${TF_LABEL[c.timeframe]} — ${statusLabel(c)}`}
            </h2>
          </div>
          <div className="ca-modal-actions">
            <button type="button" onClick={onReanalyse} disabled={reanalysing || !canReanalyse} title="Diagnostic: forces a recalculation on the bridge engine">
              {reanalysing ? 'Queued…' : `Re-analyse ${c.timeframe}`}
            </button>
            <button type="button" onClick={onClose} aria-label="Close channel detail">
              ✕
            </button>
          </div>
        </header>
        <nav role="tablist" aria-label="Channel evidence">
          {TABS.map((t) => (
            <button type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
              {t}
              {t === 'TOUCHES' ? ` (${c.evidence.touches.length})` : t === 'EVENTS' ? ` (${c.evidence.events.length + tfEvents.length})` : ''}
            </button>
          ))}
        </nav>

        {tab === 'CHART' && (
          <div role="tabpanel">
            {!valid && (
              <div className="ca-novalid wide">
                <b>{c.status === 'FORMING' ? 'FORMING — NOT YET VALID' : 'NO VALID CHANNEL'}</b>
                <span>{c.reason.replace(/^NO VALID CHANNEL — /, '')}</span>
              </div>
            )}
            <ChannelChart channel={c} height={390} detail />
            <div className="ca-touch-legend">
              <span><i style={{ background: '#ffd468' }} />Touch #1 anchor</span>
              <span><i style={{ background: '#ffa94d' }} />#2 candidate</span>
              <span><i style={{ background: '#31dfa1' }} />#3 validation</span>
              <span><i style={{ background: '#59b9ff' }} />confirmation</span>
              <span><i style={{ background: '#c49bff' }} />opposite boundary</span>
              <span><i className="swing" />confirmed swing</span>
            </div>
            <div className="ca-detail-grid">
              {stats.map(([k, v]) => (
                <div key={k}>
                  <small>{k}</small>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <section className="ca-relation">
              <h4>Parent / child relationship</h4>
              <p>
                <span className={`ca-rel ${relTone(c.relationship)}`}>{REL_LABEL[c.relationship]}</span>{' '}
                {c.relationshipReason || 'No relationship evaluated.'}
              </p>
              <dl>
                <div>
                  <dt>Related to</dt>
                  <dd>
                    {parent
                      ? `${parent.timeframe} ${parent.direction.toLowerCase()} channel (${statusLabel(parent)}, ${pct(parent.confidence)})`
                      : c.relationship === 'PRIMARY'
                        ? isContext(c)
                          ? 'No valid channel above this context (strategic context, not scored)'
                          : 'Highest valid channel in the hierarchy'
                        : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Correction depth</dt>
                  <dd>{c.correctionDepth == null ? '—' : c.correctionDepth === 0 ? 'Trend (0)' : String(c.correctionDepth)}</dd>
                </div>
                <div>
                  <dt>Channel id</dt>
                  <dd className="mono">{c.channelId ?? '—'}</dd>
                </div>
                <div>
                  <dt>Parent channel id</dt>
                  <dd className="mono">{c.parentChannelId ?? '—'}</dd>
                </div>
              </dl>
            </section>
          </div>
        )}

        {tab === 'TOUCHES' && (
          <div role="tabpanel" className="ca-table-wrap">
            {c.evidence.touches.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Touch</th>
                    <th>Boundary</th>
                    <th>Bar</th>
                    <th>Price</th>
                    <th>Line</th>
                    <th>Deviation</th>
                    <th>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {c.evidence.touches.map((t) => (
                    <tr key={t.id}>
                      <td>{t.label}</td>
                      <td>{t.boundary}</td>
                      <td>{barTime(t.time, c.timeframe)}</td>
                      <td>{num(t.price, d)}</td>
                      <td>{num(t.line, d)}</td>
                      <td>{atr(t.deviationAtr)}</td>
                      <td>{pct(t.quality * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="ca-empty">No boundary touches — {c.reason.replace(/^NO VALID CHANNEL — /, '')}</div>
            )}
          </div>
        )}

        {tab === 'EVENTS' && (
          <div role="tabpanel" className="ca-events-grid">
            <section>
              <h4>Structural events (closed candles)</h4>
              <div className="ca-event-list">
                {c.evidence.events.length ? (
                  c.evidence.events
                    .slice()
                    .reverse()
                    .map((e) => (
                      <article key={e.id} className={`kind-${e.kind.toLowerCase()}`}>
                        <b>{human(e.kind)}</b>
                        <span>{e.label}</span>
                        <small>
                          {barTime(e.time, c.timeframe)}
                          {e.price != null ? ` · ${num(e.price, d)}` : ''}
                        </small>
                      </article>
                    ))
                ) : (
                  <div className="ca-empty">No structural events for this timeframe.</div>
                )}
              </div>
            </section>
            <section>
              <h4>Engine event log</h4>
              <div className="ca-event-list">
                {tfEvents.length ? (
                  tfEvents.map((e) => (
                    <article key={e.id} className={`sev-${e.severity.toLowerCase()}`}>
                      <b>{human(e.type)}</b>
                      <span>{e.detail}</span>
                      <small>
                        bar {barTime(e.ts * 1000, c.timeframe)} · recorded {isoAge(e.createdAt)}
                      </small>
                    </article>
                  ))
                ) : (
                  <div className="ca-empty">No engine events recorded for {c.timeframe} yet.</div>
                )}
              </div>
              <h4>Channel lifecycle</h4>
              {life.length ? (
                <div className="ca-table-wrap compact">
                  <table>
                    <thead>
                      <tr>
                        <th>Channel</th>
                        <th>Direction</th>
                        <th>First → last status</th>
                        <th>Validated</th>
                        <th>Broken</th>
                        <th>Replaced</th>
                      </tr>
                    </thead>
                    <tbody>
                      {life.map((r) => (
                        <tr key={r.channelId}>
                          <td className="mono">{r.channelId.split(':').slice(2).join(':')}</td>
                          <td>{r.direction}</td>
                          <td>
                            {r.firstStatus} → {r.lastStatus}
                          </td>
                          <td>{r.validatedTs ? barTime(r.validatedTs * 1000, c.timeframe) : '—'}</td>
                          <td>{r.brokenTs ? barTime(r.brokenTs * 1000, c.timeframe) : '—'}</td>
                          <td>{r.replacedAt ? isoAge(r.replacedAt) : 'current'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ca-empty">No channel lifecycle recorded for {c.timeframe}.</div>
              )}
            </section>
          </div>
        )}

        {tab === 'EVIDENCE' && (
          <div role="tabpanel" className="ca-evidence">
            <p>
              {c.evidence.closedCandles} validated closed {c.timeframe} candles
              {c.timeframe === 'Y' || c.timeframe === 'Q' ? ` (aggregated from complete ${c.sourceTimeframe} months)` : ''}
              {c.window
                ? ` (${c.window.definition}: ${c.window.label}, ${c.window.bars} closed ${c.window.sourceTimeframe} candles; ATR warmed on ${c.window.warmupBars} prior bars)`
                : ''}{' '}
              · ATR{' '}
              {num(c.evidence.atr, d)} · {c.evidence.swings.length} confirmed swings · config {c.configVersion} · analysed{' '}
              {new Date(c.analysedAt).toLocaleString()}
            </p>
            {c.scoring.length > 0 && (
              <>
                <h4>Confidence evidence</h4>
                <div className="ca-table-wrap compact">
                  <table>
                    <thead>
                      <tr>
                        <th>Factor</th>
                        <th>Value</th>
                        <th>Points</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.scoring.map((s) => (
                        <tr key={s.factor}>
                          <td>{s.factor}</td>
                          <td>{s.value}</td>
                          <td className={s.points < 0 ? 'neg' : ''}>
                            {s.points.toFixed(1)}
                            {s.max ? ` / ${s.max}` : ''}
                          </td>
                          <td>{s.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {g && (
              <>
                <h4>Geometry</h4>
                <p>
                  Anchor boundary {g.anchorSide.toLowerCase()} · Touch #1 {num(g.anchor.price, d)} ({barTime(g.anchor.time, c.timeframe)}) · Touch #2{' '}
                  {num(g.candidate.price, d)} ({barTime(g.candidate.time, c.timeframe)})
                  {g.validation ? ` · Touch #3 ${num(g.validation.price, d)} (${barTime(g.validation.time, c.timeframe)})` : ' · Touch #3 pending'} · span{' '}
                  {g.spanBars} bars, age {g.ageBars} bars · {g.violations} closes outside ({pct(g.violationShare * 100, 1)}) · next bar upper{' '}
                  {num(g.upperNext, d)} / lower {num(g.lowerNext, d)}
                </p>
              </>
            )}
            {c.breakout && (
              <>
                <h4>Breakout</h4>
                <p>
                  {c.breakout.side === 'UP' ? 'Upside' : 'Downside'} break on {barTime(c.breakout.time, c.timeframe)}
                  {c.breakout.retestTime ? ` · retest ${barTime(c.breakout.retestTime, c.timeframe)}` : ''}
                  {c.breakout.invalidTime ? ` · invalidated ${barTime(c.breakout.invalidTime, c.timeframe)}` : ''}
                </p>
              </>
            )}
            <h4>Invalidation conditions</h4>
            {c.invalidation.length ? c.invalidation.map((x) => <p key={x}>⊘ {x}</p>) : <p>None — no channel to invalidate.</p>}
            <h4>Reasons</h4>
            {c.evidence.reasons.length ? c.evidence.reasons.map((x) => <p key={x}>✓ {x}</p>) : <p>—</p>}
            <h4>Warnings</h4>
            {c.evidence.warnings.length ? c.evidence.warnings.map((x) => <p key={x}>⚠ {x}</p>) : <p>No detector warnings.</p>}
            <h4>Data</h4>
            <p>
              <span className={`ca-status ${statusTone(c.status)}`}>{human(c.dataStatus)}</span> {c.dataReason}
              {c.pendingRecalculation ? ' · newer Stage 1 candles are queued for recalculation' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
