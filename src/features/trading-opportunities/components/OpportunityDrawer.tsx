import { useEffect, useRef } from 'react';
import type { FrameworkHypothesis, FrameworkTransition } from '../../workflow-engine/services/frameworkClient';
import { lifecycleTone } from '../../workflow-engine/services/frameworkClient';
import { STAGE_NAMES } from '../constants';
import { lifecycleDisplay, structureLabel, triggerLabel, visibleStageKeys } from '../utils';
import { OpportunityChart } from './OpportunityChart';

function px(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(5);
}

function stage8Panel(h: FrameworkHypothesis, shadow8?: { setupState?: string; setupReason?: string }) {
  const s8 = h.stages['8'];
  if (h.mode === 'SHADOW') {
    return (
      <>
        <p>
          <strong>SHADOW PRE-QUALIFICATION</strong>
          {shadow8?.setupState ? ` · ${shadow8.setupState}` : ''}
        </p>
        <p className="muted">{shadow8?.setupReason ?? 'Counterfactual Stage 8 — not eligible for execution.'}</p>
        <p className="warn">Execution: NOT ELIGIBLE</p>
      </>
    );
  }
  if (h.mode === 'OBSERVE') {
    return <p className="muted">OBSERVE route — classified and audited; never authorized for capital.</p>;
  }
  if (h.lifecycle === 'READY_FOR_RISK' && (!s8 || s8.status === 'NOT_REACHED')) {
    return <p>Handed to Stage 8 — {h.nextStep}</p>;
  }
  if (s8) {
    return (
      <>
        <p>
          <strong>{s8.status}</strong>
        </p>
        <p className="muted">{s8.detail}</p>
      </>
    );
  }
  return <p className="muted">Not yet evaluated by Stage 8.</p>;
}

export function OpportunityDrawer({
  h,
  shadow8,
  timeline,
  onClose,
  onOpenRisk,
}: {
  h: FrameworkHypothesis;
  shadow8?: { setupState?: string; setupReason?: string };
  timeline: FrameworkTransition[];
  onClose: () => void;
  onOpenRisk: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const room = h.room;
  const extended = h.entryQuality === 'EXTENDED';

  return (
    <>
      <button type="button" className="to-drawer-backdrop" aria-label="Close drawer" onClick={onClose} />
      <aside className="to-drawer" ref={ref} tabIndex={-1} aria-labelledby="to-drawer-title">
        <header className="to-drawer-head">
          <div>
            <h2 id="to-drawer-title">{h.symbol}</h2>
            <p>
              {h.opportunityType} · {h.opportunityName}
            </p>
            <div className="to-drawer-badges">
              <span className={`to-side ${h.side === 'BUY' ? 'buy' : 'sell'}`}>{h.side}</span>
              <span className={`to-mode m-${h.mode.toLowerCase()}`}>{h.mode}</span>
              <span className={`to-life t-${lifecycleTone(h.lifecycle)}`}>{lifecycleDisplay(h.lifecycle)}</span>
              <span className="to-stage">Stage {h.stage}</span>
            </div>
          </div>
          <button type="button" className="to-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="to-drawer-body">
          <section>
            <h3>Structure</h3>
            <dl className="to-dl">
              <dt>Structure</dt>
              <dd>{structureLabel(h)}</dd>
              <dt>Parent / child</dt>
              <dd>
                {h.parentTimeframe ?? '—'} {h.direction} · child {h.childTimeframe ?? '—'}
              </dd>
              <dt>Execution TF</dt>
              <dd>{h.executionTimeframe ?? '—'}</dd>
              <dt>Trigger</dt>
              <dd>{triggerLabel(h.triggerType)}</dd>
              <dt>Detector</dt>
              <dd className="mono">{h.detectorState}</dd>
              {h.TiTLevel && (
                <>
                  <dt>TiT level</dt>
                  <dd>{h.TiTLevel}</dd>
                </>
              )}
              <dt>Campaign</dt>
              <dd className="mono">{h.campaignId ?? '—'}</dd>
              <dt>Episode</dt>
              <dd className="mono">{h.episodeId ?? '—'}</dd>
            </dl>
          </section>

          <OpportunityChart h={h} />

          <section>
            <h3>Confirmation contract</h3>
            <ul className="to-evidence">
              {h.why.map((w, i) => (
                <li key={i} className={`ev-${w.kind.toLowerCase()} ${w.ok === true ? 'ok' : w.ok === false ? 'miss' : 'opt'}`}>
                  <span className="ico">{w.ok === true ? '✓' : w.ok === false ? '✗' : '○'}</span>
                  <span>{w.text}</span>
                  <em>{w.kind.replace(/_/g, ' ')}</em>
                </li>
              ))}
            </ul>
            {h.missingEvidence.length > 0 && (
              <p className="warn">
                Missing required: {h.missingEvidence.join(', ')}
              </p>
            )}
          </section>

          <section>
            <h3>Entry quality</h3>
            {extended && (
              <p className="warn">
                CONFIRMED · EXTENDED — WAIT RETEST
              </p>
            )}
            <dl className="to-dl">
              <dt>Entry</dt>
              <dd>{px(room?.entry)}</dd>
              <dt>Stop / invalidation</dt>
              <dd>{px(room?.invalidation)}</dd>
              <dt>Target</dt>
              <dd>{px(room?.target)}</dd>
              <dt>R:R</dt>
              <dd>{room?.rewardRisk != null ? room.rewardRisk.toFixed(2) : '—'}</dd>
              <dt>Quality</dt>
              <dd>{h.entryQuality ?? '—'}</dd>
            </dl>
          </section>

          <section>
            <h3>Risk / authorization (Stage 8)</h3>
            {stage8Panel(h, shadow8)}
            {h.lifecycle === 'READY_FOR_RISK' || h.lifecycle === 'AUTHORIZED' ? (
              <button type="button" className="to-link-btn" onClick={onOpenRisk}>
                Open Risk &amp; Authorization →
              </button>
            ) : null}
          </section>

          <section>
            <h3>Why this opportunity?</h3>
            <ul className="to-bullets">
              {h.why.filter((w) => w.ok === true).map((w, i) => (
                <li key={i}>✓ {w.text}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Why not ready?</h3>
            {h.whyNotReady.length ? (
              <ul className="to-bullets">
                {h.whyNotReady.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">Next: {h.nextStep}</p>
            )}
          </section>

          <section>
            <h3>Pipeline stages</h3>
            <div className="to-stage-grid">
              {visibleStageKeys(h.stages).map((k) => (
                <div key={k} className="to-stage-card">
                  <span>
                    S{k} · {STAGE_NAMES[k] ?? k}
                  </span>
                  <b>{h.stages[k].status}</b>
                  <small>{h.stages[k].detail}</small>
                </div>
              ))}
            </div>
          </section>

          {timeline.length > 0 && (
            <section>
              <h3>Timeline</h3>
              <ol className="to-timeline">
                {timeline.map((t, i) => (
                  <li key={i}>
                    <time>{t.at ?? '—'}</time>
                    <span>
                      {t.fromLifecycle ?? '—'} → {t.toLifecycle ?? '—'}
                    </span>
                    {t.detail && <small>{t.detail}</small>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {h.relationships.length > 0 && (
            <section>
              <h3>Related</h3>
              <ul className="to-bullets">
                {h.relationships.map((r, i) => (
                  <li key={i}>
                    {r.kind} · {r.type} → {r.to}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
