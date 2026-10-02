import { useEffect, useRef } from 'react';
import type { ChartOverlayFlags } from '../chartOverlayFlags';
import { OVERLAY_TOGGLE_LABELS } from '../chartOverlayFlags';

type Props = {
  open: boolean;
  onClose: () => void;
  flags: ChartOverlayFlags;
  onChange: (next: ChartOverlayFlags) => void;
};

export function ChartIndicatorsMenu({ open, onClose, flags, onChange }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="chartIndicatorsMenu" ref={panelRef} role="dialog" aria-label="Chart indicators">
      <header>Analysis overlays</header>
      <ul>
        {OVERLAY_TOGGLE_LABELS.map(({ key, label }) => (
          <li key={key}>
            <label>
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={(e) => onChange({ ...flags, [key]: e.target.checked })}
              />
              {label}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
