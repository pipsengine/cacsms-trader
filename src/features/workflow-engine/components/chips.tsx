import type { EvidenceFreshness, OperationalHealth, PipelineState, TraceDecision } from '../types/workflow';
import { human } from '../utils/format';

export const healthTone = (h: OperationalHealth) => (h === 'HEALTHY' ? 'ok' : h === 'DEGRADED' ? 'warn' : 'bad');

export const stateTone = (s: PipelineState) =>
  s === 'READY' || s === 'RUNNING'
    ? 'ok'
    : s === 'WAITING' || s === 'WARMING_UP' || s === 'IDLE'
      ? 'info'
      : s === 'PAUSED' || s === 'STALE'
        ? 'warn'
        : 'bad';

export function HealthChip({ health, title }: { health: OperationalHealth; title?: string }) {
  return (
    <span className={`chip health ${healthTone(health)}`} title={title}>
      <i />
      {health}
    </span>
  );
}

export function StateChip({ state, title }: { state: PipelineState; title?: string }) {
  return (
    <span className={`chip state ${stateTone(state)}`} title={title}>
      {human(state)}
    </span>
  );
}

export function FreshTag({ f }: { f: EvidenceFreshness }) {
  if (f === 'LIVE' || f === 'NONE') return null;
  return <span className={`fresh ${f === 'STALE' ? 'stale' : 'known'}`}>{f === 'STALE' ? 'STALE' : 'LAST KNOWN'}</span>;
}

export function DecisionBadge({ d }: { d: TraceDecision }) {
  return <span className={`badge ${d.toLowerCase()}`}>{d}</span>;
}
