import type { WorkflowSnapshot } from '../types/workflow';
import { age, ago, human, stamp } from '../utils/format';

export function OrchestratorPanel({ d }: { d: WorkflowSnapshot }) {
  const e = d.engine;
  const worst = e.indicators.some((i) => i.status === 'FAIL') ? 'bad' : e.indicators.some((i) => i.status === 'WARN') ? 'warn' : 'ok';
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">AUTONOMOUS ORCHESTRATOR</span>
          <h2>Control Plane</h2>
        </div>
        <span className={`live ${worst}`}>{worst === 'ok' ? '● ALL CHECKS PASS' : worst === 'warn' ? '● ATTENTION' : '● FAULT'}</span>
      </div>
      <div className="orchestrator">
        <div className="brain" title={e.node ? `Central engine node ${e.node}` : 'Central engine not reporting'}>
          ◎<b>CENTRAL ENGINE</b>
          <span>Cycle #{e.cycle ?? '—'}</span>
          <span>{e.node ?? 'no node'}</span>
        </div>
        <div className="control-list">
          {e.indicators.map((x, i) => (
            <div key={x.key} title={x.detail}>
              <span>0{i + 1}</span>
              <p>
                <b>{x.label}</b>
                <small>{x.detail}</small>
              </p>
              <em className={`ind ${x.status.toLowerCase()}`}>{x.status}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="runtime-grid">
        <div>
          <span>Last heartbeat</span>
          <b title={stamp(e.lastHeartbeat)}>{e.heartbeatAgeSec == null ? '—' : `${age(e.heartbeatAgeSec)} ago`}</b>
        </div>
        <div>
          <span>Active jobs</span>
          <b title={e.activeJobs.join('\n') || 'None'}>{e.activeJobs.length}</b>
        </div>
        <div>
          <span>Queued jobs</span>
          <b>{e.queuedJobs}</b>
        </div>
        <div>
          <span>Queued authorizations</span>
          <b>{e.queuedAuthorizations}</b>
        </div>
        <div>
          <span>Retries</span>
          <b className={e.retries ? 'warn' : ''}>{e.retries}</b>
        </div>
        <div>
          <span>Failed jobs</span>
          <b className={e.failedJobs ? 'bad' : ''}>{e.failedJobs}</b>
        </div>
        <div>
          <span>Bus throughput</span>
          <b>{e.throughput}/min</b>
        </div>
        <div>
          <span>Execution gate</span>
          <b className={e.newEntries ? 'ok' : 'warn'} title={e.controlReason}>
            {e.newEntries ? 'OPEN' : human(e.control)}
          </b>
        </div>
      </div>
      {e.activeJobs.length > 0 && <p className="muted jobs">Running: {e.activeJobs.join(' · ')}</p>}
      <div className="accounts">
        <h4>
          Accounts · mode <b className={`mode-text mode-${e.mode.toLowerCase()}`}>{e.mode}</b>
          <small>{e.modeSource}</small>
        </h4>
        {e.accounts.length ? (
          e.accounts.map((a) => (
            <div key={a.id} className="acct" title={a.issues.join('\n') || 'No issues'}>
              <b>
                {a.name}
                {a.attached && <em>ATTACHED</em>}
              </b>
              <span>
                {a.accountClass} · {a.currency}
              </span>
              <span className={a.connection === 'HEALTHY' ? 'ok' : 'warn'}>{human(a.connection)}</span>
              <span>{human(a.tradingMode)}</span>
              <span className={a.eligibility === 'ELIGIBLE' ? 'ok' : 'warn'}>{human(a.eligibility)}</span>
            </div>
          ))
        ) : (
          <p className="muted">No MT5 account configured.</p>
        )}
        <p className="muted">
          Flags: {e.controlFlags.length ? e.controlFlags.map((f) => human(f.state)).join(' · ') : 'none'} · last control change {ago(e.controlUpdatedAt)}
          {e.controlUpdatedBy ? ` by ${e.controlUpdatedBy}` : ''}
        </p>
      </div>
    </section>
  );
}
