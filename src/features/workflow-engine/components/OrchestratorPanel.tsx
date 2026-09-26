import type { WorkflowSnapshot } from '../types/workflow';
export function OrchestratorPanel({ d }: { d: WorkflowSnapshot }) {
  const healthy = d.engine.running && d.engine.errors === 0;
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">AUTONOMOUS ORCHESTRATOR</span>
          <h2>Control Plane</h2>
        </div>
        <span className={'live ' + (healthy ? 'ok' : 'warn')}>{healthy ? '● HEARTBEAT' : '● DEGRADED'}</span>
      </div>
      <div className="orchestrator">
        <div className="brain">
          ◎<b>ORCHESTRATOR</b>
          <span>Cycle #{d.engine.cycle}</span>
        </div>
        <div className="control-list">
          {[
            'Dependency scheduling',
            'Freshness validation',
            'Event routing',
            'Stale-signal prevention',
            'Retry / fail-safe handling',
            'Execution permissions',
          ].map((x, i) => (
            <div key={x}>
              <span>0{i + 1}</span>
              <b>{x}</b>
              <em>{d.engine.running ? (i === 5 && !d.engine.executionEnabled ? 'GATED' : 'HEALTHY') : 'PAUSED'}</em>
            </div>
          ))}
        </div>
        <div className="runtime">
          <h4>Runtime</h4>
          <p>
            <b>{d.engine.queueDepth}</b> queued events
          </p>
          <p>
            <b>{d.engine.throughput}/min</b> throughput
          </p>
          <p>
            <b>{d.engine.errors}</b> runtime errors
          </p>
          <p>
            <b>{d.engine.mode}</b> mode
          </p>
        </div>
      </div>
    </section>
  );
}
