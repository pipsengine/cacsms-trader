import type { ControlCommand, WorkflowSnapshot } from '../types/workflow';
import type { ConfirmSpec } from './ConfirmDialog';
import { age, human } from '../utils/format';

type Props = {
  d: WorkflowSnapshot;
  busy: string | null;
  onReconcile: () => void;
  onControl: (cmd: ControlCommand, reason: string) => void;
  confirm: (spec: ConfirmSpec) => void;
};

/** Control semantics: nothing here can stop position protection; Emergency Stop is separate and type-to-confirm protected. */
export function WorkflowHeader({ d, busy, onReconcile, onControl, confirm }: Props) {
  const e = d.engine;
  const hbOk = e.heartbeatAgeSec != null && e.heartbeatAgeSec <= 60;
  const disabled = Boolean(busy) || !e.bridgeReachable;

  const ask = (cmd: ControlCommand, spec: Omit<ConfirmSpec, 'onConfirm'>) => confirm({ ...spec, onConfirm: (reason) => onControl(cmd, reason) });

  return (
    <header className="wf-head">
      <div>
        <div className="eyebrow">OVERVIEW / WORKFLOW ENGINE</div>
        <h1>Workflow Engine</h1>
        <p>Real-time monitoring and control of the 10-stage autonomous pipeline running on the central engine.</p>
      </div>
      <div className="head-side">
        <div className="head-status">
          <span className={`mode mode-${e.mode.toLowerCase()}`} title={e.modeSource}>
            {e.mode}
          </span>
          <span className={'live ' + (hbOk ? 'ok' : 'warn')} title={e.node ? `Node ${e.node}` : undefined}>
            {e.bridgeReachable ? (hbOk ? `● ENGINE HEARTBEAT ${age(e.heartbeatAgeSec)}` : `● HEARTBEAT ${e.heartbeatAgeSec == null ? 'NONE' : `${age(e.heartbeatAgeSec)} OLD`}`) : '● BRIDGE OFFLINE'}
          </span>
          <span className={`live ${e.newEntries ? 'ok' : e.emergencyStop ? 'bad' : 'warn'}`} title={e.controlReason}>
            GATE {e.newEntries ? 'OPEN' : `CLOSED · ${human(e.control)}`}
          </span>
        </div>
        <div className="head-actions">
          <button type="button" onClick={onReconcile} disabled={Boolean(busy)} title="Re-read every stage's persisted state; does not re-run any engine">
            ↻ Refresh
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              e.tradingEnabled
                ? ask('PAUSE_NEW_TRADES', {
                    title: 'Pause new trades',
                    confirmLabel: 'Pause new trades',
                    effects: ['Stages 1–8 keep analysing', 'Stage 9 opens no new positions; unfilled entry orders are withdrawn', 'Open positions keep SL/TP and full management', 'Stage 10 keeps recording'],
                  })
                : ask('RESUME_NEW_TRADES', {
                    title: 'Resume new trades',
                    confirmLabel: 'Resume new trades',
                    effects: ['Global trading RUNNING', 'Stage 9 still enforces every gate: execution enabled, reconciliation, revalidation, Stage 8 authorization'],
                  })
            }
          >
            {e.tradingEnabled ? 'Pause new trades' : 'Resume new trades'}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              e.analysisPaused
                ? ask('RESUME_ANALYSIS', { title: 'Resume analysis', confirmLabel: 'Resume analysis', effects: ['Stages 2–8 resume; triggers held while paused run immediately'] })
                : ask('PAUSE_ANALYSIS', {
                    title: 'Pause analysis',
                    confirmLabel: 'Pause analysis',
                    effects: ['Stages 2–8 stop re-evaluating (triggers are held, not lost)', 'Stage 9 blocks new entries because signals are frozen', 'Stage 1 data sync, Stage 9 position management and Stage 10 continue'],
                  })
            }
          >
            {e.analysisPaused ? 'Resume analysis' : 'Pause analysis'}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              e.executionEnabled
                ? ask('DISABLE_EXECUTION', { title: 'Disable Stage 9 execution', confirmLabel: 'Disable execution', effects: ['No new orders are submitted', 'Open positions are still managed'] })
                : ask('ENABLE_EXECUTION', {
                    title: 'Enable Stage 9 execution',
                    confirmLabel: 'Enable execution',
                    effects: [`Account mode: ${e.mode}`, 'Orders only follow a Stage 8 authorization that passes Stage 9 revalidation', 'Accounts in ANALYSIS_ONLY or trading-disabled remain non-executable'],
                  })
            }
          >
            Execution {e.executionEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className={e.emergencyStop ? '' : 'danger'}
            disabled={disabled}
            onClick={() =>
              e.emergencyStop
                ? ask('RELEASE_EMERGENCY', { title: 'Release emergency stop', confirmLabel: 'Release', danger: true, typeToConfirm: 'RELEASE', effects: ['New entries become possible again once every other gate is clear'] })
                : ask('EMERGENCY_STOP', {
                    title: 'Emergency stop',
                    confirmLabel: 'Engage emergency stop',
                    danger: true,
                    typeToConfirm: 'STOP',
                    effects: ['No new entries; pending entry orders withdrawn', 'Open positions keep broker SL/TP and safety-critical management', 'Recorded as a CONTROL event on the central engine'],
                  })
            }
          >
            {e.emergencyStop ? 'Release emergency stop' : 'Emergency stop'}
          </button>
        </div>
      </div>
    </header>
  );
}
