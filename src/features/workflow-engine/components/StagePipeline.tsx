import { Fragment } from 'react';
import type { StageRuntime } from '../types/workflow';
import { HealthChip, StateChip } from './chips';
import { age } from '../utils/format';

function StageCard({ s, selected, onSelect, next }: { s: StageRuntime; selected: boolean; onSelect: (id: number) => void; next?: StageRuntime }) {
  return (
    <button type="button" className={`stage${selected ? ' selected' : ''} h-${s.health.toLowerCase()}`} onClick={() => onSelect(s.id)} aria-pressed={selected}>
      <div className="stage-top">
        <span className="stage-no">{s.id}</span>
        <HealthChip health={s.health} title={s.healthReason} />
      </div>
      <h3>{s.name}</h3>
      <StateChip state={s.state} title={s.stateReason} />
      <div className="meter" title={`${s.counts.passed} of ${s.counts.processed} instruments passed`}>
        <i style={{ width: `${s.counts.processed ? Math.round((s.counts.passed / s.counts.processed) * 100) : 0}%` }} />
      </div>
      <div className="stage-meta">
        <span>
          {s.counts.passed}/{s.counts.processed} passed
        </span>
        <span>{s.freshnessSec == null ? '—' : age(s.freshnessSec)}</span>
      </div>
      <div className="stage-foot" title={s.blockedBy ? s.blockedBy.detail : s.stateReason}>
        {s.blockedBy ? `⛔ held by S${s.blockedBy.id}` : s.confidence != null ? `${s.id === 1 ? 'history quality' : 'conf'} ${s.confidence}%` : '\u00a0'}
        {next && <em>→ S{next.id}</em>}
      </div>
    </button>
  );
}

/** Flow between two stages: live when the upstream stage passes instruments on, held otherwise. */
const flowOf = (s: StageRuntime) => (s.counts.passed > 0 && s.health !== 'OFFLINE' && s.health !== 'ERROR' ? 'flow' : 'held');

export function StagePipeline({ stages, selected, onSelect }: { stages: StageRuntime[]; selected: number; onSelect: (id: number) => void }) {
  const rows = [stages.slice(0, 5), stages.slice(5, 10)];
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">DECISION PIPELINE</span>
          <h2>10-stage live path</h2>
        </div>
        <span className="muted">Health = engine condition · State = where the stage's work stands · connectors show whether instruments pass on</span>
      </div>
      <div className="stage-grid">
        {rows.map((row, r) => (
          <Fragment key={r}>
            <div className="stage-row">
              {row.map((s, i) => (
                <Fragment key={s.id}>
                  <StageCard s={s} selected={selected === s.id} onSelect={onSelect} next={stages[s.id]} />
                  {i < row.length - 1 && <span className={`conn ${flowOf(s)}`} aria-hidden="true" />}
                </Fragment>
              ))}
            </div>
            {r === 0 && (
              <div className={`wrap-conn ${flowOf(stages[4])}`} aria-hidden="true">
                <i className="wa" />
                <i className="wb" />
                <i className="wc" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
