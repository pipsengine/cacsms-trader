import type { StageRuntime } from '../types/workflow';
import { HealthChip, StateChip } from './chips';
import { age, ago, human, ms, stamp } from '../utils/format';

export function StageInspector({ stage: s, busy, onRerun }: { stage: StageRuntime; busy: boolean; onRerun: () => void }) {
  const slaL = s.sla.latencyOk == null ? '' : s.sla.latencyOk ? 'ok' : 'bad';
  const slaF = s.sla.freshnessOk == null ? '' : s.sla.freshnessOk ? 'ok' : 'bad';
  return (
    <section className="panel inspector">
      <div className="panel-title">
        <div>
          <span className="eyebrow">STAGE {s.id} DETAIL</span>
          <h2>{s.name}</h2>
          <p className="muted">{s.description}</p>
        </div>
        <div className="inspector-actions">
          <button type="button" onClick={onRerun} disabled={!s.rerun.allowed || busy} title={s.rerun.reason}>
            {s.running ? 'Running…' : s.id === 1 ? 'Refresh stage' : s.id === 9 ? 'Reconcile' : 'Re-run stage'}
          </button>
          <small>{s.rerun.reason}</small>
        </div>
      </div>

      <div className="status-pair">
        <div>
          <span>Operational health</span>
          <HealthChip health={s.health} />
          <p>{s.healthReason}</p>
        </div>
        <div>
          <span>Pipeline state</span>
          <StateChip state={s.state} />
          <p>{s.stateReason}</p>
        </div>
      </div>

      {s.blockedBy && (
        <div className="blocked-by">
          ⛔ Blocking dependency: <b>Stage {s.blockedBy.id} · {s.blockedBy.name}</b> — {s.blockedBy.detail}
        </div>
      )}

      <div className="inspect-grid">
        <div>
          <h4>Runtime</h4>
          <dl>
            <dt>{s.id === 1 ? 'History quality' : 'Confidence'}</dt>
            <dd>{s.confidence == null ? '—' : `${s.confidence}%`}</dd>
            <dt>{s.latencyLabel}</dt>
            <dd className={slaL}>
              {ms(s.latencyMs)}
              {s.sla.latencyMs != null && <small> / SLA {ms(s.sla.latencyMs)}</small>}
            </dd>
            <dt>Freshness</dt>
            <dd className={slaF}>
              {age(s.freshnessSec)}
              {s.sla.freshnessSec != null && <small> / SLA {age(s.sla.freshnessSec)}</small>}
            </dd>
            <dt>Runs · errors</dt>
            <dd>
              {s.runs ?? '—'} · {s.errors ?? '—'}
            </dd>
            <dt>Last run</dt>
            <dd title={stamp(s.lastRunAt)}>{ago(s.lastRunAt)}</dd>
            <dt>Last success</dt>
            <dd title={stamp(s.lastSuccessAt)}>{ago(s.lastSuccessAt)}</dd>
          </dl>
        </div>
        <div>
          <h4>Instruments (live path)</h4>
          <dl>
            <dt>Processed</dt>
            <dd>{s.counts.processed}</dd>
            <dt>Passed</dt>
            <dd className="ok">{s.counts.passed}</dd>
            <dt>Blocked / stale</dt>
            <dd className={s.counts.blocked ? 'bad' : ''}>{s.counts.blocked}</dd>
            <dt>Rejected / invalidated</dt>
            <dd>{s.counts.failed}</dd>
          </dl>
          <h4 className="gap">Dependencies</h4>
          {s.dependencies.length ? (
            s.dependencies.map((dep) => (
              <div key={dep.id} className={`io ${dep.ok ? 'good' : 'bad'}`} title={dep.detail}>
                {dep.ok ? '✓' : '✗'} S{dep.id} {dep.name}
                <small>{dep.detail}</small>
              </div>
            ))
          ) : (
            <div className="io">MT5 provider + historical store</div>
          )}
        </div>
        <div>
          <h4>Inputs</h4>
          {s.input.map((x) => (
            <div className="io" key={x}>
              ↘ {x}
            </div>
          ))}
          <h4 className="gap">Outputs</h4>
          {s.output.map((x) => (
            <div className="io good" key={x}>
              ↗ {x}
            </div>
          ))}
        </div>
        <div>
          <h4>Triggers</h4>
          {s.triggers.map((x) => (
            <div className="io" key={x}>
              ⚡ {x}
            </div>
          ))}
          <h4 className="gap">Invalidation conditions</h4>
          {s.invalidation.map((x) => (
            <div className="io warn" key={x}>
              ⚠ {x}
            </div>
          ))}
        </div>
      </div>

      <div className="engine-msg">
        <div>
          <h4>Current activity</h4>
          <p>{s.activity}</p>
        </div>
        <div>
          <h4>Exact engine message</h4>
          <p className="mono">{s.message || '—'}</p>
        </div>
        <div>
          <h4>Last error</h4>
          <p className={`mono${s.lastError ? ' neg' : ''}`}>{s.lastError ? human(s.lastError) : 'None reported'}</p>
        </div>
      </div>
    </section>
  );
}
