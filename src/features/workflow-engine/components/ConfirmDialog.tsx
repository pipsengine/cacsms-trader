import { useState } from 'react';

export type ConfirmSpec = {
  title: string;
  effects: string[];
  confirmLabel: string;
  danger?: boolean;
  /** When set, the operator must type this word to confirm (protected controls). */
  typeToConfirm?: string;
  onConfirm: (reason: string) => void;
};

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const locked = spec.typeToConfirm ? typed.trim().toUpperCase() !== spec.typeToConfirm : false;
  return (
    <div className="wf-modal" role="dialog" aria-modal="true" aria-label={spec.title} onClick={onClose}>
      <div className={`wf-dialog${spec.danger ? ' danger' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h3>{spec.title}</h3>
        <ul>
          {spec.effects.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <label>
          Reason for the audit trail
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in dbo.app_exec_event" />
        </label>
        {spec.typeToConfirm && (
          <label>
            Type <b>{spec.typeToConfirm}</b> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${spec.typeToConfirm} to confirm`} />
          </label>
        )}
        <div className="wf-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={spec.danger ? 'danger' : 'primary'}
            disabled={locked}
            onClick={() => {
              spec.onConfirm(reason);
              onClose();
            }}
          >
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
