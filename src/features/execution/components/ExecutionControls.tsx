import { useState } from 'react';
import { Badge, Card } from '../../../components/UI';
import { controlTone } from '../services/executionStage';
import { reconcileNow, setControlNow, useExecutionStore } from '../services/executionStore';
import type { ControlPatch } from '../services/executionClient';
import type { ControlStateName } from '../types';
import { human, stamp } from './format';

const FLAG_HELP: Record<ControlStateName, string> = {
  RUNNING: 'All clear — Stage 9 accepts Stage 8 authorizations',
  EMERGENCY_STOP: 'No new entries; open positions keep broker SL/TP and safety-critical management',
  MT5_DISCONNECTED: 'Positions shown from the last confirmed state (STALE); full reconciliation on reconnect',
  RECONCILING: 'New executions wait until the broker account is fully reconciled',
  EXECUTION_DISABLED: 'Stage 9 order submission switched off; management of open positions continues',
  TRADING_PAUSED: 'Global trading paused — new entries blocked, open positions still managed',
};

/** Operator controls — each command is persisted and executed by the central engine on the bridge, never by this page. */
export function ExecutionControls() {
  const store = useExecutionStore();
  const s = store.state;
  const run = s?.run ?? null;
  const control = run?.control;
  const ctrl = s?.control;
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const disabled = store.busy || !s;

  const send = async (patch: ControlPatch, label: string) => {
    setMsg(null);
    try {
      const r = await setControlNow(patch, reason.trim() || label);
      setMsg({ ok: true, text: r.changed.length ? `${label} — applied by the central engine` : `${label} — no change` });
      setReason('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Command failed' });
    }
  };

  const reconcile = async () => {
    setMsg(null);
    try {
      const r = await reconcileNow();
      setMsg({ ok: true, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Reconcile request failed' });
    }
  };

  const trading = Boolean(s?.tradingEnabled);
  const execution = Boolean(ctrl?.executionEnabled);
  const emergency = Boolean(ctrl?.emergencyStop);

  return (
    <Card>
      <div className="card-head">
        <div>
          <h3>Engine Control</h3>
          <p>Separate, simultaneous control states · commands are audited in dbo.app_exec_event and applied by node {run?.node ?? '—'} whether or not this page is open</p>
        </div>
        <Badge tone={controlTone(control?.state)}>{control ? human(control.state) : 'NO STATE'}</Badge>
      </div>
      <div className="ex-flags">
        {(control?.flags.length ? control.flags : control ? [{ state: 'RUNNING' as ControlStateName, reason: control.reason }] : []).map((f) => (
          <div key={f.state} className={`ex-flag ${controlTone(f.state)}`}>
            <b>{human(f.state)}</b>
            <span>{f.reason}</span>
            <small>{FLAG_HELP[f.state]}</small>
          </div>
        ))}
        {!control && <p className="hr-reason">{store.loading ? 'Loading engine control state…' : 'The Stage 9 engine has not published a control state yet.'}</p>}
      </div>
      <div className="ex-switches">
        <div>
          <span>Global trading</span>
          <b>
            <Badge tone={trading ? 'green' : 'amber'}>{trading ? 'RUNNING' : 'PAUSED'}</Badge>
          </b>
          <button type="button" className="hr-run" disabled={disabled} onClick={() => void send({ tradingEnabled: !trading }, trading ? 'Pause new trades' : 'Resume trading')}>
            {trading ? 'Pause new trades' : 'Resume trading'}
          </button>
        </div>
        <div>
          <span>Stage 9 execution</span>
          <b>
            <Badge tone={execution ? 'green' : 'amber'}>{execution ? 'ENABLED' : 'DISABLED'}</Badge>
          </b>
          <button type="button" className="hr-run" disabled={disabled} onClick={() => void send({ executionEnabled: !execution }, execution ? 'Disable execution' : 'Enable execution')}>
            {execution ? 'Disable execution' : 'Enable execution'}
          </button>
        </div>
        <div>
          <span>Emergency stop</span>
          <b>
            <Badge tone={emergency ? 'red' : 'gray'}>{emergency ? 'ENGAGED' : 'CLEAR'}</Badge>
          </b>
          <button
            type="button"
            className={`hr-run${emergency ? '' : ' ex-danger'}`}
            disabled={disabled}
            onClick={() => void send({ emergencyStop: !emergency }, emergency ? 'Release emergency stop' : 'Emergency stop')}
          >
            {emergency ? 'Release' : 'Emergency stop'}
          </button>
        </div>
        <div>
          <span>Reconciliation</span>
          <b>
            <Badge tone={run?.reconciled ? 'green' : 'amber'}>{run?.reconciled ? 'RECONCILED' : 'PENDING'}</Badge>
          </b>
          <button type="button" className="hr-run" disabled={disabled} onClick={() => void reconcile()}>
            Reconcile now
          </button>
        </div>
      </div>
      <div className="or-save">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the audit trail (optional)" aria-label="Control change reason" />
      </div>
      {msg && <p className={msg.ok ? 'hr-reason' : 'hr-reason negative'}>{msg.text}</p>}
      <p className="hr-reason">
        Live and Prop accounts never execute from simulated or stale data, a disconnected account, unresolved reconciliation or an expired authorization. Last change{' '}
        {ctrl?.updatedAt ? `${stamp(ctrl.updatedAt)} by ${ctrl.updatedBy ?? '—'}${ctrl.reason ? ` · ${ctrl.reason}` : ''}` : '—'}.
      </p>
    </Card>
  );
}
